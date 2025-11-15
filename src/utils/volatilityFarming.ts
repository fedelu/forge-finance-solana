// Volatility Farming Fee Calculations
// Based on MVP specifications

import { INFERNO_CLOSE_FEE_RATE } from '../config/fees'

export interface VolatilityFarmingConfig {
  feeRate: number; // Closing fee on principal (e.g. 2% = 0.02)
  protocolFeeCut: number; // 20% = 0.20 (protocol treasury)
  crucibleHoldersCut: number; // 80% = 0.80 (crucible holders)
  totalProtocolTVL: number; // 4,300,000 FOGO
}

export interface CrucibleConfig {
  id: string;
  name: string;
  symbol: string;
  volatilityFactor: number; // 4% for FOGO, 8% for FORGE
  tvl: number;
}

export interface VolatilityFarmingResults {
  dailyTransactionFees: number;
  crucibleHoldersShare: number;
  protocolShare: number;
  dailyReturn: number;
  apyCompounded: number;
  transactionFrequency: number;
}

// Default configuration
export const DEFAULT_CONFIG: VolatilityFarmingConfig = {
  feeRate: INFERNO_CLOSE_FEE_RATE, // Forge principal close fee
  protocolFeeCut: 0.20, // 20% to protocol treasury
  crucibleHoldersCut: 0.80, // 80% to crucible holders
  totalProtocolTVL: 4_300_000, // 4.3M total TVL (USD)
};

// Crucible configurations
export const CRUCIBLE_CONFIGS: CrucibleConfig[] = [
  {
    id: 'sol-crucible',
    name: 'Solana',
    symbol: 'SOL',
    volatilityFactor: 0.02, // 2%
    tvl: 3_225_000, // SOL crucible TVL for cToken price calculation
  },
  {
    id: 'forge-crucible',
    name: 'FORGE',
    symbol: 'FORGE',
    volatilityFactor: 0.18, // 18%
    tvl: 1_075_000, // 25% of protocol TVL (4,300,000 * 0.25)
  },
];

/**
 * Calculate transaction frequency based on volatility
 * Higher volatility = more frequent transactions
 */
export function calculateTransactionFrequency(volatilityFactor: number): number {
  // Specific transaction frequencies for each crucible
  if (volatilityFactor === 0.02) { // FOGO: 2% volatility
    return 0.05; // 0.05 transaction frequency
  } else if (volatilityFactor === 0.18) { // FORGE: 18% volatility
    return 0.01; // 0.01 transaction frequency
  }
  // Fallback to volatility factor for other cases
  return volatilityFactor;
}

/**
 * Calculate daily transaction fees per crucible
 * Formula: F_tx/day = TVL_crucible * feeRate * transactionFrequency
 */
export function calculateDailyTransactionFees(
  tvl: number,
  feeRate: number,
  transactionFrequency: number
): number {
  return tvl * feeRate * transactionFrequency;
}

/**
 * Calculate crucible holders share of fees (80% goes to crucible positions)
 * Formula: F_holders/day = F_tx/day * 0.8
 */
export function calculateCrucibleHoldersShare(
  dailyTransactionFees: number,
  crucibleHoldersCut: number
): number {
  return dailyTransactionFees * crucibleHoldersCut;
}

/**
 * Calculate protocol share of fees (20% goes to protocol treasury)
 * Formula: F_protocol/day = F_tx/day * 0.2
 */
export function calculateProtocolShare(
  dailyTransactionFees: number,
  protocolFeeCut: number
): number {
  return dailyTransactionFees * protocolFeeCut;
}

/**
 * Calculate daily return rate for crucible holders
 * Formula: dailyReturn = F_holders/day / TVL_crucible
 */
export function calculateDailyReturn(
  crucibleHoldersShare: number,
  tvl: number
): number {
  return crucibleHoldersShare / tvl;
}



/**
 * Calculate compounded APY
 * Formula: APY_compounded = (1 + dailyReturn) ^ 365 - 1
 */
export function calculateCompoundedAPY(dailyReturn: number): number {
  return Math.pow(1 + dailyReturn, 365) - 1;
}

/**
 * Calculate all volatility farming metrics for a crucible
 */
export function calculateVolatilityFarmingMetrics(
  crucible: CrucibleConfig,
  config: VolatilityFarmingConfig = DEFAULT_CONFIG
): VolatilityFarmingResults {
  // 1. Calculate transaction frequency based on volatility
  const transactionFrequency = calculateTransactionFrequency(crucible.volatilityFactor);

  // 2. Daily transaction fees per crucible
  const dailyTransactionFees = calculateDailyTransactionFees(
    crucible.tvl,
    config.feeRate,
    transactionFrequency
  );

  // 3. Split fees between crucible holders and protocol
  const crucibleHoldersShare = calculateCrucibleHoldersShare(
    dailyTransactionFees,
    config.crucibleHoldersCut
  );
  const protocolShare = calculateProtocolShare(
    dailyTransactionFees,
    config.protocolFeeCut
  );

  // 4. Daily return rate for crucible holders
  const dailyReturn = calculateDailyReturn(crucibleHoldersShare, crucible.tvl);

  // 5. APY calculation
  const apyCompounded = calculateCompoundedAPY(dailyReturn);

  return {
    dailyTransactionFees,
    crucibleHoldersShare,
    protocolShare,
    dailyReturn,
    apyCompounded,
    transactionFrequency,
  };
}

/**
 * Calculate all crucibles' volatility farming metrics
 */
export function calculateAllCruciblesMetrics(
  config: VolatilityFarmingConfig = DEFAULT_CONFIG
): Record<string, VolatilityFarmingResults> {
  const results: Record<string, VolatilityFarmingResults> = {};

  CRUCIBLE_CONFIGS.forEach((crucible) => {
    results[crucible.id] = calculateVolatilityFarmingMetrics(crucible, config);
  });

  return results;
}

/**
 * Format APY as percentage
 */
export function formatAPY(apy: number): string {
  return `${(apy * 100).toFixed(2)}%`;
}

/**
 * Format daily return as percentage
 */
export function formatDailyReturn(dailyReturn: number): string {
  return `${(dailyReturn * 100).toFixed(4)}%`;
}

/**
 * Format currency amount
 */
export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}
