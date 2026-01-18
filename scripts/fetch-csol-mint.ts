/**
 * Fetch the actual cSOL mint address from the deployed crucible
 */

import * as anchor from '@coral-xyz/anchor'
import { Connection, Keypair, PublicKey } from '@solana/web3.js'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { dirname } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const SOL_CRUCIBLE = new PublicKey('GyMyCCMxtn6SX2fNJZp5rDAvCCf9YTscnVsQcvNXJ28X')
const CRUCIBLES_PROGRAM_ID = new PublicKey('B9qek9NaR3xmBro8pdxixaA2SHzDUExB5KaBt9Kb4fry')
const RPC_URL = 'https://api.devnet.solana.com'

async function main() {
  const connection = new Connection(RPC_URL, 'confirmed')
  
  console.log('🔍 Fetching cSOL mint address from crucible...')
  console.log('📍 Crucible PDA:', SOL_CRUCIBLE.toString())
  
  // Load wallet
  const homedir = process.env.HOME || '~'
  const walletPath = process.env.ANCHOR_WALLET || path.join(homedir, '.config/solana/id.json')
  const walletKeypair = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync(walletPath, 'utf-8')))
  )
  
  // Load IDL
  const cruciblesIdl = JSON.parse(
    fs.readFileSync(path.join(__dirname, '../target/idl/forge_crucibles.json'), 'utf-8')
  )
  
  const wallet = new anchor.Wallet(walletKeypair)
  const provider = new anchor.AnchorProvider(connection, wallet, {
    commitment: 'confirmed',
  })
  anchor.setProvider(provider)
  
  const program = new anchor.Program(cruciblesIdl, provider) as any
  
  try {
    const crucibleAccount = await program.account.crucible.fetch(SOL_CRUCIBLE)
    
    if (crucibleAccount && crucibleAccount.ctokenMint) {
      const mintAddress = crucibleAccount.ctokenMint.toString()
      console.log('✅ Found cSOL mint address:', mintAddress)
      console.log('   Use this address in the metadata script!')
      return mintAddress
    } else {
      console.error('❌ Could not find ctokenMint in crucible account')
      process.exit(1)
    }
  } catch (error: any) {
    console.error('❌ Error fetching crucible:', error.message || error)
    process.exit(1)
  }
}

main()
  .then((mint) => {
    if (mint) {
      console.log('\n💡 Update scripts/add-csol-metadata.ts with this mint address')
    }
    process.exit(0)
  })
  .catch((error) => {
    console.error('❌ Unexpected error:', error)
    process.exit(1)
  })
