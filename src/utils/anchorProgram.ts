import { Program, AnchorProvider, Idl } from '@coral-xyz/anchor'
import { Connection, PublicKey, Transaction, TransactionInstruction } from '@solana/web3.js'
import { SOLANA_TESTNET_PROGRAM_IDS } from '../config/solana-testnet'
import BN from 'bn.js'
import forgeCruciblesIdl from '../idl/forge-crucibles.json'

/**
 * Wallet adapter interface for Anchor
 */
export interface AnchorWallet {
  publicKey: PublicKey
  signTransaction(tx: Transaction): Promise<Transaction>
  signAllTransactions(txs: Transaction[]): Promise<Transaction[]>
}

// mint_ctoken instruction discriminator (first 8 bytes of sha256("global:mint_ctoken"))
// From IDL: [122, 91, 163, 86, 17, 255, 5, 147]
const MINT_CTOKEN_DISCRIMINATOR = Buffer.from([122, 91, 163, 86, 17, 255, 5, 147])

// mint_ctoken_legacy discriminator - for old format crucible accounts
// From IDL: [205, 5, 44, 34, 106, 17, 54, 75]
const MINT_CTOKEN_LEGACY_DISCRIMINATOR = Buffer.from([205, 5, 44, 34, 106, 17, 54, 75])

// From IDL burn_ctoken discriminator: [39, 133, 56, 80, 220, 86, 252, 148]
const BURN_CTOKEN_DISCRIMINATOR = Buffer.from([39, 133, 56, 80, 220, 86, 252, 148])

// burn_ctoken_legacy discriminator: sha256("global:burn_ctoken_legacy")[0:8]
const BURN_CTOKEN_LEGACY_DISCRIMINATOR = Buffer.from([192, 180, 120, 215, 169, 92, 179, 158])

/**
 * Build mint_ctoken instruction manually (bypasses Anchor IDL parsing)
 */
export function buildMintCtokenInstruction(
  programId: PublicKey,
  accounts: {
    user: PublicKey
    crucible: PublicKey
    baseMint: PublicKey
    ctokenMint: PublicKey
    userTokenAccount: PublicKey
    userCtokenAccount: PublicKey
    vault: PublicKey
    crucibleAuthority: PublicKey
    treasury: PublicKey
    tokenProgram: PublicKey
    associatedTokenProgram: PublicKey
    systemProgram: PublicKey
    rent: PublicKey
  },
  amount: BN
): TransactionInstruction {
  // Serialize amount as u64 (8 bytes, little-endian)
  const amountBuffer = Buffer.alloc(8)
  amount.toArrayLike(Buffer, 'le', 8).copy(amountBuffer)
  
  // Instruction data = discriminator + amount
  const data = Buffer.concat([MINT_CTOKEN_DISCRIMINATOR, amountBuffer])
  
  // Account metas in order
  const keys = [
    { pubkey: accounts.user, isSigner: true, isWritable: true },
    { pubkey: accounts.crucible, isSigner: false, isWritable: true },
    { pubkey: accounts.baseMint, isSigner: false, isWritable: false },
    { pubkey: accounts.ctokenMint, isSigner: false, isWritable: true },
    { pubkey: accounts.userTokenAccount, isSigner: false, isWritable: true },
    { pubkey: accounts.userCtokenAccount, isSigner: false, isWritable: true },
    { pubkey: accounts.vault, isSigner: false, isWritable: true },
    { pubkey: accounts.crucibleAuthority, isSigner: false, isWritable: false },
    { pubkey: accounts.treasury, isSigner: false, isWritable: true },
    { pubkey: accounts.tokenProgram, isSigner: false, isWritable: false },
    { pubkey: accounts.associatedTokenProgram, isSigner: false, isWritable: false },
    { pubkey: accounts.systemProgram, isSigner: false, isWritable: false },
    { pubkey: accounts.rent, isSigner: false, isWritable: false },
  ]
  
  return new TransactionInstruction({
    keys,
    programId,
    data,
  })
}

