import React, { createContext, useContext, ReactNode, useState, useCallback, useMemo } from 'react';
import { 
  computePMint, 
  computeFogoOut, 
  calculateAPY, 
  formatAmount, 
  parseAmount,
  getEstimatedFogoValue,
  getExchangeRateDecimal,
  RATE_SCALE 
} from '../utils/math';
import { calculateVolatilityFarmingMetrics, CRUCIBLE_CONFIGS, DEFAULT_CONFIG, formatAPY, formatCurrency } from '../utils/volatilityFarming';
import {
  WRAP_FEE_RATE,
  UNWRAP_FEE_RATE,
  INFERNO_OPEN_FEE_RATE,
} from '../config/fees';

export interface CrucibleData {
  id: string;
  name: string;
  symbol: string;
  baseToken: 'SOL' | 'FORGE';
  ptokenSymbol: 'cSOL' | 'cFORGE';
  tvl: number;
  apr: number;
  status: 'active' | 'paused' | 'maintenance';
  userDeposit: number;
  userShares: number;
  icon: string;
  // pToken specific fields
  ptokenMint?: string;
  exchangeRate?: bigint;
  totalWrapped?: bigint;
  userPtokenBalance?: bigint;
  estimatedBaseValue?: bigint;
  currentAPY?: number;
  totalFeesCollected?: number;
  apyEarnedByUsers?: number;
  totalDeposited?: number;
  totalWithdrawn?: number;
}

interface CrucibleHookReturn {
  crucibles: CrucibleData[];
  loading: boolean;
  error: string | null;
  wrapTokens: (crucibleId: string, amount: string) => Promise<void>;
  unwrapTokens: (crucibleId: string, amount: string) => Promise<{ baseAmount: number; apyEarned: number; feeAmount: number } | null>;
  unwrapTokensToUSDC: (crucibleId: string, amount: string) => Promise<void>;
  refreshCrucibleData: (crucibleId: string) => Promise<void>;
  getCrucible: (crucibleId: string) => CrucibleData | undefined;
  calculateWrapPreview: (crucibleId: string, baseAmount: string) => { ptokenAmount: string; estimatedValue: string };
  calculateUnwrapPreview: (crucibleId: string, ptokenAmount: string) => { baseAmount: string; estimatedValue: string };
  trackLeveragedPosition: (crucibleId: string, baseAmount: number) => void; // Track leveraged/LP position for exchange rate growth
  updateCrucibleTVL: (crucibleId: string, amountUSD: number) => void; // Update crucible TVL directly
  userBalances: Record<string, {
    ptokenBalance: bigint;
    baseDeposited: number;
    estimatedBaseValue: bigint;
    apyEarnedUSD: number;
    depositTimestamp?: number; // Timestamp when position was opened
  }>;
}

// Calculate volatility farming metrics for each crucible
const fogoMetrics = calculateVolatilityFarmingMetrics(CRUCIBLE_CONFIGS[0], DEFAULT_CONFIG);
const forgeMetrics = calculateVolatilityFarmingMetrics(CRUCIBLE_CONFIGS[1], DEFAULT_CONFIG);

