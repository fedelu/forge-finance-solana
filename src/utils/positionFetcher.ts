/**
 * Centralized position fetching utility
 * Fetches all user positions from on-chain sources
 */

import { Connection, PublicKey } from '@solana/web3.js'
import { getAssociatedTokenAddress } from '@solana/spl-token'
import { getCruciblesProgram, AnchorWallet } from './anchorProgram'
import { 
  deriveCruciblePDA, 
  deriveLPPositionPDA, 
  deriveLeveragedPositionPDA 
} from './cruciblePdas'
import { 
  getLendingPoolProgram, 
  getBorrowerAccount,
  getBorrowerAccountPDA,
  type AnchorWallet as LendingAnchorWallet
} from './lendingProgram'
import { SOLANA_TESTNET_CONFIG } from '../config/solana-testnet'
import { fetchCrucibleDirect, fetchVaultBalance, fetchCTokenSupply, calculateRealExchangeRate } from './crucibleFetcher'

/**
 * cToken balance for a user
 */
export interface CTokenBalance {
  crucibleAddress: string
  ctokenMint: string
  balance: bigint
  exchangeRate: bigint
  estimatedBaseValue: bigint
}

/**
 * LP Position from on-chain
 */
export interface OnChainLPPosition {
  positionPDA: string
  positionId: string
  owner: string
  crucible: string
  baseMint: string
  baseAmount: number
  usdcAmount: number
  entryPrice: number
  createdAt: number
  isOpen: boolean
}

/**
 * Leveraged Position from on-chain
 */
export interface OnChainLeveragedPosition {
  positionPDA: string
  id: string
  owner: string
  token: string
  collateral: number
  borrowedUsdc: number
  leverageFactor: number
  entryPrice: number
  currentValue: number
  yieldEarned: number
  isOpen: boolean
  createdAt: number
}

/**
 * Borrower position from lending pool
 */
export interface BorrowerPosition {
  borrower: string
  amountBorrowed: number
}

/**
 * All user positions fetched from on-chain
 */
export interface AllUserPositions {
  cTokenBalances: CTokenBalance[]
  lpPositions: OnChainLPPosition[]
  leveragedPositions: OnChainLeveragedPosition[]
  borrowerPositions: BorrowerPosition[]
  fetchedAt: number
}

/**
 * Create an Anchor wallet adapter from publicKey
 */
function createAnchorWallet(publicKey: PublicKey): AnchorWallet {
  return {
    publicKey,
    signTransaction: async (tx: any) => tx,
    signAllTransactions: async (txs: any[]) => txs,
  }
}

/**
 * Fetch user's cToken balance from their ATA (using direct fetcher, no Anchor)
 */
export async function fetchCTokenBalance(
  connection: Connection,
  userPublicKey: PublicKey,
  crucibleAddress: PublicKey
): Promise<CTokenBalance | null> {
  try {
    // Use direct crucible fetcher instead of Anchor (avoids Anchor IDL issues)
    const crucibleAccount = await fetchCrucibleDirect(connection, crucibleAddress.toString())
    
    if (!crucibleAccount) {
      return null
    }
    
    const ctokenMint = crucibleAccount.ctokenMint
    
    // Get user's cToken ATA
    const userCtokenATA = await getAssociatedTokenAddress(ctokenMint, userPublicKey)
    
    // Fetch token balance (may fail if account doesn't exist - that's okay)
    let balance = BigInt(0)
    let exchangeRate = BigInt(1_000_000) // Default 1.0 exchange rate
    
    try {
      const tokenAccountInfo = await connection.getTokenAccountBalance(userCtokenATA)
      balance = BigInt(tokenAccountInfo.value.amount)
      
      if (balance === BigInt(0)) {
        return null // No balance
      }
      
      // Calculate real exchange rate from vault balance / ctoken supply
      const vaultBalance = await fetchVaultBalance(connection, crucibleAccount.vault.toString())
      const ctokenSupply = await fetchCTokenSupply(connection, ctokenMint.toString())
      const realExchangeRate = calculateRealExchangeRate(vaultBalance, ctokenSupply)
      exchangeRate = BigInt(Math.floor(realExchangeRate * 1_000_000))
    } catch (tokenError: any) {
      // Token account doesn't exist - user has no balance
      if (tokenError?.message?.includes('could not find') || 
          tokenError?.message?.includes('Account does not exist') ||
          tokenError?.message?.includes('invalid account')) {
        return null
      }
      console.warn('Error fetching token balance:', tokenError)
      throw tokenError
    }
    
    // Calculate estimated base value
    const estimatedBaseValue = (balance * exchangeRate) / BigInt(1_000_000)
    
    return {
      crucibleAddress: crucibleAddress.toString(),
      ctokenMint: ctokenMint.toString(),
      balance,
      exchangeRate,
      estimatedBaseValue,
    }
  } catch (error: any) {
    // Account might not exist if user hasn't deposited or crucible doesn't exist
    const errorMessage = error?.message || error?.toString() || ''
    if (errorMessage.includes('could not find') || 
        errorMessage.includes('Account does not exist') ||
        errorMessage.includes('Account not found') ||
        errorMessage.includes('invalid account') ||
        errorMessage.includes('crucible')) {
      // Silently return null - this is normal if crucible or account doesn't exist
      return null
    }
    console.warn('Error fetching cToken balance:', error)
    return null
  }
}

