// Real on-chain lending market integration
// Fetches data from lending-pool smart contract

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Connection, PublicKey, SystemProgram } from '@solana/web3.js'
import * as anchor from '@coral-xyz/anchor'
import { useWallet } from '../contexts/WalletContext'
import { 
  getLendingPoolProgram, 
  getMarketState, 
  getBorrowerAccount,
  calculateUtilization,
  calculateSupplyAPY,
  getLendingPoolPDA,
  getBorrowerAccountPDA,
  getPoolVaultPDA,
  type AnchorWallet
} from '../utils/lendingProgram'
import { LENDING_YIELD_FEE_RATE } from '../config/fees'
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddress } from '@solana/spl-token'
import { SOLANA_TESTNET_CONFIG, SOLANA_TESTNET_PROGRAM_IDS } from '../config/solana-testnet'

export interface MarketInfo {
  marketPubkey: string
  baseMint: string
  tvl: string
  utilizationBps: number
  supplyApyBps: number
  borrowApyBps: number
  paused?: boolean
}

export interface LendingPosition {
  marketPubkey: string
  baseMint: string
  suppliedAmount: number
  interestEarned: number
  effectiveApy: number // After Forge 10% yield fee
  borrowedAmount?: number
  borrowedInterest?: number
}

export function useLending() {
  const { connection, publicKey, connected } = useWallet()
  const [markets, setMarkets] = useState<MarketInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [positions, setPositions] = useState<LendingPosition[]>([])

  // Fetch market data from on-chain
  const fetchMarketData = useCallback(async () => {
    setLoading(true)
    setError(null)

    // Default/fallback market data (shown when wallet not connected or on-chain fetch fails)
    const defaultMarket: MarketInfo = {
      marketPubkey: getLendingPoolPDA()[0].toString(),
      baseMint: 'USDC',
      tvl: '0',
      utilizationBps: 0,
      supplyApyBps: 450, // 4.5% (5% * 0.9 after 10% fee)
      borrowApyBps: 1000, // 10% APY
      paused: false,
    }

    // If wallet not connected, show default market
    if (!connection || !connected || !publicKey) {
      setMarkets([defaultMarket])
      setLoading(false)
      return
    }

    try {
      // Create wallet adapter for Anchor
      const anchorWallet: AnchorWallet = {
        publicKey: publicKey,
        signTransaction: async (tx: any) => tx,
        signAllTransactions: async (txs: any[]) => txs,
      }

      const program = getLendingPoolProgram(connection, anchorWallet)
      const marketState = await getMarketState(program)

      if (!marketState) {
        // Market not initialized on-chain yet, show default
        setMarkets([defaultMarket])
        setLoading(false)
        return
      }

      // Calculate utilization
      const utilization = calculateUtilization(
        marketState.totalBorrowed,
        marketState.totalLiquidity
      )

      // Calculate supply APY (after protocol fee)
      const supplyAPY = calculateSupplyAPY(marketState.lenderRate, LENDING_YIELD_FEE_RATE)

      // Create market info from on-chain data
      const marketInfo: MarketInfo = {
        marketPubkey: getLendingPoolPDA()[0].toString(),
        baseMint: marketState.usdcMint.toString(),
        tvl: marketState.totalLiquidity.toLocaleString(),
        utilizationBps: Math.round(utilization * 100), // Convert to basis points
        supplyApyBps: Math.round(supplyAPY * 100), // Convert to basis points
        borrowApyBps: marketState.borrowRate, // Already in basis points (10 = 10%)
        paused: false,
      }

      setMarkets([marketInfo])
    } catch (err: any) {
      console.error('Error fetching market data:', err)
      setError(err.message || 'Failed to fetch market data')
      // Fallback to default market on error (so it still shows)
      setMarkets([defaultMarket])
    } finally {
      setLoading(false)
    }
  }, [connection, connected, publicKey])

  // Fetch user positions
  const fetchPositions = useCallback(async () => {
    if (!connection || !publicKey || !connected) {
      setPositions([])
      return
    }

    try {
      const anchorWallet: AnchorWallet = {
        publicKey: publicKey,
        signTransaction: async (tx: any) => tx,
        signAllTransactions: async (txs: any[]) => txs,
      }

      const program = getLendingPoolProgram(connection, anchorWallet)
      
      // Fetch borrower account if user has borrowed
      const borrowerAccount = await getBorrowerAccount(program, publicKey)

      // For now, we only track borrowed positions
      // Supply positions would need receipt token tracking (future enhancement)
      if (borrowerAccount && borrowerAccount.amountBorrowed > 0) {
        const [poolPDA] = getLendingPoolPDA()
      const position: LendingPosition = {
        marketPubkey: poolPDA.toString(),
        baseMint: SOLANA_TESTNET_CONFIG.TOKEN_ADDRESSES.USDC,
          suppliedAmount: 0, // Not tracked yet
          interestEarned: 0, // Would need to calculate from time
          effectiveApy: 0,
          borrowedAmount: borrowerAccount.amountBorrowed,
        }
        setPositions([position])
      } else {
        setPositions([])
      }
    } catch (err: any) {
      console.error('Error fetching positions:', err)
      // Don't set error for positions, just log
    }
  }, [connection, publicKey, connected])

  // Initial fetch and periodic updates
  useEffect(() => {
    fetchMarketData()
    fetchPositions()

    // Refresh every 30 seconds
    const interval = setInterval(() => {
      fetchMarketData()
      fetchPositions()
    }, 30000)

    return () => clearInterval(interval)
  }, [fetchMarketData, fetchPositions])

  // Supply USDC to lending pool
  const supply = useCallback(async (market: string, amount: string) => {
    if (!connection || !publicKey || !connected) {
      throw new Error('Wallet not connected')
    }

    const anchorWallet: AnchorWallet = {
      publicKey: publicKey,
      signTransaction: async (tx: any) => {
        // This would be handled by wallet adapter in real implementation
        return tx
      },
      signAllTransactions: async (txs: any[]) => txs,
    }

    const program = getLendingPoolProgram(connection, anchorWallet)
    const [poolPDA] = getLendingPoolPDA()
    const [poolVaultPDA] = getPoolVaultPDA(poolPDA)

    // Get user USDC token account
    const usdcMint = new PublicKey(SOLANA_TESTNET_CONFIG.TOKEN_ADDRESSES.USDC)
    const userUsdcAccount = await getAssociatedTokenAddress(usdcMint, publicKey)

    const suppliedAmount = parseFloat(amount)

    try {
      const tx = await program.methods
        .depositUsdc(new anchor.BN(Math.floor(suppliedAmount * 1e6))) // Convert to USDC decimals (6)
        .accounts({
          pool: poolPDA,
          user: publicKey,
          userUsdcAccount,
          poolVault: poolVaultPDA,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc()

      // Refresh market data after supply
      await fetchMarketData()
      await fetchPositions()

      return { success: true, tx }
    } catch (err: any) {
      console.error('Supply error:', err)
      throw new Error(err.message || 'Supply failed')
    }
  }, [connection, publicKey, connected, fetchMarketData, fetchPositions])

  // Withdraw from lending pool (placeholder - would need receipt token tracking)
  const withdraw = useCallback(async (_market: string, _amount: string) => {
    // TODO: Implement withdraw using receipt tokens
    // This requires tracking receipt token balances
    throw new Error('Withdraw not yet implemented - requires receipt token tracking')
  }, [])

  // Borrow USDC from lending pool
  const borrow = useCallback(async (amount: number) => {
    if (!connection || !publicKey || !connected) {
      throw new Error('Wallet not connected')
    }

    const anchorWallet: AnchorWallet = {
      publicKey: publicKey,
      signTransaction: async (tx: any) => tx,
      signAllTransactions: async (txs: any[]) => txs,
    }

    const program = getLendingPoolProgram(connection, anchorWallet)
    const [poolPDA, poolBump] = getLendingPoolPDA()
    const [borrowerPDA] = getBorrowerAccountPDA(publicKey)
    const [poolVaultPDA] = getPoolVaultPDA(poolPDA)

    // Get user USDC token account
    const usdcMint = new PublicKey(SOLANA_TESTNET_CONFIG.TOKEN_ADDRESSES.USDC)
    const borrowerUsdcAccount = await getAssociatedTokenAddress(usdcMint, publicKey)

    try {
      const tx = await program.methods
        .borrowUsdc(new anchor.BN(Math.floor(amount * 1e6))) // Convert to USDC decimals
        .accounts({
          pool: poolPDA,
          borrower: publicKey,
          borrowerAccount: borrowerPDA,
          poolVault: poolVaultPDA,
          borrowerUsdcAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc()

      await fetchPositions()
      return { success: true, tx }
    } catch (err: any) {
      console.error('Borrow error:', err)
      throw new Error(err.message || 'Borrow failed')
    }
  }, [connection, publicKey, connected, fetchPositions])

  // Repay borrowed USDC
  const repay = useCallback(async (amount: number) => {
    if (!connection || !publicKey || !connected) {
      throw new Error('Wallet not connected')
    }

    const anchorWallet: AnchorWallet = {
      publicKey: publicKey,
      signTransaction: async (tx: any) => tx,
      signAllTransactions: async (txs: any[]) => txs,
    }

    const program = getLendingPoolProgram(connection, anchorWallet)
    const [poolPDA] = getLendingPoolPDA()
    const [borrowerPDA] = getBorrowerAccountPDA(publicKey)
    const [poolVaultPDA] = getPoolVaultPDA(poolPDA)

    // Get user USDC token account
    const usdcMint = new PublicKey(SOLANA_TESTNET_CONFIG.TOKEN_ADDRESSES.USDC)
    const borrowerUsdcAccount = await getAssociatedTokenAddress(usdcMint, publicKey)

    try {
      const tx = await program.methods
        .repayUsdc(new anchor.BN(Math.floor(amount * 1e6))) // Convert to USDC decimals
        .accounts({
          pool: poolPDA,
          borrower: publicKey,
          borrowerAccount: borrowerPDA,
          borrowerUsdcAccount,
          poolVault: poolVaultPDA,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc()

      await fetchPositions()
      return { success: true, tx }
    } catch (err: any) {
      console.error('Repay error:', err)
      throw new Error(err.message || 'Repay failed')
    }
  }, [connection, publicKey, connected, fetchPositions])

  const value = useMemo(() => ({ 
    markets, 
    loading, 
    error, 
    supply, 
    withdraw, 
    borrow,
    repay,
    positions,
    refresh: fetchMarketData,
  }), [markets, loading, error, supply, withdraw, borrow, repay, positions, fetchMarketData])
  
  return value
}
