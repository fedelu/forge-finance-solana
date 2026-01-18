/**
 * List all token accounts for a user to find cSOL mint address
 */

import { Connection, PublicKey } from '@solana/web3.js'
import { getAssociatedTokenAddress, TOKEN_PROGRAM_ID } from '@solana/spl-token'

const RPC_URL = 'https://api.devnet.solana.com'

async function main() {
  const connection = new Connection(RPC_URL, 'confirmed')
  
  // Use wallet from environment or default
  const walletPubkey = process.argv[2] || '6odzDTmqQ95xkuukWAaeoMVwacjK7Ywi5GRZU8jYUrYi'
  const publicKey = new PublicKey(walletPubkey)
  
  console.log('🔍 Searching for token accounts for wallet:', publicKey.toString())
  
  try {
    // Get all token accounts
    const tokenAccounts = await connection.getParsedTokenAccountsByOwner(publicKey, {
      programId: TOKEN_PROGRAM_ID
    })
    
    console.log(`\n✅ Found ${tokenAccounts.value.length} token account(s):\n`)
    
    for (const account of tokenAccounts.value) {
      const parsedInfo = account.account.data.parsed.info
      const mint = parsedInfo.mint
      const balance = parsedInfo.tokenAmount.uiAmount
      const decimals = parsedInfo.tokenAmount.decimals
      
      console.log('📋 Token Account:', account.pubkey.toString())
      console.log('   Mint:', mint)
      console.log('   Balance:', balance, `(decimals: ${decimals})`)
      console.log('')
      
      if (balance && balance > 0) {
        console.log('   ⚠️  This wallet has a balance!')
        console.log('   → This mint address might be the actual cSOL mint')
      }
    }
    
    if (tokenAccounts.value.length === 0) {
      console.log('   No token accounts found for this wallet')
    }
    
  } catch (error: any) {
    console.error('❌ Error:', error.message || error)
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('❌ Unexpected error:', error)
    process.exit(1)
  })
