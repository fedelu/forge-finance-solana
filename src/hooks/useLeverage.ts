import { useState, useCallback } from 'react'
import { lendingPool } from '../contracts/lendingPool'

interface LeverageState {
  leverage: number // 1 or 2
  borrowed: number // Amount borrowed in USDC
  healthFactor: number // Health factor (collateral / (borrowed * 1.3))
  effectiveAPY: number // Effective APY after borrow costs
}

interface UseLeverageProps {
  initialCollateral?: number // Initial collateral amount in base token
  baseAPY?: number // Base APY of the crucible
}

export function useLeverage({ initialCollateral = 0, baseAPY = 0 }: UseLeverageProps = {}) {
  const [leverageState, setLeverageState] = useState<LeverageState>({
    leverage: 1,
    borrowed: 0,
    healthFactor: 0,
    effectiveAPY: baseAPY,
  })

  /**
   * Calculate health factor
   * Health Factor = Collateral Value / (Borrowed Value * 1.3)
   * Health factor > 1 = safe, < 1 = liquidation risk
   */
  const calculateHealthFactor = useCallback(
    (collateralValue: number, borrowedValue: number): number => {
      if (borrowedValue === 0) return 999 // No borrow = safe
      const healthFactor = collateralValue / (borrowedValue * 1.3)
      return healthFactor
    },
    []
  )

  /**
   * Calculate effective APY with leverage
   * Leveraged positions have 3x the APY of normal positions
   * Effective APY = (Base APY * 3 * Leverage) - (Borrow Rate * (Leverage - 1))
   * Fixed 10% APY borrowing rate from lending-pool
   */
  const calculateEffectiveAPY = useCallback(
    (baseAPY: number, leverage: number, borrowed: number, collateral: number): number => {
      if (leverage === 1) return baseAPY

      const borrowRate = 10 // 10% APY (fixed rate from lending-pool)
      // Leveraged positions earn 3x the base APY
      const leveragedYield = baseAPY * 3 * leverage
      const borrowCost = borrowRate * (leverage - 1) * (borrowed / (collateral + borrowed))

      return leveragedYield - borrowCost
    },
    []
  )

  /**
   * Apply leverage by borrowing from lending pool
   * @param selectedLeverage 1 or 2
   * @param collateralAmount Current collateral amount in base token
   */
  const applyLeverage = useCallback(
    (selectedLeverage: number, collateralAmount: number) => {
      if (selectedLeverage === 2) {
        // Calculate borrow amount (equal to collateral for 2x)
        const borrowAmount = collateralAmount // In base token units, convert to USDC value
        const baseTokenPrice = 0.5 // SOL price, adjust as needed
        const borrowAmountUSDC = borrowAmount * baseTokenPrice

        // Check if pool has enough liquidity
        const availableLiquidity = lendingPool.getAvailableLiquidity()
        if (borrowAmountUSDC > availableLiquidity) {
          throw new Error(`Insufficient liquidity. Available: ${availableLiquidity.toFixed(2)} USDC`)
        }

        // Borrow from pool
        const result = lendingPool.borrow(borrowAmountUSDC)
        if (!result.success) {
          throw new Error(result.error || 'Borrow failed')
        }

        // Calculate health factor
        const collateralValue = collateralAmount * baseTokenPrice
        const healthFactor = calculateHealthFactor(collateralValue, borrowAmountUSDC)

        // Calculate effective APY
        const effectiveAPY = calculateEffectiveAPY(
          baseAPY,
          selectedLeverage,
          borrowAmountUSDC,
          collateralValue
        )

        setLeverageState({
          leverage: selectedLeverage,
          borrowed: borrowAmountUSDC,
          healthFactor,
          effectiveAPY,
        })

        return { success: true, borrowed: borrowAmountUSDC }
      } else {
        // 1x leverage - repay any existing borrows
        if (leverageState.borrowed > 0) {
          const repayResult = lendingPool.repay(leverageState.borrowed)
          if (!repayResult.success) {
            throw new Error(repayResult.error || 'Repay failed')
          }
        }

        setLeverageState({
          leverage: 1,
          borrowed: 0,
          healthFactor: 999,
          effectiveAPY: baseAPY,
        })

        return { success: true, borrowed: 0 }
      }
    },
    [baseAPY, leverageState.borrowed, calculateHealthFactor, calculateEffectiveAPY]
  )

  /**
   * Repay borrowed amount
   */
  const repayBorrow = useCallback(
    (amount?: number) => {
      const repayAmount = amount || leverageState.borrowed

      if (repayAmount <= 0) {
        throw new Error('Repay amount must be greater than 0')
      }

      const result = lendingPool.repay(repayAmount)
      if (!result.success) {
        throw new Error(result.error || 'Repay failed')
      }

      const newBorrowed = leverageState.borrowed - repayAmount
      const collateralValue = (initialCollateral || 0) * 0.5 // Assume SOL price
      const healthFactor = calculateHealthFactor(collateralValue, newBorrowed)

      setLeverageState((prev) => ({
        ...prev,
        borrowed: Math.max(0, newBorrowed),
        healthFactor,
        effectiveAPY: newBorrowed > 0 ? prev.effectiveAPY : baseAPY,
        leverage: newBorrowed > 0 ? prev.leverage : 1,
      }))

      return { success: true }
    },
    [leverageState.borrowed, initialCollateral, baseAPY, calculateHealthFactor]
  )

  /**
   * Update health factor based on current collateral
   */
  const updateHealthFactor = useCallback(
    (collateralAmount: number) => {
      if (leverageState.borrowed === 0) {
        setLeverageState((prev) => ({ ...prev, healthFactor: 999 }))
        return
      }

      const baseTokenPrice = 0.5 // SOL price
      const collateralValue = collateralAmount * baseTokenPrice
      const healthFactor = calculateHealthFactor(collateralValue, leverageState.borrowed)

      setLeverageState((prev) => ({ ...prev, healthFactor }))
    },
    [leverageState.borrowed, calculateHealthFactor]
  )

  return {
    leverage: leverageState.leverage,
    borrowed: leverageState.borrowed,
    healthFactor: leverageState.healthFactor,
    effectiveAPY: leverageState.effectiveAPY,
    applyLeverage,
    repayBorrow,
    updateHealthFactor,
  }
}