// Mock crucible data with volatility farming calculations
  const mockCrucibles: CrucibleData[] = [
    {
      id: 'sol-crucible',
      name: 'Solana',
      symbol: 'SOL',
      baseToken: 'SOL',
      ptokenSymbol: 'cSOL',
      tvl: 3_225_000, // SOL crucible TVL for cToken price calculation
      apr: fogoMetrics.apyCompounded, // Compounded APY from volatility farming
      status: 'active',
      userDeposit: 0,
      userShares: 0,
      icon: '/usd-coin-usdc-logo-last.png',
      ptokenMint: 'mockPsolMint1',
      exchangeRate: BigInt(Math.floor(Number(RATE_SCALE) * 1.045)), // Initial exchange rate: 1 cSOL = 1.045 SOL (4.5% initial yield)
      totalWrapped: BigInt(6450000000000), // 6,450,000 cSOL emitted
      userPtokenBalance: BigInt(0),
      estimatedBaseValue: BigInt(0),
      currentAPY: fogoMetrics.apyCompounded * 100, // Convert to percentage
      totalFeesCollected: fogoMetrics.dailyTransactionFees * 365, // Annual fees
      apyEarnedByUsers: fogoMetrics.crucibleHoldersShare * 365, // Annual crucible holders yield
      totalDeposited: 0,
      totalWithdrawn: 0
    },
    {
      id: 'forge-crucible',
      name: 'Forge',
      symbol: 'FORGE',
      baseToken: 'FORGE',
      ptokenSymbol: 'cFORGE',
      tvl: 1_075_000, // 25% of protocol TVL
      apr: forgeMetrics.apyCompounded, // Compounded APY from volatility farming
      status: 'active',
      userDeposit: 0,
      userShares: 0,
      icon: '/forgo logo straight.png',
      ptokenMint: 'mockPforgeMint1',
      exchangeRate: BigInt(Math.floor(Number(RATE_SCALE) / (0.002 / 0.0025))), // Inverted to get fewer cFORGE since cFORGE costs more: RATE_SCALE / (FORGE price / cFORGE price) = RATE_SCALE / 0.8
      totalWrapped: BigInt(537500000000000), // 537,500,000 cFORGE emitted
      userPtokenBalance: BigInt(0),
      estimatedBaseValue: BigInt(0),
      currentAPY: forgeMetrics.apyCompounded * 100, // Convert to percentage
      totalFeesCollected: forgeMetrics.dailyTransactionFees * 365, // Annual fees
      apyEarnedByUsers: forgeMetrics.crucibleHoldersShare * 365, // Annual crucible holders yield
      totalDeposited: 0,
      totalWithdrawn: 0
    }
  ];

// Create context with default values
const CrucibleContext = createContext<CrucibleHookReturn>({
  crucibles: mockCrucibles,
  loading: false,
  error: null,
  wrapTokens: async () => {},
  unwrapTokens: async () => null,
  unwrapTokensToUSDC: async () => {},
  refreshCrucibleData: async () => {},
  getCrucible: () => undefined,
  calculateWrapPreview: () => ({ ptokenAmount: '0', estimatedValue: '0' }),
  calculateUnwrapPreview: () => ({ baseAmount: '0', estimatedValue: '0' }),
  trackLeveragedPosition: () => {},
  updateCrucibleTVL: () => {},
  userBalances: {}
});

// Provider component
interface CrucibleProviderProps {
  children: ReactNode;
}

