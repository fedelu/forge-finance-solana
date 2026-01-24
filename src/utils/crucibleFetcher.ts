/**
 * Direct on-chain crucible data fetcher
 * Bypasses Anchor IDL issues by using raw getAccountInfo + manual Borsh deserialization
 */

import { Connection, PublicKey } from '@solana/web3.js'
import { DEPLOYED_ACCOUNTS, SOLANA_TESTNET_CONFIG } from '../config/solana-testnet'

/**
 * Crucible account data structure (matches Rust struct)
 */
export interface CrucibleAccountData {
  baseMint: PublicKey
  ctokenMint: PublicKey
  lpTokenMint: PublicKey
  vault: PublicKey
  vaultBump: number
  bump: number
  totalBaseDeposited: bigint
  totalCtokenSupply: bigint
  totalLpTokenSupply: bigint
  exchangeRate: bigint
  lastUpdateSlot: bigint
  feeRate: bigint
  paused: boolean
  totalLeveragedPositions: bigint
  totalLpPositions: bigint
  expectedVaultBalance: bigint
  oracle: PublicKey | null
  treasury: PublicKey
  totalFeesAccrued: bigint
}

/**
 * Lending pool account data structure
 */
export interface LendingPoolData {
  usdcMint: PublicKey
  totalLiquidity: bigint
  totalBorrowed: bigint
  borrowRate: bigint
  lenderRate: bigint
  bump: number
}

/**
 * Read a PublicKey (32 bytes) from buffer at offset
 */
function readPubkey(buffer: Buffer, offset: number): PublicKey {
  return new PublicKey(buffer.slice(offset, offset + 32))
}

/**
 * Read a u64 (8 bytes, little-endian) from buffer at offset
 */
function readU64(buffer: Buffer, offset: number): bigint {
  return buffer.readBigUInt64LE(offset)
}

/**
 * Read a u8 (1 byte) from buffer at offset
 */
function readU8(buffer: Buffer, offset: number): number {
  return buffer.readUInt8(offset)
}

/**
 * Read a bool (1 byte) from buffer at offset
 */
function readBool(buffer: Buffer, offset: number): boolean {
  return buffer.readUInt8(offset) !== 0
}

/**
 * Deserialize Crucible account data from raw bytes
 * Layout: 8 byte discriminator + struct fields
 * Supports both old format (without LP token fields) and new format (with LP token fields)
 */
export function deserializeCrucible(data: Buffer): CrucibleAccountData {
  // Skip 8 byte Anchor discriminator
  let offset = 8
  
  const baseMint = readPubkey(data, offset)
  offset += 32
  
  const ctokenMint = readPubkey(data, offset)
  offset += 32
  
  // Detect format based on account size
  // Old format (without LP token fields): 236 bytes total
  // New format (with LP token fields): 276 bytes total (236 + 32 + 8)
  // Account size = 8 (discriminator) + struct fields
  const accountSize = data.length
  const hasLpTokenFields = accountSize >= 276 // New format has at least 276 bytes
  
  let lpTokenMint: PublicKey
  let totalLpTokenSupply: bigint = BigInt(0)
  let vault: PublicKey
  let vaultBump: number
  let bump: number
  let totalBaseDeposited: bigint
  let totalCtokenSupply: bigint
  let exchangeRate: bigint
  
  if (hasLpTokenFields) {
    // New format: has lpTokenMint and totalLpTokenSupply
    lpTokenMint = readPubkey(data, offset)
    offset += 32
  } else {
    // Old format: no lpTokenMint, use ctokenMint as placeholder
    // This will need to be updated when crucible is re-initialized with LP token mint
    lpTokenMint = ctokenMint // Placeholder
    totalLpTokenSupply = BigInt(0)
  }
  
  // Continue reading common fields
  vault = readPubkey(data, offset)
  offset += 32
  
  vaultBump = readU8(data, offset)
  offset += 1
  
  bump = readU8(data, offset)
  offset += 1
  
  totalBaseDeposited = readU64(data, offset)
  offset += 8
  
  totalCtokenSupply = readU64(data, offset)
  offset += 8
  
  if (hasLpTokenFields) {
    // New format: read totalLpTokenSupply
    totalLpTokenSupply = readU64(data, offset)
    offset += 8
  }
  // Old format: totalLpTokenSupply already set to 0 above
  
  exchangeRate = readU64(data, offset)
  offset += 8
  
  const lastUpdateSlot = readU64(data, offset)
  offset += 8
  
  const feeRate = readU64(data, offset)
  offset += 8
  
  const paused = readBool(data, offset)
  offset += 1
  
  const totalLeveragedPositions = readU64(data, offset)
  offset += 8
  
  const totalLpPositions = readU64(data, offset)
  offset += 8
  
  const expectedVaultBalance = readU64(data, offset)
  offset += 8
  
  // Option<Pubkey> - 1 byte discriminator + 32 bytes if Some
  const oracleDiscriminator = readU8(data, offset)
  offset += 1
  
  let oracle: PublicKey | null = null
  if (oracleDiscriminator === 1) {
    oracle = readPubkey(data, offset)
  }
  offset += 32 // Always skip 32 bytes for the Option content
  
  const treasury = readPubkey(data, offset)
  offset += 32
  
  const totalFeesAccrued = readU64(data, offset)
  
  return {
    baseMint,
    ctokenMint,
    lpTokenMint,
    vault,
    vaultBump,
    bump,
    totalBaseDeposited,
    totalCtokenSupply,
    totalLpTokenSupply,
    exchangeRate,
    lastUpdateSlot,
    feeRate,
    paused,
    totalLeveragedPositions,
    totalLpPositions,
    expectedVaultBalance,
    oracle,
    treasury,
    totalFeesAccrued,
  }
}

