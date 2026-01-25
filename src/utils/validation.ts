/**
 * Input validation utilities for Forge Protocol
 * Provides comprehensive validation for user inputs before transaction submission
 */

// Constants matching on-chain constraints
export const MAX_LEVERAGE = 2.0 // Maximum leverage factor (2x)
export const MIN_LEVERAGE = 1.0 // Minimum leverage factor (1x)
export const MAX_AMOUNT_USD = 10_000_000 // Maximum position size: $10M USD
export const MIN_DEPOSIT_AMOUNT = 0.000001 // Minimum deposit amount (prevents dust)
export const MAX_DECIMAL_PLACES = 9 // Maximum decimal places for SOL (9 decimals)
export const MAX_DECIMAL_PLACES_USDC = 6 // Maximum decimal places for USDC (6 decimals)

export interface ValidationResult {
  valid: boolean
  error?: string
}

/**
 * Validate amount input
 */
export function validateAmount(
  amount: string | number,
  tokenSymbol: 'SOL' | 'FORGE' | 'USDC',
  maxAmount?: number
): ValidationResult {
  const numAmount = typeof amount === 'string' ? parseFloat(amount) : amount

  // Check if valid number
  if (isNaN(numAmount) || !isFinite(numAmount)) {
    return { valid: false, error: 'Please enter a valid number' }
  }

  // Check if positive
  if (numAmount <= 0) {
    return { valid: false, error: 'Amount must be greater than zero' }
  }

  // Check minimum amount
  if (numAmount < MIN_DEPOSIT_AMOUNT) {
    return {
      valid: false,
      error: `Amount must be at least ${MIN_DEPOSIT_AMOUNT} ${tokenSymbol}`,
    }
  }

  // Check maximum amount if provided
  if (maxAmount !== undefined && numAmount > maxAmount) {
    return {
      valid: false,
      error: `Amount exceeds maximum of ${maxAmount.toLocaleString()} ${tokenSymbol}`,
    }
  }

  // Check decimal precision
  const decimalPlaces = tokenSymbol === 'USDC' ? MAX_DECIMAL_PLACES_USDC : MAX_DECIMAL_PLACES
  const amountStr = numAmount.toString()
  const decimalIndex = amountStr.indexOf('.')
  if (decimalIndex !== -1) {
    const decimals = amountStr.substring(decimalIndex + 1).length
    if (decimals > decimalPlaces) {
      return {
        valid: false,
        error: `Amount can have at most ${decimalPlaces} decimal places`,
      }
    }
  }

  return { valid: true }
}

/**
 * Validate leverage factor
 */
export function validateLeverage(leverage: number): ValidationResult {
  if (isNaN(leverage) || !isFinite(leverage)) {
    return { valid: false, error: 'Invalid leverage value' }
  }

  if (leverage < MIN_LEVERAGE) {
    return {
      valid: false,
      error: `Leverage must be at least ${MIN_LEVERAGE}x`,
    }
  }

  if (leverage > MAX_LEVERAGE) {
    return {
      valid: false,
      error: `Leverage cannot exceed ${MAX_LEVERAGE}x`,
    }
  }

  // Check for reasonable decimal precision (e.g., 1.5, 2.0)
  const leverageStr = leverage.toString()
  const decimalIndex = leverageStr.indexOf('.')
  if (decimalIndex !== -1) {
    const decimals = leverageStr.substring(decimalIndex + 1).length
    if (decimals > 2) {
      return {
        valid: false,
        error: 'Leverage can have at most 2 decimal places',
      }
    }
  }

  return { valid: true }
}

/**
 * Validate position size in USD
 */
export function validatePositionSizeUSD(usdValue: number): ValidationResult {
  if (isNaN(usdValue) || !isFinite(usdValue)) {
    return { valid: false, error: 'Invalid position value' }
  }

  if (usdValue > MAX_AMOUNT_USD) {
    return {
      valid: false,
      error: `Position size cannot exceed $${MAX_AMOUNT_USD.toLocaleString()}`,
    }
  }

  return { valid: true }
}

/**
 * Validate slippage tolerance (in basis points)
 */
export function validateSlippage(slippageBps: number): ValidationResult {
  if (isNaN(slippageBps) || !isFinite(slippageBps)) {
    return { valid: false, error: 'Invalid slippage value' }
  }

  if (slippageBps < 0) {
    return { valid: false, error: 'Slippage cannot be negative' }
  }

  if (slippageBps > 10_000) {
    return { valid: false, error: 'Slippage cannot exceed 100%' }
  }

  return { valid: true }
}

