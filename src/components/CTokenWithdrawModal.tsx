import React, { useState, useMemo } from 'react'
import { XMarkIcon, BoltIcon } from '@heroicons/react/24/outline'
import { useCToken } from '../hooks/useCToken'
import { useCrucible } from '../hooks/useCrucible'
import { useBalance } from '../contexts/BalanceContext'
import { useLP } from '../hooks/useLP'
import { useLVFPosition } from '../hooks/useLVFPosition'
import { useWallet } from '../contexts/WalletContext'
import { formatNumberWithCommas } from '../utils/math'
import { UNWRAP_FEE_RATE, INFERNO_CLOSE_FEE_RATE, INFERNO_YIELD_FEE_RATE } from '../config/fees'

interface CTokenWithdrawModalProps {
  isOpen: boolean
  onClose: () => void
  crucibleAddress: string
  ctokenMint: string
  baseTokenSymbol: string
  ctokenSymbol: string
  currentBalance: bigint | null
  exchangeRate: number
}

export default function CTokenWithdrawModal({
  isOpen,
  onClose,
  crucibleAddress,
  ctokenMint,
  baseTokenSymbol,
  ctokenSymbol,
  currentBalance,
  exchangeRate,
}: CTokenWithdrawModalProps) {
  const [amount, setAmount] = useState('')
  const { withdraw, loading } = useCToken(crucibleAddress, ctokenMint)
  const { unwrapTokens, getCrucible } = useCrucible()
  const { addToBalance, subtractFromBalance } = useBalance()
  const { connected, publicKey } = useWallet()
  const displayPairSymbol = ctokenSymbol.replace(/^c/i, 'if')
  
  // Check for LP and leveraged positions for this crucible
  const { positions: lpPositions, closePosition: closeLPPosition, loading: lpLoading } = useLP({
    crucibleAddress,
    baseTokenSymbol: baseTokenSymbol as 'SOL' | 'FORGE',
    baseAPY: 0, // Not needed for closing
  })
  
  const { positions: lvfPositions, closePosition: closeLVFPosition, loading: lvfLoading } = useLVFPosition({
    crucibleAddress,
    baseTokenSymbol: baseTokenSymbol as 'SOL' | 'FORGE',
  })
  
  // Check if user has any LP positions for this crucible
  const hasLPPositions = useMemo(() => {
    if (!connected || !publicKey) return false
    const owner = publicKey.toBase58()
    const hasLP = lpPositions.some(p => p.isOpen && p.owner === owner)
    const hasLVF = lvfPositions.some(p => p.isOpen && p.owner === owner)
    return hasLP || hasLVF
  }, [lpPositions, lvfPositions, connected, publicKey])
  
  const allPositions = useMemo(() => {
    const owner = publicKey?.toBase58() || ''
    return [
      ...lpPositions.filter(p => p.isOpen && p.owner === owner).map(p => ({ ...p, type: 'lp' as const })),
      ...lvfPositions.filter(p => p.isOpen && p.owner === owner).map(p => ({ ...p, type: 'lvf' as const })),
    ]
  }, [lpPositions, lvfPositions, publicKey])
  
  const handleCloseLPPosition = async (positionId: string, positionType: 'lp' | 'lvf') => {
    try {
      if (positionType === 'lp') {
        const result = await closeLPPosition(positionId)
        if (result && result.success) {
          // Update wallet balances
          // When closing LP position: return base tokens (with APY) + USDC
          addToBalance(baseTokenSymbol, result.baseAmount) // Includes APY earnings
          addToBalance('USDC', result.usdcAmount) // Return deposited USDC
          
          // Remove LP tokens
          const crucible = getCrucible(crucibleAddress)
          const lpTokenSymbol = crucible ? `${crucible.ptokenSymbol}/USDC LP` : `${baseTokenSymbol}/USDC LP`
          const cTokenAmount = result.baseAmount * 1.045
          const lpTokenAmount = Math.sqrt(cTokenAmount * result.usdcAmount)
          subtractFromBalance(lpTokenSymbol, lpTokenAmount)
          
          const lpSummary = [
            '🔥 Forge Position Update',
            '',
            `${displayPairSymbol}/USDC position closed.`,
            '',
            `• Base Tokens Returned: ${formatNumberWithCommas(result.baseAmount, 4)} ${baseTokenSymbol}`,
            `• USDC Returned: ${formatNumberWithCommas(result.usdcAmount, 2)} USDC`,
          ]

          if (result.apyEarned && result.apyEarned > 0) {
            lpSummary.push(`• Net Yield: +${formatNumberWithCommas(result.apyEarned, 4)} ${baseTokenSymbol}`)
          }
          if (result.principalFee && result.principalFee > 0) {
            lpSummary.push(`• Forge Principal Fee: ${formatNumberWithCommas(result.principalFee, 4)} ${baseTokenSymbol}`)
          }
          if (result.yieldFee && result.yieldFee > 0) {
            lpSummary.push(`• Forge Yield Fee: ${formatNumberWithCommas(result.yieldFee, 4)} ${baseTokenSymbol}`)
          }

          lpSummary.push('', 'Wallet balances refresh instantly in Forge.')

          alert(lpSummary.join('\n'))
        }
      } else {
        const result = await closeLVFPosition(positionId)
        if (result && result.success) {
          // Update wallet balances
          // When closing a leveraged position:
          // 1. Redeem cTOKENS → base tokens (unwrap) + APY earnings
          // 2. Repay borrowed USDC
          addToBalance(baseTokenSymbol, result.baseAmount)
          
          // Repay borrowed USDC (if any) - subtract from USDC balance
          if (result.repaidUSDC > 0) {
            subtractFromBalance('USDC', result.repaidUSDC)
          }
          
          // Remove LP tokens from wallet (if they were added when opening)
          const crucible = getCrucible(crucibleAddress)
          const lpTokenSymbol = crucible ? `${crucible.ptokenSymbol}/USDC LP` : `${baseTokenSymbol}/USDC LP`
          const baseTokenPrice = baseTokenSymbol === 'FORGE' ? 0.5 : 0.002
          const position = lvfPositions.find(p => p.id === positionId)
          if (position) {
            const collateralValue = position.collateral * baseTokenPrice
            const cTokenAmount = position.collateral * 1.045 // Exchange rate
            
            // Calculate total USDC used in the LP position
            let totalUSDC = position.borrowedUSDC
            if (position.leverageFactor === 1.5) {
              totalUSDC = collateralValue
            } else if (position.leverageFactor === 2.0) {
              totalUSDC = position.borrowedUSDC
            }
            
            const lpTokenAmount = Math.sqrt(cTokenAmount * totalUSDC)
            subtractFromBalance(lpTokenSymbol, lpTokenAmount)
          }
          
          const lvfSummary = [
            '🔥 Forge Position Update',
            '',
            `${displayPairSymbol}/USDC leveraged position closed.`,
            '',
            `• Released: ${formatNumberWithCommas(result.baseAmount, 4)} ${baseTokenSymbol}`,
          ]

          if (result.usdcAmount && result.usdcAmount > 0) {
            lvfSummary.push(`• USDC Settled: ${formatNumberWithCommas(result.usdcAmount, 2)} USDC`)
          }
          if (result.apyEarned && result.apyEarned > 0) {
            lvfSummary.push(`• Net Yield: +${formatNumberWithCommas(result.apyEarned, 4)} ${baseTokenSymbol}`)
          }
          if (result.principalFee && result.principalFee > 0) {
            lvfSummary.push(`• Forge Principal Fee: ${formatNumberWithCommas(result.principalFee, 4)} ${baseTokenSymbol}`)
          }
          if (result.yieldFee && result.yieldFee > 0) {
            lvfSummary.push(`• Forge Yield Fee: ${formatNumberWithCommas(result.yieldFee, 4)} ${baseTokenSymbol}`)
          }
          if (result.repaidUSDC && result.repaidUSDC > 0) {
            lvfSummary.push(`• Lending Pool Repaid: ${formatNumberWithCommas(result.repaidUSDC, 2)} USDC`)
          }
          if (result.borrowingInterest && result.borrowingInterest > 0) {
            lvfSummary.push(`• Interest Paid: ${formatNumberWithCommas(result.borrowingInterest, 2)} USDC`)
          }

          lvfSummary.push('', 'Portfolio metrics refresh automatically in Forge.')

          alert(lvfSummary.join('\n'))
        }
      }
      
      // Refresh portfolio
      window.dispatchEvent(new CustomEvent(positionType === 'lp' ? 'lpPositionClosed' : 'lvfPositionClosed'))
    } catch (error: any) {
      console.error('Error closing LP position:', error)
      alert(error.message || 'Failed to close LP position')
    }
  }

  const handleWithdraw = async () => {
    if (!amount || parseFloat(amount) <= 0) return

    try {
      // Call unwrapTokens which handles the unwrapping, fee calculation, APY earnings, and updates
      const result = await unwrapTokens(crucibleAddress, amount)
      
      // Update wallet balances - add base tokens received
      // Note: unwrapTokens already updates Crucible userBalances internally,
      // so we only need to update the wallet's base token balance
      if (result && result.baseAmount) {
        addToBalance(baseTokenSymbol, result.baseAmount)
        
        const unwrapSummary = [
          '🔥 Forge Position Update',
          '',
          `${ctokenSymbol} position closed.`,
          '',
          `• Released: ${formatNumberWithCommas(result.baseAmount, 4)} ${baseTokenSymbol}`,
        ]

        if (result.apyEarned && result.apyEarned > 0) {
          unwrapSummary.push(`• Net Yield: +${formatNumberWithCommas(result.apyEarned, 4)} ${baseTokenSymbol}`)
        }
        if (result.feeAmount && result.feeAmount > 0) {
          unwrapSummary.push(`• Forge Safety Fee (${(UNWRAP_FEE_RATE * 100).toFixed(2)}%): ${formatNumberWithCommas(result.feeAmount, 4)} ${baseTokenSymbol}`)
        }

        unwrapSummary.push('', 'Balances update instantly in your Forge wallet.')

        alert(unwrapSummary.join('\n'))
      } else {
        // Fallback calculation if result is null
        const ctokenAmount = parseFloat(amount)
        const baseAmountBeforeFee = ctokenAmount * exchangeRate
        const feeAmount = baseAmountBeforeFee * UNWRAP_FEE_RATE
        const netAmount = baseAmountBeforeFee - feeAmount
        addToBalance(baseTokenSymbol, netAmount)
      }
      
      // Dispatch event to refresh portfolio
      window.dispatchEvent(new CustomEvent('wrapPositionClosed', { 
        detail: { crucibleAddress, baseTokenSymbol } 
      }))
      
      onClose()
      setAmount('')
    } catch (error) {
      console.error('Withdraw error:', error)
      alert('Withdraw failed. Please try again.')
    }
  }

  const handleMax = () => {
    if (currentBalance) {
      setAmount((Number(currentBalance) / 1e9).toString())
    }
  }
  
  // Calculate available balance (use 1e9 scale for userBalances from useCrucible)
  const availableBalance = currentBalance ? Number(currentBalance) / 1e9 : 0

  // Calculate amounts with fee
  const baseAmountBeforeFee = amount ? parseFloat(amount) * exchangeRate : 0
  const withdrawalFee = baseAmountBeforeFee * UNWRAP_FEE_RATE // Forge unwrap fee
  const estimatedBaseAmount = amount 
    ? (baseAmountBeforeFee - withdrawalFee).toFixed(2)
    : '0.00'

  const withdrawDisabled =
    !amount || loading || parseFloat(amount) <= 0 || parseFloat(amount) > availableBalance

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm px-4">
      <div className="panel rounded-3xl w-full max-w-md p-6 relative">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-fogo-gray-400 hover:text-white transition-colors"
        >
          <XMarkIcon className="w-6 h-6" />
        </button>

        <h2 className="text-2xl font-bold text-white mb-2">Close Position</h2>
        <p className="text-fogo-gray-400 text-sm mb-6">
          Burn {ctokenSymbol} to withdraw {baseTokenSymbol}. You'll receive the current exchange rate value.
        </p>

        {/* Amount Input */}
        <div className="mb-4">
            <label className="block text-sm font-medium text-fogo-gray-300 mb-2">
              Withdraw Amount ({ctokenSymbol})
            </label>
            <div className="flex space-x-2">
              <div className="flex-1 relative">
                <input
                  type="number"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.00"
                  max={availableBalance > 0 ? availableBalance.toString() : undefined}
                className="w-full px-4 py-3 pr-12 panel-muted rounded-lg text-white placeholder-fogo-gray-500 focus:outline-none focus:ring-2 focus:ring-fogo-primary"
                />
              </div>
              <button
                onClick={handleMax}
                className="px-4 py-3 bg-fogo-gray-700 hover:bg-fogo-gray-600 text-white rounded-lg font-medium transition-colors"
              >
                MAX
              </button>
            </div>
            {availableBalance > 0 && (
              <p className="text-xs text-fogo-gray-500 mt-1">
                Available: {availableBalance.toFixed(2)} {ctokenSymbol}
              </p>
            )}
        </div>

        {/* LP Positions Section */}
        {hasLPPositions && allPositions.length > 0 && (
          <div className="bg-orange-500/10 border border-orange-500/30 rounded-lg p-4 mb-4">
            <div className="flex items-center gap-2 mb-3">
              <BoltIcon className="w-5 h-5 text-orange-400" />
              <h3 className="text-sm font-semibold text-orange-400">Active LP Positions</h3>
            </div>
            <div className="space-y-2">
              {allPositions.map((position) => {
                const isLeveraged = position.type === 'lvf'
                const leverage = isLeveraged ? (position as any).leverageFactor : 1
                const baseAmount = isLeveraged ? (position as any).collateral : (position as any).baseAmount
                const usdcAmount = isLeveraged ? (position as any).borrowedUSDC : (position as any).usdcAmount
                const positionId = position.id
                
                return (
                  <div key={positionId} className="panel-muted rounded p-3 flex items-center justify-between">
                    <div>
                      <div className="text-white text-sm font-medium">
                        {displayPairSymbol}/USDC {isLeveraged && leverage && `${leverage}x`}
                      </div>
                      <div className="text-xs text-fogo-gray-400 mt-1">
                        {baseAmount?.toFixed(2) || '0.00'} {baseTokenSymbol} + {usdcAmount?.toFixed(2) || '0.00'} USDC
                      </div>
                    </div>
                    <button
                      onClick={() => handleCloseLPPosition(positionId, position.type)}
                      disabled={lpLoading || lvfLoading}
                      className="px-3 py-1.5 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-medium rounded transition-colors"
                    >
                      {lpLoading || lvfLoading ? 'Closing...' : 'Close'}
                    </button>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Preview */}
        <div className="panel-muted rounded-lg p-4 mb-4 border border-fogo-gray-700">
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-fogo-gray-400 font-satoshi">You'll receive</span>
              <span className="text-white text-lg font-heading">
                {estimatedBaseAmount} {baseTokenSymbol}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-fogo-gray-400 font-satoshi">Exchange Rate</span>
              <span className="text-white text-sm font-heading">
                1 {ctokenSymbol} = {exchangeRate.toFixed(2)} {baseTokenSymbol}
              </span>
            </div>
            <div className="flex justify-between text-xs pt-2 border-t border-fogo-gray-700">
              <span className="text-fogo-gray-500 font-satoshi">Withdrawal Fee ({(UNWRAP_FEE_RATE * 100).toFixed(2)}%)</span>
              <span className="text-red-400 font-heading">
                -{withdrawalFee.toFixed(2)} {baseTokenSymbol}
              </span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-fogo-gray-500 font-satoshi">Yield Earned</span>
              <span className="text-green-400 font-heading">
                +{((exchangeRate - 1.045) * 100).toFixed(2)}%
              </span>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex space-x-3">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-3 bg-fogo-gray-700 hover:bg-fogo-gray-600 text-white rounded-lg font-medium transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleWithdraw}
            disabled={withdrawDisabled}
            className="flex-1 px-4 py-3 bg-fogo-primary-light hover:bg-fogo-primary text-white rounded-lg font-medium transition-colors shadow-[0_10px_30px_rgba(255,102,14,0.25)] disabled:bg-fogo-primary/40 disabled:hover:bg-fogo-primary/40 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Processing...' : 'Close Position'}
          </button>
        </div>
      </div>
    </div>
  )
}

