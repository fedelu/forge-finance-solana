import React from 'react';
import { 
  calculateVolatilityFarmingMetrics, 
  CRUCIBLE_CONFIGS, 
  DEFAULT_CONFIG,
  formatAPY,
  formatDailyReturn,
  formatCurrency
} from '../utils/volatilityFarming';

interface VolatilityFarmingMetricsProps {
  className?: string;
}

export default function VolatilityFarmingMetrics({ className = '' }: VolatilityFarmingMetricsProps) {
  // Calculate metrics for SOL crucible
  const solMetrics = calculateVolatilityFarmingMetrics(CRUCIBLE_CONFIGS[0], DEFAULT_CONFIG);

  return (
    <div className={`space-y-6 ${className}`}>
      <div className="panel rounded-2xl p-6 border border-forge-gray-700 shadow-fogo">
        <h3 className="text-xl font-heading text-white mb-6">Volatility Farming Metrics</h3>
        
        <div className="grid grid-cols-1 gap-6">
          {/* SOL Crucible Metrics */}
          <div className="panel-muted rounded-xl p-6 border border-forge-gray-600">
            <div className="flex items-center space-x-3 mb-4">
              <div className="w-8 h-8 bg-forge-primary/20 rounded-lg flex items-center justify-center">
                <span className="text-forge-primary font-bold text-sm">S</span>
              </div>
              <h4 className="text-lg font-heading text-white">SOL Crucible</h4>
            </div>
            
            <div className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-forge-gray-400">Volatility Factor:</span>
                <span className="text-white font-satoshi">2%</span>
              </div>
              <div className="flex justify-between">
                <span className="text-forge-gray-400">Token Price:</span>
                <span className="text-forge-accent font-satoshi">$200</span>
              </div>
              <div className="flex justify-between">
                <span className="text-forge-gray-400">TVL:</span>
                <span className="text-white font-satoshi">{formatCurrency(CRUCIBLE_CONFIGS[0].tvl)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-forge-gray-400">Transaction Frequency:</span>
                <span className="text-forge-accent font-satoshi">{solMetrics.transactionFrequency.toFixed(2)}x/day</span>
              </div>
              <div className="flex justify-between">
                <span className="text-forge-gray-400">Daily Transaction Fees:</span>
                <span className="text-forge-accent font-satoshi">{formatCurrency(solMetrics.dailyTransactionFees)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-forge-gray-400">Crucible Holders (80%):</span>
                <span className="text-forge-success font-satoshi">{formatCurrency(solMetrics.crucibleHoldersShare)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-forge-gray-400">Protocol Treasury (20%):</span>
                <span className="text-forge-primary font-satoshi">{formatCurrency(solMetrics.protocolShare)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-forge-gray-400">Daily Yield:</span>
                <span className="text-forge-accent font-satoshi">+0.012%</span>
              </div>
              <div className="flex justify-between">
                <span className="text-forge-gray-400">APY:</span>
                <span className="text-forge-primary font-satoshi">{formatAPY(solMetrics.apyCompounded)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* cToken Price Projections */}
        <div className="mt-6 panel-muted rounded-xl p-6 border border-forge-gray-600">
          <h4 className="text-lg font-heading text-white mb-4">⚒️ cToken Price Projections</h4>
          <div className="grid grid-cols-1 gap-6">
            {/* cSOL Projections */}
            <div className="space-y-3">
              <h5 className="text-forge-primary font-heading">cSOL Crucible</h5>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-forge-gray-400">Starting cSOL Price:</span>
                  <span className="text-forge-accent font-satoshi">$209.00</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-forge-gray-400">TVL:</span>
                  <span className="text-forge-primary font-satoshi">$3,225,000</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-forge-gray-400">Total cSOL Supply:</span>
                  <span className="text-forge-success font-satoshi">6,450,000 cSOL</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-forge-gray-400">30D Projected Price:</span>
                  <span className="text-forge-accent font-satoshi">$209.36</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-forge-gray-400">1Y Projected Price:</span>
                  <span className="text-forge-accent font-satoshi">$218.00</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Protocol Summary */}
        <div className="mt-6 panel-muted rounded-xl p-4 border border-forge-gray-600">
          <h4 className="text-lg font-heading text-white mb-3">Protocol Summary</h4>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-sm">
            <div className="flex justify-between">
              <span className="text-forge-gray-400">Total Protocol TVL:</span>
              <span className="text-white font-satoshi">{formatCurrency(DEFAULT_CONFIG.totalProtocolTVL)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-forge-gray-400">Transaction Fee Rate:</span>
              <span className="text-white font-satoshi">{(DEFAULT_CONFIG.feeRate * 100).toFixed(1)}%</span>
            </div>
            <div className="flex justify-between">
              <span className="text-forge-gray-400">Protocol Treasury:</span>
              <span className="text-white font-satoshi">{(DEFAULT_CONFIG.protocolFeeCut * 100).toFixed(1)}%</span>
            </div>
            <div className="flex justify-between">
              <span className="text-forge-gray-400">Crucible Holders:</span>
              <span className="text-forge-success font-satoshi">{(DEFAULT_CONFIG.crucibleHoldersCut * 100).toFixed(1)}%</span>
            </div>
          </div>
          <div className="mt-4 pt-4 border-t border-forge-gray-600">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              <div className="flex justify-between">
                <span className="text-forge-gray-400">Total Daily Fees:</span>
                <span className="text-forge-accent font-satoshi">{formatCurrency(solMetrics.dailyTransactionFees)}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
