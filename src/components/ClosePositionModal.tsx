import React, { useState, useMemo } from 'react'
import { XMarkIcon, ArrowDownIcon } from '@heroicons/react/24/outline'
import { useCrucible } from '../hooks/useCrucible'
import { useBalance } from '../contexts/BalanceContext'
import { useLVFPosition } from '../hooks/useLVFPosition'
import { useAnalytics } from '../contexts/AnalyticsContext'
import { formatNumberWithCommas, RATE_SCALE } from '../utils/math'
import { UNWRAP_FEE_RATE, INFERNO_CLOSE_FEE_RATE, INFERNO_YIELD_FEE_RATE } from '../config/fees'

interface ClosePositionModalProps {
  isOpen: boolean
  onClose: () => void
  crucibleAddress: string
  baseTokenSymbol: 'SOL' | 'FORGE'
  ctokenSymbol: string
  hasCTokenPosition: boolean
  hasLeveragedPosition?: boolean // Optional, will be calculated internally
}

export default function ClosePositionModal({
  isOpen,
  onClose,
  crucibleAddress,
  baseTokenSymbol,
  ctokenSymbol,
  hasCTokenPosition,
  hasLeveragedPosition: _hasLeveragedPosition,
}: ClosePositionModalProps) {
  const [activeTab, setActiveTab] = useState<'ctoken' | 'lp'>('ctoken')
  const [ctokenAmount, setCTokenAmount] = useState('')
  const [lpTokenAmount, setLpTokenAmount] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [timeUpdateTrigger, setTimeUpdateTrigger] = useState(0) // Trigger to update calculations as time passes
  const infernoPairSymbol = ctokenSymbol.replace(/^c/i, 'if')
  
  // Update calculations every second for dynamic exchange rate
  React.useEffect(() => {
    if (!isOpen) return
    
    const interval = setInterval(() => {
      setTimeUpdateTrigger(prev => prev + 1)
    }, 1000) // Update every second
    
    return () => clearInterval(interval)
  }, [isOpen])

  const { unwrapTokens, getCrucible, calculateUnwrapPreview } = useCrucible()
  const { addToBalance, subtractFromBalance, balances } = useBalance()
  const { walletPublicKey } = useSession()
  const { addTransaction } = useAnalytics()
  
  // Get leveraged positions with refetch capability
  const { positions: leveragedPositions, closePosition: closeLVFPosition, refetch: refetchLVF } = useLVFPosition({
    crucibleAddress,
    baseTokenSymbol,
  })
  
  // Refetch positions when modal opens to ensure we have latest data
  React.useEffect(() => {
    if (isOpen && crucibleAddress) {
      // Immediate refetch
      refetchLVF()
      // Also refetch after a short delay to catch any async updates
      const timeoutId = setTimeout(() => {
        refetchLVF()
      }, 100)
      return () => clearTimeout(timeoutId)
    }
  }, [isOpen, crucibleAddress, refetchLVF])
  
  // Listen for position opened/closed events to refetch positions
  React.useEffect(() => {
    const handlePositionOpened = (event: CustomEvent) => {
      const detail = event.detail
      if (detail?.crucibleAddress === crucibleAddress && detail?.baseTokenSymbol === baseTokenSymbol) {
        // Refetch positions when a new one is opened
        setTimeout(() => {
          refetchLVF()
        }, 100)
      }
    }
    
    const handlePositionClosed = (event: CustomEvent) => {
      const detail = event.detail
      if (detail?.crucibleAddress === crucibleAddress && detail?.baseTokenSymbol === baseTokenSymbol) {
        // Refetch positions when one is closed
        setTimeout(() => {
          refetchLVF()
        }, 100)
      }
    }
    
    window.addEventListener('lvfPositionOpened', handlePositionOpened as EventListener)
    window.addEventListener('lvfPositionClosed', handlePositionClosed as EventListener)
    return () => {
      window.removeEventListener('lvfPositionOpened', handlePositionOpened as EventListener)
      window.removeEventListener('lvfPositionClosed', handlePositionClosed as EventListener)
    }
  }, [crucibleAddress, baseTokenSymbol, refetchLVF])

  const crucible = getCrucible(crucibleAddress)
  const baseTokenPrice = baseTokenSymbol === 'FOGO' ? 0.5 : 0.002
  
  // Calculate leveraged position status internally - ULTRA LENIENT
  const hasLeveragedPosition = useMemo(() => {
    // If we have any positions at all, consider it available (super lenient for demo)
    if (leveragedPositions.length > 0) {
      // Just check if position is not explicitly closed
      const hasAnyOpenPosition = leveragedPositions.some(p => {
        // If isOpen is false, skip it. Otherwise, count it as open (undefined = open)
        if (p.isOpen === false) return false
        // Any other case (true, undefined, missing) = open
        return true
      })
      
      return hasAnyOpenPosition
    }
    
    return false
  }, [leveragedPositions])

  // Get available cToken balance from both crucible and balance context
  const availableCTokens = useMemo(() => {
    // First try to get from BalanceContext (more accurate, updated immediately)
    const balanceContextCToken = balances.find(b => b.symbol === ctokenSymbol)
    const balanceContextAmount = balanceContextCToken?.amount || 0
    
    // Fallback to crucible balance
    const crucibleBalance = crucible?.userPtokenBalance 
      ? Number(crucible.userPtokenBalance) / 1e9 
      : 0
    
    // Use the higher of the two (or whichever is available)
    const available = balanceContextAmount > 0 ? balanceContextAmount : crucibleBalance
    
    return available
  }, [crucible, balances, ctokenSymbol])

  // Get available leveraged position (for LP tab) - ULTRA LENIENT
  const availableLeveragedPosition = useMemo(() => {
    if (leveragedPositions.length === 0) return null
    
    // Get first position that is not explicitly closed (super lenient)
    const position = leveragedPositions.find(p => {
      // If isOpen is false, skip it. Otherwise, use it (true, undefined, missing = open)
      return p.isOpen !== false
    })
    
    return position || null
  }, [leveragedPositions])

  // Calculate preview for cToken unwrap
  const cTokenUnwrapPreview = useMemo(() => {
    if (!ctokenAmount || parseFloat(ctokenAmount) <= 0) return null
    if (!crucible) return null
    
    const preview = calculateUnwrapPreview(crucibleAddress, ctokenAmount)
    const baseToReceive = parseFloat(preview.baseAmount)
    const feeAmount = (baseToReceive / (1 - UNWRAP_FEE_RATE)) * UNWRAP_FEE_RATE // Reverse calculate fee
    const apyEarned = baseToReceive - (parseFloat(ctokenAmount) / 1.045) // APY = received - original deposit
    
    return {
      cTokenAmount: parseFloat(ctokenAmount),
      baseToReceive,
      feeAmount,
      apyEarned,
      netAmount: baseToReceive
    }
  }, [ctokenAmount, crucibleAddress, crucible, calculateUnwrapPreview])

  // Calculate preview for LP token unwrap (leveraged position)
  const lpTokenUnwrapPreview = useMemo(() => {
    if (!lpTokenAmount || parseFloat(lpTokenAmount) <= 0 || !availableLeveragedPosition) return null
    
    const unwrapAmount = parseFloat(lpTokenAmount)
    
    // For leveraged positions: unwrapping x cTOKENS = same amount in USDC (equal value)
    const cTokenValue = unwrapAmount * baseTokenPrice // cTOKEN value in USD
    const usdcAmount = cTokenValue // Equal USDC amount
    
    // Calculate position details
    const position = availableLeveragedPosition
    const leverageFactor = position.leverageFactor || 2.0
    
    // Calculate APY based on EXCHANGE RATE ratio (correlated with borrowing interest)
    // APY = ((exchange rate at sell / exchange rate at buy) - 1) * 100
    const initialExchangeRate = 1.045 // Exchange rate at buy (when position was opened)
    
    // Calculate DYNAMIC exchange rate based on time elapsed since position was opened
    // Use position timestamp to calculate actual exchange rate growth
    // Use timeUpdateTrigger to ensure recalculation as time passes
    const positionTimestamp = position.timestamp || Date.now()
    const timeElapsedMs = Date.now() - positionTimestamp
    const timeElapsedMinutes = Math.max(0, timeElapsedMs / (1000 * 60))
    const timeElapsedMonths = timeElapsedMinutes // 1 minute = 1 month (for demo)
    const yearsElapsed = timeElapsedMonths / 12
    
    // Get crucible APR for dynamic rate calculation
    const crucibleAPR = crucible?.apr || 0.05 // Use crucible APR (e.g., 18% = 0.18)
    
    // Calculate accumulated exchange rate: initialRate * (1 + APR)^(years)
    // This gives us the DYNAMIC exchange rate that grows over time
    // The rate grows continuously as timeElapsedMs increases
    const currentExchangeRateDecimal = initialExchangeRate * Math.pow(1 + crucibleAPR, yearsElapsed)
    
    // Calculate APY percentage: ((exchange rate at sell / exchange rate at buy) - 1) * 100
    const apyPercentage = ((currentExchangeRateDecimal / initialExchangeRate) - 1) * 100
    
    // Calculate exchange rate growth
    const exchangeRateGrowth = currentExchangeRateDecimal - initialExchangeRate
    
    // Calculate borrowing interest CORRELATED with APY percentage
    // Borrowing interest rate = APY% × 5%
    // borrowingInterest = borrowedUSDC × (APY% × 5% / 100)
    const borrowedAmount = position.borrowedUSDC || 0
    let totalBorrowingInterest = 0
    let borrowingInterestRatePercent = 0
    
    if (borrowedAmount > 0) {
      // Calculate borrowing interest rate: APY% × 5%
      borrowingInterestRatePercent = apyPercentage * 0.05 // e.g., if APY is 2%, rate is 0.1%
      
      // Calculate borrowing interest: borrowedUSDC × (APY% × 5% / 100)
      // This is the same as: borrowedUSDC × (borrowingInterestRatePercent / 100)
      totalBorrowingInterest = borrowedAmount * (borrowingInterestRatePercent / 100)
    }
    
    // Yield earned in tokens (based on cTOKEN exchange rate growth)
    const apyEarnedTokens = unwrapAmount * (exchangeRateGrowth / currentExchangeRateDecimal)
    
    const principalFeeTokens = unwrapAmount * INFERNO_CLOSE_FEE_RATE
    const yieldFeeTokens = apyEarnedTokens * INFERNO_YIELD_FEE_RATE
    const transactionFeeTokens = principalFeeTokens + yieldFeeTokens
    const transactionFeeUSD = transactionFeeTokens * baseTokenPrice
    
    // Net tokens to receive after fees
    const netTokensToReceive = (unwrapAmount - principalFeeTokens) + (apyEarnedTokens - yieldFeeTokens)
    
    // For leveraged positions, user also gets USDC (deposited minus borrowing interest)
    const depositedUSDC = position.depositUSDC || 0
    const borrowedUSDC = position.borrowedUSDC || 0
    const proportion = unwrapAmount / (position.collateral || 1) // Proportion of position being unwrapped
    
    // Proportional borrowing interest (apply proportion to total interest)
    const proportionalBorrowingInterest = totalBorrowingInterest * proportion
    
    // Proportional deposited USDC (minus borrowing interest)
    const proportionalDepositedUSDC = Math.max(0, (depositedUSDC * proportion) - proportionalBorrowingInterest)
    
    // Proportional borrowed USDC to repay
    const proportionalBorrowedUSDC = borrowedUSDC * proportion
    
    return {
      lpTokenAmount: unwrapAmount,
      cTokenValue,
      usdcAmount,
      apyEarnedTokens,
      transactionFeeTokens,
      transactionFeeUSD,
      netTokensToReceive,
      proportionalDepositedUSDC,
      proportionalBorrowingInterest,
      proportionalBorrowedUSDC: proportionalBorrowedUSDC + (proportionalBorrowingInterest * proportion), // Borrowed + interest
      apyPercentage, // Include APY percentage
      borrowingInterestRatePercent, // Include borrowing interest rate percentage
      principalFeeTokens,
      yieldFeeTokens,
    }
  }, [lpTokenAmount, availableLeveragedPosition, baseTokenPrice, timeUpdateTrigger, crucible])

  // Handle cToken unwrap
  const handleCTokenUnwrap = async () => {
    if (!ctokenAmount || parseFloat(ctokenAmount) <= 0) {
      setError('Please enter a valid amount')
      return
    }

    if (parseFloat(ctokenAmount) > availableCTokens) {
      setError(`Insufficient ${ctokenSymbol} balance. Available: ${availableCTokens.toFixed(4)}`)
      return
    }

    setLoading(true)
    setError(null)

    try {
      const result = await unwrapTokens(crucibleAddress, ctokenAmount)
      
      if (result) {
        // Update wallet balances - subtract cTokens and add base tokens received
        // Note: unwrapTokens already updates Crucible userBalances internally,
        // but we also need to update the wallet's BalanceContext cToken balance
        subtractFromBalance(ctokenSymbol, parseFloat(ctokenAmount))
        addToBalance(baseTokenSymbol, result.baseAmount)
        
        // Record transaction
        const baseTokenPrice = baseTokenSymbol === 'FOGO' ? 0.5 : 0.002
        addTransaction({
          type: 'unwrap',
          amount: result.baseAmount,
          token: baseTokenSymbol,
          crucibleId: crucibleAddress,
          signature: `unwrap_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          apyRewards: result.apyEarned,
          totalWithdrawal: result.baseAmount,
          usdValue: result.baseAmount * baseTokenPrice
        })
        
        // Trigger portfolio refresh to update cToken/USDC information
        window.dispatchEvent(new CustomEvent('forceRecalculateLP'))
        
        // Calculate actual Yield earned (received - unwrapped - fee)
        const actualAPYEarned = result.baseAmount - parseFloat(ctokenAmount) - (result.feeAmount || 0)
        const apyEarnedDisplay = actualAPYEarned > 0 ? actualAPYEarned : result.apyEarned || 0
        
        const summary = [
          '🔥 Forge Position Update',
          '',
          `${ctokenSymbol} position closed.`,
          '',
          `• Burned: ${formatNumberWithCommas(parseFloat(ctokenAmount))} ${ctokenSymbol}`,
          `• Released: ${formatNumberWithCommas(result.baseAmount)} ${baseTokenSymbol}`,
        ]

        if (apyEarnedDisplay > 0) {
          summary.push(`• Net Yield: +${formatNumberWithCommas(apyEarnedDisplay)} ${baseTokenSymbol}`)
        }
        if (result.feeAmount && result.feeAmount > 0) {
          summary.push(`• Forge Safety Fee (${(UNWRAP_FEE_RATE * 100).toFixed(2)}%): ${formatNumberWithCommas(result.feeAmount)} ${baseTokenSymbol}`)
        }

        summary.push('', 'Wallet and portfolio balances refresh instantly in Forge.')

        alert(summary.join('\n'))
        setCTokenAmount('')
        onClose()
      }
    } catch (err: any) {
      console.error('Error unwrapping cToken:', err)
      setError(err.message || 'Failed to unwrap cToken')
    } finally {
      setLoading(false)
    }
  }

  // Handle LP token unwrap (leveraged position partial close)
  const handleLPUnwrap = async () => {
    if (!lpTokenAmount || parseFloat(lpTokenAmount) <= 0 || !availableLeveragedPosition) {
      setError('Please enter a valid amount')
      return
    }

    const unwrapAmount = parseFloat(lpTokenAmount)
    const maxAmount = availableLeveragedPosition.collateral || 0

    if (unwrapAmount > maxAmount) {
      setError(`Insufficient position. Available: ${maxAmount.toFixed(4)} ${baseTokenSymbol}`)
      return
    }

    setLoading(true)
    setError(null)

    try {
      // For partial unwrap, calculate proportional amounts
      // Check if this is a partial close (unwrapAmount < full collateral)
      // Use a small tolerance (0.0001) for floating point comparison
      const tolerance = 0.0001
      const isPartialClose = unwrapAmount < (maxAmount - tolerance)
      
      console.log('🔍 Closing position:', {
        unwrapAmount,
        maxAmount,
        difference: maxAmount - unwrapAmount,
        isPartialClose,
        willCloseFull: !isPartialClose
      })
      
      // Close position (partial or full)
      const result = await closeLVFPosition(availableLeveragedPosition.id, isPartialClose ? unwrapAmount : undefined)
      
      if (result && result.success) {
        // Update wallet balances - add base tokens and USDC received
        // Note: closeLVFPosition already subtracts LP tokens internally,
        // so we only need to update the wallet's base token and USDC balances
        // Ensure balances update synchronously before triggering recalculation
        addToBalance(baseTokenSymbol, result.baseAmount)
        if (result.usdcAmount && result.usdcAmount > 0) {
          addToBalance('USDC', result.usdcAmount)
        }
        
        // Small delay to ensure balance updates are processed before closing modal
        await new Promise(resolve => setTimeout(resolve, 50))
        
        // Record transaction
        // Calculate the original position value that was closed (proportional for partial close)
        const baseTokenPrice = baseTokenSymbol === 'FOGO' ? 0.5 : 0.002
        const collateralWithdrawn = isPartialClose ? unwrapAmount : availableLeveragedPosition.collateral
        const collateralValueUSD = collateralWithdrawn * baseTokenPrice
        const depositedUSDC = availableLeveragedPosition.depositUSDC || 0
        const proportion = isPartialClose ? unwrapAmount / availableLeveragedPosition.collateral : 1.0
        const proportionalDepositedUSDC = depositedUSDC * proportion
        const originalPositionValueUSD = collateralValueUSD + proportionalDepositedUSDC
        const totalReceivedUSD = (result.baseAmount * baseTokenPrice) + (result.usdcAmount || 0)
        
        // Record the withdrawal - show what was withdrawn from position (partial or full)
        addTransaction({
          type: 'withdraw',
          amount: collateralWithdrawn, // Collateral withdrawn (partial or full)
          token: baseTokenSymbol,
          crucibleId: crucibleAddress,
          signature: `close_lvf_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          apyRewards: result.apyEarned,
          totalWithdrawal: originalPositionValueUSD, // Total value withdrawn from position
          usdValue: originalPositionValueUSD, // USD value of what was withdrawn
          borrowedAmount: (availableLeveragedPosition.borrowedUSDC || 0) * proportion, // Proportional borrowed USDC
          leverage: availableLeveragedPosition.leverageFactor || 2.0,
          // Store USDC separately for display
          distToken: 'USDC',
          // Custom field to show USDC received
          usdcReceived: result.usdcAmount || 0
        })
        
        // Build success message
        const closeType = isPartialClose ? 'partially' : 'fully'
        const summary = [
          '🔥 Forge Position Update',
          '',
          `${infernoPairSymbol}/USDC leveraged position ${closeType} closed.`,
          '',
          `• Released: ${formatNumberWithCommas(result.baseAmount, 4)} ${baseTokenSymbol}`,
        ]

        if (isPartialClose) {
          const remainingCollateral = availableLeveragedPosition.collateral - unwrapAmount
          summary.push(`• Remaining Collateral: ${formatNumberWithCommas(remainingCollateral, 4)} ${baseTokenSymbol}`)
        }

        if (result.usdcAmount && result.usdcAmount > 0) {
          summary.push(`• USDC Settled: ${formatNumberWithCommas(result.usdcAmount, 2)} USDC`)
        }
        if (result.apyEarned && result.apyEarned > 0) {
          summary.push(`• Net Yield: +${formatNumberWithCommas(result.apyEarned, 4)} ${baseTokenSymbol}`)
        }
        if (result.principalFee && result.principalFee > 0) {
          summary.push(`• Forge Principal Fee: ${formatNumberWithCommas(result.principalFee, 4)} ${baseTokenSymbol}`)
        }
        if (result.yieldFee && result.yieldFee > 0) {
          summary.push(`• Forge Yield Fee: ${formatNumberWithCommas(result.yieldFee, 4)} ${baseTokenSymbol}`)
        }
        if (result.repaidUSDC && result.repaidUSDC > 0) {
          summary.push(`• Lending Pool Repaid: ${formatNumberWithCommas(result.repaidUSDC, 2)} USDC`)
        }
        if (result.borrowingInterest && result.borrowingInterest > 0) {
          summary.push(`• Interest Paid: ${formatNumberWithCommas(result.borrowingInterest, 2)} USDC`)
        }

        summary.push('', 'Forge balances and analytics refresh automatically.')

        const successMessage = summary.join('\n')
        
        // Trigger LP balance recalculation to update wallet - immediately and with delay
        // This ensures both wallet and portfolio update properly
        const forceRecalcEvent = new CustomEvent('forceRecalculateLP')
        window.dispatchEvent(forceRecalcEvent)
        // Also trigger immediate recalculation
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent('forceRecalculateLP'))
        }, 50)
        
        alert(successMessage)
        setLpTokenAmount('')
        onClose()
      }
    } catch (err: any) {
      console.error('Error unwrapping LP token:', err)
      setError(err.message || 'Failed to unwrap LP token')
    } finally {
      setLoading(false)
    }
  }

  if (!isOpen) return null

  // Determine default tab based on available positions
  React.useEffect(() => {
    if (hasCTokenPosition && !hasLeveragedPosition) {
      setActiveTab('ctoken')
    } else if (hasLeveragedPosition && !hasCTokenPosition) {
      setActiveTab('lp')
    }
  }, [hasCTokenPosition, hasLeveragedPosition])

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
        <div className="panel rounded-3xl border border-fogo-primary/20 shadow-2xl shadow-fogo-primary/10 w-full max-w-lg max-h-[90vh] overflow-y-auto backdrop-blur-xl">
        {/* Header */}
        <div className="relative bg-gradient-to-r from-fogo-primary/20 via-fogo-primary/10 to-transparent p-6 border-b border-fogo-gray-700/50">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 bg-fogo-primary/20 rounded-xl flex items-center justify-center backdrop-blur-sm">
                <ArrowDownIcon className="h-6 w-6 text-fogo-primary" />
              </div>
              <h2 className="text-2xl font-heading text-white">Close Position</h2>
            </div>
            <button
              onClick={onClose}
              className="p-2 hover:bg-fogo-gray-700/50 rounded-xl text-fogo-gray-400 hover:text-white transition-all duration-200 hover:scale-110"
            >
              <XMarkIcon className="h-6 w-6" />
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-fogo-gray-700">
          <button
            onClick={() => setActiveTab('ctoken')}
            className={`flex-1 px-6 py-4 text-sm font-medium transition-colors ${
              activeTab === 'ctoken'
                ? 'text-fogo-primary border-b-2 border-fogo-primary panel-muted'
                : 'text-fogo-gray-400 hover:text-fogo-gray-300'
            }`}
            disabled={!hasCTokenPosition}
          >
            Unwrap cTOKENS
          </button>
          <button
            onClick={() => setActiveTab('lp')}
            className={`flex-1 px-6 py-4 text-sm font-medium transition-colors ${
              activeTab === 'lp'
                ? 'text-fogo-primary border-b-2 border-fogo-primary panel-muted'
                : 'text-fogo-gray-400 hover:text-fogo-gray-300'
            }`}
            disabled={!hasLeveragedPosition}
          >
            Unwrap LP tokens
          </button>
        </div>

        {/* Content */}
        <div className="p-6">
          {/* cToken Unwrap Tab */}
          {activeTab === 'ctoken' && hasCTokenPosition && (
            <div className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-fogo-gray-300 mb-2">
                  Amount to Unwrap ({ctokenSymbol})
                </label>
                <div className="relative">
                  <input
                    type="number"
                    value={ctokenAmount}
                    onChange={(e) => setCTokenAmount(e.target.value)}
                    placeholder="0.00"
                    className="w-full px-4 py-3 pr-12 panel-muted rounded-xl text-white placeholder-fogo-gray-500 focus:outline-none focus:border-fogo-primary"
                  />
                  <button
                    onClick={() => setCTokenAmount(availableCTokens.toString())}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-fogo-primary hover:text-fogo-primary-light z-10"
                  >
                    MAX
                  </button>
                </div>
                <div className="mt-1 text-xs text-fogo-gray-400">
                  Available: {availableCTokens.toFixed(2)} {ctokenSymbol}
                </div>
              </div>

              {cTokenUnwrapPreview && (
                <div className="panel-muted rounded-xl p-4 border border-fogo-gray-700 space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-fogo-gray-400">You will receive:</span>
                    <span className="text-white font-medium">
                      {formatNumberWithCommas(cTokenUnwrapPreview.netAmount)} {baseTokenSymbol}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-fogo-gray-400">Yield Earned:</span>
                    <span className="text-green-400 font-medium">
                      +{formatNumberWithCommas(cTokenUnwrapPreview.apyEarned)} {baseTokenSymbol}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-fogo-gray-400">Transaction Fee:</span>
                    <span className="text-fogo-gray-400">
                      -{formatNumberWithCommas(cTokenUnwrapPreview.feeAmount)} {baseTokenSymbol} ({(UNWRAP_FEE_RATE * 100).toFixed(2)}%)
                    </span>
                  </div>
                </div>
              )}

              {error && (
                <div className="bg-red-500/20 border border-red-500/50 rounded-xl p-3 text-red-400 text-sm">
                  {error}
                </div>
              )}

              <button
                onClick={handleCTokenUnwrap}
                disabled={loading || !ctokenAmount || parseFloat(ctokenAmount) <= 0}
                className="w-full py-3 bg-gradient-to-r from-fogo-primary to-fogo-secondary text-white rounded-xl font-medium hover:from-fogo-primary-dark hover:to-fogo-secondary-dark transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? 'Unwrapping...' : `Unwrap ${ctokenSymbol}`}
              </button>
            </div>
          )}

          {/* LP Token Unwrap Tab (Leveraged Position) */}
          {activeTab === 'lp' && hasLeveragedPosition && availableLeveragedPosition && (
            <div className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-fogo-gray-300 mb-2">
                  Amount to Unwrap (c{baseTokenSymbol})
                </label>
                <div className="relative">
                  <input
                    type="number"
                    value={lpTokenAmount}
                    onChange={(e) => setLpTokenAmount(e.target.value)}
                    placeholder="0.00"
                    className="w-full px-4 py-3 pr-12 panel-muted rounded-xl text-white placeholder-fogo-gray-500 focus:outline-none focus:border-fogo-primary"
                  />
                  <button
                    onClick={() => setLpTokenAmount((availableLeveragedPosition.collateral || 0).toString())}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-fogo-primary hover:text-fogo-primary-light z-10"
                  >
                    MAX
                  </button>
                </div>
                <div className="mt-1 text-xs text-fogo-gray-400 space-y-1">
                  <div>Available: {(availableLeveragedPosition.collateral || 0).toFixed(2)} c{baseTokenSymbol}</div>
                  <div>Available: {(availableLeveragedPosition.depositUSDC || 0).toFixed(2)} USDC</div>
                </div>
              </div>

              {lpTokenUnwrapPreview && (
                <div className="panel-muted rounded-xl p-4 border border-fogo-gray-700 space-y-3">
                  <div className="text-sm font-medium text-fogo-gray-300 mb-2">You will receive:</div>
                  
                  <div className="flex justify-between text-sm">
                    <span className="text-fogo-gray-400">Tokens:</span>
                    <span className="text-white font-medium">
                      {formatNumberWithCommas(lpTokenUnwrapPreview.netTokensToReceive)} {baseTokenSymbol}
                    </span>
                  </div>
                  
                  <div className="flex justify-between text-sm">
                    <span className="text-fogo-gray-400">USDC:</span>
                    <span className="text-white font-medium">
                      {formatNumberWithCommas(lpTokenUnwrapPreview.proportionalDepositedUSDC)} USDC
                    </span>
                  </div>

                  <div className="pt-2 border-t border-fogo-gray-700 space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-fogo-gray-400">APY Generated:</span>
                      <span className="text-green-400 font-medium">
                        {lpTokenUnwrapPreview.apyPercentage?.toFixed(2) || '0.00'}%
                      </span>
                    </div>
                    
                    <div className="flex justify-between text-sm">
                      <span className="text-fogo-gray-400">Yield Earned (Tokens):</span>
                      <span className="text-green-400 font-medium">
                        +{formatNumberWithCommas(lpTokenUnwrapPreview.apyEarnedTokens)} {baseTokenSymbol}
                      </span>
                    </div>
                    
                    <div className="flex justify-between text-sm">
                      <span className="text-fogo-gray-400">Forge Principal Fee ({(INFERNO_CLOSE_FEE_RATE * 100).toFixed(2)}%):</span>
                      <span className="text-fogo-gray-400">
                        -{formatNumberWithCommas(lpTokenUnwrapPreview.principalFeeTokens || 0)} {baseTokenSymbol}
                      </span>
                    </div>
                    
                    <div className="flex justify-between text-sm">
                      <span className="text-fogo-gray-400">Forge Yield Fee ({(INFERNO_YIELD_FEE_RATE * 100).toFixed(0)}%):</span>
                      <span className="text-fogo-gray-400">
                        -{formatNumberWithCommas(lpTokenUnwrapPreview.yieldFeeTokens || 0)} {baseTokenSymbol}
                      </span>
                    </div>
                    
                    {(availableLeveragedPosition.borrowedUSDC || 0) > 0 && (
                      <>
                        <div className="flex justify-between text-sm">
                          <span className="text-fogo-gray-400">Borrowing Interest Rate:</span>
                          <span className="text-orange-400 font-medium">
                            {lpTokenUnwrapPreview.borrowingInterestRatePercent?.toFixed(2) || '0.00'}%
                          </span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-fogo-gray-400">Borrowing Interest:</span>
                          <span className="text-orange-400 font-medium">
                            -{formatNumberWithCommas(Math.max(0, lpTokenUnwrapPreview.proportionalBorrowingInterest))} USDC
                          </span>
                        </div>
                      </>
                    )}
                    
                    <div className="flex justify-between text-sm pt-2 border-t border-fogo-gray-700">
                      <span className="text-fogo-gray-400">Repaid to Lending Pool:</span>
                      <span className="text-fogo-gray-400">
                        {formatNumberWithCommas(lpTokenUnwrapPreview.proportionalBorrowedUSDC)} USDC
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {error && (
                <div className="bg-red-500/20 border border-red-500/50 rounded-xl p-3 text-red-400 text-sm">
                  {error}
                </div>
              )}

              <button
                onClick={handleLPUnwrap}
                disabled={loading || !lpTokenAmount || parseFloat(lpTokenAmount) <= 0}
                className="w-full py-3 bg-gradient-to-r from-orange-500 to-orange-600 text-white rounded-xl font-medium hover:from-orange-600 hover:to-orange-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? 'Unwrapping...' : `Unwrap LP Tokens`}
              </button>
            </div>
          )}

          {/* No positions message */}
          {!hasCTokenPosition && !hasLeveragedPosition && (
            <div className="text-center py-8 text-fogo-gray-400">
              No positions available to close
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

