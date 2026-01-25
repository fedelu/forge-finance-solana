/**
 * Initialize Inferno LP Crucible on Solana devnet (manual instruction builder)
 *
 * Usage:
 *   npx ts-node --esm scripts/init-inferno-crucible-manual.ts
 */
import { Connection, Keypair, PublicKey, Transaction, TransactionInstruction, SystemProgram, SYSVAR_RENT_PUBKEY } from '@solana/web3.js'
import { TOKEN_PROGRAM_ID, MINT_SIZE, createInitializeMintInstruction } from '@solana/spl-token'
import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'
import { dirname } from 'path'
import BN from 'bn.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const CRUCIBLES_INFERNO_PROGRAM_ID = new PublicKey('HbhXC9vgDfrgq3gAj22TwXPtEkxmBrKp9MidEY4Y3vMk')
const WSOL_MINT = new PublicKey('So11111111111111111111111111111111111111112')
const USDC_MINT = new PublicKey('Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr')
const PYTH_SOL_USD_PRICE_FEED = new PublicKey('ALP8SdU9oARYVLgLR7LrGzyc6M3zvTyUxE6QfkYYJJEt')
const RPC_URL = 'https://api.devnet.solana.com'
const FEE_RATE = 200 // 0.2%

// Treasury accounts from DEPLOYED_ACCOUNTS
const TREASURY_BASE = new PublicKey('9VbGJDCXshKXfhA6J2TJv53RpQQeVFocXp2gNuxUxioW')
const TREASURY_USDC = new PublicKey('5eE5bpne9hNWrbRNrgSrAK3h6H2QzFSAb46YFMbeFj6w')

// Discriminator from IDL: [129, 88, 50, 148, 137, 28, 116, 64]
const INITIALIZE_INFERNO_CRUCIBLE_DISCRIMINATOR = Buffer.from([129, 88, 50, 148, 137, 28, 116, 64])

function buildInitializeInfernoCrucibleInstruction(
  programId: PublicKey,
  accounts: {
    authority: PublicKey
    crucible: PublicKey
    baseMint: PublicKey
    lpTokenMint: PublicKey
    vault: PublicKey
    usdcVault: PublicKey
    usdcMint: PublicKey
    treasuryBase: PublicKey
    treasuryUsdc: PublicKey
    oracle: PublicKey
    tokenProgram: PublicKey
    systemProgram: PublicKey
    rent: PublicKey
  },
  feeRate: BN
): TransactionInstruction {
  // Serialize fee_rate as u64 (8 bytes, little-endian)
  const feeRateBuffer = Buffer.alloc(8)
  feeRate.toArrayLike(Buffer, 'le', 8).copy(feeRateBuffer)
  
  // Instruction data = discriminator + fee_rate
  const data = Buffer.concat([INITIALIZE_INFERNO_CRUCIBLE_DISCRIMINATOR, feeRateBuffer])
  
  // Account metas in order (from IDL)
  const keys = [
    { pubkey: accounts.authority, isSigner: true, isWritable: true },
    { pubkey: accounts.crucible, isSigner: false, isWritable: true },
    { pubkey: accounts.baseMint, isSigner: false, isWritable: false },
    { pubkey: accounts.lpTokenMint, isSigner: true, isWritable: true },
    { pubkey: accounts.vault, isSigner: false, isWritable: true },
    { pubkey: accounts.usdcVault, isSigner: false, isWritable: true },
    { pubkey: accounts.usdcMint, isSigner: false, isWritable: false },
    { pubkey: accounts.treasuryBase, isSigner: false, isWritable: true },
    { pubkey: accounts.treasuryUsdc, isSigner: false, isWritable: true },
    { pubkey: accounts.oracle, isSigner: false, isWritable: false },
    { pubkey: accounts.tokenProgram, isSigner: false, isWritable: false },
    { pubkey: accounts.systemProgram, isSigner: false, isWritable: false },
    { pubkey: accounts.rent, isSigner: false, isWritable: false },
  ]
  
  return new TransactionInstruction({
    keys,
    programId,
    data,
  })
}

