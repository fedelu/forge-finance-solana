// Real on-chain lending market integration
// Fetches data from lending-pool smart contract

import { useCallback, useEffect, useMemo, useState, useRef } from 'react'
import { Connection, PublicKey, SystemProgram } from '@solana/web3.js'
import * as anchor from '@coral-xyz/anchor'
import BN from 'bn.js'
import { useWallet } from '../contexts/WalletContext'
import { 
  getLendingPoolProgram, 
  getMarketState, 
  getBorrowerAccount,
  calculateUtilization,
  calculateSupplyAPY,
  calculateBorrowAPY,
  getLendingPoolPDA,
  getBorrowerAccountPDA,
  getPoolVaultPDA,
  type AnchorWallet
} from '../utils/lendingProgram'
import { LENDING_YIELD_FEE_RATE } from '../config/fees'
import { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddress, createAssociatedTokenAccountIdempotentInstruction, getAccount } from '@solana/spl-token'
import { Transaction, TransactionInstruction } from '@solana/web3.js'
import { SOLANA_TESTNET_CONFIG, SOLANA_TESTNET_PROGRAM_IDS } from '../config/solana-testnet'
import { getLendingSupplyPositions, setLendingSupplyPositions, StoredLendingSupplyPosition } from '../utils/localStorage'

// deposit_usdc instruction discriminator from IDL: [184, 148, 250, 169, 224, 213, 34, 126]
const DEPOSIT_USDC_DISCRIMINATOR = Buffer.from([184, 148, 250, 169, 224, 213, 34, 126])

/**
 * Build deposit_usdc instruction manually (bypasses Anchor account resolution)
 */
function buildDepositUsdcInstruction(
  programId: PublicKey,
  accounts: {
    pool: PublicKey
    user: PublicKey
    userUsdcAccount: PublicKey
    poolVault: PublicKey
    tokenProgram: PublicKey
  },
  amount: BN
): TransactionInstruction {
  // Serialize amount as u64 (8 bytes, little-endian)
  const amountBuffer = Buffer.alloc(8)
  amount.toArrayLike(Buffer, 'le', 8).copy(amountBuffer)
  
  // Instruction data = discriminator + amount
  const data = Buffer.concat([DEPOSIT_USDC_DISCRIMINATOR, amountBuffer])
  
  // Account metas in order (matching IDL)
  const keys = [
    { pubkey: accounts.pool, isSigner: false, isWritable: true },
    { pubkey: accounts.user, isSigner: true, isWritable: true },
    { pubkey: accounts.userUsdcAccount, isSigner: false, isWritable: true },
    { pubkey: accounts.poolVault, isSigner: false, isWritable: true },
    { pubkey: accounts.tokenProgram, isSigner: false, isWritable: false },
  ]
  
  return new TransactionInstruction({
    keys,
    programId,
    data,
  })
}

export interface MarketInfo {
  marketPubkey: string
  baseMint: string
  tvl: string
  utilizationBps: number
  supplyApyBps: number
  borrowApyBps: number
  paused?: boolean
}

export interface LendingPosition {
  marketPubkey: string
  baseMint: string
  suppliedAmount: number
  interestEarned: number
  effectiveApy: number // After Forge 10% yield fee
  borrowedAmount?: number
  borrowedInterest?: number
}

