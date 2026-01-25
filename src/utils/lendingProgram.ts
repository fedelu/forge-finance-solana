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
  authority: PublicKey
  usdcMint: PublicKey
  totalLiquidity: number
  totalBorrowed: number
  borrowRate: number // 10 = 10% APY (scaled by 100)
  lenderRate: number // 5 = 5% APY (scaled by 100)
  paused: boolean
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
): Program<any> {
  // @ts-ignore - Wallet structure doesn't match NodeWallet type, but works at runtime
  const anchorWallet: any = {
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
  
  // Remove accounts array from IDL to prevent eager account resolution
  // This prevents "Cannot read properties of undefined (reading 'size')" errors
  // when Anchor tries to eagerly resolve account schemas during Program construction
  // We handle deserialization manually in getMarketState and getBorrowerAccount
  const idlForProgram: any = { ...lendingPoolIdl }
  if (idlForProgram.accounts) {
    delete idlForProgram.accounts
  }
  
  // @ts-ignore - IDL metadata structure doesn't match Anchor's IdlMetadata type, but works at runtime  
  // @ts-expect-error - Type instantiation depth issue with Anchor 0.32 IDL types
  const program: any = new Program(idlForProgram as any, programId, provider)
  
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
// Helper function to retry RPC calls with exponential backoff on 429 errors
async function retryRpcCall<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3
): Promise<T> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn()
    } catch (error: any) {
      const isRateLimit = error?.message?.includes('429') || 
                         error?.code === 429 || 
                         error?.status === 429 ||
                         error?.message?.includes('Too Many Requests')
      
      if (isRateLimit && attempt < maxRetries - 1) {
        const delay = 1000 * Math.pow(2, attempt) // Exponential backoff: 1s, 2s, 4s
        await new Promise(resolve => setTimeout(resolve, delay))
        continue
      }
      throw error
    }
  }
  throw new Error('Max retries exceeded')
}

