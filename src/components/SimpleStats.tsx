import React, { useState, useEffect, useMemo } from 'react'
import { 
  CurrencyDollarIcon, 
  BanknotesIcon, 
  UserGroupIcon, 
  ChartBarIcon,
  ArrowUpIcon,
  ArrowDownIcon,
  FireIcon,
  BoltIcon,
  CubeIcon,
  CurrencyDollarIcon as DollarIcon
} from '@heroicons/react/24/outline'
import { useCrucible } from '../hooks/useCrucible'
import { useAnalytics } from '../contexts/AnalyticsContext'

interface ProtocolStats {
  totalCrucibles: number
  totalTVL: number
  totalUsers: number
  averageAPR: number
  priceChange24h: number
  volume24h: number
  tvlChange: number
  userChange: number
  aprChange: number
  volumeChange: number
}

interface SimpleStatsProps {
  className?: string
}

export default function SimpleStats({ className = '' }: SimpleStatsProps) {
  const [isLive, setIsLive] = useState(true)
  const [isClient, setIsClient] = useState(false)
  
  // Only use context hooks on client side
  const { crucibles, loading: cruciblesLoading } = isClient ? useCrucible() : { crucibles: [], loading: true }
  const analytics = isClient ? useAnalytics().analytics : { totalVolume: 0, transactionCount: 0 }
  
  console.log('SimpleStats: isClient:', isClient, 'loading:', cruciblesLoading);
  console.log('SimpleStats: crucibles:', crucibles);
  console.log('SimpleStats: analytics:', analytics);
  
  useEffect(() => {
    setIsClient(true)
  }, [])

  // Calculate stats with real data when client-side, static data for SSR
  const stats = useMemo(() => {
    if (!isClient) {
      // Static data for SSR - use zeros, will be populated on client
      return {
        totalCrucibles: 1,
        totalTVL: 0, // Will be fetched from on-chain
        totalUsers: 0,
        averageAPR: 0,
        priceChange24h: 0,
        volume24h: 0,
        tvlChange: 0,
        userChange: 0,
        aprChange: 0,
        volumeChange: 0
      }
    }
    
    // Real data when client-side - no more mock percentages
    const totalCrucibles = crucibles.length
    const totalTVL = crucibles.reduce((sum, crucible) => sum + crucible.tvl, 0)
    const totalUsers = analytics.transactionCount > 0 ? analytics.transactionCount : 0 // Real user count from transactions
    const averageAPR = crucibles.length > 0 
      ? crucibles.reduce((sum, crucible) => sum + crucible.apr, 0) / crucibles.length 
      : 0 // Show 0 if no data, not fake 8.5
    // Compute 24h volume - dynamic based on recent deposits
    const now = Date.now()
    const txs = (analytics as any).transactions || []
    const current24hVolume = txs
      .filter((tx: any) => now - tx.timestamp <= 24 * 60 * 60 * 1000) // Last 24 hours
      .filter((tx: any) => tx.type === 'deposit') // Only deposits
      .reduce((sum: number, tx: any) => sum + (tx.amount * 0.5), 0) // FOGO price = $0.5
    // Real change calculations - 0 if no data available (no more fake percentages)
    const priceChange24h = 0 // Will be calculated from price feed when available
    const tvlChange = 0 // Will be calculated from historical TVL when available
    const userChange = 0 // Will be calculated from user growth when available
    const aprChange = 0 // Will be calculated from APR history when available
    
    // Calculate 24h volume change dynamically
    const previous24hVolume = txs
      .filter((tx: any) => now - tx.timestamp <= 48 * 60 * 60 * 1000 && now - tx.timestamp > 24 * 60 * 60 * 1000) // 24-48 hours ago
      .filter((tx: any) => tx.type === 'deposit')
      .reduce((sum: number, tx: any) => sum + (tx.amount * 0.5), 0)
    
    const volumeChange = previous24hVolume > 0 
      ? ((current24hVolume - previous24hVolume) / previous24hVolume) * 100 
      : 0 // Start at 0% if no previous volume

    return {
      totalCrucibles,
      totalTVL,
      totalUsers,
      averageAPR,
      priceChange24h,
      volume24h: current24hVolume,
      tvlChange,
      userChange,
      aprChange,
      volumeChange
    }
  }, [isClient, crucibles, analytics])

  // Real-time updates are now handled by the contexts
  // No need for simulation since we're using real data

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount)
  }

  const formatPercentage = (value: number) => {
    return `${(value * 100).toFixed(2)}%`
  }

  const formatChange = (value: number, isPercentage = false) => {
    const sign = value >= 0 ? '+' : ''
    const formatted = isPercentage ? value.toFixed(1) : value.toLocaleString()
    return `${sign}${formatted}${isPercentage ? '%' : ''}`
  }

  const formatNumberWithCommas = (value: number) => {
    return value.toLocaleString('en-US', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2
    })
  }

  const StatCard = ({ 
    title, 
    value, 
    change, 
    changeType, 
    delay = 0 
  }: {
    title: string
    value: string | number
    change: number
    changeType: 'positive' | 'negative' | 'neutral'
    delay?: number
  }) => {
    const isPositive = changeType === 'positive'
    const isNegative = changeType === 'negative'
    const valueStr = value.toString()
    const isLongValue = valueStr.length > 10
    
    return (
      <div
        className="panel-muted backdrop-blur-sm rounded-2xl p-8 border border-forge-gray-700/50 shadow-fogo hover:shadow-forge-lg transition-all duration-300 hover:scale-105 hover:-translate-y-1 min-h-[180px] overflow-hidden"
        style={{ animationDelay: `${delay}ms` }}
      >
        <div className="space-y-6 h-full flex flex-col">
          <p className="text-forge-gray-400 text-sm font-satoshi font-medium uppercase tracking-wide">{title}</p>
          
          <div className="flex-1 flex items-center min-w-0">
            <p 
              className={`font-heading text-white break-all overflow-hidden ${
                isLongValue ? 'text-2xl leading-tight' : 'text-4xl'
              }`}
              title={isLongValue ? valueStr : undefined}
              style={{ 
                wordBreak: 'break-all',
                overflowWrap: 'break-word',
                hyphens: 'auto'
              }}
            >
              {isLongValue ? valueStr.substring(0, 10) + '...' : value}
            </p>
          </div>
          
          <div className="flex items-center space-x-2">
            {isPositive && <ArrowUpIcon className="h-4 w-4 text-forge-success" />}
            {isNegative && <ArrowDownIcon className="h-4 w-4 text-forge-error" />}
            <span className={`text-sm font-satoshi font-medium ${
              isPositive ? 'text-forge-success' : 
              isNegative ? 'text-forge-error' : 
              'text-forge-gray-400'
            }`}>
              {formatChange(change, true)}
            </span>
            <span className="text-forge-gray-500 text-sm font-satoshi-light">this week</span>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={`space-y-8 ${className}`}>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between space-y-4 sm:space-y-0">
        <div>
          <h2 className="text-3xl font-heading text-white mb-2">Protocol Statistics</h2>
          <p className="text-forge-gray-400 font-satoshi-light">Real-time data and performance metrics</p>
        </div>
        
        <div className="flex items-center space-x-4">
          {/* Live Status */}
          <div className="flex items-center space-x-2">
            <div className={`w-3 h-3 rounded-full ${isLive ? 'status-online' : 'status-offline'}`} />
            <span className="text-sm text-forge-gray-400 font-satoshi">Live</span>
            <button 
              onClick={() => setIsLive(!isLive)}
              className="text-xs px-3 py-1 rounded-lg bg-forge-gray-700 hover:bg-forge-gray-600 transition-colors hover-lift font-satoshi"
            >
              {isLive ? 'Pause' : 'Resume'}
            </button>
          </div>
        </div>
      </div>
      
      {/* Per-Crucible Stats */}
      {isClient && crucibles.length > 0 && (
        <div className="panel rounded-2xl p-6 border border-forge-gray-700 shadow-fogo">
          <h3 className="text-xl font-heading text-white mb-6">Per-Crucible Statistics</h3>
          <div className="flex justify-center">
            <div className="grid grid-cols-1 gap-6 max-w-2xl w-full">
            {crucibles.map((crucible) => {
              const yieldEarned = crucible.apyEarnedByUsers || 0; // APY-based yield earned
              return (
                <div key={crucible.id} className="panel-muted rounded-xl p-6 border border-forge-gray-600">
                  <div className="flex items-center space-x-3 mb-4">
                    {crucible.icon.startsWith('/') ? (
                      <img 
                        src={crucible.icon} 
                        alt={`${crucible.name} icon`} 
                        className="w-8 h-8 rounded-lg"
                      />
                    ) : (
                      <div className="w-8 h-8 bg-forge-primary/20 rounded-lg flex items-center justify-center">
                        <span className="text-forge-primary font-bold text-sm">{crucible.symbol[0]}</span>
                      </div>
                    )}
                    <h4 className="text-lg font-heading text-white">{crucible.name} Crucible</h4>
                  </div>
                  
                  <div className="space-y-3">
                    <div className="flex justify-between">
                      <span className="text-forge-gray-400 text-sm">TVL:</span>
                      <span className="text-white font-heading">{formatCurrency(crucible.tvl)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-forge-gray-400 text-sm">APY:</span>
                      <span className="text-forge-accent font-heading">{(crucible.apr * 100).toFixed(1)}%</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-forge-gray-400 text-sm">Yield Earned:</span>
                      <span className="text-forge-primary font-heading">{formatCurrency(yieldEarned)}</span>
                    </div>
                  </div>
                </div>
              );
            })}
            </div>
          </div>
        </div>
      )}

      {/* Main Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-8">
        <StatCard
          title="Total Crucibles"
          value={stats.totalCrucibles}
          change={2}
          changeType="positive"
          delay={0}
        />
        
        <StatCard
          title="Total TVL (USD)"
          value={formatCurrency(stats.totalTVL)}
          change={stats.tvlChange}
          changeType={stats.tvlChange >= 0 ? "positive" : "negative"}
          delay={100}
        />
        
        <StatCard
          title="Total Users"
          value={stats.totalUsers.toLocaleString()}
          change={stats.userChange}
          changeType="positive"
          delay={200}
        />
        
        <StatCard
          title="Average APY"
          value={formatPercentage(stats.averageAPR)}
          change={stats.aprChange}
          changeType={stats.aprChange >= 0 ? "positive" : "negative"}
          delay={300}
        />
        
        <StatCard
          title="24h Volume"
          value={formatCurrency(stats.volume24h)}
          change={stats.volumeChange}
          changeType={stats.volumeChange >= 0 ? "positive" : "negative"}
          delay={400}
        />
      </div>
    </div>
  )
}
