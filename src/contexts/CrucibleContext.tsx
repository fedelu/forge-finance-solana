import React, { createContext, useContext, useState, ReactNode, useCallback, useEffect } from 'react';
import { fetchCrucibleDirect, calculateTVL, createDevnetConnection } from '../utils/crucibleFetcher';
import { usePrice } from './PriceContext';

interface Crucible {
  id: string;
  name: string;
  symbol: string;
  tvl: number; // USD
  apr: number;
  status: 'active' | 'paused' | 'maintenance';
  userDeposit: number;
  userShares: number;
  icon: string;
}

interface CrucibleContextType {
  crucibles: Crucible[];
  loading: boolean;
  updateCrucibleDeposit: (crucibleId: string, amount: number) => void;
  updateCrucibleWithdraw: (crucibleId: string, amount: number) => void;
  updateCrucibleTVL: (crucibleId: string, amountUSD: number) => void;
  getCrucible: (crucibleId: string) => Crucible | undefined;
  addCrucible: (crucible: Crucible) => void;
  refreshFromOnChain: () => Promise<void>;
}

const CrucibleContext = createContext<CrucibleContextType | undefined>(undefined);

export const useCrucible = () => {
  const context = useContext(CrucibleContext);
  if (!context) {
    throw new Error('useCrucible must be used within a CrucibleProvider');
  }
  return context;
};

interface CrucibleProviderProps {
  children: ReactNode;
}

export const CrucibleProvider: React.FC<CrucibleProviderProps> = ({ children }) => {
  const { solPrice } = usePrice();
  const [loading, setLoading] = useState(true);
  const [crucibles, setCrucibles] = useState<Crucible[]>([
    {
      id: 'sol-crucible',
      name: 'Solana',
      symbol: 'SOL',
      tvl: 0, // Will be fetched from on-chain (no fake data)
      apr: 0.18, // 18% APY
      status: 'active',
      userDeposit: 0,
      userShares: 0,
      icon: '/solana-sol-logo.png'
    }
  ]);

  const price = useCallback((symbol: string) => ({ SOL: solPrice, USDC: 1, ETH: 4000, BTC: 110000 } as any)[symbol] || 1, [solPrice]);

  const updateCrucibleDeposit = useCallback((crucibleId: string, amount: number) => {
    setCrucibles(prev => {
      return prev.map(crucible => {
        if (crucible.id === crucibleId) {
          const newDeposit = crucible.userDeposit + amount;
          const newShares = crucible.userShares + amount; // 1:1 ratio for simplicity
          const newTVL = crucible.tvl + amount * price(crucible.symbol); // TVL in USD
          return {
            ...crucible,
            userDeposit: newDeposit,
            userShares: newShares,
            tvl: newTVL
          };
        }
        return crucible;
      });
    });
  }, [price]);

  const updateCrucibleWithdraw = useCallback((crucibleId: string, amount: number) => {
    setCrucibles(prev => {
      return prev.map(crucible => {
        if (crucible.id === crucibleId) {
          const newDeposit = Math.max(0, crucible.userDeposit - amount);
          const newShares = Math.max(0, crucible.userShares - amount);
          const newTVL = Math.max(0, crucible.tvl - amount * price(crucible.symbol)); // TVL in USD
          return {
            ...crucible,
            userDeposit: newDeposit,
            userShares: newShares,
            tvl: newTVL
          };
        }
        return crucible;
      });
    });
  }, [price]);

  const updateCrucibleTVL = useCallback((crucibleId: string, amountUSD: number) => {
    setCrucibles(prev => {
      return prev.map(crucible => {
        if (crucible.id === crucibleId) {
          const newTVL = Math.max(0, crucible.tvl + amountUSD); // amountUSD is already in USD
          return {
            ...crucible,
            tvl: newTVL
          };
        }
        return crucible;
      });
    });
  }, []);

  const getCrucible = useCallback((crucibleId: string) => {
    return crucibles.find(c => c.id === crucibleId);
  }, [crucibles]);

  const addCrucible = useCallback((crucible: Crucible) => {
    setCrucibles(prev => {
      // Check if crucible already exists
      if (prev.find(c => c.id === crucible.id)) {
        return prev;
      }
      return [crucible, ...prev];
    });
  }, []);

  // Fetch real on-chain data
  const refreshFromOnChain = useCallback(async () => {
    setLoading(true);
    try {
      const connection = createDevnetConnection();
      const crucibleData = await fetchCrucibleDirect(connection);
      
      if (crucibleData) {
        const tvl = calculateTVL(crucibleData, solPrice); // Use real-time SOL price from CoinGecko
        setCrucibles(prev => prev.map(c => {
          if (c.id === 'sol-crucible') {
            return {
              ...c,
              tvl: tvl,
              status: crucibleData.paused ? 'paused' : 'active',
            };
          }
          return c;
        }));
      }
    } catch (error) {
      console.error('CrucibleContext: Error fetching on-chain data:', error);
    } finally {
      setLoading(false);
    }
  }, [solPrice]);

  // Fetch on-chain data on mount
  useEffect(() => {
    refreshFromOnChain();
    // Refresh every 30 seconds
    const interval = setInterval(refreshFromOnChain, 30000);
    return () => clearInterval(interval);
  }, [refreshFromOnChain]);

  const value = {
    crucibles,
    loading,
    updateCrucibleDeposit,
    updateCrucibleWithdraw,
    updateCrucibleTVL,
    getCrucible,
    addCrucible,
    refreshFromOnChain,
  };

  return (
    <CrucibleContext.Provider value={value}>
      {children}
    </CrucibleContext.Provider>
  );
};
