import React, { useState, useEffect } from 'react';
import { useAnalytics } from '../contexts/AnalyticsContext';
import { useBalance } from '../contexts/BalanceContext';
import { useWallet } from '../contexts/WalletContext';
import { usePrice } from '../contexts/PriceContext';
import { useCrucible } from '../hooks/useCrucible'
import { getLeveragedPositions, getLPPositions, getInfernoLPPositions } from '../utils/localStorage';
import { formatNumberWithCommas, getCTokenPrice, RATE_SCALE, formatUSD, formatUSDC, formatSOL } from '../utils/math';
import CTokenPortfolio from './CTokenPortfolio';

export const AnalyticsDashboard: React.FC = () => {
  const { solPrice } = usePrice();
  const { analytics, getRecentTransactions } = useAnalytics();
  const { balances } = useBalance();
  const { publicKey: walletPublicKey } = useWallet();
  const liveAPYEarnings = 0; // Removed FOGO Sessions APY tracking - using Solana devnet directly
  const { crucibles, userBalances } = useCrucible();

  const recentTransactions = getRecentTransactions(5);

  // Count all opened positions (cToken wraps, LP, Leveraged, Inferno LP)
  const getAllPositionsOpened = () => {
    let count = 0
    
    // Count cToken positions (wraps) - positions with ptokenBalance > 0
    crucibles.forEach(crucible => {
      const userBalance = userBalances[crucible.id]
      if (userBalance && userBalance.ptokenBalance > BigInt(0)) {
        count++
      }
    })
    
    // Count LP positions
    try {
      const lpPositions = getLPPositions().filter(p => p.isOpen)
      count += lpPositions.length
    } catch (e) {
      // Ignore errors
    }
    
    // Count Leveraged positions
    try {
      const leveragedPositions = getLeveragedPositions().filter(p => p.isOpen)
      count += leveragedPositions.length
    } catch (e) {
      // Ignore errors
    }
    
    // Count Inferno LP positions
    try {
      const infernoPositions = getInfernoLPPositions().filter(p => p.isOpen)
      count += infernoPositions.length
    } catch (e) {
      // Ignore errors
    }
    
    return count
  }

  // Calculate annual APY earnings based on cToken holdings and leveraged positions
  const getTotalAPYEarnings = () => {
    const price = (token: string) => ({ SOL: solPrice, USDC: 1, ETH: 4000, BTC: 110000 } as any)[token] || 1;
    
    // Calculate APY earnings from cToken holdings
    // APY includes yield from fees (wrap/unwrap, LP, LVF) and arbitrage deposits
    // All revenue flows through total_fees_accrued (80% vault share) which increases exchange rate
    let totalAPYEarnings = 0;
    
    crucibles.forEach(crucible => {
      const userBalance = userBalances[crucible.id];
      if (userBalance && userBalance.ptokenBalance > 0) {
        // Calculate the value of cTokens in base token units
        const cTokenValue = Number(userBalance.ptokenBalance) / 1e9; // Convert from BigInt to number
        const baseTokenValue = cTokenValue * price(crucible.baseToken);
        
        // Calculate annual APY earnings (APY rate * value)
        // APY includes yield from fees and arbitrage deposits (via exchange rate growth)
        const annualAPY = baseTokenValue * (crucible.apr || 0);
        totalAPYEarnings += annualAPY;
      }
    });
    
    // SECURITY FIX: Also include APY earnings from leveraged positions using secure utility
    try {
      if (walletPublicKey) {
        const leveragedPositions = getLeveragedPositions();
        let currentWalletAddress: string | null = null;
        if (walletPublicKey) {
          if (typeof walletPublicKey === 'string') {
            currentWalletAddress = walletPublicKey;
          } else if (walletPublicKey.toBase58) {
            currentWalletAddress = walletPublicKey.toBase58();
          } else if (walletPublicKey.toString) {
            currentWalletAddress = walletPublicKey.toString();
          }
        }
        
        if (currentWalletAddress) {
          leveragedPositions.forEach((position: any) => {
            if (position.isOpen && position.owner === currentWalletAddress) {
              const baseTokenPrice = 200; // SOL price
              const collateralValueUSD = position.collateral * baseTokenPrice;
              // Find the crucible for this position
              const crucible = crucibles.find(c => c.baseToken === position.token);
              if (crucible) {
                // Matches contract: leveraged_apy = base_apy * leverage (no 3x multiplier)
                // For display purposes, using base APY * leverage factor from position
                const leverageFactor = position.leverageFactor || 1.0
                const leveragedAPY = collateralValueUSD * (crucible.apr || 0) * leverageFactor;
                totalAPYEarnings += leveragedAPY;
              }
            }
          });
        }
      }
    } catch (e) {
      console.warn('Failed to calculate leveraged position APY:', e);
    }
    
    return totalAPYEarnings;
  };

  // Calculate total borrowed USDC from leveraged positions
  const getTotalBorrowed = () => {
    try {
      if (!walletPublicKey) {
        return 0;
      }
      
      // SECURITY FIX: Use secure localStorage utility
      const leveragedPositions = getLeveragedPositions();
      
      // Get current wallet address in base58 format
      let currentWalletAddress: string | null = null;
      if (walletPublicKey) {
        if (typeof walletPublicKey === 'string') {
          currentWalletAddress = walletPublicKey;
        } else if (walletPublicKey.toBase58) {
          currentWalletAddress = walletPublicKey.toBase58();
        } else if (walletPublicKey.toString) {
          currentWalletAddress = walletPublicKey.toString();
        }
      }
      
      if (!currentWalletAddress) {
        return 0;
      }
      
      const totalBorrowed = leveragedPositions
        .filter((position: any) => {
          // Only count open positions for current wallet
          const isOpen = position.isOpen === true;
          const isOwner = position.owner === currentWalletAddress;
          return isOpen && isOwner;
        })
        .reduce((sum: number, position: any) => {
          return sum + (position.borrowedUSDC || 0);
        }, 0);
      return totalBorrowed;
    } catch (e) {
      console.warn('Failed to calculate total borrowed:', e);
      return 0;
    }
  };


  // Update APY earnings when transactions change or every minute for real-time display

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  const formatNumber = (num: number, decimals: number = 2) => {
    return num.toLocaleString('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  };

  const getTotalPortfolioValue = () => {
    return balances.reduce((total, balance) => total + balance.usdValue, 0);
  };

  const getWeightedAPY = () => {
    const depositValue = getTotalDepositedValue();
    if (depositValue <= 0) {
      return 0;
    }
    
    const priceForToken = (token: string) => {
      if (token.toUpperCase() === 'SOL') return solPrice;
      if (token.toUpperCase() === 'USDC') return 1;
      return 0;
    };
    
    let totalWeightedAPY = 0;
    
    // Weighted APY from cToken positions (wraps)
    crucibles.forEach(crucible => {
      const userBalance = userBalances[crucible.id];
      if (userBalance && userBalance.ptokenBalance > BigInt(0)) {
        const ctokenBalance = Number(userBalance.ptokenBalance) / 1e9;
        const exchangeRate = crucible.exchangeRate ? Number(crucible.exchangeRate) / 1e6 : 1.0;
        const basePrice = priceForToken(crucible.baseToken);
        const positionValue = ctokenBalance * exchangeRate * basePrice;
        const positionAPY = crucible.apr || 0;
        totalWeightedAPY += (positionValue * positionAPY);
      }
    });
    
    // Weighted APY from LP positions
    try {
      const lpPositions = getLPPositions().filter(p => p.isOpen);
      lpPositions.forEach(pos => {
        const basePrice = priceForToken(pos.baseToken);
        const positionValue = pos.baseAmount * basePrice + (pos.usdcAmount || 0);
        const positionAPY = pos.lpAPY || 0;
        totalWeightedAPY += (positionValue * positionAPY);
      });
    } catch (e) {
      // ignore localStorage issues
    }
    
    // Weighted APY from Leveraged positions
    try {
      const leveragedPositions = getLeveragedPositions().filter(p => p.isOpen);
      leveragedPositions.forEach(pos => {
        const basePrice = priceForToken(pos.token);
        const positionValue = pos.collateral * basePrice + (pos.depositUSDC || 0);
        
        // Calculate effective APY: (baseAPY × leverage) - (borrowRate × leverageExcess)
        // Default borrow rate is 10% (0.10)
        const leverage = pos.leverageFactor || 1.0;
        const leverageExcess = Math.max(0, leverage - 1.0);
        const borrowRate = 0.10; // 10% annual borrow rate
        const crucible = crucibles.find(c => c.baseToken === pos.token);
        const baseAPY = crucible?.apr || 0;
        const positionAPY = leverage > 1
          ? (baseAPY * leverage) - (borrowRate * leverageExcess)
          : baseAPY;
        
        totalWeightedAPY += (positionValue * positionAPY);
      });
    } catch (e) {
      // ignore localStorage issues
    }
    
    // Weighted APY from Inferno LP positions
    try {
      const infernoPositions = getInfernoLPPositions().filter(p => p.isOpen);
      infernoPositions.forEach(pos => {
        const basePrice = priceForToken(pos.baseToken || 'SOL');
        const positionValue = pos.baseAmount * basePrice + pos.usdcAmount;
        const positionAPY = pos.lpAPY || 0;
        totalWeightedAPY += (positionValue * positionAPY);
      });
    } catch (e) {
      // ignore localStorage issues
    }
    
    // Calculate weighted average: totalWeightedAPY / totalValue
    return depositValue > 0 ? totalWeightedAPY / depositValue : 0;
  };

  const getTotalDepositedValue = () => {
    if (analytics.totalDeposits > 0) {
      return analytics.totalDeposits;
    }

    const priceForToken = (token: string) => {
      if (token.toUpperCase() === 'SOL') return solPrice;
      if (token.toUpperCase() === 'USDC') return 1;
      return 0;
    };

    // Wrap positions (cTokens) value
    const wrapValue = crucibles.reduce((sum, crucible) => {
      const userBalance = userBalances[crucible.id];
      if (userBalance && userBalance.ptokenBalance > BigInt(0)) {
        const basePrice = priceForToken(crucible.baseToken);
        const ctokenBalance = Number(userBalance.ptokenBalance) / 1e9;
        const exchangeRate = crucible.exchangeRate ? Number(crucible.exchangeRate) / 1e6 : 1.0;
        return sum + (ctokenBalance * exchangeRate * basePrice);
      }
      return sum;
    }, 0);

    // LP positions value (exclude borrowed USDC for leveraged positions)
    let lpValue = 0;
    try {
      const lpPositions = getLPPositions().filter(p => p.isOpen);
      lpValue = lpPositions.reduce((sum, pos) => {
        const basePrice = priceForToken(pos.baseToken);
        const baseValue = pos.baseAmount * basePrice;
        return sum + baseValue + (pos.usdcAmount || 0);
      }, 0);
    } catch (e) {
      // ignore localStorage issues
    }

    // Leveraged positions value (collateral + deposited USDC only)
    let leveragedValue = 0;
    try {
      const leveragedPositions = getLeveragedPositions().filter(p => p.isOpen);
      leveragedValue = leveragedPositions.reduce((sum, pos) => {
        const basePrice = priceForToken(pos.token);
        const collateralValue = pos.collateral * basePrice;
        const depositUSDC = pos.depositUSDC || 0;
        return sum + collateralValue + depositUSDC;
      }, 0);
    } catch (e) {
      // ignore localStorage issues
    }

    // Inferno LP positions value
    let infernoLPValue = 0;
    try {
      const infernoPositions = getInfernoLPPositions().filter(p => p.isOpen);
      infernoLPValue = infernoPositions.reduce((sum, pos) => {
        const basePrice = priceForToken(pos.baseToken || 'SOL');
        const baseValue = pos.baseAmount * basePrice;
        return sum + baseValue + pos.usdcAmount;
      }, 0);
    } catch (e) {
      // ignore localStorage issues
    }

    return wrapValue + lpValue + leveragedValue + infernoLPValue;
  };

  return (
    <div className="space-y-4">
      {/* Key Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 justify-items-stretch">
        <div className="group relative panel rounded-2xl p-3 hover:shadow-2xl hover:shadow-forge-primary/20 transition-all duration-500 hover:border-forge-primary/50 hover:-translate-y-1 overflow-hidden">
          <div className="relative flex items-center justify-center text-center">
            <div className="flex-1 min-w-0 text-center">
              <p className="text-forge-gray-400 text-[10px] font-medium uppercase tracking-wide mb-0.5">APY Earnings</p>
              <p className="text-lg font-heading text-white">{formatCurrency(getTotalAPYEarnings())}</p>
            </div>
          </div>
        </div>

        <div className="group relative panel rounded-2xl p-3 hover:shadow-2xl hover:shadow-forge-success/20 transition-all duration-500 hover:border-forge-success/50 hover:-translate-y-1 overflow-hidden">
          <div className="relative flex items-center justify-center text-center">
            <div className="flex-1 min-w-0 text-center">
              <p className="text-forge-gray-400 text-[10px] font-medium uppercase tracking-wide mb-0.5">Total Deposited</p>
              <p className="text-lg font-heading text-white">{formatCurrency(getTotalDepositedValue())}</p>
            </div>
          </div>
        </div>

        <div className="group relative panel rounded-2xl p-3 hover:shadow-2xl hover:shadow-forge-primary/20 transition-all duration-500 hover:border-forge-primary/50 hover:-translate-y-1 overflow-hidden">
          <div className="relative flex items-center justify-center text-center">
            <div className="flex-1 min-w-0 text-center">
              <p className="text-forge-gray-400 text-[10px] font-medium uppercase tracking-wide mb-0.5">Weighted APY</p>
              <p className="text-lg font-heading text-white">{formatNumber(getWeightedAPY(), 2)}%</p>
            </div>
          </div>
        </div>

        <div className="group relative panel rounded-2xl p-3 hover:shadow-2xl hover:shadow-orange-500/20 transition-all duration-500 hover:border-orange-500/50 hover:-translate-y-1 overflow-hidden">
          <div className="relative flex items-center justify-center text-center">
            <div className="flex-1 min-w-0 text-center">
              <p className="text-forge-gray-400 text-[10px] font-medium uppercase tracking-wide mb-0.5">Borrowed</p>
              <p className="text-lg font-heading text-white">{formatCurrency(getTotalBorrowed())}</p>
            </div>
          </div>
        </div>

      </div>

      {/* Portfolio overview moved to DynamicTokenBalances component */}

      {/* cToken Portfolio Overview */}
      <CTokenPortfolio />


    </div>
  );
};
