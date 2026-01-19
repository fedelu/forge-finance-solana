import React from 'react'
import Link from 'next/link'
import { 
  CheckCircleIcon,
  XCircleIcon
} from '@heroicons/react/24/outline'

export default function DocsPage() {

  return (
    <div className="min-h-screen flex flex-col">
      <div className="flex-1">
        {/* Main Content */}
        <main className="px-4 py-8 lg:px-8 max-w-4xl mx-auto">
          <div className="prose prose-invert prose-lg max-w-none">
            {/* Enhanced Header Section */}
            <div className="mb-12 lg:mb-16 relative pt-8 lg:pt-12">
              {/* Decorative background elements */}
              <div className="absolute inset-0 -z-10 overflow-hidden pointer-events-none">
                <div className="absolute top-0 left-0 w-64 h-64 lg:w-96 lg:h-96 bg-forge-primary/5 rounded-full blur-3xl"></div>
                <div className="absolute top-0 right-0 w-64 h-64 lg:w-96 lg:h-96 bg-forge-primary-light/5 rounded-full blur-3xl"></div>
              </div>
              
              {/* Main Title */}
              <h1 className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-bold bg-gradient-to-r from-forge-primary via-forge-primary-light to-forge-primary bg-clip-text text-transparent leading-tight mb-4 lg:mb-6">
                Forge Protocol
              </h1>
              
              {/* Subtitle */}
              <p className="text-base sm:text-lg lg:text-xl text-forge-gray-300 mb-6 lg:mb-8 font-light leading-relaxed max-w-3xl">
                Complete guide to understanding and using Forge Protocol
              </p>
              
              {/* Version Info with better styling */}
              <div className="flex flex-wrap items-center gap-3 text-xs sm:text-sm">
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 backdrop-blur-sm">
                  <span className="text-forge-gray-400">Version</span>
                  <span className="text-forge-primary font-semibold">1.0</span>
                </div>
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 backdrop-blur-sm">
                  <span className="text-forge-gray-400">Last Updated</span>
                  <span className="text-white font-medium">January 2026</span>
                </div>
              </div>
            </div>

            {/* Executive Summary */}
            <section id="executive-summary" className="mb-16 scroll-mt-24">
              <h2 className="text-3xl font-bold mb-6 text-white">Executive Summary</h2>
              <div className="space-y-4 text-forge-gray-300">
                <p className="text-lg leading-relaxed">
                  <strong className="text-white">Forge Protocol</strong> is a permissionless, modular decentralized finance (DeFi) protocol built on Solana that enables any SPL token to become the foundation of a self-sustaining financial system. The protocol creates yield-generating vaults called <strong className="text-forge-primary">"Crucibles"</strong> which provide depositors with synthetic wrapped versions of deposited assets (cTokens).
                </p>
                <p>
                  Crucibles unlock yield opportunities through internal protocol mechanics including <strong className="text-white">Volatility Farming</strong>, <strong className="text-white">Inferno Mode</strong>, and <strong className="text-white">Lending Markets</strong>. These primitives work together to generate <strong className="text-forge-primary">organic yield from volatility and market activity</strong>, without relying on inflationary token emissions.
                </p>
              </div>

              <div className="mt-8 p-6 rounded-2xl border border-forge-primary/30 bg-gradient-to-br from-forge-primary/10 to-transparent backdrop-blur-sm">
                <h3 className="text-xl font-semibold mb-4 text-white">Why Forge Protocol Exists</h3>
                <p className="text-forge-gray-300 leading-relaxed">
                  Most DeFi protocols rely on emissions through newly minted tokens distributed as rewards. These emissions dilute supply, decay in effectiveness over time, and devalue the very assets they're designed to support. <strong className="text-forge-primary">Forge Protocol eliminates this dependence</strong> by treating volatility as a yield source, enabling real, sustainable incentives.
                </p>
                <p className="mt-4 text-forge-gray-300">
                  The protocol captures fees from wrapping/unwrapping assets, trading activity, and borrowing behavior. <strong className="text-white">These fees are recycled back into the system</strong>, creating a compounding flywheel for protocol growth that does not require new token issuance.
                </p>
              </div>
            </section>

            {/* Project Overview */}
            <section id="project-overview" className="mb-16 scroll-mt-24">
              <h2 className="text-3xl font-bold mb-6 text-white">Project Overview</h2>
              
              <div className="space-y-6 text-forge-gray-300">
                <div>
                  <h3 className="text-xl font-semibold mb-3 text-white">What is Forge Protocol?</h3>
                  <p className="leading-relaxed">
                    <strong className="text-white">Forge Protocol</strong> is a permissionless, modular DeFi protocol that allows any SPL token to become the foundation of a self-sustaining financial system. The protocol enables the creation of vaults called <strong className="text-forge-primary">"Crucibles"</strong> which provide depositors with synthetic wrapped versions of deposited assets (cTokens like cSOL).
                  </p>
                </div>

                <div className="grid md:grid-cols-2 gap-4 mt-6">
                  <div className="p-5 rounded-xl border border-white/10 bg-black/40 backdrop-blur-sm">
                    <h4 className="font-semibold text-white mb-2">Sustainability</h4>
                    <p className="text-sm text-forge-gray-400">No emissions or inflationary mechanics. Yield comes exclusively from on-chain economic activity.</p>
                  </div>
                  <div className="p-5 rounded-xl border border-white/10 bg-black/40 backdrop-blur-sm">
                    <h4 className="font-semibold text-white mb-2">Transparency</h4>
                    <p className="text-sm text-forge-gray-400">All actions and fee flows recorded on-chain. Protocol parameters are transparent and verifiable.</p>
                  </div>
                  <div className="p-5 rounded-xl border border-white/10 bg-black/40 backdrop-blur-sm">
                    <h4 className="font-semibold text-white mb-2">Accessibility</h4>
                    <p className="text-sm text-forge-gray-400">Anyone can deposit assets and start earning yield immediately. No approvals or governance votes required.</p>
                  </div>
                  <div className="p-5 rounded-xl border border-white/10 bg-black/40 backdrop-blur-sm">
                    <h4 className="font-semibold text-white mb-2">Aligned Incentives</h4>
                    <p className="text-sm text-forge-gray-400">Each participant role earns value in different ways, creating a sustainable ecosystem.</p>
                  </div>
                </div>
              </div>
            </section>

            {/* How It Works */}
            <section id="how-it-works" className="mb-16 scroll-mt-24">
              <h2 className="text-3xl font-bold mb-6 text-white">How It Works</h2>
              
              <div className="space-y-6">
                <div className="p-6 rounded-2xl border border-forge-primary/30 bg-gradient-to-br from-forge-primary/10 to-transparent backdrop-blur-sm">
                  <h3 className="text-xl font-semibold mb-4 text-white">Volatility as a Yield Source</h3>
                  <p className="text-forge-gray-300 mb-4 leading-relaxed">
                    <strong className="text-forge-primary">Forge Protocol treats volatility as a yield source</strong>, enabling real, sustainable incentives. Unlike protocols that rely on token emissions, Forge Protocol generates yield exclusively from on-chain economic activity.
                  </p>
                  <ol className="space-y-3 text-forge-gray-300 list-decimal list-inside">
                    <li><strong className="text-white">Market Volatility Creates Opportunities</strong>: When asset prices fluctuate, price deviations between wrapped tokens (cTokens) and underlying assets create arbitrage opportunities</li>
                    <li><strong className="text-white">Arbitrageurs Capture Spreads</strong>: Traders automatically wrap/unwrap tokens to capture price differences</li>
                    <li><strong className="text-white">Fees Generate Yield</strong>: Each wrap/unwrap transaction generates fees - 80% accumulates in the vault, increasing the exchange rate (vault_balance / ctoken_supply), which generates yield for all cToken holders</li>
                    <li><strong className="text-white">Direct Arbitrage Deposits</strong>: Arbitrageurs can deposit profits directly via <code className="px-1.5 py-0.5 rounded bg-forge-primary/20 text-forge-primary">deposit_arbitrage_profit</code> - 80% goes to vault (increases yield), 20% to treasury, with 1% reward for the arbitrageur</li>
                    <li><strong className="text-white">Exchange Rate Growth</strong>: As fees accumulate in the vault, each cToken becomes worth more base tokens over time - this is how yield is realized</li>
                    <li><strong className="text-white">Compounding Flywheel</strong>: More fees in vault → higher exchange rate → more value per cToken → attracts more deposits → more fees</li>
                  </ol>
                </div>

                <div className="mt-6 p-6 rounded-xl border border-white/10 bg-black/40 backdrop-blur-sm">
                  <h4 className="font-semibold mb-3 text-white">The Compounding Flywheel</h4>
                  <div className="space-y-2 text-sm text-forge-gray-400 font-mono">
                    <div>Market Volatility</div>
                    <div className="text-forge-primary">↓</div>
                    <div>Price Deviations</div>
                    <div className="text-forge-primary">↓</div>
                    <div>Arbitrage Opportunities</div>
                    <div className="text-forge-primary">↓</div>
                    <div>Wrap/Unwrap Activity</div>
                    <div className="text-forge-primary">↓</div>
                    <div>Fee Generation</div>
                    <div className="text-forge-primary">↓</div>
                    <div>Fees Distributed (80% to Vault, 20% to Protocol)</div>
                    <div className="text-forge-primary">↓</div>
                    <div>Vault Balance Grows (80% fees accumulate)</div>
                    <div className="text-forge-primary">↓</div>
                    <div>Exchange Rate Grows (vault_balance / ctoken_supply)</div>
                    <div className="text-forge-primary">↓</div>
                    <div>Each cToken Worth More Base Tokens (Yield Realized)</div>
                    <div className="text-forge-primary">↓</div>
                    <div>Higher Yield Attracts More Deposits</div>
                    <div className="text-forge-primary">↓</div>
                    <div>Increased TVL = More Fee Revenue</div>
                    <div className="text-forge-primary">↓</div>
                    <div className="text-forge-primary">Cycle Repeats (Compounding Growth)</div>
                  </div>
                </div>
              </div>
            </section>

            {/* Arbitrage Revenue Mechanism */}
            <section id="arbitrage-revenue" className="mb-16 scroll-mt-24">
              <h2 className="text-3xl font-bold mb-6 text-white">Arbitrage Revenue to Crucible Yield</h2>
              
              <div className="space-y-6">
                <div className="p-6 rounded-2xl border border-forge-primary/30 bg-gradient-to-br from-forge-primary/10 to-transparent backdrop-blur-sm">
                  <h3 className="text-xl font-semibold mb-4 text-white">How Arbitrage Revenue Flows to Yield</h3>
                  <p className="text-forge-gray-300 mb-4 leading-relaxed">
                    Forge Protocol includes a dedicated mechanism that allows arbitrageurs to route their profits directly into crucible vaults, increasing yield for all cToken holders. This creates a <strong className="text-forge-primary">direct revenue stream</strong> from arbitrage activity that benefits the entire protocol.
                  </p>
                  
                  <div className="mt-6 space-y-4">
                    <div className="p-4 rounded-lg bg-black/40 border border-white/10">
                      <h4 className="font-semibold text-white mb-2">The Arbitrage Deposit Mechanism</h4>
                      <p className="text-sm text-forge-gray-300 mb-3">
                        Arbitrageurs can use the <code className="px-2 py-1 rounded bg-forge-primary/20 text-forge-primary">deposit_arbitrage_profit</code> instruction to deposit their profits directly into the crucible vault.
                      </p>
                      <div className="space-y-2 text-sm text-forge-gray-400">
                        <div className="flex items-start gap-2">
                          <span className="text-forge-primary">•</span>
                          <span><strong className="text-white">80% goes to vault</strong> - Increases exchange rate and yield for all cToken holders</span>
                        </div>
                        <div className="flex items-start gap-2">
                          <span className="text-forge-primary">•</span>
                          <span><strong className="text-white">20% goes to treasury</strong> - Protocol revenue for operations and development</span>
                        </div>
                        <div className="flex items-start gap-2">
                          <span className="text-forge-primary">•</span>
                          <span><strong className="text-white">1% reward</strong> - Arbitrageurs receive cTokens as an incentive to route profits back</span>
                        </div>
                      </div>
                    </div>

                    <div className="p-4 rounded-lg bg-forge-primary/10 border border-forge-primary/20">
                      <h4 className="font-semibold text-white mb-2">Example: Arbitrage Deposit</h4>
                      <div className="text-sm text-forge-gray-300 space-y-1 font-mono">
                        <div>Arbitrageur profits: 1,000 SOL</div>
                        <div className="text-forge-primary">↓ deposit_arbitrage_profit(1000)</div>
                        <div>Vault receives: 800 SOL (80%) → Increases yield</div>
                        <div>Treasury receives: 200 SOL (20%) → Protocol revenue</div>
                        <div>Arbitrageur receives: ~10 cSOL (1% reward)</div>
                        <div className="text-forge-primary mt-2">Result: All cToken holders benefit from increased exchange rate</div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="p-6 rounded-xl border border-white/10 bg-black/40 backdrop-blur-sm">
                  <h3 className="text-xl font-semibold mb-4 text-white">Why This Matters</h3>
                  <div className="space-y-3 text-forge-gray-300">
                    <div>
                      <strong className="text-white">Direct Yield Increase:</strong> Arbitrage profits flow directly into the vault, increasing the exchange rate (vault_balance / ctoken_supply) which benefits all cToken holders proportionally.
                    </div>
                    <div>
                      <strong className="text-white">Sustainable Revenue:</strong> Unlike token emissions, arbitrage revenue comes from real market activity and price inefficiencies, creating sustainable yield.
                    </div>
                    <div>
                      <strong className="text-white">Incentive Alignment:</strong> The 1% cToken reward incentivizes arbitrageurs to route profits back to the protocol, creating a positive feedback loop.
                    </div>
                    <div>
                      <strong className="text-white">Automatic Distribution:</strong> The 80/20 split is handled automatically by the smart contract, ensuring fair distribution without manual intervention.
                    </div>
                  </div>
                </div>

                <div className="p-6 rounded-xl border border-forge-primary/30 bg-gradient-to-br from-forge-primary/10 to-transparent backdrop-blur-sm">
                  <h3 className="text-xl font-semibold mb-4 text-white">How It Works Technically</h3>
                  <ol className="space-y-3 text-forge-gray-300 list-decimal list-inside">
                    <li><strong className="text-white">Arbitrageur executes trade</strong> - Captures price difference between cToken and base token</li>
                    <li><strong className="text-white">Calculates net profit</strong> - After accounting for swap fees, wrap/unwrap fees, and gas costs</li>
                    <li><strong className="text-white">Calls deposit_arbitrage_profit</strong> - Deposits profit amount to crucible</li>
                    <li><strong className="text-white">Smart contract splits</strong> - 80% to vault, 20% to treasury automatically</li>
                    <li><strong className="text-white">Vault balance increases</strong> - total_fees_accrued increases by 80% of deposit</li>
                    <li><strong className="text-white">Exchange rate grows</strong> - (total_base_deposited + total_fees_accrued) / ctoken_supply increases</li>
                    <li><strong className="text-white">Yield increases</strong> - All cToken holders benefit from higher exchange rate</li>
                    <li><strong className="text-white">Arbitrageur rewarded</strong> - Receives 1% of deposit as cTokens</li>
                  </ol>
                </div>

                <div className="mt-6 p-6 rounded-xl border border-white/10 bg-black/40 backdrop-blur-sm">
                  <h4 className="font-semibold mb-3 text-white">Integration with Existing Yield Sources</h4>
                  <p className="text-sm text-forge-gray-300 mb-3">
                    Arbitrage deposits are seamlessly integrated with existing yield mechanisms:
                  </p>
                  <div className="space-y-2 text-sm text-forge-gray-400">
                    <div>• Arbitrage deposits increase <code className="px-1.5 py-0.5 rounded bg-forge-primary/20 text-forge-primary">total_fees_accrued</code></div>
                    <div>• Exchange rate calculation includes arbitrage revenue: <code className="px-1.5 py-0.5 rounded bg-forge-primary/20 text-forge-primary">(total_base_deposited + total_fees_accrued) / ctoken_supply</code></div>
                    <div>• Yield displays automatically include arbitrage contributions</div>
                    <div>• No separate tracking needed - everything flows through the same mechanism</div>
                  </div>
                </div>
              </div>
            </section>

            {/* Core Products */}
            <section id="core-products" className="mb-16 scroll-mt-24">
              <h2 className="text-3xl font-bold mb-6 text-white">Core Products & Features</h2>
              
              <div className="space-y-8">
                {/* Crucible Staking */}
                <div className="p-6 rounded-2xl border border-white/10 bg-black/40 backdrop-blur-sm">
                  <h3 className="text-2xl font-bold text-white mb-4">1. Crucible Staking (Volatility Farming)</h3>
                  <p className="text-forge-gray-300 mb-4">
                    Deposit assets into a "Crucible" to receive yield-bearing cTokens. This is the foundation of <strong className="text-forge-primary">Volatility Farming</strong> - earning yield from market volatility and trading activity.
                  </p>
                  <div className="grid md:grid-cols-2 gap-4 mt-4">
                    <div>
                      <h4 className="font-semibold text-white mb-2">Key Features</h4>
                      <ul className="space-y-1 text-sm text-forge-gray-400">
                        <li>• Wrap Fee: 0.5% on deposit</li>
                        <li>• Unwrap Fee: 0.75% → 0.3% (after 5-day cooldown)</li>
                        <li>• Yield Mechanism: 80% of wrap/unwrap fees accumulate in vault, growing the exchange rate (vault_balance / ctoken_supply) to create yield</li>
                        <li>• Volatility-Driven: Higher volatility = higher yield</li>
                        <li>• No Emissions: All yield from real market activity</li>
                      </ul>
                    </div>
                    <div className="p-4 rounded-lg bg-forge-primary/10 border border-forge-primary/20">
                      <h4 className="font-semibold text-white mb-2">Example</h4>
                      <div className="text-sm text-forge-gray-300 space-y-1">
                        <div>Deposit: 100 SOL</div>
                        <div>Wrap Fee: 0.5 SOL (0.5%)</div>
                        <div>cTokens Received: ~95.2 cSOL</div>
                        <div>APY: 8-12% (varies by volatility)</div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* LP Positions */}
                <div className="p-6 rounded-2xl border border-white/10 bg-black/40 backdrop-blur-sm">
                  <h3 className="text-2xl font-bold text-white mb-4">2. Liquidity Pool (LP) Positions</h3>
                  <p className="text-forge-gray-300 mb-4">
                    Provide liquidity to DEX pairs and earn from <strong className="text-forge-primary">dual fee capture</strong> - both DEX trading fees and protocol arbitrage fees.
                  </p>
                  <div className="grid md:grid-cols-2 gap-4 mt-4">
                    <div>
                      <h4 className="font-semibold text-white mb-2">Key Features</h4>
                      <ul className="space-y-1 text-sm text-forge-gray-400">
                        <li>• Open Fee: 1% of position value</li>
                        <li>• Close Fee: 2% principal + 10% yield</li>
                        <li>• LP APY: ~3x base Crucible APY</li>
                        <li>• Dual Fee Capture: DEX + arbitrage fees</li>
                        <li>• Volatility Amplification</li>
                      </ul>
                    </div>
                    <div className="p-4 rounded-lg bg-forge-primary/10 border border-forge-primary/20">
                      <h4 className="font-semibold text-white mb-2">Example</h4>
                      <div className="text-sm text-forge-gray-300 space-y-1">
                        <div>Deposit: 100 cSOL + $20,000 USDC</div>
                        <div>LP APY: ~24% (3x base)</div>
                        <div>Annual Yield: ~$9,504</div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Inferno Mode */}
                <div className="p-6 rounded-2xl border border-white/10 bg-black/40 backdrop-blur-sm">
                  <h3 className="text-2xl font-bold text-white mb-4">3. Inferno Mode</h3>
                  <p className="text-forge-gray-300 mb-4">
                    <strong className="text-forge-primary">Inferno Mode</strong> allows you to amplify your exposure to volatility farming strategies by utilizing leverage. Borrow assets to increase position size and potentially enhance returns.
                  </p>
                  <div className="grid md:grid-cols-2 gap-4 mt-4">
                    <div>
                      <h4 className="font-semibold text-white mb-2">Key Features</h4>
                      <ul className="space-y-1 text-sm text-forge-gray-400">
                        <li>• Leverage: Up to 2x (1.5x and 2x options)</li>
                        <li>• Borrowing Rate: 10% APY</li>
                        <li>• Health Factor Monitoring</li>
                        <li>• Liquidation Threshold: 10% fee</li>
                        <li>• Volatility Amplification</li>
                      </ul>
                    </div>
                    <div className="p-4 rounded-lg bg-red-500/10 border border-red-500/20">
                      <h4 className="font-semibold text-white mb-2">Risk Note</h4>
                      <p className="text-sm text-forge-gray-300">
                        While leverage can magnify gains, it also increases the risk of losses. Users should carefully monitor positions and maintain adequate health factors.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            {/* Fee Structure */}
            <section id="fee-structure" className="mb-16 scroll-mt-24">
              <h2 className="text-3xl font-bold mb-6 text-white">Fee Structure</h2>
              
              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="border-b border-white/10">
                      <th className="text-left py-3 px-4 text-white font-semibold">Operation</th>
                      <th className="text-left py-3 px-4 text-white font-semibold">Fee</th>
                      <th className="text-left py-3 px-4 text-white font-semibold">Notes</th>
                    </tr>
                  </thead>
                  <tbody className="text-forge-gray-300">
                    <tr className="border-b border-white/5">
                      <td className="py-3 px-4">Wrap</td>
                      <td className="py-3 px-4 text-forge-primary">0.5%</td>
                      <td className="py-3 px-4 text-sm">Charged on deposit amount</td>
                    </tr>
                    <tr className="border-b border-white/5">
                      <td className="py-3 px-4">Unwrap</td>
                      <td className="py-3 px-4 text-forge-primary">0.75% → 0.3%</td>
                      <td className="py-3 px-4 text-sm">Starts at 0.75%, reduces to 0.3% after 5-day cooldown</td>
                    </tr>
                    <tr className="border-b border-white/5">
                      <td className="py-3 px-4">Open LP Position</td>
                      <td className="py-3 px-4 text-forge-primary">1%</td>
                      <td className="py-3 px-4 text-sm">Charged on total position value</td>
                    </tr>
                    <tr className="border-b border-white/5">
                      <td className="py-3 px-4">Close LP Position</td>
                      <td className="py-3 px-4 text-forge-primary">2% + 10%</td>
                      <td className="py-3 px-4 text-sm">2% of principal + 10% of yield earned</td>
                    </tr>
                    <tr className="border-b border-white/5">
                      <td className="py-3 px-4">Liquidation</td>
                      <td className="py-3 px-4 text-forge-primary">10%</td>
                      <td className="py-3 px-4 text-sm">Charged if position becomes undercollateralized</td>
                    </tr>
                    <tr className="border-b border-white/5">
                      <td className="py-3 px-4">Lending Yield Fee</td>
                      <td className="py-3 px-4 text-forge-primary">10%</td>
                      <td className="py-3 px-4 text-sm">Protocol takes 10% of lending yield</td>
                    </tr>
                    <tr>
                      <td className="py-3 px-4">Arbitrage Deposit</td>
                      <td className="py-3 px-4 text-forge-primary">80/20 Split</td>
                      <td className="py-3 px-4 text-sm">80% to vault (yield), 20% to treasury, 1% reward to arbitrageur</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div className="mt-6 p-6 rounded-xl border border-forge-primary/30 bg-gradient-to-br from-forge-primary/10 to-transparent backdrop-blur-sm">
                <h3 className="text-xl font-semibold mb-4 text-white">Fee Distribution</h3>
                <div className="grid md:grid-cols-2 gap-4">
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <CheckCircleIcon className="w-5 h-5 text-forge-primary" />
                      <span className="font-semibold text-white">80% → Crucible Stakers</span>
                    </div>
                    <p className="text-sm text-forge-gray-400 ml-7">Distributed to cToken holders based on their stake. Includes wrap/unwrap fees, LP fees, LVF fees, and arbitrage deposits.</p>
                  </div>
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <CheckCircleIcon className="w-5 h-5 text-forge-primary" />
                      <span className="font-semibold text-white">20% → FORGE Protocol</span>
                    </div>
                    <p className="text-sm text-forge-gray-400 ml-7">Protocol treasury for development and operations. Includes 20% of all fees and arbitrage deposits.</p>
                  </div>
                </div>
                <div className="mt-4 p-4 rounded-lg bg-forge-primary/10 border border-forge-primary/20">
                  <p className="text-sm text-forge-gray-300">
                    <strong className="text-white">Arbitrage Deposits:</strong> When arbitrageurs deposit profits via <code className="px-1.5 py-0.5 rounded bg-forge-primary/20 text-forge-primary">deposit_arbitrage_profit</code>, they receive a 1% cToken reward as an incentive, while 80% goes to vault (increasing yield) and 20% goes to treasury.
                  </p>
                </div>
              </div>
            </section>

            {/* Tokenomics */}
            <section id="tokenomics" className="mb-16 scroll-mt-24">
              <h2 className="text-3xl font-bold mb-6 text-white">Tokenomics & Revenue Model</h2>
              
              <div className="space-y-6">
                <div className="p-6 rounded-xl border border-white/10 bg-black/40 backdrop-blur-sm">
                  <h3 className="text-xl font-semibold mb-4 text-white">Revenue Streams</h3>
                  <p className="text-forge-gray-300 mb-4">
                    All revenue comes from <strong className="text-forge-primary">real on-chain economic activity</strong>, not token emissions:
                  </p>
                  <ul className="space-y-2 text-forge-gray-300">
                    <li>• <strong className="text-white">Wrap/Unwrap Fees</strong>: 0.5-0.75% on all token wrapping operations (volatility-driven)</li>
                    <li>• <strong className="text-white">Arbitrage Deposits</strong>: 80% of arbitrage profits routed directly to vault (increases yield)</li>
                    <li>• <strong className="text-white">LP Position Fees</strong>: 1% open + 2% close + 10% yield fee</li>
                    <li>• <strong className="text-white">Liquidation Fees</strong>: 10% on liquidated positions</li>
                    <li>• <strong className="text-white">Lending Fees</strong>: 10% of lending yield (interest rate spread)</li>
                    <li>• <strong className="text-white">Trading Activity</strong>: Fees from DEX trading on LP pairs</li>
                  </ul>
                </div>

                <div className="p-6 rounded-xl border border-forge-primary/30 bg-gradient-to-br from-forge-primary/10 to-transparent backdrop-blur-sm">
                  <h3 className="text-xl font-semibold mb-4 text-white">Sustainable Growth Model</h3>
                  <p className="text-forge-gray-300 mb-4">
                    Unlike emission-based protocols, Forge Protocol's growth is <strong className="text-forge-primary">self-sustaining</strong>:
                  </p>
                  <div className="space-y-2 text-forge-gray-300">
                    <div>• More volatility → More arbitrage → More fees → Higher yield</div>
                    <div>• Higher yield → More deposits → Higher TVL → More fees</div>
                    <div>• Fees recycled → Compounding growth → Sustainable ecosystem</div>
                  </div>
                </div>
              </div>
            </section>

            {/* User Guides */}
            <section id="user-guides" className="mb-16 scroll-mt-24">
              <h2 className="text-3xl font-bold mb-6 text-white">User Guides</h2>
              
              <div className="space-y-6">
                <div className="p-6 rounded-xl border border-white/10 bg-black/40 backdrop-blur-sm">
                  <h3 className="text-xl font-semibold mb-4 text-white">Getting Started</h3>
                  <ol className="space-y-3 text-forge-gray-300 list-decimal list-inside">
                    <li><strong className="text-white">Connect Wallet</strong>: Install Phantom or Solflare wallet and connect to Solana Devnet (for testing) or Mainnet (for production)</li>
                    <li><strong className="text-white">Get Test Tokens</strong>: Use Solana faucet to get devnet SOL and USDC</li>
                    <li><strong className="text-white">Start Staking</strong>: Navigate to Crucibles section and deposit tokens</li>
                    <li><strong className="text-white">Monitor Yield</strong>: Track your cToken balance and accumulated yield</li>
                  </ol>
                </div>

              </div>
            </section>




            {/* Footer */}
            <div className="mt-16 pt-8 border-t border-white/10">
              <div className="flex flex-col md:flex-row justify-between items-center gap-4 text-sm text-forge-gray-500">
                <div>
                  <p className="text-forge-gray-400">For more information, visit the <Link href="/demo" className="text-forge-primary hover:text-forge-primary-light">Demo</Link> page</p>
                </div>
                <div>
                  <p>© 2026 Forge Protocol. All rights reserved.</p>
                </div>
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}

