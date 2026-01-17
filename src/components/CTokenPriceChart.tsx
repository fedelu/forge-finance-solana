import React from 'react'
import { XMarkIcon } from '@heroicons/react/24/outline'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, Area, AreaChart } from 'recharts'
import { useCrucible } from '../hooks/useCrucible'

interface CTokenPriceChartProps {
  isOpen: boolean
  onClose: () => void
  crucibleId: string
}

export function CTokenPriceChart({ isOpen, onClose, crucibleId }: CTokenPriceChartProps) {
  const { crucibles } = useCrucible()
  const crucible = crucibles.find(c => c.id === crucibleId)

  if (!isOpen || !crucible) return null

  // Calculate price growth over 1 year (365 days)
  // Formula: P(t) = P(0) * (1 + APY)^(t/365)
  // Where t is in days, APY is the annual percentage yield
  const apy = crucible.apr
  const daysInYear = 365
  const baseTokenPrice = 200 // SOL price in USD
  
  // Get current exchange rate from on-chain data
  // exchange_rate is scaled by 1_000_000 on-chain (1.0 = 1_000_000)
  const currentExchangeRate = crucible.exchangeRate 
    ? Number(crucible.exchangeRate) / 1_000_000 
    : 1.0
  
  // cToken price = baseTokenPrice * exchangeRate
  // When exchange rate is 1.0, cToken price = SOL price
  // As yield accumulates, exchange rate grows, so cToken price grows
  const initialPrice = baseTokenPrice * currentExchangeRate
  
  // Project the final price after 1 year using APY
  const finalPrice = initialPrice * (1 + apy)

  // Generate data points for the year
  const generateChartData = () => {
    const data = []
    const intervals = 12 // Show monthly intervals
    const daysPerInterval = daysInYear / intervals

    for (let i = 0; i <= intervals; i++) {
      const days = i * daysPerInterval
      const elapsedYears = days / daysInYear
      
      // Calculate price using compound interest formula
      const currentPrice = initialPrice * Math.pow(1 + apy, elapsedYears)
      
      data.push({
        month: i,
        day: Math.floor(days),
        price: parseFloat(currentPrice.toFixed(6)),
        label: getMonthLabel(i)
      })
    }

    return data
  }

  const getMonthLabel = (month: number) => {
    if (month === 0) return 'Today'
    if (month === 12) return '1 Year'
    return `Month ${month}`
  }

  const chartData = generateChartData()

  // Calculate projections
  const todayPrice = initialPrice
  const yearEndPrice = finalPrice
  const priceIncreasePercent = ((yearEndPrice - todayPrice) / todayPrice) * 100

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div 
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
      />
      
      <div className="relative panel border border-forge-primary/30 w-full max-w-4xl max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="p-6 border-b border-forge-gray-700 panel">
          <div className="flex items-center justify-between mb-2">
            <div>
              <h3 className="text-2xl font-heading text-white">
                {crucible.ptokenSymbol} Price Projection
              </h3>
              <p className="text-forge-gray-400 text-sm mt-1">
                Price growth over 1 year based on {formatPercentage(apy)} APY
              </p>
            </div>
            <button
              onClick={onClose}
              className="p-2 hover:bg-forge-gray-700 rounded-lg transition-colors"
            >
              <XMarkIcon className="h-6 w-6 text-forge-gray-400" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto max-h-[calc(90vh-100px)]">
          {/* Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
            <div className="bg-gradient-to-br from-forge-primary/10 to-forge-primary/5 rounded-xl p-4 border border-forge-primary/20">
              <div className="text-sm text-forge-gray-300 mb-1">Start Price</div>
              <div className="text-2xl font-bold text-forge-primary">
                ${todayPrice.toFixed(4)}
              </div>
              <div className="text-xs text-forge-gray-400 mt-1">At deposit</div>
            </div>
            <div className="bg-gradient-to-br from-forge-accent/10 to-forge-accent/5 rounded-xl p-4 border border-forge-accent/20">
              <div className="text-sm text-forge-gray-300 mb-1">End Price (1 year)</div>
              <div className="text-2xl font-bold text-forge-accent">
                ${yearEndPrice.toFixed(4)}
              </div>
              <div className="text-xs text-forge-gray-400 mt-1">After 1 year</div>
            </div>
            <div className="bg-gradient-to-br from-forge-success/10 to-forge-success/5 rounded-xl p-4 border border-forge-success/20">
              <div className="text-sm text-forge-gray-300 mb-1">APY Rate</div>
              <div className="text-2xl font-bold text-forge-success">
                {formatPercentage(apy)}
              </div>
              <div className="text-xs text-forge-gray-400 mt-1">Annual Percentage Yield</div>
            </div>
            <div className="bg-gradient-to-br from-purple-500/10 to-purple-500/5 rounded-xl p-4 border border-purple-500/20">
              <div className="text-sm text-forge-gray-300 mb-1">Price Increase</div>
              <div className="text-2xl font-bold text-purple-400">
                {priceIncreasePercent.toFixed(2)}%
              </div>
              <div className="text-xs text-forge-gray-400 mt-1">Actual growth</div>
            </div>
          </div>

          {/* Chart */}
          <div className="panel rounded-xl p-4 border border-forge-gray-700">
            <div className="mb-4">
              <h4 className="text-lg font-semibold text-white mb-1">
                {crucible.ptokenSymbol} Price Growth
              </h4>
              <p className="text-sm text-forge-gray-400">
                Price increases over time as yield accumulates
              </p>
            </div>
            <ResponsiveContainer width="100%" height={400}>
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="priceGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#FF660E" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#FF660E" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis 
                  dataKey="month" 
                  stroke="#9CA3AF"
                  tick={{ fill: '#9CA3AF' }}
                  label={{ value: 'Time', position: 'insideBottom', offset: -5 }}
                />
                <YAxis 
                  stroke="#9CA3AF"
                  tick={{ fill: '#9CA3AF' }}
                  label={{ value: 'Price ($)', angle: -90, position: 'insideLeft' }}
                  domain={['dataMin - 0.01', 'dataMax + 0.01']}
                  tickFormatter={(value) => `$${value.toFixed(3)}`}
                />
                <Tooltip 
                  contentStyle={{ 
                    backgroundColor: '#1F2937', 
                    border: '1px solid #374151',
                    borderRadius: '0.5rem',
                    color: '#fff'
                  }}
                  formatter={(value: number) => `$${value.toFixed(6)}`}
                  labelFormatter={(label: string) => {
                    const data = chartData[parseInt(label)]
                    return `Day ${data.day} (${data.label})`
                  }}
                />
                <Legend 
                  wrapperStyle={{ color: '#9CA3AF' }}
                />
                <Area
                  type="monotone"
                  dataKey="price"
                  stroke="#FF660E"
                  strokeWidth={2}
                  fill="url(#priceGradient)"
                  name={`${crucible.ptokenSymbol} Price`}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          {/* Info Section */}
          <div className="mt-6 panel rounded-xl p-4 border border-forge-primary/20">
            <h4 className="text-sm font-semibold text-forge-primary mb-2">How it works</h4>
            <div className="text-xs text-forge-gray-300 space-y-1">
              <div>• At deposit: 1 {crucible.baseToken} = 1 {crucible.ptokenSymbol} (1:1 exchange rate)</div>
              <div>• Initial {crucible.ptokenSymbol} price: ${todayPrice.toFixed(4)} (same as {crucible.baseToken})</div>
              <div>• Over time: {crucible.ptokenSymbol} price increases through exchange rate growth</div>
              <div>• After 1 year: {crucible.ptokenSymbol} reaches ${yearEndPrice.toFixed(4)} (${priceIncreasePercent.toFixed(2)}% price increase)</div>
              <div>• Withdrawal: Exchange {crucible.ptokenSymbol} back to {crucible.baseToken} at the higher price</div>
              <div>• Result: You receive MORE {crucible.baseToken} than originally deposited</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function formatPercentage(value: number): string {
  return `${(value * 100).toFixed(2)}%`
}