/**
 * Fetch user's LP position from on-chain
 */
export async function fetchLPPosition(
  connection: Connection,
  userPublicKey: PublicKey,
  crucibleAddress: PublicKey
): Promise<OnChainLPPosition | null> {
  try {
    const anchorWallet = createAnchorWallet(userPublicKey)
    const program = getCruciblesProgram(connection, anchorWallet)
    
    // TEMPORARY: Use crucibleAddress to match CURRENT on-chain program (uses crucible.key() in seeds)
    // TODO: After redeploying program with base_mint seeds, change to use baseMint
    const [positionPDA] = deriveLPPositionPDA(userPublicKey, crucibleAddress)
    
    // Fetch position account
            const positionAccount = await (program.account as any).lppositionAccount.fetch(positionPDA)
    
    if (!positionAccount.isOpen) {
      return null
    }
    
    return {
      positionPDA: positionPDA.toString(),
      positionId: positionAccount.positionId.toString(),
      owner: positionAccount.owner.toBase58(),
      crucible: positionAccount.crucible.toBase58(),
      baseMint: positionAccount.baseMint.toBase58(),
      baseAmount: Number(positionAccount.baseAmount) / 1e9, // Convert lamports
      usdcAmount: Number(positionAccount.usdcAmount) / 1e6, // Convert USDC decimals
      entryPrice: Number(positionAccount.entryPrice) / 1_000_000, // Convert from scaled
      createdAt: Number(positionAccount.createdAt),
      isOpen: positionAccount.isOpen,
    }
  } catch (error: any) {
    // Position might not exist
    if (error?.message?.includes('Account does not exist') || 
        error?.message?.includes('could not find')) {
      return null
    }
    console.warn('Error fetching LP position:', error)
    return null
  }
}

/**
 * Fetch user's leveraged position from on-chain
 */
export async function fetchLeveragedPosition(
  connection: Connection,
  userPublicKey: PublicKey,
  crucibleAddress: PublicKey
): Promise<OnChainLeveragedPosition | null> {
  try {
    const anchorWallet = createAnchorWallet(userPublicKey)
    const program = getCruciblesProgram(connection, anchorWallet)
    
    // Derive leveraged position PDA
    const [positionPDA] = deriveLeveragedPositionPDA(userPublicKey, crucibleAddress)
    
    // Fetch position account
    const positionAccount = await (program.account as any).leveragedPosition.fetch(positionPDA)
    
    if (!positionAccount.isOpen) {
      return null
    }
    
    return {
      positionPDA: positionPDA.toString(),
      id: positionAccount.id.toBase58(),
      owner: positionAccount.owner.toBase58(),
      token: positionAccount.token.toBase58(),
      collateral: Number(positionAccount.collateral) / 1e9, // Convert lamports
      borrowedUsdc: Number(positionAccount.borrowedUsdc) / 1e6, // Convert USDC decimals
      leverageFactor: Number(positionAccount.leverageFactor) / 100, // 150 -> 1.5, 200 -> 2.0
      entryPrice: Number(positionAccount.entryPrice) / 1_000_000, // Convert from scaled
      currentValue: Number(positionAccount.currentValue) / 1e6,
      yieldEarned: Number(positionAccount.yieldEarned) / 1e9,
      isOpen: positionAccount.isOpen,
      createdAt: Number(positionAccount.createdAt),
    }
  } catch (error: any) {
    // Position might not exist
    if (error?.message?.includes('Account does not exist') || 
        error?.message?.includes('could not find')) {
      return null
    }
    console.warn('Error fetching leveraged position:', error)
    return null
  }
}

