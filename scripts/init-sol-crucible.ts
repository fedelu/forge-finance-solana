/**
 * Initialize SOL Crucible on Solana Devnet
 * 
 * This script initializes the SOL crucible with:
 * - Crucible PDA account
 * - cToken mint
 * - Vault token account
 * - Treasury account (must exist)
 * - Pyth oracle for SOL/USD price
 * 
 * Usage:
 *   ts-node scripts/init-sol-crucible.ts --treasury <TREASURY_TOKEN_ACCOUNT>
 */

import * as anchor from '@coral-xyz/anchor'
import { Connection, Keypair, PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY, Transaction, sendAndConfirmTransaction } from '@solana/web3.js'
import { TOKEN_PROGRAM_ID, createInitializeMintInstruction, createInitializeAccountInstruction, MINT_SIZE, getMinimumBalanceForRentExemptMint, getMinimumBalanceForRentExemptAccount, ACCOUNT_SIZE } from '@solana/spl-token'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { dirname } from 'path'
import BN from 'bn.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Load IDL
const cruciblesIdl = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../target/idl/forge_crucibles.json'), 'utf-8')
)

// Configuration - Updated with deployed program IDs
const CRUCIBLES_PROGRAM_ID = new PublicKey('B9qek9NaR3xmBro8pdxixaA2SHzDUExB5KaBt9Kb4fry')
const WSOL_MINT = new PublicKey('So11111111111111111111111111111111111111112')
const PYTH_SOL_USD_PRICE_FEED = new PublicKey('ALP8SdU9oARYVLgLR7LrGzyc6M3zvTyUxE6QfkYYJJEt')
const NETWORK = 'devnet'
const RPC_URL = 'https://api.devnet.solana.com'

// Fee rate in basis points (200 = 0.2% = 2 bps)
const FEE_RATE = 200

