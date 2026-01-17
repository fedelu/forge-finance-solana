import React, { useState } from 'react'
import { BanknotesIcon } from '@heroicons/react/24/outline'
import { useCToken } from '../hooks/useCToken'
import { useCrucible } from '../hooks/useCrucible'
import { useLVFPosition } from '../hooks/useLVFPosition'
import { useLP } from '../hooks/useLP'
import { useLending } from '../hooks/useLending'
import { useBalance } from '../contexts/BalanceContext'
import CTokenWithdrawModal from './CTokenWithdrawModal'
import LVFPositionCard from './LVFPositionCard'
import { formatNumberWithCommas } from '../utils/math'
import { calculateBorrowInterest } from '../utils/lendingProgram'

interface CTokenPosition {
  crucibleAddress: string
  ctokenMint: string
  baseTokenSymbol: string
  ctokenSymbol: string
  baseAPY: number
  leverage?: number
}

export default function CTokenPortfolio() {
  const { crucibles, userBalances, getCrucible } = useCrucible()
  const [selectedPosition, setSelectedPosition] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  // Map crucibles to positions
  const positions: CTokenPosition[] = crucibles.map(crucible => ({
    crucibleAddress: crucible.id,
    ctokenMint: crucible.ptokenMint || 'mock-ctoken-mint',
    baseTokenSymbol: crucible.baseToken,
    ctokenSymbol: crucible.ptokenSymbol,
    baseAPY: (crucible.apr || 0) * 100,
    leverage: undefined, // Will be fetched from useCToken
  }))

  // Fetch LVF positions for SOL crucible
  const solCrucible = positions.find(p => p.baseTokenSymbol === 'SOL')
  
  const solLVFPosition = useLVFPosition({
    crucibleAddress: solCrucible?.crucibleAddress || '',
    baseTokenSymbol: 'SOL',
  })

  // Fetch LP positions for SOL crucible
  const solLP = useLP({
    crucibleAddress: solCrucible?.crucibleAddress || '',
    baseTokenSymbol: 'SOL',
    baseAPY: solCrucible?.baseAPY || 0,
  })

  // Fetch lending pool positions
  const { positions: lendingPositions, withdraw: withdrawLending, repay: repayLending } = useLending()

  // Store refetch functions in refs to avoid dependency issues
  const solLVFRefetchRef = React.useRef(solLVFPosition.refetch)
  const solLPRefetchRef = React.useRef(solLP.refetch)

  // Update refs when refetch functions change
  React.useEffect(() => {
    solLVFRefetchRef.current = solLVFPosition.refetch
    solLPRefetchRef.current = solLP.refetch
  }, [solLVFPosition.refetch, solLP.refetch])

  // Listen for position opened/closed events to refresh - IMMEDIATE
  React.useEffect(() => {
    const handlePositionChange = (event?: CustomEvent) => {
      console.log('🔄 Portfolio: Position changed event received', event?.type, event?.detail)
      console.log('   Current positions - SOL LVF:', solLVFPosition.positions.length)
      console.log('   Current positions - SOL LP:', solLP.positions.length)
      
      // Trigger refresh IMMEDIATELY - localStorage is already updated
      // Use refs to avoid dependency issues
      solLVFRefetchRef.current()
      solLPRefetchRef.current()
      
      setRefreshKey(prev => prev + 1)
      
      // Also refresh after delays to catch edge cases
      setTimeout(() => {
        console.log('🔄 Portfolio: Refreshing after 100ms...')
        solLVFRefetchRef.current()
        solLPRefetchRef.current()
        setRefreshKey(prev => prev + 1)
      }, 100)
      
      setTimeout(() => {
        console.log('🔄 Portfolio: Refreshing after 500ms...')
        solLVFRefetchRef.current()
        solLPRefetchRef.current()
        setRefreshKey(prev => prev + 1)
      }, 500)
      
      setTimeout(() => {
        console.log('🔄 Portfolio: Refreshing after 1000ms...')
        solLVFRefetchRef.current()
        solLPRefetchRef.current()
        setRefreshKey(prev => prev + 1)
      }, 1000)
    }
    
    window.addEventListener('lvfPositionOpened', handlePositionChange as EventListener)
    window.addEventListener('lvfPositionClosed', handlePositionChange as EventListener)
    window.addEventListener('lpPositionOpened', handlePositionChange as EventListener)
    window.addEventListener('lpPositionClosed', handlePositionChange as EventListener)
    window.addEventListener('forceRecalculateLP', handlePositionChange as EventListener)
    
    return () => {
      window.removeEventListener('lvfPositionOpened', handlePositionChange as EventListener)
      window.removeEventListener('lvfPositionClosed', handlePositionChange as EventListener)
      window.removeEventListener('lpPositionOpened', handlePositionChange as EventListener)
      window.removeEventListener('lpPositionClosed', handlePositionChange as EventListener)
      window.removeEventListener('forceRecalculateLP', handlePositionChange as EventListener)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Refetch positions when refresh key changes
  React.useEffect(() => {
    if (refreshKey > 0) {
      solLVFRefetchRef.current()
      solLPRefetchRef.current()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey])

  // Combine all leveraged positions - read from hooks' state
  const allLVFPositions = React.useMemo(() => {
    const sol = solLVFPosition.positions
      .filter(p => p.isOpen) // Only open positions
      .map(p => ({ 
        ...p, 
        crucible: positions.find(pos => pos.baseTokenSymbol === 'SOL')! 
      }))
    console.log('📊 Portfolio - SOL LVF positions:', sol.length, sol.map(p => ({ id: p.id, token: p.token, isOpen: p.isOpen })))
    return sol
  }, [solLVFPosition.positions, positions])

  // Combine all LP positions - read from hooks' state
  const allLPPositions = React.useMemo(() => {
    const sol = solLP.positions
      .filter(p => p.isOpen) // Only open positions
      .map(p => ({ 
        ...p, 
        crucible: positions.find(pos => pos.baseTokenSymbol === 'SOL')! 
      }))
    console.log('📊 Portfolio - SOL LP positions:', sol.length, sol.map(p => ({ id: p.id, baseToken: p.baseToken, isOpen: p.isOpen })))
    return sol
  }, [solLP.positions, positions])

  // Refetch positions periodically and on mount
  React.useEffect(() => {
    // Initial fetch
    solLVFPosition.refetch()
    solLP.refetch()
    
    // Set up interval to refetch every 5 seconds
    const interval = setInterval(() => {
      solLVFPosition.refetch()
      solLP.refetch()
    }, 5000)
    
    return () => clearInterval(interval)
  }, [solLVFPosition.refetch, solLP.refetch])

  // Combine all LP and leveraged positions for cTOKENS/USDC section
  const allCTokenUSDCPositions = React.useMemo(() => {
    console.log('🔄 Calculating allCTokenUSDCPositions...')
    console.log('   allLPPositions:', allLPPositions.length, allLPPositions.map(p => ({ id: p.id, isOpen: p.isOpen })))
    console.log('   allLVFPositions:', allLVFPositions.length, allLVFPositions.map(p => ({ id: p.id, isOpen: p.isOpen })))
    
    // Map LP positions to show with leverage info
    const lpWithDetails = allLPPositions
      .filter(lp => {
        const isOpen = lp.isOpen === true || lp.isOpen === undefined // Treat undefined as open for backwards compatibility
        const hasValidData = lp.baseAmount > 0 && lp.usdcAmount > 0
        console.log('   LP position:', lp.id, 'isOpen:', lp.isOpen, 'hasValidData:', hasValidData, 'filtered:', isOpen && hasValidData)
        return isOpen && hasValidData
      })
      .map(lp => ({
        ...lp,
        leverage: 1.0,
        borrowedUSDC: 0,
        collateralUSDC: lp.usdcAmount,
      }))
    
    console.log('   lpWithDetails after filter:', lpWithDetails.length, lpWithDetails.map(p => ({ id: p.id, baseAmount: p.baseAmount, usdcAmount: p.usdcAmount })))
    
    // Map leveraged positions
    const lvfWithDetails = allLVFPositions
      .filter(lvf => {
        const isOpen = lvf.isOpen === true || lvf.isOpen === undefined // Treat undefined as open
        const hasValidData = lvf.collateral > 0
        console.log('   LVF position:', lvf.id, 'isOpen:', lvf.isOpen, 'hasValidData:', hasValidData, 'filtered:', isOpen && hasValidData)
        return isOpen && hasValidData
      })
      .map(lvf => {
        const basePrice = lvf.token === 'FORGE' ? 0.002 : 200
        const tokenCollateralValue = lvf.collateral * basePrice // Token collateral value (after fee)
        const leverageFactor = lvf.leverageFactor || 1.0
        const borrowedUSDC = lvf.borrowedUSDC || 0
        
        // Calculate deposited USDC from leverage factor
        // For 1.5x: depositUSDC = 0.5 * originalCollateralValue (equal to borrowedUSDC)
        // For 2x: depositUSDC = 0 (only borrowed)
        let depositUSDC = lvf.depositUSDC
        if (depositUSDC === undefined || depositUSDC === null) {
          // Reconstruct original collateral value from borrowedUSDC
          let originalCollateralValue: number
          if (leverageFactor === 1.5) {
            originalCollateralValue = borrowedUSDC / 0.5 // borrowedUSDC = 0.5 * originalCollateralValue
            depositUSDC = originalCollateralValue * 0.5 // 50% deposited, 50% borrowed
          } else if (leverageFactor === 2.0) {
            originalCollateralValue = borrowedUSDC // borrowedUSDC = 1.0 * originalCollateralValue
            depositUSDC = 0 // 2x: all borrowed, nothing deposited
          } else {
            depositUSDC = 0 // Fallback
          }
        }
        
        // Total collateral = token collateral value + deposited USDC
        // The deposited USDC is also part of the collateral
        const totalCollateralValue = tokenCollateralValue + (depositUSDC || 0)
        
        // Calculate total USDC for the position (deposited + borrowed)
        const totalUSDC = (depositUSDC || 0) + borrowedUSDC
        
        return {
          ...lvf,
          leverage: leverageFactor,
          borrowedUSDC: borrowedUSDC,
          collateralUSDC: totalCollateralValue, // Total collateral includes token value + deposited USDC
          baseToken: lvf.token,
          baseAmount: lvf.collateral,
          usdcAmount: totalUSDC, // Use total USDC (deposit + borrow) for display
          depositUSDC: depositUSDC || 0, // Store deposited USDC separately
          lpAPY: 0, // Will be calculated based on base APY * leverage multiplier
        }
      })
    
    const combined = [...lpWithDetails, ...lvfWithDetails]
    console.log('   Final allCTokenUSDCPositions:', combined.length, combined)
    return combined
  }, [allLPPositions, allLVFPositions])

  // Calculate total portfolio value
  const totalPortfolioValue = React.useMemo(() => {
    // Calculate wrap positions value from userBalances
    const wrapPositions = positions.reduce((sum, pos) => {
      const userBalance = userBalances[pos.crucibleAddress]
      if (userBalance && userBalance.baseDeposited > 0) {
        const basePrice = 200 // SOL price
        return sum + (userBalance.baseDeposited * basePrice)
      }
      return sum
    }, 0)

    // Calculate LP positions value (allCTokenUSDCPositions includes both LP and leveraged)
    // For "Total Deposited Value", we only count what was actually deposited (excluding borrowed USDC)
    const lpValue = allCTokenUSDCPositions.reduce((sum, pos) => {
      const basePrice = 200 // SOL price
      const tokenCollateralValue = pos.baseAmount * basePrice
      
      // Check if this is a leveraged position (has borrowedUSDC > 0 or leverage > 1)
      const isLeveraged = ('borrowedUSDC' in pos && pos.borrowedUSDC > 0) || 
                         ('leverage' in pos && pos.leverage > 1.0) ||
                         ('leverageFactor' in pos && pos.leverageFactor > 1.0)
      
      if (isLeveraged) {
        // For leveraged positions: deposited value = token collateral + deposited USDC (NOT borrowed)
        const depositUSDC = 'depositUSDC' in pos ? (pos.depositUSDC || 0) : 0
        return sum + (tokenCollateralValue + depositUSDC)
      } else {
        // For standard LP positions: deposited value = token collateral + deposited USDC
        // pos.usdcAmount is the deposited USDC for standard LP positions
        const depositedUSDC = pos.usdcAmount || 0
        return sum + (tokenCollateralValue + depositedUSDC)
      }
    }, 0)

    // Calculate lending positions value (only supplied amounts, not borrowed)
    const lendingValue = lendingPositions.reduce((sum, pos) => {
      // Only count supplied amounts (assets), not borrowed (liabilities)
      return sum + (pos.suppliedAmount || 0)
    }, 0)

    return wrapPositions + lpValue + lendingValue
  }, [positions, userBalances, allCTokenUSDCPositions, lendingPositions])

  // Calculate weighted APY
  const weightedAPY = React.useMemo(() => {
    let totalValue = 0
    let weightedSum = 0

    // cToken positions
    positions.forEach(pos => {
      const userBalance = userBalances[pos.crucibleAddress]
      if (userBalance && userBalance.baseDeposited > 0) {
        const basePrice = 200 // SOL price
        const value = userBalance.baseDeposited * basePrice
        totalValue += value
        weightedSum += value * pos.baseAPY
      }
    })

    // LP positions
    allCTokenUSDCPositions.forEach(pos => {
      const basePrice = 200 // SOL price
      const tokenCollateralValue = pos.baseAmount * basePrice
      const isLeveraged = ('borrowedUSDC' in pos && pos.borrowedUSDC > 0) || 
                         ('leverage' in pos && pos.leverage > 1.0) ||
                         ('leverageFactor' in pos && pos.leverageFactor > 1.0)
      
      let value = 0
      if (isLeveraged) {
        const depositUSDC = 'depositUSDC' in pos ? (pos.depositUSDC || 0) : 0
        value = tokenCollateralValue + depositUSDC
      } else {
        const depositedUSDC = pos.usdcAmount || 0
        value = tokenCollateralValue + depositedUSDC
      }
      
      // Get baseAPY from crucible by matching baseToken
      const crucible = crucibles.find(c => c.baseToken === pos.baseToken)
      const baseAPY = crucible ? (crucible.apr || 0) * 100 : 0
      const lpAPY = 'lpAPY' in pos && pos.lpAPY ? pos.lpAPY : baseAPY * 3
      totalValue += value
      weightedSum += value * lpAPY
    })

    // Lending positions (supplied only)
    lendingPositions.forEach(pos => {
      if (pos.suppliedAmount > 0) {
        totalValue += pos.suppliedAmount
        weightedSum += pos.suppliedAmount * (pos.effectiveApy || 4.5)
      }
    })

    if (totalValue === 0) return 0
    return weightedSum / totalValue
  }, [positions, userBalances, allCTokenUSDCPositions, lendingPositions, crucibles])

  // Filter positions: cTOKENS (simple wrap positions)
  const cTokenPositions = React.useMemo(() => {
    return positions.filter(pos => {
      const userBalance = userBalances[pos.crucibleAddress]
      const hasCTokenBalance = userBalance && userBalance.ptokenBalance > BigInt(0)
      
      // Show all cToken positions with balances (users can have both cTokens and LP positions)
      return hasCTokenBalance
    })
  }, [positions, userBalances])

  return (
    <div className="space-y-8">
      {/* Unified Dashboard Summary - Enhanced */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="panel rounded-2xl p-6 hover:shadow-forge-lg hover:border-forge-primary/30 transition-all duration-300 group relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-forge-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
          <div className="relative z-10">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-lg bg-forge-primary/20 flex items-center justify-center">
                <svg className="w-5 h-5 text-forge-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div className="text-forge-gray-400 text-sm font-medium">Total Deposited Value</div>
            </div>
            <div className="text-3xl font-heading text-white">
              ${totalPortfolioValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
          </div>
        </div>
        <div className="panel rounded-2xl p-6 hover:shadow-forge-lg hover:border-forge-primary/30 transition-all duration-300 group relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-green-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
          <div className="relative z-10">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-lg bg-green-500/20 flex items-center justify-center">
                <svg className="w-5 h-5 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                </svg>
              </div>
              <div className="text-forge-gray-400 text-sm font-medium">Weighted APY</div>
            </div>
            <div className="text-3xl font-heading text-green-400">
              {weightedAPY.toFixed(2)}%
            </div>
          </div>
        </div>
        <div className="panel rounded-2xl p-6 hover:shadow-forge-lg hover:border-forge-primary/30 transition-all duration-300 group relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-forge-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
          <div className="relative z-10">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-lg bg-forge-primary/20 flex items-center justify-center">
                <svg className="w-5 h-5 text-forge-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                </svg>
              </div>
              <div className="text-forge-gray-400 text-sm font-medium">Active Positions</div>
            </div>
            <div className="text-3xl font-heading text-white">
              {cTokenPositions.length + allCTokenUSDCPositions.length + lendingPositions.length}
              <span className="text-base text-forge-gray-400 ml-2 font-normal">
                ({cTokenPositions.length} cTokens, {allCTokenUSDCPositions.length} ifTOKEN/USDC, {lendingPositions.length} Lending)
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* cTOKENS Section - Simple wrap positions */}
      <div className="panel rounded-3xl p-8">
        <div className="flex items-center gap-4 mb-8">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-500/30 to-blue-500/10 flex items-center justify-center ring-2 ring-blue-500/20">
            <svg className="w-6 h-6 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h3 className="text-2xl font-heading text-white">cTOKENS</h3>
          <span className="px-4 py-1.5 bg-gradient-to-r from-blue-500/20 to-blue-500/10 text-blue-400 text-xs text-lg font-heading rounded-full border border-blue-500/30">{cTokenPositions.length}</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-forge-gray-700/50">
                <th className="text-left py-4 px-6 text-forge-gray-400 font-semibold text-sm uppercase tracking-wider">cToken</th>
                <th className="text-right py-4 px-6 text-forge-gray-400 font-semibold text-sm uppercase tracking-wider">Balance</th>
                <th className="text-right py-4 px-6 text-forge-gray-400 font-semibold text-sm uppercase tracking-wider">Value</th>
                <th className="text-right py-4 px-6 text-forge-gray-400 font-semibold text-sm uppercase tracking-wider">APY</th>
              </tr>
            </thead>
            <tbody>
              {cTokenPositions.length > 0 ? (
                cTokenPositions.map((position, index) => {
                  const userBalance = userBalances[position.crucibleAddress]
                  const crucible = getCrucible(position.crucibleAddress)
                  const ctokenBalance = userBalance?.ptokenBalance ? Number(userBalance.ptokenBalance) / 1e9 : 0
                  const basePrice = 200 // SOL price
                  // Use actual exchange rate from crucible (scaled by 1e6), default to 1.0
                  const exchangeRate = crucible?.exchangeRate ? Number(crucible.exchangeRate) / 1e6 : 1.0
                  const valueUSD = ctokenBalance * exchangeRate * basePrice
                  
                  return (
                    <tr 
                      key={position.crucibleAddress} 
                      className="group border-b border-forge-gray-800/50 hover:bg-gradient-to-r hover:from-forge-gray-800/40 hover:to-forge-gray-800/20 transition-all duration-300"
                      style={{ animationDelay: `${index * 50}ms` }}
                    >
                      <td className="py-5 px-6">
                        <div className="flex items-center space-x-3">
                          <div className="w-12 h-12 bg-gradient-to-br from-blue-500/30 to-blue-500/10 rounded-xl flex items-center justify-center ring-2 ring-blue-500/20 group-hover:ring-blue-500/40 transition-all duration-300 group-hover:scale-110">
                            <span className="text-blue-400 text-lg font-heading text-base">
                              {position.ctokenSymbol.substring(1, 2).toUpperCase()}
                            </span>
                          </div>
                          <div>
                            <div className="text-white font-semibold text-base">{position.ctokenSymbol}</div>
                            <div className="text-forge-gray-500 text-xs font-medium mt-0.5">{position.baseTokenSymbol}</div>
                          </div>
                        </div>
                      </td>
                      <td className="text-right py-5 px-6">
                        <div className="text-white font-semibold text-base">
                          {ctokenBalance.toFixed(2)} {position.ctokenSymbol}
                        </div>
                      </td>
                      <td className="text-right py-5 px-6">
                        <div className="text-white font-semibold text-base">
                          ${valueUSD.toFixed(2)} USD
                        </div>
                      </td>
                      <td className="text-right py-5 px-6">
                        <span className="inline-flex items-center px-3 py-1 bg-blue-500/20 text-blue-400 font-semibold rounded-lg text-sm border border-blue-500/30">
                          {position.baseAPY.toFixed(2)}%
                        </span>
                      </td>
                    </tr>
                  )
                })
              ) : (
                <tr>
                  <td colSpan={4} className="py-16 px-6 text-center">
                    <div className="text-forge-gray-400 text-sm font-medium">
                      No cToken positions yet. Wrap tokens to create a position.
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ifTOKEN/USDC Section - LP positions with detailed info */}
      <div className="panel rounded-2xl p-6">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-lg bg-green-500/20 flex items-center justify-center">
            <svg className="w-5 h-5 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
          </div>
          <h3 className="text-2xl font-heading text-white">ifTOKEN/USDC</h3>
          <span className="px-3 py-1 bg-green-500/20 text-green-400 text-xs text-lg font-heading rounded-full">{allCTokenUSDCPositions.length}</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-forge-gray-700">
                <th className="text-left py-3 px-4 text-forge-gray-400 text-xs font-heading uppercase tracking-[0.18em]">Pair</th>
                <th className="text-right py-3 px-4 text-forge-gray-400 text-xs font-heading uppercase tracking-[0.18em]">
                  <div className="flex flex-col items-end gap-0.5">
                    <span>Collateral</span>
                    <span className="text-[10px] text-forge-gray-500 font-satoshi">cToken value</span>
                  </div>
                </th>
                <th className="text-right py-3 px-4 text-forge-gray-400 text-xs font-heading uppercase tracking-[0.18em]">
                  <div className="flex flex-col items-end gap-0.5">
                    <span>Borrowed</span>
                    <span className="text-[10px] text-forge-gray-500 font-satoshi">USDC</span>
                  </div>
                </th>
                <th className="text-right py-3 px-4 text-forge-gray-400 text-xs font-heading uppercase tracking-[0.18em]">Leverage</th>
                <th className="text-right py-3 px-4 text-forge-gray-400 text-xs font-heading uppercase tracking-[0.18em]">
                  <div className="flex flex-col items-end gap-0.5">
                    <span>Health</span>
                    <span className="text-[10px] text-forge-gray-500 font-satoshi">Factor</span>
                  </div>
                </th>
                <th className="text-right py-3 px-4 text-forge-gray-400 text-xs font-heading uppercase tracking-[0.18em]">APY</th>
                <th className="text-right py-3 px-4 text-forge-gray-400 text-xs font-heading uppercase tracking-[0.18em]">Total Value</th>
              </tr>
            </thead>
            <tbody>
              {(() => {
                const openPositions = allCTokenUSDCPositions.filter(p => p.isOpen)
                console.log('📋 Portfolio table - open positions:', openPositions.length, openPositions)
                return openPositions.length > 0 ? (
                  openPositions.map((position) => {
                  const crucible = positions.find(p => p.baseTokenSymbol === position.baseToken)
                  const basePrice = 200 // SOL price
                  
                  // Total collateral includes both token collateral value AND deposited USDC
                  // collateralUSDC already includes both if it was calculated correctly above
                  const totalCollateralValue = position.collateralUSDC || (position.baseAmount * basePrice)
                  const tokenCollateralValue = position.baseAmount * basePrice // Just the token value
                  const depositUSDC = 'depositUSDC' in position ? (position.depositUSDC || 0) : 0
                  
                  // For display: show total collateral (token + deposited USDC)
                  const collateralValueUSD = totalCollateralValue
                  
                  const borrowedUSDC = position.borrowedUSDC || 0
                  const leverage = position.leverage || ('leverageFactor' in position ? position.leverageFactor : 1.0)
                  const healthFactor = 'health' in position && position.health 
                    ? position.health 
                    : borrowedUSDC > 0 
                      ? totalCollateralValue / (borrowedUSDC * 1.3) // Use total collateral for health factor
                      : 999
                  const lpAPY = 'lpAPY' in position && position.lpAPY 
                    ? position.lpAPY 
                    : leverage > 1 
                      ? (crucible?.baseAPY || 0) * leverage * 3 
                      : (crucible?.baseAPY || 0) * 3
                  const totalValue = totalCollateralValue + borrowedUSDC // Total position value = collateral + borrowed
                  
                  return (
                    <tr key={position.id} className="border-b border-forge-gray-800 hover:bg-forge-gray-800/30 transition-colors">
                      <td className="py-4 px-4">
                        <div className="flex items-center space-x-2">
                          <span className="text-white text-base font-heading">
                            {crucible
                              ? `if${crucible.ctokenSymbol.replace(/^c/i, '')}/USDC`
                              : `if${position.baseToken.replace(/^if/i, '')}/USDC`}
                          </span>
                          <span className={`px-2 py-0.5 rounded text-xs font-heading uppercase tracking-[0.16em] ${
                            leverage > 1 ? 'bg-orange-500/20 text-orange-400' : 'bg-green-500/20 text-green-400'
                          }`}>
                            {leverage > 1 ? 'Leveraged' : 'LP'}
                          </span>
                        </div>
                      </td>
                      <td className="text-right py-4 px-4">
                        <div className="text-white text-base font-heading">
                          ${collateralValueUSD.toFixed(2)} USD
                        </div>
                        <div className="text-forge-gray-500 text-xs font-satoshi mt-1">
                          {position.baseAmount.toFixed(2)} {position.baseToken}
                          {depositUSDC > 0 && (
                            <span className="ml-2 text-green-400 font-heading">+ {depositUSDC.toFixed(2)} USDC</span>
                          )}
                        </div>
                      </td>
                      <td className="text-right py-4 px-4">
                        <span className={`text-base font-heading ${borrowedUSDC > 0 ? 'text-orange-400' : 'text-forge-gray-500'}`}>
                          {borrowedUSDC > 0 ? `${borrowedUSDC.toFixed(2)} USDC` : '-'}
                        </span>
                      </td>
                      <td className="text-right py-4 px-4">
                        <span className={`px-2 py-1 rounded text-xs font-heading uppercase tracking-[0.16em] ${
                          leverage === 2.0 ? 'bg-yellow-500/20 text-yellow-400' :
                          leverage === 1.5 ? 'bg-orange-500/20 text-orange-400' :
                          'bg-green-500/20 text-green-400'
                        }`}>
                          {leverage.toFixed(1)}x
                        </span>
                      </td>
                      <td className="text-right py-4 px-4">
                        <span className={`text-xs font-heading ${
                          healthFactor >= 999 ? 'text-forge-gray-500' :
                          healthFactor >= 2.0 ? 'text-green-400' :
                          healthFactor >= 1.5 ? 'text-yellow-400' :
                          healthFactor >= 1.0 ? 'text-orange-400' :
                          'text-red-400'
                        }`}>
                          {healthFactor >= 999 ? '-' : `${healthFactor.toFixed(2)}x`}
                        </span>
                      </td>
                      <td className="text-right py-4 px-4">
                        <span className="text-green-400 text-base font-heading">{lpAPY.toFixed(2)}%</span>
                      </td>
                      <td className="text-right py-4 px-4">
                        <span className="text-white text-base font-heading">${totalValue.toFixed(2)}</span>
                      </td>
                    </tr>
                  )
                })
                ) : (
                  <tr>
                    <td colSpan={7} className="py-8 px-4 text-center">
                      <div className="text-forge-gray-400 text-sm">
                        No LP positions yet. Create an LP position to see it here.
                      </div>
                    </td>
                  </tr>
                )
              })()}
            </tbody>
          </table>
        </div>
      </div>

      {/* Lending Pool Positions Section */}
      <div className="panel rounded-3xl p-8">
        <div className="flex items-center gap-4 mb-8">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-purple-500/30 to-purple-500/10 flex items-center justify-center ring-2 ring-purple-500/20">
            <BanknotesIcon className="w-6 h-6 text-purple-400" />
          </div>
          <h3 className="text-2xl font-heading text-white">Lending Pool</h3>
          <span className="px-4 py-1.5 bg-gradient-to-r from-purple-500/20 to-purple-500/10 text-purple-400 text-xs text-lg font-heading rounded-full border border-purple-500/30">
            {lendingPositions.filter(p => (p.suppliedAmount > 0) || (p.borrowedAmount && p.borrowedAmount > 0)).length}
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-forge-gray-700">
                <th className="text-left py-4 px-6 text-forge-gray-400 font-semibold text-sm uppercase tracking-wider">Type</th>
                <th className="text-right py-4 px-6 text-forge-gray-400 font-semibold text-sm uppercase tracking-wider">Amount</th>
                <th className="text-right py-4 px-6 text-forge-gray-400 font-semibold text-sm uppercase tracking-wider">APY</th>
                <th className="text-right py-4 px-6 text-forge-gray-400 font-semibold text-sm uppercase tracking-wider">Interest</th>
                <th className="text-right py-4 px-6 text-forge-gray-400 font-semibold text-sm uppercase tracking-wider">Value</th>
                <th className="text-right py-4 px-6 text-forge-gray-400 font-semibold text-sm uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody>
              {(() => {
                const activeLendingPositions = lendingPositions.filter(p => 
                  (p.suppliedAmount > 0) || (p.borrowedAmount && p.borrowedAmount > 0)
                )

                if (activeLendingPositions.length > 0) {
                  return activeLendingPositions.map((position, index) => {
                    const isSupplied = position.suppliedAmount > 0
                    const isBorrowed = position.borrowedAmount && position.borrowedAmount > 0
                    
                    // Calculate interest for borrowed positions
                    let borrowedInterest = 0
                    if (isBorrowed && position.borrowedAmount) {
                      // Estimate interest (in production, this would come from on-chain data)
                      // For now, use a simple calculation
                      const estimatedDays = 30 // Default estimate
                      const secondsElapsed = estimatedDays * 24 * 60 * 60
                      borrowedInterest = calculateBorrowInterest(
                        position.borrowedAmount,
                        10, // 10% APY
                        secondsElapsed
                      )
                    }

                    const suppliedValue = isSupplied 
                      ? position.suppliedAmount + (position.interestEarned || 0)
                      : 0
                    const borrowedValue = isBorrowed && position.borrowedAmount
                      ? position.borrowedAmount + borrowedInterest
                      : 0

                    return (
                      <React.Fragment key={`${position.marketPubkey}-${index}`}>
                        {isSupplied && (
                          <tr className="border-b border-forge-gray-800 hover:bg-forge-gray-800/30 transition-colors">
                            <td className="py-4 px-6">
                              <div className="flex items-center space-x-3">
                                <div className="w-10 h-10 bg-gradient-to-br from-green-500/30 to-green-500/10 rounded-xl flex items-center justify-center ring-2 ring-green-500/20">
                                  <span className="text-green-400 text-lg font-heading">S</span>
                                </div>
                                <div>
                                  <div className="text-white text-base font-heading">Supplied</div>
                                  <div className="text-forge-gray-500 text-xs font-satoshi">Lending</div>
                                </div>
                              </div>
                            </td>
                            <td className="text-right py-4 px-6">
                              <div className="text-white text-base font-heading">
                                {formatNumberWithCommas(position.suppliedAmount || 0)} USDC
                              </div>
                            </td>
                            <td className="text-right py-4 px-6">
                              <span className="inline-flex items-center px-3 py-1 bg-green-500/20 text-green-400 font-semibold rounded-lg text-sm border border-green-500/30">
                                {(position.effectiveApy || 4.5).toFixed(2)}%
                              </span>
                            </td>
                            <td className="text-right py-4 px-6">
                              <div className="text-green-400 text-base font-heading">
                                +{formatNumberWithCommas(position.interestEarned || 0)} USDC
                              </div>
                            </td>
                            <td className="text-right py-4 px-6">
                              <div className="text-white text-base font-heading">
                                ${formatNumberWithCommas(suppliedValue)}
                              </div>
                            </td>
                            <td className="text-right py-4 px-6">
                              <button
                                onClick={async () => {
                                  if (confirm(`Withdraw ${position.suppliedAmount.toFixed(2)} USDC?`)) {
                                    try {
                                      await withdrawLending(position.marketPubkey, position.suppliedAmount.toString())
                                      alert('Withdrawal successful!')
                                    } catch (error: any) {
                                      alert(`Withdrawal failed: ${error.message}`)
                                    }
                                  }
                                }}
                                className="px-4 py-2 bg-forge-gray-700 hover:bg-forge-gray-600 text-white rounded-lg font-satoshi font-medium transition-all duration-200 hover:scale-105 text-sm"
                              >
                                Withdraw
                              </button>
                            </td>
                          </tr>
                        )}
                        {isBorrowed && position.borrowedAmount && (
                          <tr className="border-b border-forge-gray-800 hover:bg-forge-gray-800/30 transition-colors">
                            <td className="py-4 px-6">
                              <div className="flex items-center space-x-3">
                                <div className="w-10 h-10 bg-gradient-to-br from-orange-500/30 to-orange-500/10 rounded-xl flex items-center justify-center ring-2 ring-orange-500/20">
                                  <span className="text-orange-400 text-lg font-heading">B</span>
                                </div>
                                <div>
                                  <div className="text-white text-base font-heading">Borrowed</div>
                                  <div className="text-forge-gray-500 text-xs font-satoshi">Debt</div>
                                </div>
                              </div>
                            </td>
                            <td className="text-right py-4 px-6">
                              <div className="text-white text-base font-heading">
                                {formatNumberWithCommas(position.borrowedAmount || 0)} USDC
                              </div>
                            </td>
                            <td className="text-right py-4 px-6">
                              <span className="inline-flex items-center px-3 py-1 bg-orange-500/20 text-orange-400 font-semibold rounded-lg text-sm border border-orange-500/30">
                                10.00%
                              </span>
                            </td>
                            <td className="text-right py-4 px-6">
                              <div className="text-orange-400 text-base font-heading">
                                -{formatNumberWithCommas(borrowedInterest)} USDC
                              </div>
                            </td>
                            <td className="text-right py-4 px-6">
                              <div className="text-white text-base font-heading">
                                ${formatNumberWithCommas(borrowedValue)}
                              </div>
                            </td>
                            <td className="text-right py-4 px-6">
                              <button
                                onClick={async () => {
                                  const totalOwed = position.borrowedAmount! + borrowedInterest
                                  if (confirm(`Repay ${totalOwed.toFixed(2)} USDC (principal + interest)?`)) {
                                    try {
                                      await repayLending(totalOwed)
                                      alert('Repayment successful!')
                                    } catch (error: any) {
                                      alert(`Repayment failed: ${error.message}`)
                                    }
                                  }
                                }}
                                className="px-4 py-2 bg-orange-500/20 hover:bg-orange-500/30 text-orange-400 rounded-lg font-satoshi font-medium transition-all duration-200 hover:scale-105 text-sm border border-orange-500/30"
                              >
                                Repay
                              </button>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    )
                  })
                } else {
                  return (
                    <tr>
                      <td colSpan={6} className="py-16 px-6 text-center">
                        <div className="text-forge-gray-400 text-sm font-medium">
                          No lending positions yet. Supply USDC to earn yield or borrow for leverage.
                        </div>
                      </td>
                    </tr>
                  )
                }
              })()}
            </tbody>
          </table>
        </div>
      </div>

      {selectedPosition && (
        <CTokenPositionDetails
          position={positions.find(p => p.crucibleAddress === selectedPosition)!}
          onClose={() => setSelectedPosition(null)}
        />
      )}
    </div>
  )
}

// Close Position Button Component
function ClosePositionButton({ position, crucible, onClose }: { 
  position: any, 
  crucible: CTokenPosition, 
  onClose: () => void 
}) {
  const { closePosition: closeLVFPosition, loading: lvfLoading } = useLVFPosition({
    crucibleAddress: crucible.crucibleAddress,
    baseTokenSymbol: crucible.baseTokenSymbol as 'SOL',
  })
  
  const { closePosition: closeLPPosition, loading: lpLoading } = useLP({
    crucibleAddress: crucible.crucibleAddress,
    baseTokenSymbol: crucible.baseTokenSymbol as 'SOL',
    baseAPY: crucible.baseAPY,
  })
  
  const { addToBalance, subtractFromBalance } = useBalance()
  const { getCrucible } = useCrucible()
  
  const isLeveraged = position.leverage && position.leverage > 1
  const loading = isLeveraged ? lvfLoading : lpLoading
  
  const handleClose = async () => {
    if (!confirm(`Are you sure you want to close this ${isLeveraged ? 'leveraged' : 'LP'} position?`)) {
      return
    }
    
    try {
      const result = isLeveraged 
        ? await closeLVFPosition(position.id)
        : await closeLPPosition(position.id)
      
      if (result && result.success) {
        // Update wallet balances
        if (isLeveraged) {
          // Leveraged position: return base tokens (with APY) + repay borrowed USDC
          // Type guard: result from closeLVFPosition has 'repaidUSDC'
          const lvfResult = result as {
            success: boolean
            baseAmount: number
            apyEarned: number
            usdcAmount?: number
            fee?: number
            feePercent?: number
            repaidUSDC: number
            yieldFee?: number
            principalFee?: number
          }
          addToBalance(crucible.baseTokenSymbol, lvfResult.baseAmount) // Includes APY earnings
          if (lvfResult.repaidUSDC > 0) {
            subtractFromBalance('USDC', lvfResult.repaidUSDC)
          }
          // Remove LP tokens
          const lpTokenSymbol = `${crucible.ctokenSymbol}/USDC LP`
          const basePrice = 200 // SOL price
          // Use actual exchange rate from getCrucible (scaled by 1e6), default to 1.0
          const crucibleData = getCrucible(crucible.crucibleAddress)
          const currentExchangeRate = crucibleData?.exchangeRate ? Number(crucibleData.exchangeRate) / 1e6 : 1.0
          const cTokenAmount = position.baseAmount * currentExchangeRate
          const cTokenValueUSD = cTokenAmount * basePrice
          // For leveraged positions: totalUSDC should equal cToken value for equal value LP pair
          const totalUSDC = cTokenValueUSD
          const lpTokenAmount = Math.sqrt(cTokenValueUSD * totalUSDC)
          subtractFromBalance(lpTokenSymbol, lpTokenAmount)
          
          // Show closing information with APY earnings
          const infernoSymbol = `if${crucible.ctokenSymbol.replace(/^c/i, '')}`
          const leveragedSummary = [
            '🔥 Forge Position Update',
            '',
            `${infernoSymbol}/USDC leveraged position closed.`,
            '',
            `• Released: ${formatNumberWithCommas(lvfResult.baseAmount, 4)} ${crucible.baseTokenSymbol}`,
          ]

          if (lvfResult.usdcAmount && lvfResult.usdcAmount > 0) {
            leveragedSummary.push(`• USDC Settled: ${formatNumberWithCommas(lvfResult.usdcAmount, 2)} USDC`)
          }
          if (lvfResult.apyEarned && lvfResult.apyEarned > 0) {
            leveragedSummary.push(`• Net Yield: +${formatNumberWithCommas(lvfResult.apyEarned, 4)} ${crucible.baseTokenSymbol}`)
          }
          if ((lvfResult as any).principalFee && (lvfResult as any).principalFee > 0) {
            leveragedSummary.push(`• Forge Principal Fee: ${formatNumberWithCommas((lvfResult as any).principalFee, 4)} ${crucible.baseTokenSymbol}`)
          }
          if ((lvfResult as any).yieldFee && (lvfResult as any).yieldFee > 0) {
            leveragedSummary.push(`• Forge Yield Fee: ${formatNumberWithCommas((lvfResult as any).yieldFee, 4)} ${crucible.baseTokenSymbol}`)
          }
          if (lvfResult.repaidUSDC && lvfResult.repaidUSDC > 0) {
            leveragedSummary.push(`• Lending Pool Repaid: ${formatNumberWithCommas(lvfResult.repaidUSDC, 2)} USDC`)
          }

          leveragedSummary.push('', 'Forge portfolio and wallet balances refresh automatically.')

          alert(leveragedSummary.join('\n'))
        } else {
          // Standard LP position: return base tokens (with APY) + deposited USDC
          // Type guard: result from closeLPPosition has 'usdcAmount'
          const lpResult = result as {
            success: boolean
            baseAmount: number
            apyEarned: number
            usdcAmount: number
            feeAmount: number
            feePercent: number
            yieldFee?: number
            principalFee?: number
          }
          addToBalance(crucible.baseTokenSymbol, lpResult.baseAmount) // Includes APY earnings
          addToBalance('USDC', lpResult.usdcAmount) // Return deposited USDC
          const lpTokenSymbol = `${crucible.ctokenSymbol}/USDC LP`
          // Use actual exchange rate (scaled by 1e6), default to 1.0
          const lpExchangeRate = crucible.exchangeRate ? Number(crucible.exchangeRate) / 1e6 : 1.0
          const cTokenAmount = lpResult.baseAmount * lpExchangeRate
          const lpTokenAmount = Math.sqrt(cTokenAmount * lpResult.usdcAmount)
          subtractFromBalance(lpTokenSymbol, lpTokenAmount)
          
          // Show closing information with APY earnings
          const infernoSymbol = `if${crucible.ctokenSymbol.replace(/^c/i, '')}`
          const lpSummary = [
            '🔥 Forge Position Update',
            '',
            `${infernoSymbol}/USDC position closed.`,
            '',
            `• Base Tokens Returned: ${formatNumberWithCommas(lpResult.baseAmount, 4)} ${crucible.baseTokenSymbol}`,
            `• USDC Returned: ${formatNumberWithCommas(lpResult.usdcAmount, 2)} USDC`,
          ]

          if (lpResult.apyEarned && lpResult.apyEarned > 0) {
            lpSummary.push(`• Net Yield: +${formatNumberWithCommas(lpResult.apyEarned, 4)} ${crucible.baseTokenSymbol}`)
          }
          if (lpResult.principalFee && lpResult.principalFee > 0) {
            lpSummary.push(`• Forge Principal Fee: ${formatNumberWithCommas(lpResult.principalFee, 4)} ${crucible.baseTokenSymbol}`)
          }
          if (lpResult.yieldFee && lpResult.yieldFee > 0) {
            lpSummary.push(`• Forge Yield Fee: ${formatNumberWithCommas(lpResult.yieldFee, 4)} ${crucible.baseTokenSymbol}`)
          }

          lpSummary.push('', 'Wallet balances refresh instantly in Forge.')

          alert(lpSummary.join('\n'))
        }
        
        // Trigger refresh
        window.dispatchEvent(new CustomEvent(isLeveraged ? 'lvfPositionClosed' : 'lpPositionClosed'))
        onClose()
      }
    } catch (error: any) {
      console.error('Error closing position:', error)
      alert(error.message || 'Failed to close position')
    }
  }
  
  return (
    <button
      onClick={handleClose}
      disabled={loading}
      className="px-3 py-1 bg-red-600 hover:bg-red-700 disabled:bg-forge-gray-700 disabled:text-forge-gray-500 disabled:cursor-not-allowed text-white rounded text-sm font-medium transition-colors"
    >
      {loading ? 'Closing...' : 'Close'}
    </button>
  )
}

function CTokenPositionRow({ position, onSelect }: { position: CTokenPosition, onSelect: () => void }) {
  const { leverage, calculateEffectiveAPY } = useCToken(position.crucibleAddress, position.ctokenMint)
  const { userBalances, getCrucible } = useCrucible()
  
  // Get crucible data for exchange rate
  const crucible = getCrucible(position.crucibleAddress)
  const userBalance = userBalances[position.crucibleAddress]
  
  // Calculate effective APY with leverage if applicable
  const effectiveAPY = leverage?.leverage && leverage.leverage > 1.0
    ? calculateEffectiveAPY(position.baseAPY, leverage.leverage)
    : position.baseAPY

  // Get current balances from userBalances
  // exchange_rate is scaled by 1_000_000 on-chain (1.0 = 1_000_000)
  const exchangeRate = crucible?.exchangeRate ? Number(crucible.exchangeRate) / 1_000_000 : 1.0
  const ctokenBalance = userBalance?.ptokenBalance || BigInt(0)
  const baseBalance = userBalance?.estimatedBaseValue || BigInt(0)
  
  // Collateral = base token value (what you deposited)
  // For cToken positions: collateral is the value of your cTokens in base tokens
  // For leveraged positions: collateral is the base token amount you deposited
  const collateralInBaseTokens = userBalance?.baseDeposited || 0
  const ctokenBalanceDisplay = Number(ctokenBalance) / 1e9 // userBalances uses 1e9 scale
  
  // Borrowed amount (only for leveraged positions)
  const borrowedUSDC = leverage?.borrowedAmount && leverage.borrowedAmount > BigInt(0)
    ? Number(leverage.borrowedAmount) / 1e6 
    : 0
  
  // Calculate health factor (only relevant for leveraged positions)
  const baseTokenPrice = position.baseTokenSymbol === 'FORGE' ? 0.5 : 0.002
  const collateralValueUSD = collateralInBaseTokens * baseTokenPrice
  const healthFactor = borrowedUSDC > 0 
    ? collateralValueUSD / (borrowedUSDC * 1.3) 
    : 999 // No borrow = infinite health

  return (
    <tr className="border-b border-forge-gray-800 hover:bg-forge-gray-800/30 transition-colors">
      <td className="py-4 px-4">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 bg-forge-primary/20 rounded-full flex items-center justify-center">
            <span className="text-forge-primary text-lg font-heading">
              {position.ctokenSymbol.substring(1, 2).toUpperCase()}
            </span>
          </div>
          <div>
            <div className="text-white text-base font-heading">{position.ctokenSymbol}</div>
            <div className="text-forge-gray-500 text-xs font-satoshi">{position.baseTokenSymbol}</div>
          </div>
        </div>
      </td>
      <td className="text-right py-4 px-4">
        <div className="flex flex-col items-end">
          <div className="text-white text-base font-heading">
            {collateralInBaseTokens > 0 ? collateralInBaseTokens.toFixed(2) : '0.00'} {position.baseTokenSymbol}
          </div>
          <div className="text-forge-gray-500 text-xs font-satoshi mt-1">
            {ctokenBalanceDisplay > 0 ? `${ctokenBalanceDisplay.toFixed(2)} ${position.ctokenSymbol}` : 'No position'}
          </div>
          <div className="text-forge-gray-400 text-xs font-satoshi mt-0.5" title="Value of your cTokens in base tokens (collateral)">
            ≈ ${collateralValueUSD.toFixed(2)} USD
          </div>
        </div>
      </td>
      <td className="text-right py-4 px-4">
        {borrowedUSDC > 0 ? (
          <span className="text-orange-400 text-base font-heading">{borrowedUSDC.toFixed(2)} USDC</span>
        ) : (
          <span className="text-forge-gray-500 font-satoshi" title="No borrowed funds">-</span>
        )}
      </td>
      <td className="text-right py-4 px-4">
        {leverage?.leverage && leverage.leverage > 1.0 ? (
          <span className={`px-2 py-1 rounded text-xs font-heading ${
            leverage.leverage === 2.0 ? 'bg-yellow-500/20 text-yellow-400' :
            'bg-green-500/20 text-green-400'
          }`}>
            {leverage.leverage}x
          </span>
        ) : (
          <span className="text-forge-gray-500 font-satoshi" title="No leverage (standard position)">1x</span>
        )}
      </td>
      <td className="text-right py-4 px-4">
        <div className="flex flex-col items-end">
          {borrowedUSDC > 0 ? (
            <>
              <span className={`text-xs font-heading ${
                healthFactor >= 2.0 ? 'text-green-400' :
                healthFactor >= 1.5 ? 'text-yellow-400' :
                healthFactor >= 1.0 ? 'text-orange-400' :
                'text-red-400'
              }`} title="Health factor = Collateral Value / (Borrowed × 1.3)">
                {healthFactor.toFixed(2)}x
              </span>
              {healthFactor < 1.0 && (
                <span className="text-red-400 text-xs font-satoshi mt-0.5">⚠️ Risk</span>
              )}
            </>
          ) : (
            <span className="text-forge-gray-500 text-xs font-satoshi" title="No borrowed funds, position is safe">-</span>
          )}
        </div>
      </td>
      <td className="text-right py-4 px-4">
        <span className={`text-base font-heading ${
          effectiveAPY >= position.baseAPY * 1.5 ? 'text-green-400' :
          effectiveAPY >= position.baseAPY * 1.2 ? 'text-yellow-400' :
          'text-forge-primary'
        }`} title={leverage?.leverage && leverage.leverage > 1.0 ? `Effective APY with ${leverage.leverage}x leverage` : 'Base APY'}>
          {effectiveAPY.toFixed(2)}%
        </span>
      </td>
      <td className="text-right py-4 px-4">
        <button
          onClick={onSelect}
          disabled={ctokenBalance === BigInt(0)}
          className="px-3 py-1 bg-forge-primary hover:bg-forge-secondary disabled:bg-forge-gray-700 disabled:text-forge-gray-500 disabled:cursor-not-allowed text-white rounded text-sm font-heading transition-colors"
          title={ctokenBalance === BigInt(0) ? 'No position to manage' : 'View position details'}
        >
          Manage
        </button>
      </td>
    </tr>
  )
}

function CTokenPositionDetails({ position, onClose }: { position: CTokenPosition, onClose: () => void }) {
  const { leverage } = useCToken(position.crucibleAddress, position.ctokenMint)
  const { userBalances, getCrucible } = useCrucible()
  const [showWithdraw, setShowWithdraw] = useState(false)
  
  const crucible = getCrucible(position.crucibleAddress)
  const userBalance = userBalances[position.crucibleAddress]
  
  if (!userBalance || !crucible) return null
  
  // Calculate exchange rate outside IIFE so it's accessible
  // exchange_rate is scaled by 1_000_000 on-chain (1.0 = 1_000_000)
  const exchangeRate = crucible.exchangeRate ? Number(crucible.exchangeRate) / 1_000_000 : 1.0

  return (
    <div className="panel-muted rounded-lg p-6 border border-forge-gray-700">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-xl font-heading text-white">{position.ctokenSymbol} Position</h3>
        <button
          onClick={onClose}
          className="text-forge-gray-400 hover:text-white transition-colors"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {(() => {
        const baseTokenPrice = 200 // SOL price
        const ctokenBalance = Number(userBalance.ptokenBalance) / 1e9
        const collateralValue = userBalance.baseDeposited * baseTokenPrice
        const borrowedUSDC = leverage?.borrowedAmount ? Number(leverage.borrowedAmount) / 1e6 : 0
        const healthFactor = borrowedUSDC > 0 
          ? collateralValue / (borrowedUSDC * 1.3) 
          : 999
        
        return (
          <div className="grid grid-cols-2 gap-4 mb-6">
            <div className="panel-muted rounded-lg p-4">
              <div className="text-forge-gray-400 text-sm font-satoshi mb-1">cToken Balance</div>
              <div className="text-white text-lg font-heading">
                {ctokenBalance.toFixed(2)} {position.ctokenSymbol}
              </div>
            </div>
            <div className="panel-muted rounded-lg p-4">
              <div className="text-forge-gray-400 text-sm font-satoshi mb-1">
                Collateral
                <span className="ml-1 text-xs" title="The base token value of your position">(ℹ️)</span>
              </div>
              <div className="text-white text-lg font-heading">
                {userBalance.baseDeposited.toFixed(2)} {position.baseTokenSymbol}
              </div>
              <div className="text-forge-gray-500 text-xs font-satoshi mt-1">
                cToken Balance: {ctokenBalance.toFixed(2)} {position.ctokenSymbol}
              </div>
            </div>
            <div className="panel-muted rounded-lg p-4">
              <div className="text-forge-gray-400 text-sm font-satoshi mb-1">Borrowed (USDC)</div>
              <div className={`text-lg font-heading ${
                borrowedUSDC > 0 ? 'text-orange-400' : 'text-forge-gray-500'
              }`}>
                {borrowedUSDC > 0 ? `${borrowedUSDC.toFixed(2)} USDC` : '-'}
              </div>
            </div>
            <div className="panel-muted rounded-lg p-4">
              <div className="text-forge-gray-400 text-sm font-satoshi mb-1">Health Factor</div>
              <div className={`text-lg font-heading ${
                healthFactor >= 2.0 ? 'text-green-400' :
                healthFactor >= 1.5 ? 'text-yellow-400' :
                healthFactor >= 1.0 ? 'text-orange-400' :
                healthFactor < 999 ? 'text-red-400' :
                'text-forge-gray-500'
              }`}>
                {healthFactor >= 999 ? '∞' : healthFactor.toFixed(2)}
              </div>
              {healthFactor < 999 && healthFactor < 1.0 && (
                <div className="text-red-400 text-xs font-satoshi mt-1">⚠️ Liquidation risk</div>
              )}
            </div>
            <div className="panel-muted rounded-lg p-4">
              <div className="text-forge-gray-400 text-sm font-satoshi mb-1">Leverage</div>
              <div className="text-white text-lg font-heading">
                {leverage?.leverage || 1.0}x
              </div>
            </div>
            <div className="panel-muted rounded-lg p-4">
              <div className="text-forge-gray-400 text-sm font-satoshi mb-1">Exchange Rate</div>
              <div className="text-white text-lg font-heading">
                1 {position.ctokenSymbol} = {exchangeRate.toFixed(2)} {position.baseTokenSymbol}
              </div>
            </div>
          </div>
        )
      })()}

      <div className="flex space-x-3">
        <button
          onClick={() => setShowWithdraw(true)}
          className="flex-1 px-4 py-3 bg-forge-primary-light hover:bg-forge-primary text-white rounded-lg font-medium transition-colors shadow-[0_10px_30px_rgba(255,102,14,0.25)]"
        >
          Close Position
        </button>
      </div>

      {showWithdraw && (
        <CTokenWithdrawModal
          isOpen={showWithdraw}
          onClose={() => setShowWithdraw(false)}
          crucibleAddress={position.crucibleAddress}
          ctokenMint={position.ctokenMint}
          baseTokenSymbol={position.baseTokenSymbol}
          ctokenSymbol={position.ctokenSymbol}
          currentBalance={userBalance.ptokenBalance}
          exchangeRate={exchangeRate}
        />
      )}
    </div>
  )
}

