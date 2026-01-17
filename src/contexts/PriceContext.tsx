import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';
import { getCachedSolPrice } from '../utils/oracle';

interface PriceContextType {
  solPrice: number;
  isLoading: boolean;
  lastUpdate: number | null;
  refreshPrice: () => Promise<void>;
}

const PriceContext = createContext<PriceContextType | undefined>(undefined);

export const usePrice = () => {
  const context = useContext(PriceContext);
  if (!context) {
    throw new Error('usePrice must be used within a PriceProvider');
  }
  return context;
};

interface PriceProviderProps {
  children: ReactNode;
}

const DEFAULT_SOL_PRICE = 200; // Fallback price if API fails
const REFRESH_INTERVAL = 60000; // Refresh every 60 seconds

export const PriceProvider: React.FC<PriceProviderProps> = ({ children }) => {
  const [solPrice, setSolPrice] = useState<number>(DEFAULT_SOL_PRICE);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [lastUpdate, setLastUpdate] = useState<number | null>(null);

  const refreshPrice = useCallback(async () => {
    try {
      setIsLoading(true);
      const price = await getCachedSolPrice();
      setSolPrice(price);
      setLastUpdate(Date.now());
    } catch (error: any) {
      console.warn('⚠️ Failed to refresh SOL price, using fallback:', error.message);
      // Keep current price or fallback to default
      if (!lastUpdate) {
        setSolPrice(DEFAULT_SOL_PRICE);
      }
    } finally {
      setIsLoading(false);
    }
  }, [lastUpdate]);

  // Fetch price on mount
  useEffect(() => {
    refreshPrice();
  }, [refreshPrice]);

  // Set up periodic refresh
  useEffect(() => {
    const interval = setInterval(() => {
      refreshPrice();
    }, REFRESH_INTERVAL);

    return () => clearInterval(interval);
  }, [refreshPrice]);

  const value = {
    solPrice,
    isLoading,
    lastUpdate,
    refreshPrice,
  };

  return (
    <PriceContext.Provider value={value}>
      {children}
    </PriceContext.Provider>
  );
};
