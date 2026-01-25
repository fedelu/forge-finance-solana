import React, { useState } from 'react'
import { useWallet } from '../contexts/WalletContext'
import { usePrice } from '../contexts/PriceContext'
import { useCrucible, CrucibleData } from '../hooks/useCrucible'
import { useBalance } from '../contexts/BalanceContext'
import { useLending } from '../hooks/useLending'
import CTokenDepositModal from './CTokenDepositModal'
import CTokenWithdrawModal from './CTokenWithdrawModal'
import ClosePositionModal from './ClosePositionModal'
import LeveragedProjectionChart from './LeveragedProjectionChart'
import LVFPositionModal from './LVFPositionModal'
import LVFPositionCard from './LVFPositionCard'
import LPPositionModal from './LPPositionModal'
import InfernoLPPositionModal from './InfernoLPPositionModal'
import { useCToken } from '../hooks/useCToken'
import { useLeverage } from '../hooks/useLeverage'
import { useLVFPosition } from '../hooks/useLVFPosition'
import { useLP } from '../hooks/useLP'
import { useInfernoLP } from '../hooks/useInfernoLP'
import { formatNumberWithCommas, getCTokenPrice, RATE_SCALE, formatUSD, formatUSDC, formatSOL } from '../utils/math'

// Use CrucibleData from useCrucible hook instead of defining separate interface
type Crucible = CrucibleData

interface CrucibleManagerProps {
  className?: string
  onDeposit?: (crucibleId: string, amount: number) => void
  onWithdraw?: (crucibleId: string, amount: number) => void
  isConnected?: boolean
}

