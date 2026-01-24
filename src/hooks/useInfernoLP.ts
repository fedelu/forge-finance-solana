import { useState, useEffect, useCallback, useRef } from 'react'
import { PublicKey, SystemProgram, Transaction } from '@solana/web3.js'
import { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddress, createAssociatedTokenAccountIdempotentInstruction, getAccount } from '@solana/spl-token'
import * as anchor from '@coral-xyz/anchor'
import { BN } from '@coral-xyz/anchor'
import { useWallet } from '../contexts/WalletContext'
import { usePrice } from '../contexts/PriceContext'
import { useLending } from './useLending'
import { getInfernoCruciblesProgram } from '../utils/infernoProgram'
import { deriveInfernoCruciblePDA, deriveInfernoVaultPDA, deriveInfernoUSDCVaultPDA, deriveInfernoLPPositionPDA, deriveInfernoCrucibleAuthorityPDA } from '../utils/infernoPdas'
import { SOLANA_TESTNET_CONFIG, SOLANA_TESTNET_PROGRAM_IDS } from '../config/solana-testnet'
import { getInfernoLPPositions, setInfernoLPPositions, type StoredInfernoLPPosition } from '../utils/localStorage'
import { getLendingPoolPDA, getBorrowerAccountPDA, getPoolVaultPDA } from '../utils/lendingProgram'

export interface InfernoLPPosition extends StoredInfernoLPPosition {
  lpAPY: number
  pnl: number
}

interface UseInfernoLPProps {
  crucibleAddress: string
  baseTokenSymbol: 'SOL'
  baseAPY: number
}

async function getJupiterSwapTransaction(
  inputMint: string,
  outputMint: string,
  amount: string,
  userPublicKey: string,
  slippageBps: number
): Promise<{ swapTx: Transaction; outAmount: string }> {
  const quoteUrl = `https://quote-api.jup.ag/v6/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount}&slippageBps=${slippageBps}`
  const quoteResponse = await fetch(quoteUrl).then((r) => r.json())
  if (!quoteResponse || !quoteResponse.outAmount) {
    throw new Error('Failed to fetch Jupiter quote')
  }

  const swapResponse = await fetch('https://quote-api.jup.ag/v6/swap', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      quoteResponse,
      userPublicKey,
      wrapUnwrapSOL: true,
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: 'auto',
    }),
  }).then((r) => r.json())

  if (!swapResponse?.swapTransaction) {
    throw new Error('Failed to build Jupiter swap transaction')
  }

  const swapTx = Transaction.from(Buffer.from(swapResponse.swapTransaction, 'base64'))
  return { swapTx, outAmount: quoteResponse.outAmount }
}

