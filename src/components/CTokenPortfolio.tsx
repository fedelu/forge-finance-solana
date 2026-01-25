import React, { useState } from 'react'
import { useCToken } from '../hooks/useCToken'
import { useCrucible } from '../hooks/useCrucible'
import { useLVFPosition } from '../hooks/useLVFPosition'
import { useLP } from '../hooks/useLP'
import { useInfernoLP } from '../hooks/useInfernoLP'
import { useLending } from '../hooks/useLending'
import { useBalance } from '../contexts/BalanceContext'
import { usePrice } from '../contexts/PriceContext'
import { useWallet } from '../contexts/WalletContext'
import CTokenWithdrawModal from './CTokenWithdrawModal'
import { formatNumberWithCommas, formatUSD, formatUSDC, formatSOL } from '../utils/math'
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
  const { solPrice } = usePrice();
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

  const infernoCrucible = positions.find(p => p.crucibleAddress === 'inferno-lp-crucible')

  const solInfernoLP = useInfernoLP({
    crucibleAddress: infernoCrucible?.crucibleAddress || '',
    baseTokenSymbol: 'SOL',
    baseAPY: infernoCrucible?.baseAPY || 0,
  })

  // Fetch lending pool positions
  const { positions: lendingPositions, withdraw: withdrawLending, repay: repayLending } = useLending()

  // Store refetch functions in refs to avoid dependency issues
  const solInfernoRefetchRef = React.useRef(solInfernoLP.refetch)

  // Update refs when refetch functions change
  React.useEffect(() => {
    solInfernoRefetchRef.current = solInfernoLP.refetch
  }, [solInfernoLP.refetch])

  // Listen for position opened/closed events to refresh - IMMEDIATE
  React.useEffect(() => {
    const handlePositionChange = (event?: CustomEvent) => {
      // Trigger refresh - localStorage is already updated
      // Use refs to avoid dependency issues
      solInfernoRefetchRef.current()
      setRefreshKey(prev => prev + 1)
      
      // Single delayed refresh to catch any async updates
      const timeoutId = setTimeout(() => {
        solInfernoRefetchRef.current()
        setRefreshKey(prev => prev + 1)
      }, 200)
      
      return () => clearTimeout(timeoutId)
    }
    
    window.addEventListener('infernoLpPositionOpened', handlePositionChange as EventListener)
    window.addEventListener('infernoLpPositionClosed', handlePositionChange as EventListener)
    window.addEventListener('forceRecalculateLP', handlePositionChange as EventListener)
    
    return () => {
      window.removeEventListener('infernoLpPositionOpened', handlePositionChange as EventListener)
      window.removeEventListener('infernoLpPositionClosed', handlePositionChange as EventListener)
      window.removeEventListener('forceRecalculateLP', handlePositionChange as EventListener)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Refetch positions when refresh key changes
  React.useEffect(() => {
    if (refreshKey > 0) {
      solInfernoRefetchRef.current()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey])

  const allInfernoPositions = React.useMemo(() => {
    const sol = solInfernoLP.positions
      .filter(p => p.isOpen) // Only open positions
      .map(p => ({
        ...p,
        crucible: infernoCrucible || positions.find(pos => pos.baseTokenSymbol === 'SOL')!,
        isInferno: true,
      }))
    return sol
  }, [solInfernoLP.positions, positions, infernoCrucible])

  // Refetch positions periodically and on mount
  React.useEffect(() => {
    // Initial fetch
    solInfernoLP.refetch()
    
    // Set up interval to refetch every 60 seconds (increased to reduce rate limit issues)
    const interval = setInterval(() => {
      solInfernoLP.refetch()
    }, 60000)
    
    return () => clearInterval(interval)
  }, [solInfernoLP.refetch])

  // Combine all LP and leveraged positions for cTOKENS/USDC section
  const allCTokenUSDCPositions = React.useMemo(() => {
    const infernoWithDetails = allInfernoPositions
      .filter((inferno) => {
        const isOpen = inferno.isOpen === true || inferno.isOpen === undefined
        const hasValidData = inferno.baseAmount > 0 && inferno.usdcAmount > 0
        return isOpen && hasValidData
      })
      .map((inferno) => ({
        ...inferno,
        leverage: inferno.leverageFactor || 1.0,
        borrowedUSDC: inferno.borrowedUSDC || 0,
        collateralUSDC: inferno.usdcAmount,
        baseToken: inferno.baseToken,
        baseAmount: inferno.baseAmount,
        usdcAmount: inferno.usdcAmount,
        isInferno: true,
        lpAPY: inferno.crucible.baseAPY,
        lpTokenAmount: inferno.lpTokenAmount || 0, // Include LP token amount
      }))
    
    const combined = [...infernoWithDetails]
    return combined
  }, [allInfernoPositions])

  // Calculate total portfolio value
  const totalPortfolioValue = React.useMemo(() => {
    // Calculate wrap positions value from userBalances
    // Use current cToken value (with exchange rate growth), not original deposit
    const wrapPositions = positions.reduce((sum, pos) => {
      const userBalance = userBalances[pos.crucibleAddress]
      const crucible = getCrucible(pos.crucibleAddress)
      if (userBalance && userBalance.ptokenBalance > BigInt(0)) {
        const basePrice = solPrice // Use real-time SOL price
        const ctokenBalance = Number(userBalance.ptokenBalance) / 1e9
        // Use actual exchange rate from crucible (scaled by 1e6), default to 1.0
        const exchangeRate = crucible?.exchangeRate ? Number(crucible.exchangeRate) / 1e6 : 1.0
        // Current value = cToken balance * exchange rate * base price
        const currentValue = ctokenBalance * exchangeRate * basePrice
        return sum + currentValue
      }
      return sum
    }, 0)

    // Calculate LP positions value (allCTokenUSDCPositions includes both LP and leveraged)
    // For "Total Deposited Value", we only count what was actually deposited (excluding borrowed USDC)
    const lpValue = allCTokenUSDCPositions.reduce((sum, pos) => {
      const basePrice = solPrice // Use real-time SOL price
      const tokenCollateralValue = pos.baseAmount * basePrice
      
      // Check if this is a leveraged position (has borrowedUSDC > 0 or leverage > 1)
      const isLeveraged = ('borrowedUSDC' in pos && pos.borrowedUSDC > 0) || 
                         ('leverage' in pos && pos.leverage > 1.0) ||
                         ('leverageFactor' in pos && pos.leverageFactor > 1.0)
      
      if (isLeveraged) {
        // For leveraged positions: deposited value = token collateral + deposited USDC (NOT borrowed)
        const depositUSDC = 'depositUSDC' in pos && typeof pos.depositUSDC === 'number'
          ? pos.depositUSDC
          : 0
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
  }, [positions, userBalances, allCTokenUSDCPositions, lendingPositions, solPrice, getCrucible, crucibles])

  // Calculate weighted APY
  const weightedAPY = React.useMemo(() => {
    let totalValue = 0
    let weightedSum = 0

    // cToken positions
    positions.forEach(pos => {
      const userBalance = userBalances[pos.crucibleAddress]
      const crucible = getCrucible(pos.crucibleAddress)
      if (userBalance && userBalance.ptokenBalance > BigInt(0)) {
        const basePrice = solPrice // Use real-time SOL price
        const ctokenBalance = Number(userBalance.ptokenBalance) / 1e9
        const exchangeRate = crucible?.exchangeRate ? Number(crucible.exchangeRate) / 1e6 : 1.0
        const value = ctokenBalance * exchangeRate * basePrice
        totalValue += value
        weightedSum += value * pos.baseAPY
      }
    })

    // LP positions
    allCTokenUSDCPositions.forEach(pos => {
      const basePrice = solPrice // Use real-time SOL price
      const tokenCollateralValue = pos.baseAmount * basePrice
      const isLeveraged = ('borrowedUSDC' in pos && pos.borrowedUSDC > 0) || 
                         ('leverage' in pos && pos.leverage > 1.0) ||
                         ('leverageFactor' in pos && pos.leverageFactor > 1.0)
      
      let value = 0
      if (isLeveraged) {
        const depositUSDC = 'depositUSDC' in pos && typeof pos.depositUSDC === 'number'
          ? pos.depositUSDC
          : 0
        value = tokenCollateralValue + depositUSDC
      } else {
        const depositedUSDC = pos.usdcAmount || 0
        value = tokenCollateralValue + depositedUSDC
      }
      
      // Get baseAPY from crucible by matching baseToken
      const crucible = crucibles.find(c => c.baseToken === pos.baseToken)
      const baseAPY = crucible ? (crucible.apr || 0) * 100 : 0
      // Matches contract: LP APY = base APY (no 3x multiplier)
      const lpAPY = 'lpAPY' in pos && pos.lpAPY ? pos.lpAPY : baseAPY
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
  }, [positions, userBalances, allCTokenUSDCPositions, lendingPositions, crucibles, solPrice, getCrucible])

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
    <div className="space-y-2 min-h-0 flex flex-col">
      {/* cTOKENS Section - Simple wrap positions */}
      <div className="panel rounded-3xl p-6 xl:p-10 flex-1 flex flex-col">
        <div className="flex items-center gap-3 mb-2">
          <h3 className="text-base font-heading text-white">cTOKENS</h3>
          <span className="px-2.5 py-0.5 bg-gradient-to-r from-blue-500/20 to-blue-500/10 text-blue-400 text-[11px] font-heading rounded-full border border-blue-500/30">{cTokenPositions.length}</span>
        </div>
        <div className={`overflow-x-auto ${cTokenPositions.length > 2 ? 'max-h-[320px] overflow-y-auto pr-1' : ''}`}>
          <table className="w-full border-collapse text-[12px]">
            <thead>
              <tr className="border-b border-forge-gray-700/50">
                <th className="text-left py-2.5 px-3 text-forge-gray-400 font-semibold text-[11px] uppercase tracking-wider">cToken</th>
                <th className="text-right py-2.5 px-3 text-forge-gray-400 font-semibold text-[11px] uppercase tracking-wider">Balance</th>
                <th className="text-right py-2.5 px-3 text-forge-gray-400 font-semibold text-[11px] uppercase tracking-wider">Value</th>
                <th className="text-right py-2.5 px-3 text-forge-gray-400 font-semibold text-[11px] uppercase tracking-wider">APY</th>
              </tr>
            </thead>
            <tbody>
              {cTokenPositions.length > 0 ? (
                cTokenPositions.map((position, index) => {
                  const userBalance = userBalances[position.crucibleAddress]
                  const crucible = getCrucible(position.crucibleAddress)
                  const ctokenBalance = userBalance?.ptokenBalance ? Number(userBalance.ptokenBalance) / 1e9 : 0
                  const basePrice = solPrice // Use real-time SOL price
                  // Use actual exchange rate from crucible (scaled by 1e6), default to 1.0
                  const exchangeRate = crucible?.exchangeRate ? Number(crucible.exchangeRate) / 1e6 : 1.0
                  const valueUSD = ctokenBalance * exchangeRate * basePrice
                  
                  return (
                    <tr 
                      key={position.crucibleAddress} 
                      className="group border-b border-forge-gray-800/50 hover:bg-gradient-to-r hover:from-forge-gray-800/40 hover:to-forge-gray-800/20 transition-all duration-300"
                      style={{ animationDelay: `${index * 50}ms` }}
                    >
                      <td className="py-2.5 px-3">
                        <div>
                          <div className="text-white font-semibold text-sm">{position.ctokenSymbol}</div>
                          <div className="text-forge-gray-500 text-[11px] font-medium mt-0.5">{position.baseTokenSymbol}</div>
                        </div>
                      </td>
                      <td className="text-right py-2.5 px-3">
                        <div className="text-white font-semibold text-sm">
                          {formatSOL(ctokenBalance)} {position.ctokenSymbol}
                        </div>
                      </td>
                      <td className="text-right py-2.5 px-3">
                        <div className="text-white font-semibold text-sm">
                          ${formatUSD(valueUSD)} USD
                        </div>
                      </td>
                      <td className="text-right py-2.5 px-3">
                        <span className="inline-flex items-center px-2.5 py-0.5 bg-blue-500/20 text-blue-400 font-semibold rounded-lg text-[11px] border border-blue-500/30">
                          {position.baseAPY.toFixed(2)}%
                        </span>
                      </td>
                    </tr>
                  )
                })
              ) : (
                <tr>
                  <td colSpan={4} className="py-8 px-3 text-center">
                    <div className="text-forge-gray-400 text-xs font-medium">
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
      <div className="panel rounded-3xl p-6 xl:p-10 flex-1 flex flex-col">
        <div className="flex items-center gap-3 mb-2">
          <h3 className="text-base font-heading text-white">ifTOKEN/USDC</h3>
          <span className="px-2.5 py-0.5 bg-green-500/20 text-green-400 text-[11px] font-heading rounded-full">{allCTokenUSDCPositions.length}</span>
        </div>
        <div className={`overflow-x-auto ${allCTokenUSDCPositions.filter(p => p.isOpen).length > 2 ? 'max-h-[320px] overflow-y-auto pr-1' : ''}`}>
          <table className="w-full border-collapse text-[12px]">
            <thead>
              <tr className="border-b border-forge-gray-700">
                <th className="text-left py-2 px-2.5 text-forge-gray-400 text-[10px] font-heading uppercase tracking-[0.18em] whitespace-nowrap">Pair</th>
                <th className="text-right py-2 px-2.5 text-forge-gray-400 text-[10px] font-heading uppercase tracking-[0.18em] whitespace-nowrap">
                  {allCTokenUSDCPositions.some(p => (p as any).isInferno) ? 'LP Tokens' : 'Collateral (cToken)'}
                </th>
                <th className="text-right py-2 px-2.5 text-forge-gray-400 text-[10px] font-heading uppercase tracking-[0.18em] whitespace-nowrap">
                  Borrowed (USDC)
                </th>
                <th className="text-right py-2 px-2.5 text-forge-gray-400 text-[10px] font-heading uppercase tracking-[0.18em] whitespace-nowrap">Leverage</th>
                <th className="text-right py-2 px-2.5 text-forge-gray-400 text-[10px] font-heading uppercase tracking-[0.18em] whitespace-nowrap">
                  Health Factor
                </th>
                <th className="text-right py-2 px-2.5 text-forge-gray-400 text-[10px] font-heading uppercase tracking-[0.18em] whitespace-nowrap">Total Value</th>
                <th className="text-right py-2 px-2.5 text-forge-gray-400 text-[10px] font-heading uppercase tracking-[0.18em] whitespace-nowrap">APY</th>
              </tr>
            </thead>
            <tbody>
              {(() => {
                const openPositions = allCTokenUSDCPositions.filter(p => p.isOpen)
                return openPositions.length > 0 ? (
                  openPositions.map((position) => {
                  const crucible = positions.find(p => p.baseTokenSymbol === position.baseToken)
                  const infernoCrucible = getCrucible('inferno-lp-crucible')
                  const basePrice = solPrice // Use real-time SOL price
                  const isInferno = (position as any).isInferno === true
                  
                  // For Inferno positions, use LP token data
                  let displayValue = 0
                  let displayLabel = ''
                  let lpTokenAmount = 0
                  let lpTokenPrice = 0
                  
                  if (isInferno) {
                    // Get LP token amount and price for Inferno
                    lpTokenAmount = (position as any).lpTokenAmount || 0
                    lpTokenPrice = infernoCrucible?.lpTokenPrice || 0
                    displayValue = lpTokenAmount * lpTokenPrice
                    displayLabel = `${lpTokenAmount.toFixed(4)} LP Tokens`
                  } else {
                    // For regular LP/leveraged positions, use collateral
                    const totalCollateralValue = position.collateralUSDC || (position.baseAmount * basePrice)
                    displayValue = totalCollateralValue
                    displayLabel = `${formatSOL(position.baseAmount)} ${position.baseToken}`
                    const depositUSDC = 'depositUSDC' in position && typeof position.depositUSDC === 'number'
                      ? position.depositUSDC
                      : 0
                    if (depositUSDC > 0) {
                      displayLabel += ` + ${formatUSDC(depositUSDC)} USDC`
                    }
                  }
                  
                  const borrowedUSDC = position.borrowedUSDC || 0
                  const leverage = position.leverage || ('leverageFactor' in position ? position.leverageFactor : 1.0)
                  const healthFactor = 'health' in position && typeof position.health === 'number'
                    ? position.health
                    : borrowedUSDC > 0
                      ? displayValue / (borrowedUSDC * 1.3)
                      : 999
                  
                  // For Inferno, use crucible's baseAPY (same as cToken table)
                  // For others, use leveraged APY calculation
                  const lpAPY = isInferno
                    ? (infernoCrucible?.apr || 0) * 100 // Use crucible's APR (same as cToken)
                    : ('lpAPY' in position && position.lpAPY 
                      ? position.lpAPY 
                      : leverage > 1 
                        ? (crucible?.baseAPY || 0) * leverage - (10 * (leverage - 1))
                        : (crucible?.baseAPY || 0))
                  
                  // For Inferno, total value is LP token value (no borrowed USDC for 1x)
                  // For others, total value = collateral + borrowed
                  const totalValue = isInferno
                    ? displayValue // LP token value
                    : displayValue + borrowedUSDC
                  
                  return (
                    <tr key={position.id} className="border-b border-forge-gray-800 hover:bg-forge-gray-800/30 transition-colors">
                      <td className="py-2.5 px-3">
                        <div className="flex items-center space-x-2">
                          <span className="text-white text-sm font-heading">
                            {crucible
                              ? `if${crucible.ctokenSymbol.replace(/^c/i, '')}/USDC`
                              : `if${position.baseToken.replace(/^if/i, '')}/USDC`}
                          </span>
                          <span className={`px-2 py-0.5 rounded text-[10px] font-heading uppercase tracking-[0.16em] ${
                            isInferno
                              ? 'bg-red-500/20 text-red-400'
                              : leverage > 1
                              ? 'bg-orange-500/20 text-orange-400'
                              : 'bg-green-500/20 text-green-400'
                          }`}>
                            {isInferno ? 'Inferno' : leverage > 1 ? 'Leveraged' : 'LP'}
                          </span>
                        </div>
                      </td>
                      <td className="text-right py-2.5 px-3">
                        {isInferno ? (
                          <>
                            <div className="text-white text-sm font-heading">
                              ${formatUSD(displayValue)} USD
                            </div>
                            <div className="text-forge-gray-500 text-[11px] font-satoshi mt-1">
                              {displayLabel}
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="text-white text-sm font-heading">
                              ${formatUSD(displayValue)} USD
                            </div>
                            <div className="text-forge-gray-500 text-[11px] font-satoshi mt-1">
                              {displayLabel}
                            </div>
                          </>
                        )}
                      </td>
                      <td className="text-right py-2.5 px-3">
                        <span className={`text-sm font-heading ${borrowedUSDC > 0 ? 'text-orange-400' : 'text-forge-gray-500'}`}>
                          {borrowedUSDC > 0 ? `${formatUSDC(borrowedUSDC)} USDC` : '-'}
                        </span>
                      </td>
                      <td className="text-right py-2.5 px-3">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-heading uppercase tracking-[0.16em] ${
                          leverage === 2.0 ? 'bg-yellow-500/20 text-yellow-400' :
                          leverage === 1.5 ? 'bg-orange-500/20 text-orange-400' :
                          'bg-green-500/20 text-green-400'
                        }`}>
                          {leverage.toFixed(1)}x
                        </span>
                      </td>
                      <td className="text-right py-2.5 px-3">
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
                      <td className="text-right py-2.5 px-3">
                        <span className="text-white text-sm font-heading">${formatUSD(totalValue)}</span>
                      </td>
                      <td className="text-right py-2.5 px-3">
                        <span className="text-green-400 text-sm font-heading">{lpAPY.toFixed(2)}%</span>
                      </td>
                    </tr>
                  )
                })
                ) : (
                  <tr>
                    <td colSpan={7} className="py-5 px-3 text-center">
                      <div className="text-forge-gray-400 text-xs">
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
      <div className="panel rounded-3xl p-6 xl:p-10 flex-1 flex flex-col">
        <div className="flex items-center gap-3 mb-2">
          <h3 className="text-base font-heading text-white">Lending Pool</h3>
          <span className="px-2.5 py-0.5 bg-gradient-to-r from-purple-500/20 to-purple-500/10 text-purple-400 text-[11px] font-heading rounded-full border border-purple-500/30">
            {lendingPositions.filter(p => (p.suppliedAmount > 0) || (p.borrowedAmount && p.borrowedAmount > 0)).length}
          </span>
        </div>
        <div className={`overflow-x-auto ${lendingPositions.filter(p => (p.suppliedAmount > 0) || (p.borrowedAmount && p.borrowedAmount > 0)).length > 2 ? 'max-h-[320px] overflow-y-auto pr-1' : ''}`}>
          <table className="w-full border-collapse text-[12px]">
            <thead>
              <tr className="border-b border-forge-gray-700">
                <th className="text-left py-2 px-2.5 text-forge-gray-400 font-semibold text-[10px] uppercase tracking-wider">Type</th>
                <th className="text-right py-2 px-2.5 text-forge-gray-400 font-semibold text-[10px] uppercase tracking-wider">Amount</th>
                <th className="text-right py-2 px-2.5 text-forge-gray-400 font-semibold text-[10px] uppercase tracking-wider">APY</th>
                <th className="text-right py-2 px-2.5 text-forge-gray-400 font-semibold text-[10px] uppercase tracking-wider">Interest</th>
                <th className="text-right py-2 px-2.5 text-forge-gray-400 font-semibold text-[10px] uppercase tracking-wider">Value</th>
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
                            <td className="py-2.5 px-3">
                              <div className="flex items-center space-x-3">
                                <div className="w-9 h-9 bg-gradient-to-br from-green-500/30 to-green-500/10 rounded-xl flex items-center justify-center ring-2 ring-green-500/20">
                                  <span className="text-green-400 text-sm font-heading">S</span>
                                </div>
                                <div>
                                  <div className="text-white text-sm font-heading">Supplied</div>
                                  <div className="text-forge-gray-500 text-[11px] font-satoshi">Lending</div>
                                </div>
                              </div>
                            </td>
                            <td className="text-right py-2.5 px-3">
                              <div className="text-white text-sm font-heading">
                                {formatNumberWithCommas(position.suppliedAmount || 0)} USDC
                              </div>
                            </td>
                            <td className="text-right py-2.5 px-3">
                              <span className="inline-flex items-center px-2.5 py-0.5 bg-green-500/20 text-green-400 font-semibold rounded-lg text-[11px] border border-green-500/30">
                                {(position.effectiveApy || 4.5).toFixed(2)}%
                              </span>
                            </td>
                            <td className="text-right py-2.5 px-3">
                              <div className="text-green-400 text-sm font-heading">
                                +{formatNumberWithCommas(position.interestEarned || 0)} USDC
                              </div>
                            </td>
                            <td className="text-right py-2.5 px-3">
                              <div className="text-white text-sm font-heading">
                                ${formatNumberWithCommas(suppliedValue)}
                              </div>
                            </td>
                          </tr>
                        )}
                        {isBorrowed && position.borrowedAmount && (
                          <tr className="border-b border-forge-gray-800 hover:bg-forge-gray-800/30 transition-colors">
                            <td className="py-2.5 px-3">
                              <div>
                                <div className="text-white text-sm font-heading">Borrowed</div>
                                <div className="text-forge-gray-500 text-[11px] font-satoshi">Debt</div>
                              </div>
                            </td>
                            <td className="text-right py-2.5 px-3">
                              <div className="text-white text-sm font-heading">
                                {formatNumberWithCommas(position.borrowedAmount || 0)} USDC
                              </div>
                            </td>
                            <td className="text-right py-2.5 px-3">
                              <span className="inline-flex items-center px-2.5 py-0.5 bg-orange-500/20 text-orange-400 font-semibold rounded-lg text-[11px] border border-orange-500/30">
                                10.00%
                              </span>
                            </td>
                            <td className="text-right py-2.5 px-3">
                              <div className="text-orange-400 text-sm font-heading">
                                -{formatNumberWithCommas(borrowedInterest)} USDC
                              </div>
                            </td>
                            <td className="text-right py-2.5 px-3">
                              <div className="text-white text-sm font-heading">
                                ${formatNumberWithCommas(borrowedValue)}
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    )
                  })
                } else {
                  return (
                    <tr>
                      <td colSpan={5} className="py-8 px-3 text-center">
                        <div className="text-forge-gray-400 text-xs font-medium">
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
  const { solPrice } = usePrice()
  const { closePosition: closeLVFPosition, loading: lvfLoading } = useLVFPosition({
    crucibleAddress: crucible.crucibleAddress,
    baseTokenSymbol: crucible.baseTokenSymbol as 'SOL',
  })
  
  const { closePosition: closeLPPosition, loading: lpLoading } = useLP({
    crucibleAddress: crucible.crucibleAddress,
    baseTokenSymbol: crucible.baseTokenSymbol as 'SOL',
    baseAPY: crucible.baseAPY,
  })

  const { closePosition: closeInfernoPosition, loading: infernoLoading } = useInfernoLP({
    crucibleAddress: crucible.crucibleAddress,
    baseTokenSymbol: crucible.baseTokenSymbol as 'SOL',
    baseAPY: crucible.baseAPY,
  })
  
  const { addToBalance, subtractFromBalance } = useBalance()
  const { getCrucible } = useCrucible()
  
  const isInferno = position.isInferno === true
  const isLeveraged = position.leverage && position.leverage > 1
  const loading = isInferno ? infernoLoading : (isLeveraged ? lvfLoading : lpLoading)
  
  const handleClose = async () => {
    if (!confirm(`Are you sure you want to close this ${isInferno ? 'Inferno LP' : (isLeveraged ? 'leveraged' : 'LP')} position?`)) {
      return
    }
    
    try {
      if (isInferno) {
        await closeInfernoPosition(position.id)
        window.dispatchEvent(new CustomEvent('infernoLpPositionClosed'))
        alert('Inferno LP position closed. Wallet balances refresh automatically.')
        onClose()
        return
      }

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
          const basePrice = solPrice // Use real-time SOL price
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
          // Use actual exchange rate from getCrucible (scaled by 1e6), default to 1.0
          const crucibleData = getCrucible(crucible.crucibleAddress)
          const lpExchangeRate = crucibleData?.exchangeRate ? Number(crucibleData.exchangeRate) / 1e6 : 1.0
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
  const { solPrice } = usePrice()
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
  // For cToken positions: collateral is the value of your cTokens in base tokens (with exchange rate)
  // For leveraged positions: collateral is the base token amount you deposited
  const ctokenBalanceDisplay = Number(ctokenBalance) / 1e9 // userBalances uses 1e9 scale
  // Calculate actual collateral value from cToken balance and exchange rate
  const collateralInBaseTokens = ctokenBalanceDisplay * exchangeRate
  
  // Borrowed amount (only for leveraged positions)
  const borrowedUSDC = leverage?.borrowedAmount && leverage.borrowedAmount > BigInt(0)
    ? Number(leverage.borrowedAmount) / 1e6 
    : 0
  
  // Calculate health factor (only relevant for leveraged positions)
  const baseTokenPrice = position.baseTokenSymbol === 'FORGE' ? 0.002 : solPrice
  const collateralValueUSD = collateralInBaseTokens * baseTokenPrice
  const healthFactor = borrowedUSDC > 0 
    ? collateralValueUSD / (borrowedUSDC * 1.3) 
    : 999 // No borrow = infinite health

  return (
    <tr className="border-b border-forge-gray-800 hover:bg-forge-gray-800/30 transition-colors">
      <td className="py-4 px-4">
        <div>
          <div className="text-white text-base font-heading">{position.ctokenSymbol}</div>
          <div className="text-forge-gray-500 text-xs font-satoshi">{position.baseTokenSymbol}</div>
        </div>
      </td>
      <td className="text-right py-4 px-4">
        <div className="flex flex-col items-end">
          <div className="text-white text-base font-heading">
            {collateralInBaseTokens > 0 ? formatSOL(collateralInBaseTokens) : '0.000'} {position.baseTokenSymbol}
          </div>
          <div className="text-forge-gray-500 text-xs font-satoshi mt-1">
            {ctokenBalanceDisplay > 0 ? `${formatSOL(ctokenBalanceDisplay)} ${position.ctokenSymbol}` : 'No position'}
          </div>
          <div className="text-forge-gray-400 text-xs font-satoshi mt-0.5" title="Value of your cTokens in base tokens (collateral)">
            ≈ ${formatUSD(collateralValueUSD)} USD
          </div>
        </div>
      </td>
      <td className="text-right py-4 px-4">
        {borrowedUSDC > 0 ? (
          <span className="text-orange-400 text-base font-heading">{formatUSDC(borrowedUSDC)} USDC</span>
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
  const { solPrice } = usePrice()
  const { leverage } = useCToken(position.crucibleAddress, position.ctokenMint)
  const { userBalances, getCrucible } = useCrucible()
  const { connected, publicKey } = useWallet()
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
        const baseTokenPrice = solPrice // Use real-time SOL price from CoinGecko
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
                {formatSOL(ctokenBalance)} {position.ctokenSymbol}
              </div>
            </div>
            <div className="panel-muted rounded-lg p-4">
              <div className="text-forge-gray-400 text-sm font-satoshi mb-1">
                Collateral
                <span className="ml-1 text-xs" title="The base token value of your position">(ℹ️)</span>
              </div>
              <div className="text-white text-lg font-heading">
                {formatSOL(userBalance.baseDeposited)} {position.baseTokenSymbol}
              </div>
              <div className="text-forge-gray-500 text-xs font-satoshi mt-1">
                cToken Balance: {formatSOL(ctokenBalance)} {position.ctokenSymbol}
              </div>
            </div>
            <div className="panel-muted rounded-lg p-4">
              <div className="text-forge-gray-400 text-sm font-satoshi mb-1">Borrowed (USDC)</div>
              <div className={`text-lg font-heading ${
                borrowedUSDC > 0 ? 'text-orange-400' : 'text-forge-gray-500'
              }`}>
                {borrowedUSDC > 0 ? `${formatUSDC(borrowedUSDC)} USDC` : '-'}
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
                1 {position.ctokenSymbol} = {formatSOL(exchangeRate)} {position.baseTokenSymbol}
              </div>
            </div>
          </div>
        )
      })()}

      <div className="flex space-x-3">
        <button
          onClick={() => setShowWithdraw(true)}
          disabled={!connected || !publicKey}
          className={`flex-1 px-4 py-3 rounded-lg font-medium transition-colors shadow-[0_10px_30px_rgba(255,102,14,0.25)] ${
            !connected || !publicKey
              ? 'bg-forge-gray-700 text-forge-gray-500 cursor-not-allowed shadow-none'
              : 'bg-forge-primary-light hover:bg-forge-primary text-white'
          }`}
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

