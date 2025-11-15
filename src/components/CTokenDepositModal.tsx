import React, { useState, useMemo } from 'react'
import { XMarkIcon, ArrowUpIcon, FireIcon, ChartBarIcon, BoltIcon } from '@heroicons/react/24/outline'
import { PublicKey } from '@solana/web3.js'
import { useCToken } from '../hooks/useCToken'
import { useLP } from '../hooks/useLP'
import { useLVFPosition } from '../hooks/useLVFPosition'
import { useAnalytics } from '../contexts/AnalyticsContext'
import { useWallet } from '../contexts/WalletContext'
import { useBalance } from '../contexts/BalanceContext'
import { lendingPool } from '../contracts/lendingPool'
import { useCrucible } from '../hooks/useCrucible'
import { WRAP_FEE_RATE, INFERNO_OPEN_FEE_RATE } from '../config/fees'

interface CTokenDepositModalProps {
  isOpen: boolean
  onClose: () => void
  crucibleAddress: string
  ctokenMint: string
  baseTokenSymbol: string
  ctokenSymbol: string
  currentAPY: number
}

type Mode = 'wrap' | 'lp'
type Leverage = 1 | 1.5 | 2

export default function CTokenDepositModal({
  isOpen,
  onClose,
  crucibleAddress,
  ctokenMint,
  baseTokenSymbol,
  ctokenSymbol,
  currentAPY,
}: CTokenDepositModalProps) {
  const [mode, setMode] = useState<Mode>('wrap')
  const [amount, setAmount] = useState('')
  const [leverage, setLeverage] = useState<Leverage>(1)
  const [submitting, setSubmitting] = useState(false)
  const { addTransaction } = useAnalytics()
  const { connected, publicKey } = useWallet()
  const { balances, getBalance, subtractFromBalance, addToBalance } = useBalance()
  const { getCrucible } = useCrucible()
  const displayPairSymbol = ctokenSymbol.replace(/^c/i, 'if')
  
  // Use connected wallet public key for hooks
  const publicKeyForHook = useMemo(() => {
    if (!publicKey) return undefined
    return publicKey
  }, [publicKey])
  
  const { deposit, loading: depositLoading } = useCToken(crucibleAddress, ctokenMint, publicKeyForHook)
  const { wrapTokens, unwrapTokens, trackLeveragedPosition } = useCrucible()
  const { openPosition: openLPPosition, loading: lpLoading } = useLP({
    crucibleAddress,
    baseTokenSymbol: baseTokenSymbol as 'SOL' | 'FORGE',
    baseAPY: currentAPY,
  })
  const { openPosition: openLeveragedPosition, loading: leveragedLoading } = useLVFPosition({
    crucibleAddress,
    baseTokenSymbol: baseTokenSymbol as 'SOL' | 'FORGE',
  })

  const baseTokenPrice = baseTokenSymbol === 'FORGE' ? 0.002 : 200
  const baseTokenBalance = getBalance(baseTokenSymbol)
  const usdcBalance = getBalance('USDC')
  const loading = depositLoading || lpLoading || leveragedLoading || submitting
const parsedAmount = amount ? parseFloat(amount) : 0
const infernoOpenFee = mode === 'lp' ? parsedAmount * INFERNO_OPEN_FEE_RATE : 0
const baseAmountForPosition = mode === 'lp' ? Math.max(0, parsedAmount - infernoOpenFee) : parsedAmount

  // Calculate USDC needed for LP positions
  const calculateUSDCNeeded = (baseAmount: number, leverageValue: number): { totalUSDC: number, depositUSDC: number, borrowUSDC: number } => {
    const baseValueUSD = baseAmount * baseTokenPrice
    if (leverageValue === 1) {
      // 1x: deposit 100% USDC, borrow 0%
      return {
        totalUSDC: baseValueUSD,
        depositUSDC: baseValueUSD,
        borrowUSDC: 0
      }
    } else if (leverageValue === 1.5) {
      // 1.5x: deposit 50% USDC, borrow 50%
      const halfBaseValue = baseValueUSD / 2
      return {
        totalUSDC: baseValueUSD,
        depositUSDC: halfBaseValue,
        borrowUSDC: halfBaseValue
      }
    } else {
      // 2x: deposit 0% USDC, borrow 100%
      return {
        totalUSDC: baseValueUSD,
        depositUSDC: 0,
        borrowUSDC: baseValueUSD
      }
    }
  }

  // Auto-calculate USDC when base amount or leverage changes (LP mode only)
  const handleMax = () => {
    if (mode === 'wrap') {
      setAmount(baseTokenBalance.toString())
    } else {
      // For LP mode, use max of available balances
      const maxBase = baseTokenBalance
      const maxUSDC = usdcBalance
      // For 1x leverage, limited by the smaller of base token value or USDC
      if (leverage === 1) {
        const maxBaseValueUSD = maxBase * baseTokenPrice
        const maxPossible = Math.min(maxBase, maxUSDC / baseTokenPrice)
        setAmount(maxPossible.toString())
      } else {
        // For leveraged, limited by base token (will borrow USDC)
        setAmount(maxBase.toString())
      }
    }
  }

  const handleSubmit = async () => {
    if (!connected || !publicKey) {
      alert('⚠️ Wallet not connected!\n\nPlease connect your Phantom wallet first.')
      return
    }

    if (!amount || parseFloat(amount) <= 0) {
      alert('Please enter a valid amount')
      return
    }

    if (submitting) {
      return
    }

    setSubmitting(true)
    
    try {
      if (mode === 'wrap') {
        // Wrap mode: Mint cToken using wrapTokens from useCrucible
        const depositAmount = parseFloat(amount)
        
        // Call wrapTokens which handles the deposit and cToken minting with Forge fee
        await wrapTokens(crucibleAddress, depositAmount.toString())
        
        // Update wallet balances AFTER wrapTokens completes
        subtractFromBalance(baseTokenSymbol, depositAmount)
        
        // Calculate cTokens received based on exchange rate (after fee)
        const feeAmount = depositAmount * WRAP_FEE_RATE
        const netAmount = depositAmount - feeAmount
        const ctokensReceived = netAmount / 1.045 // Based on initial exchange rate
        addToBalance(ctokenSymbol, ctokensReceived)
        
        // Dispatch event to refresh portfolio
        window.dispatchEvent(new CustomEvent('wrapPositionOpened', { 
          detail: { crucibleAddress, baseTokenSymbol } 
        }))
        
        addTransaction({
          type: 'deposit',
          amount: depositAmount,
          token: baseTokenSymbol,
          crucibleId: crucibleAddress,
        })
      } else {
        // LP mode
        const baseAmt = parseFloat(amount)
        const openFeeAmount = baseAmt * INFERNO_OPEN_FEE_RATE
        const baseForPosition = baseAmt - openFeeAmount

        if (baseForPosition <= 0) {
          alert('Amount too small after applying the Forge open fee.')
          return
        }

        const usdcDetails = calculateUSDCNeeded(baseForPosition, leverage)
        
        if (leverage === 1) {
          // Standard LP: deposit equal USDC
          if (usdcDetails.depositUSDC > usdcBalance) {
            alert(`Insufficient USDC balance. You need ${usdcDetails.depositUSDC.toFixed(2)} USDC but only have ${usdcBalance.toFixed(2)} USDC.`)
            return
          }
          
          // Check base token balance
          if (baseAmt > baseTokenBalance) {
            alert(`Insufficient ${baseTokenSymbol} balance. You need ${baseAmt.toFixed(2)} ${baseTokenSymbol} but only have ${baseTokenBalance.toFixed(2)} ${baseTokenSymbol}.`)
            return
          }
          
          await openLPPosition(baseForPosition, usdcDetails.depositUSDC)
          
          // Track this position in userBalances for exchange rate growth (same as normal wrap)
          // This allows cToken price to increase over time
          trackLeveragedPosition(crucibleAddress, baseForPosition)
          
          // Subtract tokens from wallet balance
          subtractFromBalance(baseTokenSymbol, baseAmt)
          subtractFromBalance('USDC', usdcDetails.depositUSDC)
          
          // Add LP tokens to wallet (calculate LP token amount)
          const crucible = getCrucible(crucibleAddress)
          const lpTokenSymbol = crucible ? `${crucible.ptokenSymbol}/USDC LP` : `${baseTokenSymbol}/USDC LP`
          // Calculate LP tokens: baseAmount becomes cToken via exchange rate, then sqrt(cToken * USDC)
          const cTokenAmount = baseForPosition * 1.045 // Exchange rate to get cToken amount
          const lpTokenAmount = Math.sqrt(cTokenAmount * usdcDetails.depositUSDC) // Constant product formula
          addToBalance(lpTokenSymbol, lpTokenAmount)
          
          // Force immediate wallet balance recalculation
          setTimeout(() => {
            window.dispatchEvent(new CustomEvent('lpPositionOpened', { 
              detail: { crucibleAddress, baseTokenSymbol } 
            }))
          }, 100)
          
          // Add transaction to analytics
          addTransaction({
            type: 'deposit',
            amount: baseForPosition + usdcDetails.depositUSDC,
            token: baseTokenSymbol,
            crucibleId: crucibleAddress,
            usdValue: (baseForPosition * baseTokenPrice) + usdcDetails.depositUSDC,
          })
          
          // Dispatch event
          window.dispatchEvent(new CustomEvent('lpPositionOpened', { 
            detail: { crucibleAddress, baseTokenSymbol } 
          }))
        } else {
          // Leveraged LP: deposit + borrow USDC
          // First check if user has enough for deposit part
          if (usdcDetails.depositUSDC > 0 && usdcDetails.depositUSDC > usdcBalance) {
            alert(`Insufficient USDC balance. You need ${usdcDetails.depositUSDC.toFixed(2)} USDC for deposit but only have ${usdcBalance.toFixed(2)} USDC.`)
            return
          }
          
          // Subtract USDC deposit from wallet balance
          if (usdcDetails.depositUSDC > 0) {
            subtractFromBalance('USDC', usdcDetails.depositUSDC)
          }
          
          // Check if we can borrow the needed amount
          if (usdcDetails.borrowUSDC > 0) {
            const availableLiquidity = lendingPool.getAvailableLiquidity()
            if (usdcDetails.borrowUSDC > availableLiquidity) {
              alert(`Insufficient liquidity. Available: ${availableLiquidity.toFixed(2)} USDC`)
              return
            }
            
            const borrowResult = lendingPool.borrow(usdcDetails.borrowUSDC)
            if (!borrowResult.success) {
              alert(`Borrowing failed: ${borrowResult.error || 'Insufficient liquidity'}`)
              return
            }
          }
          
          // Subtract base tokens from wallet
          subtractFromBalance(baseTokenSymbol, baseAmt)
          
          // For leveraged LP, we still create an LP position but with borrowed USDC
          // The leverage factor is passed to track it
          console.log('📞 Calling openLeveragedPosition with:', { collateralAmount: baseAmt, leverage, crucibleAddress, baseTokenSymbol, openFeeAmount })
          await openLeveragedPosition(baseAmt, leverage)
          console.log('✅ openLeveragedPosition completed')
          
          // Track this position in userBalances for exchange rate growth (same as normal wrap)
          // This allows cToken price to increase over time
          // NOTE: Does NOT add to ptokenBalance - cTOKENS are locked in LP
          trackLeveragedPosition(crucibleAddress, baseForPosition)
          
          // DON'T add LP tokens here - let FogoSessions calculate them from localStorage
          // This ensures consistency and prevents double counting
          console.log('✅ Position opened - FogoSessions will calculate LP tokens from localStorage')

          // Add transaction to analytics
          addTransaction({
            type: 'deposit',
            amount: baseForPosition + usdcDetails.depositUSDC,
            token: baseTokenSymbol,
            crucibleId: crucibleAddress,
            borrowedAmount: usdcDetails.borrowUSDC,
            leverage: leverage,
            usdValue: (baseForPosition * baseTokenPrice) + usdcDetails.depositUSDC + usdcDetails.borrowUSDC,
          })
          
          // Events are dispatched from useLVFPosition hook immediately after localStorage update
          // No need to dispatch here - the hook handles it
        }
      }
      
      onClose()
      setAmount('')
      setMode('wrap')
      setLeverage(1)
    } catch (error: any) {
      console.error('Transaction error:', error)
      alert(error.message || 'Transaction failed. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  if (!isOpen) return null

  const baseValueUSD = amount ? parseFloat(amount) * baseTokenPrice : 0
  const usdcDetails = mode === 'lp' && baseAmountForPosition > 0
    ? calculateUSDCNeeded(baseAmountForPosition, leverage)
    : { totalUSDC: 0, depositUSDC: 0, borrowUSDC: 0 }
  const hasEnoughUSDC = leverage === 1 ? usdcDetails.depositUSDC <= usdcBalance : true // Leveraged positions borrow, so no balance check needed
  const effectiveAPY = mode === 'lp' 
    ? leverage === 1 
      ? currentAPY * 3 // 3x for standard LP
      : (currentAPY * 3 * leverage) - (5 * (leverage - 1)) // Leveraged APY
    : currentAPY

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-md animate-fade-in px-4">
      <div className="panel rounded-3xl w-full max-w-2xl relative animate-scale-in max-h-[90vh] overflow-y-auto p-6">
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-5 right-5 text-fogo-gray-400 hover:text-white transition-all duration-200 p-2 rounded-lg hover:bg-black/40 z-10"
          aria-label="Close modal"
        >
          <XMarkIcon className="w-5 h-5" />
        </button>

        {/* Header - Compact */}
        <div className="mb-4">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl bg-gradient-to-br flex items-center justify-center border ${
              mode === 'wrap' 
                ? 'from-fogo-primary/30 to-fogo-primary/10 border-fogo-primary/20'
                : 'from-orange-500/30 to-orange-500/10 border-orange-500/20'
            }`}>
              {mode === 'wrap' ? (
                <FireIcon className="w-5 h-5 text-fogo-primary" />
              ) : (
                <BoltIcon className="w-5 h-5 text-orange-400" />
              )}
            </div>
            <div>
              <h2 className="text-xl font-heading text-white">Open Position</h2>
              <p className="text-fogo-gray-400 text-xs">
                {mode === 'wrap' ? `Deposit ${baseTokenSymbol} to mint ${ctokenSymbol}` : 'Leveraged position with borrowed USDC'}
              </p>
            </div>
          </div>
        </div>

        {/* Mode Toggle - Compact */}
        <div className="mb-4">
          <div className="grid grid-cols-2 gap-2 p-1 panel-muted rounded-2xl border border-fogo-gray-700/50">
            <button
              onClick={() => {
                setMode('wrap')
              }}
              className={`px-5 py-3 text-sm rounded-xl font-heading uppercase tracking-[0.18em] transition-all duration-300 relative overflow-hidden ${
                mode === 'wrap'
                  ? 'bg-gradient-to-r from-fogo-primary to-fogo-primary-light text-white shadow-lg shadow-fogo-primary/30'
                  : 'text-fogo-gray-400 hover:text-white hover:bg-fogo-gray-700/50'
              }`}
            >
              <div className="relative flex items-center justify-center gap-2">
                <FireIcon className="w-4 h-4" />
                <span className="text-base">Wrap</span>
              </div>
            </button>
            <button
              onClick={() => setMode('lp')}
              className={`px-5 py-3 text-sm rounded-xl font-heading uppercase tracking-[0.18em] transition-all duration-300 relative overflow-hidden ${
                mode === 'lp'
                  ? 'bg-gradient-to-r from-orange-500 to-orange-600 text-white shadow-lg shadow-orange-500/30'
                  : 'text-fogo-gray-400 hover:text-white hover:bg-fogo-gray-700/50'
              }`}
            >
              <div className="relative flex items-center justify-center gap-2">
                <BoltIcon className="w-4 h-4" />
                <span className="text-base">Inferno</span>
              </div>
            </button>
          </div>
        </div>

        {/* Leverage Toggle (Leveraged Mode Only) */}
        {mode === 'lp' && (
          <div className="mb-4">
            <label className="block text-xs font-heading text-fogo-gray-300 mb-2 uppercase tracking-[0.18em]">
              Leverage
            </label>
            <div className="grid grid-cols-3 gap-2">
              {([1, 1.5, 2] as Leverage[]).map((lev) => (
                <button
                  key={lev}
                  onClick={() => setLeverage(lev)}
                  className={`px-4 py-2.5 rounded-xl transition-all duration-300 border-2 ${
                    leverage === lev
                      ? 'bg-gradient-to-r from-orange-500 to-orange-600 text-white shadow-lg shadow-orange-500/35 border-orange-400'
                      : 'bg-fogo-gray-700/80 text-fogo-gray-300 hover:bg-fogo-gray-600 border-fogo-gray-600'
                  }`}
                >
                  <div className="text-sm font-heading">{lev}x</div>
                  <div className="text-xs mt-0.5 opacity-80 font-satoshi">
                    {lev === 1 ? '50/50' : lev === 1.5 ? '50/100' : '0/100'}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Amount Input */}
        <div className="mb-4">
          <label className="block text-xs font-semibold text-fogo-gray-300 mb-2 flex items-center gap-2">
            <span>Amount</span>
            <span className={`px-1.5 py-0.5 rounded-md text-xs font-medium ${
              mode === 'wrap' 
                ? 'bg-fogo-primary/20 text-fogo-primary'
                : 'bg-orange-500/20 text-orange-400'
            }`}>
              {baseTokenSymbol}
            </span>
            <span className="ml-auto text-xs text-fogo-gray-500">
              Balance: {baseTokenBalance.toFixed(2)}
            </span>
          </label>
          <div className="flex space-x-2">
            <div className="flex-1 relative">
              <input
                type="number"
                value={amount}
                onChange={(e) => {
                  const value = e.target.value
                  if (value === '' || /^\d*\.?\d*$/.test(value)) {
                    setAmount(value)
                  }
                }}
                placeholder="0.00"
                className="no-spinner w-full px-4 py-3 pr-16 bg-fogo-gray-800/80 backdrop-blur-sm border-2 border-fogo-gray-700 rounded-xl text-white font-heading placeholder-fogo-gray-500 focus:outline-none focus:border-fogo-primary focus:ring-4 focus:ring-fogo-primary/20 transition-all duration-300"
              />
              {amount && (
                <div className="absolute right-12 top-1/2 -translate-y-1/2 text-fogo-gray-500 text-xs">
                  ≈ ${baseValueUSD.toFixed(2)}
                </div>
              )}
            </div>
            <button
              onClick={handleMax}
              className="px-4 py-3 bg-fogo-gray-700/80 hover:bg-fogo-primary/20 border-2 border-fogo-gray-600 hover:border-fogo-primary text-white rounded-xl font-semibold transition-all duration-300 hover:scale-105"
            >
              MAX
            </button>
          </div>
        </div>

        {/* USDC Display (LP Mode Only) */}
        {mode === 'lp' && amount && parseFloat(amount) > 0 && (
          <div className="mb-4">
            <label className="block text-xs font-semibold text-fogo-gray-300 mb-2 flex items-center gap-2">
              <span>{leverage === 1 ? 'USDC to Deposit' : leverage === 1.5 ? 'USDC (50% deposit + 50% borrow)' : 'USDC to Borrow'}</span>
              <span className="px-1.5 py-0.5 bg-blue-500/20 text-blue-400 rounded-md text-xs font-medium">
                {leverage === 1 ? 'Equal Value' : leverage === 1.5 ? 'Split' : 'Full Borrow'}
              </span>
              {leverage === 1 && (
                <span className="ml-auto text-xs text-fogo-gray-500">
                  Balance: {usdcBalance.toFixed(2)} USDC
                </span>
              )}
            </label>
            <div className={`px-3 py-2.5 panel-muted backdrop-blur-sm border-2 rounded-xl ${
              leverage === 1 && !hasEnoughUSDC
                ? 'border-red-500/50'
                : 'border-blue-500/50'
            }`}>
              <div className="flex items-center justify-between">
                <span className="text-white text-base font-medium">
                  {usdcDetails.totalUSDC.toFixed(2)} USDC
                </span>
                {leverage === 1 && !hasEnoughUSDC && (
                  <span className="text-red-400 text-xs font-medium">
                    Insufficient Balance
                  </span>
                )}
                {leverage > 1 && (
                  <span className="text-blue-400 text-xs font-medium">
                    {usdcDetails.depositUSDC > 0 ? `${usdcDetails.depositUSDC.toFixed(2)} deposit + ` : ''}{usdcDetails.borrowUSDC.toFixed(2)} borrowed
                  </span>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Preview - Compact */}
        <div className="panel rounded-2xl p-4 mb-4 border border-fogo-gray-700/50">
          <h3 className="text-xs font-semibold text-fogo-gray-300 mb-3 flex items-center gap-2">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
            Transaction Preview
          </h3>
          <div className="space-y-2">
            {mode === 'wrap' ? (
              <>
                <div className="flex justify-between items-center py-2.5 px-3 panel-muted rounded-lg">
                  <span className="text-fogo-gray-400 text-sm font-satoshi">You'll receive</span>
                  <span className="text-white text-lg font-heading">
                    {amount ? ((parseFloat(amount) * (1 - WRAP_FEE_RATE)) / 1.045).toFixed(2) : '0.00'} {ctokenSymbol}
                  </span>
                </div>
                <div className="flex justify-between items-center py-2.5 px-3 bg-red-500/10 rounded-lg border border-red-500/20">
                  <span className="text-red-400 text-xs font-satoshi flex items-center gap-1">
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    Wrap Fee ({(WRAP_FEE_RATE * 100).toFixed(2)}%)
                  </span>
                  <span className="text-red-400 font-heading font-semibold">
                    -{amount ? (parseFloat(amount) * WRAP_FEE_RATE).toFixed(2) : '0.00'} {baseTokenSymbol}
                  </span>
                </div>
                <div className="flex justify-between items-center py-2.5 px-3 panel-muted rounded-lg">
                  <span className="text-fogo-gray-400 text-sm font-satoshi">Exchange Rate</span>
                  <span className="text-fogo-primary font-heading font-semibold">1 {ctokenSymbol} = 1.045 {baseTokenSymbol}</span>
                </div>
                <div className="flex justify-between items-center py-2.5 px-3 bg-gradient-to-r from-fogo-primary/18 to-fogo-primary/6 rounded-lg border border-fogo-primary/25 shadow-[0_8px_25px_rgba(255,102,14,0.2)]">
                  <span className="text-fogo-gray-200 text-sm font-satoshi">Base APY</span>
                  <span className="text-fogo-primary font-heading font-bold text-xl">{currentAPY.toFixed(2)}%</span>
                </div>
              </>
            ) : (
              <>
                <div className="flex justify-between items-center py-1.5 px-2.5 panel-muted rounded-lg">
                  <span className="text-fogo-gray-400 text-xs font-satoshi">LP Token</span>
                  <span className="text-white text-base font-heading">{displayPairSymbol}/USDC</span>
                </div>
                <div className="flex justify-between items-center py-1.5 px-2.5 panel-muted rounded-lg">
                  <span className="text-fogo-gray-400 text-xs font-satoshi">{baseTokenSymbol} Deposited</span>
                  <span className="text-white text-sm font-heading">{mode === 'lp' && amount ? baseAmountForPosition.toFixed(2) : '0.00'} {baseTokenSymbol}</span>
                </div>
                {leverage === 1.5 ? (
                  <>
                    <div className="flex justify-between items-center py-1.5 px-2.5 panel-muted rounded-lg">
                      <span className="text-fogo-gray-400 text-xs font-satoshi">USDC to Deposit</span>
                      <span className="text-sm font-heading text-white">
                        {usdcDetails.depositUSDC.toFixed(2)} USDC
                      </span>
                    </div>
                    <div className="flex justify-between items-center py-1.5 px-2.5 panel-muted rounded-lg">
                      <span className="text-fogo-gray-400 text-xs font-satoshi">USDC to Borrow</span>
                      <span className="text-sm font-heading text-fogo-primary-light">
                        {usdcDetails.borrowUSDC.toFixed(2)} USDC
                      </span>
                    </div>
                  </>
                ) : (
                  <div className="flex justify-between items-center py-1.5 px-2.5 panel-muted rounded-lg">
                    <span className="text-fogo-gray-400 text-xs font-satoshi">
                      {leverage === 1 ? 'USDC Deposited' : 'USDC Borrowed'}
                    </span>
                    <span className={`text-sm font-heading ${leverage === 1 ? 'text-white' : 'text-fogo-primary-light'}`}>
                      {usdcDetails.totalUSDC.toFixed(2)} USDC
                    </span>
                  </div>
                )}
                {mode === 'lp' && amount && parseFloat(amount) > 0 && (
                  <div className="flex justify-between items-center py-1.5 px-2.5 bg-red-500/10 rounded-lg border border-red-500/20">
                    <span className="text-red-400 text-xs font-satoshi flex items-center gap-1">
                      <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      Inferno Open Fee ({(INFERNO_OPEN_FEE_RATE * 100).toFixed(2)}%)
                    </span>
                    <span className="text-red-400 font-heading font-semibold text-xs">
                      -{(parseFloat(amount) * INFERNO_OPEN_FEE_RATE).toFixed(2)} {baseTokenSymbol}
                    </span>
                  </div>
                )}
                <div className="flex justify-between items-center py-1.5 px-2.5 bg-gradient-to-r from-fogo-primary/18 to-fogo-primary/6 rounded-lg border border-fogo-primary/25 shadow-[0_8px_25px_rgba(255,102,14,0.2)]">
                  <span className="text-fogo-primary-light text-xs font-satoshi">Effective APY</span>
                  <span className="text-fogo-primary-light text-lg font-heading">{effectiveAPY.toFixed(2)}%</span>
                </div>
                {leverage > 1 && (
                  <div className="flex justify-between items-center py-1.5 px-2.5 panel-muted rounded-lg border border-blue-500/20">
                    <span className="text-blue-300 text-xs font-satoshi">Borrowing Interest Rate</span>
                    <span className="text-blue-200 text-xs font-heading">5% APY</span>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex space-x-3">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-3 panel-muted hover:bg-fogo-gray-700 border-2 border-fogo-gray-700 hover:border-fogo-gray-600 text-white rounded-xl font-semibold transition-all duration-300 hover:scale-105"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!amount || loading || parseFloat(amount) <= 0 || (mode === 'lp' && leverage === 1 && !hasEnoughUSDC)}
            className={`flex-1 px-4 py-3 rounded-xl font-semibold transition-all duration-300 transform hover:scale-105 hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none disabled:hover:shadow-none relative overflow-hidden group ${
              mode === 'wrap'
                ? 'bg-gradient-to-r from-fogo-primary to-fogo-primary-light hover:from-fogo-primary-dark hover:to-fogo-primary text-white hover:shadow-fogo-lg'
                : 'bg-gradient-to-r from-orange-600 via-orange-500 to-orange-600 hover:from-orange-500 hover:via-orange-400 hover:to-orange-500 text-white hover:shadow-orange-500/30'
            }`}
          >
            {loading && (
              <span className="absolute inset-0 flex items-center justify-center">
                <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
              </span>
            )}
            <span className={loading ? 'opacity-0' : 'opacity-100'}>
              {loading ? 'Processing...' : mode === 'wrap' ? 'Open Position' : `Open Position (${leverage}x)`}
            </span>
          </button>
        </div>
      </div>
    </div>
  )
}
