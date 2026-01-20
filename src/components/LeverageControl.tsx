import React from 'react'
import { ExclamationTriangleIcon } from '@heroicons/react/24/outline'
import { formatUSD, formatUSDC, formatSOL } from '../utils/math'

interface LeverageControlProps {
  leverage: number
  onLeverageChange: (leverage: number) => void
  baseAPY: number
  onEffectiveAPYChange: (apy: number) => void
  disabled?: boolean
  borrowed?: number // USDC borrowed
  healthFactor?: number // Health factor
  collateralAmount?: number // Current collateral in base token
}

export default function LeverageControl({
  leverage,
  onLeverageChange,
  baseAPY,
  onEffectiveAPYChange,
  disabled = false,
  borrowed = 0,
  healthFactor = 999,
  collateralAmount = 0,
}: LeverageControlProps) {
  const calculateEffectiveAPY = (multiplier: number): number => {
    const borrowRate = 10 // 10% APY (fixed rate from lending-pool, matches contract)
    // Matches contract: leveraged_apy = base_apy * leverage_multiplier / 100
    const leveragedYield = baseAPY * multiplier
    // Matches contract: borrow_cost = borrow_rate * (leverage_multiplier - 100) / 100
    const borrowCost = borrowRate * (multiplier - 1)
    return leveragedYield - borrowCost
  }

  const handleLeverageChange = (newLeverage: number) => {
    onLeverageChange(newLeverage)
    const effectiveAPY = calculateEffectiveAPY(newLeverage)
    onEffectiveAPYChange(effectiveAPY)
  }

  const effectiveAPY = calculateEffectiveAPY(leverage)

  // Don't show leverage controls if leverage is 1.0 - that's not leverage!
  if (leverage <= 1.0) {
    return null
  }

  return (
    <div className="panel-muted rounded-lg p-4 border border-forge-gray-700">
      {/* Leverage Toggle - Only shown when leverage > 1.0 */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-forge-gray-300 font-medium text-sm">Leverage Multiplier</span>
          <span className="font-bold text-sm text-yellow-400">
            {leverage}x
          </span>
        </div>
        <div className="flex space-x-2">
          <button
            onClick={() => handleLeverageChange(1.5)}
            disabled={disabled}
            className={`flex-1 px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${
              leverage === 1.5
                ? 'bg-forge-primary text-white shadow-lg'
                : 'bg-forge-gray-700 text-forge-gray-300 hover:bg-forge-gray-600'
            } disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            1.5x
          </button>
          <button
            onClick={() => handleLeverageChange(2.0)}
            disabled={disabled}
            className={`flex-1 px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${
              leverage === 2.0
                ? 'bg-forge-primary text-white shadow-lg'
                : 'bg-forge-gray-700 text-forge-gray-300 hover:bg-forge-gray-600'
            } disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            2x
          </button>
        </div>
      </div>

      {/* Borrowed Amount Display */}
      {borrowed > 0 && (
        <div className="bg-orange-500/10 border border-orange-500/30 rounded p-2 mb-3">
          <div className="flex items-center justify-between">
            <span className="text-xs text-forge-gray-400">Borrowed USDC</span>
            <span className="text-sm font-bold text-orange-400">
              {borrowed.toFixed(2)} USDC
            </span>
          </div>
          <div className="flex items-start justify-between mt-2 pt-2 border-t border-orange-500/20">
            <div className="flex-1">
              <div className="flex items-center space-x-1 mb-1">
                <span className="text-xs text-forge-gray-400">Interest Rate:</span>
                <div title="Borrowing Interest Rate: 10% APY (Annual Percentage Yield). This is the annual cost you pay for borrowing USDC from the lending pool. The rate compounds daily.">
                  <svg className="w-3 h-3 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
              </div>
              <div className="text-xs font-medium text-orange-400">
                5% APY
              </div>
              <div className="text-[10px] text-forge-gray-500 mt-1">
                Annual cost: {formatUSDC(borrowed * 0.05)} USDC
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Health Factor Display */}
      {borrowed > 0 && (
        <div className="mb-3">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-forge-gray-400">Health Factor</span>
            <span className={`text-xs font-medium ${
              healthFactor >= 2.0 ? 'text-green-400' :
              healthFactor >= 1.5 ? 'text-yellow-400' :
              healthFactor >= 1.0 ? 'text-orange-400' :
              'text-red-400'
            }`}>
              {healthFactor >= 999 ? '∞' : healthFactor.toFixed(2)}x
            </span>
          </div>
          <div className="w-full h-2 bg-forge-gray-700 rounded-full overflow-hidden">
            <div
              className={`h-full transition-all duration-300 ${
                healthFactor >= 2.0 ? 'bg-green-500' :
                healthFactor >= 1.5 ? 'bg-yellow-500' :
                healthFactor >= 1.0 ? 'bg-orange-500' :
                'bg-red-500'
              }`}
              style={{ width: `${Math.min(100, (healthFactor / 2.0) * 100)}%` }}
            />
          </div>
          <div className="text-xs text-forge-gray-500 mt-1">
            {healthFactor >= 999 ? 'No borrow' : healthFactor < 1.0 ? '⚠️ Liquidation risk' : 'Safe'}
          </div>
        </div>
      )}

      {/* Effective APY Display */}
      <div className="panel-muted rounded p-2 mb-3">
        <div className="flex items-center justify-between">
          <span className="text-xs text-forge-gray-400">Effective APY</span>
          <span className="text-sm font-bold text-forge-primary">
            {effectiveAPY.toFixed(2)}%
          </span>
        </div>
        <div className="text-xs text-forge-gray-500 mt-1">
          Base: {baseAPY.toFixed(2)}% × {leverage}x - Borrow Cost ({10 * (leverage - 1)}%)
        </div>
      </div>

      {/* Warning for 2x leverage */}
      {leverage >= 2.0 && (
        <div className="flex items-start space-x-2 p-2 bg-yellow-500/10 border border-yellow-500/30 rounded text-xs text-yellow-400 mt-3">
          <ExclamationTriangleIcon className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>
            Leveraged positions increase both potential gains and losses. Monitor your position carefully.
          </span>
        </div>
      )}
    </div>
  )
}

