import { useState, useEffect, useCallback, useRef } from 'react'
import { PublicKey } from '@solana/web3.js'
import { useWallet } from '../contexts/WalletContext'
import { useSession } from '../components/FogoSessions'
import { INFERNO_CLOSE_FEE_RATE, INFERNO_YIELD_FEE_RATE } from '../config/fees'

export interface LPPosition {
  id: string
  owner: string
  baseToken: string // 'FOGO' or 'FORGE'
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
  baseTokenSymbol: 'SOL' | 'FORGE'
  baseAPY: number // Base APY for calculating LP APY (3x)
}

export function useLP({ crucibleAddress, baseTokenSymbol, baseAPY }: UseLPProps) {
  // Check wallet connection
  let walletContext: any = null
  let sessionContext: any = null
  
  try {
    sessionContext = useSession()
  } catch (e) {
    // Fogo Sessions not available
  }
  
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
        console.warn('Invalid public key from Fogo Sessions:', e)
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
      return
    }

    try {
      setLoading(true)
      // TODO: In production, fetch from on-chain
      // For now, fetch from localStorage
      try {
        const storedPositions = JSON.parse(localStorage.getItem('lp_positions') || '[]')
        console.log('📊 All stored LP positions:', storedPositions.length)
        console.log('🔍 Looking for LP positions with:', {
          owner: publicKey.toBase58(),
          baseToken: baseTokenSymbol
        })
        
        // Check both owner formats to handle different wallet address formats
        const walletAddress = publicKey.toBase58()
        const userPositions = storedPositions.filter((p: LPPosition) => {
          const ownerMatch = p.owner === walletAddress || p.owner === publicKey.toString()
          const tokenMatch = p.baseToken === baseTokenSymbol
          const isOpen = p.isOpen === true // Strict check
          
          console.log('🔍 Checking LP position:', {
            id: p.id,
            owner: p.owner,
            ownerMatch,
            baseToken: p.baseToken,
            tokenMatch,
            isOpen,
            matches: ownerMatch && tokenMatch && isOpen
          })
          
          return ownerMatch && tokenMatch && isOpen
        })
        
        console.log('✅ Found', userPositions.length, 'matching LP positions')
        setPositions(userPositions)
      } catch (e) {
        console.warn('Failed to load LP positions from storage:', e)
        setPositions([])
      }
    } catch (error) {
      console.error('Error fetching LP positions:', error)
    } finally {
      setLoading(false)
    }
  }, [publicKey, crucibleAddress, baseTokenSymbol])

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
      const baseTokenPrice = baseTokenSymbol === 'FOGO' ? 0.5 : 0.002
      const baseValue = baseAmount * baseTokenPrice
      const usdcValue = usdcAmount
      const tolerance = Math.max(baseValue, usdcValue) * 0.01 // 1% tolerance

      if (Math.abs(baseValue - usdcValue) > tolerance) {
        throw new Error(`Amounts must be equal value. Base value: $${baseValue.toFixed(2)}, USDC value: $${usdcValue.toFixed(2)}`)
      }

      setLoading(true)
      try {
        // TODO: In production, create and send open_lp_position instruction
        await new Promise((resolve) => setTimeout(resolve, 1500))

        const entryPrice = baseTokenPrice
        const lpAPY = baseAPY * 3 // LP APY = base APY * 3

        const newPosition: LPPosition = {
          id: `lp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
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
              fetchPositions()
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
            
            // Force a custom event that FogoSessions will catch
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
    [publicKey, sessionContext, walletContext, crucibleAddress, baseTokenSymbol, baseAPY, sendTransaction, connection]
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
        const initialExchangeRate = 1.045 // Initial rate when position was opened
        const simulatedExchangeRateGrowth = 0.02 // 2% growth for demo
        const currentExchangeRate = initialExchangeRate * (1 + simulatedExchangeRateGrowth)
        const exchangeRateGrowth = currentExchangeRate - initialExchangeRate
        const baseAmountAtCurrentRate = position.baseAmount * currentExchangeRate
        const apyEarnedTokens = position.baseAmount * (exchangeRateGrowth / currentExchangeRate)
        
        // Apply Forge close fees: 2% on principal, 10% on yield
        const baseTokenPrice = baseTokenSymbol === 'FOGO' ? 0.5 : 0.002
        const principalTokens = position.baseAmount
        const principalFeeTokens = principalTokens * INFERNO_CLOSE_FEE_RATE
        const yieldFeeTokens = apyEarnedTokens * INFERNO_YIELD_FEE_RATE
        const baseAmountAfterFee = (principalTokens - principalFeeTokens) + (apyEarnedTokens - yieldFeeTokens)
        const feeAmountTokens = principalFeeTokens + yieldFeeTokens
        const feeAmountUSD = feeAmountTokens * baseTokenPrice

        // TODO: In production, create and send close_lp_position instruction
        await new Promise((resolve) => setTimeout(resolve, 1500))

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
    [publicKey, sessionContext, walletContext, positions, sendTransaction, connection]
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

