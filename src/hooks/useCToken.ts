import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { PublicKey, Transaction, SystemProgram, SYSVAR_RENT_PUBKEY } from '@solana/web3.js'
import { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddress, NATIVE_MINT, getAccount } from '@solana/spl-token'
import { BN } from '@coral-xyz/anchor'
import { useWallet } from '../contexts/WalletContext'
import { getCruciblesProgram, AnchorWallet, buildBurnCtokenInstruction } from '../utils/anchorProgram'
import { fetchCrucibleDirect, fetchVaultBalance, fetchCTokenSupply, calculateRealExchangeRate } from '../utils/crucibleFetcher'
import { deriveCruciblePDA, deriveVaultPDA, deriveCrucibleAuthorityPDA } from '../utils/cruciblePdas'
import { SOLANA_TESTNET_CONFIG, SOLANA_TESTNET_PROGRAM_IDS, DEPLOYED_ACCOUNTS } from '../config/solana-testnet'
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
  const sessionContext: any = null // Using Solana devnet directly
  
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

  // Fetch cToken balance and exchange rate from on-chain
  const fetchBalance = useCallback(async () => {
    if (!publicKey || !crucibleAddress || !ctokenMint || !connection) return

    try {
      setLoading(true)
      
      // Get Anchor program instance
      const anchorWallet: AnchorWallet = {
        publicKey: publicKey,
        signTransaction: walletContext?.signTransaction || (async (tx: Transaction) => tx),
        signAllTransactions: walletContext?.signAllTransactions || (async (txs: Transaction[]) => txs),
      }
      const program = getCruciblesProgram(connection, anchorWallet)
      
      // Derive crucible PDA from base mint (WSOL for SOL)
      const baseMint = new PublicKey(SOLANA_TESTNET_CONFIG.TOKEN_ADDRESSES.SOL)
      const [cruciblePDA] = deriveCruciblePDA(baseMint)
      
      // Fetch crucible account to get exchange rate (using direct fetcher)
      let exchangeRate = 1.0 // Default fallback (initial exchange rate is 1.0)
      try {
        const crucibleAccount = await fetchCrucibleDirect(connection, cruciblePDA.toString())
        if (crucibleAccount) {
          // Calculate real exchange rate from vault balance / ctoken supply
          const vaultBalance = await fetchVaultBalance(connection, crucibleAccount.vault.toString())
          const ctokenSupply = await fetchCTokenSupply(connection, crucibleAccount.ctokenMint.toString())
          exchangeRate = calculateRealExchangeRate(vaultBalance, ctokenSupply)
        }
      } catch (error) {
        console.warn('Could not fetch crucible account, using default exchange rate:', error)
      }
      
      // Fetch user's cToken balance
      const ctokenMintPubkey = new PublicKey(ctokenMint)
      const userCtokenAccount = await getAssociatedTokenAddress(
        ctokenMintPubkey,
        publicKey
      )
      
      let ctokenBalance = BigInt(0)
      try {
        const balance = await connection.getTokenAccountBalance(userCtokenAccount)
        ctokenBalance = BigInt(balance.value.amount)
      } catch (error) {
        // Account might not exist yet, balance is 0
        console.log('cToken account does not exist yet, balance is 0')
      }
      
      // Calculate base balance from cToken balance and exchange rate
      const baseBalance = BigInt(Math.floor(Number(ctokenBalance) * exchangeRate))
      const estimatedValue = baseBalance
      
      setBalance({
        ctokenBalance,
        baseBalance,
        exchangeRate,
        estimatedValue,
      })
    } catch (error) {
      console.error('Error fetching cToken balance:', error)
      // Fallback if on-chain fetch fails - show zero balances with initial exchange rate
      const initialExchangeRate = 1.0
      setBalance({
        ctokenBalance: BigInt(0),
        baseBalance: BigInt(0),
        exchangeRate: initialExchangeRate,
        estimatedValue: BigInt(0),
      })
    } finally {
      setLoading(false)
    }
  }, [publicKey, crucibleAddress, ctokenMint, connection, walletContext])

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

    if (!connection || !sendTransaction) {
      throw new Error('Connection or sendTransaction not available')
    }

    setLoading(true)
    try {
      // Calculate total deposit (base + borrowed if leveraged)
      const borrowedAmount = leverageMultiplier > 1.0 
        ? BigInt(Math.floor(Number(amount) * (leverageMultiplier - 1.0)))
        : BigInt(0)

      // Get Anchor program instance
      const anchorWallet: AnchorWallet = {
        publicKey: currentPublicKey,
        signTransaction: walletContext?.signTransaction || (async (tx: Transaction) => tx),
        signAllTransactions: walletContext?.signAllTransactions || (async (txs: Transaction[]) => txs),
      }
      const program = getCruciblesProgram(connection, anchorWallet)
      
      // Derive PDAs
      const baseMint = new PublicKey(SOLANA_TESTNET_CONFIG.TOKEN_ADDRESSES.SOL) // WSOL
      const [cruciblePDA, crucibleBump] = deriveCruciblePDA(baseMint)
      const [vaultPDA, vaultBump] = deriveVaultPDA(cruciblePDA)
      const ctokenMintPubkey = new PublicKey(ctokenMint)
      
      // Fetch crucible account to get treasury address (using direct fetcher)
      let treasuryAccount: PublicKey
      try {
        const crucibleAccount = await fetchCrucibleDirect(connection, cruciblePDA.toString())
        if (!crucibleAccount) {
          throw new Error('Crucible account not found')
        }
        treasuryAccount = crucibleAccount.treasury
      } catch (error) {
        throw new Error(`Failed to fetch crucible account: ${error}`)
      }
      
      // Get user token accounts
      const userTokenAccount = await getAssociatedTokenAddress(
        baseMint,
        currentPublicKey
      )
      const userCtokenAccount = await getAssociatedTokenAddress(
        ctokenMintPubkey,
        currentPublicKey
      )
      
      // Call mintCtoken instruction
      try {
        const txSignature = await program.methods
          .mintCtoken(new BN(amount.toString()))
          .accounts({
            user: currentPublicKey,
            crucible: cruciblePDA,
            baseMint: baseMint,
            ctokenMint: ctokenMintPubkey,
            userTokenAccount: userTokenAccount,
            userCtokenAccount: userCtokenAccount,
            vault: vaultPDA,
            crucibleAuthority: cruciblePDA,
            treasury: treasuryAccount,
            tokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
            rent: SYSVAR_RENT_PUBKEY,
          })
          .rpc()
        
        console.log('✅ Mint cToken transaction sent:', txSignature)
        
        // Wait for confirmation
        await connection.confirmTransaction(txSignature, 'confirmed')
        console.log('✅ Transaction confirmed')
        
        // Update leverage position if applicable
        if (leverageMultiplier > 1.0) {
          setLeverage({
            leverage: leverageMultiplier,
            borrowedAmount,
            effectiveAPY: 0, // Will be calculated based on base APY
            riskLevel: calculateRiskLevel(leverageMultiplier),
          })
        }

        // Refresh balance
        await fetchBalance()
        
        // Return borrowed amount for transaction tracking
        return { borrowedAmount: Number(borrowedAmount) / 1e6 } // Return in USDC units
      } catch (txError: any) {
        console.error('Transaction error:', txError)
        // Parse Anchor error if available
        let errorMessage = 'Transaction failed. Please try again.'
        if (txError.logs) {
          const errorLog = txError.logs.find((log: string) => log.includes('Error'))
          if (errorLog) {
            errorMessage = errorLog
          }
        } else if (txError.message) {
          errorMessage = txError.message
        }
        throw new Error(errorMessage)
      }
    } catch (error: any) {
      console.error('Error depositing:', error)
      throw error
    } finally {
      setLoading(false)
    }
  }, [providedPublicKey, publicKey, sessionContext, walletContext, crucibleAddress, ctokenMint, connection, sendTransaction, fetchBalance])

  // Burn cToken and withdraw base tokens
  const withdraw = useCallback(async (ctokenAmount: bigint, exchangeRate?: number) => {
    // Check wallet connection with better error handling
    if (!publicKey) {
      throw new Error('Wallet not connected. Please connect your wallet first.')
    }
    
    if (!crucibleAddress || !ctokenMint) {
      throw new Error('Crucible information missing')
    }

    if (ctokenAmount <= BigInt(0)) {
      throw new Error('Amount must be greater than 0')
    }

    if (!connection) {
      throw new Error('Connection not available')
    }

    setLoading(true)
    try {
      // Calculate base tokens to return based on exchange rate
      // Use provided exchange rate or fetch from balance (initial rate is 1.0)
      const currentExchangeRate = exchangeRate || balance?.exchangeRate || 1.0
      const baseAmountBeforeFee = Number(ctokenAmount) * currentExchangeRate
      
      // Calculate unwrap fee (handled by smart contract, but we calculate for display)
      const withdrawalFeePercent = UNWRAP_FEE_RATE
      const withdrawalFee = baseAmountBeforeFee * withdrawalFeePercent
      const baseAmountAfterFee = baseAmountBeforeFee - withdrawalFee

      // Derive PDAs
      const baseMint = new PublicKey(SOLANA_TESTNET_CONFIG.TOKEN_ADDRESSES.SOL) // WSOL
      const [cruciblePDA] = deriveCruciblePDA(baseMint)
      const [vaultPDA] = deriveVaultPDA(cruciblePDA)
      const ctokenMintPubkey = new PublicKey(ctokenMint)
      const programId = new PublicKey(SOLANA_TESTNET_PROGRAM_IDS.FORGE_CRUCIBLES)
      
      // Fetch crucible account to get treasury address (using direct fetcher)
      let treasuryAccount: PublicKey
      try {
        const crucibleAccount = await fetchCrucibleDirect(connection, cruciblePDA.toString())
        if (!crucibleAccount) {
          throw new Error('Crucible account not found')
        }
        treasuryAccount = crucibleAccount.treasury
      } catch (error) {
        // Fallback to deployed treasury if crucible fetch fails
        treasuryAccount = new PublicKey(DEPLOYED_ACCOUNTS.WSOL_TREASURY)
        console.warn('Could not fetch crucible account, using deployed treasury:', treasuryAccount.toBase58())
      }
      
      // Get user token accounts
      const userCtokenAccount = await getAssociatedTokenAddress(
        ctokenMintPubkey,
        publicKey
      )
      const userTokenAccount = await getAssociatedTokenAddress(
        baseMint,
        publicKey
      )
      
      // Derive crucible authority PDA
      const [crucibleAuthorityPDA] = deriveCrucibleAuthorityPDA(baseMint)
      
      // Build burn_ctoken instruction manually (bypasses Anchor IDL parsing)
      const burnInstruction = buildBurnCtokenInstruction(
        programId,
        {
          user: publicKey,
          crucible: cruciblePDA,
          baseMint: baseMint,
          ctokenMint: ctokenMintPubkey,
          userCtokenAccount: userCtokenAccount,
          vault: vaultPDA,
          userTokenAccount: userTokenAccount,
          crucibleAuthority: crucibleAuthorityPDA,
          treasury: treasuryAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        },
        new BN(ctokenAmount.toString())
      )
      
      // Build transaction
      const transaction = new Transaction().add(burnInstruction)
      const { blockhash } = await connection.getLatestBlockhash('confirmed')
      transaction.recentBlockhash = blockhash
      transaction.feePayer = publicKey
      
      // Send transaction
      try {
        let txSignature: string
        if (walletContext?.sendTransaction) {
          txSignature = await walletContext.sendTransaction(transaction, connection)
        } else {
          throw new Error('No sendTransaction method available')
        }
        
        console.log('✅ Burn cToken transaction sent:', txSignature)
        
        // Wait for confirmation
        await connection.confirmTransaction(txSignature, 'confirmed')
        console.log('✅ Transaction confirmed')

        // Get actual WSOL amount received from the contract (after fee)
        // Check BEFORE unwrapping to get the exact amount the contract returned
        let actualBaseAmountReceived = 0
        let actualFeeCharged = 0
        try {
          const userWSOLAccount = await getAssociatedTokenAddress(baseMint, publicKey)
          const wsolAccountInfo = await getAccount(connection, userWSOLAccount)
          actualBaseAmountReceived = Number(wsolAccountInfo.amount) / 1e9 // Convert lamports to SOL
          console.log(`💰 Actual WSOL received from contract: ${actualBaseAmountReceived} SOL`)
          
          // Calculate actual fee charged by contract
          // Contract charges 0.75% unwrap fee on base_to_return_before_fee
          // Contract returns: base_to_return = base_to_return_before_fee - unwrap_fee
          // So: base_to_return_before_fee = base_to_return / (1 - unwrap_fee_rate)
          // And: unwrap_fee = base_to_return_before_fee - base_to_return
          const actualBaseBeforeFee = actualBaseAmountReceived / (1 - UNWRAP_FEE_RATE)
          actualFeeCharged = actualBaseBeforeFee - actualBaseAmountReceived

          console.log('💰 Contract fee calculation:', {
            actualBaseAmountReceived,
            actualBaseBeforeFee,
            actualFeeCharged,
            feePercent: (actualFeeCharged / actualBaseBeforeFee) * 100,
            contractFeeRate: UNWRAP_FEE_RATE * 100 + '%'
          })
        } catch (error: any) {
          // If account doesn't exist or fetch fails, use calculated value
          console.warn('Could not fetch WSOL account, using calculated value:', error)
          actualBaseAmountReceived = baseAmountAfterFee
          actualFeeCharged = withdrawalFee
        }

        // Clear leverage if withdrawing everything
        if (balance && ctokenAmount >= balance.ctokenBalance) {
          setLeverage(null)
        }

        // Refresh balance
        await fetchBalance()
        
        // Return actual fee information from contract
        return {
          baseAmount: actualBaseAmountReceived, // Actual amount received (after contract fee)
          fee: actualFeeCharged, // Actual fee charged by contract
          feePercent: (actualFeeCharged / actualBaseBeforeFee) * 100 || (UNWRAP_FEE_RATE * 100)
        }
      } catch (txError: any) {
        console.error('Transaction error:', txError)
        // Parse Anchor error if available
        let errorMessage = 'Transaction failed. Please try again.'
        if (txError.logs) {
          const errorLog = txError.logs.find((log: string) => log.includes('Error'))
          if (errorLog) {
            errorMessage = errorLog
          }
        } else if (txError.message) {
          errorMessage = txError.message
        }
        throw new Error(errorMessage)
      }
    } catch (error) {
      console.error('Error withdrawing:', error)
      throw error
    } finally {
      setLoading(false)
    }
  }, [publicKey, crucibleAddress, ctokenMint, balance, connection, walletContext, fetchBalance])

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

