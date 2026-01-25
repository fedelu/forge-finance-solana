import { useState, useEffect, useCallback, useRef } from 'react'
import { PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY, Transaction, TransactionInstruction } from '@solana/web3.js'
import { SOLANA_TESTNET_PROGRAM_IDS } from '../config/solana-testnet'
import { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddress, createAssociatedTokenAccountIdempotentInstruction, getAccount, Account } from '@solana/spl-token'
import * as anchor from '@coral-xyz/anchor'
import { BN } from '@coral-xyz/anchor'
import { useWallet } from '../contexts/WalletContext'
import { usePrice } from '../contexts/PriceContext'
import { getCruciblesProgram, AnchorWallet } from '../utils/anchorProgram'
import { fetchCrucibleDirect } from '../utils/crucibleFetcher'
import { deriveCruciblePDA, deriveVaultPDA, deriveLPPositionPDA, deriveUSDCVaultPDA, deriveCrucibleAuthorityPDA } from '../utils/cruciblePdas'
import { SOLANA_TESTNET_CONFIG, DEPLOYED_ACCOUNTS } from '../config/solana-testnet'
import { INFERNO_CLOSE_FEE_RATE, INFERNO_YIELD_FEE_RATE } from '../config/fees'
import { formatUSD, formatUSDC, formatSOL } from '../utils/math'
import { getLPPositions, setLPPositions, type StoredLPPosition } from '../utils/localStorage'

export interface LPPosition {
  id: string
  owner: string
  baseToken: 'SOL'
  baseAmount: number // Amount of base token deposited
  usdcAmount: number // Amount of USDC deposited
  entryPrice: number
  entryExchangeRate: number // Crucible exchange rate at position open (scaled)
  currentValue: number // USD
  yieldEarned: number // Real yield from exchange rate growth
  isOpen: boolean
  lpAPY: number // LP APY = baseAPY (matches contract, no 3x multiplier)
  pnl: number // Profit and Loss (USD)
  nonce: number // Position nonce for PDA derivation (allows multiple positions)
}

interface UseLPProps {
  crucibleAddress: string
  baseTokenSymbol: 'SOL'
  baseAPY: number // Base APY for calculating LP APY (matches contract calculation)
}

