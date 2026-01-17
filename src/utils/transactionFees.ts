/**
 * Transaction Fee Utilities
 * Calculates Solana network fees and protocol fees for APY calculations
 */

// Solana Network Fees
export const SOLANA_BASE_TX_FEE = 0.000005 // SOL per transaction (base fee)
export const SOLANA_ACCOUNT_CREATION_FEE = 0.00144 // SOL per new account
export const SOLANA_COMPUTE_UNIT_PRICE = 0.000001 // SOL per compute unit (estimate)
export const SOLANA_COMPUTE_UNITS_PER_TX = 200000 // Average compute units per transaction

/**
 * Calculate Solana network transaction fee
 */
export function calculateNetworkFee(
  numTransactions: number = 1,
  createAccounts: number = 0
): number {
  const baseFees = SOLANA_BASE_TX_FEE * numTransactions
  const computeFees = SOLANA_COMPUTE_UNIT_PRICE * SOLANA_COMPUTE_UNITS_PER_TX * numTransactions
  const accountCreationFees = SOLANA_ACCOUNT_CREATION_FEE * createAccounts
  
  return baseFees + computeFees + accountCreationFees
}

/**
 * Protocol fee rates (from fees.ts)
 */
export const PROTOCOL_FEES = {
  WRAP: 0.005, // 0.5%
  UNWRAP: 0.0075, // 0.75% (reduces to 0.3% after 5-day cooldown)
  UNWRAP_COOLDOWN: 0.003, // 0.3% after cooldown
  LP_OPEN: 0.01, // 1%
  LP_CLOSE_PRINCIPAL: 0.02, // 2% of principal
  LP_CLOSE_YIELD: 0.10, // 10% of yield
  LIQUIDATION: 0.10, // 10%
  LENDING_YIELD_FEE: 0.10, // 10% of lending yield
} as const

/**
 * Calculate protocol fee for wrap operation
 */
export function calculateWrapFee(amount: number): number {
  return amount * PROTOCOL_FEES.WRAP
}

/**
 * Calculate protocol fee for unwrap operation
 */
export function calculateUnwrapFee(amount: number, hasCooldown: boolean = false): number {
  const feeRate = hasCooldown ? PROTOCOL_FEES.UNWRAP_COOLDOWN : PROTOCOL_FEES.UNWRAP
  return amount * feeRate
}

/**
 * Calculate protocol fees for LP open operation
 */
export function calculateLPOpenFee(positionValue: number): number {
  return positionValue * PROTOCOL_FEES.LP_OPEN
}

/**
 * Calculate protocol fees for LP close operation
 */
export function calculateLPCloseFee(principal: number, yieldEarned: number): {
  principalFee: number
  yieldFee: number
  totalFee: number
} {
  const principalFee = principal * PROTOCOL_FEES.LP_CLOSE_PRINCIPAL
  const yieldFee = yieldEarned * PROTOCOL_FEES.LP_CLOSE_YIELD
  const totalFee = principalFee + yieldFee
  
  return { principalFee, yieldFee, totalFee }
}

/**
 * Calculate borrowing interest cost
 * @param borrowedAmount Amount borrowed in USDC
 * @param borrowRate Borrow rate (10 = 10% APY, scaled by 100)
 * @param timeElapsedSeconds Time elapsed in seconds
 */
export function calculateBorrowingInterest(
  borrowedAmount: number,
  borrowRate: number, // 10 = 10% APY
  timeElapsedSeconds: number
): number {
  const secondsPerYear = 365 * 24 * 60 * 60
  const rateDecimal = borrowRate / 100 // Convert 10 to 0.10
  return borrowedAmount * rateDecimal * (timeElapsedSeconds / secondsPerYear)
}

/**
 * Calculate annual transaction fees for a position
 * @param transactionFrequency Number of transactions per year
 * @param avgTransactionFee Average fee per transaction (in SOL)
 * @param solPrice SOL price in USD
 */
export function calculateAnnualTransactionFees(
  transactionFrequency: number,
  avgTransactionFee: number,
  solPrice: number
): number {
  return transactionFrequency * avgTransactionFee * solPrice
}

/**
 * Calculate all fees for a leveraged position
 */
export interface LeveragedPositionFees {
  wrapFee: number
  unwrapFee: number
  lpOpenFee: number
  lpCloseFee: {
    principalFee: number
    yieldFee: number
    totalFee: number
  }
  borrowingInterest: number
  networkFees: number
  totalFees: number
}

export function calculateLeveragedPositionFees(params: {
  depositAmount: number
  withdrawAmount: number
  positionValue: number
  principal: number
  yieldEarned: number
  borrowedAmount: number
  borrowRate: number
  timeElapsedSeconds: number
  hasUnwrapCooldown: boolean
  numTransactions: number
  createAccounts: number
}): LeveragedPositionFees {
  const wrapFee = calculateWrapFee(params.depositAmount)
  const unwrapFee = calculateUnwrapFee(params.withdrawAmount, params.hasUnwrapCooldown)
  const lpOpenFee = calculateLPOpenFee(params.positionValue)
  const lpCloseFee = calculateLPCloseFee(params.principal, params.yieldEarned)
  const borrowingInterest = calculateBorrowingInterest(
    params.borrowedAmount,
    params.borrowRate,
    params.timeElapsedSeconds
  )
  const networkFees = calculateNetworkFee(params.numTransactions, params.createAccounts)
  
  const totalFees = wrapFee + unwrapFee + lpOpenFee + lpCloseFee.totalFee + borrowingInterest + networkFees
  
  return {
    wrapFee,
    unwrapFee,
    lpOpenFee,
    lpCloseFee,
    borrowingInterest,
    networkFees,
    totalFees,
  }
}
