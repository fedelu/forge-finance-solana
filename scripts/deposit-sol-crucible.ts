/**
 * Deposit SOL into the SOL Crucible
 * 
 * This script:
 * 1. Wraps native SOL to WSOL
 * 2. Calls mintCtoken to deposit and receive cSOL
 * 
 * Usage:
 *   npx ts-node scripts/deposit-sol-crucible.ts <amount_in_sol>
 * 
 * Example:
 *   npx ts-node scripts/deposit-sol-crucible.ts 1.5
 */

import * as anchor from '@coral-xyz/anchor'
import { 
  Connection, 
  Keypair, 
  PublicKey, 
  SystemProgram, 
  Transaction, 
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
  SYSVAR_RENT_PUBKEY
} from '@solana/web3.js'
import { 
  TOKEN_PROGRAM_ID, 
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  createSyncNativeInstruction,
  getAccount,
  NATIVE_MINT
} from '@solana/spl-token'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { dirname } from 'path'
import BN from 'bn.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Load IDL from compiled target folder (has proper Anchor format)
const cruciblesIdl = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../target/idl/forge_crucibles.json'), 'utf-8')
)

// Configuration from deployed accounts
const CRUCIBLES_PROGRAM_ID = new PublicKey('B9qek9NaR3xmBro8pdxixaA2SHzDUExB5KaBt9Kb4fry')
const WSOL_MINT = new PublicKey('So11111111111111111111111111111111111111112')

// Deployed account addresses (v2 - with yield fix)
const SOL_CRUCIBLE = new PublicKey('GyMyCCMxtn6SX2fNJZp5rDAvCCf9YTscnVsQcvNXJ28X')
const CSOL_MINT = new PublicKey('52a1tHubVruvC9Uxn4PEAdCyDn4xCYnwjNTBXCxjVHXz')
const SOL_VAULT = new PublicKey('8P7uLdQT4Fkaoic4HLtscrMcKSKioGh7FxLAMmvwD9SW')
const WSOL_TREASURY = new PublicKey('9VbGJDCXshKXfhA6J2TJv53RpQQeVFocXp2gNuxUxioW')

const RPC_URL = 'https://api.devnet.solana.com'

