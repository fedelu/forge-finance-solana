import React, { useState, useEffect } from 'react';
import { useAnalytics } from '../contexts/AnalyticsContext';
import { useBalance } from '../contexts/BalanceContext';
import { useWallet } from '../contexts/WalletContext';
import { useCrucible } from '../hooks/useCrucible';
import { formatNumberWithCommas, getCTokenPrice, RATE_SCALE } from '../utils/math';
import CTokenPortfolio from './CTokenPortfolio';
// import { DynamicTokenBalances } from './DynamicTokenBalances'; // Temporarily disabled
import { 
  ChartBarIcon, 
  CurrencyDollarIcon, 
  ArrowTrendingUpIcon,
  BanknotesIcon,
  ArrowUpIcon,
  ArrowDownIcon,
  CreditCardIcon
} from '@heroicons/react/24/outline';

export const AnalyticsDashboard: React.FC = () => {
  const { analytics, getRecentTransactions } = useAnalytics();
  const { balances } = useBalance();
  const { publicKey: walletPublicKey } = useWallet();
  const liveAPYEarnings = 0; // Removed FOGO Sessions APY tracking - using Solana devnet directly
  const { crucibles, userBalances } = useCrucible();

  const recentTransactions = getRecentTransactions(5);

  // Calculate annual APY earnings based on cToken holdings and leveraged positions
  const getTotalAPYEarnings = () => {
    const price = (token: string) => ({ SOL: 200, USDC: 1, ETH: 4000, BTC: 110000, FOGO: 0.5, FORGE: 0.002 } as any)[token] || 1;
    
    // Calculate APY earnings from cToken holdings
    let totalAPYEarnings = 0;
    
    crucibles.forEach(crucible => {
      const userBalance = userBalances[crucible.id];
      if (userBalance && userBalance.ptokenBalance > 0) {
        // Calculate the value of cTokens in base token units
        const cTokenValue = Number(userBalance.ptokenBalance) / 1e9; // Convert from BigInt to number
        const baseTokenValue = cTokenValue * price(crucible.baseToken);
        
        // Calculate annual APY earnings (APY rate * value)
        const annualAPY = baseTokenValue * (crucible.apr || 0);
        totalAPYEarnings += annualAPY;
      }
    });
    
    // Also include APY earnings from leveraged positions (3x the base APY)
    try {
      if (walletPublicKey) {
        const leveragedPositions = JSON.parse(localStorage.getItem('leveraged_positions') || '[]');
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
              const baseTokenPrice = position.token === 'FORGE' ? 0.5 : 0.002;
              const collateralValueUSD = position.collateral * baseTokenPrice;
              // Find the crucible for this position
              const crucible = crucibles.find(c => c.baseToken === position.token);
              if (crucible) {
                // Leveraged positions earn 3x the base APY
                const leveragedAPY = collateralValueUSD * (crucible.apr || 0) * 3;
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
      
      const leveragedPositions = JSON.parse(localStorage.getItem('leveraged_positions') || '[]');
      
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

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="mb-10">
        <h1 className="text-4xl font-heading bg-gradient-to-r from-white via-fogo-primary-light to-white bg-clip-text text-transparent mb-3">Portfolio</h1>
        <p className="text-fogo-gray-400 font-satoshi-light text-lg">Track your Forge portfolio performance</p>
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 justify-items-stretch">
        <div className="group relative panel rounded-2xl p-6 hover:shadow-2xl hover:shadow-fogo-primary/20 transition-all duration-500 hover:border-fogo-primary/50 hover:-translate-y-1 overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-fogo-primary/5 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>
          <div className="relative flex items-center space-x-4">
            <div className="w-12 h-12 bg-gradient-to-br from-fogo-primary/30 to-fogo-primary/10 rounded-xl flex items-center justify-center ring-2 ring-fogo-primary/20 group-hover:ring-fogo-primary/40 transition-all duration-300 group-hover:scale-110">
              <CurrencyDollarIcon className="h-6 w-6 text-fogo-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-fogo-gray-400 text-xs font-medium uppercase tracking-wide mb-1">APY Earnings</p>
              <p className="text-2xl font-heading text-white mb-1">{formatCurrency(getTotalAPYEarnings())}</p>
              <p className="text-xs text-fogo-primary/80 font-medium">
                Annual APY based on cToken holdings
              </p>
            </div>
          </div>
        </div>

        <div className="group relative panel rounded-2xl p-6 hover:shadow-2xl hover:shadow-fogo-success/20 transition-all duration-500 hover:border-fogo-success/50 hover:-translate-y-1 overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-fogo-success/5 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>
          <div className="relative flex items-center space-x-4">
            <div className="w-12 h-12 bg-gradient-to-br from-fogo-success/30 to-fogo-success/10 rounded-xl flex items-center justify-center ring-2 ring-fogo-success/20 group-hover:ring-fogo-success/40 transition-all duration-300 group-hover:scale-110">
              <ArrowUpIcon className="h-6 w-6 text-fogo-success" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-fogo-gray-400 text-xs font-medium uppercase tracking-wide mb-1">Total Deposits</p>
              <p className="text-2xl font-heading text-white">{formatCurrency(analytics.totalDeposits)}</p>
            </div>
          </div>
        </div>

        <div className="group relative panel rounded-2xl p-6 hover:shadow-2xl hover:shadow-fogo-error/20 transition-all duration-500 hover:border-fogo-error/50 hover:-translate-y-1 overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-fogo-error/5 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>
          <div className="relative flex items-center space-x-4">
            <div className="w-12 h-12 bg-gradient-to-br from-fogo-error/30 to-fogo-error/10 rounded-xl flex items-center justify-center ring-2 ring-fogo-error/20 group-hover:ring-fogo-error/40 transition-all duration-300 group-hover:scale-110">
              <ArrowDownIcon className="h-6 w-6 text-fogo-error" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-fogo-gray-400 text-xs font-medium uppercase tracking-wide mb-1">Total Withdrawals</p>
              <p className="text-2xl font-heading text-white">{formatCurrency(analytics.totalWithdrawals)}</p>
            </div>
          </div>
        </div>

        <div className="group relative panel rounded-2xl p-6 hover:shadow-2xl hover:shadow-orange-500/20 transition-all duration-500 hover:border-orange-500/50 hover:-translate-y-1 overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-orange-500/5 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>
          <div className="relative flex items-center space-x-4">
            <div className="w-12 h-12 bg-gradient-to-br from-orange-500/30 to-orange-500/10 rounded-xl flex items-center justify-center ring-2 ring-orange-500/20 group-hover:ring-orange-500/40 transition-all duration-300 group-hover:scale-110">
              <CreditCardIcon className="h-6 w-6 text-orange-400" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-fogo-gray-400 text-xs font-medium uppercase tracking-wide mb-1">Borrowed</p>
              <p className="text-2xl font-heading text-white mb-1">{formatCurrency(getTotalBorrowed())}</p>
              <p className="text-xs text-orange-400/80 font-medium">
                Total USDC borrowed from lending pool
              </p>
            </div>
          </div>
        </div>

      </div>

      {/* Portfolio overview moved to DynamicTokenBalances component */}

      {/* cToken Portfolio Overview */}
      <div className="panel rounded-3xl p-8">
        <CTokenPortfolio />
      </div>


      {/* Recent Transactions */}
      <div className="panel rounded-3xl p-8">
        <div className="flex items-center space-x-4 mb-8">
          <div className="w-12 h-12 bg-gradient-to-br from-fogo-secondary/30 to-fogo-secondary/10 rounded-xl flex items-center justify-center ring-2 ring-fogo-secondary/20">
            <ChartBarIcon className="h-6 w-6 text-fogo-secondary" />
          </div>
          <div>
            <h3 className="text-2xl font-heading text-white">Recent Transactions</h3>
            <p className="text-fogo-gray-400 text-sm mt-1">Your latest activity</p>
          </div>
        </div>
        <div className="space-y-4">
          {recentTransactions.length > 0 ? (
            recentTransactions.map((tx, index) => (
              <div 
                key={tx.id} 
                className="group relative flex items-center justify-between p-5 panel rounded-2xl border border-fogo-gray-700/50 hover:border-fogo-primary/30 transition-all duration-300 hover:shadow-xl hover:shadow-fogo-primary/10 hover:-translate-y-0.5 backdrop-blur-sm overflow-hidden"
                style={{ animationDelay: `${index * 50}ms` }}
              >
                <div className="absolute inset-0 bg-gradient-to-r from-fogo-primary/0 via-fogo-primary/5 to-fogo-primary/0 opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>
                <div className="relative flex items-center space-x-4 flex-1 min-w-0">
                  <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-lg font-bold shadow-lg transition-all duration-300 group-hover:scale-110 ${
                    (tx.type === 'deposit' || tx.type === 'wrap') 
                      ? 'bg-gradient-to-br from-fogo-success/30 to-fogo-success/10 text-fogo-success ring-2 ring-fogo-success/20' 
                      : 'bg-gradient-to-br from-fogo-error/30 to-fogo-error/10 text-fogo-error ring-2 ring-fogo-error/20'
                  }`}>
                    {(tx.type === 'deposit' || tx.type === 'wrap') ? '↑' : '↓'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-white font-heading text-base mb-1">
                      {(() => {
                        if (tx.type === 'deposit' || tx.type === 'wrap') {
                          return 'LP Position';
                        }
                        if (tx.type === 'withdraw' || tx.type === 'unwrap') return 'Withdrawal';
                        return tx.type;
                      })()} - {tx.crucibleId}
                    </p>
                    <p className="text-fogo-gray-400 text-sm font-satoshi">
                      {new Date(tx.timestamp).toLocaleString()}
                    </p>
                  </div>
                </div>
                <div className="relative text-right ml-4">
                  <p className="text-white font-heading text-base mb-1">
                    {tx.amount.toFixed(2)} {tx.token}
                    {tx.usdcDeposited !== undefined && tx.usdcDeposited > 0 && (
                      <span className="text-fogo-primary ml-2 font-heading">+ {tx.usdcDeposited.toFixed(2)} USDC</span>
                    )}
                    {tx.usdcReceived !== undefined && tx.usdcReceived > 0 && (
                      <span className="text-fogo-primary ml-2 font-heading">+ {tx.usdcReceived.toFixed(2)} USDC</span>
                    )}
                    {tx.borrowedAmount !== undefined && tx.borrowedAmount > 0 && (
                      <span className="text-orange-400 ml-2 font-heading">+ {tx.borrowedAmount.toFixed(2)} USDC (borrowed)</span>
                    )}
                  </p>
                  <p className="text-fogo-gray-400 text-sm font-satoshi mb-1">
                    {formatCurrency(tx.usdValue || tx.amount * (tx.token === 'FORGE' ? 0.5 : tx.token === 'FORGE' ? 0.002 : tx.token === 'cFOGO' ? 0.5224 : tx.token === 'cFORGE' ? 0.0025 : tx.token === 'SOL' ? 200 : tx.token === 'USDC' ? 1 : tx.token === 'ETH' ? 4000 : 110000))}
                  </p>
                  {tx.leverage && tx.leverage > 1 && (
                    <p className="inline-flex items-center px-2 py-1 bg-orange-500/20 text-orange-400 text-xs font-heading rounded-lg mt-1 uppercase tracking-[0.16em]">
                      {tx.leverage}x leverage
                    </p>
                  )}
                  {tx.signature && (
                    <p className="text-fogo-gray-500 text-xs font-mono mt-2 opacity-60">
                      {tx.signature.slice(0, 8)}...{tx.signature.slice(-8)}
                    </p>
                  )}
                </div>
              </div>
            ))
          ) : (
            <div className="text-center py-16">
              <div className="w-20 h-20 bg-gradient-to-br from-fogo-primary/20 to-fogo-primary/10 rounded-3xl flex items-center justify-center mx-auto mb-6 ring-2 ring-fogo-primary/20">
                <BanknotesIcon className="h-10 w-10 text-fogo-primary" />
              </div>
              <p className="text-fogo-gray-300 text-xl font-heading mb-2">No transactions yet</p>
              <p className="text-fogo-gray-500 text-sm">Make your first deposit to see analytics!</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
