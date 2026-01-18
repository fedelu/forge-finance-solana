import React, { useState } from 'react'
import { 
  ArrowUpIcon, 
  ArrowDownIcon,
  ChartBarIcon,
  BoltIcon,
  FireIcon
} from '@heroicons/react/24/outline'
import { useWallet } from '../contexts/WalletContext'
import { usePrice } from '../contexts/PriceContext'
import { useCrucible, CrucibleData } from '../hooks/useCrucible'
import { useBalance } from '../contexts/BalanceContext'
import CTokenDepositModal from './CTokenDepositModal'
import CTokenWithdrawModal from './CTokenWithdrawModal'
import ClosePositionModal from './ClosePositionModal'
import LeveragedProjectionChart from './LeveragedProjectionChart'
import LVFPositionModal from './LVFPositionModal'
import LVFPositionCard from './LVFPositionCard'
import LPPositionModal from './LPPositionModal'
import { useCToken } from '../hooks/useCToken'
import { useLeverage } from '../hooks/useLeverage'
import { useLVFPosition } from '../hooks/useLVFPosition'
import { useLP } from '../hooks/useLP'
import { formatNumberWithCommas, getCTokenPrice, RATE_SCALE } from '../utils/math'

// Use CrucibleData from useCrucible hook instead of defining separate interface
type Crucible = CrucibleData

interface CrucibleManagerProps {
  className?: string
  onDeposit?: (crucibleId: string, amount: number) => void
  onWithdraw?: (crucibleId: string, amount: number) => void
  isConnected?: boolean
}