/**
 * Deserialize LendingPool account data from raw bytes
 * Layout: 8 byte discriminator + struct fields
 */
export function deserializeLendingPool(data: Buffer): LendingPoolData {
  // Skip 8 byte Anchor discriminator
  let offset = 8
  
  const usdcMint = readPubkey(data, offset)
  offset += 32
  
  const totalLiquidity = readU64(data, offset)
  offset += 8
  
  const totalBorrowed = readU64(data, offset)
  offset += 8
  
  const borrowRate = readU64(data, offset)
  offset += 8
  
  const lenderRate = readU64(data, offset)
  offset += 8
  
  const bump = readU8(data, offset)
  
  return {
    usdcMint,
    totalLiquidity,
    totalBorrowed,
    borrowRate,
    lenderRate,
    bump,
  }
}

/**
 * Fetch crucible data directly from on-chain using getAccountInfo
 * This bypasses Anchor IDL issues entirely
 */
export async function fetchCrucibleDirect(
  connection: Connection,
  crucibleAddress?: string
): Promise<CrucibleAccountData | null> {
  try {
    const address = crucibleAddress || DEPLOYED_ACCOUNTS.SOL_CRUCIBLE
    const pubkey = new PublicKey(address)
    
    const accountInfo = await connection.getAccountInfo(pubkey)
    
    if (!accountInfo) {
      return null
    }
    
    if (!accountInfo.data || accountInfo.data.length === 0) {
      return null
    }
    
    const crucibleData = deserializeCrucible(accountInfo.data as Buffer)
    
    return crucibleData
  } catch (error: any) {
    // Check if it's an account not found error - this is normal if crucible doesn't exist
    const errorMessage = error?.message || error?.toString() || ''
    if (errorMessage.includes('could not find') || 
        errorMessage.includes('Account does not exist') ||
        errorMessage.includes('Account not found') ||
        errorMessage.includes('invalid account') ||
        errorMessage.includes('crucible')) {
      // Silently return null - this is normal if crucible doesn't exist yet
      return null
    }
    console.error('❌ Error fetching crucible directly:', error)
    return null
  }
}

/**
 * Fetch lending pool data directly from on-chain
 */
export async function fetchLendingPoolDirect(
  connection: Connection,
  poolAddress?: string
): Promise<LendingPoolData | null> {
  try {
    const address = poolAddress || DEPLOYED_ACCOUNTS.LENDING_POOL_PDA
    const pubkey = new PublicKey(address)
    
    const accountInfo = await connection.getAccountInfo(pubkey)
    
    if (!accountInfo) {
      return null
    }
    
    if (!accountInfo.data || accountInfo.data.length === 0) {
      return null
    }
    
    const poolData = deserializeLendingPool(accountInfo.data as Buffer)
    
    return poolData
  } catch (error) {
    console.error('❌ Error fetching lending pool directly:', error)
    return null
  }
}

