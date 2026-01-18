/**
 * Add Metaplex Token Metadata to cSOL token mint
 * 
 * This script uses the crucible program's create_ctoken_metadata instruction
 * to create metadata via CPI, allowing the crucible PDA (mint authority) to sign.
 * 
 * Usage:
 *   ts-node scripts/add-csol-metadata.ts
 */

import * as anchor from '@coral-xyz/anchor'
import { Connection, Keypair, PublicKey, SYSVAR_RENT_PUBKEY, SystemProgram } from '@solana/web3.js'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { dirname } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Configuration
const CSOL_MINT = new PublicKey('52a1tHubVruvC9Uxn4PEAdCyDn4xCYnwjNTBXCxjVHXz')
const NETWORK = 'devnet'
const RPC_URL = 'https://api.devnet.solana.com'
const TOKEN_METADATA_PROGRAM_ID = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s')
const FORGE_CRUCIBLES_PROGRAM_ID = new PublicKey('B9qek9NaR3xmBro8pdxixaA2SHzDUExB5KaBt9Kb4fry')
const WSOL_MINT = new PublicKey('So11111111111111111111111111111111111111112')

// Token metadata
const TOKEN_NAME = 'Crucible SOL'
const TOKEN_SYMBOL = 'cSOL'
const TOKEN_URI = '' // Optional: URL to JSON metadata file with image, description, etc.

/**
 * Derive Metaplex metadata PDA
 * Seeds: ["metadata", TOKEN_METADATA_PROGRAM_ID, mint]
 */
function deriveMetadataPDA(mint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from('metadata'),
      TOKEN_METADATA_PROGRAM_ID.toBuffer(),
      mint.toBuffer(),
    ],
    TOKEN_METADATA_PROGRAM_ID
  )
}

/**
 * Derive crucible PDA address
 * Seeds: ["crucible", base_mint]
 */
function deriveCruciblePDA(baseMint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('crucible'), baseMint.toBuffer()],
    FORGE_CRUCIBLES_PROGRAM_ID
  )
}

async function main() {
  console.log('🔧 Adding Metaplex Token Metadata to cSOL mint...')
  console.log('📍 Mint Address:', CSOL_MINT.toString())
  
  // Load wallet
  const homedir = process.env.HOME || '~'
  const walletPath = process.env.ANCHOR_WALLET || path.join(homedir, '.config/solana/id.json')
  
  if (!fs.existsSync(walletPath)) {
    console.error('❌ Error: Wallet file not found at:', walletPath)
    console.log('   Set ANCHOR_WALLET environment variable or ensure ~/.config/solana/id.json exists')
    process.exit(1)
  }
  
  const walletKeypair = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync(walletPath, 'utf-8')))
  )
  
  console.log('📝 Wallet:', walletKeypair.publicKey.toString())
  
  // Setup connection
  const connection = new Connection(RPC_URL, 'confirmed')
  
  // Check wallet balance
  const balance = await connection.getBalance(walletKeypair.publicKey)
  console.log('💰 Wallet Balance:', balance / 1e9, 'SOL')
  
  if (balance < 0.1 * 1e9) {
    console.warn('⚠️  Warning: Low balance. You may need SOL for transaction fees.')
    console.log('   Run: solana airdrop 1', walletKeypair.publicKey.toString())
  }
  
  // Derive PDAs
  const baseMint = WSOL_MINT
  const [cruciblePDA, crucibleBump] = deriveCruciblePDA(baseMint)
  const [metadataPDA, metadataBump] = deriveMetadataPDA(CSOL_MINT)
  // Crucible authority is same as crucible PDA
  const crucibleAuthorityPDA = cruciblePDA
  
  console.log('🔍 Derived PDAs:')
  console.log('   Crucible PDA:', cruciblePDA.toString())
  console.log('   Crucible Authority PDA:', crucibleAuthorityPDA.toString())
  console.log('   Metadata PDA:', metadataPDA.toString())
  
  // Check if metadata already exists
  try {
    const metadataAccount = await connection.getAccountInfo(metadataPDA)
    if (metadataAccount) {
      console.log('⚠️  Metadata account already exists!')
      console.log('   Current metadata PDA:', metadataPDA.toString())
      process.exit(0)
    }
  } catch (error) {
    console.log('ℹ️  Metadata account does not exist, creating...')
  }
  
  // Load IDL
  const cruciblesIdl = JSON.parse(
    fs.readFileSync(path.join(__dirname, '../target/idl/forge_crucibles.json'), 'utf-8')
  )
  
  // Setup Anchor wallet and program
  const wallet = new anchor.Wallet(walletKeypair)
  const provider = new anchor.AnchorProvider(connection, wallet, {
    commitment: 'confirmed',
  })
  anchor.setProvider(provider)
  
  const program = new anchor.Program(cruciblesIdl, provider) as any
  
  // Create metadata
  console.log('📝 Creating token metadata...')
  console.log('   Name:', TOKEN_NAME)
  console.log('   Symbol:', TOKEN_SYMBOL)
  console.log('   URI:', TOKEN_URI || '(empty)')
  
  try {
    const tx = await program.methods
      .createCtokenMetadata(
        TOKEN_NAME,
        TOKEN_SYMBOL,
        TOKEN_URI,
        0, // seller_fee_basis_points (0% for fungible tokens)
        true // is_mutable
      )
      .accounts({
        crucible: cruciblePDA,
        ctokenMint: CSOL_MINT,
        metadata: metadataPDA,
        crucibleAuthority: crucibleAuthorityPDA,
        payer: walletKeypair.publicKey,
        tokenMetadataProgram: TOKEN_METADATA_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .rpc()
    
    console.log('✅ Metadata created successfully!')
    console.log('🔗 Transaction:', `https://explorer.solana.com/tx/${tx}?cluster=${NETWORK}`)
    console.log('📋 Metadata PDA:', metadataPDA.toString())
    console.log('')
    console.log('🎉 cSOL token metadata has been added!')
    console.log('   It should now display as "cSOL" in Phantom wallet after refreshing.')
    console.log('')
    console.log('💡 Note: If Phantom still shows "Unknown Token", try:')
    console.log('   1. Refresh the wallet')
    console.log('   2. Remove and re-add the token account')
    console.log('   3. Clear Phantom cache and restart')
    
  } catch (error: any) {
    console.error('❌ Error creating metadata:', error)
    
    if (error.message?.includes('already in use')) {
      console.log('')
      console.log('💡 Metadata may already exist. Try checking the metadata PDA above.')
    } else if (error.message?.includes('insufficient funds')) {
      console.log('')
      console.log('💡 Insufficient SOL for transaction fees.')
      console.log('   Run: solana airdrop 1', walletKeypair.publicKey.toString())
    } else {
      console.log('')
      console.log('💡 Error details:', error.message || error)
      if (error.logs) {
        console.log('   Program logs:', error.logs)
      }
    }
    
    process.exit(1)
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('❌ Unexpected error:', error)
    process.exit(1)
  })