/**
 * Build mint_ctoken_legacy instruction manually
 * This supports old crucible accounts that don't have lp_token_mint field
 */
export function buildMintCtokenLegacyInstruction(
  programId: PublicKey,
  accounts: {
    user: PublicKey
    crucible: PublicKey
    baseMint: PublicKey
    ctokenMint: PublicKey
    userTokenAccount: PublicKey
    userCtokenAccount: PublicKey
    vault: PublicKey
    crucibleAuthority: PublicKey
    treasury: PublicKey
    tokenProgram: PublicKey
    associatedTokenProgram: PublicKey
    systemProgram: PublicKey
    rent: PublicKey
  },
  amount: BN
): TransactionInstruction {
  // Serialize amount as u64 (8 bytes, little-endian)
  const amountBuffer = Buffer.alloc(8)
  amount.toArrayLike(Buffer, 'le', 8).copy(amountBuffer)
  
  // Instruction data = discriminator + amount
  const data = Buffer.concat([MINT_CTOKEN_LEGACY_DISCRIMINATOR, amountBuffer])
  
  // Account metas in order (matching IDL - same as MintCToken but with UncheckedAccount for crucible)
  const keys = [
    { pubkey: accounts.user, isSigner: true, isWritable: true },
    { pubkey: accounts.crucible, isSigner: false, isWritable: true },
    { pubkey: accounts.baseMint, isSigner: false, isWritable: false },
    { pubkey: accounts.ctokenMint, isSigner: false, isWritable: true },
    { pubkey: accounts.userTokenAccount, isSigner: false, isWritable: true },
    { pubkey: accounts.userCtokenAccount, isSigner: false, isWritable: true },
    { pubkey: accounts.vault, isSigner: false, isWritable: true },
    { pubkey: accounts.crucibleAuthority, isSigner: false, isWritable: false },
    { pubkey: accounts.treasury, isSigner: false, isWritable: true },
    { pubkey: accounts.tokenProgram, isSigner: false, isWritable: false },
    { pubkey: accounts.associatedTokenProgram, isSigner: false, isWritable: false },
    { pubkey: accounts.systemProgram, isSigner: false, isWritable: false },
    { pubkey: accounts.rent, isSigner: false, isWritable: false },
  ]
  
  return new TransactionInstruction({
    keys,
    programId,
    data,
  })
}

/**
 * Build burn_ctoken instruction manually (bypasses Anchor IDL parsing)
 */
export function buildBurnCtokenInstruction(
  programId: PublicKey,
  accounts: {
    user: PublicKey
    crucible: PublicKey
    baseMint: PublicKey
    ctokenMint: PublicKey
    userCtokenAccount: PublicKey
    vault: PublicKey
    userTokenAccount: PublicKey
    crucibleAuthority: PublicKey
    treasury: PublicKey
    tokenProgram: PublicKey
    systemProgram: PublicKey
  },
  ctokenAmount: BN
): TransactionInstruction {
  // Serialize amount as u64 (8 bytes, little-endian)
  const amountBuffer = Buffer.alloc(8)
  ctokenAmount.toArrayLike(Buffer, 'le', 8).copy(amountBuffer)
  
  // Instruction data = discriminator + amount
  const data = Buffer.concat([BURN_CTOKEN_DISCRIMINATOR, amountBuffer])
  
  // Account metas in order (matching IDL)
  const keys = [
    { pubkey: accounts.user, isSigner: true, isWritable: true },
    { pubkey: accounts.crucible, isSigner: false, isWritable: true },
    { pubkey: accounts.baseMint, isSigner: false, isWritable: false },
    { pubkey: accounts.ctokenMint, isSigner: false, isWritable: true },
    { pubkey: accounts.userCtokenAccount, isSigner: false, isWritable: true },
    { pubkey: accounts.vault, isSigner: false, isWritable: true },
    { pubkey: accounts.userTokenAccount, isSigner: false, isWritable: true },
    { pubkey: accounts.crucibleAuthority, isSigner: false, isWritable: false },
    { pubkey: accounts.treasury, isSigner: false, isWritable: true },
    { pubkey: accounts.tokenProgram, isSigner: false, isWritable: false },
    { pubkey: accounts.systemProgram, isSigner: false, isWritable: false },
  ]
  
  return new TransactionInstruction({
    keys,
    programId,
    data,
  })
}

