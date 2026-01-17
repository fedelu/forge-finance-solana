/**
 * Withdraw SOL from the SOL Crucible (burn cSOL)
 * 
 * Usage:
 *   npx ts-node scripts/withdraw-sol-crucible.ts <amount_in_csol>
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

// Load IDL from compiled target folder
const cruciblesIdl = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../target/idl/forge_crucibles.json'), 'utf-8')
)

// Configuration from deployed accounts
const CRUCIBLES_PROGRAM_ID = new PublicKey('B9qek9NaR3xmBro8pdxixaA2SHzDUExB5KaBt9Kb4fry')
const WSOL_MINT = new PublicKey('So11111111111111111111111111111111111111112')

// Deployed account addresses
const SOL_CRUCIBLE = new PublicKey('4LWKLHWciNEdr51oA8NFQgVgcScqk8vBx2LsXLAqA8iV')
const CSOL_MINT = new PublicKey('9SNiVeAAEwo5XSQVnyZ9r16XtsjMPX4JXzWYZdnocJoN')
const SOL_VAULT = new PublicKey('S1b5udUYpr1FBzKQA7vMmxN1vAK9vrB58Sxpd8qnoDU')
const WSOL_TREASURY = new PublicKey('9VbGJDCXshKXfhA6J2TJv53RpQQeVFocXp2gNuxUxioW')

const RPC_URL = 'https://api.devnet.solana.com'

async function main() {
  // Parse amount from command line
  const args = process.argv.slice(2)
  if (args.length === 0) {
    console.error('❌ Usage: npx ts-node scripts/withdraw-sol-crucible.ts <amount_in_csol>')
    console.error('   Example: npx ts-node scripts/withdraw-sol-crucible.ts 0.5')
    process.exit(1)
  }
  
  const amountCSOL = parseFloat(args[0])
  if (isNaN(amountCSOL) || amountCSOL <= 0) {
    console.error('❌ Invalid amount. Please provide a positive number.')
    process.exit(1)
  }
  
  const amountLamports = Math.floor(amountCSOL * LAMPORTS_PER_SOL)
  
  console.log('🚀 Withdrawing SOL from Crucible')
  console.log(`📝 Amount: ${amountCSOL} cSOL (${amountLamports} lamports)`)
  
  // Load wallet
  const homedir = process.env.HOME || '~'
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
  
  // Check wallet SOL balance
  const balance = await connection.getBalance(walletKeypair.publicKey)
  console.log(`💰 Current SOL balance: ${balance / LAMPORTS_PER_SOL} SOL`)
  
  // Setup Anchor
  const wallet = new anchor.Wallet(walletKeypair)
  const provider = new anchor.AnchorProvider(connection, wallet, {
    commitment: 'confirmed',
  })
  anchor.setProvider(provider)
  
  const program = new anchor.Program(cruciblesIdl, provider) as any
  
  // Derive crucible authority PDA
  const [crucibleAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from('crucible'), WSOL_MINT.toBuffer()],
    CRUCIBLES_PROGRAM_ID
  )
  
  // Get user's cSOL ATA
  const userCSOLAccount = await getAssociatedTokenAddress(
    CSOL_MINT,
    walletKeypair.publicKey
  )
  
  // Get user's WSOL ATA
  const userWSOLAccount = await getAssociatedTokenAddress(
    WSOL_MINT,
    walletKeypair.publicKey
  )
  
  // Check cSOL balance
  try {
    const csolAccount = await getAccount(connection, userCSOLAccount)
    console.log(`💎 Current cSOL balance: ${Number(csolAccount.amount) / LAMPORTS_PER_SOL} cSOL`)
    
    if (Number(csolAccount.amount) < amountLamports) {
      console.error(`❌ Insufficient cSOL balance. Have ${Number(csolAccount.amount) / LAMPORTS_PER_SOL}, need ${amountCSOL}`)
      process.exit(1)
    }
  } catch (error) {
    console.error('❌ No cSOL token account found')
    process.exit(1)
  }
  
  // Check crucible state
  try {
    const crucibleAccount = await program.account.crucible.fetch(SOL_CRUCIBLE)
    console.log('📊 Crucible state:')
    console.log('   Exchange Rate:', crucibleAccount.exchangeRate.toString())
    console.log('   Total Deposited:', (Number(crucibleAccount.totalBaseDeposited) / LAMPORTS_PER_SOL).toFixed(4), 'SOL')
  } catch (error: any) {
    console.error('❌ Could not fetch crucible:', error.message)
    process.exit(1)
  }
  
  // Build transaction
  const tx = new Transaction()
  
  // Create WSOL ATA if it doesn't exist
  try {
    await getAccount(connection, userWSOLAccount)
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
  
  // Call burnCtoken
  console.log('📝 Calling burnCtoken...')
  const burnIx = await program.methods
    .burnCtoken(new BN(amountLamports))
    .accounts({
      user: walletKeypair.publicKey,
      crucible: SOL_CRUCIBLE,
      baseMint: WSOL_MINT,
      ctokenMint: CSOL_MINT,
      userCtokenAccount: userCSOLAccount,
      vault: SOL_VAULT,
      userTokenAccount: userWSOLAccount,
      crucibleAuthority: crucibleAuthority,
      treasury: WSOL_TREASURY,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .instruction()
  
  tx.add(burnIx)
  
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
    
    console.log('✅ Withdrawal successful!')
    console.log('🔗 Transaction:', signature)
    console.log('🔗 Explorer:', `https://explorer.solana.com/tx/${signature}?cluster=devnet`)
    
    // Close WSOL account to unwrap to SOL
    console.log('\n📝 Closing WSOL account to unwrap to native SOL...')
    const { exec } = await import('child_process')
    const { promisify } = await import('util')
    const execAsync = promisify(exec)
    await execAsync(`spl-token close --url devnet ${WSOL_MINT.toString()}`)
    
    // Check final balances
    const newSOLBalance = await connection.getBalance(walletKeypair.publicKey)
    console.log(`\n💰 New SOL balance: ${newSOLBalance / LAMPORTS_PER_SOL} SOL`)
    
    try {
      const cSOLAccount = await getAccount(connection, userCSOLAccount)
      console.log(`💎 Remaining cSOL balance: ${Number(cSOLAccount.amount) / LAMPORTS_PER_SOL} cSOL`)
    } catch {
      console.log('💎 cSOL account closed (0 balance)')
    }
    
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