export const CrucibleProvider: React.FC<CrucibleProviderProps> = ({ children }) => {
  // State to track user interactions
  const [userBalances, setUserBalances] = useState<Record<string, {
    ptokenBalance: bigint;
    baseDeposited: number;
    estimatedBaseValue: bigint;
    apyEarnedUSD: number; // Track APY earned in USD per user
    depositTimestamp?: number; // Timestamp when position was opened
  }>>({});
  
  // State to trigger re-renders when crucible data changes
  const [crucibleUpdateTrigger, setCrucibleUpdateTrigger] = useState(0);
  
  // Trigger periodic updates to simulate exchange rate growth (every 5 seconds)
  React.useEffect(() => {
    const interval = setInterval(() => {
      setCrucibleUpdateTrigger(prev => prev + 1);
    }, 5000); // Update every 5 seconds
    
    return () => clearInterval(interval);
  }, []);

  // Simulate exchange rate growth over time (1 minute = 1 month)
  const getUpdatedCrucibles = (): CrucibleData[] => {
    // Use the trigger to ensure re-renders when user balances change
    crucibleUpdateTrigger; // This ensures the function re-runs when trigger changes
    
    return mockCrucibles.map(crucible => {
      const userBalance = userBalances[crucible.id] || {
        ptokenBalance: BigInt(0),
        baseDeposited: 0,
        estimatedBaseValue: BigInt(0),
        apyEarnedUSD: 0
      };
      
      // Calculate dynamic exchange rate based on time position was open
      let dynamicExchangeRate = crucible.exchangeRate || RATE_SCALE;
      if (userBalance.depositTimestamp) {
        const now = Date.now();
        const timeOpenMs = now - userBalance.depositTimestamp;
        const timeOpenMinutes = timeOpenMs / (1000 * 60); // Convert to minutes
        const timeOpenMonths = timeOpenMinutes; // 1 minute = 1 month
        
        // Calculate accumulated yield: P(t) = P(0) * (1 + APY)^(t/12)
        // Start with 1.045 (4.5% initial yield)
        const initialRate = 1.045;
        const apy = crucible.apr; // e.g., 0.18 for 18%
        const yearsElapsed = timeOpenMonths / 12;
        const accumulatedRate = initialRate * Math.pow(1 + apy, yearsElapsed);
        dynamicExchangeRate = BigInt(Math.floor(Number(RATE_SCALE) * accumulatedRate));
      }
      
      return {
        ...crucible,
        exchangeRate: dynamicExchangeRate,
        currentAPY: crucible.apr * 100, // Use the static APR as APY (18% and 32%)
        userPtokenBalance: userBalance.ptokenBalance,
        userDeposit: userBalance.baseDeposited,
        estimatedBaseValue: userBalance.estimatedBaseValue,
        apyEarnedByUsers: crucible.apyEarnedByUsers || 0 // Use crucible's total APY earned by all users
      };
    });
  };

  const wrapTokens = useCallback(async (crucibleId: string, amount: string) => {
    const crucible = getUpdatedCrucibles().find(c => c.id === crucibleId);
    if (crucible && crucible.exchangeRate) {
      const baseDeposited = parseFloat(amount);
      
      // Calculate wrap fee
      const feeAmount = baseDeposited * WRAP_FEE_RATE;
      const netAmount = baseDeposited - feeAmount;
      
      // Calculate cTokens based on net amount (after fee deduction)
      const netAmountBigInt = parseAmount(netAmount.toString());
      const ptokenAmount = computePMint(netAmountBigInt, crucible.exchangeRate);

      // Update crucible stats with fee collection
      const crucibleIndex = mockCrucibles.findIndex(c => c.id === crucibleId);
      if (crucibleIndex !== -1) {
        mockCrucibles[crucibleIndex] = {
          ...mockCrucibles[crucibleIndex],
          // Don't update exchangeRate here - it's calculated dynamically in getUpdatedCrucibles
          totalWrapped: (mockCrucibles[crucibleIndex].totalWrapped || BigInt(0)) + ptokenAmount,
          tvl: mockCrucibles[crucibleIndex].tvl + baseDeposited, // TVL includes fees
        };
      }
      
      // Update user balances
      setUserBalances(prev => {
        const current = prev[crucibleId] || {
          ptokenBalance: BigInt(0),
          baseDeposited: 0,
          estimatedBaseValue: BigInt(0),
          apyEarnedUSD: 0,
          depositTimestamp: undefined
        };
        
        // Set deposit timestamp if this is the first deposit
        const depositTimestamp = current.depositTimestamp || Date.now();
        
        return {
          ...prev,
          [crucibleId]: {
            ptokenBalance: current.ptokenBalance + ptokenAmount,
            baseDeposited: current.baseDeposited + netAmount, // Track net deposited amount
            estimatedBaseValue: current.estimatedBaseValue + BigInt(Math.floor(netAmount * 1e9)),
            apyEarnedUSD: current.apyEarnedUSD,
            depositTimestamp
          }
        };
      });
      
      // Trigger re-render
      setCrucibleUpdateTrigger(prev => prev + 1);
      
      
    }
  }, []);

  const unwrapTokensToUSDC = useCallback(async (crucibleId: string, amount: string) => {
    const crucible = getUpdatedCrucibles().find(c => c.id === crucibleId);
    if (crucible && crucible.exchangeRate) {
      const ptokenAmount = parseAmount(amount);
      const baseAmount = computeFogoOut(ptokenAmount, crucible.exchangeRate);
      const baseToWithdraw = Number(formatAmount(baseAmount));
      
      // Calculate unwrap fee
      const feeAmount = baseToWithdraw * UNWRAP_FEE_RATE;
      const netAmount = baseToWithdraw - feeAmount;
      
      // Convert to USDC (assuming 1:1 rate for simplicity, but could be dynamic)
      const usdcAmount = netAmount;
      
      // Calculate APY earnings in USD (base amount)
      const apyEarnedUSD = (crucible.apyEarnedByUsers || 0) + (feeAmount * 0.33);
      const totalFees = apyEarnedUSD * 3;
      const totalBurnedUSD = apyEarnedUSD / 10;

      // Update crucible stats with fee collection and burned tokens
      const crucibleIndex = mockCrucibles.findIndex(c => c.id === crucibleId);
      if (crucibleIndex !== -1) {
        mockCrucibles[crucibleIndex] = {
          ...mockCrucibles[crucibleIndex],
          totalFeesCollected: totalFees,
          totalWrapped: (mockCrucibles[crucibleIndex].totalWrapped || BigInt(0)) - ptokenAmount,
          tvl: mockCrucibles[crucibleIndex].tvl - baseToWithdraw,
          apyEarnedByUsers: apyEarnedUSD
        };
      }
      
      // Update user balances - kill pTokens and return USDC
      setUserBalances(prev => {
        const current = prev[crucibleId] || {
          ptokenBalance: BigInt(0),
          baseDeposited: 0,
          estimatedBaseValue: BigInt(0),
          apyEarnedUSD: 0
        };
        
        const userApyEarned = feeAmount * 0.33;
        
        return {
          ...prev,
          [crucibleId]: {
            ptokenBalance: BigInt(0),
            baseDeposited: 0,
            estimatedBaseValue: BigInt(0),
            apyEarnedUSD: current.apyEarnedUSD + userApyEarned
          }
        };
      });
      
      // Trigger re-render
      setCrucibleUpdateTrigger(prev => prev + 1);
      
      console.log(`Withdrew ${usdcAmount.toFixed(2)} USDC from ${crucibleId} (${(UNWRAP_FEE_RATE * 100).toFixed(2)}% fee: ${feeAmount.toFixed(2)})`);
    }
  }, []);

  const unwrapTokens = useCallback(async (crucibleId: string, amount: string) => {
    const crucible = getUpdatedCrucibles().find(c => c.id === crucibleId);
    if (crucible && crucible.exchangeRate) {
      const ptokenAmount = parseAmount(amount);
      const baseAmount = computeFogoOut(ptokenAmount, crucible.exchangeRate);
      const baseToWithdraw = Number(formatAmount(baseAmount));
      
      // Calculate unwrap fee
      const feeAmount = baseToWithdraw * UNWRAP_FEE_RATE;
      const netAmount = baseToWithdraw - feeAmount;

      // Update crucible stats - burn tokens
      const crucibleIndex = mockCrucibles.findIndex(c => c.id === crucibleId);
      if (crucibleIndex !== -1) {
        mockCrucibles[crucibleIndex] = {
          ...mockCrucibles[crucibleIndex],
          totalWrapped: (mockCrucibles[crucibleIndex].totalWrapped || BigInt(0)) - ptokenAmount, // Burn the cTokens
          tvl: mockCrucibles[crucibleIndex].tvl - baseToWithdraw, // Decrease TVL by the full amount withdrawn
        };
      }
      
      // Calculate APY earnings based on exchange rate growth
      // The difference between current exchange rate and initial rate (1.045) is the APY earned
      const initialExchangeRate = 1.045 // Initial rate when position was opened
      const currentExchangeRate = Number(crucible.exchangeRate) / Number(RATE_SCALE)
      const exchangeRateGrowth = currentExchangeRate - initialExchangeRate
      const apyEarnedTokens = baseToWithdraw * (exchangeRateGrowth / currentExchangeRate) // APY earned in base tokens
      
      // Total amount to return = net amount (after fee) + APY earnings
      const totalAmountToReturn = netAmount + apyEarnedTokens
      
      // Update user balances - subtract pTokens that were unwrapped and return base tokens
      setUserBalances(prev => {
        const current = prev[crucibleId] || {
          ptokenBalance: BigInt(0),
          baseDeposited: 0,
          estimatedBaseValue: BigInt(0),
          apyEarnedUSD: 0,
          depositTimestamp: undefined
        };
        
        // Calculate new ptoken balance after unwrap
        const newPTokenBalance = current.ptokenBalance > ptokenAmount 
          ? current.ptokenBalance - ptokenAmount 
          : BigInt(0);
        
        // Calculate proportional baseDeposited and estimatedBaseValue to subtract
        const ptokenBalanceNumber = Number(current.ptokenBalance) || 1
        const proportionUnwrapped = Number(ptokenAmount) / ptokenBalanceNumber
        const newBaseDeposited = current.ptokenBalance > ptokenAmount 
          ? current.baseDeposited * (1 - proportionUnwrapped)
          : 0
        const newEstimatedBaseValue = current.ptokenBalance > ptokenAmount
          ? BigInt(Math.floor(Number(current.estimatedBaseValue) * (1 - proportionUnwrapped)))
          : BigInt(0)
        
        const baseTokenPrice = crucible.baseToken === 'FORGE' ? 0.002 : 200; // Approx prices for demo
        return {
          ...prev,
          [crucibleId]: {
            ptokenBalance: newPTokenBalance, // Subtract unwrapped amount
            baseDeposited: newBaseDeposited, // Proportional base deposited
            estimatedBaseValue: newEstimatedBaseValue, // Proportional estimated value
            apyEarnedUSD: current.apyEarnedUSD + (apyEarnedTokens * baseTokenPrice), // Track APY earnings in USD
            depositTimestamp: newPTokenBalance > 0 ? current.depositTimestamp : undefined // Keep timestamp if position still open
          }
        };
      });
      
      // Trigger re-render
      setCrucibleUpdateTrigger(prev => prev + 1);
      
      // Return the total amount including APY earnings
      return {
        baseAmount: totalAmountToReturn,
        apyEarned: apyEarnedTokens,
        feeAmount: feeAmount
      }
    }
    return null
  }, []);


  const refreshCrucibleData = useCallback(async (crucibleId: string) => {
    // In a real implementation, this would fetch fresh data
  }, []);

  const getCrucible = useCallback((crucibleId: string): CrucibleData | undefined => {
    return getUpdatedCrucibles().find(c => c.id === crucibleId);
  }, []);

  const calculateWrapPreview = useCallback((crucibleId: string, baseAmount: string) => {
    const crucible = getCrucible(crucibleId);
    if (!crucible || !crucible.exchangeRate) {
      return { ptokenAmount: '0', estimatedValue: '0' };
    }

    const baseDeposited = parseFloat(baseAmount);
    
    // Calculate wrap fee
    const feeAmount = baseDeposited * WRAP_FEE_RATE;
    const netAmount = baseDeposited - feeAmount;
    
    // Calculate cTokens based on net amount (after fee deduction)
    const netAmountBigInt = parseAmount(netAmount.toString());
    const ptokenAmount = computePMint(netAmountBigInt, crucible.exchangeRate);
    const estimatedValue = getEstimatedFogoValue(ptokenAmount, crucible.exchangeRate);

    return {
      ptokenAmount: formatAmount(ptokenAmount),
      estimatedValue: formatAmount(estimatedValue)
    };
  }, []);

  const calculateUnwrapPreview = useCallback((crucibleId: string, ptokenAmount: string) => {
    const crucible = getCrucible(crucibleId);
    if (!crucible || !crucible.exchangeRate) {
      return { baseAmount: '0', estimatedValue: '0' };
    }

    const amount = parseAmount(ptokenAmount);
    const baseAmount = computeFogoOut(amount, crucible.exchangeRate);
    const baseToWithdraw = Number(formatAmount(baseAmount));
    
    // Calculate unwrap fee
    const feeAmount = baseToWithdraw * UNWRAP_FEE_RATE;
    const netAmount = baseToWithdraw - feeAmount;

    return {
      baseAmount: netAmount.toFixed(2),
      estimatedValue: netAmount.toFixed(2)
    };
  }, []);

  // Update crucible TVL directly (for leveraged positions)
  const updateCrucibleTVL = useCallback((crucibleId: string, amountUSD: number) => {
    const crucibleIndex = mockCrucibles.findIndex(c => c.id === crucibleId);
    if (crucibleIndex >= 0) {
      mockCrucibles[crucibleIndex] = {
        ...mockCrucibles[crucibleIndex],
        tvl: Math.max(0, mockCrucibles[crucibleIndex].tvl + amountUSD)
      };
      // Trigger re-render
      setCrucibleUpdateTrigger(prev => prev + 1);
      console.log(`✅ Updated crucible TVL for ${crucibleId}: ${mockCrucibles[crucibleIndex].tvl}`);
    }
  }, []);

  // Track leveraged/LP position for exchange rate growth (like normal wrap)
  const trackLeveragedPosition = useCallback((crucibleId: string, baseAmount: number) => {
    const crucible = getUpdatedCrucibles().find(c => c.id === crucibleId);
    if (!crucible || !crucible.exchangeRate) return;

    const netAmount = baseAmount;

    // Calculate cTokens (same as wrapTokens)
    const netAmountBigInt = parseAmount(netAmount.toString());
    const ptokenAmount = computePMint(netAmountBigInt, crucible.exchangeRate);

    // Update user balances (same as wrapTokens does)
    setUserBalances(prev => {
      const current = prev[crucibleId] || {
        ptokenBalance: BigInt(0),
        baseDeposited: 0,
        estimatedBaseValue: BigInt(0),
        apyEarnedUSD: 0,
        depositTimestamp: undefined
      };
      
      // Set deposit timestamp if this is the first deposit for this crucible
      const depositTimestamp = current.depositTimestamp || Date.now();
      
      return {
        ...prev,
        [crucibleId]: {
          // CRITICAL: Do NOT add to ptokenBalance for leveraged positions
          // The cTOKENS are locked in the LP pair, not available as separate tokens
          // If we add to ptokenBalance, it will show up in "cTOKENS" section instead of "cTOKENS/USDC"
          ptokenBalance: current.ptokenBalance, // Keep existing balance unchanged
          baseDeposited: current.baseDeposited + netAmount, // Track for exchange rate growth
          estimatedBaseValue: current.estimatedBaseValue + BigInt(Math.floor(netAmount * 1e9)),
          apyEarnedUSD: current.apyEarnedUSD,
          depositTimestamp
        }
      };
    });

    // Update crucible stats (same as wrapTokens)
    const crucibleIndex = mockCrucibles.findIndex(c => c.id === crucibleId);
    if (crucibleIndex >= 0) {
      mockCrucibles[crucibleIndex] = {
        ...mockCrucibles[crucibleIndex],
        totalWrapped: (mockCrucibles[crucibleIndex].totalWrapped || BigInt(0)) + ptokenAmount,
        tvl: mockCrucibles[crucibleIndex].tvl + baseAmount,
      };
    }

    // Trigger re-render
    setCrucibleUpdateTrigger(prev => prev + 1);
  }, []);

  const crucibles = useMemo(() => getUpdatedCrucibles(), [crucibleUpdateTrigger, userBalances])

  const value: CrucibleHookReturn = useMemo(() => ({
    crucibles,
    loading: false,
    error: null,
    wrapTokens,
    unwrapTokens,
    unwrapTokensToUSDC,
    refreshCrucibleData,
    getCrucible,
    calculateWrapPreview,
    calculateUnwrapPreview,
    trackLeveragedPosition,
    updateCrucibleTVL,
    userBalances
  }), [crucibles, wrapTokens, unwrapTokens, unwrapTokensToUSDC, refreshCrucibleData, getCrucible, calculateWrapPreview, calculateUnwrapPreview, trackLeveragedPosition, updateCrucibleTVL, userBalances])

  return (
    <CrucibleContext.Provider value={value}>
      {children}
    </CrucibleContext.Provider>
  );
};

// Hook to use the context
export const useCrucible = (): CrucibleHookReturn => {
  const context = useContext(CrucibleContext);
  if (!context) {
    throw new Error('useCrucible must be used within a CrucibleProvider');
  }
  return context;
};