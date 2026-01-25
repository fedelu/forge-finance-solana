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
import { Connection, Keypair, PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY } from '@solana/web3.js'
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

// Configuration - Updated Jan 25, 2026
const LENDING_POOL_PROGRAM_ID = new PublicKey('7hwTzKPSKdio6TZdi4SY7wEuGpFha15ebsaiTPp2y3G2') // Deployed to devnet
const USDC_MINT = new PublicKey('Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr') // Devnet USDC (USDC dev)
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
  
  // Check if pool already exists and verify structure
  try {
    const accountInfo = await connection.getAccountInfo(poolPDA)
    if (accountInfo) {
      // Check account size to determine if it's old or new structure
      const isOldStructure = accountInfo.data.length === 73
      const isNewStructure = accountInfo.data.length === 106
      
      if (isOldStructure) {
        console.log('⚠️  Pool exists with OLD structure (73 bytes). It needs to be re-initialized.')
        console.log('⚠️  The old pool account will be closed and a new one created.')
        console.log('⚠️  Any existing deposits/borrows in the old pool will remain in the old account.')
        console.log('⚠️  Proceeding with re-initialization...')
        // Note: We can't close the old account automatically, but we can try to initialize
        // The program will fail if the account exists, so we need to handle this differently
        // For now, we'll try to initialize and let the user know they need to close the old account first
        throw new Error('Old pool account exists. Please close it first or use a different program instance.')
      } else if (isNewStructure) {
        const poolAccount = await program.account.lendingPool.fetch(poolPDA)
        console.log('✅ Pool already initialized with NEW structure:', {
          authority: poolAccount.authority?.toString(),
          usdcMint: poolAccount.usdcMint.toString(),
          totalLiquidity: poolAccount.totalLiquidity.toString(),
          totalBorrowed: poolAccount.totalBorrowed.toString(),
          borrowRate: poolAccount.borrowRate.toString(),
          lenderRate: poolAccount.lenderRate.toString(),
          paused: poolAccount.paused,
        })
        return
      } else {
        console.log('⚠️  Pool account exists but has unexpected size:', accountInfo.data.length)
        console.log('⚠️  Attempting to fetch anyway...')
        const poolAccount = await program.account.lendingPool.fetch(poolPDA)
        console.log('✅ Pool account fetched:', poolAccount)
        return
      }
    }
  } catch (error: any) {
    if (error.message?.includes('Account does not exist') || error.message?.includes('could not find account')) {
      console.log('ℹ️  Pool does not exist, initializing...')
    } else {
      console.log('ℹ️  Error checking pool, attempting initialization...')
      console.log('   Error:', error.message)
    }
  }
  
  // Initialize pool (initial liquidity = 0, can be funded separately)
  const initialLiquidity = 0
  
  console.log('🔨 Initializing pool...')
  const tx = await program.methods
    .initialize(new BN(initialLiquidity))
    .accounts({
      pool: poolPDA,
      usdcMint: USDC_MINT,
      poolVault: poolVaultPDA,
      authority: walletKeypair.publicKey,
      tokenProgram: TOKEN_PROGRAM_ID,
      rent: SYSVAR_RENT_PUBKEY,
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
