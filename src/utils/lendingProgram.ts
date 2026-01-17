import { Program, AnchorProvider, Idl, Wallet } from '@coral-xyz/anchor'
import { Connection, PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY } from '@solana/web3.js'
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddress } from '@solana/spl-token'
import lendingPoolIdl from '../idl/lending-pool.json'
import { SOLANA_TESTNET_PROGRAM_IDS } from '../config/solana-testnet'

export type LendingPoolIdl = typeof lendingPoolIdl

/**
 * Wallet adapter interface for Anchor
 */
export interface AnchorWallet {
  publicKey: PublicKey
  signTransaction(tx: any): Promise<any>
  signAllTransactions(txs: any[]): Promise<any[]>
}

/**
 * Lending Pool account state
 */
export interface LendingPoolState {
  usdcMint: PublicKey
  totalLiquidity: number
  totalBorrowed: number
  borrowRate: number // 10 = 10% APY (scaled by 100)
  lenderRate: number // 5 = 5% APY (scaled by 100)
  bump: number
}

/**
 * Borrower account state
 */
export interface BorrowerAccountState {
  borrower: PublicKey
  amountBorrowed: number
}

/**
 * Get Anchor program instance for lending-pool
 */
export function getLendingPoolProgram(
  connection: Connection,
  wallet: AnchorWallet
): Program<LendingPoolIdl> {
  const anchorWallet: Wallet = {
    publicKey: wallet.publicKey,
    signTransaction: wallet.signTransaction,
    signAllTransactions: wallet.signAllTransactions,
  }

  const provider = new AnchorProvider(
    connection,
    anchorWallet,
    AnchorProvider.defaultOptions()
  )

  // Use a valid placeholder program ID if LENDING_POOL is not set
  // Default to System Program (11111111111111111111111111111111) as a safe fallback
  const programIdStr = SOLANA_TESTNET_PROGRAM_IDS.LENDING_POOL || '11111111111111111111111111111111'
  let programId: PublicKey
  try {
    programId = new PublicKey(programIdStr)
  } catch (error) {
    console.warn('Invalid lending pool program ID, using System Program as fallback:', error)
    programId = PublicKey.default
  }
  
  const program = new Program(
    lendingPoolIdl as Idl,
    programId,
    provider
  ) as Program<LendingPoolIdl>
  
  return program
}

/**
 * Get lending pool PDA
 */
export function getLendingPoolPDA(): [PublicKey, number] {
  // Use a valid placeholder program ID if LENDING_POOL is not set
  // This is a valid base58 Solana address format (32 bytes encoded)
  const programId = SOLANA_TESTNET_PROGRAM_IDS.LENDING_POOL || '11111111111111111111111111111111'
  
  try {
    return PublicKey.findProgramAddressSync(
      [Buffer.from('pool')],
      new PublicKey(programId)
    )
  } catch (error) {
    // If program ID is invalid, use System Program as fallback
    // This won't work for actual operations but prevents crashes
    console.warn('Invalid lending pool program ID, using fallback:', error)
    return PublicKey.findProgramAddressSync(
      [Buffer.from('pool')],
      PublicKey.default // System Program as fallback
    )
  }
}

/**
 * Get borrower account PDA
 */
export function getBorrowerAccountPDA(borrower: PublicKey): [PublicKey, number] {
  const programId = SOLANA_TESTNET_PROGRAM_IDS.LENDING_POOL || '11111111111111111111111111111111'
  
  try {
    return PublicKey.findProgramAddressSync(
      [Buffer.from('borrower'), borrower.toBuffer()],
      new PublicKey(programId)
    )
  } catch (error) {
    console.warn('Invalid lending pool program ID for borrower PDA, using fallback:', error)
    return PublicKey.findProgramAddressSync(
      [Buffer.from('borrower'), borrower.toBuffer()],
      PublicKey.default
    )
  }
}

/**
 * Get pool vault PDA
 */
export function getPoolVaultPDA(pool: PublicKey): [PublicKey, number] {
  const programId = SOLANA_TESTNET_PROGRAM_IDS.LENDING_POOL || '11111111111111111111111111111111'
  
  try {
    return PublicKey.findProgramAddressSync(
      [Buffer.from('vault'), pool.toBuffer()],
      new PublicKey(programId)
    )
  } catch (error) {
    console.warn('Invalid lending pool program ID for vault PDA, using fallback:', error)
    return PublicKey.findProgramAddressSync(
      [Buffer.from('vault'), pool.toBuffer()],
      PublicKey.default
    )
  }
}

/**
 * Fetch lending pool state from on-chain
 */
export async function getMarketState(
  program: Program<LendingPoolIdl>
): Promise<LendingPoolState | null> {
  try {
    const [poolPDA] = getLendingPoolPDA()
    const poolAccount = await program.account.lendingPool.fetch(poolPDA)
    
    return {
      usdcMint: poolAccount.usdcMint,
      totalLiquidity: poolAccount.totalLiquidity.toNumber(),
      totalBorrowed: poolAccount.totalBorrowed.toNumber(),
      borrowRate: poolAccount.borrowRate.toNumber(),
      lenderRate: poolAccount.lenderRate.toNumber(),
      bump: poolAccount.bump,
    }
  } catch (error) {
    console.error('Error fetching market state:', error)
    return null
  }
}

/**
 * Fetch borrower account state from on-chain
 */
export async function getBorrowerAccount(
  program: Program<LendingPoolIdl>,
  borrower: PublicKey
): Promise<BorrowerAccountState | null> {
  try {
    const [borrowerPDA] = getBorrowerAccountPDA(borrower)
    const borrowerAccount = await program.account.borrowerAccount.fetch(borrowerPDA)
    
    return {
      borrower: borrowerAccount.borrower,
      amountBorrowed: borrowerAccount.amountBorrowed.toNumber(),
    }
  } catch (error) {
    // Account might not exist if user hasn't borrowed
    return null
  }
}

/**
 * Calculate borrowing interest based on time elapsed
 * Formula: interest = borrowedAmount × (borrowRate / 100) × (secondsElapsed / secondsPerYear)
 */
export function calculateBorrowInterest(
  borrowedAmount: number,
  borrowRate: number, // 10 = 10% APY (scaled by 100)
  secondsElapsed: number
): number {
  const secondsPerYear = 365 * 24 * 60 * 60
  const rateDecimal = borrowRate / 100 // Convert 10 to 0.10
  const interest = borrowedAmount * rateDecimal * (secondsElapsed / secondsPerYear)
  return interest
}

/**
 * Calculate total amount owed (principal + interest)
 */
export function calculateTotalOwed(
  borrowedAmount: number,
  borrowRate: number,
  secondsElapsed: number
): number {
  const interest = calculateBorrowInterest(borrowedAmount, borrowRate, secondsElapsed)
  return borrowedAmount + interest
}

/**
 * Calculate utilization rate
 */
export function calculateUtilization(
  totalBorrowed: number,
  totalLiquidity: number
): number {
  if (totalLiquidity === 0) return 0
  return (totalBorrowed / totalLiquidity) * 100
}

/**
 * Calculate supply APY (after protocol fee)
 */
export function calculateSupplyAPY(
  lenderRate: number, // 5 = 5% APY (scaled by 100)
  protocolFeeRate: number = 0.10 // 10% fee on yield
): number {
  const baseAPY = lenderRate / 100 // Convert 5 to 0.05
  const feeOnYield = baseAPY * protocolFeeRate
  return (baseAPY - feeOnYield) * 100 // Return as percentage
}