async function main() {
  // Parse amount from command line
  const args = process.argv.slice(2)
  if (args.length === 0) {
    console.error('❌ Usage: npx ts-node scripts/deposit-sol-crucible.ts <amount_in_sol>')
    console.error('   Example: npx ts-node scripts/deposit-sol-crucible.ts 1.5')
    process.exit(1)
  }
  
  const amountSOL = parseFloat(args[0])
  if (isNaN(amountSOL) || amountSOL <= 0) {
    console.error('❌ Invalid amount. Please provide a positive number.')
    process.exit(1)
  }
  
  const amountLamports = Math.floor(amountSOL * LAMPORTS_PER_SOL)
  
  console.log('🚀 Depositing SOL into Crucible')
  console.log(`📝 Amount: ${amountSOL} SOL (${amountLamports} lamports)`)
  
  // Load wallet
  const homedir = process.env.HOME || '~'
  // Try testnet keypair first, then default
  let walletPath = path.join(homedir, '.config/solana/solana-testnet-keypair.json')
  if (!fs.existsSync(walletPath)) {
    walletPath = path.join(homedir, '.config/solana/id.json')
  }
  
  const walletKeypair = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync(walletPath, 'utf-8')))
  )
  
  console.log('📝 Wallet:', walletKeypair.publicKey.toString())
  
  // Setup connection
  const connection = new Connection(RPC_URL, 'confirmed')
  
  // Check wallet balance
  const balance = await connection.getBalance(walletKeypair.publicKey)
  console.log(`💰 Current balance: ${balance / LAMPORTS_PER_SOL} SOL`)
  
  if (balance < amountLamports + 0.01 * LAMPORTS_PER_SOL) {
    console.error('❌ Insufficient balance. Need at least', amountSOL + 0.01, 'SOL')
    process.exit(1)
  }
  
  // Setup Anchor
  const wallet = new anchor.Wallet(walletKeypair)
  const provider = new anchor.AnchorProvider(connection, wallet, {
    commitment: 'confirmed',
  })
  anchor.setProvider(provider)
  
  // Create program instance
  const program = new anchor.Program(cruciblesIdl, provider) as any
  
  // Derive crucible authority PDA
  const [crucibleAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from('crucible'), WSOL_MINT.toBuffer()],
    CRUCIBLES_PROGRAM_ID
  )
  
  // Get user's WSOL ATA
  const userWSOLAccount = await getAssociatedTokenAddress(
    WSOL_MINT,
    walletKeypair.publicKey
  )
  
  // Get user's cSOL ATA
  const userCSOLAccount = await getAssociatedTokenAddress(
    CSOL_MINT,
    walletKeypair.publicKey
  )
  
  console.log('📋 Accounts:')
  console.log('   Crucible:', SOL_CRUCIBLE.toString())
  console.log('   Crucible Authority:', crucibleAuthority.toString())
  console.log('   User WSOL Account:', userWSOLAccount.toString())
  console.log('   User cSOL Account:', userCSOLAccount.toString())
  console.log('   Vault:', SOL_VAULT.toString())
  console.log('   Treasury:', WSOL_TREASURY.toString())
  
  // Check if crucible exists and is not paused
  try {
    const crucibleAccount = await program.account.crucible.fetch(SOL_CRUCIBLE)
    if (crucibleAccount.paused) {
      console.error('❌ Crucible is paused')
      process.exit(1)
    }
    console.log('✅ Crucible is active')
    console.log('   Exchange Rate:', crucibleAccount.exchangeRate.toString())
    console.log('   Total Deposited:', crucibleAccount.totalBaseDeposited.toString())
  } catch (error: any) {
    console.error('❌ Could not fetch crucible account:', error.message)
    process.exit(1)
  }
  
  // Build transaction
  const tx = new Transaction()
  
  // Step 1: Create WSOL ATA if it doesn't exist
  let wsolAccountExists = false
  try {
    await getAccount(connection, userWSOLAccount)
    wsolAccountExists = true
    console.log('✅ WSOL account exists')
  } catch {
    console.log('📝 Creating WSOL account...')
    tx.add(
      createAssociatedTokenAccountInstruction(
        walletKeypair.publicKey,
        userWSOLAccount,
        walletKeypair.publicKey,
        WSOL_MINT
      )
    )
  }
  
  // Step 2: Transfer SOL to WSOL account (wrapping)
  console.log('📝 Wrapping SOL to WSOL...')
  tx.add(
    SystemProgram.transfer({
      fromPubkey: walletKeypair.publicKey,
      toPubkey: userWSOLAccount,
      lamports: amountLamports,
    })
  )
  
  // Step 3: Sync native (updates the WSOL balance)
  tx.add(createSyncNativeInstruction(userWSOLAccount))
  
  // Step 4: Call mintCtoken
  console.log('📝 Calling mintCtoken...')
  const mintIx = await program.methods
    .mintCtoken(new BN(amountLamports))
    .accounts({
      user: walletKeypair.publicKey,
      crucible: SOL_CRUCIBLE,
      baseMint: WSOL_MINT,
      ctokenMint: CSOL_MINT,
      userTokenAccount: userWSOLAccount,
      userCtokenAccount: userCSOLAccount,
      vault: SOL_VAULT,
      crucibleAuthority: crucibleAuthority,
      treasury: WSOL_TREASURY,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      rent: SYSVAR_RENT_PUBKEY,
    })
    .instruction()
  
  tx.add(mintIx)
  
  // Send transaction
  tx.feePayer = walletKeypair.publicKey
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash
  
  console.log('📤 Sending transaction...')
  try {
    const signature = await sendAndConfirmTransaction(
      connection,
      tx,
      [walletKeypair],
      { commitment: 'confirmed' }
    )
    
    console.log('✅ Deposit successful!')
    console.log('🔗 Transaction:', signature)
    console.log('🔗 Explorer:', `https://explorer.solana.com/tx/${signature}?cluster=devnet`)
    
    // Check new balances
    const newSOLBalance = await connection.getBalance(walletKeypair.publicKey)
    console.log(`\n💰 New SOL balance: ${newSOLBalance / LAMPORTS_PER_SOL} SOL`)
    
    try {
      const cSOLAccount = await getAccount(connection, userCSOLAccount)
      console.log(`💎 cSOL balance: ${Number(cSOLAccount.amount) / LAMPORTS_PER_SOL} cSOL`)
    } catch {
      console.log('💎 cSOL balance: Unable to fetch (account may not exist yet)')
    }
    
    // Fetch updated crucible state
    const updatedCrucible = await program.account.crucible.fetch(SOL_CRUCIBLE)
    console.log('\n📊 Updated Crucible State:')
    console.log('   Total Base Deposited:', (Number(updatedCrucible.totalBaseDeposited) / LAMPORTS_PER_SOL).toFixed(4), 'SOL')
    console.log('   Exchange Rate:', updatedCrucible.exchangeRate.toString())
    console.log('   Total Fees Accrued:', (Number(updatedCrucible.totalFeesAccrued) / LAMPORTS_PER_SOL).toFixed(6), 'SOL')
    
  } catch (error: any) {
    console.error('❌ Transaction failed:', error.message)
    if (error.logs) {
      console.error('📋 Logs:')
      error.logs.forEach((log: string) => console.error('   ', log))
    }
    process.exit(1)
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('❌ Error:', error)
    process.exit(1)
  })
