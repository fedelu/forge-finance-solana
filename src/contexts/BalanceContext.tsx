import React, { createContext, useContext, useState, ReactNode, useCallback, useMemo, useEffect } from 'react';
import { usePrice } from './PriceContext';
import { useWallet } from './WalletContext';
import { PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddress, getAccount } from '@solana/spl-token';
import { SOLANA_TESTNET_CONFIG, DEPLOYED_ACCOUNTS } from '../config/solana-testnet';

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
  const { solPrice, infernoLpPrice } = usePrice();
  const { connection, publicKey, connected } = useWallet();
  const [balances, setBalances] = useState<TokenBalance[]>([
    { symbol: 'SOL', amount: 25, usdValue: 5000 }, // Start with 25 SOL (will be recalculated with real price)
    { symbol: 'FORGE', amount: 5000, usdValue: 10 }, // Start with 5,000 FORGE ($10 at $0.002 each)
    { symbol: 'cSOL', amount: 0, usdValue: 0 }, // Start with 0 cSOL
    { symbol: 'cFORGE', amount: 0, usdValue: 0 }, // Start with 0 cFORGE (worth $0.0025 each)
    { symbol: 'USDC', amount: 0, usdValue: 0 }, // Will be fetched from wallet
    { symbol: 'ETH', amount: 0, usdValue: 0 }, // Start with 0 ETH
    { symbol: 'BTC', amount: 0, usdValue: 0 }, // Start with 0 BTC
    { symbol: 'ifSOL/USDC LP', amount: 0, usdValue: 0 }, // Inferno LP tokens
    { symbol: 'cFORGE/USDC LP', amount: 0, usdValue: 0 }, // Initialize LP tokens to 0
  ]);
  
  const [wrappedForge, setWrappedForge] = useState<number>(0);

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
      'ifSOL/USDC LP': infernoLpPrice ?? 0, // Inferno LP price from oracle
      'cFORGE/USDC LP': 0.002 * 2, // LP token price = FORGE price * 2 (represents FORGE + USDC pair)
    };
    return prices[symbol] || 0;
  }, [solPrice, infernoLpPrice]);

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
        return newBalances;
      } else {
        return [...prev, { symbol, amount, usdValue: amount * getTokenPrice(symbol) }];
      }
    });
  }, [getTokenPrice]);

  const subtractFromBalance = useCallback((symbol: string, amount: number) => {
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
        return newBalances;
      }
      return prev;
    });
  }, [getTokenPrice]);

  const getBalance = useCallback((symbol: string): number => {
    return balances.find(b => b.symbol === symbol)?.amount || 0;
  }, [balances]);

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
        // Use getAccount from @solana/spl-token for more reliable balance fetching
        try {
          const tokenAccount = await getAccount(connection, userUsdcAccount);
          // USDC has 6 decimals
          const usdcAmount = Number(tokenAccount.amount) / 1e6;
          updateBalance('USDC', usdcAmount);
        } catch (tokenError: any) {
          // Token account doesn't exist - this is normal if user has never received USDC
          // Check error message to confirm it's a "not found" error
          if (tokenError.name === 'TokenAccountNotFoundError' || 
              tokenError.message?.includes('Account not found') ||
              tokenError.message?.includes('could not find account') ||
              tokenError.message?.includes('InvalidAccountData')) {
            updateBalance('USDC', 0);
          } else {
            // Other error - log it but set balance to 0
            console.error('❌ Error fetching USDC token account:', tokenError);
            updateBalance('USDC', 0);
          }
        }
      } catch (error: any) {
        console.error('❌ Error fetching USDC balance:', error);
        // On error, set balance to 0
        updateBalance('USDC', 0);
      }
    };

    fetchUSDCBalance();

    const handleRefreshUSDC = () => {
      fetchUSDCBalance();
    };
    
    window.addEventListener('depositComplete', handleRefreshUSDC);
    window.addEventListener('refreshUSDCBalance', handleRefreshUSDC);
    
    return () => {
      window.removeEventListener('depositComplete', handleRefreshUSDC);
      window.removeEventListener('refreshUSDCBalance', handleRefreshUSDC);
    };
  }, [connection, publicKey, connected, updateBalance]);

  // Fetch LP token balances from on-chain
  useEffect(() => {
    const fetchLPBalances = async () => {
      if (!connection || !publicKey || !connected) {
        // Reset to 0 when wallet is disconnected
        updateBalance('ifSOL/USDC LP', 0);
        updateBalance('cFORGE/USDC LP', 0);
        return;
      }

      try {
        // Inferno LP token balance (if configured)
        if (DEPLOYED_ACCOUNTS.INFERNO_LP_MINT) {
          const infernoLpMint = new PublicKey(DEPLOYED_ACCOUNTS.INFERNO_LP_MINT);
          const infernoLpAccount = await getAssociatedTokenAddress(infernoLpMint, publicKey);
          try {
            const tokenAccount = await getAccount(connection, infernoLpAccount);
            const lpAmount = Number(tokenAccount.amount) / 1e9;
            updateBalance('ifSOL/USDC LP', lpAmount);
          } catch (tokenError: any) {
            if (tokenError.name === 'TokenAccountNotFoundError' ||
                tokenError.message?.includes('Account not found') ||
                tokenError.message?.includes('could not find account')) {
              updateBalance('ifSOL/USDC LP', 0);
            } else {
              console.error('Error fetching ifSOL/USDC LP token account:', tokenError);
              updateBalance('ifSOL/USDC LP', 0);
            }
          }
        } else {
          updateBalance('ifSOL/USDC LP', 0);
        }

        // TODO: Add FORGE crucible LP token balance fetching when FORGE crucible is deployed
        updateBalance('cFORGE/USDC LP', 0);
      } catch (error: any) {
        console.error('Error fetching LP token balances:', error);
        updateBalance('ifSOL/USDC LP', 0);
        updateBalance('cFORGE/USDC LP', 0);
      }
    };

    fetchLPBalances();

    // Listen for LP position events to refresh balance immediately
    const handleLPPositionOpened = () => {
      fetchLPBalances();
    };
    
    const handleLPPositionClosed = () => {
      fetchLPBalances();
    };
    
    const handleRefreshLPBalance = () => {
      fetchLPBalances();
    };

    window.addEventListener('lpPositionOpened', handleLPPositionOpened);
    window.addEventListener('lpPositionClosed', handleLPPositionClosed);
    window.addEventListener('infernoLpPositionOpened', handleLPPositionOpened);
    window.addEventListener('infernoLpPositionClosed', handleLPPositionClosed);
    window.addEventListener('refreshLPBalance', handleRefreshLPBalance);

    return () => {
      window.removeEventListener('lpPositionOpened', handleLPPositionOpened);
      window.removeEventListener('lpPositionClosed', handleLPPositionClosed);
      window.removeEventListener('infernoLpPositionOpened', handleLPPositionOpened);
      window.removeEventListener('infernoLpPositionClosed', handleLPPositionClosed);
      window.removeEventListener('refreshLPBalance', handleRefreshLPBalance);
    };
  }, [connection, publicKey, connected, updateBalance]);

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