export function useInfernoLP({ crucibleAddress, baseTokenSymbol, baseAPY }: UseInfernoLPProps) {
  const { solPrice } = usePrice()
  const { publicKey, connection, sendTransaction } = useWallet()
  const { borrow } = useLending()
  const [positions, setPositions] = useState<InfernoLPPosition[]>([])
  const [loading, setLoading] = useState(false)
  const fetchPositionsRef = useRef<(() => Promise<void>) | null>(null)

  const fetchPositions = useCallback(async () => {
    if (!publicKey || !crucibleAddress) {
      setPositions([])
      return
    }

    try {
      setLoading(true)
      const userPositions: InfernoLPPosition[] = []

      if (connection) {
        const anchorWallet: any = {
          publicKey,
          signTransaction: async (tx: any) => tx,
          signAllTransactions: async (txs: any[]) => txs,
        }
        const program = getInfernoCruciblesProgram(connection, anchorWallet)
        const baseMint = new PublicKey(SOLANA_TESTNET_CONFIG.TOKEN_ADDRESSES.SOL)
        const [positionPDA] = deriveInfernoLPPositionPDA(publicKey, baseMint)

        try {
          const positionAccount = await (program.account as any).infernoLpPositionAccount.fetch(positionPDA)
          if (positionAccount.isOpen) {
            const baseAmountNum = Number(positionAccount.baseAmount) / 1e9
            const usdcAmountNum = Number(positionAccount.usdcAmount) / 1e6
            const currentValue = baseAmountNum * solPrice + usdcAmountNum
            userPositions.push({
              id: positionPDA.toString(),
              owner: positionAccount.owner.toBase58(),
              baseToken: baseTokenSymbol,
              baseAmount: baseAmountNum,
              usdcAmount: usdcAmountNum,
              entryPrice: Number(positionAccount.entryPrice) / 1_000_000,
              currentValue,
              yieldEarned: 0,
              isOpen: positionAccount.isOpen,
              borrowedUSDC: Number(positionAccount.borrowedUsdc) / 1e6,
              leverageFactor: Number(positionAccount.leverageFactor) / 100,
              lpAPY: baseAPY,
              pnl: 0,
            })
          }
        } catch {
          // ignore missing position
        }
      }

      if (userPositions.length === 0) {
        const cachedPositions = getInfernoLPPositions()
        const walletAddress = publicKey.toBase58()
        const filtered = cachedPositions.filter((p) => p.owner === walletAddress && p.isOpen)
        userPositions.push(
          ...filtered.map((p) => ({
            ...p,
            lpAPY: baseAPY,
            pnl: 0,
          }))
        )
      }

      setPositions(userPositions)
    } catch (error) {
      console.error('Error fetching inferno LP positions:', error)
      setPositions([])
    } finally {
      setLoading(false)
    }
  }, [publicKey?.toBase58(), connection, crucibleAddress, baseTokenSymbol, baseAPY, solPrice])

  const openPosition = useCallback(
    async (baseAmount: number, usdcAmount: number, leverageFactor: number) => {
      if (!publicKey || !connection || !sendTransaction) {
        throw new Error('Wallet not connected')
      }
      if (!crucibleAddress) {
        throw new Error('Crucible information missing')
      }

      setLoading(true)
      try {
        if (![1, 1.5, 2].includes(leverageFactor)) {
          throw new Error('Invalid leverage factor')
        }
        const baseTokenPrice = solPrice
        const baseValue = baseAmount * baseTokenPrice
        const usdcValue = usdcAmount
        const userEquity = baseValue + usdcValue
        const leverageBps = Math.round(leverageFactor * 100)
        const leverageExcess = Math.max(0, leverageBps - 100)
        const borrowedUsdcValue = (userEquity * leverageExcess) / 100
        const borrowedUsdcDecimals = Math.floor(borrowedUsdcValue * 1e6)

        if (borrowedUsdcDecimals > 0) {
          await borrow(borrowedUsdcValue)
        }

        let swapOutLamports = 0
        if (borrowedUsdcDecimals > 0) {
          const swapAmount = Math.floor(borrowedUsdcDecimals / 2)
          const { swapTx, outAmount } = await getJupiterSwapTransaction(
            SOLANA_TESTNET_CONFIG.TOKEN_ADDRESSES.USDC,
            SOLANA_TESTNET_CONFIG.TOKEN_ADDRESSES.SOL,
            swapAmount.toString(),
            publicKey.toBase58(),
            100
          )
          const swapSignature = await sendTransaction(swapTx)
          await connection.confirmTransaction(swapSignature, 'confirmed')
          swapOutLamports = Number(outAmount)
        }

        const baseMint = new PublicKey(SOLANA_TESTNET_CONFIG.TOKEN_ADDRESSES.SOL)
        const usdcMint = new PublicKey(SOLANA_TESTNET_CONFIG.TOKEN_ADDRESSES.USDC)
        const [cruciblePDA] = deriveInfernoCruciblePDA(baseMint)
        const [baseVaultPDA] = deriveInfernoVaultPDA(cruciblePDA)
        const [usdcVaultPDA] = deriveInfernoUSDCVaultPDA(cruciblePDA)
        const [positionPDA] = deriveInfernoLPPositionPDA(publicKey, baseMint)
        const [crucibleAuthorityPDA] = deriveInfernoCrucibleAuthorityPDA(baseMint)

        const program = getInfernoCruciblesProgram(connection, {
          publicKey,
          signTransaction: async (tx: any) => tx,
          signAllTransactions: async (txs: any[]) => txs,
        })
        const crucibleAccount = await (program.account as any).infernoCrucible.fetch(cruciblePDA)

        const userBaseTokenAccount = await getAssociatedTokenAddress(baseMint, publicKey)
        const userUsdcAccount = await getAssociatedTokenAddress(usdcMint, publicKey)
        const userLpTokenAccount = await getAssociatedTokenAddress(crucibleAccount.lpTokenMint, publicKey)

        const accountCreationInstructions: anchor.web3.TransactionInstruction[] = []
        try {
          await getAccount(connection, userBaseTokenAccount)
        } catch {
          accountCreationInstructions.push(
            createAssociatedTokenAccountIdempotentInstruction(
              publicKey,
              userBaseTokenAccount,
              publicKey,
              baseMint,
              TOKEN_PROGRAM_ID,
              ASSOCIATED_TOKEN_PROGRAM_ID
            )
          )
        }
        try {
          await getAccount(connection, userUsdcAccount)
        } catch {
          accountCreationInstructions.push(
            createAssociatedTokenAccountIdempotentInstruction(
              publicKey,
              userUsdcAccount,
              publicKey,
              usdcMint,
              TOKEN_PROGRAM_ID,
              ASSOCIATED_TOKEN_PROGRAM_ID
            )
          )
        }
        try {
          await getAccount(connection, userLpTokenAccount)
        } catch {
          accountCreationInstructions.push(
            createAssociatedTokenAccountIdempotentInstruction(
              publicKey,
              userLpTokenAccount,
              publicKey,
              crucibleAccount.lpTokenMint,
              TOKEN_PROGRAM_ID,
              ASSOCIATED_TOKEN_PROGRAM_ID
            )
          )
        }

        const totalBaseLamports = Math.floor(baseAmount * 1e9) + swapOutLamports
        const totalUsdcDecimals = Math.floor(usdcAmount * 1e6) + borrowedUsdcDecimals - Math.floor(borrowedUsdcDecimals / 2)

        const openIx = await program.methods
          .openInfernoLpPosition(
            new BN(totalBaseLamports),
            new BN(totalUsdcDecimals),
            new BN(borrowedUsdcDecimals),
            new BN(leverageBps),
            new BN(100)
          )
          .accounts({
            crucible: cruciblePDA,
            user: publicKey,
            baseMint: baseMint,
            userBaseTokenAccount,
            userUsdcAccount,
            crucibleBaseVault: baseVaultPDA,
            crucibleUsdcVault: usdcVaultPDA,
            lpTokenMint: crucibleAccount.lpTokenMint,
            userLpTokenAccount,
            position: positionPDA,
            crucibleAuthority: crucibleAuthorityPDA,
            oracle: crucibleAccount.oracle || null,
            treasuryBase: crucibleAccount.treasuryBase,
            treasuryUsdc: crucibleAccount.treasuryUsdc,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .instruction()

        const transaction = new Transaction()
        if (accountCreationInstructions.length > 0) {
          transaction.add(...accountCreationInstructions)
        }
        transaction.add(openIx)

        const { blockhash } = await connection.getLatestBlockhash('confirmed')
        transaction.recentBlockhash = blockhash
        transaction.feePayer = publicKey

        const signature = await sendTransaction(transaction)
        await connection.confirmTransaction(signature, 'confirmed')

        const entryPrice = baseTokenPrice
        const position: InfernoLPPosition = {
          id: positionPDA.toString(),
          owner: publicKey.toBase58(),
          baseToken: baseTokenSymbol,
          baseAmount: totalBaseLamports / 1e9,
          usdcAmount: totalUsdcDecimals / 1e6,
          entryPrice,
          currentValue: totalBaseLamports / 1e9 * baseTokenPrice + totalUsdcDecimals / 1e6,
          yieldEarned: 0,
          isOpen: true,
          borrowedUSDC: borrowedUsdcDecimals / 1e6,
          leverageFactor: leverageFactor,
          lpAPY: baseAPY,
          pnl: 0,
        }

        const allStored = getInfernoLPPositions()
        const existingIndex = allStored.findIndex((p) => p.id === position.id)
        if (existingIndex >= 0) {
          allStored[existingIndex] = position
        } else {
          allStored.push(position)
        }
        setInfernoLPPositions(allStored)

        setPositions((prev) => {
          if (prev.find((p) => p.id === position.id)) {
            return prev
          }
          return [...prev, position]
        })

        window.dispatchEvent(new CustomEvent('infernoLpPositionOpened', { detail: { crucibleAddress, baseTokenSymbol } }))
        window.dispatchEvent(new CustomEvent('refreshLPBalance'))

        return position
      } finally {
        setLoading(false)
      }
    },
    [publicKey?.toBase58(), connection, sendTransaction, solPrice, baseTokenSymbol, baseAPY, crucibleAddress, borrow]
  )

  const closePosition = useCallback(
    async (positionId: string) => {
      if (!publicKey || !connection || !sendTransaction) {
        throw new Error('Wallet not connected')
      }
      setLoading(true)
      try {
        const baseMint = new PublicKey(SOLANA_TESTNET_CONFIG.TOKEN_ADDRESSES.SOL)
        const usdcMint = new PublicKey(SOLANA_TESTNET_CONFIG.TOKEN_ADDRESSES.USDC)
        const [cruciblePDA] = deriveInfernoCruciblePDA(baseMint)
        const [baseVaultPDA] = deriveInfernoVaultPDA(cruciblePDA)
        const [usdcVaultPDA] = deriveInfernoUSDCVaultPDA(cruciblePDA)
        const [positionPDA] = deriveInfernoLPPositionPDA(publicKey, baseMint)
        const [crucibleAuthorityPDA] = deriveInfernoCrucibleAuthorityPDA(baseMint)

        const program = getInfernoCruciblesProgram(connection, {
          publicKey,
          signTransaction: async (tx: any) => tx,
          signAllTransactions: async (txs: any[]) => txs,
        })

        const userBaseTokenAccount = await getAssociatedTokenAddress(baseMint, publicKey)
        const userUsdcAccount = await getAssociatedTokenAddress(usdcMint, publicKey)

        const crucibleAccount = await (program.account as any).infernoCrucible.fetch(cruciblePDA)
        const [lendingPoolPDA] = getLendingPoolPDA()
        const [borrowerPDA] = getBorrowerAccountPDA(publicKey)
        const [lendingVaultPDA] = getPoolVaultPDA(lendingPoolPDA)

        const closeIx = await program.methods
          .closeInfernoLpPosition(new BN(100))
          .accounts({
            crucible: cruciblePDA,
            user: publicKey,
            baseMint,
            position: positionPDA,
            userBaseTokenAccount,
            userUsdcAccount,
            userLpTokenAccount: await getAssociatedTokenAddress(crucibleAccount.lpTokenMint, publicKey),
            lpTokenMint: crucibleAccount.lpTokenMint,
            crucibleBaseVault: baseVaultPDA,
            crucibleUsdcVault: usdcVaultPDA,
            crucibleAuthority: crucibleAuthorityPDA,
            oracle: crucibleAccount.oracle || null,
            treasuryBase: crucibleAccount.treasuryBase,
            treasuryUsdc: crucibleAccount.treasuryUsdc,
            lendingMarket: lendingPoolPDA,
            borrowerAccount: borrowerPDA,
            lendingVault: lendingVaultPDA,
            lendingProgram: new PublicKey(SOLANA_TESTNET_PROGRAM_IDS.LENDING_POOL),
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .instruction()

        const tx = new Transaction().add(closeIx)
        tx.feePayer = publicKey
        tx.recentBlockhash = (await connection.getLatestBlockhash('confirmed')).blockhash

        const signature = await sendTransaction(tx)
        await connection.confirmTransaction(signature, 'confirmed')

        try {
          const stored = getInfernoLPPositions()
          const storedPosition = stored.find((p) => p.id === positionId)
          const targetSwap = storedPosition ? Math.floor(storedPosition.usdcAmount * 1e6) : 0
          if (targetSwap > 0) {
            const usdcAccountInfo = await getAccount(connection, userUsdcAccount)
            const usdcBalance = Number(usdcAccountInfo.amount)
            const swapAmount = Math.min(targetSwap, usdcBalance)
            if (swapAmount > 0) {
              const { swapTx } = await getJupiterSwapTransaction(
                SOLANA_TESTNET_CONFIG.TOKEN_ADDRESSES.USDC,
                SOLANA_TESTNET_CONFIG.TOKEN_ADDRESSES.SOL,
                swapAmount.toString(),
                publicKey.toBase58(),
                100
              )
              const swapSignature = await sendTransaction(swapTx)
              await connection.confirmTransaction(swapSignature, 'confirmed')
            }
          }
        } catch (swapError) {
          console.warn('Inferno close: USDC->SOL swap failed, leaving USDC in wallet', swapError)
        }

        const stored = getInfernoLPPositions()
        const updated = stored.filter((p) => p.id !== positionId)
        setInfernoLPPositions(updated)
        setPositions((prev) => prev.filter((p) => p.id !== positionId))

        window.dispatchEvent(new CustomEvent('infernoLpPositionClosed'))
        window.dispatchEvent(new CustomEvent('refreshLPBalance'))

        return { success: true }
      } finally {
        setLoading(false)
      }
    },
    [publicKey?.toBase58(), connection, sendTransaction]
  )

  useEffect(() => {
    fetchPositionsRef.current = fetchPositions
  }, [fetchPositions])

  useEffect(() => {
    if (!publicKey || !crucibleAddress) return
    const currentFetch = fetchPositionsRef.current || fetchPositions
    currentFetch()
  }, [publicKey?.toBase58(), crucibleAddress, baseTokenSymbol])

  return {
    positions,
    loading,
    openPosition,
    closePosition,
    refetch: fetchPositions,
  }
}
