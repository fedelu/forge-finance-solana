/**
 * Initialize Lending Pool on Solana Devnet
 * 
 * This script initializes the USDC lending pool with:
 * - Pool PDA account
 * - Pool vault token account
 * - Initial pool state
 * 
 * Usage:
 *   ts-node scripts/init-lending-pool.ts
 */

import * as anchor from '@coral-xyz/anchor'
import { Connection, Keypair, PublicKey, SystemProgram } from '@solana/web3.js'
import { TOKEN_PROGRAM_ID } from '@solana/spl-token'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { dirname } from 'path'
import BN from 'bn.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Load IDL
const lendingPoolIdl = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../target/idl/lending_pool_usdc.json'), 'utf-8')
)

// Configuration
const LENDING_POOL_PROGRAM_ID = new PublicKey('3UPgC2UJ6odJwWPBqDEx19ycL5ccuS3mbF1pt5SU39dx') // Deployed to devnet
const USDC_MINT = new PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU') // Devnet USDC
const NETWORK = 'devnet'
const RPC_URL = 'https://api.devnet.solana.com'

async function main() {
  console.log('🚀 Initializing Lending Pool on', NETWORK)
  
  // Load wallet
  const homedir = process.env.HOME || '~'
  const walletPath = process.env.ANCHOR_WALLET || path.join(homedir, '.config/solana/id.json')
  const walletKeypair = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync(walletPath, 'utf-8')))
  )
  
  console.log('📝 Wallet:', walletKeypair.publicKey.toString())
  
  // Setup connection and provider
  const connection = new Connection(RPC_URL, 'confirmed')
  const wallet = new anchor.Wallet(walletKeypair)
  const provider = new anchor.AnchorProvider(connection, wallet, {
    commitment: 'confirmed',
  })
  anchor.setProvider(provider)
  
  // Create program instance with proper typing
  const program = new anchor.Program(lendingPoolIdl, provider) as any
  
  // Derive PDAs
  const [poolPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from('pool')],
    LENDING_POOL_PROGRAM_ID
  )
  
  const [poolVaultPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from('vault'), poolPDA.toBuffer()],
    LENDING_POOL_PROGRAM_ID
  )
  
  console.log('📋 Pool PDA:', poolPDA.toString())
  console.log('📋 Pool Vault PDA:', poolVaultPDA.toString())
  
  // Check if pool already exists
  try {
    const poolAccount = await program.account.lendingPool.fetch(poolPDA)
    console.log('✅ Pool already initialized:', poolAccount)
    return
  } catch (error: any) {
    console.log('ℹ️  Pool does not exist, initializing...')
  }
  
  // Initialize pool (initial liquidity = 0, can be funded separately)
  const initialLiquidity = 0
  
  console.log('🔨 Initializing pool...')
  const tx = await program.methods
    .initialize(new BN(initialLiquidity))
    .accounts({
      pool: poolPDA,
      usdcMint: USDC_MINT,
      authority: walletKeypair.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .rpc()
  
  console.log('✅ Pool initialized! Transaction:', tx)
  console.log('🔗 Explorer:', `https://explorer.solana.com/tx/${tx}?cluster=${NETWORK}`)
  
  // Verify pool was created
  const poolAccount = await program.account.lendingPool.fetch(poolPDA) as any
  console.log('✅ Pool state:', {
    usdcMint: poolAccount.usdcMint.toString(),
    totalLiquidity: poolAccount.totalLiquidity.toString(),
    totalBorrowed: poolAccount.totalBorrowed.toString(),
    borrowRate: poolAccount.borrowRate.toString(),
    lenderRate: poolAccount.lenderRate.toString(),
  })
  
  console.log('\n🎉 Lending pool initialization complete!')
  console.log('📝 Update Anchor.toml and src/config/solana-testnet.ts with:')
  console.log('   LENDING_POOL:', LENDING_POOL_PROGRAM_ID.toString())
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('❌ Error:', error)
    process.exit(1)
  })
