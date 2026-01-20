import React, { createContext, useContext, ReactNode, useState, useCallback, useMemo, useEffect } from 'react';
import { PublicKey, Connection } from '@solana/web3.js';
import { 
  computePMint, 
  computeForgeOut, 
  calculateAPY, 
  formatAmount, 
  parseAmount,
  getEstimatedForgeValue,
  getExchangeRateDecimal,
  RATE_SCALE 
} from '../utils/math';
import { calculateVolatilityFarmingMetrics, CRUCIBLE_CONFIGS, DEFAULT_CONFIG, formatAPY, formatCurrency } from '../utils/volatilityFarming';
import {
  WRAP_FEE_RATE,
  UNWRAP_FEE_RATE,
  INFERNO_OPEN_FEE_RATE,
} from '../config/fees';
import { getCruciblesProgram, AnchorWallet } from '../utils/anchorProgram';
import { deriveCruciblePDA } from '../utils/cruciblePdas';
import { SOLANA_TESTNET_CONFIG, DEPLOYED_ACCOUNTS } from '../config/solana-testnet';
import { useWallet } from '../contexts/WalletContext';
import { usePrice } from '../contexts/PriceContext';
import { fetchCTokenBalance, fetchAllUserPositions, type AllUserPositions } from '../utils/positionFetcher';
import { fetchCrucibleDirect, calculateTVL, getExchangeRateDecimal as getExchangeRateFromCrucible, createDevnetConnection, fetchVaultBalance, fetchCTokenSupply, calculateRealExchangeRate, calculateYieldPercentage } from '../utils/crucibleFetcher';

