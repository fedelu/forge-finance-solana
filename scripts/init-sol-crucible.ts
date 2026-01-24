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
import { TOKEN_PROGRAM_ID, createInitializeMintInstruction, createInitializeAccountInstruction, MINT_SIZE, getMinimumBalanceForRentExemptMint, getMinimumBalanceForRentExemptAccount, ACCOUNT_SIZE, getAssociatedTokenAddressSync } from '@solana/spl-token'
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
const USDC_MINT = new PublicKey('Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr') // Devnet USDC
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
  let forceReinit = false
  
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--treasury' && i + 1 < args.length) {
      treasuryTokenAccount = new PublicKey(args[i + 1])
    } else if (args[i] === '--force') {
      forceReinit = true
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
  
  const [usdcVaultPDA, usdcVaultBump] = PublicKey.findProgramAddressSync(
    [Buffer.from('usdc_vault'), cruciblePDA.toBuffer()],
    CRUCIBLES_PROGRAM_ID
  )
  
  console.log('📋 Crucible PDA:', cruciblePDA.toString())
  console.log('📋 Base Vault PDA:', vaultPDA.toString())
  console.log('📋 USDC Vault PDA:', usdcVaultPDA.toString())
  
  // Check if crucible already exists
  let crucibleExists = false
  let needsUsdcVault = false
  try {
    const crucibleAccountInfo = await connection.getAccountInfo(cruciblePDA)
    if (crucibleAccountInfo && crucibleAccountInfo.data.length > 0) {
      // Crucible account exists, try to fetch it
      try {
        const crucibleAccount = await program.account.crucible.fetch(cruciblePDA)
        console.log('✅ Crucible already initialized:', crucibleAccount)
        console.log('   Treasury:', crucibleAccount.treasury.toString())
        console.log('   Oracle:', crucibleAccount.oracle?.toString() || 'None')
        crucibleExists = true
        
        // Check if USDC vault exists
        const usdcVaultInfo = await connection.getAccountInfo(usdcVaultPDA)
        if (usdcVaultInfo) {
          console.log('✅ USDC vault already exists')
          console.log('✅ Crucible is fully initialized with all required accounts')
          return
        } else {
          console.log('⚠️  Crucible exists but USDC vault is missing')
          console.log('   Creating USDC vault for existing crucible...')
          needsUsdcVault = true
        }
      } catch (fetchError: any) {
        // Account exists but can't be deserialized - might be old format
        // Check account size to determine if it's old format (244 bytes) or new format (276 bytes)
        const accountSize = crucibleAccountInfo.data.length
        const isOldFormat = accountSize < 276 // New format has 276 bytes (8 discriminator + 268 struct)
        
        if (isOldFormat) {
          console.log('⚠️  Crucible account exists but is in OLD FORMAT (244 bytes)')
          console.log('   Old format does not have LP token mint support.')
          console.log('   The crucible needs to be re-initialized with LP token mint.')
          console.log('')
          
          if (!forceReinit) {
            console.log('   ⚠️  WARNING: Re-initializing will create a NEW crucible.')
            console.log('   You must close ALL existing positions first!')
            console.log('')
            console.log('   To proceed with re-initialization:')
            console.log('   1. Close all cToken positions (unwrap all cSOL)')
            console.log('   2. Close all LP positions')
            console.log('   3. Close all leveraged positions')
            console.log('   4. Then run this script again with --force flag')
            console.log('')
            console.log('   Or, if you want to force re-initialization now (will fail if positions exist):')
            console.log('   Run: ts-node scripts/init-sol-crucible.ts --treasury 9VbGJDCXshKXfhA6J2TJv53RpQQeVFocXp2gNuxUxioW --force')
            return
          } else {
            console.log('   🔄 --force flag detected, proceeding with re-initialization...')
            console.log('   ⚠️  This will fail if there are open positions!')
            crucibleExists = false // Force re-initialization
          }
        }
        
        // If it's new format but can't deserialize, there's a different issue
        console.log('⚠️  Crucible account exists but cannot be deserialized')
        console.log('   Account size:', accountSize, 'bytes')
        console.log('   This may indicate a corrupted account or version mismatch.')
        crucibleExists = true
        
        // Check if USDC vault exists
        const usdcVaultInfo = await connection.getAccountInfo(usdcVaultPDA)
        if (usdcVaultInfo) {
          console.log('✅ USDC vault already exists')
          console.log('✅ Crucible exists (may need re-initialization for new features)')
          return
        } else {
          console.log('⚠️  Crucible exists but USDC vault is missing')
          console.log('   Creating USDC vault for existing crucible...')
          needsUsdcVault = true
        }
      }
    } else {
      console.log('ℹ️  Crucible does not exist, initializing...')
      crucibleExists = false
    }
  } catch (error: any) {
    if (error.message?.includes('Account does not exist') || error.message?.includes('could not find account')) {
      console.log('ℹ️  Crucible does not exist, initializing...')
      crucibleExists = false
    } else {
      // Re-throw other errors
      throw error
    }
  }
  
  // If crucible exists but USDC vault doesn't, we need to create it
  if (crucibleExists && needsUsdcVault) {
    console.log('⚠️  Crucible exists but USDC vault is missing')
    console.log('   Creating USDC vault for existing crucible...')
    
    try {
      // Check if the instruction exists in the program (try both camelCase and snake_case)
      if (!program.methods.initializeUsdcVault && !program.methods.initialize_usdc_vault) {
        console.log('❌ The initialize_usdc_vault instruction is not available in the deployed program.')
        console.log('')
        console.log('   You need to:')
        console.log('   1. Fund your wallet (needs ~4 SOL for deployment)')
        console.log('      Current balance:', (await connection.getBalance(walletKeypair.publicKey)) / 1e9, 'SOL')
        console.log('   2. Rebuild: anchor build')
        console.log('   3. Deploy: anchor deploy --program-name forge-crucibles --provider.cluster devnet')
        console.log('   4. Re-run this script: ts-node scripts/init-sol-crucible.ts --treasury 9VbGJDCXshKXfhA6J2TJv53RpQQeVFocXp2gNuxUxioW')
        console.log('')
        console.log('   Or use a Solana faucet to get devnet SOL:')
        console.log('   https://faucet.solana.com/')
        return
      }
      
      // Call initialize_usdc_vault instruction (try both naming conventions)
      const initMethod = program.methods.initializeUsdcVault || program.methods.initialize_usdc_vault
      if (!initMethod) {
        throw new Error('initialize_usdc_vault instruction not found in program')
      }
      const initUsdcVaultIx = await initMethod()
        .accounts({
          authority: walletKeypair.publicKey,
          crucible: cruciblePDA,
          baseMint: WSOL_MINT, // Base mint for crucible PDA derivation
          usdcVault: usdcVaultPDA,
          usdcMint: USDC_MINT,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .instruction()
      
      const tx = new Transaction()
      tx.add(initUsdcVaultIx)
      tx.feePayer = walletKeypair.publicKey
      tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash
      
      console.log('📤 Sending transaction to create USDC vault...')
      const signature = await sendAndConfirmTransaction(
        connection,
        tx,
        [walletKeypair],
        { commitment: 'confirmed' }
      )
      
      console.log('✅ USDC vault created! Transaction:', signature)
      console.log('🔗 Explorer:', `https://explorer.solana.com/tx/${signature}?cluster=${NETWORK}`)
      return
    } catch (error: any) {
      if (error.message?.includes('already in use') || error.message?.includes('AccountNotInitialized')) {
        console.log('⚠️  USDC vault may already exist or instruction not available')
        console.log('   Error:', error.message)
        console.log('')
        console.log('   If the instruction is not available, you need to:')
        console.log('   1. Fund your wallet (needs ~4 SOL for deployment)')
        console.log('   2. Rebuild and redeploy: anchor build && anchor deploy --program-name forge-crucibles')
        console.log('   3. Re-run this script')
        return
      }
      throw error
    }
  }
  
  // Only proceed with initialization if crucible doesn't exist
  if (crucibleExists) {
    console.log('✅ Crucible already exists. Exiting.')
    return
  }
  
  // Create keypairs for the cToken mint and LP token mint
  const ctokenMintKeypair = Keypair.generate()
  const lpTokenMintKeypair = Keypair.generate()
  
  console.log('🔨 Creating transaction...')
  console.log('   cToken Mint (new):', ctokenMintKeypair.publicKey.toString())
  console.log('   LP Token Mint (new):', lpTokenMintKeypair.publicKey.toString())
  
  // Create the cToken mint account first (pay for it)
  const mintRent = await getMinimumBalanceForRentExemptMint(connection)
  const createCtokenMintIx = SystemProgram.createAccount({
    fromPubkey: walletKeypair.publicKey,
    newAccountPubkey: ctokenMintKeypair.publicKey,
    lamports: mintRent,
    space: MINT_SIZE,
    programId: TOKEN_PROGRAM_ID,
  })
  
  // Create the LP token mint account
  const createLpTokenMintIx = SystemProgram.createAccount({
    fromPubkey: walletKeypair.publicKey,
    newAccountPubkey: lpTokenMintKeypair.publicKey,
    lamports: mintRent,
    space: MINT_SIZE,
    programId: TOKEN_PROGRAM_ID,
  })
  
  // Build the transaction with pre-requisite account creation
  const tx = new Transaction()
  tx.add(createCtokenMintIx)
  tx.add(createLpTokenMintIx)
  
  // Note: Base vault and USDC vault are PDAs, so the program will create them via CPI
  // The program's initialize_crucible instruction will handle creating both vaults
  
  // Call initialize_crucible
  const initIx = await program.methods
    .initializeCrucible(new BN(FEE_RATE))
    .accounts({
      authority: walletKeypair.publicKey,
      crucible: cruciblePDA,
      baseMint: WSOL_MINT,
      ctokenMint: ctokenMintKeypair.publicKey,
      lpTokenMint: lpTokenMintKeypair.publicKey, // NEW: LP token mint
      vault: vaultPDA,
      usdcVault: usdcVaultPDA, // NEW: USDC vault
      usdcMint: USDC_MINT, // NEW: USDC mint
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
    [walletKeypair, ctokenMintKeypair, lpTokenMintKeypair], // Include LP token mint keypair
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
  console.log('📝 LP Token Mint:', lpTokenMintKeypair.publicKey.toString())
  console.log('\n💡 Next steps:')
  console.log('   1. Update frontend config with crucible PDA, cToken mint, and LP token mint')
  console.log('   2. Test minting cSOL by depositing SOL')
  console.log('   3. Test opening LP positions')
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('❌ Error:', error)
    process.exit(1)
  })
