// Math utilities for token calculations
// RATE_SCALE must match on-chain exchange_rate scaling (1.0 = 1_000_000)
export const RATE_SCALE = BigInt(1_000_000); // 6 decimal places - matches Rust state.rs

/**
 * Calculate pToken amount to mint based on base token amount and exchange rate
 * @param amountBase - Amount of base tokens to wrap
 * @param exchangeRate - Current exchange rate (scaled by RATE_SCALE)
 * @returns Amount of pTokens to mint
 */
export function computePMint(amountBase: bigint, exchangeRate: bigint): bigint {
  return (amountBase * RATE_SCALE) / exchangeRate;
}

/**
 * Calculate base token amount to return based on pToken amount and exchange rate
 * @param pAmount - Amount of pTokens to unwrap
 * @param exchangeRate - Current exchange rate (scaled by RATE_SCALE)
 * @returns Amount of base tokens to return
 */
export function computeForgeOut(pAmount: bigint, exchangeRate: bigint): bigint {
  return (pAmount * exchangeRate) / RATE_SCALE;
}

/**
 * Calculate estimated APY from exchange rate growth
 * @param currentRate - Current exchange rate
 * @param previousRate - Previous exchange rate
 * @param timeElapsed - Time elapsed in seconds
 * @returns Estimated APY as a percentage (0-100)
 */
export function calculateAPY(
  currentRate: bigint,
  previousRate: bigint,
  timeElapsed: number
): number {
  if (previousRate === BigInt(0) || timeElapsed === 0) return 0;
  
  // Calculate daily growth rate
  const rateGrowth = Number(currentRate - previousRate) / Number(previousRate);
  const dailyGrowth = rateGrowth * (86400 / timeElapsed); // Convert to daily rate
  
  // Calculate APY: (1 + daily_rate)^365 - 1
  const apy = Math.pow(1 + dailyGrowth, 365) - 1;
  
  return Math.max(0, apy * 100); // Return as percentage
}

/**
 * Format a BigInt amount to a readable string with decimals and commas
 * @param amount - Amount as BigInt
 * @param decimals - Number of decimal places
 * @returns Formatted string with commas
 */
export function formatAmount(amount: bigint, decimals: number = 9): string {
  const divisor = BigInt(10 ** decimals);
  const wholePart = amount / divisor;
  const fractionalPart = amount % divisor;
  
  const fractionalStr = fractionalPart.toString().padStart(decimals, '0');
  const trimmedFractional = fractionalStr.replace(/0+$/, '');
  
  // Add commas to whole part
  const wholePartStr = wholePart.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  
  if (trimmedFractional === '') {
    return `${wholePartStr}.00`;
  }
  
  // Round to 2 decimal places
  const fractional = trimmedFractional.slice(0, 2).padEnd(2, '0');
  return `${wholePartStr}.${fractional}`;
}

/**
 * Parse a string amount to BigInt with proper decimal scaling
 * @param amountStr - Amount as string (e.g., "1.5")
 * @param decimals - Number of decimal places
 * @returns Amount as BigInt
 */
export function parseAmount(amountStr: string, decimals: number = 9): bigint {
  const [whole, fractional = ''] = amountStr.split('.');
  const paddedFractional = fractional.padEnd(decimals, '0').slice(0, decimals);
  
  const wholeBigInt = BigInt(whole || '0');
  const fractionalBigInt = BigInt(paddedFractional);
  const multiplier = BigInt(10 ** decimals);
  
  return wholeBigInt * multiplier + fractionalBigInt;
}

/**
 * Calculate the estimated base token value of pTokens
 * @param pTokenAmount - Amount of pTokens
 * @param exchangeRate - Current exchange rate
 * @returns Estimated base token value
 */
export function getEstimatedForgeValue(pTokenAmount: bigint, exchangeRate: bigint): bigint {
  return computeForgeOut(pTokenAmount, exchangeRate);
}

/**
 * Calculate the current exchange rate as a decimal
 * @param exchangeRate - Exchange rate as BigInt (scaled)
 * @returns Exchange rate as decimal number
 */
export function getExchangeRateDecimal(exchangeRate: bigint): number {
  return Number(exchangeRate) / Number(RATE_SCALE);
}

/**
 * Format a number with commas for better readability
 * @param num - Number to format
 * @param decimals - Number of decimal places (default: 2)
 * @returns Formatted string with commas
 */
export function formatNumberWithCommas(num: number, decimals: number = 2): string {
  return num.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });
}

/**
 * Calculate the current cToken price based on exchange rate
 * @param baseTokenPrice - Price of the base token in USD
 * @param exchangeRate - Current exchange rate (scaled by RATE_SCALE)
 * @returns Price of cToken in USD
 */
export function getCTokenPrice(baseTokenPrice: number, exchangeRate: bigint): number {
  // cToken price grows as exchange rate increases above RATE_SCALE
  // Formula: cToken price = baseToken price * (exchangeRate / RATE_SCALE)
  // When exchangeRate = RATE_SCALE: price = baseToken price (1:1)
  // When exchangeRate > RATE_SCALE: price increases (accumulated yield)
  const rateMultiplier = Number(exchangeRate) / Number(RATE_SCALE);
  return baseTokenPrice * rateMultiplier;
}