/**
 * Validate balance sufficiency
 */
export function validateBalance(
  amount: number,
  balance: number,
  tokenSymbol: string
): ValidationResult {
  if (amount > balance) {
    return {
      valid: false,
      error: `Insufficient ${tokenSymbol} balance. You need ${amount.toLocaleString()} but only have ${balance.toLocaleString()}`,
    }
  }

  return { valid: true }
}

/**
 * Comprehensive validation for LVF position opening
 */
export function validateLVFPosition(
  collateralAmount: number,
  leverage: number,
  collateralBalance: number,
  tokenSymbol: 'SOL' | 'FORGE',
  tokenPrice: number,
  availableLiquidity?: number
): ValidationResult {
  // Validate collateral amount
  const amountValidation = validateAmount(collateralAmount, tokenSymbol)
  if (!amountValidation.valid) {
    return amountValidation
  }

  // Validate leverage
  const leverageValidation = validateLeverage(leverage)
  if (!leverageValidation.valid) {
    return leverageValidation
  }

  // Validate balance
  const balanceValidation = validateBalance(collateralAmount, collateralBalance, tokenSymbol)
  if (!balanceValidation.valid) {
    return balanceValidation
  }

  // Validate position size
  const collateralValueUSD = collateralAmount * tokenPrice
  const borrowedUSDC = collateralValueUSD * (leverage - 1)
  const totalPositionValue = collateralValueUSD + borrowedUSDC

  const positionSizeValidation = validatePositionSizeUSD(totalPositionValue)
  if (!positionSizeValidation.valid) {
    return positionSizeValidation
  }

  // Validate liquidity if provided
  if (availableLiquidity !== undefined && borrowedUSDC > availableLiquidity) {
    return {
      valid: false,
      error: `Insufficient liquidity. Available: $${availableLiquidity.toLocaleString()} USDC, Required: $${borrowedUSDC.toLocaleString()} USDC`,
    }
  }

  return { valid: true }
}

/**
 * Comprehensive validation for LP position opening
 */
export function validateLPPosition(
  baseAmount: number,
  usdcAmount: number,
  baseBalance: number,
  usdcBalance: number,
  baseTokenSymbol: 'SOL' | 'FORGE',
  baseTokenPrice: number,
  maxSlippageBps?: number,
  allowZeroUsdc: boolean = false
): ValidationResult {
  // Validate base amount
  const baseValidation = validateAmount(baseAmount, baseTokenSymbol)
  if (!baseValidation.valid) {
    return baseValidation
  }

  // Validate USDC amount (allow zero for max leverage cases)
  if (!(allowZeroUsdc && usdcAmount === 0)) {
    const usdcValidation = validateAmount(usdcAmount, 'USDC')
    if (!usdcValidation.valid) {
      return usdcValidation
    }
  }

  // Validate balances
  const baseBalanceValidation = validateBalance(baseAmount, baseBalance, baseTokenSymbol)
  if (!baseBalanceValidation.valid) {
    return baseBalanceValidation
  }

  if (!(allowZeroUsdc && usdcAmount === 0)) {
    const usdcBalanceValidation = validateBalance(usdcAmount, usdcBalance, 'USDC')
    if (!usdcBalanceValidation.valid) {
      return usdcBalanceValidation
    }
  }

  // Validate position size
  const baseValueUSD = baseAmount * baseTokenPrice
  const totalPositionValue = baseValueUSD + usdcAmount
  const positionSizeValidation = validatePositionSizeUSD(totalPositionValue)
  if (!positionSizeValidation.valid) {
    return positionSizeValidation
  }

  // Validate equal value (1% tolerance) - LP positions require equal value of base token and USDC
  // This matches the on-chain slippage validation in lp.rs
  if (!(allowZeroUsdc && usdcAmount === 0)) {
    const tolerance = Math.max(baseValueUSD, usdcAmount) * 0.01 // 1% tolerance
    if (Math.abs(baseValueUSD - usdcAmount) > tolerance) {
      return {
        valid: false,
        error: `Amounts must be equal value (within 1% tolerance). Base value: $${baseValueUSD.toFixed(2)}, USDC: $${usdcAmount.toFixed(2)}`,
      }
    }
  }

  // Validate slippage if provided
  if (maxSlippageBps !== undefined) {
    const slippageValidation = validateSlippage(maxSlippageBps)
    if (!slippageValidation.valid) {
      return slippageValidation
    }
  }

  return { valid: true }
}
