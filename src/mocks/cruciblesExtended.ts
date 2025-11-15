/**
 * Extended Crucible Mock Data
 * Simulates yield changes, LP returns, and leverage updates for MVP demo
 */

export interface ExtendedCrucibleData {
  id: string
  baseToken: 'SOL' | 'FORGE'
  ptokenSymbol: 'cSOL' | 'cFORGE'
  
  // Wrap Mode Data
  wrapMode: {
    exchangeRate: number // Current exchange rate (e.g., 1.045)
    totalWrapped: number // Total base tokens wrapped
    totalCTokens: number // Total cTokens minted
    baseAPY: number // Base APY for wrapping
    yieldEarned: number // Total yield earned
  }
  
  // LP Mode Data
  lpMode: {
    totalLPPositions: number
    totalBaseInLP: number
    totalUSDCInLP: number
    lpAPY: number // LP APY = baseAPY * 3
    totalLPValue: number // Total value in LP pool (USD)
    tradingVolume24h: number // 24h trading volume
  }
  
  // Leveraged LP Mode Data
  leveragedMode: {
    totalLeveragedPositions: number
    totalCollateral: number
    totalBorrowedUSDC: number
    averageLeverage: number
    leveragedAPY: number // Effective APY after borrow costs
    borrowInterestRate: number // 5% APY
    totalLeveragedValue: number // Total value in leveraged positions (USD)
  }
  
  // Health Metrics
  healthMetrics: {
    totalTVL: number // Total Value Locked
    utilizationRate: number // Utilization rate of lending pool
    avgHealthFactor: number // Average health factor across leveraged positions
    liquidationThreshold: number // Liquidation threshold
  }
}

// Mock data that updates every 5 seconds
let mockData: ExtendedCrucibleData[] = [
  {
    id: 'sol-crucible',
    baseToken: 'SOL',
    ptokenSymbol: 'cSOL',
    wrapMode: {
      exchangeRate: 1.045,
      totalWrapped: 6450000,
      totalCTokens: 6172249, // cTokens = wrapped / exchangeRate
      baseAPY: 18.0,
      yieldEarned: 290250, // Estimated yield earned
    },
    lpMode: {
      totalLPPositions: 45,
      totalBaseInLP: 500000,
      totalUSDCInLP: 250000, // Equal value
      lpAPY: 54.0, // baseAPY * 3
      totalLPValue: 500000,
      tradingVolume24h: 125000,
    },
    leveragedMode: {
      totalLeveragedPositions: 32,
      totalCollateral: 800000,
      totalBorrowedUSDC: 600000,
      averageLeverage: 1.75,
      leveragedAPY: 93.5, // (18 * 3 * 1.75) - (5 * 0.75)
      borrowInterestRate: 5.0,
      totalLeveragedValue: 1400000,
    },
    healthMetrics: {
      totalTVL: 2395000,
      utilizationRate: 0.6, // 60% of lending pool utilized
      avgHealthFactor: 1.87,
      liquidationThreshold: 1.2,
    },
  },
  {
    id: 'forge-crucible',
    baseToken: 'FORGE',
    ptokenSymbol: 'cFORGE',
    wrapMode: {
      exchangeRate: 1.045,
      totalWrapped: 2150000,
      totalCTokens: 2057416,
      baseAPY: 32.0,
      yieldEarned: 68800,
    },
    lpMode: {
      totalLPPositions: 28,
      totalBaseInLP: 150000,
      totalUSDCInLP: 300, // Equal value at $0.002 per FORGE
      lpAPY: 96.0, // baseAPY * 3
      totalLPValue: 600,
      tradingVolume24h: 150,
    },
    leveragedMode: {
      totalLeveragedPositions: 18,
      totalCollateral: 250000,
      totalBorrowedUSDC: 250,
      averageLeverage: 2.0,
      leveragedAPY: 187.0, // (32 * 3 * 2) - (5 * 1)
      borrowInterestRate: 5.0,
      totalLeveragedValue: 750,
    },
    healthMetrics: {
      totalTVL: 2153600,
      utilizationRate: 0.45,
      avgHealthFactor: 2.08,
      liquidationThreshold: 1.2,
    },
  },
]

