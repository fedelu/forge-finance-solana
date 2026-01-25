import { useState, useEffect, useCallback, useRef } from 'react'
import { PublicKey, SystemProgram, Transaction, LAMPORTS_PER_SOL } from '@solana/web3.js'
import { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddress, createAssociatedTokenAccountIdempotentInstruction, getAccount, createSyncNativeInstruction } from '@solana/spl-token'
import * as anchor from '@coral-xyz/anchor'
import { BN } from '@coral-xyz/anchor'
import { useWallet } from '../contexts/WalletContext'
import { usePrice } from '../contexts/PriceContext'
import { useLending } from './useLending'
import { getInfernoCruciblesProgram } from '../utils/infernoProgram'
import { deriveInfernoCruciblePDA, deriveInfernoVaultPDA, deriveInfernoUSDCVaultPDA, deriveInfernoLPPositionPDA, deriveInfernoCrucibleAuthorityPDA, deriveInfernoLPPositionPDALegacy } from '../utils/infernoPdas'
import { SOLANA_TESTNET_CONFIG, SOLANA_TESTNET_PROGRAM_IDS } from '../config/solana-testnet'
import { getInfernoLPPositions, setInfernoLPPositions, type StoredInfernoLPPosition } from '../utils/localStorage'
import { getLendingPoolPDA, getBorrowerAccountPDA, getPoolVaultPDA } from '../utils/lendingProgram'

export interface InfernoLPPosition extends StoredInfernoLPPosition {
  lpAPY: number
  pnl: number
  nonce: number // Position nonce for PDA derivation
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

  // Maximum positions to scan
  const MAX_POSITIONS_TO_SCAN = 50

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

        // Track added position PDAs to avoid duplicates
        const addedPositionIds = new Set<string>()
        let foundLegacyPosition = false
        
        // First, check for legacy position (without nonce) - created before multi-position update
        const [legacyPositionPDA] = deriveInfernoLPPositionPDALegacy(publicKey, baseMint)
        const legacyPDAString = legacyPositionPDA.toString()
        
        try {
          const positionAccount = await (program.account as any).infernoLpPositionAccount.fetch(legacyPositionPDA)
          if (positionAccount.isOpen) {
            const baseAmountNum = Number(positionAccount.baseAmount) / 1e9
            const usdcAmountNum = Number(positionAccount.usdcAmount) / 1e6
            const currentValue = baseAmountNum * solPrice + usdcAmountNum
            
            let lpTokenAmount = 0
            try {
              const crucibleAccount = await (program.account as any).infernoCrucible.fetch(positionAccount.crucible)
              const userLpTokenAccount = await getAssociatedTokenAddress(
                crucibleAccount.lpTokenMint,
                publicKey
              )
              const lpAccountInfo = await getAccount(connection, userLpTokenAccount)
              lpTokenAmount = Number(lpAccountInfo.amount) / 1e9
            } catch {
              // LP token account might not exist
            }
            
            console.log('Found legacy Inferno LP position (before nonce update)')
            userPositions.push({
              id: legacyPDAString,
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
              lpTokenAmount,
              nonce: -1, // Mark as legacy position (no nonce in PDA)
            })
            addedPositionIds.add(legacyPDAString)
            foundLegacyPosition = true
          }
        } catch {
          // No legacy position found, continue with nonce-based scan
        }

        // Scan for multiple positions using nonce
        // If we found a legacy position, start from nonce 1 to avoid duplicate (nonce 0 = legacy)
        let consecutiveEmpty = 0
        const startNonce = foundLegacyPosition ? 1 : 0
        
