import { useState, useEffect, useCallback, useRef } from 'react'
import { PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY } from '@solana/web3.js'
import { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddress } from '@solana/spl-token'
import * as anchor from '@coral-xyz/anchor'
import { BN } from '@coral-xyz/anchor'
import { useWallet } from '../contexts/WalletContext'
import { getCruciblesProgram, AnchorWallet } from '../utils/anchorProgram'
import { fetchCrucibleDirect } from '../utils/crucibleFetcher'
import { deriveCruciblePDA, deriveVaultPDA, deriveLPPositionPDA, deriveUSDCVaultPDA, deriveCrucibleAuthorityPDA } from '../utils/cruciblePdas'
import { SOLANA_TESTNET_CONFIG } from '../config/solana-testnet'
import { INFERNO_CLOSE_FEE_RATE, INFERNO_YIELD_FEE_RATE } from '../config/fees'

export interface LPPosition {
  id: string
  owner: string
  baseToken: 'SOL'
  baseAmount: number // Amount of base token deposited
  usdcAmount: number // Amount of USDC deposited
  entryPrice: number
  currentValue: number // USD
  yieldEarned: number
  isOpen: boolean
  lpAPY: number // LP APY = baseAPY * 3
  pnl: number // Profit and Loss (USD)
}

interface UseLPProps {
  crucibleAddress: string
  baseTokenSymbol: 'SOL'
  baseAPY: number // Base APY for calculating LP APY (3x)
}