export default function CrucibleManager({ className = '', onDeposit, onWithdraw, isConnected = false }: CrucibleManagerProps) {
  const { solPrice } = usePrice()
  const { connected } = useWallet()
  const { crucibles, loading, error } = useCrucible()
  const [activeMode, setActiveMode] = useState<'wrap' | 'lp' | 'leveraged'>('wrap')
  const [selectedCrucible, setSelectedCrucible] = useState<string | null>(null)
  const [showCTokenDepositModal, setShowCTokenDepositModal] = useState(false)
  const [showCTokenWithdrawModal, setShowCTokenWithdrawModal] = useState(false)
  const [showClosePositionModal, setShowClosePositionModal] = useState(false)
  const [showLPModal, setShowLPModal] = useState(false)
  const [showLVFModal, setShowLVFModal] = useState(false)
  const [selectedLeverage, setSelectedLeverage] = useState<{ [key: string]: number }>({})
  const [effectiveAPY, setEffectiveAPY] = useState<{ [key: string]: number }>({})

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
    <div className={`space-y-6 ${className} pb-12`}>
      {/* Crucible Stats - Compact */}
      <div className="flex justify-center mb-8">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 w-full max-w-6xl">
        <div className="panel rounded-xl p-4 hover:border-forge-primary/40 transition-all duration-300 group">
            <div className="text-center">
              <div className="w-10 h-10 bg-gradient-to-br from-forge-primary/20 to-forge-primary/10 rounded-xl flex items-center justify-center mx-auto mb-2 group-hover:scale-110 transition-transform duration-300">
                <ChartBarIcon className="h-5 w-5 text-forge-primary" />
              </div>
              <p className="text-forge-gray-300 text-xs font-satoshi font-medium mb-1">Total TVL</p>
              <p className="text-2xl font-heading font-semibold text-white group-hover:text-forge-primary transition-colors duration-300">
                ${crucibles.reduce((sum, c) => sum + c.tvl, 0).toLocaleString()}
              </p>
            </div>
          </div>

          <div className="panel rounded-xl p-4 hover:border-forge-accent/40 transition-all duration-300 group">
            <div className="text-center">
              <div className="w-10 h-10 bg-gradient-to-br from-forge-accent/20 to-forge-accent/10 rounded-xl flex items-center justify-center mx-auto mb-2 group-hover:scale-110 transition-transform duration-300">
                <BoltIcon className="h-5 w-5 text-forge-accent" />
              </div>
              <p className="text-forge-gray-300 text-xs font-satoshi font-medium mb-1">Total Yield Earned (All Time)</p>
              <p className="text-2xl font-heading font-semibold text-white group-hover:text-forge-accent transition-colors duration-300">
                ${(() => {
                  // Calculate ALL TIME yield earned: totalFeesAccrued (80% vault share of all fees)
                  // This represents all yield generated from fees, regardless of withdrawals
                  return crucibles.reduce((sum, c) => {
                    const allTimeYield = c.apyEarnedByUsers || 0; // This is totalFeesAccrued in USD
                    return sum + allTimeYield;
                  }, 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                })()}
              </p>
            </div>
          </div>

          <div className="panel rounded-xl p-4 hover:border-forge-primary/40 transition-all duration-300 group">
            <div className="text-center">
              <div className="w-10 h-10 bg-gradient-to-br from-forge-primary/20 to-forge-primary/10 rounded-xl flex items-center justify-center mx-auto mb-2 group-hover:scale-110 transition-transform duration-300">
                <FireIcon className="h-5 w-5 text-forge-primary" />
              </div>
              <p className="text-forge-gray-300 text-xs font-satoshi font-medium mb-1">Total Transaction Fees</p>
              <p className="text-2xl font-heading font-semibold text-white group-hover:text-forge-primary transition-colors duration-300">
                ${crucibles.reduce((sum, c) => sum + (c.totalFeesCollected || 0), 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
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
        <div className="space-y-6">
          <div className="text-center space-y-2">
            <h2 className="text-3xl md:text-4xl font-heading text-white mb-2 bg-gradient-to-r from-forge-primary via-forge-primary-light to-forge-secondary bg-clip-text text-transparent">
              Available Crucibles
            </h2>
            <p className="text-forge-gray-300 text-base font-sans leading-relaxed max-w-2xl mx-auto">
              Crucibles are on-chain yield engines. Wrap your tokens for steady APY, provide liquidity for amplified rewards, or enter Inferno Mode to leverage your position and maximize returns.
            </p>
          </div>
          <div className="flex justify-center">
            <div className="grid grid-cols-1 gap-8 max-w-2xl w-full">
            {crucibles.map((crucible) => (
            <div key={crucible.id} className="panel rounded-3xl p-7 border border-forge-gray-600/50 hover:border-forge-primary/60 shadow-2xl hover:shadow-forge-lg transition-all duration-500 hover:scale-[1.02] group relative overflow-hidden animate-fade-in">
              {/* Background Pattern with better gradient */}
              <div className="absolute inset-0 bg-gradient-to-br from-forge-primary/10 via-transparent to-forge-secondary/10 opacity-0 group-hover:opacity-100 transition-opacity duration-700"></div>
              {/* Animated border glow */}
              <div className="absolute inset-0 rounded-3xl bg-gradient-to-r from-forge-primary/0 via-forge-primary/20 to-forge-primary/0 opacity-0 group-hover:opacity-100 transition-opacity duration-700 -z-10 blur-xl"></div>
              <div className="relative z-10">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center space-x-3">
                    <div className="w-14 h-14 bg-gradient-to-br from-forge-primary/30 to-forge-accent/30 rounded-2xl flex items-center justify-center group-hover:from-forge-primary/40 group-hover:to-forge-accent/40 transition-all duration-500 shadow-lg group-hover:shadow-forge-primary/20">
                      {crucible.icon.startsWith('/') ? (
                        <img 
                          src={crucible.icon} 
                          alt={`${crucible.name} icon`} 
                          className="h-9 w-9 object-contain group-hover:scale-110 transition-transform duration-300"
                        />
                      ) : (
                        <span className="text-2xl group-hover:scale-110 transition-transform duration-300">{crucible.icon}</span>
                      )}
                    </div>
                    <div>
                      <h3 className="text-2xl font-heading text-white group-hover:text-forge-primary transition-colors duration-300 mb-1">{crucible.name}</h3>
                      <p className="text-forge-gray-300 text-sm font-medium">{crucible.baseToken} → {crucible.ptokenSymbol}</p>
                    </div>
                  </div>
                  <span className={`px-3 py-1.5 rounded-full text-xs font-bold ${getStatusColor(crucible.status)} shadow-lg`}>
                    {crucible.status.toUpperCase()}
                  </span>
                </div>
                <div className="space-y-3 text-sm font-satoshi-light text-forge-gray-200 mb-6">
                  <div className="flex justify-between items-center py-3.5 px-4 panel-muted backdrop-blur-sm rounded-xl border border-forge-gray-700/50 hover:border-forge-primary/30 transition-all duration-300">
                    <span className="text-forge-gray-400 font-medium text-sm flex items-center gap-2">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      TVL
                    </span>
                    <span className="font-heading text-lg text-white">${crucible.tvl.toLocaleString()}</span>
                  </div>
                  {/* APY Display */}
                  <div className="space-y-2 py-3.5 px-4 panel-muted backdrop-blur-sm rounded-xl border border-forge-gray-700/50">
                    <div className="flex justify-between items-center">
                      <span className="text-forge-gray-300 font-medium text-sm">Base APY (Mint):</span>
                      <span className="font-heading text-lg text-forge-accent">{(crucible.apr * 100).toFixed(1)}%</span>
                    </div>
                    <div className="pt-2 border-t border-forge-gray-700/50">
                      <div className="flex justify-between items-center">
                        <span className="text-forge-gray-400 text-xs flex items-center">
                          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" aria-hidden="true" data-slot="icon" className="h-3 w-3 mr-1 text-orange-400">
                            <path strokeLinecap="round" strokeLinejoin="round" d="m3.75 13.5 10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75Z" />
                          </svg>
                          Leveraged APY (1.5x):
                        </span>
                        <span className="text-orange-400 text-sm font-heading">
                          {((crucible.apr * 100) * 1.5 - 10 * 0.5).toFixed(1)}%
                        </span>
                      </div>
                      <div className="flex justify-between items-center mt-1">
                        <span className="text-forge-gray-400 text-xs flex items-center">
                          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" aria-hidden="true" data-slot="icon" className="h-3 w-3 mr-1 text-orange-400">
                            <path strokeLinecap="round" strokeLinejoin="round" d="m3.75 13.5 10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75Z" />
                          </svg>
                          Leveraged APY (2x):
                        </span>
                        <span className="text-orange-400 text-sm font-heading">
                          {((crucible.apr * 100) * 2.0 - 10 * 1.0).toFixed(1)}%
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="flex justify-between items-center py-3.5 px-4 panel-muted backdrop-blur-sm rounded-xl border border-forge-gray-700/50 hover:border-forge-primary/30 transition-all duration-300">
                    <span className="text-forge-gray-400 font-medium text-sm flex items-center gap-2">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
                      </svg>
                      cTOKEN Price
                    </span>
                    <span className="font-heading text-lg text-forge-primary">
                      {(() => {
                        // Calculate exchange rate: 1 cToken = exchangeRate base tokens
                        // Initial exchange rate is 1.0 (grows as fees accumulate in vault)
                        // If there are deposits, use actual exchange rate; otherwise use initial rate
                        const hasDeposits = (crucible.totalWrapped || BigInt(0)) > BigInt(0);
                        const initialExchangeRate = RATE_SCALE; // 1.0 = 1_000_000
                        const exchangeRate = hasDeposits 
                          ? (crucible.exchangeRate || initialExchangeRate)
                          : initialExchangeRate;
                        const exchangeRateDecimal = Number(exchangeRate) / Number(RATE_SCALE);
                        return `${exchangeRateDecimal.toFixed(4)} ${crucible.baseToken}`;
                      })()}
                    </span>
                  </div>
                  <div className="flex justify-between items-center py-3.5 px-4 panel-muted backdrop-blur-sm rounded-xl border border-forge-gray-700/50 hover:border-forge-primary/30 transition-all duration-300">
                    <span className="text-forge-gray-400 font-medium text-sm flex items-center gap-2">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                      </svg>
                      Total Yield Earned (All Time)
                    </span>
                    <span className="font-heading text-lg text-forge-primary">
                      ${(() => {
                        // Calculate ALL TIME yield earned: totalFeesAccrued (80% vault share of all fees)
                        // This represents all yield generated from fees, regardless of withdrawals
                        const allTimeYield = crucible.apyEarnedByUsers || 0; // This is totalFeesAccrued in USD
                        return allTimeYield.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                      })()}
                    </span>
                  </div>
                </div>

                {/* Simplified CTA Buttons - Only Open and Close */}
                <div className="space-y-3">
                  {/* Primary Open Position Button */}
                  <button
                    onClick={() => {
                      setSelectedCrucible(crucible.id)
                      setShowCTokenDepositModal(true)
                    }}
                    className="w-full bg-gradient-to-r from-forge-primary via-forge-primary-light to-forge-primary hover:from-forge-primary-dark hover:via-forge-primary hover:to-forge-primary-light text-white font-heading py-4 rounded-xl transition-all duration-300 transform hover:scale-[1.02] hover:shadow-forge-lg group relative overflow-hidden border border-forge-primary/20"
                  >
                    <div className="absolute inset-0 bg-gradient-to-r from-white/0 via-white/10 to-white/0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 animate-pulse-glow"></div>
                    <div className="relative flex items-center justify-center space-x-3">
                      <ArrowUpIcon className="h-5 w-5 group-hover:scale-110 transition-transform duration-300" />
                      <span className="text-base font-semibold">Open Position</span>
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

                {/* Leveraged Yield Projections */}
                <div className="mt-4 pt-4 border-t border-forge-gray-700">
                  <LeveragedProjectionChart
                    baseAPY={crucible.apr * 100}
                    leverage={selectedLeverage[crucible.id] || 1.0}
                    currentPrice={solPrice}
                    currentExchangeRate={(() => {
                      // Initial exchange rate is 1.0 (grows as fees accumulate in vault)
                      const initialExchangeRate = 1.0
                      const hasDeposits = (crucible.totalWrapped || BigInt(0)) > BigInt(0)
                      const exchangeRate = hasDeposits 
                        ? Number(crucible.exchangeRate || RATE_SCALE) / Number(RATE_SCALE)
                        : initialExchangeRate
                      return exchangeRate
                    })()}
                    baseTokenSymbol={crucible.baseToken}
                  />
                </div>

                {/* Active Leveraged Positions - Enhanced */}
                <CrucibleLeveragedPositions
                  crucible={crucible}
                />
              </div>
            </div>
            ))}
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
                const hasDeposits = (crucible.totalWrapped || BigInt(0)) > BigInt(0)
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
  onOpenLeverage 
}: { 
  crucible: Crucible
  onMintCToken: () => void
  onOpenLeverage: () => void
}) {
  return (
    <div className="space-y-2">
      {/* Primary Open Position Button */}
      <button
        onClick={onMintCToken}
        className="w-full bg-gradient-to-r from-forge-primary to-forge-accent hover:from-forge-primary/90 hover:to-forge-accent/90 text-white font-heading py-3 rounded-xl transition-all duration-300 transform hover:scale-[1.02] hover:shadow-lg hover:shadow-forge-primary/25 group relative overflow-hidden"
      >
        <div className="absolute inset-0 bg-gradient-to-r from-white/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
        <div className="relative flex items-center justify-center space-x-2">
          <ArrowUpIcon className="h-5 w-5 group-hover:scale-110 transition-transform duration-300" />
          <span className="text-base">Mint cToken</span>
        </div>
      </button>
      
      {/* Leveraged Position Button */}
      <button
        onClick={onOpenLeverage}
        className="w-full bg-gradient-to-r from-orange-500/20 to-yellow-500/20 hover:from-orange-500/30 hover:to-yellow-500/30 border border-orange-500/30 hover:border-orange-500/50 text-orange-400 font-heading py-3 rounded-xl transition-all duration-300 transform hover:scale-[1.02] hover:shadow-lg hover:shadow-orange-500/25 group relative overflow-hidden"
      >
        <div className="absolute inset-0 bg-gradient-to-r from-white/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
        <div className="relative flex items-center justify-center space-x-2">
          <BoltIcon className="h-5 w-5 group-hover:scale-110 transition-transform duration-300" />
          <span className="text-base">Open Leveraged Position</span>
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
  
  // Store refetch functions in refs to avoid dependency issues
  const refetchLVFRef = React.useRef(refetchLVF)
  const refetchLPRef = React.useRef(refetchLP)

  // Update refs when refetch functions change
  React.useEffect(() => {
    refetchLVFRef.current = refetchLVF
    refetchLPRef.current = refetchLP
  }, [refetchLVF, refetchLP])

  // Refetch positions when component mounts or when crucible changes
  React.useEffect(() => {
    refetchLVFRef.current()
    refetchLPRef.current()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [crucible.id, crucible.baseToken])

  // Listen for position opened events to force immediate refetch
  React.useEffect(() => {
    const handlePositionOpened = (event: CustomEvent) => {
      const detail = event.detail
      if (detail?.crucibleAddress === crucible.id && detail?.baseTokenSymbol === crucible.baseToken) {
        console.log('🔄 Position opened event detected in CrucibleCloseButton, refetching positions...', detail)
        // Force immediate refetch using refs
        setTimeout(() => {
          refetchLVFRef.current()
          refetchLPRef.current()
        }, 100)
      }
    }
    
    window.addEventListener('lvfPositionOpened', handlePositionOpened as EventListener)
    window.addEventListener('lpPositionOpened', handlePositionOpened as EventListener)
    
    return () => {
      window.removeEventListener('lvfPositionOpened', handlePositionOpened as EventListener)
      window.removeEventListener('lpPositionOpened', handlePositionOpened as EventListener)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [crucible.id, crucible.baseToken])
  
  const hasCTokenPosition = crucible.userPtokenBalance !== BigInt(0)
  // Check isOpen explicitly, treating undefined as open (for backwards compatibility)
  const hasLeveragedPosition = leveragedPositions.some(p => p.isOpen === true || p.isOpen === undefined)
  const hasLPPosition = lpPositions.some(p => p.isOpen === true || p.isOpen === undefined)
  const hasAnyPosition = hasCTokenPosition || hasLeveragedPosition || hasLPPosition

  // Debug logging
  React.useEffect(() => {
    console.log('🔍 CrucibleCloseButton state:', {
      crucible: crucible.id,
      hasCTokenPosition,
      hasLeveragedPosition,
      hasLPPosition,
      hasAnyPosition,
      leveragedPositionsCount: leveragedPositions.length,
      lpPositionsCount: lpPositions.length,
      leveragedPositions: leveragedPositions.map(p => ({ 
        id: p.id, 
        isOpen: p.isOpen, 
        token: p.token,
        owner: p.owner?.substring(0, 8) + '...' 
      })),
      lpPositions: lpPositions.map(p => ({ 
        id: p.id, 
        isOpen: p.isOpen, 
        baseToken: p.baseToken,
        owner: p.owner?.substring(0, 8) + '...' 
      }))
    })
  }, [crucible.id, hasCTokenPosition, hasLeveragedPosition, hasLPPosition, hasAnyPosition, leveragedPositions, lpPositions])

  const handleClose = () => {
    // Simply open the unified close position modal
    onOpenCloseModal()
  }

  return (
    <button
      onClick={handleClose}
      disabled={!hasAnyPosition}
      className={`w-full py-4 rounded-xl font-heading transition-all duration-300 transform hover:scale-[1.02] hover:shadow-lg flex items-center justify-center space-x-3 border relative overflow-hidden group ${
        !hasAnyPosition
          ? 'bg-forge-gray-900 text-forge-gray-500 border-forge-gray-800 cursor-not-allowed opacity-50'
          : hasLeveragedPosition
          ? 'bg-gradient-to-r from-orange-500/20 to-orange-600/20 hover:from-orange-500/30 hover:to-orange-600/30 text-orange-400 border-orange-500/30 hover:border-orange-500/50'
          : hasLPPosition
          ? 'bg-gradient-to-r from-green-500/20 to-green-600/20 hover:from-green-500/30 hover:to-green-600/30 text-green-400 border-green-500/30 hover:border-green-500/50'
          : 'bg-gradient-to-r from-forge-gray-800 to-forge-gray-700 hover:from-forge-gray-700 hover:to-forge-gray-600 text-white border-forge-gray-600 hover:border-forge-gray-500'
      }`}
    >
      <div className="absolute inset-0 bg-gradient-to-r from-forge-gray-700/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none"></div>
      <div className="relative flex items-center justify-center space-x-2">
        <ArrowDownIcon className="h-5 w-5 group-hover:scale-110 transition-transform duration-300" />
        <span className="text-base font-semibold">
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
    <div className="mt-6 pt-6 border-t border-orange-500/20">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-8 h-8 rounded-lg bg-orange-500/20 flex items-center justify-center">
          <BoltIcon className="w-4 h-4 text-orange-400" />
        </div>
        <h3 className="text-lg font-heading text-white">My Leveraged Positions</h3>
        <span className="px-2 py-1 bg-orange-500/20 text-orange-400 text-xs font-bold rounded-full">
          {positions.length}
        </span>
      </div>
      <div className="space-y-3">
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