        for (let nonce = startNonce; nonce < MAX_POSITIONS_TO_SCAN && consecutiveEmpty < 5; nonce++) {
          const [positionPDA] = deriveInfernoLPPositionPDA(publicKey, baseMint, nonce)
          const positionPDAString = positionPDA.toString()

          // Skip if we already added this position
          if (addedPositionIds.has(positionPDAString)) {
            consecutiveEmpty++
            continue
          }

          try {
            const positionAccount = await (program.account as any).infernoLpPositionAccount.fetch(positionPDA)
            consecutiveEmpty = 0 // Reset counter on found position
            
            if (positionAccount.isOpen) {
              const baseAmountNum = Number(positionAccount.baseAmount) / 1e9
              const usdcAmountNum = Number(positionAccount.usdcAmount) / 1e6
              const currentValue = baseAmountNum * solPrice + usdcAmountNum
              
              // Fetch actual LP token balance from user's wallet
              let lpTokenAmount = 0
              try {
                const crucibleAccount = await (program.account as any).infernoCrucible.fetch(positionAccount.crucible)
                const userLpTokenAccount = await getAssociatedTokenAddress(
                  crucibleAccount.lpTokenMint,
                  publicKey
                )
                const lpAccountInfo = await getAccount(connection, userLpTokenAccount)
                lpTokenAmount = Number(lpAccountInfo.amount) / 1e9
              } catch {
                // LP token account might not exist
              }
              
              // Get nonce from account or use loop index
              const positionNonce = typeof positionAccount.nonce === 'number' 
                ? Number(positionAccount.nonce) 
                : nonce
              
              userPositions.push({
                id: positionPDAString,
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
                lpTokenAmount,
                nonce: positionNonce,
              })
              addedPositionIds.add(positionPDAString)
            }
          } catch {
            consecutiveEmpty++
            // Position doesn't exist at this nonce
          }
        }
      }

      if (userPositions.length === 0) {
        const cachedPositions = getInfernoLPPositions()
        const walletAddress = publicKey.toBase58()
        const filtered = cachedPositions.filter((p) => p.owner === walletAddress && p.isOpen)
        userPositions.push(
          ...filtered.map((p, index) => ({
            ...p,
            lpAPY: baseAPY,
            pnl: 0,
            nonce: (p as any).nonce ?? index,
          }))
        )
      }

      // Remove duplicates based on position ID (more robust check)
      const seenIds = new Set<string>()
      const uniquePositions = userPositions.filter((position) => {
        if (seenIds.has(position.id)) {
          console.warn(`Duplicate position detected and removed: ${position.id}`)
          return false
        }
        seenIds.add(position.id)
        return true
      })

      console.log(`Fetched ${userPositions.length} positions, ${uniquePositions.length} unique after deduplication`)
      setPositions(uniquePositions)
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
        const [crucibleAuthorityPDA] = deriveInfernoCrucibleAuthorityPDA(baseMint)

        const program = getInfernoCruciblesProgram(connection, {
          publicKey,
          signTransaction: async (tx: any) => tx,
          signAllTransactions: async (txs: any[]) => txs,
        })
        
        // Find the next available nonce for a new position (allows multiple positions like cToken)
        let positionNonce = 0
        let positionPDA: PublicKey
        
        for (let nonce = 0; nonce < MAX_POSITIONS_TO_SCAN; nonce++) {
          const [candidatePDA] = deriveInfernoLPPositionPDA(publicKey, baseMint, nonce)
          try {
            const accountInfo = await connection.getAccountInfo(candidatePDA)
            if (!accountInfo) {
              // Found an empty slot
              positionNonce = nonce
              positionPDA = candidatePDA
              console.log(`Found available nonce: ${nonce}, PDA: ${candidatePDA.toString()}`)
              break
            }
          } catch {
            positionNonce = nonce
            positionPDA = candidatePDA
            break
          }
        }
        
        // Fallback if no nonce found
        if (!positionPDA!) {
          const [fallbackPDA] = deriveInfernoLPPositionPDA(publicKey, baseMint, 0)
          positionPDA = fallbackPDA
          positionNonce = 0
        }
        
        console.log(`Using nonce ${positionNonce} for new Inferno LP position`)
        
        const crucibleAccount = await (program.account as any).infernoCrucible.fetch(cruciblePDA)

        const userBaseTokenAccount = await getAssociatedTokenAddress(baseMint, publicKey)
        const userUsdcAccount = await getAssociatedTokenAddress(usdcMint, publicKey)
        const userLpTokenAccount = await getAssociatedTokenAddress(crucibleAccount.lpTokenMint, publicKey)

        const accountCreationInstructions: anchor.web3.TransactionInstruction[] = []
        
        // Always create WSOL account idempotently
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
        
        // Wrap SOL: Transfer native SOL to WSOL account and sync
        const wrapSolIx = SystemProgram.transfer({
          fromPubkey: publicKey,
          toPubkey: userBaseTokenAccount,
          lamports: totalBaseLamports,
        })
        accountCreationInstructions.push(wrapSolIx)
        
        // Sync the native balance to update token balance
        accountCreationInstructions.push(
          createSyncNativeInstruction(userBaseTokenAccount)
        )
        const totalUsdcDecimals = Math.floor(usdcAmount * 1e6) + borrowedUsdcDecimals - Math.floor(borrowedUsdcDecimals / 2)

        // Use higher slippage tolerance (5000 bps = 50%) for LP deposits
        // since users may provide unbalanced token amounts
        const openIx = await program.methods
          .openInfernoLpPosition(
            new BN(totalBaseLamports),
            new BN(totalUsdcDecimals),
            new BN(borrowedUsdcDecimals),
            new BN(leverageBps),
            new BN(5000),
            new BN(positionNonce) // Nonce for multiple positions
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
          nonce: positionNonce, // Store nonce for closing position
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
        const [crucibleAuthorityPDA] = deriveInfernoCrucibleAuthorityPDA(baseMint)
        
        // ROBUST LEGACY DETECTION: Compare position ID with derived PDAs
        // This works regardless of what nonce value is stored in state/localStorage
        const [legacyPDA] = deriveInfernoLPPositionPDALegacy(publicKey, baseMint)
        const isLegacyPosition = positionId === legacyPDA.toString()
        
        console.log(`Position ID: ${positionId}`)
        console.log(`Legacy PDA: ${legacyPDA.toString()}`)
        console.log(`Is legacy position: ${isLegacyPosition}`)
        
        // Determine the position PDA and nonce
        let positionPDA: PublicKey
        let positionNonce = 0
        
        if (isLegacyPosition) {
          positionPDA = legacyPDA
          positionNonce = -1
          console.log('Detected LEGACY position (created before nonce update)')
        } else {
          // Find the position in state/localStorage to get its nonce
          let positionToClose = positions.find((p) => p.id === positionId && p.isOpen)
          if (!positionToClose) {
            const cachedPositions = getInfernoLPPositions()
            const cachedPosition = cachedPositions.find((p) => p.id === positionId && p.isOpen)
            if (cachedPosition) {
              positionToClose = { ...cachedPosition, lpAPY: baseAPY, pnl: 0, nonce: (cachedPosition as any).nonce ?? 0 }
            }
          }
          positionNonce = positionToClose?.nonce ?? 0
          const [derivedPDA] = deriveInfernoLPPositionPDA(publicKey, baseMint, positionNonce)
          positionPDA = derivedPDA
          console.log(`Detected NEW position with nonce ${positionNonce}`)
        }

        const program = getInfernoCruciblesProgram(connection, {
          publicKey,
          signTransaction: async (tx: any) => tx,
          signAllTransactions: async (txs: any[]) => txs,
        })

        const userBaseTokenAccount = await getAssociatedTokenAddress(baseMint, publicKey)
        const userUsdcAccount = await getAssociatedTokenAddress(usdcMint, publicKey)

        const crucibleAccount = await (program.account as any).infernoCrucible.fetch(cruciblePDA)
        
        // For 1x positions (no borrowed USDC), we can pass placeholder accounts
        // The contract will skip lending operations when position.borrowed_usdc is 0
        const [lendingPoolPDA] = getLendingPoolPDA()
        const [lendingVaultPDA] = getPoolVaultPDA(lendingPoolPDA)
        
        // Check if position has borrowed USDC - use actual borrower account or lending vault as placeholder
        // For 1x positions, we need a valid mutable account that's not already in the accounts list
        let hasBorrowedUsdc = false
        let borrowerAccount = lendingVaultPDA // Default: use lending vault as placeholder (it's mutable and won't be used for 1x positions)
        
        try {
          const positionData = await (program.account as any).infernoLpPositionAccount.fetch(positionPDA)
          hasBorrowedUsdc = positionData.borrowedUsdc && positionData.borrowedUsdc.toNumber() > 0
          
          if (hasBorrowedUsdc) {
            borrowerAccount = getBorrowerAccountPDA(publicKey)[0]
          }
        } catch (error) {
          console.warn('Could not fetch position data, assuming 1x position (no borrowed USDC):', error)
          // Default to lendingVaultPDA as placeholder (mutable account that won't be used)
        }
        
        // Use legacy close for positions created before nonce was added
        let closeIx
        if (isLegacyPosition) {
          console.log('Using legacy close instruction for pre-nonce position')
          closeIx = await program.methods
            .closeInfernoLpPositionLegacy(new BN(5000)) // 50% slippage tolerance, no nonce
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
              borrowerAccount: borrowerAccount,
              lendingVault: lendingVaultPDA,
              lendingProgram: new PublicKey(SOLANA_TESTNET_PROGRAM_IDS.LENDING_POOL),
              tokenProgram: TOKEN_PROGRAM_ID,
            })
            .instruction()
        } else {
          closeIx = await program.methods
            .closeInfernoLpPosition(new BN(5000), new BN(positionNonce)) // 50% slippage tolerance + nonce
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
              borrowerAccount: borrowerAccount,
              lendingVault: lendingVaultPDA,
              lendingProgram: new PublicKey(SOLANA_TESTNET_PROGRAM_IDS.LENDING_POOL),
              tokenProgram: TOKEN_PROGRAM_ID,
            })
            .instruction()
        }

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