export async function getMarketState(
  program: Program<any>,
  connection?: Connection
): Promise<LendingPoolState | null> {
  try {
    const [poolPDA] = getLendingPoolPDA()
    
    // Get connection - prefer passed connection, fallback to program.provider.connection
    const conn = connection || program.provider?.connection
    if (!conn) {
      console.error('No connection available for getMarketState')
      return null
    }
    
    // Try using program.account if available, otherwise fetch directly
    let poolAccount: any
    if (program.account && (program.account as any).lendingPool) {
      poolAccount = await retryRpcCall(() => (program.account as any).lendingPool.fetch(poolPDA))
    } else {
      // Fallback: fetch account data directly and deserialize manually
      const accountInfo = await retryRpcCall(() => conn.getAccountInfo(poolPDA))
      
      if (!accountInfo) {
        return null
      }
      
      // Manual deserialization of LendingPool account
      // Layout: 8 byte discriminator + struct fields
      // Handle both old (73 bytes) and new (106 bytes) account structures
      const data = accountInfo.data
      let offset = 8 // Skip discriminator
      
      // Check account size to determine structure
      // Old structure: 73 bytes total = 8 discriminator + 65 data
      // New structure: 106 bytes total = 8 discriminator + 98 data
      const isOldStructure = data.length === 73
      
      let authority: PublicKey | null = null
      let paused: boolean = false
      
      if (!isOldStructure) {
        // New structure: authority (32 bytes) comes first
        authority = new PublicKey(data.slice(offset, offset + 32))
        offset += 32
      }
      
      // Read usdcMint (32 bytes)
      const usdcMint = new PublicKey(data.slice(offset, offset + 32))
      offset += 32
      
      // Read totalLiquidity (8 bytes, u64)
      const totalLiquidity = data.readBigUInt64LE(offset)
      offset += 8
      
      // Read totalBorrowed (8 bytes, u64)
      const totalBorrowed = data.readBigUInt64LE(offset)
      offset += 8
      
      // Read borrowRate (8 bytes, u64)
      const borrowRate = data.readBigUInt64LE(offset)
      offset += 8
      
      // Read lenderRate (8 bytes, u64)
      const lenderRate = data.readBigUInt64LE(offset)
      offset += 8
      
      if (!isOldStructure) {
        // New structure: paused (1 byte) before bump
        paused = data.readUInt8(offset) !== 0
        offset += 1
      }
      
      // Read bump (1 byte, u8)
      const bump = data.readUInt8(offset)
      
      poolAccount = {
        authority: authority || PublicKey.default, // Default to System Program if old structure
        usdcMint,
        totalLiquidity: { toNumber: () => Number(totalLiquidity) },
        totalBorrowed: { toNumber: () => Number(totalBorrowed) },
        borrowRate: { toNumber: () => Number(borrowRate) },
        lenderRate: { toNumber: () => Number(lenderRate) },
        paused,
        bump,
      }
    }
    
    return {
      authority: poolAccount.authority || PublicKey.default,
      usdcMint: poolAccount.usdcMint,
      totalLiquidity: typeof poolAccount.totalLiquidity === 'object' && poolAccount.totalLiquidity.toNumber 
        ? poolAccount.totalLiquidity.toNumber() 
        : Number(poolAccount.totalLiquidity || 0),
      totalBorrowed: typeof poolAccount.totalBorrowed === 'object' && poolAccount.totalBorrowed.toNumber 
        ? poolAccount.totalBorrowed.toNumber() 
        : Number(poolAccount.totalBorrowed || 0),
      borrowRate: typeof poolAccount.borrowRate === 'object' && poolAccount.borrowRate.toNumber 
        ? poolAccount.borrowRate.toNumber() 
        : Number(poolAccount.borrowRate || 0),
      lenderRate: typeof poolAccount.lenderRate === 'object' && poolAccount.lenderRate.toNumber 
        ? poolAccount.lenderRate.toNumber() 
        : Number(poolAccount.lenderRate || 0),
      paused: poolAccount.paused || false,
      bump: poolAccount.bump || 0,
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
  program: Program<any>,
  borrower: PublicKey,
  connection?: Connection
): Promise<BorrowerAccountState | null> {
  try {
    const [borrowerPDA] = getBorrowerAccountPDA(borrower)
    
    // Get connection - prefer passed connection, fallback to program.provider.connection
    const conn = connection || program.provider?.connection
    if (!conn) {
      console.error('No connection available for getBorrowerAccount')
      return null
    }
    
    // Check if account exists before trying to fetch (with retry logic for rate limits)
    const accountInfo = await retryRpcCall(() => conn.getAccountInfo(borrowerPDA))
    
    if (!accountInfo) {
      // Account doesn't exist - user hasn't borrowed yet
      return null
    }
    
    // Account exists, now fetch it
    // Try using program.account if available, otherwise fetch directly
    let borrowerAccount: any
    if (program.account && (program.account as any).borrowerAccount) {
      borrowerAccount = await (program.account as any).borrowerAccount.fetch(borrowerPDA)
    } else {
      // Fallback: fetch account data directly and deserialize manually
      const accountInfo = await conn.getAccountInfo(borrowerPDA)
      if (!accountInfo) {
        return null
      }
      
      // Manual deserialization of BorrowerAccount
      const data = accountInfo.data
      let offset = 8 // Skip discriminator
      
      // Read borrower (32 bytes)
      const borrowerPubkey = new PublicKey(data.slice(offset, offset + 32))
      offset += 32
      
      // Read amountBorrowed (8 bytes, u64)
      const amountBorrowed = data.readBigUInt64LE(offset)
      offset += 8
      
      // Read borrowTimestamp (8 bytes, u64)
      const borrowTimestamp = data.readBigUInt64LE(offset)
      
      borrowerAccount = {
        borrower: borrowerPubkey,
        amountBorrowed: { toNumber: () => Number(amountBorrowed) },
        borrowTimestamp: { toNumber: () => Number(borrowTimestamp) },
      }
    }
    
    // Check if account data is valid
    if (!borrowerAccount) {
      return null
    }
    
    // Safely handle amountBorrowed - it might be undefined or not a BN
    let amountBorrowed = 0
    if (borrowerAccount.amountBorrowed) {
      // Check if it has toNumber method (it's a BN)
      if (typeof borrowerAccount.amountBorrowed.toNumber === 'function') {
        amountBorrowed = borrowerAccount.amountBorrowed.toNumber()
      } else if (typeof borrowerAccount.amountBorrowed === 'number') {
        amountBorrowed = borrowerAccount.amountBorrowed
      } else if (typeof borrowerAccount.amountBorrowed === 'bigint') {
        amountBorrowed = Number(borrowerAccount.amountBorrowed)
      }
    }
    
    return {
      borrower: borrowerAccount.borrower,
      amountBorrowed: amountBorrowed,
    }
  } catch (error: any) {
    // Account might not exist if user hasn't borrowed, or there's a deserialization error
    // Check if it's a specific Anchor error about account not found
    if (error?.code === 1100 || error?.message?.includes('Account does not exist') || error?.message?.includes('size')) {
      // Account doesn't exist - this is normal
      return null
    }
    console.warn('Error fetching borrower account:', error)
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
 * Calculate borrow APY based on utilization
 * Uses a simple model: base rate + (utilization * slope)
 */
export function calculateBorrowAPY(
  utilization: number, // 0-100 (percentage)
  baseRate: number = 2, // 2% base rate
  slope: number = 0.15 // 0.15% per 1% utilization
): number {
  // utilization is 0-100, convert to decimal for calculation
  const utilDecimal = utilization / 100
  // Borrow APY = base rate + (utilization * slope)
  const borrowAPY = baseRate + (utilDecimal * slope * 100)
  return Math.max(baseRate, Math.min(borrowAPY, 50)) // Cap between base rate and 50%
}

/**
 * Calculate supply APY based on utilization (after protocol fee)
 * Supply APY = Borrow APY * Utilization * (1 - protocol fee)
 */
export function calculateSupplyAPY(
  utilization: number, // 0-100 (percentage)
  protocolFeeRate: number = 0.10, // 10% fee on yield
  baseRate: number = 2, // 2% base rate
  slope: number = 0.15 // 0.15% per 1% utilization
): number {
  if (utilization === 0) return 0
  
  // Calculate borrow APY first
  const borrowAPY = calculateBorrowAPY(utilization, baseRate, slope)
  
  // Supply APY = Borrow APY * Utilization * (1 - protocol fee)
  const utilDecimal = utilization / 100
  const supplyAPY = borrowAPY * utilDecimal * (1 - protocolFeeRate)
  
  return Math.max(0, supplyAPY)
}

/**
 * Legacy function for backward compatibility
 */
export function calculateSupplyAPYFromLenderRate(
  lenderRate: number, // 5 = 5% APY (scaled by 100)
  protocolFeeRate: number = 0.10 // 10% fee on yield
): number {
  const baseAPY = lenderRate / 100 // Convert 5 to 0.05
  const feeOnYield = baseAPY * protocolFeeRate
  return (baseAPY - feeOnYield) * 100 // Return as percentage
}
