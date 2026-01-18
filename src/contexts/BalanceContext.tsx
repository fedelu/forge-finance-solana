import React, { createContext, useContext, useState, ReactNode, useCallback, useMemo, useEffect } from 'react';
import { usePrice } from './PriceContext';
import { useWallet } from './WalletContext';
import { PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddress } from '@solana/spl-token';
import { SOLANA_TESTNET_CONFIG } from '../config/solana-testnet';

interface TokenBalance {
  symbol: string;
  amount: number;
  usdValue: number;
}

interface BalanceContextType {
  balances: TokenBalance[];
  updateBalance: (symbol: string, amount: number) => void;
  addToBalance: (symbol: string, amount: number) => void;
  subtractFromBalance: (symbol: string, amount: number) => void;
  getBalance: (symbol: string) => number;
  wrappedForge: number;
  addWrappedForge: (amount: number) => void;
  subtractWrappedForge: (amount: number) => void;
}

const BalanceContext = createContext<BalanceContextType | undefined>(undefined);

export const useBalance = () => {
  const context = useContext(BalanceContext);
  if (!context) {
    throw new Error('useBalance must be used within a BalanceProvider');
  }
  return context;
};

interface BalanceProviderProps {
  children: ReactNode;
}

export const BalanceProvider: React.FC<BalanceProviderProps> = ({ children }) => {
  const { solPrice } = usePrice();
  const { connection, publicKey, connected } = useWallet();
  const [balances, setBalances] = useState<TokenBalance[]>([
    { symbol: 'SOL', amount: 25, usdValue: 5000 }, // Start with 25 SOL (will be recalculated with real price)
    { symbol: 'FORGE', amount: 5000, usdValue: 10 }, // Start with 5,000 FORGE ($10 at $0.002 each)
    { symbol: 'cSOL', amount: 0, usdValue: 0 }, // Start with 0 cSOL
    { symbol: 'cFORGE', amount: 0, usdValue: 0 }, // Start with 0 cFORGE (worth $0.0025 each)
    { symbol: 'USDC', amount: 0, usdValue: 0 }, // Will be fetched from wallet
    { symbol: 'ETH', amount: 0, usdValue: 0 }, // Start with 0 ETH
    { symbol: 'BTC', amount: 0, usdValue: 0 }, // Start with 0 BTC
    { symbol: 'cSOL/USDC LP', amount: 0, usdValue: 0 }, // Initialize LP tokens to 0
    { symbol: 'cFORGE/USDC LP', amount: 0, usdValue: 0 }, // Initialize LP tokens to 0
  ]);
  
  const [wrappedForge, setWrappedForge] = useState<number>(0);

  // Fetch USDC balance from wallet
  useEffect(() => {
    const fetchUSDCBalance = async () => {
      if (!connection || !publicKey || !connected) {
        // Reset to 0 when wallet is disconnected
        updateBalance('USDC', 0);
        return;
      }

      try {
        const usdcMint = new PublicKey(SOLANA_TESTNET_CONFIG.TOKEN_ADDRESSES.USDC);
        const userUsdcAccount = await getAssociatedTokenAddress(usdcMint, publicKey);
        
        // Check if token account exists
        const accountInfo = await connection.getAccountInfo(userUsdcAccount);
        if (!accountInfo) {
          // Token account doesn't exist, balance is 0
          updateBalance('USDC', 0);
          return;
        }

        // Get token account balance
        const balance = await connection.getTokenAccountBalance(userUsdcAccount);
        if (balance.value) {
          // USDC has 6 decimals
          const usdcAmount = Number(balance.value.amount) / 1e6;
          updateBalance('USDC', usdcAmount);
        } else {
          updateBalance('USDC', 0);
        }
      } catch (error) {
        console.error('Error fetching USDC balance:', error);
        // On error, keep current balance or set to 0
        updateBalance('USDC', 0);
      }
    };

    fetchUSDCBalance();

    // Refresh balance every 10 seconds when wallet is connected
    const interval = connected ? setInterval(fetchUSDCBalance, 10000) : null;
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [connection, publicKey, connected, updateBalance]);

  const getTokenPrice = useCallback((symbol: string): number => {
    // Base prices - cToken prices should be dynamically calculated from on-chain exchange rate
    // cToken price = base token price * exchange_rate
    // Initial exchange rate is 1.0, so initially cSOL price = SOL price
    const prices: { [key: string]: number } = {
      'SOL': solPrice, // Use real-time SOL price from CoinGecko
      'FORGE': 0.002,
      'cSOL': solPrice,  // Initial: same as SOL (exchange rate 1.0). In production, fetch from crucible.exchangeRate
      'cFORGE': 0.002, // Initial: same as FORGE (exchange rate 1.0). In production, fetch from crucible.exchangeRate
      'USDC': 1,
      'ETH': 4000,
      'BTC': 110000,
      'SPARK': 0.1,
      'HEAT': 0.05,
      'cSOL/USDC LP': 1.0, // LP token price (calculated from underlying assets)
      'cFORGE/USDC LP': 1.0, // LP token price (calculated from underlying assets)
    };
    return prices[symbol] || 0;
  }, [solPrice]);

  const updateBalance = useCallback((symbol: string, amount: number) => {
    setBalances(prev => {
      const existingIndex = prev.findIndex(b => b.symbol === symbol);
      if (existingIndex >= 0) {
        const newBalances = [...prev];
        newBalances[existingIndex] = {
          ...newBalances[existingIndex],
          amount,
          usdValue: amount * getTokenPrice(symbol)
        };
        return newBalances;
      } else {
        return [...prev, { symbol, amount, usdValue: amount * getTokenPrice(symbol) }];
      }
    });
  }, [getTokenPrice]);

  const addToBalance = useCallback((symbol: string, amount: number) => {
    console.log(`BalanceContext: Adding ${amount} ${symbol}`);
    setBalances(prev => {
      const existingIndex = prev.findIndex(b => b.symbol === symbol);
      if (existingIndex >= 0) {
        const newBalances = [...prev];
        const newAmount = newBalances[existingIndex].amount + amount;
        newBalances[existingIndex] = {
          ...newBalances[existingIndex],
          amount: newAmount,
          usdValue: newAmount * getTokenPrice(symbol)
        };
        console.log(`BalanceContext: Updated ${symbol} to ${newAmount}`);
        return newBalances;
      } else {
        console.log(`BalanceContext: Added new token ${symbol} with amount ${amount}`);
        return [...prev, { symbol, amount, usdValue: amount * getTokenPrice(symbol) }];
      }
    });
  }, [getTokenPrice]);

  const subtractFromBalance = useCallback((symbol: string, amount: number) => {
    console.log(`BalanceContext: Subtracting ${amount} ${symbol}`);
    setBalances(prev => {
      const existingIndex = prev.findIndex(b => b.symbol === symbol);
      if (existingIndex >= 0) {
        const newBalances = [...prev];
        const newAmount = Math.max(0, newBalances[existingIndex].amount - amount);
        newBalances[existingIndex] = {
          ...newBalances[existingIndex],
          amount: newAmount,
          usdValue: newAmount * getTokenPrice(symbol)
        };
        console.log(`BalanceContext: Updated ${symbol} to ${newAmount}`);
        return newBalances;
      }
      console.log(`BalanceContext: Token ${symbol} not found for subtraction`);
      return prev;
    });
  }, [getTokenPrice]);

  const getBalance = useCallback((symbol: string): number => {
    return balances.find(b => b.symbol === symbol)?.amount || 0;
  }, [balances]);

  const addWrappedForge = useCallback((amount: number) => {
    setWrappedForge(prev => prev + amount);
  }, []);

  const subtractWrappedForge = useCallback((amount: number) => {
    setWrappedForge(prev => Math.max(0, prev - amount));
  }, []);

  const contextValue = useMemo(() => ({
    balances,
    updateBalance,
    addToBalance,
    subtractFromBalance,
    getBalance,
    wrappedForge,
    addWrappedForge,
    subtractWrappedForge,
  }), [balances, updateBalance, addToBalance, subtractFromBalance, wrappedForge, addWrappedForge, subtractWrappedForge]);

  return (
    <BalanceContext.Provider value={contextValue}>
      {children}
    </BalanceContext.Provider>
  );
};