/**
 * Calculate TVL in USD from crucible data
 * @param crucibleData - The crucible account data
 * @param solPriceUSD - Current SOL price in USD (default $200 as fallback, but callers should pass real-time price from PriceContext)
 */
export function calculateTVL(
  crucibleData: CrucibleAccountData,
  solPriceUSD: number = 200
): number {
  // total_base_deposited is in lamports (1 SOL = 1e9 lamports)
  const solAmount = Number(crucibleData.totalBaseDeposited) / 1e9
  return solAmount * solPriceUSD
}

/**
 * Calculate exchange rate as decimal from stored value
 * Note: This uses the stored exchange rate, not the real-time calculated rate
 * @param crucibleData - The crucible account data
 */
export function getExchangeRateDecimal(crucibleData: CrucibleAccountData): number {
  // exchange_rate is scaled by 1_000_000
  return Number(crucibleData.exchangeRate) / 1_000_000
}

/**
 * Calculate real exchange rate from vault balance and cToken supply
 * This is the actual exchange rate that determines yield
 * Exchange Rate = vault_balance / ctoken_supply
 * @param vaultBalance - Vault token balance in lamports
 * @param ctokenSupply - Total cToken supply in lamports
 * @returns Exchange rate as decimal (e.g., 1.004 means 0.4% yield)
 */
export function calculateRealExchangeRate(vaultBalance: bigint, ctokenSupply: bigint): number {
  if (ctokenSupply === BigInt(0)) {
    return 1.0 // Initial rate is 1:1
  }
  // Calculate: (vault_balance * 1_000_000) / ctoken_supply, then divide by 1_000_000
  const scaledRate = (vaultBalance * BigInt(1_000_000)) / ctokenSupply
  return Number(scaledRate) / 1_000_000
}

/**
 * Calculate yield percentage from exchange rate
 * @param exchangeRate - Current exchange rate as decimal
 * @param initialRate - Initial exchange rate (default 1.0)
 * @returns Yield as percentage (e.g., 0.4 means 0.4%)
 */
export function calculateYieldPercentage(exchangeRate: number, initialRate: number = 1.0): number {
  return ((exchangeRate - initialRate) / initialRate) * 100
}

/**
 * Create a connection to Solana devnet
 */
export function createDevnetConnection(): Connection {
  return new Connection(SOLANA_TESTNET_CONFIG.RPC_URL, SOLANA_TESTNET_CONFIG.COMMITMENT)
}

/**
 * Fetch vault token balance
 * @param connection - Solana connection
 * @param vaultAddress - Vault token account address
 * @returns Vault balance in lamports
 */
export async function fetchVaultBalance(
  connection: Connection,
  vaultAddress: string
): Promise<bigint> {
  try {
    const vaultPubkey = new PublicKey(vaultAddress)
    const accountInfo = await connection.getAccountInfo(vaultPubkey)
    
    if (!accountInfo || !accountInfo.data) {
      return BigInt(0)
    }
    
    // Token account data layout: first 64 bytes are mint + owner, 
    // then 8 bytes for amount (little-endian u64) starting at offset 64
    const data = accountInfo.data as Buffer
    const amount = data.readBigUInt64LE(64)
    
    return amount
  } catch (error) {
    console.error('❌ Error fetching vault balance:', error)
    return BigInt(0)
  }
}

/**
 * Fetch cToken mint supply
 * @param connection - Solana connection
 * @param ctokenMint - cToken mint address
 * @returns Total supply in lamports
 */
export async function fetchCTokenSupply(
  connection: Connection,
  ctokenMint: string
): Promise<bigint> {
  try {
    const mintPubkey = new PublicKey(ctokenMint)
    const supplyInfo = await connection.getTokenSupply(mintPubkey)
    const supply = BigInt(supplyInfo.value.amount)
    
    return supply
  } catch (error) {
    console.error('❌ Error fetching cToken supply:', error)
    return BigInt(0)
  }
}
