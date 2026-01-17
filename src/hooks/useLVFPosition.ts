import { useState, useEffect, useCallback, useRef } from 'react'
import { PublicKey, SystemProgram } from '@solana/web3.js'
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddress } from '@solana/spl-token'
import * as anchor from '@coral-xyz/anchor'
import { BN } from '@coral-xyz/anchor'
import { useWallet } from '../contexts/WalletContext'
// Removed useSession - using useWallet directly
import { useCrucible as useCrucibleContext } from '../contexts/CrucibleContext'
import { useCrucible } from '../hooks/useCrucible'
import { useBalance } from '../contexts/BalanceContext'
import { RATE_SCALE } from '../utils/math'
import {
  INFERNO_OPEN_FEE_RATE,
  INFERNO_CLOSE_FEE_RATE,
  INFERNO_YIELD_FEE_RATE,
} from '../config/fees'
import { 
  getLendingPoolProgram, 
  getMarketState, 
  getBorrowerAccount,
  calculateBorrowInterest,
  getLendingPoolPDA,
  getPoolVaultPDA,
  getBorrowerAccountPDA,
  type AnchorWallet
} from '../utils/lendingProgram'
import { getCruciblesProgram } from '../utils/anchorProgram'
import { deriveCruciblePDA, deriveVaultPDA, deriveCrucibleAuthorityPDA, deriveLeveragedPositionPDA } from '../utils/cruciblePdas'
import { SOLANA_TESTNET_CONFIG, SOLANA_TESTNET_PROGRAM_IDS } from '../config/solana-testnet'

interface LeveragedPosition {
  id: string
  owner: string
  token: string // 'SOL'
  collateral: number // Base token amount
  borrowedUSDC: number
  depositUSDC?: number // USDC deposited (for 1.5x leverage)
  leverageFactor: number // 1.5 or 2.0
  entryPrice: number
  currentValue: number // USD
  yieldEarned: number
  timestamp?: number // When position was opened (for interest calculation)
  isOpen: boolean
  health: number // Health factor (collateral_value / borrowed_value * 100)
}

interface UseLVFPositionProps {
  crucibleAddress: string
  baseTokenSymbol: 'SOL'
}

