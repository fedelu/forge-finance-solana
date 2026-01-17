/**
 * USDC-only Lending Pool for Crucible Leverage
 * This is the only lending pool used for leverage in crucibles.
 * Allows crucible positions to borrow USDC for leveraged LP positions.
 * Fetches real data from on-chain lending pool.
 */

import { fetchLendingPoolDirect, createDevnetConnection } from '../utils/crucibleFetcher'

interface LendingPoolState {
  totalLiquidity: number
  borrowed: number
  interestRate: number // APY as decimal (0.10 = 10%)
  lastFetchTime: number
}

class LendingPool {
  private state: LendingPoolState = {
    totalLiquidity: 0, // Will be fetched from on-chain (no fake data)
    borrowed: 0,
    interestRate: 0.05, // 5% APY (default, will be updated from on-chain)
    lastFetchTime: 0,
  }
  
  private fetchPromise: Promise<void> | null = null

  /**
   * Fetch real pool state from on-chain
   */
  async fetchFromOnChain(): Promise<void> {
    // Debounce: only fetch if last fetch was more than 10 seconds ago
    const now = Date.now()
    if (now - this.state.lastFetchTime < 10000 && this.state.lastFetchTime > 0) {
      return
    }
    
    // Prevent concurrent fetches
    if (this.fetchPromise) {
      return this.fetchPromise
    }
    
    this.fetchPromise = (async () => {
      try {
        const connection = createDevnetConnection()
        const poolData = await fetchLendingPoolDirect(connection)
        
        if (poolData) {
          // Convert from on-chain format (USDC has 6 decimals)
          const totalLiquidity = Number(poolData.totalLiquidity) / 1e6
          const borrowed = Number(poolData.totalBorrowed) / 1e6
          const interestRate = Number(poolData.borrowRate) / 100 // Convert basis points to decimal
          
          this.state = {
            totalLiquidity: totalLiquidity - borrowed, // Available = total - borrowed
            borrowed: borrowed,
            interestRate: interestRate,
            lastFetchTime: now,
          }
          
          console.log('✅ LendingPool: Fetched real data from on-chain:', {
            totalLiquidity: this.state.totalLiquidity,
            borrowed: this.state.borrowed,
            interestRate: this.state.interestRate,
          })
        }
      } catch (error) {
        console.warn('⚠️ LendingPool: Could not fetch on-chain data:', error)
        // Keep existing state, don't fall back to fake data
      } finally {
        this.fetchPromise = null
      }
    })()
    
    return this.fetchPromise
  }

  /**
   * Borrow USDC from the pool
   * @param amount Amount to borrow in USDC
   * @returns Borrow result with amount and rate
   */
  borrow(amount: number): { borrowed: number; rate: number; success: boolean; error?: string } {
    if (amount <= 0) {
      return { borrowed: 0, rate: this.state.interestRate, success: false, error: 'Amount must be greater than 0' }
    }

    if (amount > this.state.totalLiquidity) {
      return {
        borrowed: 0,
        rate: this.state.interestRate,
        success: false,
        error: `Insufficient liquidity. Available: ${this.state.totalLiquidity.toFixed(2)} USDC`,
      }
    }

    this.state.borrowed += amount
    this.state.totalLiquidity -= amount

    return {
      borrowed: amount,
      rate: this.state.interestRate,
      success: true,
    }
  }

  /**
   * Repay borrowed USDC to the pool
   * @param amount Amount to repay in USDC
   */
  repay(amount: number): { success: boolean; error?: string } {
    if (amount <= 0) {
      return { success: false, error: 'Amount must be greater than 0' }
    }

    if (amount > this.state.borrowed) {
      return {
        success: false,
        error: `Cannot repay more than borrowed. Borrowed: ${this.state.borrowed.toFixed(2)} USDC`,
      }
    }

    this.state.borrowed -= amount
    this.state.totalLiquidity += amount

    return { success: true }
  }

  /**
   * Get current pool state (triggers async fetch if stale)
   */
  getState(): LendingPoolState {
    // Trigger async fetch in background (non-blocking)
    this.fetchFromOnChain().catch(console.error)
    return { ...this.state }
  }

  /**
   * Get available liquidity
   */
  getAvailableLiquidity(): number {
    return this.state.totalLiquidity
  }

  /**
   * Calculate borrow interest (annual)
   */
  getBorrowRate(): number {
    return this.state.interestRate
  }

  /**
   * Reset pool state - fetches fresh data from on-chain
   */
  async reset(): Promise<void> {
    this.state = {
      totalLiquidity: 0,
      borrowed: 0,
      interestRate: 0.05,
      lastFetchTime: 0,
    }
    await this.fetchFromOnChain()
  }
  
  /**
   * Force refresh from on-chain
   */
  async refresh(): Promise<void> {
    this.state.lastFetchTime = 0 // Reset debounce
    await this.fetchFromOnChain()
  }
}

// Export singleton instance
export const lendingPool = new LendingPool()

// Export type for TypeScript
export type { LendingPoolState }