/**
 * Build burn_ctoken_legacy instruction manually
 * This supports old crucible accounts that don't have lp_token_mint field
 */
export function buildBurnCtokenLegacyInstruction(
  programId: PublicKey,
  accounts: {
    user: PublicKey
    crucible: PublicKey
    baseMint: PublicKey
    ctokenMint: PublicKey
    userCtokenAccount: PublicKey
    vault: PublicKey
    userTokenAccount: PublicKey
    crucibleAuthority: PublicKey
    treasury: PublicKey
    tokenProgram: PublicKey
    systemProgram: PublicKey
  },
  ctokenAmount: BN
): TransactionInstruction {
  // Serialize amount as u64 (8 bytes, little-endian)
  const amountBuffer = Buffer.alloc(8)
  ctokenAmount.toArrayLike(Buffer, 'le', 8).copy(amountBuffer)
  
  // Instruction data = discriminator + amount
  const data = Buffer.concat([BURN_CTOKEN_LEGACY_DISCRIMINATOR, amountBuffer])
  
  // Account metas in order (same as BurnCTokenLegacy struct)
  const keys = [
    { pubkey: accounts.user, isSigner: true, isWritable: true },
    { pubkey: accounts.crucible, isSigner: false, isWritable: true },
    { pubkey: accounts.baseMint, isSigner: false, isWritable: false },
    { pubkey: accounts.ctokenMint, isSigner: false, isWritable: true },
    { pubkey: accounts.userCtokenAccount, isSigner: false, isWritable: true },
    { pubkey: accounts.vault, isSigner: false, isWritable: true },
    { pubkey: accounts.userTokenAccount, isSigner: false, isWritable: true },
    { pubkey: accounts.crucibleAuthority, isSigner: false, isWritable: false },
    { pubkey: accounts.treasury, isSigner: false, isWritable: true },
    { pubkey: accounts.tokenProgram, isSigner: false, isWritable: false },
    { pubkey: accounts.systemProgram, isSigner: false, isWritable: false },
  ]
  
  return new TransactionInstruction({
    keys,
    programId,
    data,
  })
}