// Simulate random updates every 5 seconds
export function startMockUpdates(callback: (data: ExtendedCrucibleData[]) => void) {
  const updateInterval = setInterval(() => {
    mockData = mockData.map(crucible => {
      // Random variations (±2% for exchange rate, ±5% for other metrics)
      const exchangeRateDelta = (Math.random() - 0.5) * 0.02 // ±1% of 1.045
      const yieldDelta = (Math.random() - 0.5) * 0.05 // ±5%
      const volumeDelta = (Math.random() - 0.5) * 0.1 // ±10%
      
      return {
        ...crucible,
        wrapMode: {
          ...crucible.wrapMode,
          exchangeRate: Math.max(1.0, crucible.wrapMode.exchangeRate + exchangeRateDelta),
          yieldEarned: Math.max(0, crucible.wrapMode.yieldEarned * (1 + yieldDelta)),
        },
        lpMode: {
          ...crucible.lpMode,
          tradingVolume24h: Math.max(0, crucible.lpMode.tradingVolume24h * (1 + volumeDelta)),
          totalLPValue: crucible.lpMode.totalBaseInLP * (crucible.baseToken === 'FORGE' ? 0.002 : 200) + crucible.lpMode.totalUSDCInLP,
        },
        leveragedMode: {
          ...crucible.leveragedMode,
          leveragedAPY: Math.max(0, crucible.leveragedMode.leveragedAPY + (Math.random() - 0.5) * 2),
        },
        healthMetrics: {
          ...crucible.healthMetrics,
          avgHealthFactor: Math.max(1.0, crucible.healthMetrics.avgHealthFactor + (Math.random() - 0.5) * 0.1),
          utilizationRate: Math.max(0, Math.min(1, crucible.healthMetrics.utilizationRate + (Math.random() - 0.5) * 0.05)),
        },
      }
    })
    
    callback(mockData)
  }, 5000) // Update every 5 seconds
  
  return () => clearInterval(updateInterval)
}

export function getExtendedCrucibleData(crucibleId: string): ExtendedCrucibleData | undefined {
  return mockData.find(c => c.id === crucibleId)
}

export function getAllExtendedCrucibleData(): ExtendedCrucibleData[] {
  return mockData
}

// Calculate weighted APY across all position types
export function calculateWeightedAPY(crucible: ExtendedCrucibleData): number {
  const wrapValue = crucible.wrapMode.totalWrapped * (crucible.baseToken === 'FORGE' ? 0.002 : 200)
  const lpValue = crucible.lpMode.totalLPValue
  const leveragedValue = crucible.leveragedMode.totalLeveragedValue
  const totalValue = wrapValue + lpValue + leveragedValue
  
  if (totalValue === 0) return crucible.wrapMode.baseAPY
  
  const wrapWeight = wrapValue / totalValue
  const lpWeight = lpValue / totalValue
  const leveragedWeight = leveragedValue / totalValue
  
  return (
    crucible.wrapMode.baseAPY * wrapWeight +
    crucible.lpMode.lpAPY * lpWeight +
    crucible.leveragedMode.leveragedAPY * leveragedWeight
  )
}

// Get total deposited value across all modes
export function getTotalDepositedValue(crucible: ExtendedCrucibleData): number {
  const wrapValue = crucible.wrapMode.totalWrapped * (crucible.baseToken === 'FORGE' ? 0.002 : 200)
  const lpValue = crucible.lpMode.totalLPValue
  const leveragedValue = crucible.leveragedMode.totalLeveragedValue
  
  return wrapValue + lpValue + leveragedValue
}