/**
 * Fetch user's borrower position from lending pool
 */
export async function fetchBorrowerPosition(
  connection: Connection,
  userPublicKey: PublicKey
): Promise<BorrowerPosition | null> {
  try {
    const anchorWallet: LendingAnchorWallet = createAnchorWallet(userPublicKey)
    const program = getLendingPoolProgram(connection, anchorWallet)
    
    const borrowerAccount = await getBorrowerAccount(program, userPublicKey)
    
    if (!borrowerAccount || borrowerAccount.amountBorrowed === 0) {
      return null
    }
    
    return {
      borrower: borrowerAccount.borrower.toBase58(),
      amountBorrowed: borrowerAccount.amountBorrowed,
    }
  } catch (error: any) {
    // Account might not exist
    if (error?.message?.includes('Account does not exist') || 
        error?.message?.includes('could not find')) {
      return null
    }
    console.warn('Error fetching borrower position:', error)
    return null
  }
}

/**
 * Fetch all user positions from on-chain
 * This is the main entry point for fetching all position data
 */
export async function fetchAllUserPositions(
  connection: Connection,
  userPublicKey: PublicKey,
  crucibleAddress: PublicKey
): Promise<AllUserPositions> {
  const results: AllUserPositions = {
    cTokenBalances: [],
    lpPositions: [],
    leveragedPositions: [],
    borrowerPositions: [],
    fetchedAt: Date.now(),
  }
  
  // Fetch all positions in parallel for better performance
  const [cTokenBalance, lpPosition, leveragedPosition, borrowerPosition] = await Promise.all([
    fetchCTokenBalance(connection, userPublicKey, crucibleAddress),
    fetchLPPosition(connection, userPublicKey, crucibleAddress),
    fetchLeveragedPosition(connection, userPublicKey, crucibleAddress),
    fetchBorrowerPosition(connection, userPublicKey),
  ])
  
  if (cTokenBalance) {
    results.cTokenBalances.push(cTokenBalance)
  }
  
  if (lpPosition) {
    results.lpPositions.push(lpPosition)
  }
  
  if (leveragedPosition) {
    results.leveragedPositions.push(leveragedPosition)
  }
  
  if (borrowerPosition) {
    results.borrowerPositions.push(borrowerPosition)
  }
  
  return results
}

/**
 * Fetch positions for multiple crucibles
 */
export async function fetchAllUserPositionsForCrucibles(
  connection: Connection,
  userPublicKey: PublicKey,
  crucibleAddresses: PublicKey[]
): Promise<AllUserPositions> {
  const results: AllUserPositions = {
    cTokenBalances: [],
    lpPositions: [],
    leveragedPositions: [],
    borrowerPositions: [],
    fetchedAt: Date.now(),
  }
  
  // Fetch positions for each crucible in parallel
  const positionPromises = crucibleAddresses.map(crucibleAddress =>
    fetchAllUserPositions(connection, userPublicKey, crucibleAddress)
  )
  
  const allResults = await Promise.all(positionPromises)
  
  // Merge results
  for (const result of allResults) {
    results.cTokenBalances.push(...result.cTokenBalances)
    results.lpPositions.push(...result.lpPositions)
    results.leveragedPositions.push(...result.leveragedPositions)
  }
  
  // Borrower position is shared across crucibles, just fetch once
  const borrowerPosition = await fetchBorrowerPosition(connection, userPublicKey)
  if (borrowerPosition) {
    results.borrowerPositions.push(borrowerPosition)
  }
  
  return results
}