async function main() {
  const walletPath = process.env.ANCHOR_WALLET || path.join(process.env.HOME || '~', '.config/solana/id.json')
  const walletKeypair = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync(walletPath, 'utf-8')))
  )
  
  console.log('🔧 Wallet:', walletKeypair.publicKey.toString())

  const connection = new Connection(RPC_URL, 'confirmed')

  // Derive PDAs
  const [cruciblePDA] = PublicKey.findProgramAddressSync(
    [Buffer.from('crucible'), WSOL_MINT.toBuffer()],
    CRUCIBLES_INFERNO_PROGRAM_ID
  )
  const [vaultPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from('vault'), cruciblePDA.toBuffer()],
    CRUCIBLES_INFERNO_PROGRAM_ID
  )
  const [usdcVaultPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from('usdc_vault'), cruciblePDA.toBuffer()],
    CRUCIBLES_INFERNO_PROGRAM_ID
  )

  // Generate LP token mint keypair
  const lpMintKeypair = Keypair.generate()
  const mintPath = path.join(__dirname, '../target/deploy/forge_crucibles_inferno_lp_mint-keypair.json')
  fs.writeFileSync(mintPath, JSON.stringify(Array.from(lpMintKeypair.secretKey)))

  console.log('🔧 Inferno Crucible PDA:', cruciblePDA.toString())
  console.log('🔧 Vault PDA:', vaultPDA.toString())
  console.log('🔧 USDC Vault PDA:', usdcVaultPDA.toString())
  console.log('🔧 LP Mint:', lpMintKeypair.publicKey.toString())
  console.log('🔧 LP Mint keypair saved to:', mintPath)
  
  // Check if crucible already exists
  const crucibleInfo = await connection.getAccountInfo(cruciblePDA)
  if (crucibleInfo) {
    console.log('✅ Inferno crucible already exists!')
    return
  }

  // Create LP mint account first (needs to be allocated before the contract can initialize it)
  const mintLamports = await connection.getMinimumBalanceForRentExemption(MINT_SIZE)
  const createMintAccountIx = SystemProgram.createAccount({
    fromPubkey: walletKeypair.publicKey,
    newAccountPubkey: lpMintKeypair.publicKey,
    lamports: mintLamports,
    space: MINT_SIZE,
    programId: TOKEN_PROGRAM_ID,
  })

  console.log('🔧 Creating LP mint account with', mintLamports, 'lamports for rent')

  // Build instruction
  const initIx = buildInitializeInfernoCrucibleInstruction(
    CRUCIBLES_INFERNO_PROGRAM_ID,
    {
      authority: walletKeypair.publicKey,
      crucible: cruciblePDA,
      baseMint: WSOL_MINT,
      lpTokenMint: lpMintKeypair.publicKey,
      vault: vaultPDA,
      usdcVault: usdcVaultPDA,
      usdcMint: USDC_MINT,
      treasuryBase: TREASURY_BASE,
      treasuryUsdc: TREASURY_USDC,
      oracle: PYTH_SOL_USD_PRICE_FEED,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      rent: SYSVAR_RENT_PUBKEY,
    },
    new BN(FEE_RATE)
  )

  // Build and send transaction
  const transaction = new Transaction()
    .add(createMintAccountIx)
    .add(initIx)
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed')
  transaction.recentBlockhash = blockhash
  transaction.feePayer = walletKeypair.publicKey
  
  // Sign with both wallet and LP mint keypair
  transaction.sign(walletKeypair, lpMintKeypair)
  
  const signature = await connection.sendRawTransaction(transaction.serialize())
  console.log('📝 Transaction sent:', signature)
  
  await connection.confirmTransaction({
    signature,
    blockhash,
    lastValidBlockHeight,
  }, 'confirmed')

  console.log('✅ Inferno crucible initialized!')
  console.log('🔗 Explorer:', `https://explorer.solana.com/tx/${signature}?cluster=devnet`)
}

main().catch((err) => {
  console.error('❌ Error:', err)
  process.exit(1)
})
