import { useEffect, useState, useCallback } from 'react'
import { useLVFPosition } from './useLVFPosition'
import { useCrucible } from './useCrucible'
import { useBalance } from '../contexts/BalanceContext'

/**
 * Hook to calculate and update LP token balances from leveraged positions
 * LP tokens represent cSOL/USDC positions
 */
export function useLPBalance() {
  const { crucibles } = useCrucible()
  const { updateBalance } = useBalance()

  // Calculate LP balances from leveraged positions
  const calculateLPBalances = useCallback(() => {
    let cSOL_USDC_LP = 0

    // For each crucible with leveraged positions, calculate LP tokens
    crucibles.forEach(crucible => {
      if (crucible.baseToken === 'SOL') {
        // Calculate cSOL/USDC LP from SOL crucible leveraged positions
        // For now, we'll use a mock calculation based on TVL and leverage
        // In production, this would fetch actual LP token balances from on-chain
        const leverageMultiplier = 2.0 // Assume max leverage for calculation
        const baseTokenPrice = 200 // SOL price
        // Use actual exchange rate from crucible (scaled by 1e6), default to 1.0
        const exchangeRate = crucible.exchangeRate ? Number(crucible.exchangeRate) / 1e6 : 1.0
        const baseAmount = (crucible.userPtokenBalance || BigInt(0)) > BigInt(0)
          ? Number(crucible.userPtokenBalance) / 1e9 * exchangeRate
          : 0
        
        if (baseAmount > 0) {
          const usdcAmount = baseAmount * baseTokenPrice * (leverageMultiplier - 1)
          // LP token amount = sqrt(cSOL * USDC) (simplified constant product)
          cSOL_USDC_LP = Math.sqrt(baseAmount * usdcAmount) || 0
        }
      }
    })

    // Update balances
    updateBalance('cSOL/USDC LP', cSOL_USDC_LP)
  }, [crucibles, updateBalance])

  // Recalculate when crucibles or leveraged positions change
  useEffect(() => {
    calculateLPBalances()
    
    // Listen for leveraged position events
    const handleLVFPositionChange = () => {
      calculateLPBalances()
    }
    
    window.addEventListener('lvfPositionOpened', handleLVFPositionChange)
    window.addEventListener('lvfPositionClosed', handleLVFPositionChange)
    
    return () => {
      window.removeEventListener('lvfPositionOpened', handleLVFPositionChange)
      window.removeEventListener('lvfPositionClosed', handleLVFPositionChange)
    }
  }, [calculateLPBalances])

  return { calculateLPBalances }
}