export function useLP({ crucibleAddress, baseTokenSymbol, baseAPY }: UseLPProps) {
  const { solPrice } = usePrice();
  // Check wallet connection
  let walletContext: any = null
  // Using Solana devnet directly
  const sessionContext: any = null
  
  try {
    walletContext = useWallet()
  } catch (e) {
    // WalletContext not available
  }

  let publicKey: PublicKey | null = null
  
  if (sessionContext?.walletPublicKey) {
    if (sessionContext.walletPublicKey instanceof PublicKey) {
      publicKey = sessionContext.walletPublicKey
    } else if (typeof sessionContext.walletPublicKey === 'string') {
      try {
        publicKey = new PublicKey(sessionContext.walletPublicKey)
      } catch (e) {
        console.warn('Invalid public key from wallet:', e)
      }
    }
  } else if (walletContext?.publicKey) {
    publicKey = walletContext.publicKey
  }
  
  const sendTransaction: ((tx: any) => Promise<string>) | undefined = 
    walletContext?.sendTransaction || sessionContext?.sendTransaction
  const connection: any = walletContext?.connection || null

  const [positions, setPositions] = useState<LPPosition[]>([])
  const [loading, setLoading] = useState(false)
  
  // Use ref to store latest fetchPositions callback
  const fetchPositionsRef = useRef<(() => Promise<void>) | null>(null)

  // Maximum number of positions to scan for (prevents infinite loops)
  const MAX_POSITIONS_TO_SCAN = 50

  // Fetch LP positions - now scans for multiple positions using nonce
  const fetchPositions = useCallback(async () => {
    if (!publicKey || !crucibleAddress) {
      setPositions([])
      return
    }

    try {
      setLoading(true)
      const userPositions: LPPosition[] = []
      let fetchedFromChain = false
      
      // PRIORITY 1: Fetch from on-chain
      if (walletContext?.connection && crucibleAddress) {
        try {
          const connection = walletContext.connection
          const anchorWallet: AnchorWallet = {
            publicKey: publicKey,
            signTransaction: walletContext?.signTransaction || (async (tx: any) => tx),
            signAllTransactions: walletContext?.signAllTransactions || (async (txs: any[]) => txs),
          }
          const program = getCruciblesProgram(connection, anchorWallet)
          if (!crucibleAddress || typeof crucibleAddress !== 'string' || crucibleAddress.trim() === '') {
            // Skip silently if no valid address - this is expected when crucible data isn't loaded yet
            return
          }
          let cruciblePDA: PublicKey
          try {
            cruciblePDA = new PublicKey(crucibleAddress)
          } catch (e) {
            // Skip silently if address is invalid - this is expected when crucible data isn't loaded yet
            return
          }
          
          const baseMint = new PublicKey(SOLANA_TESTNET_CONFIG.TOKEN_ADDRESSES.SOL)

          // Fetch crucible to get current exchange rate for real yield calculation
          let currentExchangeRate = 1.0
          try {
            const { getAccurateExchangeRate } = await import('../utils/crucibleFetcher')
            const crucibleAccount = await fetchCrucibleDirect(connection, cruciblePDA.toString())
            if (crucibleAccount) {
              currentExchangeRate = getAccurateExchangeRate(crucibleAccount)
            }
          } catch (e) {
            console.warn('Failed to fetch crucible for yield calculation:', e)
          }

          // Scan for multiple positions using nonce (0, 1, 2, ...)
          // Stop scanning after MAX_POSITIONS_TO_SCAN consecutive empty slots
          let consecutiveEmpty = 0
          for (let nonce = 0; nonce < MAX_POSITIONS_TO_SCAN && consecutiveEmpty < 5; nonce++) {
            // Derive position PDA using base_mint and nonce (matches new program seeds)
            const [positionPDA] = deriveLPPositionPDA(publicKey, baseMint, nonce)
            
            // Try to fetch position account
            try {
              const positionAccount = await (program.account as any).lppositionAccount.fetch(positionPDA)
              consecutiveEmpty = 0 // Reset counter on found position
              
              if (positionAccount.isOpen) {
                // Convert on-chain position to LPPosition interface
                const baseTokenPrice = solPrice || 200 // Use real-time SOL price from CoinGecko, fallback to $200
                const baseAmountNum = Number(positionAccount.baseAmount) / 1e9 // Convert lamports
                const usdcAmountNum = Number(positionAccount.usdcAmount) / 1e6 // Convert USDC decimals
                const entryExchangeRate = Number(positionAccount.entryExchangeRate || 1_000_000) / 1_000_000 // Convert from scaled
                
                // Calculate real yield from exchange rate growth
                let yieldEarned = 0
                if (currentExchangeRate > entryExchangeRate && entryExchangeRate > 0) {
                  const positionValue = baseAmountNum * baseTokenPrice + usdcAmountNum
                  const rateGrowth = (currentExchangeRate - entryExchangeRate) / entryExchangeRate
                  yieldEarned = positionValue * rateGrowth
                }
                
                // Calculate P&L from price changes
                const entryPriceNum = Number(positionAccount.entryPrice) / 1_000_000
                const initialValue = baseAmountNum * entryPriceNum + usdcAmountNum
                const currentValue = baseAmountNum * baseTokenPrice + usdcAmountNum
                const pricePnl = currentValue - initialValue
                
                // Get nonce from account (new field) or use loop index
                const positionNonce = typeof positionAccount.nonce === 'number' 
                  ? Number(positionAccount.nonce) 
                  : nonce
                
                const onChainPosition: LPPosition = {
                  id: positionPDA.toString(), // Use PDA as ID for consistency
                  owner: positionAccount.owner.toBase58(),
                  baseToken: baseTokenSymbol,
                  baseAmount: baseAmountNum,
                  usdcAmount: usdcAmountNum,
                  entryPrice: entryPriceNum,
                  entryExchangeRate: entryExchangeRate,
                  currentValue: currentValue,
                  yieldEarned: yieldEarned, // Real yield from exchange rate growth
                  isOpen: positionAccount.isOpen,
                  lpAPY: baseAPY, // Matches contract: LP APY = base APY (no 3x multiplier)
                  pnl: pricePnl + yieldEarned, // Total P&L = price P&L + yield
                  nonce: positionNonce, // Store nonce for closing position
                }
                
                userPositions.push(onChainPosition)
                fetchedFromChain = true
              }
            } catch (fetchError: any) {
              // Position doesn't exist on-chain at this nonce
              consecutiveEmpty++
              if (!(fetchError?.message?.includes('Account does not exist') || 
                  fetchError?.message?.includes('could not find') ||
                  fetchError?.toString()?.includes('Account does not exist'))) {
                // Only log if it's not a "not found" error
                console.warn(`Error fetching LP position at nonce ${nonce}:`, fetchError)
              }
            }
          }
          
          // Update localStorage cache with on-chain data
          if (userPositions.length > 0) {
            try {
              const allStoredPositions = getLPPositions()
              const walletAddress = publicKey.toBase58()
              
              // Remove old positions for this wallet and add new ones
              const otherPositions = allStoredPositions.filter((p: StoredLPPosition) => 
                p.owner !== walletAddress && p.owner !== publicKey.toString()
              )
              setLPPositions([...otherPositions, ...userPositions as StoredLPPosition[]])
            } catch (cacheError) {
              console.warn('Failed to update localStorage cache:', cacheError)
            }
          }
        } catch (programError) {
          console.warn('Failed to initialize program for on-chain LP fetch:', programError)
        }
      }
      
      // PRIORITY 2: Fallback to localStorage ONLY if no connection available
      if (!fetchedFromChain && !walletContext?.connection) {
        try {
          // SECURITY FIX: Use secure localStorage utility
          const cachedPositions = getLPPositions()
          const walletAddress = publicKey.toBase58()
          
          const filteredPositions = cachedPositions.filter((p: StoredLPPosition) => {
            const ownerMatch = p.owner === walletAddress || p.owner === publicKey.toString()
            const tokenMatch = p.baseToken === baseTokenSymbol
            const isOpen = p.isOpen === true
            return ownerMatch && tokenMatch && isOpen
          })
          
          // Add default nonce if missing
          const positionsWithNonce = filteredPositions.map((p, index) => ({
            ...p,
            nonce: p.nonce ?? index
          }))
          
          userPositions.push(...positionsWithNonce as LPPosition[])
        } catch (e) {
          console.warn('Failed to load LP positions from localStorage cache:', e)
        }
      }
      
      setPositions(userPositions)
    } catch (error) {
      console.error('Error fetching LP positions:', error)
      setPositions([])
    } finally {
      setLoading(false)
    }
  }, [publicKey?.toBase58(), walletContext?.connection, crucibleAddress, baseTokenSymbol, baseAPY, solPrice])

  // Open LP position (deposit equal value of base token + USDC)
  const openPosition = useCallback(
    async (baseAmount: number, usdcAmount: number) => {
      let currentPublicKey: PublicKey | null = null
      
      if (sessionContext?.walletPublicKey) {
        try {
          if (sessionContext.walletPublicKey instanceof PublicKey) {
            currentPublicKey = sessionContext.walletPublicKey
          } else if (typeof sessionContext.walletPublicKey === 'string') {
            currentPublicKey = new PublicKey(sessionContext.walletPublicKey)
          } else if (typeof sessionContext.walletPublicKey === 'object' && sessionContext.walletPublicKey !== null) {
            if ('_bn' in sessionContext.walletPublicKey || 'toBase58' in sessionContext.walletPublicKey || 'toString' in sessionContext.walletPublicKey) {
              const pkString = sessionContext.walletPublicKey.toString ? sessionContext.walletPublicKey.toString() : 
                              sessionContext.walletPublicKey.toBase58 ? sessionContext.walletPublicKey.toBase58() : 
                              String(sessionContext.walletPublicKey)
              currentPublicKey = new PublicKey(pkString)
            }
          }
        } catch (e) {
          console.warn('Error parsing session wallet public key (LP):', e)
        }
      }
      
      if (!currentPublicKey && publicKey) {
        currentPublicKey = publicKey
      }
      
      if (!currentPublicKey && walletContext?.publicKey) {
        currentPublicKey = walletContext.publicKey
      }
      
      if (!currentPublicKey) {
        throw new Error('Wallet not connected. Please connect your wallet first.')
      }
      
      if (!crucibleAddress) {
        throw new Error('Crucible information missing')
      }

      // Validate equal value (within 1% tolerance)
      const baseTokenPrice = solPrice // Use real-time SOL price from CoinGecko
      const baseValue = baseAmount * baseTokenPrice
      const usdcValue = usdcAmount
      const tolerance = Math.max(baseValue, usdcValue) * 0.01 // 1% tolerance

      if (Math.abs(baseValue - usdcValue) > tolerance) {
        throw new Error(`Amounts must be equal value. Base value: $${formatUSD(baseValue)}, USDC value: $${formatUSD(usdcValue)}`)
      }

      setLoading(true)
      try {
        if (!walletContext?.connection || !crucibleAddress) {
          throw new Error('Wallet or crucible information missing')
        }

        const connection = walletContext.connection
        
        // Get Anchor program instance
        const anchorWallet: AnchorWallet = {
          publicKey: currentPublicKey,
          signTransaction: walletContext?.signTransaction || (async (tx: any) => tx),
          signAllTransactions: walletContext?.signAllTransactions || (async (txs: any[]) => txs),
        }
        const program = getCruciblesProgram(connection, anchorWallet)
        
        // Derive PDAs
        const baseMint = new PublicKey(SOLANA_TESTNET_CONFIG.TOKEN_ADDRESSES.SOL) // WSOL
        const [crucibleAccountPDA] = deriveCruciblePDA(baseMint)
        
        // Always use the derived crucible PDA to ensure correctness
        // The crucibleAddress prop might be invalid or empty, so we derive it from baseMint
        const cruciblePDA = crucibleAccountPDA
        
        console.log('Using crucible PDA:', cruciblePDA.toString())
        
        // First, verify the crucible account exists
        console.log('Checking if crucible account exists:', cruciblePDA.toString())
        let crucibleAccountInfo
        try {
          crucibleAccountInfo = await connection.getAccountInfo(cruciblePDA)
          if (!crucibleAccountInfo) {
            const errorMsg = `Crucible account not found at ${cruciblePDA.toString()}.\n\nTo initialize the crucible, run:\n\nts-node scripts/init-sol-crucible.ts --treasury 9VbGJDCXshKXfhA6J2TJv53RpQQeVFocXp2gNuxUxioW\n\nThis will create the crucible with LP token support.`
            alert(errorMsg)
            throw new Error(errorMsg)
          }
          console.log('Crucible account found, size:', crucibleAccountInfo.data.length)
        } catch (error: any) {
          if (error.message?.includes('not found') || error.message?.includes('Account does not exist') || !crucibleAccountInfo) {
            const errorMsg = `Crucible account not found at ${cruciblePDA.toString()}.\n\nTo initialize the crucible, run:\n\nts-node scripts/init-sol-crucible.ts --treasury 9VbGJDCXshKXfhA6J2TJv53RpQQeVFocXp2gNuxUxioW\n\nThis will create the crucible with LP token support.`
            alert(errorMsg)
            throw new Error(errorMsg)
          }
          throw error
        }

        // Fetch crucible account to get treasury, oracle, and LP token mint (using direct fetcher)
        let treasuryBase: PublicKey
        let treasuryUSDC: PublicKey
        let oracleAccount: PublicKey | null = null
        let lpTokenMint: PublicKey
        try {
          const crucibleAccount = await fetchCrucibleDirect(connection, cruciblePDA.toString())
          if (!crucibleAccount) {
            const errorMsg = `Crucible account not found at ${cruciblePDA.toString()}.\n\nTo initialize, run:\nts-node scripts/init-sol-crucible.ts --treasury 9VbGJDCXshKXfhA6J2TJv53RpQQeVFocXp2gNuxUxioW`
            alert(errorMsg)
            throw new Error(errorMsg)
          }
          console.log('Crucible account data fetched successfully')
          treasuryBase = crucibleAccount.treasury
          // Use separate USDC treasury from config (crucible treasury is for base token only)
          treasuryUSDC = new PublicKey(DEPLOYED_ACCOUNTS.USDC_TREASURY)
          lpTokenMint = crucibleAccount.lpTokenMint
          console.log('LP Token Mint:', lpTokenMint.toString())
          
          // Check if this is an old crucible without LP token mint (backward compatibility)
          // Old crucibles will have lpTokenMint set to ctokenMint as a placeholder
          const isOldCrucible = lpTokenMint.equals(crucibleAccount.ctokenMint)
          
          if (isOldCrucible) {
            // Old format crucible: use the manually created LP token mint
            // The program will accept the passed LP token mint even though it's not in the crucible account
            console.log('⚠️  Old format crucible detected. Using manually created LP token mint.')
            
            // Use the LP token mint we created: 8QkQFThfUkoriJfWFnWE6nf3oHM8mMWedN4vC8PAZUmy
            const MANUAL_LP_TOKEN_MINT = new PublicKey('8QkQFThfUkoriJfWFnWE6nf3oHM8mMWedN4vC8PAZUmy')
            lpTokenMint = MANUAL_LP_TOKEN_MINT
            console.log('Using manual LP token mint:', lpTokenMint.toString())
            
            // Verify the manual LP token mint exists and is valid
            try {
              const lpMintAccountInfo = await connection.getAccountInfo(lpTokenMint)
              if (!lpMintAccountInfo) {
                const errorMsg = `Manual LP token mint not found. Please run: ts-node scripts/create-lp-token-mint.ts`
                alert(errorMsg)
                throw new Error(errorMsg)
              }
              
              const TOKEN_PROGRAM_ID_STR = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
              if (lpMintAccountInfo.owner.toString() !== TOKEN_PROGRAM_ID_STR) {
                const errorMsg = `Manual LP token mint is not a valid mint account. Please run: ts-node scripts/create-lp-token-mint.ts`
                alert(errorMsg)
                throw new Error(errorMsg)
              }
              
              console.log('✅ Manual LP token mint verified, size:', lpMintAccountInfo.data.length)
            } catch (error: any) {
              if (error.message?.includes('not found') || error.message?.includes('not a valid mint')) {
                throw error
              }
              throw error
            }
          } else {
            // New format: verify LP token mint account exists and is initialized as a mint
            try {
              const lpMintAccountInfo = await connection.getAccountInfo(lpTokenMint)
              if (!lpMintAccountInfo) {
                const errorMsg = `LP token mint account not found at ${lpTokenMint.toString()}.\n\nThe crucible references an LP token mint that doesn't exist.\n\nThis crucible was initialized before LP token mint support was added.\n\nTo fix this, re-initialize the crucible:\nts-node scripts/init-sol-crucible.ts --treasury 9VbGJDCXshKXfhA6J2TJv53RpQQeVFocXp2gNuxUxioW`
                alert(errorMsg)
                throw new Error(errorMsg)
              }
              
              // Verify it's owned by the Token Program (indicates it's a mint account)
              const TOKEN_PROGRAM_ID_STR = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
              if (lpMintAccountInfo.owner.toString() !== TOKEN_PROGRAM_ID_STR) {
                const errorMsg = `LP token mint account at ${lpTokenMint.toString()} is not a valid mint account.\n\nThe account exists but is not initialized as a token mint.\n\nThis crucible was initialized before LP token mint support was added.\n\nTo fix this, re-initialize the crucible:\nts-node scripts/init-sol-crucible.ts --treasury 9VbGJDCXshKXfhA6J2TJv53RpQQeVFocXp2gNuxUxioW`
                alert(errorMsg)
                throw new Error(errorMsg)
              }
              
              // Verify account size matches mint account size (82 bytes for a mint)
              if (lpMintAccountInfo.data.length < 82) {
                const errorMsg = `LP token mint account at ${lpTokenMint.toString()} is not properly initialized.\n\nAccount size is ${lpMintAccountInfo.data.length} bytes, expected at least 82 bytes for a mint account.\n\nThis crucible was initialized before LP token mint support was added.\n\nTo fix this, re-initialize the crucible:\nts-node scripts/init-sol-crucible.ts --treasury 9VbGJDCXshKXfhA6J2TJv53RpQQeVFocXp2gNuxUxioW`
                alert(errorMsg)
                throw new Error(errorMsg)
              }
              
              console.log('LP token mint account verified, size:', lpMintAccountInfo.data.length)
            } catch (error: any) {
              if (error.message?.includes('not found') || error.message?.includes('Account does not exist') || error.message?.includes('not a valid mint') || error.message?.includes('not properly initialized')) {
                // Error message already set above
                throw error
              }
              throw error
            }
          }
          
          if (crucibleAccount.oracle) {
            oracleAccount = crucibleAccount.oracle
          }
        } catch (error: any) {
          console.error('Error fetching crucible account data:', error)
          // Check for AccountDidNotDeserialize error (old format)
          if (error.error?.errorCode?.code === 'AccountDidNotDeserialize' || 
              error.error?.errorCode?.code === 3003 ||
              error.error?.errorMessage?.includes('AccountDidNotDeserialize') ||
              error.error?.errorMessage?.includes('Failed to deserialize') ||
              error.message?.includes('AccountDidNotDeserialize') ||
              error.message?.includes('Failed to deserialize')) {
            const errorMsg = `Crucible account exists but is in an old format that cannot be deserialized.\n\nThis crucible was initialized before the current program version.\n\nTo fix this, you need to re-initialize the crucible:\n1. Close any existing positions\n2. Run: ts-node scripts/init-sol-crucible.ts --treasury 9VbGJDCXshKXfhA6J2TJv53RpQQeVFocXp2gNuxUxioW\n\nNote: This will create a new crucible with the updated format.`
            alert(errorMsg)
            throw new Error(errorMsg)
          }
          if (error.message?.includes('not found') || error.message?.includes('Account does not exist') || error.message?.includes('offset')) {
            const errorMsg = `Crucible account not found or not initialized at ${cruciblePDA.toString()}.\n\nTo initialize, run:\nts-node scripts/init-sol-crucible.ts --treasury 9VbGJDCXshKXfhA6J2TJv53RpQQeVFocXp2gNuxUxioW`
            alert(errorMsg)
            throw new Error(errorMsg)
          }
          throw error
        }
        
        // Derive vault PDAs
        const [baseVaultPDA] = deriveVaultPDA(cruciblePDA)
        const [usdcVaultPDA, usdcVaultBump] = deriveUSDCVaultPDA(cruciblePDA)
        
        // Find the next available nonce for a new position
        // This allows multiple positions per user (like cToken minting)
        let positionNonce = 0
        let positionPDA: PublicKey
        let positionBump: number
        
        // Scan for the first available nonce (empty slot)
        for (let nonce = 0; nonce < MAX_POSITIONS_TO_SCAN; nonce++) {
          const [candidatePDA, candidateBump] = deriveLPPositionPDA(currentPublicKey, baseMint, nonce)
          try {
            // Check if account exists at this nonce
            const accountInfo = await connection.getAccountInfo(candidatePDA)
            if (!accountInfo) {
              // Found an empty slot - use this nonce
              positionNonce = nonce
              positionPDA = candidatePDA
              positionBump = candidateBump
              console.log(`Found available nonce: ${nonce}, PDA: ${candidatePDA.toString()}`)
              break
            }
            // Account exists, try next nonce
          } catch (e) {
            // Error checking account - assume empty and use this nonce
            positionNonce = nonce
            positionPDA = candidatePDA
            positionBump = candidateBump
            break
          }
        }
        
        // Fallback if no nonce found in loop (shouldn't happen normally)
        if (!positionPDA!) {
          const [fallbackPDA, fallbackBump] = deriveLPPositionPDA(currentPublicKey, baseMint, 0)
          positionPDA = fallbackPDA
          positionBump = fallbackBump
          positionNonce = 0
        }
        
        console.log(`Using nonce ${positionNonce} for new LP position, PDA: ${positionPDA.toString()}`)
        
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/fdff7e9f-5404-4480-bac7-c940d759c957',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'useLP.ts:348',message:'Position PDA derivation',data:{positionPDA: positionPDA.toString(), positionBump, positionNonce, user: currentPublicKey.toString(), baseMint: baseMint.toString(), cruciblePDA: cruciblePDA.toString()},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'F'})}).catch(()=>{});
        // #endregion
        
        // CRITICAL: crucible_authority has the SAME seeds as crucible: ["crucible", base_mint]
        // They resolve to the SAME PDA, so we use the same value for both
        // This prevents Anchor from trying to auto-resolve crucible_authority which can fail
        // when crucible is UncheckedAccount
        const [crucibleAuthorityPDA, crucibleAuthorityBump] = deriveCrucibleAuthorityPDA(baseMint)
        
        // Verify crucible and crucible_authority are the same PDA (they should be)
        if (!cruciblePDA.equals(crucibleAuthorityPDA)) {
          throw new Error(`Crucible PDA mismatch: crucible=${cruciblePDA.toString()}, crucible_authority=${crucibleAuthorityPDA.toString()}`)
        }
        
        console.log('✅ Crucible and crucible_authority are the same PDA:', cruciblePDA.toString(), 'bump:', crucibleAuthorityBump)
        
        // Get user token accounts
        const usdcMint = new PublicKey(SOLANA_TESTNET_CONFIG.TOKEN_ADDRESSES.USDC)
        const userBaseTokenAccount = await getAssociatedTokenAddress(baseMint, currentPublicKey)
        const userUsdcAccount = await getAssociatedTokenAddress(usdcMint, currentPublicKey)
        const userLpTokenAccount = await getAssociatedTokenAddress(lpTokenMint, currentPublicKey)
        
        // Check and create token accounts if they don't exist
        // We'll add instructions to create them in the transaction if needed
        const accountCreationInstructions: TransactionInstruction[] = []
        
        // Check base token account
        try {
          await getAccount(connection, userBaseTokenAccount)
        } catch (error: any) {
          if (error.name === 'TokenAccountNotFoundError' || error.message?.includes('could not find')) {
            console.log('Will create base token account:', userBaseTokenAccount.toString())
            accountCreationInstructions.push(
              createAssociatedTokenAccountIdempotentInstruction(
                currentPublicKey, // payer
                userBaseTokenAccount, // associatedToken
                currentPublicKey, // owner
                baseMint, // mint
                TOKEN_PROGRAM_ID,
                ASSOCIATED_TOKEN_PROGRAM_ID
              )
            )
          }
        }
        
        // Check USDC account
        try {
          await getAccount(connection, userUsdcAccount)
        } catch (error: any) {
          if (error.name === 'TokenAccountNotFoundError' || error.message?.includes('could not find')) {
            console.log('Will create USDC token account:', userUsdcAccount.toString())
            accountCreationInstructions.push(
              createAssociatedTokenAccountIdempotentInstruction(
                currentPublicKey, // payer
                userUsdcAccount, // associatedToken
                currentPublicKey, // owner
                usdcMint, // mint
                TOKEN_PROGRAM_ID,
                ASSOCIATED_TOKEN_PROGRAM_ID
              )
            )
          }
        }
        
        // Check LP token account
        try {
          await getAccount(connection, userLpTokenAccount)
        } catch (error: any) {
          if (error.name === 'TokenAccountNotFoundError' || error.message?.includes('could not find')) {
            console.log('Will create LP token account:', userLpTokenAccount.toString())
            accountCreationInstructions.push(
              createAssociatedTokenAccountIdempotentInstruction(
                currentPublicKey, // payer
                userLpTokenAccount, // associatedToken
                currentPublicKey, // owner
                lpTokenMint, // mint
                TOKEN_PROGRAM_ID,
                ASSOCIATED_TOKEN_PROGRAM_ID
              )
            )
          }
        }
        
        // Check if USDC vault exists, if not provide clear error
        try {
          const usdcVaultAccount = await getAccount(connection, usdcVaultPDA)
          console.log('USDC vault account exists:', usdcVaultAccount.address.toString())
        } catch (error: any) {
          if (error.name === 'TokenAccountNotFoundError' || error.message?.includes('could not find')) {
            const errorMsg = `USDC vault account not initialized at ${usdcVaultPDA.toString()}.\n\nThe crucible was initialized before USDC vault support was added.\n\nTo fix this:\n1. Rebuild and redeploy the program: anchor build && anchor deploy\n2. Re-run the initialization script (it will skip if crucible exists but create the USDC vault):\n   ts-node scripts/init-sol-crucible.ts --treasury 9VbGJDCXshKXfhA6J2TJv53RpQQeVFocXp2gNuxUxioW\n\nNote: The updated program will automatically create the USDC vault during initialization.`
            alert(errorMsg)
            throw new Error(errorMsg)
          }
          throw error
        }
        
        // Check if USDC treasury account exists
        // The USDC treasury should be an associated token account for USDC
        // Derive it from the WSOL treasury owner (the wallet that owns the WSOL treasury tokens)
        let usdcTreasuryAccount: Account | null = null
        try {
          // First, get the WSOL treasury account to find its owner (the wallet that controls the tokens)
          const wsolTreasury = new PublicKey(DEPLOYED_ACCOUNTS.WSOL_TREASURY)
          const wsolTreasuryAccount = await getAccount(connection, wsolTreasury)
          // The 'owner' field of a TokenAccount is the wallet that owns/controls the tokens
          const treasuryOwner = wsolTreasuryAccount.owner
          
          // Derive the USDC treasury ATA for the same owner
          const usdcTreasuryATA = await getAssociatedTokenAddress(
            usdcMint,
            treasuryOwner,
            false,
            TOKEN_PROGRAM_ID
          )
          
          // Check if this ATA exists
          try {
            usdcTreasuryAccount = await getAccount(connection, usdcTreasuryATA)
            treasuryUSDC = usdcTreasuryATA // Use the ATA
            console.log('USDC treasury ATA exists:', usdcTreasuryATA.toString())
          } catch {
            // ATA doesn't exist - we need to create it
            // Add instruction to create it in the transaction
            console.log('USDC treasury ATA does not exist, will create it')
            accountCreationInstructions.push(
              createAssociatedTokenAccountIdempotentInstruction(
                currentPublicKey, // payer
                usdcTreasuryATA, // associatedToken
                treasuryOwner, // owner
                usdcMint, // mint
                TOKEN_PROGRAM_ID,
                ASSOCIATED_TOKEN_PROGRAM_ID
              )
            )
            treasuryUSDC = usdcTreasuryATA // Use the ATA
            console.log('Will create USDC treasury ATA:', usdcTreasuryATA.toString())
          }
        } catch (error: any) {
          // Fallback: try the configured address directly
          try {
            usdcTreasuryAccount = await getAccount(connection, treasuryUSDC)
            console.log('USDC treasury account exists (using config):', treasuryUSDC.toString())
          } catch (fallbackError: any) {
            const errorMsg = `USDC treasury account not initialized.\n\nThe USDC treasury must be a valid USDC token account.\n\nError: ${error.message || fallbackError.message}\n\nTo fix this, ensure the USDC treasury account exists at:\n${treasuryUSDC.toString()}`
            alert(errorMsg)
            throw new Error(errorMsg)
          }
        }
        
        // Calculate max slippage (100 bps = 1%)
        const maxSlippageBps = 100
        
        // Convert amounts to lamports/decimals
        const baseAmountLamports = Math.floor(baseAmount * 1e9) // SOL has 9 decimals
        const usdcAmountDecimals = Math.floor(usdcAmount * 1e6) // USDC has 6 decimals
        
        // Verify all required accounts before calling the instruction
        console.log('Verifying accounts before opening LP position:', {
          crucible: cruciblePDA.toString(),
          user: currentPublicKey.toString(),
          baseMint: baseMint.toString(),
          lpTokenMint: lpTokenMint.toString(),
          position: positionPDA.toString(),
        })

        // Call open_lp_position instruction
        console.log('Calling open_lp_position instruction...')
        let txSignature: string
        try {
          // #region agent log
          fetch('http://127.0.0.1:7242/ingest/fdff7e9f-5404-4480-bac7-c940d759c957',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'useLP.ts:502',message:'Building accounts for open_lp_position',data:{crucible: cruciblePDA.toString(), user: currentPublicKey.toString(), position: positionPDA.toString(), baseMint: baseMint.toString(), lpTokenMint: lpTokenMint.toString()},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
          // #endregion
          
          // #region agent log
          // Verify position PDA derivation matches what Anchor will derive
          // Anchor uses: seeds = [b"lp_position", user.key().as_ref(), base_mint.key().as_ref()]
          const expectedSeeds = [
            Buffer.from('lp_position'),
            currentPublicKey.toBuffer(),
            baseMint.toBuffer()
          ]
          const [expectedPositionPDA, expectedBump] = PublicKey.findProgramAddressSync(
            expectedSeeds,
            new PublicKey(SOLANA_TESTNET_PROGRAM_IDS.FORGE_CRUCIBLES)
          )
          fetch('http://127.0.0.1:7242/ingest/fdff7e9f-5404-4480-bac7-c940d759c957',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'useLP.ts:530',message:'Position PDA verification',data:{derivedPDA: positionPDA.toString(), expectedPDA: expectedPositionPDA.toString(), match: positionPDA.equals(expectedPositionPDA), derivedBump: positionBump, expectedBump, cruciblePDA: cruciblePDA.toString(), crucibleAuthorityPDA: crucibleAuthorityPDA.toString(), user: currentPublicKey.toString(), programId: SOLANA_TESTNET_PROGRAM_IDS.FORGE_CRUCIBLES},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'G'})}).catch(()=>{});
          
          // If there's a mismatch, log the seeds for debugging
          if (!positionPDA.equals(expectedPositionPDA)) {
            console.error('Position PDA mismatch!', {
              derived: positionPDA.toString(),
              expected: expectedPositionPDA.toString(),
              baseMint: baseMint.toString(),
              user: currentPublicKey.toString(),
              seeds: ['lp_position', currentPublicKey.toString(), baseMint.toString()],
            })
          } else {
            console.log('✅ Position PDA matches expected:', positionPDA.toString())
          }
          
          // Verify crucible and crucible_authority are the same PDA
          if (!cruciblePDA.equals(crucibleAuthorityPDA)) {
            console.error('❌ Crucible PDA mismatch!', {
              crucible: cruciblePDA.toString(),
              crucible_authority: crucibleAuthorityPDA.toString(),
              baseMint: baseMint.toString(),
            })
            throw new Error(`Crucible PDA mismatch: crucible=${cruciblePDA.toString()}, crucible_authority=${crucibleAuthorityPDA.toString()}`)
          } else {
            console.log('✅ Crucible and crucible_authority are the same PDA:', cruciblePDA.toString())
          }
          // #endregion
          
          // #region agent log
          // Build accounts object for logging (not used in instruction - all accounts passed explicitly)
          const accountsForLogging = {
            crucible: cruciblePDA.toString(),
            user: currentPublicKey.toString(),
            base_mint: baseMint.toString(),
            position: positionPDA.toString(),
            crucible_authority: crucibleAuthorityPDA.toString(),
            hasOracle: !!oracleAccount,
          }
          fetch('http://127.0.0.1:7242/ingest/fdff7e9f-5404-4480-bac7-c940d759c957',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'useLP.ts:527',message:'Accounts built, checking crucible account size',data:accountsForLogging,timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
          // #endregion
          
          // #region agent log
          // Check crucible account size before calling instruction
          try {
            const crucibleAccountInfo = await connection.getAccountInfo(cruciblePDA)
            if (crucibleAccountInfo) {
              fetch('http://127.0.0.1:7242/ingest/fdff7e9f-5404-4480-bac7-c940d759c957',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'useLP.ts:533',message:'Crucible account info before instruction',data:{dataLength: crucibleAccountInfo.data.length, owner: crucibleAccountInfo.owner.toString(), executable: crucibleAccountInfo.executable, lamports: crucibleAccountInfo.lamports},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
            } else {
              fetch('http://127.0.0.1:7242/ingest/fdff7e9f-5404-4480-bac7-c940d759c957',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'useLP.ts:536',message:'ERROR: Crucible account not found',data:{cruciblePDA: cruciblePDA.toString()},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
            }
          } catch (e: any) {
            fetch('http://127.0.0.1:7242/ingest/fdff7e9f-5404-4480-bac7-c940d759c957',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'useLP.ts:539',message:'ERROR: Failed to fetch crucible account info',data:{error: e.message, cruciblePDA: cruciblePDA.toString()},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
          }
          // #endregion
          
          // #region agent log
          fetch('http://127.0.0.1:7242/ingest/fdff7e9f-5404-4480-bac7-c940d759c957',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'useLP.ts:545',message:'Building instruction with amounts',data:{baseAmountLamports: baseAmountLamports.toString(), usdcAmountDecimals: usdcAmountDecimals.toString(), maxSlippageBps},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
          // #endregion
          
          // Build the instruction
          // CRITICAL FIX: Anchor tries to auto-resolve PDAs even when passed explicitly
          // The problem: IDL defines crucible BEFORE base_mint, but crucible PDA needs base_mint
          // This creates a circular dependency in Anchor's resolution logic.
          // 
          // Solution: We must pass accounts in the EXACT IDL order, but Anchor will still try
          // to validate PDA derivation. Since crucible is UncheckedAccount, Anchor can't read
          // base_mint from it, so it tries to resolve crucible_authority and fails.
          //
          // The fix: Ensure base_mint is passed BEFORE any PDA that depends on it, even though
          // IDL order is different. Anchor's account resolution is smart enough to use accounts
          // that come later in the list for PDA validation.
          
          // Verify crucible account exists on-chain before building instruction
          const crucibleAccountInfo = await connection.getAccountInfo(cruciblePDA)
          if (!crucibleAccountInfo) {
            const errorMsg = `❌ Crucible account NOT FOUND on-chain at ${cruciblePDA.toString()}.\n\n` +
              `The crucible must be initialized before opening LP positions.\n\n` +
              `To initialize the crucible, run:\n` +
              `ts-node scripts/init-sol-crucible.ts --treasury 9VbGJDCXshKXfhA6J2TJv53RpQQeVFocXp2gNuxUxioW\n\n` +
              `This will create the crucible account with LP token mint support.`
            alert(errorMsg)
            throw new Error(`Crucible account not found: ${cruciblePDA.toString()}`)
          }
          console.log('✅ Crucible account verified on-chain, size:', crucibleAccountInfo.data.length, 'bytes')
          
          // Pass accounts in EXACT IDL order (crucible, user, base_mint, ...)
          // Anchor will use base_mint (which comes later) to validate crucible PDA
          const accountsObject: any = {
            // IDL order (crucible comes first, but Anchor can use base_mint from later in list)
            crucible: cruciblePDA, // Explicitly passed (PDA: ["crucible", base_mint])
            user: currentPublicKey,
            base_mint: baseMint, // CRITICAL: Must be present for Anchor to validate crucible/crucible_authority PDAs
            user_base_token_account: userBaseTokenAccount,
            user_usdc_account: userUsdcAccount,
            crucible_base_vault: baseVaultPDA,
            crucible_usdc_vault: usdcVaultPDA,
            lp_token_mint: lpTokenMint,
            user_lp_token_account: userLpTokenAccount,
            position: positionPDA, // Explicitly passed (PDA: ["lp_position", user, base_mint])
            crucible_authority: crucibleAuthorityPDA, // Explicitly passed (PDA: ["crucible", base_mint] - same as crucible)
            treasury_base: treasuryBase,
            treasury_usdc: treasuryUSDC,
            token_program: TOKEN_PROGRAM_ID,
            system_program: SystemProgram.programId,
          }
          
          // Include oracle only if it exists
          if (oracleAccount) {
            accountsObject.oracle = oracleAccount
          }
          
          // Log accounts for debugging
          console.log('📋 Passing accounts to Anchor (IDL order):', {
            crucible: cruciblePDA.toString(),
            user: currentPublicKey.toString(),
            base_mint: baseMint.toString(),
            crucible_authority: crucibleAuthorityPDA.toString(),
            position: positionPDA.toString(),
            hasOracle: !!oracleAccount,
          })
          
          // Build instruction - Anchor will validate PDAs using base_mint from accounts object
          // position_nonce is passed to allow multiple positions per user (like cToken minting)
          const openLpPositionIx = await program.methods
            .openLpPosition(
              new BN(baseAmountLamports),
              new BN(usdcAmountDecimals),
              new BN(maxSlippageBps),
              new BN(positionNonce) // Nonce for multiple positions
            )
            .accounts(accountsObject)
            .instruction()
          
          // #region agent log
          fetch('http://127.0.0.1:7242/ingest/fdff7e9f-5404-4480-bac7-c940d759c957',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'useLP.ts:556',message:'Instruction built, adding to transaction',data:{instructionKeys: openLpPositionIx.keys?.length || 0},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
          // #endregion
          
          // Create transaction with account creation instructions first, then the main instruction
          const transaction = new Transaction()
          
          // Get recent blockhash FIRST (required before adding instructions)
          const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed')
          transaction.recentBlockhash = blockhash
          transaction.feePayer = currentPublicKey
          
          // Add account creation instructions if needed
          if (accountCreationInstructions.length > 0) {
            console.log(`Adding ${accountCreationInstructions.length} account creation instruction(s)`)
            transaction.add(...accountCreationInstructions)
          }
          
          // Add the main instruction
          transaction.add(openLpPositionIx)
          
          // Sign and send transaction using wallet adapter
          if (!sendTransaction) {
            throw new Error('sendTransaction function not available')
          }
          
          // #region agent log
          fetch('http://127.0.0.1:7242/ingest/fdff7e9f-5404-4480-bac7-c940d759c957',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'useLP.ts:562',message:'Sending transaction',data:{instructionCount: transaction.instructions.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
          // #endregion
          
          // Wallet adapter's sendTransaction handles signing and sending
          // Note: sendTransaction from WalletContext only takes transaction, not connection
          txSignature = await sendTransaction(transaction)
          console.log('LP position opened, transaction:', txSignature)
          
          // #region agent log
          fetch('http://127.0.0.1:7242/ingest/fdff7e9f-5404-4480-bac7-c940d759c957',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'useLP.ts:568',message:'Transaction sent successfully',data:{txSignature},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
          // #endregion
        } catch (error: any) {
          console.error('Error opening LP position:', error)
          
          // #region agent log
          fetch('http://127.0.0.1:7242/ingest/fdff7e9f-5404-4480-bac7-c940d759c957',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'useLP.ts:571',message:'ERROR: Transaction failed',data:{errorMessage: error.message, errorCode: error.error?.errorCode?.code, errorLogs: error.logs || [], errorSimulationLogs: error.simulationResponse?.logs || []},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
          // #endregion
          
          // Check for AccountDidNotDeserialize error (crucible in old format)
          if (error.error?.errorCode?.code === 'AccountDidNotDeserialize' || 
              error.error?.errorCode?.code === 3003 ||
              error.error?.errorMessage?.includes('AccountDidNotDeserialize') ||
              error.error?.errorMessage?.includes('Failed to deserialize') ||
              error.message?.includes('AccountDidNotDeserialize') ||
              error.message?.includes('Failed to deserialize')) {
            throw new Error(`Crucible account exists but is in an old format that cannot be deserialized.\n\nThis crucible was initialized before the current program version.\n\nTo fix this, you need to re-initialize the crucible:\n1. Close any existing positions\n2. Run: ts-node scripts/init-sol-crucible.ts --treasury 9VbGJDCXshKXfhA6J2TJv53RpQQeVFocXp2gNuxUxioW\n\nNote: This will create a new crucible with the updated format.`)
          }
          // Check for specific Anchor errors
          if (error.error?.errorCode?.code === 'AccountNotInitialized' || 
              error.error?.errorMessage?.includes('AccountNotInitialized') ||
              error.message?.includes('AccountNotInitialized')) {
            if (error.error?.errorMessage?.includes('crucible_usdc_vault') || 
                error.message?.includes('crucible_usdc_vault')) {
              throw new Error(`USDC vault account not initialized at ${usdcVaultPDA.toString()}. Please ensure the crucible is fully initialized with all vault accounts.`)
            }
            throw new Error(`Account not initialized: ${error.error?.errorMessage || error.message}`)
          }
          if (error.message?.includes('Account not found') || error.message?.includes('crucible')) {
            throw new Error(`Crucible account not found. Please ensure the crucible is initialized at ${cruciblePDA.toString()}`)
          }
          throw error
        }
        
        // Wait for confirmation
        await connection.confirmTransaction(txSignature, 'confirmed')
        
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/fdff7e9f-5404-4480-bac7-c940d759c957',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'useLP.ts:595',message:'Transaction confirmed, fetching LP token balance',data:{txSignature, lpTokenMint: lpTokenMint.toString(), userLpTokenAccount: userLpTokenAccount.toString()},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H'})}).catch(()=>{});
        // #endregion
        
        // Fetch LP token balance after minting to verify it was created
        try {
          const lpTokenAccount = await getAccount(connection, userLpTokenAccount)
          const lpTokenBalance = Number(lpTokenAccount.amount) / 1e9 // LP tokens have 9 decimals
          console.log('✅ LP tokens minted! Balance:', lpTokenBalance, 'LP tokens')
          console.log('📦 LP token account:', userLpTokenAccount.toString())
          console.log('🪙 LP token mint:', lpTokenMint.toString())
          
          // #region agent log
          fetch('http://127.0.0.1:7242/ingest/fdff7e9f-5404-4480-bac7-c940d759c957',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'useLP.ts:602',message:'LP token balance after mint',data:{lpTokenBalance, lpTokenAmount: lpTokenAccount.amount.toString(), lpTokenAccount: userLpTokenAccount.toString(), lpTokenMint: lpTokenMint.toString()},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H'})}).catch(()=>{});
          // #endregion
        } catch (error: any) {
          console.warn('Could not fetch LP token balance (account may not exist yet):', error)
        }
        
        // Trigger immediate LP balance refresh so tokens appear in wallet
        window.dispatchEvent(new CustomEvent('refreshLPBalance', {}))
        
        // Fetch position account to get actual position ID
        let positionId: string
        try {
            const positionAccount = await (program.account as any).lppositionAccount.fetch(positionPDA)
          positionId = positionAccount.positionId.toString()
        } catch (error) {
          console.warn('Could not fetch position account, using PDA as ID:', error)
          positionId = positionPDA.toString()
        }

        const entryPrice = baseTokenPrice
        // Matches contract: LP APY = base APY (no 3x multiplier)
        const lpAPY = baseAPY
        
        // Fetch current exchange rate from crucible for yield tracking
        let entryExchangeRate = 1.0
        try {
          const { getAccurateExchangeRate } = await import('../utils/crucibleFetcher')
          const crucibleAccount = await fetchCrucibleDirect(connection, cruciblePDA.toString())
          if (crucibleAccount) {
            entryExchangeRate = getAccurateExchangeRate(crucibleAccount)
          }
        } catch (e) {
          console.warn('Failed to fetch crucible exchange rate:', e)
        }

        const newPosition: LPPosition = {
          id: positionId,
          owner: currentPublicKey.toBase58(),
          baseToken: baseTokenSymbol,
          baseAmount,
          usdcAmount,
          entryPrice,
          entryExchangeRate, // Store exchange rate at entry for real yield calculation
          currentValue: baseValue + usdcValue,
          yieldEarned: 0, // Will grow as exchange rate increases
          isOpen: true,
          lpAPY,
          pnl: 0,
          nonce: positionNonce, // Store nonce for closing position later
        }

        // IMMEDIATELY update state so portfolio sees it right away
        setPositions((prev) => {
          // Check if position already exists (avoid duplicates)
          if (prev.find(p => p.id === newPosition.id)) {
            return prev
          }
          const updated = [...prev, newPosition]
          
          // SECURITY FIX: Store in localStorage using secure utility
          try {
            const allStoredPositions = getLPPositions()
            const existingIndex = allStoredPositions.findIndex((p: StoredLPPosition) => p.id === newPosition.id)
            if (existingIndex >= 0) {
              allStoredPositions[existingIndex] = newPosition as StoredLPPosition
            } else {
              allStoredPositions.push(newPosition as StoredLPPosition)
            }
            setLPPositions(allStoredPositions)
            
            // IMMEDIATELY refetch positions to update state
            setTimeout(() => {
              fetchPositionsRef.current?.()
            }, 0)
            
            // IMMEDIATELY dispatch events to trigger wallet and portfolio updates
            window.dispatchEvent(new CustomEvent('lpPositionOpened', { 
              detail: { 
                positionId: newPosition.id,
                crucibleAddress, 
                baseTokenSymbol
              } 
            }))
            
            // Trigger LP balance refresh so LP tokens appear in wallet
            window.dispatchEvent(new CustomEvent('refreshLPBalance', {}))
            
            // Also trigger storage event for listeners
            window.dispatchEvent(new StorageEvent('storage', {
              key: 'lp_positions',
              newValue: JSON.stringify(allStoredPositions),
              storageArea: localStorage
            }))
            
            // Force a custom event that components will catch
            window.dispatchEvent(new CustomEvent('forceRecalculateLP', {}))
          } catch (e) {
            console.warn('Failed to store LP position:', e)
          }
          return updated
        })

        return newPosition
      } catch (error: any) {
        console.error('Error opening LP position:', error)
        throw error
      } finally {
        setLoading(false)
      }
    },
    [publicKey?.toBase58(), sessionContext?.walletPublicKey?.toString(), walletContext?.publicKey?.toBase58(), crucibleAddress, baseTokenSymbol, baseAPY]
  )

  // Close LP position
  const closePosition = useCallback(
    async (positionId: string) => {
      // Check wallet connection with better error handling (same as useLVFPosition)
      let currentPublicKey: PublicKey | null = null
      
      // Try session context first
      if (sessionContext?.walletPublicKey) {
        try {
          if (sessionContext.walletPublicKey instanceof PublicKey) {
            currentPublicKey = sessionContext.walletPublicKey
          } else if (typeof sessionContext.walletPublicKey === 'string') {
            currentPublicKey = new PublicKey(sessionContext.walletPublicKey)
          }
        } catch (e) {
          console.warn('Error parsing session wallet public key (close LP):', e)
        }
      }
      
      // Fallback to hook-level publicKey
      if (!currentPublicKey && publicKey) {
        currentPublicKey = publicKey
      }
      
      // Fallback to wallet context
      if (!currentPublicKey && walletContext?.publicKey) {
        currentPublicKey = walletContext.publicKey
      }
      
      if (!currentPublicKey) {
        throw new Error('Wallet not connected. Please connect your wallet first.')
      }

      setLoading(true)
      try {
        // Try to find position in state first
        let position = positions.find((p) => p.id === positionId && p.isOpen)
        
        // SECURITY FIX: If not found in state, try loading from localStorage using secure utility
        if (!position) {
          try {
            const allStoredPositions = getLPPositions()
            const storedPosition = allStoredPositions.find((p: StoredLPPosition) => 
              p.id === positionId && 
              p.isOpen && 
              (p.owner === currentPublicKey.toBase58() || p.owner === currentPublicKey.toString())
            )
            if (storedPosition) {
              position = storedPosition as LPPosition
            }
          } catch (e) {
            console.warn('Failed to load LP position from localStorage:', e)
          }
        }
        
        if (!position || !position.isOpen) {
          throw new Error('Position not found or already closed')
        }

        if (!walletContext?.connection || !crucibleAddress) {
          throw new Error('Wallet or crucible information missing')
        }

        const connection = walletContext.connection
        
        // Derive PDAs
        const baseMint = new PublicKey(SOLANA_TESTNET_CONFIG.TOKEN_ADDRESSES.SOL) // WSOL
        if (!crucibleAddress || typeof crucibleAddress !== 'string') {
          throw new Error('Invalid crucible address provided')
        }
        let cruciblePDA: PublicKey
        try {
          cruciblePDA = new PublicKey(crucibleAddress)
        } catch (e) {
          throw new Error(`Invalid crucible address format: ${crucibleAddress}. Error: ${e}`)
        }

        // Calculate REAL APY earnings from exchange rate growth
        // Fetch current crucible exchange rate for real yield calculation
        let currentExchangeRate = 1.0
        let apyEarnedTokens = 0
        try {
          const { getAccurateExchangeRate, fetchCrucibleDirect } = await import('../utils/crucibleFetcher')
          const crucibleAccount = await fetchCrucibleDirect(connection, cruciblePDA.toString())
          if (crucibleAccount) {
            currentExchangeRate = getAccurateExchangeRate(crucibleAccount)
            const entryExchangeRate = position.entryExchangeRate || 1.0
            
            // Calculate real yield from exchange rate growth
            // yield_tokens = base_amount * (current_rate - entry_rate) / entry_rate
            if (currentExchangeRate > entryExchangeRate && entryExchangeRate > 0) {
              const rateGrowth = (currentExchangeRate - entryExchangeRate) / entryExchangeRate
              apyEarnedTokens = position.baseAmount * rateGrowth
            }
          }
        } catch (e) {
          console.warn('Failed to fetch crucible for yield calculation:', e)
        }
        
        const baseAmountAtCurrentRate = position.baseAmount * currentExchangeRate
        
        // Get Anchor program instance
        const anchorWallet: AnchorWallet = {
          publicKey: currentPublicKey,
          signTransaction: walletContext?.signTransaction || (async (tx: any) => tx),
          signAllTransactions: walletContext?.signAllTransactions || (async (txs: any[]) => txs),
        }
        const program = getCruciblesProgram(connection, anchorWallet)
        
        // Fetch crucible account to get treasury and LP token mint (using direct fetcher)
        let treasuryBase: PublicKey
        let treasuryUSDC: PublicKey
        let lpTokenMint: PublicKey
        try {
          const crucibleAccount = await fetchCrucibleDirect(connection, cruciblePDA.toString())
          if (!crucibleAccount) {
            throw new Error('Crucible account not found')
          }
          treasuryBase = crucibleAccount.treasury
          // Use separate USDC treasury from config (crucible treasury is for base token only)
          treasuryUSDC = new PublicKey(DEPLOYED_ACCOUNTS.USDC_TREASURY)
          lpTokenMint = crucibleAccount.lpTokenMint
          
          // Check if this is an old crucible without LP token mint
          const isOldCrucible = lpTokenMint.equals(crucibleAccount.ctokenMint)
          if (isOldCrucible) {
            // Old format: use the manually created LP token mint
            const MANUAL_LP_TOKEN_MINT = new PublicKey('8QkQFThfUkoriJfWFnWE6nf3oHM8mMWedN4vC8PAZUmy')
            lpTokenMint = MANUAL_LP_TOKEN_MINT
            console.log('Using manual LP token mint for old crucible:', lpTokenMint.toString())
            
            // Verify the manual LP token mint exists
            try {
              const lpMintInfo = await connection.getAccountInfo(lpTokenMint)
              if (!lpMintInfo) {
                throw new Error('Manual LP token mint not found. Please run: ts-node scripts/create-lp-token-mint.ts')
              }
            } catch (error: any) {
              console.error('Error verifying manual LP token mint:', error)
              throw error
            }
          }
        } catch (error: any) {
          if (error.message?.includes('without LP token mint')) {
            throw error // Re-throw the specific error
          }
          throw new Error(`Failed to fetch crucible account: ${error}`)
        }
        
        // Derive vault PDAs
        const [baseVaultPDA] = deriveVaultPDA(cruciblePDA)
        const [usdcVaultPDA] = deriveUSDCVaultPDA(cruciblePDA)
        
        // Get the nonce from the position object (stored when position was opened)
        const positionNonce = position.nonce ?? 0 // Default to 0 for backward compatibility
        
        // Derive position PDA using base_mint and nonce (matches new program seeds)
        const [positionPDA, positionBump] = deriveLPPositionPDA(currentPublicKey, baseMint, positionNonce)
        
        console.log(`Closing position with nonce ${positionNonce}, PDA: ${positionPDA.toString()}`)
        
        // CRITICAL: crucible_authority has the SAME seeds as crucible: ["crucible", base_mint]
        // They resolve to the SAME PDA, so we use the same value for both
        // This prevents Anchor from trying to auto-resolve crucible_authority which can fail
        const [crucibleAuthorityPDA, crucibleAuthorityBump] = deriveCrucibleAuthorityPDA(baseMint)
        
        // Verify crucible and crucible_authority are the same PDA (they should be)
        if (!cruciblePDA.equals(crucibleAuthorityPDA)) {
          throw new Error(`Crucible PDA mismatch in closePosition: crucible=${cruciblePDA.toString()}, crucible_authority=${crucibleAuthorityPDA.toString()}`)
        }
        
        console.log('✅ Crucible and crucible_authority are the same PDA in closePosition:', cruciblePDA.toString())
        
        // Get user token accounts
        const usdcMint = new PublicKey(SOLANA_TESTNET_CONFIG.TOKEN_ADDRESSES.USDC)
        const userBaseTokenAccount = await getAssociatedTokenAddress(baseMint, currentPublicKey)
        const userUsdcAccount = await getAssociatedTokenAddress(usdcMint, currentPublicKey)
        const userLpTokenAccount = await getAssociatedTokenAddress(lpTokenMint, currentPublicKey)
        
        // Fetch position account to verify it exists and is open
        try {
            const positionAccount = await (program.account as any).lppositionAccount.fetch(positionPDA)
          if (!positionAccount.isOpen) {
            throw new Error('Position is already closed')
          }
        } catch (error) {
          throw new Error(`Position not found at PDA ${positionPDA.toString()} with nonce ${positionNonce}: ${error}`)
        }
        
        // #region agent log
        // Fetch LP token balance before closing to verify tokens exist
        try {
          const lpTokenAccountBefore = await getAccount(connection, userLpTokenAccount)
          const lpTokenBalanceBefore = Number(lpTokenAccountBefore.amount) / 1e9
          console.log('LP tokens before closing:', lpTokenBalanceBefore)
          
          fetch('http://127.0.0.1:7242/ingest/fdff7e9f-5404-4480-bac7-c940d759c957',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'useLP.ts:966',message:'LP token balance before close',data:{lpTokenBalanceBefore, lpTokenAmount: lpTokenAccountBefore.amount.toString()},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'I'})}).catch(()=>{});
        } catch (error: any) {
          console.warn('Could not fetch LP token balance before closing:', error)
        }
        // #endregion
        
        // Call close_lp_position instruction
        // CRITICAL: Account names MUST match the IDL exactly (snake_case, not camelCase)
        // CRITICAL: Explicitly pass crucible_authority to prevent Anchor auto-resolution issues
        const maxSlippageBps = 100 // 1% slippage tolerance
        const txSignature = await program.methods
          .closeLpPosition(
            new BN(maxSlippageBps),
            new BN(positionNonce) // Position nonce for PDA derivation
          )
          .accounts({
            crucible: cruciblePDA,
            user: currentPublicKey,
            base_mint: baseMint, // IDL expects "base_mint" (snake_case)
            position: positionPDA,
            user_base_token_account: userBaseTokenAccount,
            user_usdc_account: userUsdcAccount,
            lp_token_mint: lpTokenMint,
            user_lp_token_account: userLpTokenAccount,
            crucible_base_vault: baseVaultPDA,
            crucible_usdc_vault: usdcVaultPDA,
            crucible_authority: crucibleAuthorityPDA, // Explicitly set to prevent auto-resolution
            treasury_base: treasuryBase,
            treasury_usdc: treasuryUSDC,
            token_program: TOKEN_PROGRAM_ID,
          })
          .rpc()
        
        // Wait for confirmation
        await connection.confirmTransaction(txSignature, 'confirmed')
        
        // #region agent log
        // Verify LP tokens were burned after closing
        try {
          const lpTokenAccountAfter = await getAccount(connection, userLpTokenAccount)
          const lpTokenBalanceAfter = Number(lpTokenAccountAfter.amount) / 1e9
          console.log('LP tokens after closing:', lpTokenBalanceAfter, '(should be 0 or reduced)')
          
          fetch('http://127.0.0.1:7242/ingest/fdff7e9f-5404-4480-bac7-c940d759c957',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'useLP.ts:999',message:'LP token balance after close',data:{lpTokenBalanceAfter, lpTokenAmount: lpTokenAccountAfter.amount.toString()},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'I'})}).catch(()=>{});
        } catch (error: any) {
          if (error.name === 'TokenAccountNotFoundError' || error.message?.includes('Account not found')) {
            console.log('LP token account no longer exists or has 0 balance (tokens burned successfully)')
          } else {
            console.warn('Could not fetch LP token balance after closing:', error)
          }
        }
        // #endregion
        
        // INFERNO MODE: Apply Forge close fees and calculate SOL-only return
        // The contract converts USDC to SOL, so we calculate total SOL returned
        const baseTokenPrice = solPrice || 200 // Use real-time SOL price, fallback to $200
        const principalTokens = position.baseAmount
        const principalFeeTokens = principalTokens * INFERNO_CLOSE_FEE_RATE
        const yieldFeeTokens = apyEarnedTokens * INFERNO_YIELD_FEE_RATE
        const baseAmountAfterFee = (principalTokens - principalFeeTokens) + (apyEarnedTokens - yieldFeeTokens)
        
        // Calculate SOL equivalent of USDC (matching contract conversion)
        // Contract converts USDC to SOL using oracle price
        const usdcToSolAmount = position.usdcAmount / baseTokenPrice
        
        // Total SOL returned = base SOL (after fees) + converted USDC
        const totalSolReturned = baseAmountAfterFee + usdcToSolAmount
        
        const feeAmountTokens = principalFeeTokens + yieldFeeTokens
        const feeAmountUSD = feeAmountTokens * baseTokenPrice

        // Remove position
        setPositions((prev) => {
          const updated = prev.filter((p) => p.id !== positionId)
          // SECURITY FIX: Update localStorage using secure utility
          try {
            const allStoredPositions = getLPPositions()
            const filteredAll = allStoredPositions.filter((p: StoredLPPosition) => p.id !== positionId)
            setLPPositions(filteredAll)
            // Dispatch event to refresh portfolio and LP token balance
            window.dispatchEvent(new CustomEvent('lpPositionClosed'))
            window.dispatchEvent(new CustomEvent('refreshLPBalance', {}))
          } catch (e) {
            console.warn('Failed to update LP positions:', e)
          }
          return updated
        })

        const netYieldTokens = Math.max(0, apyEarnedTokens - yieldFeeTokens)

        return { 
          success: true,
          baseAmount: totalSolReturned, // Total SOL returned (base + converted USDC)
          apyEarned: netYieldTokens, // Net yield after Forge yield fee
          usdcAmount: 0, // USDC was converted to SOL in contract, so 0 returned
          feeAmount: feeAmountTokens,
          feePercent: INFERNO_CLOSE_FEE_RATE * 100,
          yieldFee: yieldFeeTokens,
          principalFee: principalFeeTokens
        }
      } catch (error: any) {
        console.error('Error closing LP position:', error)
        throw error
      } finally {
        setLoading(false)
      }
    },
    [publicKey?.toBase58(), sessionContext?.walletPublicKey?.toString(), walletContext?.publicKey?.toBase58(), positions]
  )

  // Store latest fetchPositions in ref
  useEffect(() => {
    fetchPositionsRef.current = fetchPositions
  }, [fetchPositions])

  useEffect(() => {
    if (!publicKey || !crucibleAddress) return
    
    // Use current ref value if available, otherwise call directly
    const currentFetch = fetchPositionsRef.current || fetchPositions
    currentFetch()
    
    const interval = setInterval(() => {
      fetchPositionsRef.current?.()
    }, 30000) // Refresh every 30s
    return () => clearInterval(interval)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publicKey?.toBase58(), crucibleAddress, baseTokenSymbol])

  return {
    positions,
    loading,
    openPosition,
    closePosition,
    refetch: fetchPositions,
  }
}