export interface CrucibleData {
  id: string;
  name: string;
  symbol: string;
  baseToken: 'SOL';
  ptokenSymbol: 'cSOL';
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
  totalBaseDeposited?: bigint; // Total net base tokens deposited (in lamports)
  vaultBalance?: bigint; // Current vault balance (in lamports)
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

// Calculate volatility farming metrics for SOL crucible
const solMetrics = calculateVolatilityFarmingMetrics(CRUCIBLE_CONFIGS[0], DEFAULT_CONFIG);

// Initial crucible data - will be populated from on-chain
// All values start at 0/empty and get fetched from the blockchain
const initialCrucibles: CrucibleData[] = [
  {
    id: 'sol-crucible',
    name: 'Solana',
    symbol: 'SOL',
    baseToken: 'SOL',
    ptokenSymbol: 'cSOL',
    tvl: 0, // Will be fetched from on-chain
    apr: solMetrics.apyCompounded, // Compounded APY from volatility farming
    status: 'active',
    userDeposit: 0,
    userShares: 0,
    icon: '/solana-sol-logo.png',
    ptokenMint: DEPLOYED_ACCOUNTS.CSOL_MINT, // Deployed cSOL mint on devnet
    exchangeRate: BigInt(1_000_000), // Initial exchange rate: 1.0 (will be fetched from on-chain)
    totalWrapped: BigInt(0), // Will be fetched from on-chain
    userPtokenBalance: BigInt(0),
    estimatedBaseValue: BigInt(0),
    currentAPY: solMetrics.apyCompounded * 100, // Convert to percentage
    totalFeesCollected: 0, // Will be fetched from on-chain
    apyEarnedByUsers: solMetrics.crucibleHoldersShare * 365, // Annual crucible holders yield
    totalDeposited: 0,
    totalWithdrawn: 0
  }
];

// Create context with default values
const CrucibleContext = createContext<CrucibleHookReturn>({
  crucibles: initialCrucibles,
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
  const { connection, publicKey } = useWallet()
  const { solPrice } = usePrice()
  
  // Loading state - true until first on-chain fetch completes
  const [loading, setLoading] = useState(true)
  
  // State to track user interactions
  const [userBalances, setUserBalances] = useState<Record<string, {
    ptokenBalance: bigint;
    baseDeposited: number;
    estimatedBaseValue: bigint;
    apyEarnedUSD: number; // Track APY earned in USD per user
    depositTimestamp?: number; // Timestamp when position was opened
  }>>({});
  
  // State for on-chain crucible data
  const [onChainCrucibleData, setOnChainCrucibleData] = useState<CrucibleData | null>(null)
  
  // State to trigger re-renders when crucible data changes
  const [crucibleUpdateTrigger, setCrucibleUpdateTrigger] = useState(0);
  
  // Fetch crucible data from on-chain using direct fetcher (bypasses Anchor IDL issues)
  const fetchCrucibleData = useCallback(async () => {
    // Use provided connection or create a devnet connection for read-only fetch
    const conn = connection || createDevnetConnection()
    
    try {
      console.log('🔄 Fetching crucible data from on-chain...')
      
      // Use direct fetcher - bypasses Anchor IDL issues entirely
      const crucibleAccount = await fetchCrucibleDirect(conn)
      
      if (!crucibleAccount) {
        console.log('⚠️ Crucible account not found on-chain (may not be initialized yet)')
        return
      }
      
      // Fetch vault balance and cToken supply to calculate REAL exchange rate
      const vaultBalance = await fetchVaultBalance(conn, DEPLOYED_ACCOUNTS.SOL_VAULT)
      const ctokenSupply = await fetchCTokenSupply(conn, DEPLOYED_ACCOUNTS.CSOL_MINT)
      
      // Calculate REAL exchange rate from vault balance / ctoken supply
      // This is the actual yield-generating rate, not the stored initial rate
      const realExchangeRate = calculateRealExchangeRate(vaultBalance, ctokenSupply)
      const yieldPercentage = calculateYieldPercentage(realExchangeRate)
      
      // Calculate TVL from vault balance (actual SOL in the vault)
      const solPriceUSD = solPrice // Use real-time SOL price from CoinGecko
      const tvlFromVault = Number(vaultBalance) / 1e9 * solPriceUSD
      const tvlFromDeposited = calculateTVL(crucibleAccount, solPriceUSD)
      
      // Use vault balance for TVL (more accurate as it includes fees)
      const tvl = tvlFromVault > 0 ? tvlFromVault : tvlFromDeposited
      
      // Calculate APY metrics (handle NaN/Infinity from division by zero when TVL is 0)
      const solMetrics = calculateVolatilityFarmingMetrics(CRUCIBLE_CONFIGS[0], DEFAULT_CONFIG)
      const safeApyCompounded = isNaN(solMetrics.apyCompounded) || !isFinite(solMetrics.apyCompounded) 
        ? 0.08 // Default 8% APY when can't calculate
        : solMetrics.apyCompounded
      
      // Calculate real exchange rate as BigInt scaled by 1_000_000
      const realExchangeRateBigInt = ctokenSupply > BigInt(0) 
        ? (vaultBalance * BigInt(1_000_000)) / ctokenSupply 
        : BigInt(1_000_000)
      
      // APY should be based on fee generation rate (volatility farming), NOT exchange rate
      // Exchange rate-based APY is incorrect because users can deposit at different rates
      // Use volatility farming metrics which calculate APY from fee generation rate
      const effectiveApr = safeApyCompounded // Use fee-based APY, not exchange rate-based
      
      const crucibleData: CrucibleData = {
        id: 'sol-crucible',
        name: 'Solana',
        symbol: 'SOL',
        baseToken: 'SOL',
        ptokenSymbol: 'cSOL',
        tvl: tvl, // Real TVL from vault balance
        apr: effectiveApr, // Use effective APR (real yield or estimated)
        status: crucibleAccount.paused ? 'paused' : 'active',
        userDeposit: 0,
        userShares: 0,
        icon: '/solana-sol-logo.png',
        ptokenMint: crucibleAccount.ctokenMint.toString(),
        exchangeRate: realExchangeRateBigInt, // Use REAL calculated exchange rate
        totalWrapped: ctokenSupply, // Use fetched supply
        userPtokenBalance: BigInt(0),
        estimatedBaseValue: BigInt(0),
        currentAPY: safeApyCompounded * 100, // APY based on fee generation rate, not exchange rate
        // total_fees_accrued tracks only the 80% vault fee share
        // Total Fees = 100% of all fees (80% vault + 20% treasury) + 100% of arbitrage deposits (80% vault + 20% treasury)
        totalFeesCollected: (Number(crucibleAccount.totalFeesAccrued) / 1e9 * solPriceUSD) / 0.8, // 100% of fees in USD
        // Yield Earned = Vault fee share (80% of fees that generate yield for cToken holders)
        // Includes: wrap/unwrap fees (80%), LP position fees (80%), LVF position fees (80%), and arbitrage deposits (80%)
        apyEarnedByUsers: (Number(crucibleAccount.totalFeesAccrued) / 1e9 * solPriceUSD), // 80% vault fee share that generates yield (includes arbitrage revenue)
        totalDeposited: 0,
        totalWithdrawn: 0,
        totalBaseDeposited: crucibleAccount.totalBaseDeposited, // Total net deposits
        vaultBalance: vaultBalance, // Current vault balance
      }
      
      console.log('✅ On-chain crucible data:', {
        tvl: crucibleData.tvl,
        vaultBalance: Number(vaultBalance) / 1e9,
        ctokenSupply: Number(ctokenSupply) / 1e9,
        realExchangeRate: realExchangeRate,
        yieldPercentage: yieldPercentage.toFixed(2) + '%',
        storedExchangeRate: Number(crucibleAccount.exchangeRate) / 1e6,
        totalBaseDeposited: Number(crucibleAccount.totalBaseDeposited) / 1e9,
        totalFeesAccrued: Number(crucibleAccount.totalFeesAccrued) / 1e9,
        paused: crucibleAccount.paused,
      })
      
      setOnChainCrucibleData(crucibleData)
      setLoading(false) // First fetch complete
      
      // Fetch user's cToken balance from on-chain if wallet connected
      if (publicKey && conn) {
        try {
          const cruciblePDA = new PublicKey(DEPLOYED_ACCOUNTS.SOL_CRUCIBLE)
          const cTokenBalance = await fetchCTokenBalance(conn, publicKey, cruciblePDA)
          
          if (cTokenBalance && cTokenBalance.balance > BigInt(0)) {
            console.log('✅ Fetched user cToken balance from on-chain:', {
              balance: cTokenBalance.balance.toString(),
              estimatedBaseValue: cTokenBalance.estimatedBaseValue.toString(),
            })
            
            // Update userBalances with on-chain data
            setUserBalances(prev => {
              const current = prev['sol-crucible'] || {
                ptokenBalance: BigInt(0),
                baseDeposited: 0,
                estimatedBaseValue: BigInt(0),
                apyEarnedUSD: 0,
                depositTimestamp: undefined
              }
              
              // Calculate base deposited from cToken balance and exchange rate
              const baseDeposited = Number(cTokenBalance.estimatedBaseValue) / 1e9
              
              return {
                ...prev,
                ['sol-crucible']: {
                  ptokenBalance: cTokenBalance.balance,
                  baseDeposited: baseDeposited,
                  estimatedBaseValue: cTokenBalance.estimatedBaseValue,
                  apyEarnedUSD: current.apyEarnedUSD, // Preserve any locally tracked APY
                  depositTimestamp: current.depositTimestamp // Preserve timestamp
                }
              }
            })
          }
        } catch (balanceError: any) {
          // Check if it's an account not found error - this is normal if crucible or account doesn't exist
          const errorMessage = balanceError?.message || balanceError?.toString() || ''
          if (errorMessage.includes('could not find') || 
              errorMessage.includes('Account does not exist') ||
              errorMessage.includes('Account not found') ||
              errorMessage.includes('crucible')) {
            // Silently handle - this is normal if crucible or account doesn't exist
            console.log('No cToken balance found for user (this is normal if no position exists)')
          } else {
            // Log other errors for debugging
            console.warn('Error fetching cToken balance for user:', {
              publicKey: publicKey?.toString(),
              error: balanceError?.message,
              errorDetails: balanceError
            })
          }
        }
      }
    } catch (error) {
      console.error('❌ Error fetching crucible data:', error)
      // No mock fallback - show real state (empty/loading)
      setLoading(false) // Even on error, stop loading
    }
  }, [connection, publicKey, solPrice])
  
  // Fetch crucible data on mount and when connection changes
  useEffect(() => {
    fetchCrucibleData()
    const interval = setInterval(() => {
      fetchCrucibleData()
      setCrucibleUpdateTrigger(prev => prev + 1)
    }, 30000) // Fetch every 30 seconds
    
    // Listen for deposit events to refresh immediately
    const handleDeposit = () => {
      console.log('🔄 Deposit event received, refreshing crucible data...')
      // Wait a bit for the transaction to confirm
      setTimeout(() => {
        fetchCrucibleData()
      }, 2000)
    }
    
    // Listen for arbitrage profit deposits
    const handleArbitrageDeposit = () => {
      console.log('🔄 Arbitrage deposit event received, refreshing crucible data...')
      // Wait a bit for the transaction to confirm
      setTimeout(() => {
        fetchCrucibleData()
      }, 2000)
    }
    
    window.addEventListener('depositComplete', handleDeposit)
    window.addEventListener('wrapPositionOpened', handleDeposit)
    window.addEventListener('arbitrageProfitDeposited', handleArbitrageDeposit)
    
    return () => {
      clearInterval(interval)
      window.removeEventListener('depositComplete', handleDeposit)
      window.removeEventListener('wrapPositionOpened', handleDeposit)
      window.removeEventListener('arbitrageProfitDeposited', handleArbitrageDeposit)
    }
  }, [fetchCrucibleData])

  // Get updated crucibles - use on-chain data if available, otherwise use mock
  const getUpdatedCrucibles = (): CrucibleData[] => {
    // Use on-chain data if available, otherwise fall back to mock
    const crucibleToUse = onChainCrucibleData || initialCrucibles[0]
    
    return [crucibleToUse].map(crucible => {
      const userBalance = userBalances[crucible.id] || {
        ptokenBalance: BigInt(0),
        baseDeposited: 0,
        estimatedBaseValue: BigInt(0),
        apyEarnedUSD: 0
      };
      
      // Use actual on-chain exchange rate (no frontend simulation)
      // Exchange rate grows as fees accrue on-chain
      let dynamicExchangeRate = crucible.exchangeRate || RATE_SCALE;
      
      return {
        ...crucible,
        exchangeRate: dynamicExchangeRate,
        currentAPY: crucible.apr * 100,
        userPtokenBalance: userBalance.ptokenBalance,
        userDeposit: userBalance.baseDeposited,
        estimatedBaseValue: userBalance.estimatedBaseValue,
        apyEarnedByUsers: crucible.apyEarnedByUsers || 0
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
      const crucibleIndex = initialCrucibles.findIndex(c => c.id === crucibleId);
      if (crucibleIndex !== -1) {
        initialCrucibles[crucibleIndex] = {
          ...initialCrucibles[crucibleIndex],
          // Don't update exchangeRate here - it's calculated dynamically in getUpdatedCrucibles
          totalWrapped: (initialCrucibles[crucibleIndex].totalWrapped || BigInt(0)) + ptokenAmount,
          tvl: initialCrucibles[crucibleIndex].tvl + baseDeposited, // TVL includes fees
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
      const baseAmount = computeForgeOut(ptokenAmount, crucible.exchangeRate);
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
      const crucibleIndex = initialCrucibles.findIndex(c => c.id === crucibleId);
      if (crucibleIndex !== -1) {
        initialCrucibles[crucibleIndex] = {
          ...initialCrucibles[crucibleIndex],
          totalFeesCollected: totalFees,
          totalWrapped: (initialCrucibles[crucibleIndex].totalWrapped || BigInt(0)) - ptokenAmount,
          tvl: initialCrucibles[crucibleIndex].tvl - baseToWithdraw,
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
      const baseAmount = computeForgeOut(ptokenAmount, crucible.exchangeRate);
      const baseToWithdraw = Number(formatAmount(baseAmount));
      
      // Calculate unwrap fee
      const feeAmount = baseToWithdraw * UNWRAP_FEE_RATE;
      const netAmount = baseToWithdraw - feeAmount;

      // Update crucible stats - burn tokens
      const crucibleIndex = initialCrucibles.findIndex(c => c.id === crucibleId);
      if (crucibleIndex !== -1) {
        initialCrucibles[crucibleIndex] = {
          ...initialCrucibles[crucibleIndex],
          totalWrapped: (initialCrucibles[crucibleIndex].totalWrapped || BigInt(0)) - ptokenAmount, // Burn the cTokens
          tvl: initialCrucibles[crucibleIndex].tvl - baseToWithdraw, // Decrease TVL by the full amount withdrawn
        };
      }
      
      // Calculate APY earnings based on exchange rate growth
      // The difference between current exchange rate and initial rate (1.0) is the APY earned
      const initialExchangeRate = 1.0 // Initial rate when position was opened
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
        
        const baseTokenPrice = solPrice; // Use real-time SOL price from CoinGecko
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
  }, [crucibleUpdateTrigger, userBalances, onChainCrucibleData]);

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
    const estimatedValue = getEstimatedForgeValue(ptokenAmount, crucible.exchangeRate);

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
    const baseAmount = computeForgeOut(amount, crucible.exchangeRate);
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
    const crucibleIndex = initialCrucibles.findIndex(c => c.id === crucibleId);
    if (crucibleIndex >= 0) {
      initialCrucibles[crucibleIndex] = {
        ...initialCrucibles[crucibleIndex],
        tvl: Math.max(0, initialCrucibles[crucibleIndex].tvl + amountUSD)
      };
      // Trigger re-render
      setCrucibleUpdateTrigger(prev => prev + 1);
      console.log(`✅ Updated crucible TVL for ${crucibleId}: ${initialCrucibles[crucibleIndex].tvl}`);
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
    const crucibleIndex = initialCrucibles.findIndex(c => c.id === crucibleId);
    if (crucibleIndex >= 0) {
      initialCrucibles[crucibleIndex] = {
        ...initialCrucibles[crucibleIndex],
        totalWrapped: (initialCrucibles[crucibleIndex].totalWrapped || BigInt(0)) + ptokenAmount,
        tvl: initialCrucibles[crucibleIndex].tvl + baseAmount,
      };
    }

    // Trigger re-render
    setCrucibleUpdateTrigger(prev => prev + 1);
  }, []);

  // CRITICAL: Include onChainCrucibleData in dependencies so crucibles updates when on-chain data is fetched
  const crucibles = useMemo(() => getUpdatedCrucibles(), [crucibleUpdateTrigger, userBalances, onChainCrucibleData])

  const value: CrucibleHookReturn = useMemo(() => ({
    crucibles,
    loading,
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
  }), [crucibles, loading, wrapTokens, unwrapTokens, unwrapTokensToUSDC, refreshCrucibleData, getCrucible, calculateWrapPreview, calculateUnwrapPreview, trackLeveragedPosition, updateCrucibleTVL, userBalances])

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