export default function CrucibleManager({ className = '', onDeposit, onWithdraw, isConnected = false }: CrucibleManagerProps) {
  const { solPrice, infernoLpPrice } = usePrice()
  const { connected } = useWallet()
  const { crucibles, loading, error } = useCrucible()
  const { markets } = useLending()
  const [activeMode, setActiveMode] = useState<'wrap' | 'lp' | 'leveraged'>('wrap')
  const [selectedCrucible, setSelectedCrucible] = useState<string | null>(null)
  const [showCTokenDepositModal, setShowCTokenDepositModal] = useState(false)
  const [showCTokenWithdrawModal, setShowCTokenWithdrawModal] = useState(false)
  const [showClosePositionModal, setShowClosePositionModal] = useState(false)
  const [showLPModal, setShowLPModal] = useState(false)
  const [showLVFModal, setShowLVFModal] = useState(false)
  const [showInfernoLPModal, setShowInfernoLPModal] = useState(false)
  const [selectedLeverage, setSelectedLeverage] = useState<{ [key: string]: number }>({})
  const [effectiveAPY, setEffectiveAPY] = useState<{ [key: string]: number }>({})
  const [leveragedApyExpanded, setLeveragedApyExpanded] = useState<{ [key: string]: boolean }>({})

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

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active': return 'bg-forge-gray-800 text-forge-primary border border-forge-primary/30'
      case 'paused': return 'bg-forge-gray-800 text-forge-gray-300 border border-forge-gray-600'
      case 'maintenance': return 'bg-forge-gray-800 text-forge-gray-400 border border-forge-gray-600'
      default: return 'bg-forge-gray-800 text-forge-gray-300 border border-forge-gray-600'
    }
  }

  return (
    <div className={`space-y-4 ${className} pb-3`}>
      {/* Crucible Stats - Compact */}
      <div className="flex justify-center mb-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 w-full max-w-6xl">
        <div className="panel rounded-xl p-2.5 hover:border-forge-primary/40 transition-all duration-300 group">
            <div className="text-center">
              <p className="text-forge-gray-300 text-[11px] font-satoshi font-medium mb-1">Total TVL</p>
              <p className="text-lg font-heading font-semibold text-white group-hover:text-forge-primary transition-colors duration-300">
                ${formatUSD(
                  crucibles.reduce((sum, c) => sum + c.tvl, 0) +
                  (markets.length > 0 && markets[0].tvl 
                    ? parseFloat(markets[0].tvl.replace(/,/g, '')) || 0 
                    : 0)
                )}
              </p>
            </div>
          </div>

          <div className="panel rounded-xl p-2.5 hover:border-forge-accent/40 transition-all duration-300 group">
            <div className="text-center">
              <p className="text-forge-gray-300 text-[11px] font-satoshi font-medium mb-1">Total Yield Earned (All Time)</p>
              <p className="text-lg font-heading font-semibold text-white group-hover:text-forge-accent transition-colors duration-300">
                ${formatUSD(crucibles.reduce((sum, c) => {
                  // Calculate ALL TIME yield earned: totalFeesAccrued (80% vault share of all fees)
                  // This represents all yield generated from fees and arbitrage deposits, regardless of withdrawals
                  // Includes: wrap/unwrap fees (80%), LP position fees (80%), LVF position fees (80%), and arbitrage deposits (80%)
                  const allTimeYield = c.apyEarnedByUsers || 0; // This is totalFeesAccrued in USD (includes arbitrage revenue)
                  return sum + allTimeYield;
                }, 0))}
              </p>
            </div>
          </div>

          <div className="panel rounded-xl p-2.5 hover:border-forge-primary/40 transition-all duration-300 group">
            <div className="text-center">
              <p className="text-forge-gray-300 text-[11px] font-satoshi font-medium mb-1">Total Transaction Fees</p>
              <p className="text-lg font-heading font-semibold text-white group-hover:text-forge-primary transition-colors duration-300">
                ${formatUSD(crucibles.reduce((sum, c) => sum + (c.totalFeesCollected || 0), 0))}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Loading State */}
      {loading && (
        <div className="flex items-center justify-center py-12">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-forge-primary mx-auto mb-4"></div>
            <p className="text-forge-gray-300">Loading crucibles...</p>
          </div>
        </div>
      )}

      {/* Error State */}
      {error && (
        <div className="bg-red-900/20 border border-red-500/30 rounded-2xl p-6 text-center">
          <p className="text-red-400 mb-4">{error}</p>
          <button 
            onClick={() => window.location.reload()}
            className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors"
          >
            Retry
          </button>
        </div>
      )}

      {/* Crucibles List */}
      {!loading && !error && (
        <div className="space-y-4">
          <div className="text-center space-y-1">
            <p className="text-forge-gray-300 text-sm font-sans leading-snug max-w-2xl mx-auto">
              Crucibles are on-chain yield engines. Wrap your tokens for steady APY, provide liquidity for amplified rewards, or enter Inferno Mode to leverage your position and maximize returns.
            </p>
          </div>
          <div className="flex justify-center">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-5xl w-full">
            {crucibles.map((crucible) => {
              const isInferno = crucible.id === 'inferno-lp-crucible'
              const isSolCrucible = crucible.id === 'sol-crucible'
              return (
            <div key={crucible.id} className="panel rounded-3xl p-5 border border-forge-gray-600/50 hover:border-forge-primary/60 shadow-2xl hover:shadow-forge-lg transition-all duration-500 hover:scale-[1.02] group relative overflow-hidden animate-fade-in">
              {/* Background Pattern with better gradient */}
              <div className="absolute inset-0 bg-gradient-to-br from-forge-primary/10 via-transparent to-forge-secondary/10 opacity-0 group-hover:opacity-100 transition-opacity duration-700"></div>
              {/* Animated border glow */}
              <div className="absolute inset-x-0 top-3 bottom-3 rounded-3xl bg-gradient-to-r from-forge-primary/0 via-forge-primary/20 to-forge-primary/0 opacity-0 group-hover:opacity-100 transition-opacity duration-700 -z-10 blur-xl"></div>
              <div className="relative z-10">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center space-x-3">
                    <div className="w-12 h-12 bg-gradient-to-br from-forge-primary/30 to-forge-accent/30 rounded-2xl flex items-center justify-center group-hover:from-forge-primary/40 group-hover:to-forge-accent/40 transition-all duration-500 shadow-lg group-hover:shadow-forge-primary/20">
                      {crucible.icon.startsWith('/') ? (
                        <img 
                          src={crucible.icon} 
                          alt={`${crucible.name} icon`} 
                          className="h-8 w-8 object-contain group-hover:scale-110 transition-transform duration-300"
                        />
                      ) : (
                        <span className="text-xl group-hover:scale-110 transition-transform duration-300">{crucible.icon}</span>
                      )}
                    </div>
                    <div>
                      <h3 className="text-xl font-heading text-white group-hover:text-forge-primary transition-colors duration-300 mb-1">
                        {isSolCrucible ? 'Mint cTOKEN' : isInferno ? 'Mint LP token' : crucible.name}
                      </h3>
                      <p className="text-forge-gray-300 text-xs font-medium">
                        {isInferno ? `${crucible.ptokenSymbol}/USDC` : `${crucible.baseToken} → ${crucible.ptokenSymbol}`}
                      </p>
                    </div>
                  </div>
                  <span className={`px-2.5 py-1 rounded-full text-[11px] font-bold ${getStatusColor(crucible.status)} shadow-lg`}>
                    {crucible.status.toUpperCase()}
                  </span>
                </div>
                <div className="space-y-2 text-sm font-satoshi-light text-forge-gray-200 mb-4">
                  <div className="flex justify-between items-center py-2.5 px-3 panel-muted backdrop-blur-sm rounded-xl border border-forge-gray-700/50 hover:border-forge-primary/30 transition-all duration-300">
                    <span className="text-forge-gray-400 font-medium text-xs flex items-center gap-2">
                      TVL
                    </span>
                    <span className="font-heading text-base text-white">${formatUSD(crucible.tvl)}</span>
                  </div>
                  {/* APY Display */}
                  <div className="space-y-1.5 py-2.5 px-3 panel-muted backdrop-blur-sm rounded-xl border border-forge-gray-700/50">
                    {(() => {
                      const isExpanded = leveragedApyExpanded[crucible.id] ?? false
                      if (isSolCrucible) {
                        return (
                          <div className="flex justify-between items-center">
                            <span className="text-forge-gray-300 font-medium text-xs">Base APY (Mint):</span>
                            <span className="font-heading text-base text-forge-accent">{(crucible.apr * 100).toFixed(1)}%</span>
                          </div>
                        )
                      }

                      return (
                        <>
                          <button
                            type="button"
                            onClick={() =>
                              setLeveragedApyExpanded((prev) => ({
                                ...prev,
                                [crucible.id]: !isExpanded,
                              }))
                            }
                            className="w-full flex items-center justify-between text-left text-xs text-forge-gray-300 rounded-lg hover:text-forge-gray-200 transition-colors"
                            aria-expanded={isExpanded}
                          >
                            <span className="font-medium flex items-center gap-2">
                              Base APY (Mint):
                              <svg
                                xmlns="http://www.w3.org/2000/svg"
                                fill="none"
                                viewBox="0 0 24 24"
                                strokeWidth="1.5"
                                stroke="currentColor"
                                aria-hidden="true"
                                className={`w-4 h-4 text-forge-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                              >
                                <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
                              </svg>
                            </span>
                            <span className="font-heading text-base text-forge-accent">{(crucible.apr * 100).toFixed(1)}%</span>
                          </button>
                          {isExpanded && (
                            <div className="pt-1.5 border-t border-forge-gray-700/50">
                              <div className="flex justify-between items-center">
                                <span className="text-forge-gray-400 text-[11px] flex items-center">
                                  Leveraged APY (1.5x):
                                </span>
                                <span className="text-orange-400 text-xs font-heading">
                                  {((crucible.apr * 100) * 1.5 - 10 * 0.5).toFixed(1)}%
                                </span>
                              </div>
                              <div className="flex justify-between items-center mt-0.5">
                                <span className="text-forge-gray-400 text-[11px] flex items-center">
                                  Leveraged APY (2x):
                                </span>
                                <span className="text-orange-400 text-xs font-heading">
                                  {((crucible.apr * 100) * 2.0 - 10 * 1.0).toFixed(1)}%
                                </span>
                              </div>
                            </div>
                          )}
                        </>
                      )
                    })()}
                  </div>
                  <div className="flex justify-between items-center py-2.5 px-3 panel-muted backdrop-blur-sm rounded-xl border border-forge-gray-700/50 hover:border-forge-primary/30 transition-all duration-300">
                    <span className="text-forge-gray-400 font-medium text-xs flex items-center gap-2">
                      Crucible Price
                    </span>
                    <span className="font-heading text-base text-forge-primary">
                      {(() => {
                        const isInferno = crucible.id === 'inferno-lp-crucible'

                        if (isInferno) {
                          // Use calculated LP token price from vault balances
                          const lpPrice = crucible.lpTokenPrice || 0
                          if (lpPrice > 0) {
                            return `$${formatUSD(lpPrice)}`
                          }
                          // Fallback if no price calculated yet
                          return '$0.00'
                        }

                        // Check for deposits for cToken crucible
                        const hasDeposits = (crucible.totalWrapped || BigInt(0)) > BigInt(0)
                        const initialExchangeRate = RATE_SCALE
                        const exchangeRate = hasDeposits 
                          ? (crucible.exchangeRate || initialExchangeRate)
                          : initialExchangeRate
                        const exchangeRateDecimal = Number(exchangeRate) / Number(RATE_SCALE)

                        // Default: SOL price * exchange rate
                        const cruciblePrice = solPrice * exchangeRateDecimal
                        return `$${formatUSD(cruciblePrice)}`
                      })()}
                    </span>
                  </div>
                  <div className="flex justify-between items-center py-2.5 px-3 panel-muted backdrop-blur-sm rounded-xl border border-forge-gray-700/50 hover:border-forge-primary/30 transition-all duration-300">
                    <span className="text-forge-gray-400 font-medium text-xs flex items-center gap-2">
                      Total Yield Earned (All Time)
                    </span>
                    <span className="font-heading text-base text-forge-primary">
                      ${formatUSD(crucible.apyEarnedByUsers || 0)}
                    </span>
                  </div>
                </div>

                {/* Simplified CTA Buttons - Only Open and Close */}
                <div className="space-y-2">
                  {/* Primary Open Position Button */}
                  <button
                    onClick={() => {
                      setSelectedCrucible(crucible.id)
                      if (isInferno) {
                        setShowInfernoLPModal(true)
                      } else {
                        setShowCTokenDepositModal(true)
                      }
                    }}
                    className="w-full font-heading py-3 rounded-xl transition-all duration-300 transform hover:scale-[1.02] hover:shadow-forge-lg group relative overflow-hidden border bg-gradient-to-r from-forge-primary via-forge-primary-light to-forge-primary hover:from-forge-primary-dark hover:via-forge-primary hover:to-forge-primary-light text-white border-forge-primary/20"
                  >
                    <div className="absolute inset-0 bg-gradient-to-r from-white/0 via-white/10 to-white/0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 animate-pulse-glow"></div>
                    <div className="relative flex items-center justify-center">
                      <span className="text-sm font-semibold">
                        Open Position
                      </span>
                    </div>
                  </button>

                  {/* Close Position Button */}
                  <CrucibleCloseButton
                    crucible={crucible}
                    onOpenCloseModal={() => {
                      setSelectedCrucible(crucible.id)
                      setShowClosePositionModal(true)
                    }}
                  />
                </div>

                {/* Yield Projections */}
                <div className="mt-3 pt-3 border-t border-forge-gray-700">
                  <LeveragedProjectionChart
                    baseAPY={crucible.apr * 100}
                    leverage={selectedLeverage[crucible.id] || 1.0}
                    currentPrice={solPrice}
                    currentExchangeRate={(() => {
                      // Initial exchange rate is 1.0 (grows as fees accumulate in vault)
                      const initialExchangeRate = 1.0
                      const isInfernoLocal = crucible.id === 'inferno-lp-crucible'
                      const hasDeposits = isInfernoLocal 
                        ? (crucible.tvl || 0) > 0
                        : (crucible.totalWrapped || BigInt(0)) > BigInt(0)
                      const exchangeRate = hasDeposits 
                        ? Number(crucible.exchangeRate || RATE_SCALE) / Number(RATE_SCALE)
                        : initialExchangeRate
                      return exchangeRate
                    })()}
                    baseTokenSymbol={crucible.baseToken}
                    showLpSeries={!isSolCrucible}
                    showCTokenSeries={!isInferno}
                  />
                </div>

                {!isSolCrucible && (
                  <CrucibleLeveragedPositions
                    crucible={crucible}
                  />
                )}
              </div>
            </div>
            )
            })}
            </div>
          </div>
        </div>
      )}

      {/* Modals */}
      {selectedCrucible && (() => {
        const crucible = crucibles.find(c => c.id === selectedCrucible)
        if (!crucible) return null
        
        return (
          <>
            <CTokenDepositModal
              isOpen={showCTokenDepositModal}
              onClose={() => {
                setShowCTokenDepositModal(false)
                setSelectedCrucible(null)
              }}
              crucibleAddress={selectedCrucible}
              ctokenMint={crucible.ptokenMint || 'mock-ctoken-mint'}
              baseTokenSymbol={crucible.baseToken}
              ctokenSymbol={crucible.ptokenSymbol}
              currentAPY={crucible.apr * 100}
            />
            <CTokenWithdrawModal
              isOpen={showCTokenWithdrawModal}
              onClose={() => {
                setShowCTokenWithdrawModal(false)
                setSelectedCrucible(null)
              }}
              crucibleAddress={selectedCrucible}
              ctokenMint={crucible.ptokenMint || 'mock-ctoken-mint'}
              baseTokenSymbol={crucible.baseToken}
              ctokenSymbol={crucible.ptokenSymbol}
              currentBalance={crucible.userPtokenBalance ? BigInt(crucible.userPtokenBalance.toString()) : null}
              exchangeRate={(() => {
                // Initial exchange rate is 1.0 (grows as fees accumulate in vault)
                const initialExchangeRate = 1.0
                const isInfernoLocal = crucible.id === 'inferno-lp-crucible'
                const hasDeposits = isInfernoLocal 
                  ? (crucible.tvl || 0) > 0
                  : (crucible.totalWrapped || BigInt(0)) > BigInt(0)
                const exchangeRate = hasDeposits 
                  ? Number(crucible.exchangeRate || RATE_SCALE) / Number(RATE_SCALE)
                  : initialExchangeRate
                return exchangeRate
              })()}
            />
            <LVFPositionModal
              isOpen={showLVFModal}
              onClose={() => {
                setShowLVFModal(false)
                setSelectedCrucible(null)
              }}
              crucibleAddress={selectedCrucible}
              baseTokenSymbol={crucible.baseToken}
              baseAPY={crucible.apr * 100}
            />
            <LPPositionModal
              isOpen={showLPModal}
              onClose={() => {
                setShowLPModal(false)
                setSelectedCrucible(null)
              }}
              crucibleAddress={selectedCrucible}
              baseTokenSymbol={crucible.baseToken as 'SOL'}
              baseAPY={crucible.apr * 100}
            />
            <InfernoLPPositionModal
              isOpen={showInfernoLPModal}
              onClose={() => {
                setShowInfernoLPModal(false)
                setSelectedCrucible(null)
              }}
              crucibleAddress={selectedCrucible}
              baseTokenSymbol={crucible.baseToken as 'SOL'}
              baseAPY={crucible.apr * 100}
            />
            <ClosePositionModal
              isOpen={showClosePositionModal}
              onClose={() => {
                setShowClosePositionModal(false)
                setSelectedCrucible(null)
              }}
              crucibleAddress={selectedCrucible || ''}
              baseTokenSymbol={crucible.baseToken}
              ctokenSymbol={crucible.ptokenSymbol}
              hasCTokenPosition={crucible.userPtokenBalance !== BigInt(0)}
              hasLeveragedPosition={(() => {
                // We need to check leveraged positions from the hook, but we can't call hooks conditionally
                // So we'll let the modal handle this internally
                return false // Will be calculated inside modal
              })()}
            />
          </>
        )
      })()}
    </div>
  )
}

// Component for action buttons
function CrucibleActionButtons({ 
  crucible, 
  onMintCToken, 
  onOpenLeverage,
  onOpenInferno,
}: { 
  crucible: Crucible
  onMintCToken: () => void
  onOpenLeverage: () => void
  onOpenInferno: () => void
}) {
  return (
    <div className="space-y-2">
      {/* Primary Open Position Button */}
      <button
        onClick={onMintCToken}
        className="w-full bg-gradient-to-r from-forge-primary to-forge-accent hover:from-forge-primary/90 hover:to-forge-accent/90 text-white font-heading py-3 rounded-xl transition-all duration-300 transform hover:scale-[1.02] hover:shadow-lg hover:shadow-forge-primary/25 group relative overflow-hidden"
      >
        <div className="absolute inset-0 bg-gradient-to-r from-white/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
        <div className="relative flex items-center justify-center">
          <span className="text-base">Mint cToken</span>
        </div>
      </button>
      
      {/* Leveraged Position Button */}
      <button
        onClick={onOpenLeverage}
        className="w-full bg-gradient-to-r from-orange-500/20 to-yellow-500/20 hover:from-orange-500/30 hover:to-yellow-500/30 border border-orange-500/30 hover:border-orange-500/50 text-orange-400 font-heading py-3 rounded-xl transition-all duration-300 transform hover:scale-[1.02] hover:shadow-lg hover:shadow-orange-500/25 group relative overflow-hidden"
      >
        <div className="absolute inset-0 bg-gradient-to-r from-white/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
        <div className="relative flex items-center justify-center">
          <span className="text-base">Open Leveraged Position</span>
        </div>
      </button>

      {/* Inferno LP Button */}
      <button
        onClick={onOpenInferno}
        className="w-full bg-gradient-to-r from-red-500/20 to-orange-500/20 hover:from-red-500/30 hover:to-orange-500/30 border border-red-500/30 hover:border-red-500/50 text-red-400 font-heading py-3 rounded-xl transition-all duration-300 transform hover:scale-[1.02] hover:shadow-lg hover:shadow-red-500/25 group relative overflow-hidden"
      >
        <div className="absolute inset-0 bg-gradient-to-r from-white/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
        <div className="relative flex items-center justify-center">
          <span className="text-base">Open Position</span>
        </div>
      </button>
    </div>
  )
}

// Component for Close Position Button that opens the unified modal
function CrucibleCloseButton({
  crucible,
  onOpenCloseModal,
}: {
  crucible: CrucibleData
  onOpenCloseModal: () => void
}) {
  const { connected, publicKey } = useWallet()
  // Hooks must be called unconditionally (React rules)
  // They will return empty arrays if wallet not connected, which is fine
  const { positions: leveragedPositions, refetch: refetchLVF } = useLVFPosition({
    crucibleAddress: crucible.id,
    baseTokenSymbol: crucible.baseToken,
  })
  
  const { positions: lpPositions, refetch: refetchLP } = useLP({
    crucibleAddress: crucible.id,
    baseTokenSymbol: crucible.baseToken,
    baseAPY: crucible.apr,
  })

  const { positions: infernoPositions, refetch: refetchInferno } = useInfernoLP({
    crucibleAddress: crucible.id,
    baseTokenSymbol: crucible.baseToken,
    baseAPY: crucible.apr,
  })
  
  // Store refetch functions in refs to avoid dependency issues
  const refetchLVFRef = React.useRef(refetchLVF)
  const refetchLPRef = React.useRef(refetchLP)
  const refetchInfernoRef = React.useRef(refetchInferno)

  // Update refs when refetch functions change
  React.useEffect(() => {
    refetchLVFRef.current = refetchLVF
    refetchLPRef.current = refetchLP
    refetchInfernoRef.current = refetchInferno
  }, [refetchLVF, refetchLP, refetchInferno])

  // Refetch positions when component mounts or when crucible changes
  React.useEffect(() => {
    refetchLVFRef.current()
    refetchLPRef.current()
    refetchInfernoRef.current()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [crucible.id, crucible.baseToken])

  // Listen for position opened events to force immediate refetch
  React.useEffect(() => {
    const handlePositionOpened = (event: CustomEvent) => {
      const detail = event.detail
      if (detail?.crucibleAddress === crucible.id && detail?.baseTokenSymbol === crucible.baseToken) {
        // Force immediate refetch using refs
        setTimeout(() => {
          refetchLVFRef.current()
          refetchLPRef.current()
        refetchInfernoRef.current()
        }, 100)
      }
    }
    
    window.addEventListener('lvfPositionOpened', handlePositionOpened as EventListener)
    window.addEventListener('lpPositionOpened', handlePositionOpened as EventListener)
    window.addEventListener('infernoLpPositionOpened', handlePositionOpened as EventListener)
    window.addEventListener('infernoLpPositionClosed', handlePositionOpened as EventListener)
    
    return () => {
      window.removeEventListener('lvfPositionOpened', handlePositionOpened as EventListener)
      window.removeEventListener('lpPositionOpened', handlePositionOpened as EventListener)
      window.removeEventListener('infernoLpPositionOpened', handlePositionOpened as EventListener)
      window.removeEventListener('infernoLpPositionClosed', handlePositionOpened as EventListener)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [crucible.id, crucible.baseToken])
  
  const hasCTokenPosition = crucible.userPtokenBalance !== BigInt(0)
  // Check isOpen explicitly, treating undefined as open (for backwards compatibility)
  const hasLeveragedPosition = leveragedPositions.some(p => p.isOpen === true || p.isOpen === undefined)
  const hasLPPosition = lpPositions.some(p => p.isOpen === true || p.isOpen === undefined)
  const hasInfernoPosition = infernoPositions.some(p => p.isOpen === true || p.isOpen === undefined)
  const hasAnyPosition = hasCTokenPosition || hasLeveragedPosition || hasLPPosition || hasInfernoPosition
  const canClose = connected && !!publicKey && hasAnyPosition

  const handleClose = () => {
    if (!connected || !publicKey) {
      alert('⚠️ Wallet not connected!\n\nPlease connect your wallet first.')
      return
    }
    // Simply open the unified close position modal
    onOpenCloseModal()
  }

  return (
    <button
      onClick={handleClose}
      disabled={!canClose}
      className={`w-full py-3 rounded-xl font-heading transition-all duration-300 transform hover:scale-[1.02] hover:shadow-lg flex items-center justify-center space-x-2 border relative overflow-hidden group ${
        !canClose
          ? 'bg-forge-gray-900 text-forge-gray-500 border-forge-gray-800 cursor-not-allowed opacity-50'
          : hasInfernoPosition
          ? 'bg-gradient-to-r from-red-500/20 to-orange-500/20 hover:from-red-500/30 hover:to-orange-500/30 text-red-400 border-red-500/30 hover:border-red-500/50'
          : hasLeveragedPosition
          ? 'bg-gradient-to-r from-orange-500/20 to-orange-600/20 hover:from-orange-500/30 hover:to-orange-600/30 text-orange-400 border-orange-500/30 hover:border-orange-500/50'
          : hasLPPosition
          ? 'bg-gradient-to-r from-green-500/20 to-green-600/20 hover:from-green-500/30 hover:to-green-600/30 text-green-400 border-green-500/30 hover:border-green-500/50'
          : 'bg-gradient-to-r from-forge-gray-800 to-forge-gray-700 hover:from-forge-gray-700 hover:to-forge-gray-600 text-white border-forge-gray-600 hover:border-forge-gray-500'
      }`}
    >
      <div className="absolute inset-0 bg-gradient-to-r from-forge-gray-700/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none"></div>
      <div className="relative flex items-center justify-center">
        <span className="text-sm font-semibold">
          Close Position
        </span>
      </div>
    </button>
  )
}

// Component for displaying leveraged positions
function CrucibleLeveragedPositions({
  crucible,
}: {
  crucible: Crucible
}) {
  const { positions } = useLVFPosition({
    crucibleAddress: crucible.id,
    baseTokenSymbol: crucible.baseToken,
  })

  if (positions.length === 0) return null

  return (
    <div className="mt-4 pt-4 border-t border-orange-500/20">
      <div className="flex items-center gap-3 mb-3">
        <h3 className="text-base font-heading text-white">My Leveraged Positions</h3>
        <span className="px-2 py-0.5 bg-orange-500/20 text-orange-400 text-[11px] font-bold rounded-full">
          {positions.length}
        </span>
      </div>
      <div className="space-y-2">
        {positions.map((position) => (
          <LVFPositionCard
            key={position.id}
            position={position}
            crucibleAddress={crucible.id}
            baseTokenSymbol={crucible.baseToken}
            baseAPY={crucible.apr * 100}
            onClose={() => {
              // Position will be removed from list after close
            }}
          />
        ))}
      </div>
    </div>
  )
}