// Manually define a minimal IDL for mint_ctoken instruction
// This avoids IDL parsing issues with Anchor 0.32
const FORGE_CRUCIBLES_IDL = {
  version: '0.1.0',
  name: 'forge_crucibles',
  instructions: [
    {
      name: 'mintCtoken',
      accounts: [
        { name: 'user', isMut: true, isSigner: true },
        { name: 'crucible', isMut: true, isSigner: false },
        { name: 'baseMint', isMut: false, isSigner: false },
        { name: 'ctokenMint', isMut: true, isSigner: false },
        { name: 'userTokenAccount', isMut: true, isSigner: false },
        { name: 'userCtokenAccount', isMut: true, isSigner: false },
        { name: 'vault', isMut: true, isSigner: false },
        { name: 'crucibleAuthority', isMut: false, isSigner: false },
        { name: 'treasury', isMut: true, isSigner: false },
        { name: 'tokenProgram', isMut: false, isSigner: false },
        { name: 'associatedTokenProgram', isMut: false, isSigner: false },
        { name: 'systemProgram', isMut: false, isSigner: false },
        { name: 'rent', isMut: false, isSigner: false },
      ],
      args: [{ name: 'amount', type: 'u64' }],
    },
    {
      name: 'burnCtoken',
      accounts: [
        { name: 'user', isMut: true, isSigner: true },
        { name: 'crucible', isMut: true, isSigner: false },
        { name: 'baseMint', isMut: false, isSigner: false },
        { name: 'ctokenMint', isMut: true, isSigner: false },
        { name: 'userCtokenAccount', isMut: true, isSigner: false },
        { name: 'vault', isMut: true, isSigner: false },
        { name: 'userTokenAccount', isMut: true, isSigner: false },
        { name: 'crucibleAuthority', isMut: false, isSigner: false },
        { name: 'treasury', isMut: true, isSigner: false },
        { name: 'tokenProgram', isMut: false, isSigner: false },
        { name: 'systemProgram', isMut: false, isSigner: false },
      ],
      args: [{ name: 'ctokensAmount', type: 'u64' }],
    },
  ],
  accounts: [
    {
      name: 'Crucible',
      type: {
        kind: 'struct',
        fields: [
          { name: 'baseMint', type: 'publicKey' },
          { name: 'ctokenMint', type: 'publicKey' },
          { name: 'vault', type: 'publicKey' },
          { name: 'vaultBump', type: 'u8' },
          { name: 'bump', type: 'u8' },
          { name: 'totalBaseDeposited', type: 'u64' },
          { name: 'totalCtokenSupply', type: 'u64' },
          { name: 'exchangeRate', type: 'u64' },
          { name: 'lastUpdateSlot', type: 'u64' },
          { name: 'feeRate', type: 'u64' },
          { name: 'paused', type: 'bool' },
          { name: 'totalLeveragedPositions', type: 'u64' },
          { name: 'totalLpPositions', type: 'u64' },
          { name: 'expectedVaultBalance', type: 'u64' },
          { name: 'oracle', type: { option: 'publicKey' } },
          { name: 'treasury', type: 'publicKey' },
          { name: 'totalFeesAccrued', type: 'u64' },
        ],
      },
    },
  ],
  types: [], // Required by Anchor 0.32 - account types are defined in accounts array
  errors: [],
}

/**
 * Get Anchor program instance for forge-crucibles
 */
export function getCruciblesProgram(
  connection: Connection,
  wallet: AnchorWallet
): Program {
  // Validate inputs
  if (!connection) {
    throw new Error('Connection is required')
  }
  if (!wallet || !wallet.publicKey) {
    throw new Error('Wallet with publicKey is required')
  }
  
  // wallet.publicKey is already typed as PublicKey, so use it directly
  // @ts-ignore - Wallet structure doesn't match NodeWallet type, but works at runtime
  const provider = new AnchorProvider(
    connection,
    wallet as any,
    AnchorProvider.defaultOptions()
  )

  const programId = new PublicKey(SOLANA_TESTNET_PROGRAM_IDS.FORGE_CRUCIBLES)
  
  // Use the actual IDL file but remove accounts array to prevent eager account resolution
  // Anchor will resolve accounts lazily when .account.*.fetch() is called
  // This prevents "Account not found: crucible" errors during program initialization
  const idlData = forgeCruciblesIdl as any
  const idlWithoutAccounts = {
    ...idlData,
    address: programId.toString(),
    // Remove accounts array - Anchor tries to resolve them during init, causing errors
    // Accounts will be resolved lazily when actually needed
    accounts: []
  } as Idl
  
  try {
    return new Program(idlWithoutAccounts, provider) as any
  } catch (error: any) {
    // If still fails, try with manual IDL as fallback (also without accounts)
    console.warn('Failed to create program with IDL, using fallback:', error.message)
    const fallbackIdl = { 
      ...(FORGE_CRUCIBLES_IDL as any), 
      address: programId.toString(),
      accounts: [] // Also remove accounts from fallback
    } as Idl
    return new Program(fallbackIdl, provider) as any
  }
}
