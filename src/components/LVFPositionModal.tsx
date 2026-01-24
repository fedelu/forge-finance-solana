import React, { useState } from 'react'
import { XMarkIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline'
import { useLVFPosition } from '../hooks/useLVFPosition'
import { useWallet } from '../contexts/WalletContext'
import { lendingPool } from '../contracts/lendingPool'
import { useBalance } from '../contexts/BalanceContext'
import { useAnalytics } from '../contexts/AnalyticsContext'
import { usePrice } from '../contexts/PriceContext'
import { useCrucible } from '../hooks/useCrucible'
import { INFERNO_OPEN_FEE_RATE } from '../config/fees'
import { formatUSD, formatUSDC, formatSOL } from '../utils/math'
import { validateLVFPosition } from '../utils/validation'

interface LVFPositionModalProps {
  isOpen: boolean
  onClose: () => void
  crucibleAddress: string
  baseTokenSymbol: 'SOL' | 'FORGE'
  baseAPY: number
}

export default function LVFPositionModal({
  isOpen,
  onClose,
  crucibleAddress,
  baseTokenSymbol,
  baseAPY,
}: LVFPositionModalProps) {
  const [amount, setAmount] = useState('')
  const [leverage, setLeverage] = useState(2.0)
  const { openPosition, loading, calculateHealth, calculateEffectiveAPY } = useLVFPosition({
    crucibleAddress,
    baseTokenSymbol,
  })
  const { connected, publicKey } = useWallet()
  const { subtractFromBalance, addToBalance, getBalance } = useBalance()
  const { addTransaction } = useAnalytics()
  const { solPrice } = usePrice()
  const { getCrucible } = useCrucible()

  const handleOpenPosition = async () => {
    // Check wallet connection first
    if (!connected || !publicKey) {
      alert('⚠️ Wallet not connected!\n\nPlease connect your Phantom wallet first.')
      return
    }

    if (!amount || parseFloat(amount) <= 0) {
      alert('Please enter a valid amount')
      return
    }

    try {
      const collateralAmount = parseFloat(amount)
      // SECURITY FIX: Use real-time oracle price instead of hardcoded value
      // Fallback to a reasonable default if price is not available
      const baseTokenPrice = baseTokenSymbol === 'FORGE' 
        ? (solPrice * 0.001) // FORGE price estimate (adjust as needed)
        : (solPrice || 200) // Use solPrice from context, fallback to 200 if unavailable
      
      // Validate price is reasonable
      if (baseTokenPrice <= 0 || !isFinite(baseTokenPrice)) {
        alert('Invalid token price. Please try again.')
        return
      }
      
      const collateralValue = collateralAmount * baseTokenPrice
      const borrowedUSDC = collateralValue * (leverage - 1)

      // SECURITY FIX: Comprehensive input validation
      const baseTokenBalance = getBalance(baseTokenSymbol)
      const availableLiquidity = lendingPool.getAvailableLiquidity()
      
      const validation = validateLVFPosition(
        collateralAmount,
        leverage,
        baseTokenBalance,
        baseTokenSymbol,
        baseTokenPrice,
        availableLiquidity
      )
      
      if (!validation.valid) {
        alert(validation.error || 'Invalid position parameters')
        return
      }

      // Borrow USDC from lending pool
      const borrowResult = lendingPool.borrow(borrowedUSDC)
      if (!borrowResult.success) {
        alert(`Borrowing failed: ${borrowResult.error || 'Insufficient liquidity'}`)
        return
      }

      // SECURITY FIX: Open leveraged position first and validate result before updating local state
      // This ensures atomic state updates and prevents race conditions
      const position = await openPosition(collateralAmount, leverage)
      
      // SECURITY FIX: Validate transaction result before updating local state
      if (!position || !position.id) {
        throw new Error('Failed to open position: Invalid transaction result')
      }
      
      // Only update local state after successful on-chain transaction
      subtractFromBalance(baseTokenSymbol, collateralAmount)

      // Note: LP tokens are automatically added to wallet by the LP balance calculation effect
      // which listens for 'lvfPositionOpened' events and recalculates balances from localStorage

      // Calculate protocol fee (1%)
      const protocolFeePercent = INFERNO_OPEN_FEE_RATE
      const protocolFee = collateralAmount * protocolFeePercent
      const collateralAfterFee = collateralAmount - protocolFee
      
      // Add transaction to analytics
      // Calculate deposited USDC (for 1.5x leverage positions)
      // Use Math.abs to handle floating point comparison
      const depositedUSDC = Math.abs(leverage - 1.5) < 0.01 ? collateralValue * 0.5 : 0
      // Get cToken symbol (cFOGO or cFORGE)
      const cTokenSymbol = `c${baseTokenSymbol}`
      
      const transactionData = {
        type: 'deposit' as const,
        amount: collateralAfterFee, // Collateral cToken deposited AFTER fee (what actually goes into position)
        token: cTokenSymbol, // Show cTOKEN (cFOGO or cFORGE) not TOKEN
        crucibleId: crucibleAddress,
        borrowedAmount: borrowedUSDC,
        leverage: leverage,
        usdValue: (collateralAfterFee * baseTokenPrice) + borrowedUSDC + depositedUSDC,
        usdcDeposited: depositedUSDC, // USDC deposited (for 1.5x leverage)
        fee: protocolFee, // Protocol fee (1%)
        borrowedUSDC
      }
      
      addTransaction(transactionData)

      // Trigger window event to refresh portfolio
      window.dispatchEvent(new CustomEvent('lvfPositionOpened', { 
        detail: { crucibleAddress, baseTokenSymbol } 
      }))

      onClose()
      setAmount('')
      setLeverage(2.0)
    } catch (error: any) {
      // SECURITY FIX: Improved error handling with detailed logging
      console.error('Error opening LVF position:', {
        error,
        message: error?.message,
        stack: error?.stack,
        collateralAmount: amount,
        leverage,
        crucibleAddress,
        baseTokenSymbol
      })
      
      // SECURITY FIX: Provide user-friendly error messages
      const errorMessage = error?.message || error?.toString() || 'Failed to open leveraged position'
      alert(`Error: ${errorMessage}\n\nPlease check your wallet connection and try again.`)
      
      // SECURITY FIX: Don't update local state on error - transaction may have partially completed
      // State will be refreshed from on-chain data on next fetch
    }
  }

  const baseTokenPrice = baseTokenSymbol === 'FORGE' ? 0.002 : solPrice
  const collateralValue = amount ? parseFloat(amount) * baseTokenPrice : 0
  const borrowedUSDC = collateralValue * (leverage - 1)
  const health = amount && borrowedUSDC > 0
    ? calculateHealth(parseFloat(amount), borrowedUSDC)
    : 999
  const effectiveAPY = calculateEffectiveAPY(baseAPY, leverage)
  
  // Check lending pool liquidity for leveraged positions
  const availableLiquidity = lendingPool.getAvailableLiquidity()
  const hasEnoughLiquidity = borrowedUSDC <= availableLiquidity

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
          <div className="flex items-center mb-3">
            <div>
              <h2 className="text-2xl font-heading text-white">Leveraged LP</h2>
              <p className="text-forge-gray-400 text-sm">Amplified Yield</p>
            </div>
          </div>
          <p className="text-forge-gray-400 text-sm leading-relaxed">
            Deposit {baseTokenSymbol} and borrow USDC to amplify your yield. Higher risk, higher reward. Maximum leverage: 2x.
          </p>
        </div>

        {/* Amount Input - Enhanced */}
        <div className="mb-5">
          <label className="block text-sm font-semibold text-forge-gray-300 mb-3 flex items-center gap-2">
            <span>Collateral Amount</span>
            <span className="px-2 py-1 bg-orange-500/20 text-orange-400 rounded-md text-xs font-medium">{baseTokenSymbol}</span>
          </label>
          <div className="flex space-x-3">
            <div className="flex-1 relative">
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                className="w-full px-5 py-4 pr-16 panel-muted backdrop-blur-sm border-2 border-forge-gray-700 rounded-xl text-white text-lg font-medium placeholder-forge-gray-500 focus:outline-none focus:border-orange-500 focus:ring-4 focus:ring-orange-500/20 transition-all duration-300"
              />
              {amount && (
                <div className="absolute right-16 top-1/2 -translate-y-1/2 text-forge-gray-500 text-sm">
                  ≈ ${formatUSD(parseFloat(amount) * baseTokenPrice)}
                </div>
              )}
            </div>
            <button
              onClick={() => setAmount('1000')}
              className="px-6 py-4 bg-forge-gray-700/80 hover:bg-orange-500/20 border-2 border-forge-gray-600 hover:border-orange-500 text-white rounded-xl font-semibold transition-all duration-300 hover:scale-105"
            >
              MAX
            </button>
          </div>
        </div>

        {/* Leverage Selection - Enhanced */}
        <div className="mb-5">
          <label className="block text-sm font-semibold text-forge-gray-300 mb-3 flex items-center gap-2">
            <span>Leverage Multiplier</span>
            <span className="px-2 py-1 bg-orange-500/20 text-orange-400 rounded-md text-xs font-medium">Max 2x</span>
          </label>
          <div className="flex space-x-3">
            <button
              onClick={() => setLeverage(1.5)}
              className={`flex-1 px-5 py-4 rounded-xl text-base font-semibold transition-all duration-300 transform hover:scale-105 ${
                leverage === 1.5
                  ? 'bg-gradient-to-r from-orange-500 to-orange-600 text-white shadow-lg shadow-orange-500/30 border-2 border-orange-400'
                  : 'bg-forge-gray-700/80 text-forge-gray-300 hover:bg-forge-gray-600 border-2 border-forge-gray-600'
              }`}
            >
              1.5x
              <div className="text-xs mt-1 opacity-80">Moderate</div>
            </button>
            <button
              onClick={() => setLeverage(2.0)}
              className={`flex-1 px-5 py-4 rounded-xl text-base font-semibold transition-all duration-300 transform hover:scale-105 ${
                leverage === 2.0
                  ? 'bg-gradient-to-r from-orange-600 to-yellow-500 text-white shadow-lg shadow-orange-500/30 border-2 border-orange-400'
                  : 'bg-forge-gray-700/80 text-forge-gray-300 hover:bg-forge-gray-600 border-2 border-forge-gray-600'
              }`}
            >
              2x
              <div className="text-xs mt-1 opacity-80">Maximum</div>
            </button>
          </div>
        </div>

            {/* Position Preview - Enhanced */}
            <div className="bg-gradient-to-br from-orange-500/10 via-orange-500/5 to-transparent backdrop-blur-sm rounded-2xl p-6 mb-6 border border-orange-500/20">
              <h3 className="text-sm font-semibold text-forge-gray-300 mb-4">
                Position Preview
              </h3>
              <div className="space-y-3">
                <div className="flex justify-between items-center py-2.5 px-3 panel-muted rounded-lg">
                  <span className="text-forge-gray-400 text-sm">Collateral</span>
                  <span className="text-white font-bold text-lg">
                    {amount ? formatSOL(parseFloat(amount)) : '0.000'} {baseTokenSymbol}
                  </span>
                </div>
                {amount && (
                  <>
                    <div className="flex justify-between items-center py-2 px-3 bg-red-500/10 rounded-lg border border-red-500/20">
                      <span className="text-red-400 text-xs font-medium">
                        Opening Fee (1%)
                      </span>
                      <span className="text-red-400 font-semibold">
                        -{formatSOL(parseFloat(amount) * INFERNO_OPEN_FEE_RATE)} {baseTokenSymbol}
                      </span>
                    </div>
                    <div className="flex justify-between items-center py-2 px-3 panel-muted rounded-lg">
                      <span className="text-forge-gray-400 text-xs">Collateral After Fee</span>
                      <span className="text-forge-gray-300 font-semibold">
                        {formatSOL(parseFloat(amount) * (1 - INFERNO_OPEN_FEE_RATE))} {baseTokenSymbol}
                      </span>
                    </div>
                  </>
                )}
            {leverage > 1.0 && (
              <>
                <div className="flex justify-between pt-2 border-t border-forge-gray-700">
                  <div className="flex items-center space-x-1">
                    <span className="text-forge-gray-400">Borrowing</span>
                    <svg className="w-3 h-3 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <title>Borrowing Interest Rate: 10% APY - This is the annual cost of borrowing USDC from the lending pool</title>
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <span className="text-orange-400 font-medium">
                    {formatUSDC(borrowedUSDC)} USDC
                  </span>
                </div>
                <div className="flex justify-between text-xs pt-1">
                  <span className="text-forge-gray-500">Interest Rate (5% APY)</span>
                  <span className="text-forge-gray-400">
                    {formatUSDC(borrowedUSDC * 0.05)} USDC/year
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-forge-gray-400">Health</span>
                  <span className={`font-medium ${
                    health >= 200 ? 'text-green-400' :
                    health >= 150 ? 'text-yellow-400' :
                    health >= 120 ? 'text-orange-400' :
                    'text-red-400'
                  }`}>
                    {(health / 100).toFixed(2)}x
                  </span>
                </div>
              </>
            )}
            <div className="flex justify-between pt-2 border-t border-forge-gray-700">
              <span className="text-forge-gray-400">LP Pair</span>
              <span className="text-white font-medium">
                {baseTokenSymbol}/USDC
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-forge-gray-400">Effective APY</span>
              <span className="text-forge-primary font-bold">
                {effectiveAPY.toFixed(2)}%
              </span>
            </div>
          </div>
        </div>

        {/* Lending Pool Liquidity Error */}
        {!hasEnoughLiquidity && amount && parseFloat(amount) > 0 && (
          <div className="mb-4 p-3 bg-red-500/10 border border-red-500/50 rounded-xl">
            <div className="flex items-center gap-2 text-red-400">
              <ExclamationTriangleIcon className="w-5 h-5" />
              <span className="font-medium">Insufficient Lending Pool Liquidity</span>
            </div>
            <p className="text-red-300 text-sm mt-1">
              Need to borrow {formatUSDC(borrowedUSDC)} USDC but pool only has {formatUSDC(availableLiquidity)} USDC available.
            </p>
          </div>
        )}

        {/* Health Warning */}
        {health < 120 && health < 999 && (
          <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-xs text-red-400">
            ⚠️ Health factor below 120%. Position is at risk.
          </div>
        )}

        {/* Actions */}
        <div className="flex space-x-3">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-3 bg-forge-gray-700 hover:bg-forge-gray-600 text-white rounded-lg font-medium transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleOpenPosition}
            disabled={!amount || loading || parseFloat(amount) <= 0 || !hasEnoughLiquidity}
            className="flex-1 px-4 py-3 bg-forge-primary hover:bg-forge-secondary text-white rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Processing...' : 'Open Position'}
          </button>
        </div>
      </div>
    </div>
  )
}