async function main() {
  console.log('🚀 Initializing SOL Crucible on', NETWORK)
  
  // Parse arguments
  const args = process.argv.slice(2)
  let treasuryTokenAccount: PublicKey | null = null
  
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--treasury' && i + 1 < args.length) {
      treasuryTokenAccount = new PublicKey(args[i + 1])
      break
    }
  }
  
  if (!treasuryTokenAccount) {
    console.error('❌ Error: --treasury <TREASURY_TOKEN_ACCOUNT> is required')
    console.log('Example: ts-node scripts/init-sol-crucible.ts --treasury <TOKEN_ACCOUNT_ADDRESS>')
    process.exit(1)
  }
  
  // Load wallet
  const homedir = process.env.HOME || '~'
  const walletPath = process.env.ANCHOR_WALLET || path.join(homedir, '.config/solana/id.json')
  const walletKeypair = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync(walletPath, 'utf-8')))
  )
  
  console.log('📝 Wallet:', walletKeypair.publicKey.toString())
  console.log('📝 Treasury:', treasuryTokenAccount.toString())
  console.log('📝 Oracle:', PYTH_SOL_USD_PRICE_FEED.toString())
  
  // Setup connection and provider
  const connection = new Connection(RPC_URL, 'confirmed')
  const wallet = new anchor.Wallet(walletKeypair)
  const provider = new anchor.AnchorProvider(connection, wallet, {
    commitment: 'confirmed',
  })
  anchor.setProvider(provider)
  
  // Create program instance
  const program = new anchor.Program(cruciblesIdl, provider) as any
  
  // Derive PDAs
  const [cruciblePDA, crucibleBump] = PublicKey.findProgramAddressSync(
    [Buffer.from('crucible'), WSOL_MINT.toBuffer()],
    CRUCIBLES_PROGRAM_ID
  )
  
  const [vaultPDA, vaultBump] = PublicKey.findProgramAddressSync(
    [Buffer.from('vault'), cruciblePDA.toBuffer()],
    CRUCIBLES_PROGRAM_ID
  )
  
  console.log('📋 Crucible PDA:', cruciblePDA.toString())
  console.log('📋 Vault PDA:', vaultPDA.toString())
  
  // Check if crucible already exists
  try {
    const crucibleAccount = await program.account.crucible.fetch(cruciblePDA)
    console.log('✅ Crucible already initialized:', crucibleAccount)
    console.log('   Treasury:', crucibleAccount.treasury.toString())
    console.log('   Oracle:', crucibleAccount.oracle?.toString() || 'None')
    return
  } catch (error: any) {
    console.log('ℹ️  Crucible does not exist, initializing...')
  }
  
  // Create a keypair for the cToken mint
  const ctokenMintKeypair = Keypair.generate()
  
  console.log('🔨 Creating transaction...')
  console.log('   cToken Mint (new):', ctokenMintKeypair.publicKey.toString())
  
  // Create the cToken mint account first (pay for it)
  const mintRent = await getMinimumBalanceForRentExemptMint(connection)
  const createMintAccountIx = SystemProgram.createAccount({
    fromPubkey: walletKeypair.publicKey,
    newAccountPubkey: ctokenMintKeypair.publicKey,
    lamports: mintRent,
    space: MINT_SIZE,
    programId: TOKEN_PROGRAM_ID,
  })
  
  // Create the vault account (PDA, so need to allocate space)
  const vaultRent = await getMinimumBalanceForRentExemptAccount(connection)
  const createVaultAccountIx = SystemProgram.createAccount({
    fromPubkey: walletKeypair.publicKey,
    newAccountPubkey: vaultPDA,
    lamports: vaultRent,
    space: ACCOUNT_SIZE,
    programId: TOKEN_PROGRAM_ID,
  })
  
  // Build the transaction with pre-requisite account creation
  const tx = new Transaction()
  tx.add(createMintAccountIx)
  
  // Note: Vault is a PDA so we can't use createAccount directly
  // The program will handle vault initialization via CPI
  
  // Call initialize_crucible
  const initIx = await program.methods
    .initializeCrucible(new BN(FEE_RATE))
    .accounts({
      authority: walletKeypair.publicKey,
      crucible: cruciblePDA,
      baseMint: WSOL_MINT,
      ctokenMint: ctokenMintKeypair.publicKey,
      vault: vaultPDA,
      treasury: treasuryTokenAccount,
      oracle: PYTH_SOL_USD_PRICE_FEED,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      rent: SYSVAR_RENT_PUBKEY,
    })
    .instruction()
  
  tx.add(initIx)
  
  // Send transaction
  tx.feePayer = walletKeypair.publicKey
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash
  
  console.log('📤 Sending transaction...')
  const signature = await sendAndConfirmTransaction(
    connection, 
    tx, 
    [walletKeypair, ctokenMintKeypair],
    { commitment: 'confirmed' }
  )
  
  console.log('✅ Crucible initialized! Transaction:', signature)
  console.log('🔗 Explorer:', `https://explorer.solana.com/tx/${signature}?cluster=${NETWORK}`)
  
  // Verify crucible was created
  const crucibleAccount = await program.account.crucible.fetch(cruciblePDA) as any
  console.log('✅ Crucible state:', {
    baseMint: crucibleAccount.baseMint.toString(),
    ctokenMint: crucibleAccount.ctokenMint.toString(),
    vault: crucibleAccount.vault.toString(),
    treasury: crucibleAccount.treasury.toString(),
    oracle: crucibleAccount.oracle?.toString() || 'None',
    feeRate: crucibleAccount.feeRate.toString(),
    paused: crucibleAccount.paused,
  })
  
  console.log('\n🎉 SOL Crucible initialization complete!')
  console.log('📝 cToken Mint:', ctokenMintKeypair.publicKey.toString())
  console.log('\n💡 Next steps:')
  console.log('   1. Update frontend config with crucible PDA and cToken mint')
  console.log('   2. Test minting cSOL by depositing SOL')
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('❌ Error:', error)
    process.exit(1)
  })