export function useLVFPosition({ crucibleAddress, baseTokenSymbol }: UseLVFPositionProps) {
  // Check wallet connection - using Solana devnet directly
  let walletContext: any = null
  const sessionContext: any = null // Using Solana devnet directly
  
  // Try WalletContext as fallback
  try {
    walletContext = useWallet()
  } catch (e) {
    // WalletContext not available
  }
  
  // Try to get CrucibleContext for TVL updates (legacy context)
  let crucibleContext: any = null
  try {
    crucibleContext = useCrucibleContext()
  } catch (e) {
    // CrucibleContext not available (might not be in provider) - this is expected in some contexts
    // Don't log warning as it's not an error, just a missing provider
    crucibleContext = null
  }
  
  // Also try to get useCrucible hook (main crucible system)
  // Note: This hook call must be unconditional (React rules)
  // If the provider is not available, React will throw an error but we handle it gracefully
  // by checking if crucibleHook is null before using it
  let crucibleHook: any = null
  try {
    crucibleHook = useCrucible()
  } catch (e: any) {
    // React hooks throw errors that can't be caught with try-catch
    // The error will be logged to console by React itself, but functionality will continue
    // We check for null before using crucibleHook, so it's safe
    crucibleHook = null
  }
  
  // Determine which wallet context to use
  // Use WalletContext for wallet connection
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

  const [positions, setPositions] = useState<LeveragedPosition[]>([])
  const [loading, setLoading] = useState(false)
  
  // Use ref to store latest fetchPositions callback
  const fetchPositionsRef = useRef<(() => Promise<void>) | null>(null)

  // Fetch all leveraged positions for this crucible
  const fetchPositions = useCallback(async () => {
    // Try to get current publicKey from all possible sources
    let currentPublicKey: PublicKey | null = publicKey
    
    // Prioritize sessionContext FIRST (most reliable)
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
        console.warn('Error parsing session wallet public key (fetchPositions):', e)
      }
    }
    
    // Fallback to wallet context
    if (!currentPublicKey && walletContext?.publicKey) {
      currentPublicKey = walletContext.publicKey
    }
    
    if (!currentPublicKey || !crucibleAddress) {
      console.log('⚠️ Cannot fetch positions - missing publicKey or crucibleAddress')
      setPositions([])
      return
    }

    try {
      setLoading(true)
      const userPositions: LeveragedPosition[] = []
      let fetchedFromChain = false
      
      // PRIORITY 1: Fetch from on-chain
      if (walletContext?.connection && crucibleAddress) {
        try {
          const connection = walletContext.connection
          const anchorWallet: AnchorWallet = {
            publicKey: currentPublicKey,
            signTransaction: walletContext?.signTransaction || (async (tx: any) => tx),
            signAllTransactions: walletContext?.signAllTransactions || (async (txs: any[]) => txs),
          }
          const program = getCruciblesProgram(connection, anchorWallet)
          const cruciblePDA = new PublicKey(crucibleAddress)
          
          // Derive position PDA using the new function
          const [positionPDA] = deriveLeveragedPositionPDA(currentPublicKey, cruciblePDA)
          
          console.log('🔍 Fetching LVF position from on-chain:', positionPDA.toString())
          
          // Try to fetch position account from on-chain
          try {
            const positionAccount = await program.account.leveragedPosition.fetch(positionPDA)
            
            if (positionAccount.isOpen) {
              // Convert on-chain position to LeveragedPosition interface
              const baseTokenPrice = 200 // SOL price (could fetch from oracle)
              const collateralNum = Number(positionAccount.collateral) / 1e9 // Convert lamports to SOL
              const borrowedUsdcNum = Number(positionAccount.borrowedUsdc) / 1e6 // Convert USDC decimals
              const leverageFactorNum = Number(positionAccount.leverageFactor) / 100 // 150 -> 1.5, 200 -> 2.0
              const entryPriceNum = Number(positionAccount.entryPrice) / 1_000_000 // Convert from scaled
              
              const onChainPosition: LeveragedPosition = {
                id: positionPDA.toString(),
                owner: positionAccount.owner.toBase58(),
                token: baseTokenSymbol,
                collateral: collateralNum,
                borrowedUSDC: borrowedUsdcNum,
                depositUSDC: leverageFactorNum === 1.5 ? collateralNum * baseTokenPrice * 0.5 : 0,
                leverageFactor: leverageFactorNum,
                entryPrice: entryPriceNum,
                currentValue: collateralNum * baseTokenPrice * leverageFactorNum,
                yieldEarned: Number(positionAccount.yieldEarned) / 1e9,
                timestamp: Number(positionAccount.createdAt),
                isOpen: positionAccount.isOpen,
                health: borrowedUsdcNum > 0 ? (collateralNum * baseTokenPrice / borrowedUsdcNum) * 100 : 999,
              }
              
              userPositions.push(onChainPosition)
              fetchedFromChain = true
              console.log('✅ Fetched LVF position from on-chain:', onChainPosition.id)
              
              // Update localStorage cache with on-chain data
              try {
                const allStoredPositions = JSON.parse(localStorage.getItem('leveraged_positions') || '[]')
                const existingIndex = allStoredPositions.findIndex((p: LeveragedPosition) => p.id === onChainPosition.id)
                if (existingIndex >= 0) {
                  allStoredPositions[existingIndex] = onChainPosition
                } else {
                  allStoredPositions.push(onChainPosition)
                }
                localStorage.setItem('leveraged_positions', JSON.stringify(allStoredPositions))
              } catch (cacheError) {
                console.warn('Failed to update localStorage cache:', cacheError)
              }
            }
          } catch (fetchError: any) {
            // Position doesn't exist on-chain - this is valid (user has no position)
            // Check if it's an "Account does not exist" error which is expected
            if (fetchError?.message?.includes('Account does not exist') || 
                fetchError?.message?.includes('could not find') ||
                fetchError?.toString()?.includes('Account does not exist')) {
              console.log('📝 No on-chain LVF position found for user (this is normal if no position exists)')
            } else {
              console.warn('Error fetching on-chain position:', fetchError)
            }
          }
        } catch (programError) {
          console.warn('Failed to initialize program for on-chain fetch:', programError)
        }
      }
      
      // PRIORITY 2: Fallback to localStorage ONLY if on-chain fetch failed due to connection issues
      // (not if position simply doesn't exist on-chain)
      if (!fetchedFromChain && !walletContext?.connection) {
        console.log('📦 No connection available, falling back to localStorage cache')
        try {
          const storedPositions = JSON.parse(localStorage.getItem('leveraged_positions') || '[]')
          
          // Get all possible wallet address formats
          const walletAddresses = [
            currentPublicKey.toBase58(),
            currentPublicKey.toString(),
            publicKey?.toBase58(),
            publicKey?.toString(),
          ].filter(Boolean) as string[]
          
          // Filter positions for this crucible and wallet
          const cachedPositions = storedPositions.filter((p: LeveragedPosition) => {
            const ownerMatch = walletAddresses.some(addr => p.owner === addr || p.owner?.toLowerCase() === addr?.toLowerCase())
            const tokenMatch = p.token === baseTokenSymbol
            const isOpen = p.isOpen === true
            return ownerMatch && tokenMatch && isOpen
          })
          
          userPositions.push(...cachedPositions)
          console.log('📦 Loaded', cachedPositions.length, 'positions from localStorage cache')
        } catch (e) {
          console.warn('Failed to load positions from localStorage cache:', e)
        }
      }
      
      console.log('✅ Total LVF positions found:', userPositions.length, 'for', baseTokenSymbol)
      setPositions(userPositions)
    } catch (error) {
      console.error('Error fetching LVF positions:', error)
      setPositions([])
    } finally {
      setLoading(false)
    }
  }, [publicKey?.toBase58(), sessionContext?.walletPublicKey?.toString(), walletContext?.publicKey?.toBase58(), walletContext?.connection, crucibleAddress, baseTokenSymbol])

  // Open a leveraged position
  const openPosition = useCallback(
    async (collateralAmount: number, leverageFactor: number) => {
      console.log('🚀 openPosition called with:', { collateralAmount, leverageFactor, crucibleAddress, baseTokenSymbol })
      
      // Use the publicKey from the hook level (already extracted from contexts)
      // Prioritize sessionContext FIRST (most reliable)
      let currentPublicKey: PublicKey | null = null
      
      // FIRST PRIORITY: Check session context - it's the main wallet system
      if (sessionContext?.walletPublicKey) {
        try {
          if (sessionContext.walletPublicKey instanceof PublicKey) {
            currentPublicKey = sessionContext.walletPublicKey
            console.log('✅ Using walletPublicKey from sessionContext (LVF):', currentPublicKey.toString())
          } else if (typeof sessionContext.walletPublicKey === 'string') {
            currentPublicKey = new PublicKey(sessionContext.walletPublicKey)
            console.log('✅ Converted walletPublicKey string from sessionContext (LVF):', currentPublicKey.toString())
          } else if (typeof sessionContext.walletPublicKey === 'object' && sessionContext.walletPublicKey !== null) {
            // Handle serialized PublicKey object (e.g., {_bn: ...})
            if ('_bn' in sessionContext.walletPublicKey || 'toBase58' in sessionContext.walletPublicKey || 'toString' in sessionContext.walletPublicKey) {
              const pkString = sessionContext.walletPublicKey.toString ? sessionContext.walletPublicKey.toString() : 
                              sessionContext.walletPublicKey.toBase58 ? sessionContext.walletPublicKey.toBase58() : 
                              String(sessionContext.walletPublicKey)
              currentPublicKey = new PublicKey(pkString)
              console.log('✅ Converted walletPublicKey object from sessionContext (LVF):', currentPublicKey.toString())
            }
          }
        } catch (e) {
          console.warn('Error parsing session wallet public key (LVF):', e, sessionContext.walletPublicKey)
        }
      }
      
      // SECOND PRIORITY: Fallback to hook-level publicKey
      if (!currentPublicKey && publicKey) {
        currentPublicKey = publicKey
        console.log('✅ Using hook-level publicKey (LVF):', currentPublicKey.toString())
      }
      
      // THIRD PRIORITY: Fallback to wallet context
      if (!currentPublicKey && walletContext?.publicKey) {
        currentPublicKey = walletContext.publicKey
        console.log('✅ Using walletContext publicKey (LVF):', currentPublicKey.toString())
      }
      
      if (!currentPublicKey) {
        const debugInfo = {
          hookPublicKey: publicKey?.toString?.() || publicKey || 'null',
          sessionContextExists: !!sessionContext,
          sessionWalletPublicKey: sessionContext?.walletPublicKey?.toString?.() || sessionContext?.walletPublicKey || 'undefined',
          sessionWalletPublicKeyType: typeof sessionContext?.walletPublicKey,
          walletContextExists: !!walletContext,
          walletContextPublicKey: walletContext?.publicKey?.toString?.() || walletContext?.publicKey || 'undefined'
        }
        console.error('❌ Wallet connection check failed (LVF):', debugInfo)
        throw new Error('Wallet not connected. Please connect your wallet first.')
      }
      
      console.log('✅ Wallet connection verified (LVF):', currentPublicKey.toString())
      console.log('📋 Crucible info check:', { crucibleAddress, baseTokenSymbol, hasCrucible: !!crucibleAddress })
      
      if (!crucibleAddress) {
        console.error('❌ Crucible information missing!')
        throw new Error('Crucible information missing')
      }

      if (leverageFactor < 1.5 || leverageFactor > 2.0) {
        throw new Error('Leverage must be between 1.5x and 2x')
      }

      setLoading(true)
      try {
        // Calculate Forge open fee
        const protocolFeePercent = INFERNO_OPEN_FEE_RATE
        const protocolFee = collateralAmount * protocolFeePercent
        const collateralAfterFee = collateralAmount - protocolFee
        
        // Calculate borrowed USDC and deposited USDC based on collateral after fee
        const baseTokenPrice = 200 // SOL price
        const collateralValueUSD = collateralAfterFee * baseTokenPrice
        const borrowedUSDC = collateralValueUSD * (leverageFactor - 1)
        
        // Calculate deposited USDC based on leverage factor (using net collateral value)
        let depositUSDC = 0
        if (leverageFactor === 1.5) {
          depositUSDC = collateralValueUSD * 0.5 // 50% deposited, 50% borrowed
        } else if (leverageFactor === 2.0) {
          depositUSDC = 0 // 100% borrowed, 0% deposited
        }

        if (!walletContext?.connection) {
          throw new Error('Wallet connection missing')
        }

        const connection = walletContext.connection
        
        // Get Anchor program instance
        const anchorWallet: AnchorWallet = {
          publicKey: currentPublicKey,
          signTransaction: walletContext?.signTransaction || (async (tx: any) => tx),
          signAllTransactions: walletContext?.signAllTransactions || (async (txs: any[]) => txs),
        }
        const program = getCruciblesProgram(connection, anchorWallet)
        
        // Get lending pool program for accounts
        const { getLendingPoolProgram, getLendingPoolPDA, getPoolVaultPDA, getBorrowerAccountPDA } = await import('../utils/lendingProgram')
        const lendingProgram = getLendingPoolProgram(connection, anchorWallet)
        const [lendingPoolPDA] = getLendingPoolPDA()
        const [poolVaultPDA] = getPoolVaultPDA(lendingPoolPDA)
        const [borrowerAccountPDA] = getBorrowerAccountPDA(currentPublicKey)
        
        // Derive PDAs
        const baseMint = new PublicKey(SOLANA_TESTNET_CONFIG.TOKEN_ADDRESSES.SOL) // WSOL
        const cruciblePDA = new PublicKey(crucibleAddress)
        
        // Fetch crucible account to get treasury and oracle
        let treasuryAccount: PublicKey
        let oracleAccount: PublicKey | null = null
        try {
          const crucibleAccount = await program.account.crucible.fetch(cruciblePDA)
          treasuryAccount = crucibleAccount.treasury as PublicKey
          if (crucibleAccount.oracle) {
            oracleAccount = crucibleAccount.oracle as PublicKey
          }
        } catch (error) {
          throw new Error(`Failed to fetch crucible account: ${error}`)
        }
        
        // Derive vault and position PDAs
        const [baseVaultPDA] = deriveVaultPDA(cruciblePDA)
        const [positionPDA] = PublicKey.findProgramAddressSync(
          [Buffer.from('position'), currentPublicKey.toBuffer(), cruciblePDA.toBuffer()],
          new PublicKey(SOLANA_TESTNET_PROGRAM_IDS.FORGE_CRUCIBLES)
        )
        const [crucibleAuthorityPDA] = deriveCrucibleAuthorityPDA(baseMint)
        const [poolAuthorityPDA] = PublicKey.findProgramAddressSync(
          [Buffer.from('pool')],
          new PublicKey(SOLANA_TESTNET_PROGRAM_IDS.LENDING_POOL)
        )
        
        // Get user token accounts
        const usdcMint = new PublicKey(SOLANA_TESTNET_CONFIG.TOKEN_ADDRESSES.USDC)
        const userTokenAccount = await getAssociatedTokenAddress(baseMint, currentPublicKey)
        const userUsdcAccount = await getAssociatedTokenAddress(usdcMint, currentPublicKey)
        
        // Convert leverage factor (1.5 = 150, 2.0 = 200)
        const leverageFactorBps = Math.floor(leverageFactor * 100)
        
        // Convert collateral amount to lamports
        const collateralAmountLamports = Math.floor(collateralAfterFee * 1e9) // SOL has 9 decimals
        
        // Call open_leveraged_position instruction
        const txSignature = await program.methods
          .openLeveragedPosition(
            new BN(collateralAmountLamports),
            new BN(leverageFactorBps)
          )
          .accounts({
            user: currentPublicKey,
            crucible: cruciblePDA,
            baseTokenMint: baseMint,
            userTokenAccount: userTokenAccount,
            crucibleVault: baseVaultPDA,
            position: positionPDA,
            positionId: positionPDA, // Same PDA
            crucibleAuthority: crucibleAuthorityPDA,
            oracle: oracleAccount,
            lendingProgram: new PublicKey(SOLANA_TESTNET_PROGRAM_IDS.LENDING_POOL),
            lendingMarket: lendingPoolPDA,
            poolAuthority: poolAuthorityPDA,
            borrowerAccount: borrowerAccountPDA,
            lendingVault: poolVaultPDA,
            userUsdcAccount: userUsdcAccount,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .rpc()
        
        console.log('✅ Open leveraged position transaction sent:', txSignature)
        
        // Wait for confirmation
        await connection.confirmTransaction(txSignature, 'confirmed')
        console.log('✅ Transaction confirmed')
        
        // Fetch position account to get actual position data
        let actualPosition: any
        try {
          actualPosition = await program.account.leveragedPosition.fetch(positionPDA)
        } catch (error) {
          console.warn('Could not fetch position account:', error)
        }
        
        console.log('✅ Position created on-chain')

        // Use position PDA as ID
        const positionTimestamp = Date.now()
        const positionId = positionPDA.toString()
        
        // Get actual position data from on-chain if available
        let actualCollateral = collateralAfterFee
        let actualBorrowedUSDC = borrowedUSDC
        if (actualPosition) {
          actualCollateral = Number(actualPosition.collateral) / 1e9 // Convert lamports to SOL
          actualBorrowedUSDC = Number(actualPosition.borrowedUsdc) / 1e6 // Convert USDC decimals
        }
        
        const newPosition: LeveragedPosition = {
          id: positionId,
          owner: currentPublicKey.toBase58(),
          token: baseTokenSymbol,
          collateral: actualCollateral,
          borrowedUSDC: actualBorrowedUSDC,
          depositUSDC: depositUSDC, // Store deposited USDC
          leverageFactor,
          entryPrice: baseTokenPrice,
          currentValue: (actualCollateral * baseTokenPrice) * leverageFactor,
          yieldEarned: 0,
          timestamp: positionTimestamp, // Store timestamp for interest calculation
          isOpen: true,
          health: 200, // 2.0 = safe
        }

        console.log('📦 Creating position object:', newPosition)
        
        // Store to localStorage FIRST (synchronously, before state update)
        // This ensures components can read it when events fire
        try {
          const allStoredPositions = JSON.parse(localStorage.getItem('leveraged_positions') || '[]')
          const existingIndex = allStoredPositions.findIndex((p: LeveragedPosition) => p.id === newPosition.id)
          if (existingIndex >= 0) {
            allStoredPositions[existingIndex] = newPosition
          } else {
            allStoredPositions.push(newPosition)
          }
          localStorage.setItem('leveraged_positions', JSON.stringify(allStoredPositions))
          console.log('✅ Stored leveraged position to localStorage:', newPosition.id, 'Total stored:', allStoredPositions.length)
        } catch (e) {
          console.error('❌ Failed to store position to localStorage:', e)
          throw e // Don't continue if we can't save
        }
        
        // Update crucible TVL with deposit + borrow amount
        // TVL should increase by: collateral value + borrowed USDC value
        // baseTokenPrice is already defined above, reuse it
        const collateralValueUSDNet = collateralAfterFee * baseTokenPrice
        const totalTVLIncreaseUSD = collateralValueUSDNet + borrowedUSDC
        
        console.log('📊 Updating crucible TVL:', {
          crucibleAddress,
          collateralValueUSD,
          borrowedUSDC,
          totalTVLIncreaseUSD,
          hasCrucibleContext: !!crucibleContext,
          hasCrucibleHook: !!crucibleHook
        })
        
        // Update via useCrucible hook (main system used by CrucibleManager)
        if (crucibleHook?.updateCrucibleTVL) {
          crucibleHook.updateCrucibleTVL(crucibleAddress, totalTVLIncreaseUSD)
          console.log('📊 Updated crucible TVL via hook:', crucibleAddress, 'added:', totalTVLIncreaseUSD)
        }
        
        // Also try CrucibleContext (legacy)
        if (crucibleContext?.updateCrucibleTVL) {
          crucibleContext.updateCrucibleTVL(crucibleAddress, totalTVLIncreaseUSD)
        }
        
        // Update React state SECOND (like wrapTokens does with userBalances)
        // This makes the position immediately visible in the portfolio
        setPositions((prev) => {
          console.log('🔄 setPositions callback called, prev positions:', prev.length, prev.map(p => p.id))
          // Check if position already exists (avoid duplicates)
          if (prev.find(p => p.id === newPosition.id)) {
            console.log('⚠️ Position already in state:', newPosition.id)
            return prev
          }
          const updated = [...prev, newPosition]
          console.log('✅ Added position to state immediately:', newPosition.id, 'Total positions:', updated.length)
          return updated
        })
        
        // IMMEDIATELY dispatch events to trigger wallet and portfolio updates
        // The portfolio will see the updated state automatically (like wrapTokens)
        window.dispatchEvent(new CustomEvent('lvfPositionOpened', { 
          detail: { 
            positionId: newPosition.id,
            crucibleAddress, 
            baseTokenSymbol,
            leverage: leverageFactor
          } 
        }))
        
        // Force a custom event that components will catch
        window.dispatchEvent(new CustomEvent('forceRecalculateLP', {}))
        
        // Refetch positions immediately to ensure portfolio sees it
        // Force immediate refetch after state update (multiple attempts to ensure it works)
        setTimeout(() => {
          console.log('🔄 Refetching positions after opening (50ms)...')
          fetchPositionsRef.current?.()
        }, 50)
        
        setTimeout(() => {
          console.log('🔄 Refetching positions after opening (200ms)...')
          fetchPositionsRef.current?.()
        }, 200)
        
        console.log('📢 Dispatched events for position:', newPosition.id)
        
        return newPosition
      } catch (error: any) {
        console.error('Error opening position:', error)
        throw error
      } finally {
        setLoading(false)
      }
    },
    [publicKey?.toBase58(), sessionContext?.walletPublicKey?.toString(), walletContext?.publicKey?.toBase58(), crucibleAddress, baseTokenSymbol]
  )

  // Close a leveraged position (full or partial)
  const closePosition = useCallback(
    async (positionId: string, partialAmount?: number) => {
      // Check wallet connection - same logic as openPosition
      let currentPublicKey: PublicKey | null = null
      
      // FIRST PRIORITY: Check session context - it's the main wallet system
      if (sessionContext?.walletPublicKey) {
        try {
          if (sessionContext.walletPublicKey instanceof PublicKey) {
            currentPublicKey = sessionContext.walletPublicKey
            console.log('✅ Using walletPublicKey from sessionContext (close LVF):', currentPublicKey.toString())
          } else if (typeof sessionContext.walletPublicKey === 'string') {
            currentPublicKey = new PublicKey(sessionContext.walletPublicKey)
            console.log('✅ Converted walletPublicKey string from sessionContext (close LVF):', currentPublicKey.toString())
          } else if (typeof sessionContext.walletPublicKey === 'object' && sessionContext.walletPublicKey !== null) {
            // Handle serialized PublicKey object (e.g., {_bn: ...})
            if ('_bn' in sessionContext.walletPublicKey || 'toBase58' in sessionContext.walletPublicKey || 'toString' in sessionContext.walletPublicKey) {
              const pkString = sessionContext.walletPublicKey.toString ? sessionContext.walletPublicKey.toString() : 
                              sessionContext.walletPublicKey.toBase58 ? sessionContext.walletPublicKey.toBase58() : 
                              String(sessionContext.walletPublicKey)
              currentPublicKey = new PublicKey(pkString)
              console.log('✅ Converted walletPublicKey object from sessionContext (close LVF):', currentPublicKey.toString())
            }
          }
        } catch (e) {
          console.warn('Error parsing session wallet public key (close LVF):', e, sessionContext.walletPublicKey)
        }
      }
      
      // Fallback to hook-level publicKey
      if (!currentPublicKey && publicKey) {
        currentPublicKey = publicKey
        console.log('✅ Using publicKey from hook level (close LVF):', currentPublicKey.toString())
      }
      
      // Fallback to wallet context
      if (!currentPublicKey && walletContext?.publicKey) {
        currentPublicKey = walletContext.publicKey
        console.log('✅ Using publicKey from walletContext (close LVF):', currentPublicKey.toString())
      }
      
      if (!currentPublicKey) {
        // Log debug info before throwing
        console.error('❌ Wallet not connected (close LVF). Debug info:', {
          sessionContextExists: !!sessionContext,
          sessionWalletPublicKey: sessionContext?.walletPublicKey,
          sessionWalletPublicKeyType: typeof sessionContext?.walletPublicKey,
          hookPublicKey: publicKey?.toString?.() || publicKey || 'null',
          walletContextExists: !!walletContext,
          walletContextPublicKey: walletContext?.publicKey?.toString?.() || walletContext?.publicKey || 'undefined'
        })
        throw new Error('Wallet not connected. Please connect your wallet first.')
      }
      
      console.log('✅ Wallet connection verified (close LVF):', currentPublicKey.toBase58())

      setLoading(true)
      try {
        // Try to find position in state first
        let position = positions.find((p) => p.id === positionId && p.isOpen)
        
        // If not found in state, try loading from localStorage
        if (!position) {
          console.log('⚠️ Position not found in state, loading from localStorage...')
          try {
            const allStoredPositions = JSON.parse(localStorage.getItem('leveraged_positions') || '[]')
            const storedPosition = allStoredPositions.find((p: LeveragedPosition) => 
              p.id === positionId && 
              p.isOpen && 
              (p.owner === currentPublicKey.toBase58() || p.owner === currentPublicKey.toString())
            )
            if (storedPosition) {
              position = storedPosition
              console.log('✅ Found position in localStorage:', position.id)
            }
          } catch (e) {
            console.warn('Failed to load position from localStorage:', e)
          }
        }
        
        if (!position || !position.isOpen) {
          throw new Error('Position not found or already closed')
        }

        // Determine if this is a partial or full close
        // Use a small tolerance (0.0001) for floating point comparison
        const tolerance = 0.0001
        
        // Validate partialAmount if provided
        if (partialAmount !== undefined) {
          if (partialAmount <= 0) {
            throw new Error('Partial amount must be greater than 0')
          }
          if (partialAmount > position.collateral + tolerance) {
            throw new Error(`Partial amount (${partialAmount}) exceeds position collateral (${position.collateral})`)
          }
        }
        
        // Check if this is a partial close
        // If partialAmount is within tolerance of full collateral, treat as full close
        const isPartialClose = partialAmount !== undefined && partialAmount > 0 && partialAmount < (position.collateral - tolerance)
        const amountToClose = isPartialClose ? partialAmount : position.collateral
        const proportion = isPartialClose ? amountToClose / position.collateral : 1.0
        
        console.log('🔍 Position close calculation:', {
          positionId,
          partialAmount,
          positionCollateral: position.collateral,
          difference: position.collateral - (partialAmount || 0),
          isPartialClose,
          amountToClose,
          proportion,
          willClosePartial: isPartialClose,
          willCloseFull: !isPartialClose
        })

        // Calculate base tokens to return (collateral value + APY earnings)
        const baseTokenPriceForClose = 200 // SOL price
        
        // Use actual on-chain exchange rate (no frontend simulation)
        // TODO: Fetch current exchange rate from on-chain crucible account
        // Exchange rate grows as fees accrue on-chain
        const initialExchangeRate = 1.0 // Initial rate when position was opened (1:1)
        
        // Fetch actual current exchange rate from on-chain
        // For now, use crucible's exchange rate or calculate from vault/cToken supply
        const crucibleData = crucibleHook?.getCrucible(crucibleAddress)
        const currentExchangeRateOnChain = crucibleData?.exchangeRate 
          ? Number(crucibleData.exchangeRate) / 1_000_000 // Convert from scaled format
          : initialExchangeRate
        const currentExchangeRateDecimal = currentExchangeRateOnChain
        
        // Calculate APY percentage: ((exchange rate at sell / exchange rate at buy) - 1) * 100
        const apyPercentage = ((currentExchangeRateDecimal / initialExchangeRate) - 1) * 100
        
        // Calculate exchange rate growth (based on actual on-chain fees accrued)
        const exchangeRateGrowth = currentExchangeRateDecimal - initialExchangeRate
        
        // Calculate proportional amounts for partial close
        const collateralToClose = amountToClose
        const collateralValueAtCurrentRate = collateralToClose * currentExchangeRateDecimal
        const apyEarnedTokens = collateralToClose * (exchangeRateGrowth / currentExchangeRateDecimal)
        
        // Total collateral value including APY earnings (for the portion being closed)
        const totalCollateralValueUSD = collateralValueAtCurrentRate * baseTokenPriceForClose
        
        // Apply Forge close fees: 2% on principal, 10% on yield
        const principalFeeTokens = collateralToClose * INFERNO_CLOSE_FEE_RATE
        const yieldFeeTokens = apyEarnedTokens * INFERNO_YIELD_FEE_RATE
        const netYieldTokens = Math.max(0, apyEarnedTokens - yieldFeeTokens)
        const baseAmountAfterFee = (collateralToClose - principalFeeTokens) + netYieldTokens
        const totalFeeTokens = principalFeeTokens + yieldFeeTokens

        // Calculate borrowing interest (proportional for partial close)
        // Fetch real borrow rate from on-chain lending-pool
        let borrowingInterest = 0
        let totalOwedUSDC = 0
        let borrowRate = 10 // Default 10% APY if fetch fails
        
        if (position.borrowedUSDC > 0 && walletContext?.publicKey && walletContext?.connection) {
          try {
            // Fetch real market state to get actual borrow rate
            const anchorWallet: AnchorWallet = {
              publicKey: walletContext.publicKey,
              signTransaction: async (tx: any) => tx,
              signAllTransactions: async (txs: any[]) => txs,
            }
            const program = getLendingPoolProgram(walletContext.connection, anchorWallet)
            const marketState = await getMarketState(program)
            
            if (marketState) {
              borrowRate = marketState.borrowRate // Get actual rate from on-chain
            }
            
            // Fetch borrower account to get actual borrowed amount
            const borrowerAccount = await getBorrowerAccount(program, walletContext.publicKey)
            const actualBorrowedAmount = borrowerAccount?.amountBorrowed || position.borrowedUSDC
            
            // Calculate time elapsed (use position creation time if available, otherwise estimate)
            const positionCreatedAt = position.timestamp ? new Date(position.timestamp).getTime() : Date.now() - (30 * 24 * 60 * 60 * 1000) // Default to 30 days ago
            const now = Date.now()
            const timeElapsedMs = now - positionCreatedAt
            const timeElapsedSeconds = timeElapsedMs / 1000
            
            // Calculate proportional borrowed USDC for the portion being closed
            const proportionalBorrowedUSDC = actualBorrowedAmount * proportion
            
            // Calculate interest using real borrow rate from on-chain
            borrowingInterest = calculateBorrowInterest(
              proportionalBorrowedUSDC,
              borrowRate,
              timeElapsedSeconds
            )
            
            totalOwedUSDC = proportionalBorrowedUSDC + borrowingInterest
          } catch (error) {
            console.error('Error fetching borrowing interest from on-chain:', error)
            // Fallback to calculation with default rate
            const positionCreatedAt = position.createdAt ? new Date(position.createdAt).getTime() : Date.now() - (30 * 24 * 60 * 60 * 1000)
            const now = Date.now()
            const timeElapsedSeconds = (now - positionCreatedAt) / 1000
            const proportionalBorrowedUSDC = position.borrowedUSDC * proportion
            borrowingInterest = calculateBorrowInterest(
              proportionalBorrowedUSDC,
              borrowRate,
              timeElapsedSeconds
            )
            totalOwedUSDC = proportionalBorrowedUSDC + borrowingInterest
          }
        } else if (position.borrowedUSDC > 0) {
          // Fallback calculation when wallet not connected
          const positionCreatedAt = position.createdAt ? new Date(position.createdAt).getTime() : Date.now() - (30 * 24 * 60 * 60 * 1000)
          const now = Date.now()
          const timeElapsedSeconds = (now - positionCreatedAt) / 1000
          const proportionalBorrowedUSDC = position.borrowedUSDC * proportion
          borrowingInterest = calculateBorrowInterest(
            proportionalBorrowedUSDC,
            borrowRate,
            timeElapsedSeconds
          )
          totalOwedUSDC = proportionalBorrowedUSDC + borrowingInterest
        }

        // Calculate deposited USDC (proportional for partial close)
        const depositedUSDC = position.depositUSDC || 0
        const proportionalDepositedUSDC = depositedUSDC * proportion
        
        // Net USDC returned = proportional deposited USDC minus borrowing interest (if any)
        const netUSDCReturned = Math.max(0, proportionalDepositedUSDC - borrowingInterest)

        if (!walletContext?.connection) {
          throw new Error('Wallet connection missing')
        }

        const connection = walletContext.connection
        
        // Get Anchor program instance
        const anchorWallet: AnchorWallet = {
          publicKey: currentPublicKey,
          signTransaction: walletContext?.signTransaction || (async (tx: any) => tx),
          signAllTransactions: walletContext?.signAllTransactions || (async (txs: any[]) => txs),
        }
        const program = getCruciblesProgram(connection, anchorWallet)
        
        // Get lending pool program for accounts
        const lendingProgram = getLendingPoolProgram(connection, anchorWallet)
        const [lendingPoolPDA] = getLendingPoolPDA()
        const [poolVaultPDA] = getPoolVaultPDA(lendingPoolPDA)
        const [borrowerAccountPDA] = getBorrowerAccountPDA(currentPublicKey)
        
        // Derive PDAs
        const baseMint = new PublicKey(SOLANA_TESTNET_CONFIG.TOKEN_ADDRESSES.SOL) // WSOL
        const cruciblePDA = new PublicKey(crucibleAddress)
        
        // Fetch crucible account to get treasury
        let treasuryAccount: PublicKey
        try {
          const crucibleAccount = await program.account.crucible.fetch(cruciblePDA)
          treasuryAccount = crucibleAccount.treasury as PublicKey
        } catch (error) {
          throw new Error(`Failed to fetch crucible account: ${error}`)
        }
        
        // Derive vault and position PDAs
        const [baseVaultPDA] = deriveVaultPDA(cruciblePDA)
        const [positionPDA] = PublicKey.findProgramAddressSync(
          [Buffer.from('position'), currentPublicKey.toBuffer(), cruciblePDA.toBuffer()],
          new PublicKey(SOLANA_TESTNET_PROGRAM_IDS.FORGE_CRUCIBLES)
        )
        const [crucibleAuthorityPDA] = deriveCrucibleAuthorityPDA(baseMint)
        
        // Get user token accounts
        const usdcMint = new PublicKey(SOLANA_TESTNET_CONFIG.TOKEN_ADDRESSES.USDC)
        const userTokenAccount = await getAssociatedTokenAddress(baseMint, currentPublicKey)
        const userUsdcAccount = await getAssociatedTokenAddress(usdcMint, currentPublicKey)
        
        // Fetch position account to verify it exists
        try {
          const positionAccount = await program.account.leveragedPosition.fetch(positionPDA)
          if (!positionAccount.isOpen) {
            throw new Error('Position is already closed')
          }
        } catch (error) {
          throw new Error(`Position not found: ${error}`)
        }
        
        // Call close_leveraged_position instruction
        // Note: Repayment is handled by the instruction via CPI
        const txSignature = await program.methods
          .closeLeveragedPosition(positionPDA)
          .accounts({
            user: currentPublicKey,
            crucible: cruciblePDA,
            position: positionPDA,
            userTokenAccount: userTokenAccount,
            crucibleVault: baseVaultPDA,
            crucibleAuthority: crucibleAuthorityPDA,
            treasury: treasuryAccount,
            lendingProgram: new PublicKey(SOLANA_TESTNET_PROGRAM_IDS.LENDING_POOL),
            lendingMarket: lendingPoolPDA,
            borrowerAccount: borrowerAccountPDA,
            lendingVault: poolVaultPDA,
            userUsdcAccount: userUsdcAccount,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .rpc()
        
        console.log('✅ Close leveraged position transaction sent:', txSignature)
        
        // Wait for confirmation
        await connection.confirmTransaction(txSignature, 'confirmed')
        console.log('✅ Transaction confirmed')
        
        console.log('💰 Repaid borrowed USDC via CPI:', totalOwedUSDC)

        // Update crucible TVL when closing position (decrease by deposit + borrow, proportional for partial)
        const collateralValueUSDForClose = collateralToClose * baseTokenPriceForClose
        const proportionalBorrowedUSDC = (position.borrowedUSDC || 0) * proportion
        const totalTVLDecreaseUSD = collateralValueUSDForClose + proportionalBorrowedUSDC
        
        // Update via useCrucible hook (main system)
        if (crucibleHook?.updateCrucibleTVL) {
          crucibleHook.updateCrucibleTVL(crucibleAddress, -totalTVLDecreaseUSD)
          console.log('📊 Updated crucible TVL (decreased) via hook:', crucibleAddress, 'decreased:', totalTVLDecreaseUSD)
        }
        
        // Also try CrucibleContext (legacy)
        if (crucibleContext?.updateCrucibleTVL) {
          crucibleContext.updateCrucibleTVL(crucibleAddress, -totalTVLDecreaseUSD)
        }
        
        // Update or remove position based on partial/full close
        setPositions((prev) => {
          if (isPartialClose) {
            // Update position with remaining amounts
            const remainingCollateral = position.collateral - collateralToClose
            const remainingBorrowedUSDC = position.borrowedUSDC - proportionalBorrowedUSDC
            const remainingDepositedUSDC = depositedUSDC - proportionalDepositedUSDC
            
            const updatedPosition: LeveragedPosition = {
              ...position,
              collateral: remainingCollateral,
              borrowedUSDC: remainingBorrowedUSDC,
              depositUSDC: remainingDepositedUSDC,
              currentValue: remainingCollateral * baseTokenPriceForClose * position.leverageFactor,
              health: position.health, // Health should remain similar
            }
            
            const updated = prev.map((p) => p.id === positionId ? updatedPosition : p)
            
            // Update localStorage
            try {
              const allStoredPositions = JSON.parse(localStorage.getItem('leveraged_positions') || '[]')
              const updatedAll = allStoredPositions.map((p: LeveragedPosition) => 
                p.id === positionId ? updatedPosition : p
              )
              localStorage.setItem('leveraged_positions', JSON.stringify(updatedAll))
              console.log('✅ Updated leveraged position (partial close):', positionId, 'Remaining collateral:', remainingCollateral)
            } catch (e) {
              console.warn('Failed to update positions:', e)
            }
            
            return updated
          } else {
            // Remove position completely (full close)
            const updated = prev.filter((p) => p.id !== positionId)
            // Update localStorage for ALL positions (from all crucibles)
            try {
              const allStoredPositions = JSON.parse(localStorage.getItem('leveraged_positions') || '[]')
              const filteredAll = allStoredPositions.filter((p: LeveragedPosition) => p.id !== positionId)
              localStorage.setItem('leveraged_positions', JSON.stringify(filteredAll))
              console.log('✅ Removed leveraged position (full close):', positionId)
            } catch (e) {
              console.warn('Failed to update positions:', e)
            }
            return updated
          }
        })
        
        // Refetch positions immediately to update portfolio
        setTimeout(() => {
          console.log('🔄 Refetching positions after closing...')
          fetchPositionsRef.current?.()
        }, 100)
        
        // Dispatch event to refresh portfolio and wallet balances
        // Note: LP tokens are automatically removed from wallet by the LP balance calculation effect
        // which listens for 'lvfPositionClosed' events and recalculates balances from localStorage
        window.dispatchEvent(new CustomEvent('lvfPositionClosed', { 
          detail: { 
            positionId, 
            crucibleAddress, 
            baseTokenSymbol,
            baseAmount: baseAmountAfterFee,
            usdcAmount: netUSDCReturned,
            repaidUSDC: totalOwedUSDC,
            borrowingInterest: borrowingInterest,
            yieldFee: yieldFeeTokens,
            principalFee: principalFeeTokens
          } 
        }))

        return { 
          success: true,
          baseAmount: baseAmountAfterFee, // Tokens returned after fees
          apyEarned: netYieldTokens, // Net yield returned to user
          usdcAmount: netUSDCReturned, // Deposited USDC minus borrowing interest (if any)
          fee: totalFeeTokens,
          feePercent: INFERNO_CLOSE_FEE_RATE * 100,
          yieldFee: yieldFeeTokens,
          principalFee: principalFeeTokens,
          repaidUSDC: totalOwedUSDC, // Total borrowed USDC + interest that was repaid
          borrowingInterest: borrowingInterest // Interest paid on borrowed USDC
        }
      } catch (error: any) {
        console.error('Error closing position:', error)
        throw error
      } finally {
        setLoading(false)
      }
    },
    [publicKey?.toBase58(), sessionContext?.walletPublicKey?.toString(), walletContext?.publicKey?.toBase58(), positions, crucibleAddress, baseTokenSymbol]
  )

  // Calculate health factor
  const calculateHealth = useCallback(
    (collateral: number, borrowed: number): number => {
      if (borrowed === 0) return 999 // No borrow = safe
      const baseTokenPrice = 200 // SOL price
      const collateralValue = collateral * baseTokenPrice
      const health = (collateralValue / borrowed) * 100
      return health
    },
    [baseTokenSymbol]
  )

  // Calculate effective APY with leverage
  // Leveraged positions have 3x the APY of normal positions
  // Fixed 10% APY borrowing rate from lending-pool
  const calculateEffectiveAPY = useCallback(
    (baseAPY: number, leverageFactor: number): number => {
      const borrowRate = 10 // 10% APY (fixed rate from lending-pool)
      // Leveraged positions earn 3x the base APY
      const leveragedYield = baseAPY * 3 * leverageFactor
      const borrowCost = borrowRate * (leverageFactor - 1)
      return leveragedYield - borrowCost
    },
    []
  )

  // Store latest fetchPositions in ref
  useEffect(() => {
    fetchPositionsRef.current = fetchPositions
  }, [fetchPositions])

  useEffect(() => {
    if (!publicKey || !crucibleAddress) {
      setPositions([]) // Clear positions if no wallet/crucible
      return
    }
    
    // Initial fetch - use current ref value if available
    const currentFetch = fetchPositionsRef.current || fetchPositions
    currentFetch()
    
    // Listen for position opened/closed events to refetch immediately
    const handlePositionOpened = (event: CustomEvent) => {
      const detail = event.detail
      // Only refetch if the event is for this crucible/token
      if (detail?.crucibleAddress === crucibleAddress && detail?.baseTokenSymbol === baseTokenSymbol) {
        console.log('🔄 Position opened event received, refetching positions...', detail)
        setTimeout(() => {
          fetchPositionsRef.current?.()
        }, 100)
      }
    }
    
    const handlePositionClosed = (event: CustomEvent) => {
      const detail = event.detail
      // Only refetch if the event is for this crucible/token
      if (detail?.crucibleAddress === crucibleAddress && detail?.baseTokenSymbol === baseTokenSymbol) {
        console.log('🔄 Position closed event received, refetching positions...', detail)
        setTimeout(() => {
          fetchPositionsRef.current?.()
        }, 100)
      }
    }
    
    window.addEventListener('lvfPositionOpened', handlePositionOpened as EventListener)
    window.addEventListener('lvfPositionClosed', handlePositionClosed as EventListener)
    
    // Only refresh periodically, don't refetch on every render
    const interval = setInterval(() => {
      fetchPositionsRef.current?.()
    }, 30000) // Refresh every 30s
    
    return () => {
      clearInterval(interval)
      window.removeEventListener('lvfPositionOpened', handlePositionOpened as EventListener)
      window.removeEventListener('lvfPositionClosed', handlePositionClosed as EventListener)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publicKey?.toBase58(), crucibleAddress, baseTokenSymbol])

  return {
    positions,
    loading,
    openPosition,
    closePosition,
    calculateHealth,
    calculateEffectiveAPY,
    refetch: fetchPositions,
  }
}

