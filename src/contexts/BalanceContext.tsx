import React, { createContext, useContext, useState, ReactNode, useCallback, useMemo } from 'react';

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
  wrappedFogo: number;
  addWrappedFogo: (amount: number) => void;
  subtractWrappedFogo: (amount: number) => void;
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
  const [balances, setBalances] = useState<TokenBalance[]>([
    { symbol: 'SOL', amount: 25, usdValue: 5000 }, // Start with 25 SOL ($5,000 at $200 each)
    { symbol: 'FORGE', amount: 5000, usdValue: 10 }, // Start with 5,000 FORGE ($10 at $0.002 each)
    { symbol: 'cSOL', amount: 0, usdValue: 0 }, // Start with 0 cSOL
    { symbol: 'cFORGE', amount: 0, usdValue: 0 }, // Start with 0 cFORGE (worth $0.0025 each)
    { symbol: 'USDC', amount: 10000, usdValue: 10000 }, // Start with 10,000 USDC
    { symbol: 'ETH', amount: 0, usdValue: 0 }, // Start with 0 ETH
    { symbol: 'BTC', amount: 0, usdValue: 0 }, // Start with 0 BTC
    { symbol: 'cSOL/USDC LP', amount: 0, usdValue: 0 }, // Initialize LP tokens to 0
    { symbol: 'cFORGE/USDC LP', amount: 0, usdValue: 0 }, // Initialize LP tokens to 0
  ]);
  
  const [wrappedFogo, setWrappedFogo] = useState<number>(0);

  const getTokenPrice = useCallback((symbol: string): number => {
    const prices: { [key: string]: number } = {
      'SOL': 200,
      'FORGE': 0.002,
      'cSOL': 209,  // cSOL is worth more than SOL due to accumulated value (SOL price * 1.045)
      'cFORGE': 0.0025, // cFORGE is worth more than FORGE due to accumulated value
      'USDC': 1,
      'ETH': 4000,
      'BTC': 110000,
      'SPARK': 0.1,
      'HEAT': 0.05,
      'cSOL/USDC LP': 1.0, // LP token price (calculated from underlying assets)
      'cFORGE/USDC LP': 1.0, // LP token price (calculated from underlying assets)
    };
    return prices[symbol] || 0;
  }, []);

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

  const addWrappedFogo = useCallback((amount: number) => {
    setWrappedFogo(prev => prev + amount);
  }, []);

  const subtractWrappedFogo = useCallback((amount: number) => {
    setWrappedFogo(prev => Math.max(0, prev - amount));
  }, []);

  const contextValue = useMemo(() => ({
    balances,
    updateBalance,
    addToBalance,
    subtractFromBalance,
    getBalance,
    wrappedFogo,
    addWrappedFogo,
    subtractWrappedFogo,
  }), [balances, updateBalance, addToBalance, subtractFromBalance, wrappedFogo, addWrappedFogo, subtractWrappedFogo]);

  return (
    <BalanceContext.Provider value={contextValue}>
      {children}
    </BalanceContext.Provider>
  );
};
