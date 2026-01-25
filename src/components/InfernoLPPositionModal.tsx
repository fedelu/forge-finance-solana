import React, { useState } from 'react'
import { XMarkIcon } from '@heroicons/react/24/outline'
import { useInfernoLP } from '../hooks/useInfernoLP'
import { useWallet } from '../contexts/WalletContext'
import { useBalance } from '../contexts/BalanceContext'
import { useAnalytics } from '../contexts/AnalyticsContext'
import { usePrice } from '../contexts/PriceContext'
import { useCrucible } from '../hooks/useCrucible'
import { formatNumberWithCommas, formatUSD, formatUSDC, formatSOL } from '../utils/math'
import { validateLPPosition } from '../utils/validation'
import { INFERNO_OPEN_FEE_RATE } from '../config/fees'

interface InfernoLPPositionModalProps {
  isOpen: boolean
  onClose: () => void
  crucibleAddress: string
  baseTokenSymbol: 'SOL'
  baseAPY: number
}

export default function InfernoLPPositionModal({
  isOpen,
  onClose,
  crucibleAddress,
  baseTokenSymbol,
  baseAPY,
}: InfernoLPPositionModalProps) {
  const [baseAmount, setBaseAmount] = useState('')
  const [usdcAmount, setUsdcAmount] = useState('')
  const [leverageFactor, setLeverageFactor] = useState(1)
  const { openPosition, loading } = useInfernoLP({
    crucibleAddress,
    baseTokenSymbol,
    baseAPY,
  })
  const { connected, publicKey } = useWallet()
  const { subtractFromBalance, getBalance } = useBalance()
  const { addTransaction } = useAnalytics()
  const { solPrice, infernoLpPrice } = usePrice()
  const { getCrucible } = useCrucible()

  const baseTokenPrice = solPrice
  const baseTokenBalance = getBalance(baseTokenSymbol)

  React.useEffect(() => {
    if (!baseAmount) {
      setUsdcAmount('')
      return
    }
    const parsedBase = parseFloat(baseAmount)
    if (!Number.isFinite(parsedBase) || parsedBase <= 0) {
      setUsdcAmount('')
      return
    }
    const baseValueUsd = parsedBase * baseTokenPrice
    const targetUsdc = leverageFactor === 1
      ? baseValueUsd
      : leverageFactor === 1.5
        ? baseValueUsd * 0.5
        : 0
    setUsdcAmount(targetUsdc === 0 ? '0' : targetUsdc.toFixed(2))
  }, [baseAmount, leverageFactor, baseTokenPrice])
  const lpAPY = baseAPY

  const handleBaseAmountChange = (value: string) => {
    setBaseAmount(value)
    if (value && parseFloat(value) > 0) {
      const calculatedUSDC = formatUSDC(parseFloat(value) * baseTokenPrice)
      setUsdcAmount(calculatedUSDC)
    } else {
      setUsdcAmount('')
    }
  }

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

    const parsedUsdcInput = usdcAmount ? parseFloat(usdcAmount) : 0
    if (leverageFactor < 2 && (!usdcAmount || parsedUsdcInput <= 0)) {
      alert('Please enter a valid USDC amount')
      return
    }

    const baseAmt = parseFloat(baseAmount)
    const usdcAmt = usdcAmount ? parseFloat(usdcAmount) : 0
    const usdcBal = getBalance('USDC')

    const validation = validateLPPosition(
      baseAmt,
      usdcAmt,
      baseTokenBalance,
      usdcBal,
      baseTokenSymbol,
      baseTokenPrice,
      undefined,
      leverageFactor === 2
    )

    if (!validation.valid) {
      alert(validation.error || 'Invalid position parameters')
      return
    }

    try {
      const positionResult = await openPosition(baseAmt, usdcAmt, leverageFactor)
      if (!positionResult || (typeof positionResult === 'object' && !('id' in positionResult))) {
        throw new Error('Failed to open position: Invalid transaction result')
      }

      subtractFromBalance(baseTokenSymbol, baseAmt)
      subtractFromBalance('USDC', usdcAmt)

      addTransaction({
        type: 'deposit',
        amount: baseAmt,
        token: baseTokenSymbol,
        crucibleId: crucibleAddress,
        usdValue: (baseAmt * baseTokenPrice) + usdcAmt,
        usdcDeposited: usdcAmt,
      })

      window.dispatchEvent(new CustomEvent('infernoLpPositionOpened', {
        detail: { crucibleAddress, baseTokenSymbol },
      }))

      window.dispatchEvent(new CustomEvent('depositComplete', {
        detail: { token: baseTokenSymbol, amount: baseAmt },
      }))

      onClose()
      setBaseAmount('')
      setUsdcAmount('')
      setLeverageFactor(1)
    } catch (error: any) {
      console.error('Error opening Inferno LP position:', {
        error,
        message: error?.message,
        stack: error?.stack,
        baseAmount: baseAmt,
        usdcAmount: usdcAmt,
        leverageFactor,
        crucibleAddress,
        baseTokenSymbol
      })
      const errorMessage = error?.message || error?.toString() || 'Failed to open Inferno LP position'
      alert(`Error: ${errorMessage}\n\nPlease check your wallet connection and try again.`)
    }
  }

  const totalValue = baseAmount && usdcAmount
    ? formatUSD(parseFloat(baseAmount) * baseTokenPrice + parseFloat(usdcAmount))
    : '0.00'

  const parsedBaseAmount = baseAmount ? parseFloat(baseAmount) : 0
  const parsedUsdcAmount = usdcAmount ? parseFloat(usdcAmount) : 0
  const baseValueUsd = parsedBaseAmount * baseTokenPrice
  const depositUsdcTarget = leverageFactor === 1
    ? baseValueUsd
    : leverageFactor === 1.5
      ? baseValueUsd * 0.5
      : 0
  const borrowedUSDC = leverageFactor > 1 ? baseValueUsd - depositUsdcTarget : 0
  const totalBaseAmountPreFee = parsedBaseAmount
  const totalUsdcAmountPreFee = depositUsdcTarget + borrowedUSDC
  const totalPositionValueUsd = (totalBaseAmountPreFee * baseTokenPrice) + totalUsdcAmountPreFee
  const infernoOpenFeeUsd = totalPositionValueUsd * INFERNO_OPEN_FEE_RATE
  const infernoOpenFeeBaseUsd = totalPositionValueUsd > 0
    ? (infernoOpenFeeUsd * (totalBaseAmountPreFee * baseTokenPrice)) / totalPositionValueUsd
    : 0
  const infernoOpenFeeBase = baseTokenPrice > 0
    ? infernoOpenFeeBaseUsd / baseTokenPrice
    : 0
  const infernoOpenFeeUsdc = totalPositionValueUsd > 0
    ? infernoOpenFeeUsd - infernoOpenFeeBaseUsd
    : 0
  const baseAmountForPosition = Math.max(0, totalBaseAmountPreFee - infernoOpenFeeBase)
  const netUsdcForPosition = Math.max(0, totalUsdcAmountPreFee - infernoOpenFeeUsdc)
  const lpTokenPrice = infernoLpPrice ?? 0
  const crucible = getCrucible(crucibleAddress)
  const exchangeRate = crucible?.exchangeRate ? Number(crucible.exchangeRate) / 1e6 : 1.0
  const lpExchangeRate = exchangeRate > 0 ? exchangeRate : 1.0
  const fallbackLpTokenPrice = baseTokenPrice * (1 + lpExchangeRate)
  const lpTokenPriceAdjusted = lpTokenPrice > 0 ? lpTokenPrice * lpExchangeRate : fallbackLpTokenPrice
  const lpTotalValueUsd = (baseAmountForPosition * baseTokenPrice) + netUsdcForPosition
  const ifSolPriceUsd = baseTokenPrice * lpExchangeRate
  const maxLpByUsdc = ifSolPriceUsd > 0 ? netUsdcForPosition / ifSolPriceUsd : 0
  const fallbackLpTokens = Math.min(baseAmountForPosition, maxLpByUsdc)
  const estimatedLpTokens = (baseAmountForPosition > 0 && netUsdcForPosition > 0)
    ? (lpTokenPriceAdjusted > 0 ? lpTotalValueUsd / lpTokenPriceAdjusted : fallbackLpTokens)
    : 0
  const ctokenSymbol = crucible?.ptokenSymbol || 'cToken'
  const displayPairSymbol = ctokenSymbol.replace(/^c/i, 'if')
  const lpTokenDecimals = displayPairSymbol === 'ifSOL' ? 2 : 4
  // Exchange rate shows how much SOL + USDC is needed for 1 LP token
  // 1 LP token = exchangeRate SOL + (exchangeRate × SOL_price) USDC
  const solPerLpToken = lpExchangeRate
  const usdcPerLpToken = lpExchangeRate * baseTokenPrice
  const safeBaseApy = isNaN(baseAPY) ? 0 : baseAPY
  const effectiveAPY = leverageFactor > 1
    ? (safeBaseApy * leverageFactor) - (10 * (leverageFactor - 1))
    : safeBaseApy

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-md animate-fade-in px-4">
      <div className="panel rounded-3xl w-full max-w-lg p-5 relative animate-scale-in">
        <button
          onClick={onClose}
          className="absolute top-5 right-5 text-forge-gray-400 hover:text-white transition-all duration-200 p-2 rounded-lg hover:bg-black/40"
          aria-label="Close modal"
        >
          <XMarkIcon className="w-5 h-5" />
        </button>

        <div className="mb-4">
          <div className="flex items-center mb-2">
            <div>
              <h2 className="text-xl font-heading text-white">Inferno LP</h2>
              <p className="text-forge-gray-400 text-xs">Leveraged LP with real swaps</p>
            </div>
          </div>
        </div>

        <div className="mb-4">
          <label className="block text-xs font-medium text-forge-gray-300 mb-2">Leverage</label>
          <div className="grid grid-cols-3 gap-2">
            {[1, 1.5, 2].map((factor) => (
              <button
                key={factor}
                onClick={() => setLeverageFactor(factor)}
                className={`py-1.5 rounded-lg text-xs font-semibold transition-all duration-200 ${
                  leverageFactor === factor
                    ? 'bg-orange-500/30 text-orange-300 border border-orange-500/40'
                    : 'bg-forge-gray-900 text-forge-gray-400 border border-forge-gray-800 hover:border-orange-500/40 hover:text-orange-300'
                }`}
              >
                {factor}x
              </button>
            ))}
          </div>
        </div>

        <div className="mb-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-forge-gray-300 mb-2">{baseTokenSymbol}</label>
            <input
              type="number"
              value={baseAmount}
              onChange={(e) => handleBaseAmountChange(e.target.value)}
              placeholder="0.0"
              className="w-full px-3 py-2.5 bg-forge-gray-900 border border-forge-gray-700 rounded-xl text-white focus:outline-none focus:border-orange-500/50"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-forge-gray-300 mb-2">USDC</label>
            <input
              type="number"
              value={usdcAmount}
              onChange={(e) => handleUSDCAmountChange(e.target.value)}
              readOnly
              placeholder="0.0"
              className="w-full px-3 py-2.5 bg-forge-gray-900 border border-forge-gray-700 rounded-xl text-white focus:outline-none focus:border-orange-500/50"
            />
          </div>
        </div>

        <div className="panel rounded-2xl p-3 mb-3 border border-forge-gray-700/50">
          <h3 className="text-[11px] font-semibold text-forge-gray-300 mb-2">
            Transaction Preview
          </h3>
          <div className="space-y-1.5">
            {leverageFactor > 1 && (
              <div className="flex justify-between items-center py-1.5 px-2.5 panel-muted rounded-lg">
                <span className="text-forge-gray-400 text-xs font-satoshi">USDC Borrowed</span>
                <span className="text-sm font-heading text-forge-primary-light">
                  {formatUSDC(borrowedUSDC)} USDC
                </span>
              </div>
            )}
            <div className="flex justify-between items-center py-1.5 px-2.5 panel-muted rounded-lg">
              <span className="text-forge-gray-400 text-xs font-satoshi">LP Tokens Received</span>
              <span className="text-white text-sm font-heading">
                {parsedBaseAmount > 0 ? formatNumberWithCommas(estimatedLpTokens, lpTokenDecimals) : formatNumberWithCommas(0, lpTokenDecimals)} if{baseTokenSymbol}/USDC
              </span>
            </div>
            {parsedBaseAmount > 0 && (
              <div className="flex justify-between items-center py-1.5 px-2.5 bg-red-500/10 rounded-lg border border-red-500/20">
                <span className="text-red-400 text-xs font-satoshi">
                  Transaction Fees ({(INFERNO_OPEN_FEE_RATE * 100).toFixed(2)}%)
                </span>
                <span className="text-red-400 font-heading font-semibold text-xs">
                  -{formatSOL(infernoOpenFeeBase)} {baseTokenSymbol} / -{formatUSDC(infernoOpenFeeUsdc)} USDC
                </span>
              </div>
            )}
            <div className="flex justify-between items-center py-1.5 px-2.5 panel-muted rounded-lg">
              <span className="text-forge-gray-400 text-xs font-satoshi">Exchange Rate: {lpExchangeRate.toFixed(2)}</span>
              <span className="text-forge-primary font-heading font-semibold text-sm">
                {solPerLpToken.toFixed(2)} {baseTokenSymbol} + {formatUSDC(usdcPerLpToken)} USDC = 1 {displayPairSymbol}/USDC
              </span>
            </div>
            <div className="flex justify-between items-center py-1.5 px-2.5 bg-gradient-to-r from-forge-primary/18 to-forge-primary/6 rounded-lg border border-forge-primary/25 shadow-[0_8px_25px_rgba(255,102,14,0.2)]">
              <span className="text-forge-primary-light text-xs font-satoshi">Base APY</span>
              <span className="text-forge-primary-light text-base font-heading">{safeBaseApy.toFixed(2)}%</span>
            </div>
          </div>
        </div>

        <div className="flex space-x-3">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2.5 panel-muted hover:bg-forge-gray-700 border-2 border-forge-gray-700 hover:border-forge-gray-600 text-white rounded-xl font-semibold transition-all duration-300 hover:scale-105"
          >
            Cancel
          </button>
          <button
            onClick={handleOpenPosition}
            disabled={loading || !baseAmount || !usdcAmount || parsedBaseAmount <= 0 || parsedUsdcAmount <= 0}
            className="flex-1 px-4 py-2.5 rounded-xl font-semibold transition-all duration-300 transform hover:scale-105 hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none disabled:hover:shadow-none relative overflow-hidden group bg-gradient-to-r from-forge-primary to-forge-primary-light hover:from-forge-primary-dark hover:to-forge-primary text-white hover:shadow-forge-lg"
          >
            {loading && (
              <span className="absolute inset-0 flex items-center justify-center">
                <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
              </span>
            )}
            <span className={loading ? 'opacity-0' : 'opacity-100'}>
              {loading ? 'Processing...' : `Open Position (${leverageFactor}x)`}
            </span>
          </button>
        </div>
      </div>
    </div>
  )
}