export function useLending() {
  const { connection, publicKey, connected, signTransaction, sendTransaction } = useWallet()
  const [markets, setMarkets] = useState<MarketInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [positions, setPositions] = useState<LendingPosition[]>([])

  // Track last fetch time to prevent too frequent requests
  const lastFetchRef = useRef<number>(0)
  const FETCH_COOLDOWN_MS = 5000 // Minimum 5 seconds between fetches

  // Fetch market data from on-chain
  const fetchMarketData = useCallback(async () => {
    // Rate limiting: don't fetch if we just fetched recently
    const now = Date.now()
    if (now - lastFetchRef.current < FETCH_COOLDOWN_MS) {
      return
    }
    lastFetchRef.current = now

    setLoading(true)
    setError(null)

    // Default/fallback market data (shown when wallet not connected or on-chain fetch fails)
    const defaultMarket: MarketInfo = {
      marketPubkey: getLendingPoolPDA()[0].toString(),
      baseMint: 'USDC',
      tvl: '0',
      utilizationBps: 0,
      supplyApyBps: 450, // 4.5% (5% * 0.9 after 10% fee)
      borrowApyBps: 1000, // 10% APY
      paused: false,
    }

    // Try to fetch market data even if wallet is not connected (just need connection)
    if (!connection) {
      setMarkets([defaultMarket])
      setLoading(false)
      return
    }

    try {
      // Create a dummy wallet adapter for Anchor (we only need it for program initialization)
      // We can use a dummy public key since we're just reading data
      const dummyPublicKey = PublicKey.default
      const anchorWallet: AnchorWallet = {
        publicKey: dummyPublicKey,
        signTransaction: async (tx: any) => tx,
        signAllTransactions: async (txs: any[]) => txs,
      }

      const program = getLendingPoolProgram(connection, anchorWallet)
      const marketState = await getMarketState(program, connection)

      if (!marketState) {
        // Market not initialized on-chain yet, show default
        setMarkets([defaultMarket])
        setLoading(false)
        return
      }

      // Calculate utilization (as percentage 0-100)
      const utilization = calculateUtilization(
        marketState.totalBorrowed,
        marketState.totalLiquidity
      )

      // Calculate supply and borrow APY based on utilization
      const supplyAPY = calculateSupplyAPY(utilization, LENDING_YIELD_FEE_RATE)
      const borrowAPY = calculateBorrowAPY(utilization)

      // Helper function to map mint address to token symbol
      const getTokenSymbol = (mintAddress: string): string => {
        const usdcMint = SOLANA_TESTNET_CONFIG.TOKEN_ADDRESSES.USDC
        if (mintAddress === usdcMint) {
          return 'USDC'
        }
        // Default to USDC for lending pool (it's always USDC)
        return 'USDC'
      }

      // Create market info from on-chain data
      // Convert totalLiquidity from micro-USDC (1e6) to USDC
      const tvlInUSDC = marketState.totalLiquidity / 1e6
      
      const marketInfo: MarketInfo = {
        marketPubkey: getLendingPoolPDA()[0].toString(),
        baseMint: getTokenSymbol(marketState.usdcMint.toString()), // Map mint address to "USDC"
        tvl: tvlInUSDC.toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 2 }),
        utilizationBps: Math.round(utilization * 100), // Convert to basis points
        supplyApyBps: Math.round(supplyAPY * 100), // Convert to basis points (e.g., 4.5% = 450)
        borrowApyBps: Math.round(borrowAPY * 100), // Convert to basis points (e.g., 10% = 1000)
        paused: false,
      }

      setMarkets([marketInfo])
    } catch (err: any) {
      console.error('Error fetching market data:', err)
      setError(err.message || 'Failed to fetch market data')
      // Fallback to default market on error (so it still shows)
      setMarkets([defaultMarket])
    } finally {
      setLoading(false)
    }
  }, [connection, connected, publicKey])

  // Fetch user positions
  const fetchPositions = useCallback(async () => {
    const positionsList: LendingPosition[] = []

    // Load supply positions from localStorage (only if publicKey is available)
    if (publicKey) {
      try {
        const storedSupplyPositions = getLendingSupplyPositions()
          .filter(p => p.owner === publicKey.toString() && p.isOpen)
        
        // Get current market APY for interest calculation (use stored APY as fallback)
        const currentMarket = markets.length > 0 ? markets[0] : null
        const currentApy = currentMarket ? currentMarket.supplyApyBps / 100 : null
        
        // Calculate interest earned for each supply position
        const now = Date.now()
        for (const stored of storedSupplyPositions) {
          const timeElapsedSeconds = (now - stored.timestamp) / 1000
          const daysElapsed = timeElapsedSeconds / (24 * 60 * 60)
          
          // Use current market APY if available, otherwise use stored APY
          // stored.effectiveApy is stored as percentage (e.g., 4.5)
          const apyToUse = currentApy !== null && currentApy > 0 ? currentApy : (stored.effectiveApy || 4.5)
          const apyDecimal = apyToUse / 100 // Convert percentage to decimal
          const interestEarned = stored.suppliedAmount * apyDecimal * (daysElapsed / 365)
          
          positionsList.push({
            marketPubkey: stored.marketPubkey,
            baseMint: stored.baseMint,
            suppliedAmount: stored.suppliedAmount,
            interestEarned: Math.max(0, interestEarned),
            effectiveApy: apyToUse, // Keep as percentage for display (e.g., 4.5)
            borrowedAmount: undefined,
            borrowedInterest: undefined,
          })
        }
      } catch (err) {
        console.error('Error loading supply positions from localStorage:', err)
      }
    }

    // Fetch borrowed positions from on-chain
    if (connection && publicKey && connected) {
      try {
        const anchorWallet: AnchorWallet = {
          publicKey: publicKey,
          signTransaction: async (tx: any) => tx,
          signAllTransactions: async (txs: any[]) => txs,
        }

        const program = getLendingPoolProgram(connection, anchorWallet)
        
        // Fetch borrower account if user has borrowed
        const borrowerAccount = await getBorrowerAccount(program, publicKey, connection)

        if (borrowerAccount && borrowerAccount.amountBorrowed > 0) {
          const [poolPDA] = getLendingPoolPDA()
          positionsList.push({
            marketPubkey: poolPDA.toString(),
            baseMint: 'USDC',
            suppliedAmount: 0,
            interestEarned: 0,
            effectiveApy: 0,
            borrowedAmount: borrowerAccount.amountBorrowed,
            borrowedInterest: undefined,
          })
        }
      } catch (err: any) {
        console.error('Error fetching borrowed positions:', err)
        // Continue with supply positions even if borrowed fetch fails
      }
    }

    setPositions(positionsList)
  }, [connection, publicKey, connected, markets]) // Depend on markets to update APY when it changes

  // Initial fetch with debounce to avoid simultaneous requests
  useEffect(() => {
    const timer = setTimeout(() => {
      fetchMarketData()
      // Delay positions fetch slightly to avoid simultaneous requests
      setTimeout(() => {
        fetchPositions()
      }, 100)
    }, 100)
    
    return () => clearTimeout(timer)
  }, [fetchMarketData, fetchPositions])
  
  // Poll market data every 60 seconds (increased to reduce rate limit issues)
  useEffect(() => {
    const interval = setInterval(() => {
      fetchMarketData()
    }, 60000) // 60 seconds
    
    return () => clearInterval(interval)
  }, [fetchMarketData])

  // Supply USDC to lending pool
  const supply = useCallback(async (market: string, amount: string) => {
    if (!connection || !publicKey || !connected) {
      throw new Error('Wallet not connected')
    }

    const anchorWallet: AnchorWallet = {
      publicKey: publicKey,
      signTransaction: async (tx: any) => {
        // Use the wallet adapter's signTransaction
        return await signTransaction(tx)
      },
      signAllTransactions: async (txs: any[]) => {
        // Sign all transactions sequentially
        const signed = []
        for (const tx of txs) {
          signed.push(await signTransaction(tx))
        }
        return signed
      },
    }

    const program = getLendingPoolProgram(connection, anchorWallet)
    const [poolPDA] = getLendingPoolPDA()
    const [poolVaultPDA] = getPoolVaultPDA(poolPDA)

    // Get user USDC token account
    const usdcMint = new PublicKey(SOLANA_TESTNET_CONFIG.TOKEN_ADDRESSES.USDC)
    const userUsdcAccount = await getAssociatedTokenAddress(usdcMint, publicKey)

    const suppliedAmount = parseFloat(amount)

    try {
      // First, verify the pool exists and is initialized
      let poolExists = false
      try {
        const poolAccount = await connection.getAccountInfo(poolPDA)
        if (poolAccount && poolAccount.data.length > 0) {
          poolExists = true
        }
      } catch (poolError: any) {
        console.error('Error checking pool account:', poolError)
      }

      if (!poolExists) {
        throw new Error('Lending pool is not initialized. Please initialize the pool first.')
      }

      // Verify pool vault exists
      let vaultExists = false
      try {
        const vaultAccount = await connection.getAccountInfo(poolVaultPDA)
        if (vaultAccount && vaultAccount.data.length > 0) {
          vaultExists = true
        }
      } catch (vaultError: any) {
        console.error('Error checking vault account:', vaultError)
      }

      if (!vaultExists) {
        // Call initialize_vault instruction manually to avoid type issues
        try {
          const program = getLendingPoolProgram(connection, anchorWallet)
          const usdcMint = new PublicKey(SOLANA_TESTNET_CONFIG.TOKEN_ADDRESSES.USDC)
          
          // Build instruction manually - use snake_case method name from IDL
          const initializeVaultIx = await (program as any).methods
            .initializeVault() // Anchor converts snake_case to camelCase
            .accounts({
              pool: poolPDA,
              usdcMint: usdcMint,
              poolVault: poolVaultPDA,
              authority: publicKey,
              tokenProgram: TOKEN_PROGRAM_ID,
              rent: anchor.web3.SYSVAR_RENT_PUBKEY,
              systemProgram: anchor.web3.SystemProgram.programId,
            })
            .instruction()
          
          const initVaultTx = new Transaction().add(initializeVaultIx)
          const { blockhash } = await connection.getLatestBlockhash('confirmed')
          initVaultTx.recentBlockhash = blockhash
          initVaultTx.feePayer = publicKey
          
          const initTxSig = await sendTransaction(initVaultTx)
          
          // Wait for confirmation
          await connection.confirmTransaction(initTxSig, 'confirmed')
          
          // Wait a bit for the account to be available
          await new Promise(resolve => setTimeout(resolve, 1000))
        } catch (vaultInitError: any) {
          console.error('Error initializing vault:', vaultInitError)
          // If the method doesn't exist, try building the instruction manually
          if (vaultInitError.message?.includes('encode') || vaultInitError.message?.includes('undefined')) {
            // Build instruction manually using discriminator
            const INITIALIZE_VAULT_DISCRIMINATOR = Buffer.from([48, 191, 163, 44, 71, 129, 63, 164]) // From IDL
            
            const initVaultIx = new TransactionInstruction({
              keys: [
                { pubkey: poolPDA, isSigner: false, isWritable: false },
                { pubkey: usdcMint, isSigner: false, isWritable: false },
                { pubkey: poolVaultPDA, isSigner: false, isWritable: true },
                { pubkey: publicKey, isSigner: true, isWritable: true },
                { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
                { pubkey: anchor.web3.SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
                { pubkey: anchor.web3.SystemProgram.programId, isSigner: false, isWritable: false },
              ],
              programId: new PublicKey(SOLANA_TESTNET_PROGRAM_IDS.LENDING_POOL),
              data: INITIALIZE_VAULT_DISCRIMINATOR,
            })
            
            const initVaultTx = new Transaction().add(initVaultIx)
            const { blockhash } = await connection.getLatestBlockhash('confirmed')
            initVaultTx.recentBlockhash = blockhash
            initVaultTx.feePayer = publicKey
            
            const initTxSig = await sendTransaction(initVaultTx)
            
            // Wait for confirmation
            await connection.confirmTransaction(initTxSig, 'confirmed')
            
            // Wait a bit for the account to be available
            await new Promise(resolve => setTimeout(resolve, 1000))
          } else {
            throw new Error(`Failed to initialize pool vault: ${vaultInitError.message || vaultInitError}`)
          }
        }
      }
      // Check if token account exists, create if it doesn't
      let tokenAccountExists = false
      try {
        await getAccount(connection, userUsdcAccount)
        tokenAccountExists = true
      } catch (error: any) {
        if (error.name === 'TokenAccountNotFoundError' || 
            error.message?.includes('Account not found') ||
            error.message?.includes('could not find account')) {
          tokenAccountExists = false
        } else {
          throw error
        }
      }

      // If account doesn't exist, create it first in a separate transaction
      if (!tokenAccountExists) {
        const createAccountTx = new Transaction().add(
          createAssociatedTokenAccountIdempotentInstruction(
            publicKey,
            userUsdcAccount,
            publicKey,
            usdcMint,
            TOKEN_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID
          )
        )
        
        // Get recent blockhash (required for transaction)
        const { blockhash } = await connection.getLatestBlockhash('confirmed')
        createAccountTx.recentBlockhash = blockhash
        createAccountTx.feePayer = publicKey
        
        const createTxSig = await sendTransaction(createAccountTx)
        
        // Wait for account to be created and confirmed
        let accountReady = false
        let retries = 0
        while (retries < 20 && !accountReady) {
          await new Promise(resolve => setTimeout(resolve, 500))
          try {
            const account = await getAccount(connection, userUsdcAccount)
            if (account) {
              accountReady = true
            }
          } catch {
            retries++
          }
        }
        
        if (!accountReady) {
          throw new Error('Account creation timed out. Please try again.')
        }
      }

      // Now build the deposit transaction - account should exist now
      // Manually build the instruction to bypass Anchor's account resolution
      // This avoids the "Cannot read properties of undefined (reading 'size')" error
      const depositIx = buildDepositUsdcInstruction(
        new PublicKey(SOLANA_TESTNET_PROGRAM_IDS.LENDING_POOL),
        {
          pool: poolPDA,
          user: publicKey,
          userUsdcAccount,
          poolVault: poolVaultPDA,
          tokenProgram: TOKEN_PROGRAM_ID,
        },
        new anchor.BN(Math.floor(suppliedAmount * 1e6))
      )

      // Create transaction and send
      const depositTransaction = new Transaction().add(depositIx)
      
      // Get recent blockhash (required for transaction)
      const { blockhash } = await connection.getLatestBlockhash('confirmed')
      depositTransaction.recentBlockhash = blockhash
      depositTransaction.feePayer = publicKey
      
      const tx = await sendTransaction(depositTransaction)
      
      window.dispatchEvent(new CustomEvent('refreshUSDCBalance'))

      // Save supply position to localStorage
      if (publicKey) {
        const [poolPDA] = getLendingPoolPDA()
        const marketState = await getMarketState(
          getLendingPoolProgram(connection, {
            publicKey: publicKey,
            signTransaction: async (tx: any) => tx,
            signAllTransactions: async (txs: any[]) => txs,
          }),
          connection
        )
        
        // Calculate utilization and APY
        const utilization = marketState
          ? calculateUtilization(marketState.totalBorrowed, marketState.totalLiquidity)
          : 0
        const supplyAPY = marketState
          ? calculateSupplyAPY(utilization, LENDING_YIELD_FEE_RATE) * 100
          : 4.5 // Default 4.5% APY
        
        const storedPositions = getLendingSupplyPositions()
        const newPosition: StoredLendingSupplyPosition = {
          id: `${publicKey.toString()}-${poolPDA.toString()}-${Date.now()}`,
          owner: publicKey.toString(),
          marketPubkey: poolPDA.toString(),
          baseMint: 'USDC',
          suppliedAmount: suppliedAmount,
          timestamp: Date.now(),
          effectiveApy: supplyAPY,
          isOpen: true,
        }
        
        storedPositions.push(newPosition)
        setLendingSupplyPositions(storedPositions)
      }

      // Refresh market data after supply
      await fetchMarketData()
      await fetchPositions()

      return { success: true, tx }
    } catch (err: any) {
      console.error('Supply error:', err)
      console.error('Error details:', {
        message: err.message,
        logs: err.logs,
        code: err.code,
        name: err.name,
        stack: err.stack
      })
      
      // Check if it's the account size error - provide better message
      if (err.message?.includes('size') || err.message?.includes('undefined') || err.message?.includes('Cannot read properties')) {
        throw new Error('Token account error. Please ensure you have USDC in your wallet and try again.')
      }
      
      // Check for account deserialization error (account structure mismatch)
      if (err.message?.includes('AccountDidNotDeserialize') || 
          err.message?.includes('Failed to deserialize') ||
          err.code === 3003 ||
          (err.logs && err.logs.some((log: string) => log.includes('AccountDidNotDeserialize')))) {
        throw new Error('Lending pool account structure mismatch. The pool was initialized with an older program version. Please re-initialize the pool by running: ts-node scripts/init-lending-pool.ts')
      }
      
      // Check if pool is not initialized
      if (err.message?.includes('Account does not exist') || err.message?.includes('could not find account') || err.code === 1100) {
        throw new Error('Lending pool is not initialized. Please run: ts-node scripts/init-lending-pool.ts')
      }
      
      // Check if pool is paused
      if (err.message?.includes('PoolPaused') || err.message?.includes('paused')) {
        throw new Error('Lending pool is currently paused.')
      }
      
      // Check if insufficient balance
      if (err.message?.includes('insufficient') || err.message?.includes('balance')) {
        throw new Error('Insufficient USDC balance. Please ensure you have enough USDC in your wallet.')
      }
      
      // Provide the actual error message
      throw new Error(err.message || err.toString() || 'Supply failed. Please check the console for details.')
    }
  }, [connection, publicKey, connected, sendTransaction, fetchMarketData, fetchPositions])

  // Withdraw from lending pool
  // Note: Withdraw functionality requires receipt token balance tracking
  // This is a planned feature - receipt tokens are minted on supply and burned on withdraw
  const withdraw = useCallback(async (_market: string, _amount: string) => {
    throw new Error('Withdraw not yet implemented - requires receipt token tracking')
  }, [])

  // Borrow USDC from lending pool
  const borrow = useCallback(async (amount: number) => {
    if (!connection || !publicKey || !connected) {
      throw new Error('Wallet not connected')
    }

    const anchorWallet: AnchorWallet = {
      publicKey: publicKey,
      signTransaction: async (tx: any) => tx,
      signAllTransactions: async (txs: any[]) => txs,
    }

    const program = getLendingPoolProgram(connection, anchorWallet)
    const [poolPDA, poolBump] = getLendingPoolPDA()
    const [borrowerPDA] = getBorrowerAccountPDA(publicKey)
    const [poolVaultPDA] = getPoolVaultPDA(poolPDA)

    // Get user USDC token account
    const usdcMint = new PublicKey(SOLANA_TESTNET_CONFIG.TOKEN_ADDRESSES.USDC)
    const borrowerUsdcAccount = await getAssociatedTokenAddress(usdcMint, publicKey)

    try {
      const tx = await (program as any).methods
        .borrowUsdc(new anchor.BN(Math.floor(amount * 1e6))) // Convert to USDC decimals
        .accounts({
          pool: poolPDA,
          borrower: publicKey,
          borrowerAccount: borrowerPDA,
          poolVault: poolVaultPDA,
          borrowerUsdcAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc()

      await fetchPositions()
      return { success: true, tx }
    } catch (err: any) {
      console.error('Borrow error:', err)
      throw new Error(err.message || 'Borrow failed')
    }
  }, [connection, publicKey, connected, fetchPositions])

  // Repay borrowed USDC
  const repay = useCallback(async (amount: number) => {
    if (!connection || !publicKey || !connected) {
      throw new Error('Wallet not connected')
    }

    const anchorWallet: AnchorWallet = {
      publicKey: publicKey,
      signTransaction: async (tx: any) => tx,
      signAllTransactions: async (txs: any[]) => txs,
    }

    const program = getLendingPoolProgram(connection, anchorWallet)
    const [poolPDA] = getLendingPoolPDA()
    const [borrowerPDA] = getBorrowerAccountPDA(publicKey)
    const [poolVaultPDA] = getPoolVaultPDA(poolPDA)

    // Get user USDC token account
    const usdcMint = new PublicKey(SOLANA_TESTNET_CONFIG.TOKEN_ADDRESSES.USDC)
    const borrowerUsdcAccount = await getAssociatedTokenAddress(usdcMint, publicKey)

    try {
      const tx = await (program as any).methods
        .repayUsdc(new anchor.BN(Math.floor(amount * 1e6))) // Convert to USDC decimals
        .accounts({
          pool: poolPDA,
          borrower: publicKey,
          borrowerAccount: borrowerPDA,
          borrowerUsdcAccount,
          poolVault: poolVaultPDA,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc()

      await fetchPositions()
      return { success: true, tx }
    } catch (err: any) {
      console.error('Repay error:', err)
      throw new Error(err.message || 'Repay failed')
    }
  }, [connection, publicKey, connected, fetchPositions])

  const value = useMemo(() => ({ 
    markets, 
    loading, 
    error, 
    supply, 
    withdraw, 
    borrow,
    repay,
    positions,
    refresh: fetchMarketData,
  }), [markets, loading, error, supply, withdraw, borrow, repay, positions, fetchMarketData])
  
  return value
}
