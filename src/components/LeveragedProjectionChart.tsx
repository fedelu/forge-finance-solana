import React, { useState } from 'react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import { ChevronDownIcon, ChevronUpIcon } from '@heroicons/react/24/outline'

interface LeveragedProjectionChartProps {
  baseAPY: number
  leverage: number
  currentPrice: number // Base token price in USD
  currentExchangeRate: number // 1 cToken = X base tokens
  baseTokenSymbol: 'SOL'
}

export default function LeveragedProjectionChart({
  baseAPY,
  leverage,
  currentPrice,
  currentExchangeRate,
  baseTokenSymbol,
}: LeveragedProjectionChartProps) {
  const [showChart, setShowChart] = useState(false)
  
  // Calculate APY projections
  const cTokenAPY = baseAPY // cToken APY is the base APY
  
  // LP positions APY calculations
  const lpAPY_1x = baseAPY * 3 // LP 1x: 3x base APY
  const lpAPY_1_5x = (baseAPY * 3 * 1.5) - (5 * 0.5) // LP 1.5x: 3x base * 1.5 - borrow cost
  const lpAPY_2x = (baseAPY * 3 * 2.0) - (5 * 1.0) // LP 2x: 3x base * 2 - borrow cost
  
  // Calculate cumulative APY projections over time
  const calculateCumulativeAPY = (days: number, apy: number): number => {
    const years = days / 365
    // Simple compound: cumulative return percentage
    return apy * years
  }

  const data = [
    { 
      time: 'Today', 
      cToken: 0,
      lp1x: 0,
      lp1_5x: 0,
      lp2x: 0
    },
    { 
      time: '30D', 
      cToken: calculateCumulativeAPY(30, cTokenAPY),
      lp1x: calculateCumulativeAPY(30, lpAPY_1x),
      lp1_5x: calculateCumulativeAPY(30, lpAPY_1_5x),
      lp2x: calculateCumulativeAPY(30, lpAPY_2x)
    },
    { 
      time: '90D', 
      cToken: calculateCumulativeAPY(90, cTokenAPY),
      lp1x: calculateCumulativeAPY(90, lpAPY_1x),
      lp1_5x: calculateCumulativeAPY(90, lpAPY_1_5x),
      lp2x: calculateCumulativeAPY(90, lpAPY_2x)
    },
    { 
      time: '180D', 
      cToken: calculateCumulativeAPY(180, cTokenAPY),
      lp1x: calculateCumulativeAPY(180, lpAPY_1x),
      lp1_5x: calculateCumulativeAPY(180, lpAPY_1_5x),
      lp2x: calculateCumulativeAPY(180, lpAPY_2x)
    },
    { 
      time: '1Y', 
      cToken: cTokenAPY,
      lp1x: lpAPY_1x,
      lp1_5x: lpAPY_1_5x,
      lp2x: lpAPY_2x
    },
  ]
  
  return (
    <div className="panel rounded-2xl p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-heading text-white mb-1">
            Yield Projections
          </h3>
        </div>
        <button
          onClick={() => setShowChart(!showChart)}
          className={`px-4 py-2 rounded-lg text-xs font-heading uppercase tracking-[0.18em] transition-all duration-300 flex items-center gap-2 ${
            showChart
              ? 'bg-forge-primary-light/30 border border-forge-primary/40 text-white shadow-[0_10px_25px_rgba(255,102,14,0.25)] hover:bg-forge-primary/30 hover:border-forge-primary/50'
              : 'bg-white/5 border border-white/10 text-forge-gray-200 hover:text-white hover:bg-white/10 hover:border-white/20'
          }`}
        >
          <span>{showChart ? 'Hide Chart' : 'Show Chart'}</span>
          {showChart ? (
            <ChevronUpIcon className="w-4 h-4" />
          ) : (
            <ChevronDownIcon className="w-4 h-4" />
          )}
        </button>
      </div>

      {/* Chart */}
      {showChart && (
        <div className="mt-6 h-64">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 5, right: 5, left: -20, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.3} />
              <XAxis 
                dataKey="time" 
                stroke="#9ca3af"
                tick={{ fill: '#9ca3af', fontSize: 11 }}
              />
              <YAxis 
                stroke="#9ca3af"
                tick={{ fill: '#9ca3af', fontSize: 11 }}
                tickFormatter={(value) => `${value.toFixed(1)}%`}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'rgba(17, 24, 39, 0.95)',
                  border: '1px solid rgba(255, 165, 0, 0.5)',
                  borderRadius: '8px',
                  color: '#ffffff',
                  padding: '8px',
                }}
                formatter={(value: any) => `${value.toFixed(2)}%`}
                labelFormatter={(label) => `Time: ${label}`}
              />
              <Legend 
                wrapperStyle={{ paddingTop: '10px', fontSize: '12px' }}
                iconType="line"
              />
              <Line 
                type="monotone" 
                dataKey="cToken" 
                stroke="#FFA500" 
                strokeWidth={2}
                name={`c${baseTokenSymbol}`}
                dot={false}
                activeDot={{ r: 5 }}
              />
              <Line 
                type="monotone" 
                dataKey="lp1x" 
                stroke="#22c55e" 
                strokeWidth={2}
                name={`if${baseTokenSymbol}/USDC 1x`}
                dot={false}
                activeDot={{ r: 5 }}
              />
              <Line 
                type="monotone" 
                dataKey="lp1_5x" 
                stroke="#3b82f6" 
                strokeWidth={2}
                name={`if${baseTokenSymbol}/USDC 1.5x`}
                dot={false}
                activeDot={{ r: 5 }}
              />
              <Line 
                type="monotone" 
                dataKey="lp2x" 
                stroke="#ef4444" 
                strokeWidth={2}
                name={`if${baseTokenSymbol}/USDC 2x`}
                dot={false}
                activeDot={{ r: 5 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}

