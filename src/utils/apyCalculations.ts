/**
 * APY Calculation Utilities
 * Calculate effective APY including all fees and borrowing costs
 */

import { calculateBorrowingInterest, calculateAnnualTransactionFees } from './transactionFees'

/**
 * Calculate effective APY with leverage and all fees
 * Formula: effectiveAPY = (baseAPY × leverage) - (borrowRate × leverageExcess) - (annualTransactionFees / principal)
 */
export function calculateEffectiveAPYWithFees(params: {
  baseAPY: number // Base APY as percentage (e.g., 8 for 8%)
  leverage: number // Leverage multiplier (e.g., 2 for 2x)
  borrowRate: number // Borrow rate (10 = 10% APY, scaled by 100)
  principal: number // Principal amount in USD
  borrowedAmount: number // Amount borrowed in USD
  annualTransactionFees: number // Annual transaction fees in USD
  timeElapsedSeconds?: number // Optional: for calculating accrued interest
}): number {
  const { baseAPY, leverage, borrowRate, principal, borrowedAmount, annualTransactionFees, timeElapsedSeconds } = params

  // Calculate leveraged yield
  const leveragedYield = baseAPY * leverage

  // Calculate borrowing cost
  const leverageExcess = leverage - 1
  let borrowingCost = 0
  
  if (leverageExcess > 0 && borrowedAmount > 0) {
    if (timeElapsedSeconds) {
      // Calculate actual accrued interest
      const secondsPerYear = 365 * 24 * 60 * 60
      const rateDecimal = borrowRate / 100
      const interestAccrued = borrowedAmount * rateDecimal * (timeElapsedSeconds / secondsPerYear)
      borrowingCost = (interestAccrued / principal) * 100 // Convert to percentage
    } else {
      // Use annual borrowing cost
      borrowingCost = (borrowRate / 100) * leverageExcess * (borrowedAmount / principal) * 100
    }
  }

  // Calculate fee impact as percentage
  const feeImpact = (annualTransactionFees / principal) * 100

  // Effective APY = leveraged yield - borrowing cost - fee impact
  const effectiveAPY = leveragedYield - borrowingCost - feeImpact

  return Math.max(0, effectiveAPY) // Ensure non-negative
}

/**
 * Calculate net yield after all fees for a position
 */
export function calculateNetYield(params: {
  grossYield: number // Gross yield earned
  principal: number // Principal amount
  borrowingInterest: number // Borrowing interest paid
  protocolFees: number // Protocol fees paid
  networkFees: number // Network fees paid (in USD)
}): number {
  const { grossYield, borrowingInterest, protocolFees, networkFees } = params
  return grossYield - borrowingInterest - protocolFees - networkFees
}

/**
 * Calculate APY from yield and time
 */
export function calculateAPYFromYield(
  yieldEarned: number,
  principal: number,
  timeElapsedSeconds: number
): number {
  if (principal === 0 || timeElapsedSeconds === 0) return 0
  
  const secondsPerYear = 365 * 24 * 60 * 60
  const timeRatio = secondsPerYear / timeElapsedSeconds
  const yieldRatio = yieldEarned / principal
  
  return yieldRatio * timeRatio * 100 // Convert to percentage
}

/**
 * Calculate effective supply APY (for lenders)
 * Formula: supplyAPY = lenderRate × (1 - protocolFeeRate)
 */
export function calculateSupplyAPY(
  lenderRate: number, // 5 = 5% APY (scaled by 100)
  protocolFeeRate: number = 0.10 // 10% fee on yield
): number {
  const baseAPY = lenderRate / 100 // Convert 5 to 0.05
  const feeOnYield = baseAPY * protocolFeeRate
  return (baseAPY - feeOnYield) * 100 // Return as percentage
}

/**
 * Calculate borrowing cost as percentage of principal
 */
export function calculateBorrowingCostPercentage(
  borrowedAmount: number,
  borrowRate: number,
  principal: number,
  timeElapsedSeconds: number
): number {
  if (principal === 0) return 0
  
  const interest = calculateBorrowingInterest(borrowedAmount, borrowRate, timeElapsedSeconds)
  return (interest / principal) * 100
}

/**
 * Calculate total cost of leverage
 */
export interface LeverageCosts {
  borrowingInterest: number
  borrowingCostPercentage: number
  effectiveAPY: number
  netAPY: number
}

export function calculateLeverageCosts(params: {
  baseAPY: number
  leverage: number
  principal: number
  borrowedAmount: number
  borrowRate: number
  timeElapsedSeconds: number
  annualTransactionFees: number
}): LeverageCosts {
  const { baseAPY, leverage, principal, borrowedAmount, borrowRate, timeElapsedSeconds, annualTransactionFees } = params

  // Calculate borrowing interest
  const borrowingInterest = calculateBorrowingInterest(borrowedAmount, borrowRate, timeElapsedSeconds)
  
  // Calculate borrowing cost as percentage
  const borrowingCostPercentage = calculateBorrowingCostPercentage(
    borrowedAmount,
    borrowRate,
    principal,
    timeElapsedSeconds
  )

  // Calculate effective APY with fees
  const effectiveAPY = calculateEffectiveAPYWithFees({
    baseAPY,
    leverage,
    borrowRate,
    principal,
    borrowedAmount,
    annualTransactionFees,
    timeElapsedSeconds,
  })

  // Net APY = effective APY (already accounts for all costs)
  const netAPY = effectiveAPY

  return {
    borrowingInterest,
    borrowingCostPercentage,
    effectiveAPY,
    netAPY,
  }
}
