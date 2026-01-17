import React from 'react'
import { useLVFPosition } from '../hooks/useLVFPosition'
import { useBalance } from '../contexts/BalanceContext'
import { usePrice } from '../contexts/PriceContext'
import { useCrucible } from '../hooks/useCrucible'
import { formatNumberWithCommas } from '../utils/math'
import { INFERNO_CLOSE_FEE_RATE, INFERNO_YIELD_FEE_RATE } from '../config/fees'

interface LVFPositionCardProps {
  position: {
    id: string
    token: string
    collateral: number
    borrowedUSDC: number
    leverageFactor: number
    currentValue: number
    yieldEarned: number
    health: number
    isOpen: boolean
  }
  crucibleAddress: string
  baseTokenSymbol: 'SOL'
  baseAPY: number
  onClose: () => void
}

export default function LVFPositionCard({
  position,
  crucibleAddress,
  baseTokenSymbol,
  baseAPY,
  onClose,
}: LVFPositionCardProps) {
  const { closePosition, loading, calculateEffectiveAPY } = useLVFPosition({
    crucibleAddress,
    baseTokenSymbol,
  })
  const { addToBalance, subtractFromBalance, getBalance } = useBalance()
  const { solPrice } = usePrice()
  const { getCrucible } = useCrucible()

  const displayPairToken = position.token.replace(/^c/i, 'if')

  const effectiveAPY = calculateEffectiveAPY(baseAPY, position.leverageFactor)
  const healthColor =
    position.health >= 200 ? 'text-green-400' :
    position.health >= 150 ? 'text-yellow-400' :
    position.health >= 120 ? 'text-orange-400' :
    'text-red-400'

  const handleClosePosition = async () => {
    // Calculate closing fee for confirmation
    const baseTokenPrice = solPrice // Use real-time SOL price from CoinGecko
    const collateralValueUSD = position.collateral * baseTokenPrice
    const principalFeeUSD = collateralValueUSD * INFERNO_CLOSE_FEE_RATE
    const baseAmountAfterFee = position.collateral * (1 - INFERNO_CLOSE_FEE_RATE)
    
    const feeMessage = `Closing fee: ${principalFeeUSD.toFixed(2)} USD (${(INFERNO_CLOSE_FEE_RATE * 100).toFixed(2)}% on principal) + ${(INFERNO_YIELD_FEE_RATE * 100).toFixed(0)}% of accrued yield.\nYou'll receive approximately ${baseAmountAfterFee.toFixed(2)} ${baseTokenSymbol} plus net yield.`
    
    if (!confirm(`Are you sure you want to close this leveraged position?\n\n${feeMessage}`)) {
      return
    }

    try {
      const result = await closePosition(position.id)
      
      if (result && result.success) {
        // Update wallet balances
        // When closing a leveraged position:
        // 1. Redeem cTOKENS → base tokens (unwrap) + APY earnings
        // 2. Repay borrowed USDC (if any)
        // Total received = baseAmount (includes APY earned)
        addToBalance(baseTokenSymbol, result.baseAmount)
        
        // Repay borrowed USDC (if any) - subtract from USDC balance
        if (result.repaidUSDC > 0) {
          subtractFromBalance('USDC', result.repaidUSDC)
        }
        
        // Remove LP tokens from wallet (if they were added when opening)
        const crucible = getCrucible(crucibleAddress)
        const lpTokenSymbol = crucible ? `${crucible.ptokenSymbol}/USDC LP` : `${baseTokenSymbol}/USDC LP`
        
        // Calculate LP token amount that was added when opening
        const baseTokenPrice = solPrice // Use real-time SOL price from CoinGecko
        const collateralValue = position.collateral * baseTokenPrice
        // Use actual exchange rate from crucible (scaled by 1e6), default to 1.0
        const exchangeRate = crucible?.exchangeRate ? Number(crucible.exchangeRate) / 1e6 : 1.0
        const cTokenAmount = position.collateral * exchangeRate
        
        // Calculate total USDC used in the LP position
        let totalUSDC = position.borrowedUSDC
        if (position.leverageFactor === 1.5) {
          totalUSDC = collateralValue // Total USDC = collateral value for 1.5x
        } else if (position.leverageFactor === 2.0) {
          totalUSDC = position.borrowedUSDC // Total USDC = borrowed amount for 2x
        }
        
        const lpTokenAmount = Math.sqrt(cTokenAmount * totalUSDC) // Constant product formula
        subtractFromBalance(lpTokenSymbol, lpTokenAmount)
        
        const summaryLines = [
          '🔥 Forge Position Update',
          '',
          `${displayPairToken}/USDC leveraged position closed.`,
          '',
          `• Released: ${formatNumberWithCommas(result.baseAmount, 4)} ${baseTokenSymbol}`,
        ]

        if (result.usdcAmount && result.usdcAmount > 0) {
          summaryLines.push(`• USDC Settled: ${formatNumberWithCommas(result.usdcAmount, 2)} USDC`)
        }

        if (result.apyEarned && result.apyEarned > 0) {
          summaryLines.push(`• Net Yield: +${formatNumberWithCommas(result.apyEarned, 4)} ${baseTokenSymbol}`)
        }

        if (result.yieldFee && result.yieldFee > 0) {
          summaryLines.push(`• Forge Yield Fee: ${formatNumberWithCommas(result.yieldFee, 4)} ${baseTokenSymbol}`)
        }

        if (result.principalFee && result.principalFee > 0) {
          summaryLines.push(`• Forge Principal Fee: ${formatNumberWithCommas(result.principalFee, 4)} ${baseTokenSymbol}`)
        }

        if (result.repaidUSDC && result.repaidUSDC > 0) {
          summaryLines.push(`• Lending Pool Repaid: ${formatNumberWithCommas(result.repaidUSDC, 2)} USDC`)
        }

        if (result.borrowingInterest && result.borrowingInterest > 0) {
          summaryLines.push(`• Interest Paid: ${formatNumberWithCommas(result.borrowingInterest, 2)} USDC`)
        }

        summaryLines.push('', 'Wallet and portfolio balances refresh instantly in Forge.')

        alert(summaryLines.join('\n'))
      }
      
      onClose()
    } catch (error: any) {
      console.error('Error closing position:', error)
      alert(error.message || 'Failed to close position')
    }
  }

  return (
    <div className="panel rounded-xl p-5 border border-orange-500/20 hover:border-orange-500/40 transition-all duration-300 hover:shadow-lg group">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-orange-500/20 flex items-center justify-center">
            <svg className="w-4 h-4 text-orange-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <div>
            <h3 className="text-lg font-heading text-white">{displayPairToken}/USDC</h3>
            <p className="text-xs text-forge-gray-400">Leveraged Position</p>
          </div>
        </div>
        <div className="text-right">
          <span className={`px-3 py-1.5 rounded-lg text-xs font-bold border ${
            position.leverageFactor === 2.0 ? 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30' :
            'bg-orange-500/20 text-orange-400 border-orange-500/30'
          }`}>
            {position.leverageFactor}x
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="panel-muted backdrop-blur-sm rounded-lg p-3 border border-forge-gray-700/50">
          <div className="text-xs text-forge-gray-400 mb-1">Collateral</div>
          <div className="text-white font-bold text-base">
            {position.collateral.toFixed(2)} {position.token}
          </div>
        </div>
        <div className="panel-muted backdrop-blur-sm rounded-lg p-3 border border-orange-500/20">
          <div className="text-xs text-forge-gray-400 mb-1">Borrowed</div>
          <div className="text-orange-400 font-bold text-base">
            {position.borrowedUSDC.toFixed(2)} USDC
          </div>
        </div>
        <div className={`panel-muted backdrop-blur-sm rounded-lg p-3 border ${
          position.health >= 200 ? 'border-green-500/30' :
          position.health >= 150 ? 'border-yellow-500/30' :
          position.health >= 120 ? 'border-orange-500/30' :
          'border-red-500/30'
        }`}>
          <div className="text-xs text-forge-gray-400 mb-1">Health Factor</div>
          <div className={`font-bold text-base ${healthColor}`}>
            {(position.health / 100).toFixed(2)}x
          </div>
          {position.health < 120 && (
            <div className="text-xs text-red-400 mt-1 flex items-center gap-1">
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              At risk
            </div>
          )}
        </div>
        <div className="panel-muted backdrop-blur-sm rounded-lg p-3 border border-forge-gray-700/50">
          <div className="text-xs text-forge-gray-400 mb-1">Current Value</div>
          <div className="text-white font-bold text-base">
            ${position.currentValue.toFixed(2)}
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between mb-4 p-4 bg-gradient-to-r from-orange-500/10 to-orange-500/5 rounded-lg border border-orange-500/20">
        <div>
          <div className="text-xs text-forge-gray-400 mb-1">Effective APY</div>
          <div className="text-orange-400 font-bold text-xl">
            {effectiveAPY.toFixed(2)}%
          </div>
        </div>
        <div className="text-right">
          <div className="text-xs text-forge-gray-400 mb-1">Yield Earned</div>
          <div className="text-green-400 font-bold text-base">
            +{position.yieldEarned.toFixed(4)} {position.token}
          </div>
        </div>
      </div>

      <button
        onClick={handleClosePosition}
        disabled={loading}
        className="w-full px-5 py-3 bg-gradient-to-r from-forge-primary to-forge-primary-light hover:from-forge-primary-dark hover:to-forge-primary text-white rounded-xl font-semibold transition-all duration-300 transform hover:scale-105 hover:shadow-forge-lg disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none relative overflow-hidden group"
      >
        {loading && (
          <span className="absolute inset-0 flex items-center justify-center">
            <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
          </span>
        )}
        <span className={loading ? 'opacity-0' : 'opacity-100'}>
          {loading ? 'Closing...' : 'Close Position'}
        </span>
      </button>
    </div>
  )
}
