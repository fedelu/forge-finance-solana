/**
 * Create LP Token Mint for existing crucible
 * This script creates an LP token mint and attempts to link it to an existing crucible
 * 
 * Usage:
 *   ts-node scripts/create-lp-token-mint.ts
 */

import * as anchor from '@coral-xyz/anchor'
import { Connection, Keypair, PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY, Transaction, sendAndConfirmTransaction } from '@solana/web3.js'
import { TOKEN_PROGRAM_ID, createInitializeMintInstruction, MINT_SIZE, getMinimumBalanceForRentExemptMint } from '@solana/spl-token'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { dirname } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Configuration
const CRUCIBLES_PROGRAM_ID = new PublicKey('B9qek9NaR3xmBro8pdxixaA2SHzDUExB5KaBt9Kb4fry')
const WSOL_MINT = new PublicKey('So11111111111111111111111111111111111111112')
const NETWORK = 'devnet'
const RPC_URL = 'https://api.devnet.solana.com'

async function main() {
  console.log('🚀 Creating LP Token Mint for existing SOL Crucible on', NETWORK)
  
  // Load wallet
  const homedir = process.env.HOME || '~'
  const walletPath = process.env.ANCHOR_WALLET || path.join(homedir, '.config/solana/id.json')
  const walletKeypair = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync(walletPath, 'utf-8')))
  )
  
  console.log('📝 Wallet:', walletKeypair.publicKey.toString())
  
  // Setup connection
  const connection = new Connection(RPC_URL, 'confirmed')
  
  // Derive crucible PDA
  const [cruciblePDA] = PublicKey.findProgramAddressSync(
    [Buffer.from('crucible'), WSOL_MINT.toBuffer()],
    CRUCIBLES_PROGRAM_ID
  )
  
  console.log('📋 Crucible PDA:', cruciblePDA.toString())
  
  // Check if crucible exists
  const crucibleInfo = await connection.getAccountInfo(cruciblePDA)
  if (!crucibleInfo) {
    console.error('❌ Crucible does not exist. Please initialize it first.')
    process.exit(1)
  }
  
  console.log('✅ Crucible exists, size:', crucibleInfo.data.length, 'bytes')
  
  if (crucibleInfo.data.length >= 276) {
    console.log('✅ Crucible is already in new format with LP token mint support!')
    return
  }
  
  console.log('⚠️  Crucible is in old format (244 bytes). LP token mint cannot be added to existing crucible.')
  console.log('')
  console.log('   The crucible account structure is immutable on Solana.')
  console.log('   You need to close all positions and re-initialize the crucible.')
  console.log('')
  console.log('   However, we can create the LP token mint account now,')
  console.log('   but it won\'t be linked to the crucible until re-initialization.')
  console.log('')
  console.log('   Creating LP token mint account...')
  
  // Create LP token mint keypair
  const lpTokenMintKeypair = Keypair.generate()
  console.log('📝 LP Token Mint (new):', lpTokenMintKeypair.publicKey.toString())
  
  // Create the LP token mint account
  const mintRent = await getMinimumBalanceForRentExemptMint(connection)
  const createLpTokenMintIx = SystemProgram.createAccount({
    fromPubkey: walletKeypair.publicKey,
    newAccountPubkey: lpTokenMintKeypair.publicKey,
    lamports: mintRent,
    space: MINT_SIZE,
    programId: TOKEN_PROGRAM_ID,
  })
  
  // Initialize the mint (9 decimals, same as base token)
  // The crucible PDA will be the mint authority
  const initMintIx = createInitializeMintInstruction(
    lpTokenMintKeypair.publicKey, // mint
    9, // decimals (same as SOL)
    cruciblePDA, // mint authority (crucible PDA)
    null // freeze authority (crucible PDA)
  )
  
  const tx = new Transaction()
  tx.add(createLpTokenMintIx)
  tx.add(initMintIx)
  tx.feePayer = walletKeypair.publicKey
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash
  
  console.log('📤 Sending transaction to create LP token mint...')
  const signature = await sendAndConfirmTransaction(
    connection,
    tx,
    [walletKeypair, lpTokenMintKeypair],
    { commitment: 'confirmed' }
  )
  
  console.log('✅ LP token mint created! Transaction:', signature)
  console.log('🔗 Explorer:', `https://explorer.solana.com/tx/${signature}?cluster=${NETWORK}`)
  console.log('')
  console.log('⚠️  NOTE: This LP token mint is NOT yet linked to the crucible.')
  console.log('   The crucible account needs to be re-initialized to link it.')
  console.log('   You must close all positions first, then re-run:')
  console.log('   ts-node scripts/init-sol-crucible.ts --treasury 9VbGJDCXshKXfhA6J2TJv53RpQQeVFocXp2gNuxUxioW --force')
  console.log('')
  console.log('📝 LP Token Mint Address:', lpTokenMintKeypair.publicKey.toString())
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('❌ Error:', error)
    process.exit(1)
  })
