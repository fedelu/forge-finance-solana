import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { PublicKey, Transaction } from '@solana/web3.js'
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddress } from '@solana/spl-token'
import { useWallet } from '../contexts/WalletContext'
// Removed useSession - using useWallet directly
import { UNWRAP_FEE_RATE } from '../config/fees'

interface CTokenBalance {
  ctokenBalance: bigint
  baseBalance: bigint
  exchangeRate: number // 1 cToken = exchangeRate base tokens
  estimatedValue: bigint // Current value in base tokens
}

interface LeveragePosition {
  leverage: number // 1x, 1.5x, 2x, 3x
  borrowedAmount: bigint
  effectiveAPY: number
  riskLevel: 'low' | 'medium' | 'high' | 'critical'
}

export function useCToken(crucibleAddress?: string, ctokenMint?: string, providedPublicKey?: PublicKey | string) {
  // React hooks must be called unconditionally at the top level
  // Try to get contexts, but accept publicKey as parameter if provided
  let walletContext: any = null
  const sessionContext: any = null // Removed FOGO Sessions - using Solana devnet directly
  
  try {
    walletContext = useWallet()
  } catch (e) {
    // useWallet throws if WalletProvider is not mounted  
    // This is fine - we'll just not use it
  }

  // Determine which wallet context to use
  // Prioritize provided publicKey, then WalletContext
  let publicKey: PublicKey | null = null
  
  // First, use provided publicKey if available
  if (providedPublicKey) {
    try {
      if (providedPublicKey instanceof PublicKey) {
        publicKey = providedPublicKey
      } else if (typeof providedPublicKey === 'string') {
        publicKey = new PublicKey(providedPublicKey)
      }
    } catch (e) {
      console.warn('Invalid provided public key:', e, providedPublicKey)
    }
  }
  
  // Fallback to contexts if publicKey not provided
  // Use WalletContext for wallet connection
  if (!publicKey && sessionContext?.walletPublicKey) {
    try {
      if (sessionContext.walletPublicKey instanceof PublicKey) {
        publicKey = sessionContext.walletPublicKey
      } else if (typeof sessionContext.walletPublicKey === 'string') {
        publicKey = new PublicKey(sessionContext.walletPublicKey)
      }
    } catch (e) {
      console.warn('Invalid public key from wallet:', e)
    }
  }
  
  // Final fallback to wallet context
  if (!publicKey && walletContext?.publicKey) {
    publicKey = walletContext.publicKey
  }
  
  const sendTransaction: ((tx: Transaction) => Promise<string>) | undefined = 
    walletContext?.sendTransaction || sessionContext?.sendTransaction
  const connection: any = walletContext?.connection || null

  const [balance, setBalance] = useState<CTokenBalance | null>(null)
  const [leverage, setLeverage] = useState<LeveragePosition | null>(null)
  const [loading, setLoading] = useState(false)
  
  // Use ref to store latest fetchBalance callback
  const fetchBalanceRef = useRef<(() => Promise<void>) | null>(null)

  // Fetch cToken balance and exchange rate
  const fetchBalance = useCallback(async () => {
    if (!publicKey || !crucibleAddress || !ctokenMint) return

    try {
      setLoading(true)
      // In production, fetch from on-chain
      // For now, mock the data structure
      // Initial exchange rate is 1.045 (1 cToken = 1.045 base tokens)
      const initialExchangeRate = 1.045
      const mockCTokenBalance = BigInt(1000 * 1e6) // 1000 cTokens (6 decimals)
      
      setBalance({
        ctokenBalance: mockCTokenBalance,
        baseBalance: BigInt(Math.floor(Number(mockCTokenBalance) * initialExchangeRate)),
        exchangeRate: initialExchangeRate,
        estimatedValue: BigInt(Math.floor(Number(mockCTokenBalance) * initialExchangeRate)),
      })
    } catch (error) {
      console.error('Error fetching cToken balance:', error)
    } finally {
      setLoading(false)
    }
  }, [publicKey, crucibleAddress, ctokenMint])

  // Mint cToken by depositing base tokens
  const deposit = useCallback(async (amount: bigint, leverageMultiplier: number = 1.0) => {
    // Check publicKey - prioritize SESSION CONTEXT FIRST (most reliable), then providedPublicKey, then hook-level publicKey
    let currentPublicKey: PublicKey | null = null
    
    // FIRST PRIORITY: Check session context - it's the main wallet system and always up-to-date
    if (sessionContext?.walletPublicKey) {
      try {
        if (sessionContext.walletPublicKey instanceof PublicKey) {
          currentPublicKey = sessionContext.walletPublicKey
          console.log('✅ Using walletPublicKey from sessionContext:', currentPublicKey.toString())
        } else if (typeof sessionContext.walletPublicKey === 'string') {
          currentPublicKey = new PublicKey(sessionContext.walletPublicKey)
          console.log('✅ Converted walletPublicKey string from sessionContext:', currentPublicKey.toString())
        } else if (typeof sessionContext.walletPublicKey === 'object' && sessionContext.walletPublicKey !== null) {
          // Handle serialized PublicKey object (e.g., {_bn: ...})
          if ('_bn' in sessionContext.walletPublicKey || 'toBase58' in sessionContext.walletPublicKey || 'toString' in sessionContext.walletPublicKey) {
            const pkString = sessionContext.walletPublicKey.toString ? sessionContext.walletPublicKey.toString() : 
                            sessionContext.walletPublicKey.toBase58 ? sessionContext.walletPublicKey.toBase58() : 
                            String(sessionContext.walletPublicKey)
            currentPublicKey = new PublicKey(pkString)
            console.log('✅ Converted walletPublicKey object from sessionContext:', currentPublicKey.toString())
          }
        }
      } catch (e) {
        console.warn('Error parsing session wallet public key:', e, sessionContext.walletPublicKey)
      }
    }
    
    // SECOND PRIORITY: Try providedPublicKey (passed from component)
    if (!currentPublicKey && providedPublicKey) {
      try {
        if (providedPublicKey instanceof PublicKey) {
          currentPublicKey = providedPublicKey
          console.log('✅ Using providedPublicKey:', currentPublicKey.toString())
        } else if (typeof providedPublicKey === 'string') {
          currentPublicKey = new PublicKey(providedPublicKey)
          console.log('✅ Converted providedPublicKey string:', currentPublicKey.toString())
        }
      } catch (e) {
        console.warn('Invalid provided public key:', e, providedPublicKey)
      }
    }
    
    // THIRD PRIORITY: Fallback to hook-level publicKey (from hook initialization)
    if (!currentPublicKey && publicKey) {
      currentPublicKey = publicKey
      console.log('✅ Using hook-level publicKey:', currentPublicKey.toString())
    }
    
    // FOURTH PRIORITY: Fallback to wallet context
    if (!currentPublicKey && walletContext?.publicKey) {
      currentPublicKey = walletContext.publicKey
      console.log('✅ Using walletContext publicKey:', currentPublicKey.toString())
    }
    
    // Final check - if still null, throw error with helpful debug info
    if (!currentPublicKey) {
      const debugInfo = {
        providedPublicKey: providedPublicKey?.toString?.() || providedPublicKey || 'undefined',
        hookPublicKey: publicKey?.toString?.() || publicKey || 'null',
        sessionContextExists: !!sessionContext,
        sessionContextType: typeof sessionContext,
        sessionWalletPublicKey: sessionContext?.walletPublicKey?.toString?.() || sessionContext?.walletPublicKey || 'undefined',
        sessionWalletPublicKeyType: typeof sessionContext?.walletPublicKey,
        walletContextExists: !!walletContext,
        walletContextPublicKey: walletContext?.publicKey?.toString?.() || walletContext?.publicKey || 'undefined'
      }
      console.error('❌ Wallet connection check failed:', debugInfo)
      throw new Error('Wallet not connected. Please connect your wallet first.')
    }
    
    console.log('✅ Wallet connection verified:', currentPublicKey.toString())
    
    if (!crucibleAddress || !ctokenMint) {
      throw new Error('Crucible information missing')
    }

    if (amount <= BigInt(0)) {
      throw new Error('Amount must be greater than 0')
    }

    setLoading(true)
    try {
      // Calculate total deposit (base + borrowed if leveraged)
      const borrowedAmount = leverageMultiplier > 1.0 
        ? BigInt(Math.floor(Number(amount) * (leverageMultiplier - 1.0)))
        : BigInt(0)

      // TODO: In production, create and send mint_ctoken instruction
      // For now, simulate the operation with proper error handling
      try {
        // Simulate transaction delay
        await new Promise((resolve, reject) => {
          setTimeout(() => {
            // Simulate occasional failures for demo purposes
            if (Math.random() < 0.1) {
              reject(new Error('Transaction simulation failed. Please try again.'))
            } else {
              resolve(null)
            }
          }, 1500)
        })

        // Update leverage position if applicable
        if (leverageMultiplier > 1.0) {
          setLeverage({
            leverage: leverageMultiplier,
            borrowedAmount,
            effectiveAPY: 0, // Will be calculated based on base APY
            riskLevel: calculateRiskLevel(leverageMultiplier),
          })
        }

        await fetchBalance()
        
        // Return borrowed amount for transaction tracking
        return { borrowedAmount: Number(borrowedAmount) / 1e6 } // Return in USDC units
      } catch (txError: any) {
        console.error('Transaction error:', txError)
        throw new Error(txError.message || 'Transaction failed. Please try again.')
      }
    } catch (error: any) {
      console.error('Error depositing:', error)
      throw error
    } finally {
      setLoading(false)
    }
  }, [providedPublicKey, publicKey, sessionContext, walletContext, crucibleAddress, ctokenMint, sendTransaction, fetchBalance])

  // Burn cToken and withdraw base tokens
  const withdraw = useCallback(async (ctokenAmount: bigint, exchangeRate?: number) => {
    // Check wallet connection with better error handling
    if (!publicKey) {
      throw new Error('Wallet not connected. Please connect your wallet first.')
    }
    
    if (!crucibleAddress) {
      throw new Error('Crucible information missing')
    }

    if (ctokenAmount <= BigInt(0)) {
      throw new Error('Amount must be greater than 0')
    }

    setLoading(true)
    try {
      // Calculate base tokens to return based on exchange rate
      // Use provided exchange rate or fetch from balance
      const currentExchangeRate = exchangeRate || balance?.exchangeRate || 1.045
      const baseAmountBeforeFee = Number(ctokenAmount) * currentExchangeRate
      
      // Calculate Forge unwrap fee
      const withdrawalFeePercent = UNWRAP_FEE_RATE
      const withdrawalFee = baseAmountBeforeFee * withdrawalFeePercent
      const baseAmountAfterFee = baseAmountBeforeFee - withdrawalFee

      // TODO: In production, create and send burn_ctoken instruction
      // const transaction = new Transaction()
      // transaction.add(burnCTokenInstruction(...))
      // const signature = await sendTransaction(transaction, connection)
      // await connection.confirmTransaction(signature)

      // For now, simulate
      await new Promise(resolve => setTimeout(resolve, 1000))

      // Clear leverage if withdrawing everything
      if (balance && ctokenAmount >= balance.ctokenBalance) {
        setLeverage(null)
      }

      await fetchBalance()
      
      // Return fee information for display
      return {
        baseAmount: baseAmountAfterFee,
        fee: withdrawalFee,
        feePercent: withdrawalFeePercent * 100
      }
    } catch (error) {
      console.error('Error withdrawing:', error)
      throw error
    } finally {
      setLoading(false)
    }
  }, [publicKey, crucibleAddress, balance, sendTransaction, fetchBalance])

  // Calculate effective APY with leverage
  // Leveraged positions have 3x the APY of normal positions
  const calculateEffectiveAPY = useCallback((baseAPY: number, leverageMultiplier: number): number => {
    // Leveraged positions earn 3x the base APY
    // Effective APY = (Base APY * 3 * Leverage) - (Borrow Rate * (Leverage - 1))
    const borrowRate = 0.05 // 5% annual borrow rate (matches lending pool)
    const leveragedYield = baseAPY * 3 * leverageMultiplier
    const borrowCost = borrowRate * (leverageMultiplier - 1) * 100 // Convert to percentage
    return leveragedYield - borrowCost
  }, [])

  // Store latest fetchBalance in ref
  useEffect(() => {
    fetchBalanceRef.current = fetchBalance
  }, [fetchBalance])

  useEffect(() => {
    if (!publicKey || !crucibleAddress || !ctokenMint) return
    
    // Use current ref value if available, otherwise call directly
    const currentFetch = fetchBalanceRef.current || fetchBalance
    currentFetch()
    
    const interval = setInterval(() => {
      fetchBalanceRef.current?.()
    }, 30000) // Refresh every 30s
    return () => clearInterval(interval)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publicKey?.toBase58(), crucibleAddress, ctokenMint])

  return {
    balance,
    leverage,
    loading,
    deposit,
    withdraw,
    calculateEffectiveAPY,
    refetch: fetchBalance,
  }
}

function calculateRiskLevel(leverage: number): 'low' | 'medium' | 'high' | 'critical' {
  if (leverage <= 1.5) return 'low'
  if (leverage <= 2.0) return 'medium'
  if (leverage <= 3.0) return 'high'
  return 'critical'
}

