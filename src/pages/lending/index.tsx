// Summary: Lending markets overview page with improved UI
import React, { useState } from 'react'
import { useLending } from '../../hooks/useLending'
import { 
  BanknotesIcon,
  ChartBarIcon,
  ArrowUpIcon,
  ArrowDownIcon,
  CurrencyDollarIcon,
  FireIcon
} from '@heroicons/react/24/outline'
import { useWallet } from '../../contexts/WalletContext'
import { useBalance } from '../../contexts/BalanceContext'
import { formatUSDC } from '../../utils/math'
import { getUSDCFromFaucet, getUSDCInstructions } from '../../utils/usdcFaucet'
import { useEffect } from 'react'

export default function LendingPage() {
  const { markets, positions, supply, withdraw, loading } = useLending()
  const { connected, publicKey, connection, signTransaction } = useWallet()
  const { getBalance, updateBalance } = useBalance()
  const [selectedMarket, setSelectedMarket] = useState<string | null>(null)
  const [supplyAmount, setSupplyAmount] = useState('')
  const [supplyLoading, setSupplyLoading] = useState(false)
  const [gettingUSDC, setGettingUSDC] = useState(false)
  const [showUSDCInstructions, setShowUSDCInstructions] = useState(false)
  
  // Force refresh USDC balance when supply modal opens
  useEffect(() => {
    if (selectedMarket && connected && publicKey && connection) {
      const refreshUSDCBalance = async () => {
        try {
          const { PublicKey } = await import('@solana/web3.js')
          const { getAssociatedTokenAddress, getAccount } = await import('@solana/spl-token')
          const { SOLANA_TESTNET_CONFIG } = await import('../../config/solana-testnet')
          
          const usdcMint = new PublicKey(SOLANA_TESTNET_CONFIG.TOKEN_ADDRESSES.USDC)
          const userUsdcAccount = await getAssociatedTokenAddress(usdcMint, publicKey)
          
          try {
            const tokenAccount = await getAccount(connection, userUsdcAccount)
            const usdcAmount = Number(tokenAccount.amount) / 1e6
            console.log('🔄 Refreshed USDC balance:', usdcAmount, 'USDC')
            updateBalance('USDC', usdcAmount)
          } catch (tokenError: any) {
            if (tokenError.name === 'TokenAccountNotFoundError' || 
                tokenError.message?.includes('Account not found') ||
                tokenError.message?.includes('could not find account') ||
                tokenError.message?.includes('InvalidAccountData')) {
              updateBalance('USDC', 0)
            } else {
              console.error('Error refreshing USDC balance:', tokenError)
            }
          }
        } catch (error) {
          console.error('Error refreshing USDC balance:', error)
        }
      }
      
      refreshUSDCBalance()
    }
  }, [selectedMarket, connected, publicKey, connection, updateBalance])

  const formatCurrency = (value: string) => {
    return value
  }

  const MarketCard = ({ market }: { market: typeof markets[0] }) => {
    const userPosition = positions.find(p => p.marketPubkey === market.marketPubkey)
    const utilizationPercent = (market.utilizationBps / 100).toFixed(2)
    const supplyAPY = (market.supplyApyBps / 100).toFixed(2)
    const borrowAPY = (market.borrowApyBps / 100).toFixed(2)
    const isHighUtilization = market.utilizationBps > 8000 // > 80%

    return (
      <div className="panel-muted backdrop-blur-sm rounded-2xl p-6 border border-forge-gray-700/50 shadow-fogo hover:shadow-forge-lg transition-all duration-300 hover:scale-[1.02] hover:-translate-y-1">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center space-x-3">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-500/20 to-blue-600/10 flex items-center justify-center border border-blue-500/30 overflow-hidden">
              <img 
                src="/usd-coin-usdc-logo-last.png" 
                alt="USDC" 
                className="w-8 h-8 object-contain"
              />
            </div>
            <div>
              <h3 className="text-xl font-heading text-white">USDC</h3>
              <p className="text-sm text-forge-gray-400 font-satoshi">Lending Market</p>
            </div>
          </div>
          <div className={`px-3 py-1 rounded-lg text-xs font-satoshi font-medium ${
            market.paused ? 'bg-forge-gray-700 text-forge-gray-400' : 'bg-forge-primary/20 text-forge-primary'
          }`}>
            {market.paused ? 'Paused' : 'Active'}
          </div>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 gap-4 mb-6">
          <div className="panel rounded-xl p-4 border border-forge-gray-700/30">
            <div className="flex items-center space-x-2 mb-2">
              <ChartBarIcon className="h-4 w-4 text-forge-gray-400" />
              <p className="text-xs text-forge-gray-400 font-satoshi uppercase tracking-wide">TVL</p>
            </div>
            <p className="text-xl font-heading text-white">{formatCurrency(market.tvl)}</p>
          </div>
          
          <div className={`panel rounded-xl p-4 border ${
            isHighUtilization ? 'border-orange-500/30 bg-orange-500/5' : 'border-forge-gray-700/30'
          }`}>
            <div className="flex items-center space-x-2 mb-2">
              <FireIcon className={`h-4 w-4 ${isHighUtilization ? 'text-orange-400' : 'text-forge-gray-400'}`} />
              <p className="text-xs text-forge-gray-400 font-satoshi uppercase tracking-wide">Utilization</p>
            </div>
            <p className={`text-xl font-heading ${isHighUtilization ? 'text-orange-400' : 'text-white'}`}>
              {utilizationPercent}%
            </p>
          </div>
        </div>

        {/* APY Rates */}
        <div className="space-y-3 mb-6">
          <div className="flex items-center justify-between p-3 rounded-lg bg-forge-gray-800/30 border border-forge-gray-700/30">
            <div className="flex items-center space-x-2">
              <ArrowUpIcon className="h-4 w-4 text-forge-success" />
              <span className="text-sm text-forge-gray-300 font-satoshi">Supply APY</span>
            </div>
            <span className="text-lg font-heading text-forge-success">{supplyAPY}%</span>
          </div>
          
          <div className="flex items-center justify-between p-3 rounded-lg bg-forge-gray-800/30 border border-forge-gray-700/30">
            <div className="flex items-center space-x-2">
              <ArrowDownIcon className="h-4 w-4 text-orange-400" />
              <span className="text-sm text-forge-gray-300 font-satoshi">Borrow APY</span>
            </div>
            <span className="text-lg font-heading text-orange-400">{borrowAPY}%</span>
          </div>
        </div>

        {/* User Position */}
        {userPosition && userPosition.suppliedAmount > 0 && (
          <div className="mb-6 p-4 rounded-lg bg-forge-primary/10 border border-forge-primary/20">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm text-forge-gray-300 font-satoshi">Your Position</p>
              <p className="text-sm text-forge-primary font-heading">
                {userPosition.suppliedAmount.toLocaleString()} USDC
              </p>
            </div>
            <div className="flex items-center justify-between">
              <p className="text-xs text-forge-gray-400 font-satoshi">Effective APY</p>
              <p className="text-xs text-forge-primary font-heading">
                {(userPosition.effectiveApy * 100).toFixed(2)}%
              </p>
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-3">
          <button
            onClick={() => setSelectedMarket(market.marketPubkey)}
            className="flex-1 px-4 py-3 bg-forge-primary hover:bg-forge-primary/90 text-white rounded-xl font-satoshi font-medium transition-all duration-200 hover:scale-105 hover:shadow-lg hover:shadow-forge-primary/20 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
            disabled={!connected || market.paused}
          >
            {userPosition && userPosition.suppliedAmount > 0 ? 'Supply More' : 'Supply'}
          </button>
          {userPosition && userPosition.suppliedAmount > 0 && (
            <button
              onClick={() => {
                // Withdraw functionality requires receipt token tracking - planned feature
              }}
              className="flex-1 px-4 py-3 bg-forge-gray-700 hover:bg-forge-gray-600 text-white rounded-xl font-satoshi font-medium transition-all duration-200 hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
              disabled={!connected}
            >
              Withdraw
            </button>
          )}
        </div>

        {!connected && (
          <p className="text-xs text-forge-gray-500 text-center mt-3 font-satoshi">
            Connect wallet to supply
          </p>
        )}
      </div>
    )
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center space-x-3 mb-4">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-forge-primary/20 to-forge-primary/10 flex items-center justify-center border border-forge-primary/30">
            <BanknotesIcon className="h-6 w-6 text-forge-primary" />
          </div>
          <div>
            <h1 className="text-3xl font-heading text-white mb-1">Lending Markets</h1>
            <p className="text-forge-gray-400 font-satoshi-light">
              Supply USDC to earn yield and enable leverage for crucible positions
            </p>
          </div>
        </div>
      </div>

      {/* Info Banner */}
      <div className="panel rounded-xl p-4 mb-6 border border-forge-primary/20 bg-forge-primary/5">
        <div className="flex items-start space-x-3">
          <FireIcon className="h-5 w-5 text-forge-primary mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-sm text-white font-satoshi font-medium mb-1">
              USDC Lending Pool
            </p>
            <p className="text-xs text-forge-gray-400 font-satoshi-light">
              The USDC lending pool enables leverage for crucible positions. When users open leveraged LP positions, 
              they borrow USDC from this pool. Lenders earn interest on supplied USDC.
            </p>
          </div>
        </div>
      </div>

      {/* Markets Grid */}
      {markets.length === 0 ? (
        <div className="panel rounded-2xl p-12 text-center border border-forge-gray-700">
          <BanknotesIcon className="h-12 w-12 text-forge-gray-600 mx-auto mb-4" />
          <h3 className="text-xl font-heading text-white mb-2">No Markets Available</h3>
          <p className="text-forge-gray-400 font-satoshi-light">
            Lending markets will appear here once they're initialized.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
          {markets.map((market) => (
            <MarketCard key={market.marketPubkey} market={market} />
          ))}
        </div>
      )}

      {/* Supply Modal */}
      {selectedMarket && (() => {
        const market = markets.find(m => m.marketPubkey === selectedMarket)
        if (!market) return null
        
        const usdcBalance = getBalance('USDC')
        
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-md">
            <div className="panel rounded-3xl w-full max-w-md p-8 relative">
              <button 
                onClick={() => {
                  setSelectedMarket(null)
                  setSupplyAmount('')
                }} 
                className="absolute top-5 right-5 text-forge-gray-400 hover:text-white transition-colors"
              >
                ✕
              </button>
              
              <h3 className="text-2xl font-heading text-white mb-6">Supply USDC</h3>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-sm text-forge-gray-400 mb-2">Amount</label>
                  <input
                    type="number"
                    value={supplyAmount}
                    onChange={(e) => setSupplyAmount(e.target.value)}
                    className="w-full px-4 py-3 panel-muted rounded-lg text-white placeholder-forge-gray-500 focus:outline-none focus:ring-2 focus:ring-forge-primary"
                    placeholder="0.00"
                    disabled={supplyLoading}
                  />
                  <div className="flex justify-between mt-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-forge-gray-500">
                        Balance: {formatUSDC(usdcBalance)} USDC
                      </span>
                      <button
                        onClick={async () => {
                          if (!connection || !publicKey) return
                          try {
                            const { PublicKey } = await import('@solana/web3.js')
                            const { getAssociatedTokenAddress, getAccount } = await import('@solana/spl-token')
                            const { SOLANA_TESTNET_CONFIG } = await import('../../config/solana-testnet')
                            
                            const usdcMint = new PublicKey(SOLANA_TESTNET_CONFIG.TOKEN_ADDRESSES.USDC)
                            console.log('🔄 Manual refresh - USDC mint:', usdcMint.toString())
                            const userUsdcAccount = await getAssociatedTokenAddress(usdcMint, publicKey)
                            console.log('🔄 Manual refresh - Token account:', userUsdcAccount.toString())
                            
                            const tokenAccount = await getAccount(connection, userUsdcAccount)
                            const usdcAmount = Number(tokenAccount.amount) / 1e6
                            console.log('✅ Manual refresh - Balance:', usdcAmount, 'USDC')
                            updateBalance('USDC', usdcAmount)
                            alert(`Balance refreshed: ${formatUSDC(usdcAmount)} USDC`)
                          } catch (error: any) {
                            console.error('❌ Manual refresh error:', error)
                            if (error.name === 'TokenAccountNotFoundError' || 
                                error.message?.includes('Account not found') ||
                                error.message?.includes('could not find account')) {
                              updateBalance('USDC', 0)
                              alert('USDC token account not found. Please receive USDC first.')
                            } else {
                              alert(`Error refreshing balance: ${error.message}`)
                            }
                          }
                        }}
                        className="text-xs text-forge-primary hover:underline"
                        title="Refresh USDC balance"
                      >
                        🔄
                      </button>
                    </div>
                    <div className="flex gap-2">
                      {usdcBalance === 0 && (
                        <button
                          onClick={() => setShowUSDCInstructions(!showUSDCInstructions)}
                          className="text-xs text-orange-400 hover:underline"
                        >
                          {showUSDCInstructions ? 'Hide' : 'Get USDC'}
                        </button>
                      )}
                      <button 
                        onClick={() => setSupplyAmount(usdcBalance.toString())} 
                        className="text-xs text-forge-primary hover:underline disabled:opacity-50"
                        disabled={supplyLoading || usdcBalance === 0}
                      >
                        Max
                      </button>
                    </div>
                  </div>
                  
                  {showUSDCInstructions && usdcBalance === 0 && (
                    <div className="mt-4 p-4 rounded-lg bg-orange-500/10 border border-orange-500/30">
                      <p className="text-sm text-orange-300 font-satoshi font-medium mb-2">
                        How to get USDC on Solana Devnet:
                      </p>
                      <ol className="text-xs text-orange-200/80 space-y-1 list-decimal list-inside font-satoshi">
                        <li>Visit <a href="https://spl-token-faucet.com/" target="_blank" rel="noopener noreferrer" className="underline hover:text-orange-100">spl-token-faucet.com</a></li>
                        <li>Select "USDC" from the token list</li>
                        <li>Paste your wallet address: <code className="bg-orange-900/30 px-1 rounded">{publicKey?.toString().substring(0, 8)}...</code></li>
                        <li>Click "Get Tokens" and wait for confirmation</li>
                        <li>Refresh this page after receiving USDC</li>
                      </ol>
                      <p className="text-xs text-orange-200/60 mt-3 font-satoshi">
                        Alternative: Use <a href="https://jup.ag/swap" target="_blank" rel="noopener noreferrer" className="underline">Jupiter</a> to swap SOL for USDC on devnet
                      </p>
                    </div>
                  )}
                </div>
                
                <div className="panel-muted rounded-lg p-4 space-y-2">
                  <div className="flex justify-between">
                    <span className="text-forge-gray-400 text-sm">Supply APY</span>
                    <span className="text-forge-success font-heading">{(market.supplyApyBps / 100).toFixed(2)}%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-forge-gray-400 text-sm">Utilization</span>
                    <span className="text-white font-heading">{(market.utilizationBps / 100).toFixed(2)}%</span>
                  </div>
                </div>
                
                <button
                  onClick={async () => {
                    if (!supplyAmount || parseFloat(supplyAmount) <= 0) {
                      alert('Please enter a valid amount')
                      return
                    }
                    if (parseFloat(supplyAmount) > usdcBalance) {
                      alert(`Insufficient USDC balance. You have ${formatUSDC(usdcBalance)} USDC`)
                      return
                    }
                    
                    setSupplyLoading(true)
                    try {
                      await supply(selectedMarket, supplyAmount)
                      setSelectedMarket(null)
                      setSupplyAmount('')
                      alert(`Successfully supplied ${formatUSDC(parseFloat(supplyAmount))} USDC`)
                    } catch (error: any) {
                      alert(error.message || 'Supply failed')
                    } finally {
                      setSupplyLoading(false)
                    }
                  }}
                  disabled={supplyLoading || !connected || parseFloat(supplyAmount) <= 0 || parseFloat(supplyAmount) > usdcBalance}
                  className="w-full px-4 py-3 bg-forge-primary hover:bg-forge-primary/90 text-white rounded-xl font-satoshi font-medium transition-all duration-200 hover:scale-105 hover:shadow-lg hover:shadow-forge-primary/20 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
                >
                  {supplyLoading ? 'Supplying...' : 'Supply'}
                </button>
              </div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}