export function useLP({ crucibleAddress, baseTokenSymbol, baseAPY }: UseLPProps) {
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

  // Fetch LP positions
  const fetchPositions = useCallback(async () => {
    if (!publicKey || !crucibleAddress) {
      console.log('⚠️ Cannot fetch LP positions - missing publicKey or crucibleAddress')
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
          const cruciblePDA = new PublicKey(crucibleAddress)
          
          // Derive position PDA
          const [positionPDA] = deriveLPPositionPDA(publicKey, cruciblePDA)
          
          console.log('🔍 Fetching LP position from on-chain:', positionPDA.toString())
          
          // Try to fetch position account
          try {
            const positionAccount = await (program.account as any).lppositionAccount.fetch(positionPDA)
            
            if (positionAccount.isOpen) {
              // Convert on-chain position to LPPosition interface
              const baseTokenPrice = 200 // SOL price (could fetch from oracle)
              const baseAmountNum = Number(positionAccount.baseAmount) / 1e9 // Convert lamports
              const usdcAmountNum = Number(positionAccount.usdcAmount) / 1e6 // Convert USDC decimals
              
              const onChainPosition: LPPosition = {
                id: positionPDA.toString(), // Use PDA as ID for consistency
                owner: positionAccount.owner.toBase58(),
                baseToken: baseTokenSymbol,
                baseAmount: baseAmountNum,
                usdcAmount: usdcAmountNum,
                entryPrice: Number(positionAccount.entryPrice) / 1_000_000, // Convert from scaled
                currentValue: baseAmountNum * baseTokenPrice + usdcAmountNum,
                yieldEarned: 0, // TODO: Calculate from exchange rate
                isOpen: positionAccount.isOpen,
                lpAPY: baseAPY * 3, // LP APY = base APY * 3
                pnl: 0, // TODO: Calculate from price changes
              }
              
              userPositions.push(onChainPosition)
              fetchedFromChain = true
              console.log('✅ Fetched LP position from on-chain:', onChainPosition.id)
              
              // Update localStorage cache with on-chain data
              try {
                const allStoredPositions = JSON.parse(localStorage.getItem('lp_positions') || '[]')
                const existingIndex = allStoredPositions.findIndex((p: LPPosition) => p.id === onChainPosition.id)
                if (existingIndex >= 0) {
                  allStoredPositions[existingIndex] = onChainPosition
                } else {
                  allStoredPositions.push(onChainPosition)
                }
                localStorage.setItem('lp_positions', JSON.stringify(allStoredPositions))
              } catch (cacheError) {
                console.warn('Failed to update localStorage cache:', cacheError)
              }
            }
          } catch (fetchError: any) {
            // Position doesn't exist on-chain - this is valid (user has no position)
            if (fetchError?.message?.includes('Account does not exist') || 
                fetchError?.message?.includes('could not find') ||
                fetchError?.toString()?.includes('Account does not exist')) {
              console.log('📝 No on-chain LP position found for user (this is normal if no position exists)')
            } else {
              console.warn('Error fetching on-chain LP position:', fetchError)
            }
          }
        } catch (programError) {
          console.warn('Failed to initialize program for on-chain LP fetch:', programError)
        }
      }
      
      // PRIORITY 2: Fallback to localStorage ONLY if no connection available
      if (!fetchedFromChain && !walletContext?.connection) {
        console.log('📦 No connection available, falling back to localStorage cache for LP positions')
        try {
          const cachedPositions = JSON.parse(localStorage.getItem('lp_positions') || '[]')
          const walletAddress = publicKey.toBase58()
          
          const filteredPositions = cachedPositions.filter((p: LPPosition) => {
            const ownerMatch = p.owner === walletAddress || p.owner === publicKey.toString()
            const tokenMatch = p.baseToken === baseTokenSymbol
            const isOpen = p.isOpen === true
            return ownerMatch && tokenMatch && isOpen
          })
          
          userPositions.push(...filteredPositions)
          console.log('📦 Loaded', filteredPositions.length, 'LP positions from localStorage cache')
        } catch (e) {
          console.warn('Failed to load LP positions from localStorage cache:', e)
        }
      }
      
      console.log('✅ Total LP positions found:', userPositions.length, 'for', baseTokenSymbol)
      setPositions(userPositions)
    } catch (error) {
      console.error('Error fetching LP positions:', error)
      setPositions([])
    } finally {
      setLoading(false)
    }
  }, [publicKey?.toBase58(), walletContext?.connection, crucibleAddress, baseTokenSymbol, baseAPY])

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
      const baseTokenPrice = 200 // SOL price
      const baseValue = baseAmount * baseTokenPrice
      const usdcValue = usdcAmount
      const tolerance = Math.max(baseValue, usdcValue) * 0.01 // 1% tolerance

      if (Math.abs(baseValue - usdcValue) > tolerance) {
        throw new Error(`Amounts must be equal value. Base value: $${baseValue.toFixed(2)}, USDC value: $${usdcValue.toFixed(2)}`)
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
        const cruciblePDA = new PublicKey(crucibleAddress)
        const [crucibleAccountPDA] = deriveCruciblePDA(baseMint)
        
        // Verify crucible PDA matches
        if (!crucibleAccountPDA.equals(cruciblePDA)) {
          console.warn('Crucible PDA mismatch, using provided address:', crucibleAddress)
        }
        
        // Fetch crucible account to get treasury and oracle (using direct fetcher)
        let treasuryBase: PublicKey
        let treasuryUSDC: PublicKey
        let oracleAccount: PublicKey | null = null
        try {
          const crucibleAccount = await fetchCrucibleDirect(connection, cruciblePDA.toString())
          if (!crucibleAccount) {
            throw new Error('Crucible account not found')
          }
          treasuryBase = crucibleAccount.treasury
          treasuryUSDC = crucibleAccount.treasury // TODO: Separate USDC treasury or use same
          if (crucibleAccount.oracle) {
            oracleAccount = crucibleAccount.oracle
          }
        } catch (error) {
          throw new Error(`Failed to fetch crucible account: ${error}`)
        }
        
        // Derive vault PDAs
        const [baseVaultPDA] = deriveVaultPDA(cruciblePDA)
        const [usdcVaultPDA] = deriveUSDCVaultPDA(cruciblePDA)
        const [positionPDA] = deriveLPPositionPDA(currentPublicKey, cruciblePDA)
        const [crucibleAuthorityPDA] = deriveCrucibleAuthorityPDA(baseMint)
        
        // Get user token accounts
        const usdcMint = new PublicKey(SOLANA_TESTNET_CONFIG.TOKEN_ADDRESSES.USDC)
        const userBaseTokenAccount = await getAssociatedTokenAddress(baseMint, currentPublicKey)
        const userUsdcAccount = await getAssociatedTokenAddress(usdcMint, currentPublicKey)
        
        // Calculate max slippage (100 bps = 1%)
        const maxSlippageBps = 100
        
        // Convert amounts to lamports/decimals
        const baseAmountLamports = Math.floor(baseAmount * 1e9) // SOL has 9 decimals
        const usdcAmountDecimals = Math.floor(usdcAmount * 1e6) // USDC has 6 decimals
        
        // Call open_lp_position instruction
        const txSignature = await program.methods
          .openLpPosition(
            new BN(baseAmountLamports),
            new BN(usdcAmountDecimals),
            new BN(maxSlippageBps)
          )
          .accounts({
            crucible: cruciblePDA,
            user: currentPublicKey,
            baseMint: baseMint,
            userBaseTokenAccount: userBaseTokenAccount,
            userUsdcAccount: userUsdcAccount,
            crucibleBaseVault: baseVaultPDA,
            crucibleUsdcVault: usdcVaultPDA,
            position: positionPDA,
            crucibleAuthority: crucibleAuthorityPDA,
            oracle: oracleAccount,
            treasuryBase: treasuryBase,
            treasuryUsdc: treasuryUSDC,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .rpc()
        
        console.log('✅ Open LP position transaction sent:', txSignature)
        
        // Wait for confirmation
        await connection.confirmTransaction(txSignature, 'confirmed')
        console.log('✅ Transaction confirmed')
        
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
        const lpAPY = baseAPY * 3 // LP APY = base APY * 3

        const newPosition: LPPosition = {
          id: positionId,
          owner: currentPublicKey.toBase58(),
          baseToken: baseTokenSymbol,
          baseAmount,
          usdcAmount,
          entryPrice,
          currentValue: baseValue + usdcValue,
          yieldEarned: 0,
          isOpen: true,
          lpAPY,
          pnl: 0,
        }

        // IMMEDIATELY update state so portfolio sees it right away
        setPositions((prev) => {
          // Check if position already exists (avoid duplicates)
          if (prev.find(p => p.id === newPosition.id)) {
            console.log('⚠️ LP position already in state:', newPosition.id)
            return prev
          }
          const updated = [...prev, newPosition]
          console.log('✅ Added LP position to state immediately:', newPosition.id, 'Total positions:', updated.length)
          
          // Store in localStorage
          try {
            const allStoredPositions = JSON.parse(localStorage.getItem('lp_positions') || '[]')
            const existingIndex = allStoredPositions.findIndex((p: LPPosition) => p.id === newPosition.id)
            if (existingIndex >= 0) {
              allStoredPositions[existingIndex] = newPosition
            } else {
              allStoredPositions.push(newPosition)
            }
            localStorage.setItem('lp_positions', JSON.stringify(allStoredPositions))
            console.log('✅ Stored LP position:', newPosition.id)
            console.log('📊 Position details:', {
              id: newPosition.id,
              owner: newPosition.owner,
              baseToken: newPosition.baseToken,
              isOpen: newPosition.isOpen,
              baseAmount: newPosition.baseAmount,
              usdcAmount: newPosition.usdcAmount
            })
            
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
            
            // Also trigger storage event for listeners
            window.dispatchEvent(new StorageEvent('storage', {
              key: 'lp_positions',
              newValue: JSON.stringify(allStoredPositions),
              storageArea: localStorage
            }))
            
            // Force a custom event that components will catch
            window.dispatchEvent(new CustomEvent('forceRecalculateLP', {}))
            
            console.log('📢 Dispatched all events for LP position:', newPosition.id)
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
        
        // If not found in state, try loading from localStorage
        if (!position) {
          console.log('⚠️ LP position not found in state, loading from localStorage...')
          try {
            const allStoredPositions = JSON.parse(localStorage.getItem('lp_positions') || '[]')
            const storedPosition = allStoredPositions.find((p: LPPosition) => 
              p.id === positionId && 
              p.isOpen && 
              (p.owner === currentPublicKey.toBase58() || p.owner === currentPublicKey.toString())
            )
            if (storedPosition) {
              position = storedPosition
              console.log('✅ Found LP position in localStorage:', position.id)
            }
          } catch (e) {
            console.warn('Failed to load LP position from localStorage:', e)
          }
        }
        
        if (!position || !position.isOpen) {
          throw new Error('Position not found or already closed')
        }

        // Calculate APY earnings from exchange rate growth (same as unwrapTokens)
        // The cTOKENS have grown in value due to exchange rate appreciation
        const initialExchangeRate = 1.0 // Initial rate when position was opened
        const simulatedExchangeRateGrowth = 0.02 // 2% growth for demo
        const currentExchangeRate = initialExchangeRate * (1 + simulatedExchangeRateGrowth)
        const exchangeRateGrowth = currentExchangeRate - initialExchangeRate
        const baseAmountAtCurrentRate = position.baseAmount * currentExchangeRate
        const apyEarnedTokens = position.baseAmount * (exchangeRateGrowth / currentExchangeRate)
        
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
        const cruciblePDA = new PublicKey(crucibleAddress)
        
        // Fetch crucible account to get treasury (using direct fetcher)
        let treasuryBase: PublicKey
        let treasuryUSDC: PublicKey
        try {
          const crucibleAccount = await fetchCrucibleDirect(connection, cruciblePDA.toString())
          if (!crucibleAccount) {
            throw new Error('Crucible account not found')
          }
          treasuryBase = crucibleAccount.treasury
          treasuryUSDC = crucibleAccount.treasury // TODO: Separate USDC treasury or use same
        } catch (error) {
          throw new Error(`Failed to fetch crucible account: ${error}`)
        }
        
        // Derive vault PDAs
        const [baseVaultPDA] = deriveVaultPDA(cruciblePDA)
        const [usdcVaultPDA] = deriveUSDCVaultPDA(cruciblePDA)
        const [positionPDA] = deriveLPPositionPDA(currentPublicKey, cruciblePDA)
        const [crucibleAuthorityPDA] = deriveCrucibleAuthorityPDA(baseMint)
        
        // Get user token accounts
        const usdcMint = new PublicKey(SOLANA_TESTNET_CONFIG.TOKEN_ADDRESSES.USDC)
        const userBaseTokenAccount = await getAssociatedTokenAddress(baseMint, currentPublicKey)
        const userUsdcAccount = await getAssociatedTokenAddress(usdcMint, currentPublicKey)
        
        // Fetch position account to verify it exists and get bump
        let positionBump: number
        try {
            const positionAccount = await (program.account as any).lppositionAccount.fetch(positionPDA)
          if (!positionAccount.isOpen) {
            throw new Error('Position is already closed')
          }
          // Position PDA has a bump, we'll need to derive it
          const [_, bump] = deriveLPPositionPDA(currentPublicKey, cruciblePDA)
          positionBump = bump
        } catch (error) {
          throw new Error(`Position not found: ${error}`)
        }
        
        // Call close_lp_position instruction
        const txSignature = await program.methods
          .closeLpPosition()
          .accounts({
            crucible: cruciblePDA,
            user: currentPublicKey,
            position: positionPDA,
            userBaseTokenAccount: userBaseTokenAccount,
            userUsdcAccount: userUsdcAccount,
            crucibleBaseVault: baseVaultPDA,
            crucibleUsdcVault: usdcVaultPDA,
            crucibleAuthority: crucibleAuthorityPDA,
            treasuryBase: treasuryBase,
            treasuryUsdc: treasuryUSDC,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .rpc()
        
        console.log('✅ Close LP position transaction sent:', txSignature)
        
        // Wait for confirmation
        await connection.confirmTransaction(txSignature, 'confirmed')
        console.log('✅ Transaction confirmed')
        
        // Apply Forge close fees: 2% on principal, 10% on yield (calculated on-chain, using estimates for UI)
        const baseTokenPrice = 200 // SOL price
        const principalTokens = position.baseAmount
        const principalFeeTokens = principalTokens * INFERNO_CLOSE_FEE_RATE
        const yieldFeeTokens = apyEarnedTokens * INFERNO_YIELD_FEE_RATE
        const baseAmountAfterFee = (principalTokens - principalFeeTokens) + (apyEarnedTokens - yieldFeeTokens)
        const feeAmountTokens = principalFeeTokens + yieldFeeTokens
        const feeAmountUSD = feeAmountTokens * baseTokenPrice

        // Remove position
        setPositions((prev) => {
          const updated = prev.filter((p) => p.id !== positionId)
          // Update localStorage
          try {
            const allStoredPositions = JSON.parse(localStorage.getItem('lp_positions') || '[]')
            const filteredAll = allStoredPositions.filter((p: LPPosition) => p.id !== positionId)
            localStorage.setItem('lp_positions', JSON.stringify(filteredAll))
            // Dispatch event to refresh portfolio
            window.dispatchEvent(new CustomEvent('lpPositionClosed'))
          } catch (e) {
            console.warn('Failed to update LP positions:', e)
          }
          return updated
        })

        const netYieldTokens = Math.max(0, apyEarnedTokens - yieldFeeTokens)

        return { 
          success: true,
          baseAmount: baseAmountAfterFee, // Base tokens returned after fees
          apyEarned: netYieldTokens, // Net yield after Forge yield fee
          usdcAmount: position.usdcAmount, // Return deposited USDC
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

