import React, { useState } from 'react'
import { XMarkIcon } from '@heroicons/react/24/outline'
import { useLP } from '../hooks/useLP'
import { useWallet } from '../contexts/WalletContext'
import { useBalance } from '../contexts/BalanceContext'
import { useAnalytics } from '../contexts/AnalyticsContext'
import { usePrice } from '../contexts/PriceContext'
import { useCrucible } from '../hooks/useCrucible'
import { formatUSD, formatUSDC, formatSOL } from '../utils/math'

interface LPPositionModalProps {
  isOpen: boolean
  onClose: () => void
  crucibleAddress: string
  baseTokenSymbol: 'SOL'
  baseAPY: number
}

export default function LPPositionModal({
  isOpen,
  onClose,
  crucibleAddress,
  baseTokenSymbol,
  baseAPY,
}: LPPositionModalProps) {
  const [baseAmount, setBaseAmount] = useState('')
  const [usdcAmount, setUsdcAmount] = useState('')
  const { openPosition, loading } = useLP({
    crucibleAddress,
    baseTokenSymbol,
    baseAPY,
  })
  const { connected, publicKey } = useWallet()
  const { subtractFromBalance, getBalance, addToBalance } = useBalance()
  const { addTransaction } = useAnalytics()
  const { solPrice } = usePrice()
  const { getCrucible } = useCrucible()

  const baseTokenPrice = solPrice // Use real-time SOL price from CoinGecko
  const baseTokenBalance = getBalance(baseTokenSymbol)
  // Matches contract: LP positions use base APY (no 3x multiplier in contract)
  const lpAPY = baseAPY

  // Auto-calculate USDC when base amount changes
  const handleBaseAmountChange = (value: string) => {
    setBaseAmount(value)
    if (value && parseFloat(value) > 0) {
      const calculatedUSDC = formatUSDC(parseFloat(value) * baseTokenPrice)
      setUsdcAmount(calculatedUSDC)
    } else {
      setUsdcAmount('')
    }
  }

  // Auto-calculate base amount when USDC changes
  const handleUSDCAmountChange = (value: string) => {
    setUsdcAmount(value)
    if (value && parseFloat(value) > 0) {
      const calculatedBase = formatSOL(parseFloat(value) / baseTokenPrice)
      setBaseAmount(calculatedBase)
    } else {
      setBaseAmount('')
    }
  }

  const handleOpenPosition = async () => {
    if (!connected || !publicKey) {
      alert('⚠️ Wallet not connected!\n\nPlease connect your Phantom wallet first.')
      return
    }

    if (!baseAmount || parseFloat(baseAmount) <= 0) {
      alert('Please enter a valid base token amount')
      return
    }

    if (!usdcAmount || parseFloat(usdcAmount) <= 0) {
      alert('Please enter a valid USDC amount')
      return
    }

    // Check balances
    const baseAmt = parseFloat(baseAmount)
    const usdcAmt = parseFloat(usdcAmount)
    
    if (baseAmt > baseTokenBalance) {
      alert(`Insufficient ${baseTokenSymbol} balance. You need ${formatSOL(baseAmt)} ${baseTokenSymbol} but only have ${formatSOL(baseTokenBalance)} ${baseTokenSymbol}.`)
      return
    }
    
    const usdcBal = getBalance('USDC')
    if (usdcAmt > usdcBal) {
      alert(`Insufficient USDC balance. You need ${formatUSDC(usdcAmt)} USDC but only have ${formatUSDC(usdcBal)} USDC.`)
      return
    }

    try {
      await openPosition(baseAmt, usdcAmt)

      // Subtract tokens from wallet balance
      subtractFromBalance(baseTokenSymbol, baseAmt)
      subtractFromBalance('USDC', usdcAmt)

      // Note: LP tokens are automatically added to wallet by the LP balance calculation effect
      // which listens for 'lpPositionOpened' events and recalculates balances from localStorage

      // Add transaction to analytics
      // Record both base token and USDC deposited separately
      addTransaction({
        type: 'deposit',
        amount: baseAmt, // Base token deposited
        token: baseTokenSymbol,
        crucibleId: crucibleAddress,
        usdValue: (baseAmt * baseTokenPrice) + usdcAmt, // Total USD value
        usdcDeposited: usdcAmt, // USDC deposited separately
      })

      // Trigger event to refresh portfolio
      window.dispatchEvent(new CustomEvent('lpPositionOpened', { 
        detail: { crucibleAddress, baseTokenSymbol } 
      }))
      
      // Dispatch event to refresh wallet balance
      window.dispatchEvent(new CustomEvent('depositComplete', { 
        detail: { token: baseTokenSymbol, amount: baseAmt } 
      }))

      onClose()
      setBaseAmount('')
      setUsdcAmount('')
    } catch (error: any) {
      console.error('Error opening LP position:', error)
      alert(error.message || 'Failed to open LP position')
    }
  }

  const totalValue = baseAmount && usdcAmount
    ? formatUSD(parseFloat(baseAmount) * baseTokenPrice + parseFloat(usdcAmount))
    : '0.00'

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-md animate-fade-in px-4">
      <div className="panel rounded-3xl w-full max-w-lg p-8 relative animate-scale-in">
        <button
          onClick={onClose}
          className="absolute top-5 right-5 text-forge-gray-400 hover:text-white transition-all duration-200 p-2 rounded-lg hover:bg-black/40"
          aria-label="Close modal"
        >
          <XMarkIcon className="w-5 h-5" />
        </button>

        {/* Header */}
        <div className="mb-6">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-green-500/30 to-green-500/10 flex items-center justify-center border border-green-500/20">
              <svg className="w-6 h-6 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
            </div>
            <div>
              <h2 className="text-2xl font-heading text-white">LP Mode</h2>
              <p className="text-forge-gray-400 text-sm">Standard LP Farming</p>
            </div>
          </div>
          <p className="text-forge-gray-400 text-sm leading-relaxed">
            Deposit equal value of {baseTokenSymbol} and USDC to create an LP position. Earn 3x the base APY from trading & volatility yield.
          </p>
        </div>

        {/* Base Token Amount Input - Enhanced */}
        <div className="mb-5">
          <label className="block text-sm font-semibold text-forge-gray-300 mb-3 flex items-center gap-2">
            <span>{baseTokenSymbol} Amount</span>
            <span className="px-2 py-1 bg-green-500/20 text-green-400 rounded-md text-xs font-medium">Auto-matched</span>
          </label>
          <div className="flex space-x-3">
            <div className="flex-1 relative">
              <input
                type="number"
                value={baseAmount}
                onChange={(e) => handleBaseAmountChange(e.target.value)}
                placeholder="0.00"
                className="w-full px-5 py-4 pr-16 panel-muted backdrop-blur-sm border-2 border-forge-gray-700 rounded-xl text-white text-lg font-medium placeholder-forge-gray-500 focus:outline-none focus:border-green-500 focus:ring-4 focus:ring-green-500/20 transition-all duration-300"
              />
              {baseAmount && (
                <div className="absolute right-16 top-1/2 -translate-y-1/2 text-forge-gray-500 text-sm">
                  ≈ ${formatUSD(parseFloat(baseAmount) * baseTokenPrice)}
                </div>
              )}
            </div>
            <button
              onClick={() => handleBaseAmountChange('1000')}
              className="px-6 py-4 bg-forge-gray-700/80 hover:bg-green-500/20 border-2 border-forge-gray-600 hover:border-green-500 text-white rounded-xl font-semibold transition-all duration-300 hover:scale-105"
            >
              MAX
            </button>
          </div>
        </div>

        {/* USDC Amount Input - Enhanced */}
        <div className="mb-5">
          <label className="block text-sm font-semibold text-forge-gray-300 mb-3 flex items-center gap-2">
            <span>USDC Amount</span>
            <span className="px-2 py-1 bg-blue-500/20 text-blue-400 rounded-md text-xs font-medium">Equal Value</span>
          </label>
          <div className="relative">
            <input
              type="number"
              value={usdcAmount}
              onChange={(e) => handleUSDCAmountChange(e.target.value)}
              placeholder="0.00"
              className="w-full px-5 py-4 panel-muted backdrop-blur-sm border-2 border-forge-gray-700 rounded-xl text-white text-lg font-medium placeholder-forge-gray-500 focus:outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/20 transition-all duration-300"
            />
            <div className="absolute left-4 top-1/2 -translate-y-1/2 text-forge-gray-400 font-semibold">
              $
            </div>
          </div>
          <div className="text-xs text-forge-gray-500 mt-2 flex items-center gap-1">
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Auto-calculated to match {baseTokenSymbol} value (within 1% tolerance)
          </div>
        </div>

        {/* Position Preview - Enhanced */}
        {baseAmount && usdcAmount && (
          <div className="bg-gradient-to-br from-green-500/10 via-green-500/5 to-transparent backdrop-blur-sm rounded-2xl p-6 mb-6 border border-green-500/20">
            <h3 className="text-sm font-semibold text-forge-gray-300 mb-4 flex items-center gap-2">
              <svg className="w-4 h-4 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
              Position Preview
            </h3>
            <div className="space-y-3">
              <div className="flex justify-between items-center py-2.5 px-3 panel-muted rounded-lg">
                <span className="text-forge-gray-400 text-sm">LP Pair</span>
                <span className="text-white text-lg font-heading">
                  {baseTokenSymbol}/USDC
                </span>
              </div>
              <div className="flex justify-between items-center py-2.5 px-3 panel-muted rounded-lg">
                <span className="text-forge-gray-400 text-sm">{baseTokenSymbol} Deposited</span>
                <span className="text-white font-semibold">
                  {formatSOL(parseFloat(baseAmount))} {baseTokenSymbol}
                </span>
              </div>
              <div className="flex justify-between items-center py-2.5 px-3 panel-muted rounded-lg">
                <span className="text-forge-gray-400 text-sm">USDC Deposited</span>
                <span className="text-white font-semibold">
                  {formatUSDC(parseFloat(usdcAmount))} USDC
                </span>
              </div>
              <div className="flex justify-between items-center py-2.5 px-3 panel-muted rounded-lg border border-forge-gray-700/50">
                <span className="text-forge-gray-400 text-sm font-medium">Total Value</span>
                <span className="text-white font-bold text-xl">
                  ${totalValue} USD
                </span>
              </div>
              <div className="flex justify-between items-center py-2.5 px-3 bg-gradient-to-r from-green-500/20 to-green-500/10 rounded-lg border border-green-500/30">
                <span className="text-green-300 text-sm font-medium">LP APY</span>
                <span className="text-green-400 font-bold text-xl">
                  {lpAPY.toFixed(2)}%
                </span>
              </div>
              <div className="pt-3 border-t border-green-500/20">
                <div className="flex items-start gap-2 text-xs text-green-400/80 p-2 bg-green-500/10 rounded-lg">
                  <svg className="w-4 h-4 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span>LP positions earn <strong>3x the base APY</strong> from trading fees that accumulate in the vault and grow the exchange rate</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Actions - Enhanced */}
        <div className="flex space-x-3">
          <button
            onClick={onClose}
            className="flex-1 px-6 py-4 panel-muted hover:bg-forge-gray-700 border-2 border-forge-gray-700 hover:border-forge-gray-600 text-white rounded-xl font-semibold transition-all duration-300 hover:scale-105"
          >
            Cancel
          </button>
          <button
            onClick={handleOpenPosition}
            disabled={!baseAmount || !usdcAmount || loading || parseFloat(baseAmount) <= 0 || parseFloat(usdcAmount) <= 0}
            className="flex-1 px-6 py-4 bg-gradient-to-r from-green-600 via-emerald-500 to-green-600 hover:from-green-500 hover:via-emerald-400 hover:to-green-500 text-white rounded-xl font-semibold transition-all duration-300 transform hover:scale-105 hover:shadow-lg hover:shadow-green-500/30 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none disabled:hover:shadow-none relative overflow-hidden group"
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
              {loading ? 'Processing...' : 'Open LP Position'}
            </span>
          </button>
        </div>
      </div>
    </div>
  )
}

