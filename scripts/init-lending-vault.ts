/**
 * Initialize Lending Pool Vault on Solana Devnet
 *
 * Usage:
 *   ts-node scripts/init-lending-vault.ts
 */

import * as anchor from '@coral-xyz/anchor'
import { Connection, Keypair, PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY, Transaction, TransactionInstruction, sendAndConfirmTransaction } from '@solana/web3.js'
import { TOKEN_PROGRAM_ID } from '@solana/spl-token'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { dirname } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Load IDL
const lendingPoolIdl = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../target/idl/lending_pool_usdc.json'), 'utf-8')
)

// Configuration
const LENDING_POOL_PROGRAM_ID = new PublicKey('AHBtzkRF2gis8YF13Mdcq3MjHm4gUGniXE9UYZPUZXEL')
const USDC_MINT = new PublicKey('Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr')
const NETWORK = 'devnet'
const RPC_URL = 'https://api.devnet.solana.com'

async function main() {
  console.log('🚀 Initializing Lending Pool Vault on', NETWORK)

  const homedir = process.env.HOME || '~'
  const walletPath = process.env.ANCHOR_WALLET || path.join(homedir, '.config/solana/id.json')
  const walletKeypair = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync(walletPath, 'utf-8')))
  )

  console.log('📝 Wallet:', walletKeypair.publicKey.toString())

  const connection = new Connection(RPC_URL, 'confirmed')
  const wallet = new anchor.Wallet(walletKeypair)
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: 'confirmed' })
  anchor.setProvider(provider)

  const [poolPDA] = PublicKey.findProgramAddressSync([Buffer.from('pool')], LENDING_POOL_PROGRAM_ID)
  const [poolVaultPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from('vault'), poolPDA.toBuffer()],
    LENDING_POOL_PROGRAM_ID
  )

  console.log('📋 Pool PDA:', poolPDA.toString())
  console.log('📋 Pool Vault PDA:', poolVaultPDA.toString())

  const INITIALIZE_VAULT_DISCRIMINATOR = Buffer.from([48, 191, 163, 44, 71, 129, 63, 164])
  const initVaultIx = new TransactionInstruction({
    keys: [
      { pubkey: poolPDA, isSigner: false, isWritable: false },
      { pubkey: USDC_MINT, isSigner: false, isWritable: false },
      { pubkey: poolVaultPDA, isSigner: false, isWritable: true },
      { pubkey: walletKeypair.publicKey, isSigner: true, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: LENDING_POOL_PROGRAM_ID,
    data: INITIALIZE_VAULT_DISCRIMINATOR,
  })

  const tx = new Transaction().add(initVaultIx)
  tx.feePayer = walletKeypair.publicKey
  tx.recentBlockhash = (await connection.getLatestBlockhash('confirmed')).blockhash

  const signature = await sendAndConfirmTransaction(connection, tx, [walletKeypair], {
    commitment: 'confirmed',
  })

  console.log('✅ Pool vault initialized! Transaction:', signature)
  console.log('🔗 Explorer:', `https://explorer.solana.com/tx/${signature}?cluster=${NETWORK}`)
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('❌ Error:', error)
    process.exit(1)
  })
