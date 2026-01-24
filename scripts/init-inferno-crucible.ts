/**
 * Initialize Inferno LP Crucible on Solana devnet
 *
 * Usage:
 *   ts-node scripts/init-inferno-crucible.ts --treasury-base <WSOL_TREASURY> --treasury-usdc <USDC_TREASURY>
 */
import * as anchor from '@coral-xyz/anchor'
import { Connection, Keypair, PublicKey } from '@solana/web3.js'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { dirname } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const infernoIdl = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../target/idl/forge_crucibles_inferno.json'), 'utf-8')
)

const CRUCIBLES_INFERNO_PROGRAM_ID = new PublicKey('Ep2FZ1WZGbeajKoRs768cZ7fjP963xqvga6kHWJ5K9kv')
const WSOL_MINT = new PublicKey('So11111111111111111111111111111111111111112')
const USDC_MINT = new PublicKey('Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr')
const PYTH_SOL_USD_PRICE_FEED = new PublicKey('ALP8SdU9oARYVLgLR7LrGzyc6M3zvTyUxE6QfkYYJJEt')
const RPC_URL = 'https://api.devnet.solana.com'
const FEE_RATE = 200 // 0.2%

function parseArgs() {
  const args = process.argv.slice(2)
  let treasuryBase: PublicKey | null = null
  let treasuryUsdc: PublicKey | null = null
  let oracle: PublicKey = PYTH_SOL_USD_PRICE_FEED
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--treasury-base' && i + 1 < args.length) {
      treasuryBase = new PublicKey(args[i + 1])
    }
    if (args[i] === '--treasury-usdc' && i + 1 < args.length) {
      treasuryUsdc = new PublicKey(args[i + 1])
    }
    if (args[i] === '--oracle' && i + 1 < args.length) {
      oracle = new PublicKey(args[i + 1])
    }
  }
  if (!treasuryBase || !treasuryUsdc) {
    throw new Error('Missing --treasury-base or --treasury-usdc')
  }
  return { treasuryBase, treasuryUsdc, oracle }
}

async function main() {
  const { treasuryBase, treasuryUsdc, oracle } = parseArgs()
  const walletPath = process.env.ANCHOR_WALLET || path.join(process.env.HOME || '~', '.config/solana/id.json')
  const walletKeypair = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync(walletPath, 'utf-8')))
  )

  const connection = new Connection(RPC_URL, 'confirmed')
  const wallet = new anchor.Wallet(walletKeypair)
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: 'confirmed' })
  anchor.setProvider(provider)

  const program = new anchor.Program(infernoIdl, CRUCIBLES_INFERNO_PROGRAM_ID, provider) as any

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

  const lpMintKeypair = Keypair.generate()
  const mintPath = path.join(__dirname, '../target/deploy/forge_crucibles_inferno_lp_mint-keypair.json')
  fs.writeFileSync(mintPath, JSON.stringify(Array.from(lpMintKeypair.secretKey)))

  console.log('🔧 Inferno Crucible PDA:', cruciblePDA.toString())
  console.log('🔧 Vault PDA:', vaultPDA.toString())
  console.log('🔧 USDC Vault PDA:', usdcVaultPDA.toString())
  console.log('🔧 LP Mint:', lpMintKeypair.publicKey.toString())
  console.log('🔧 LP Mint keypair saved to:', mintPath)

  const tx = await program.methods
    .initializeInfernoCrucible(new anchor.BN(FEE_RATE))
    .accounts({
      authority: walletKeypair.publicKey,
      crucible: cruciblePDA,
      baseMint: WSOL_MINT,
      lpTokenMint: lpMintKeypair.publicKey,
      vault: vaultPDA,
      usdcVault: usdcVaultPDA,
      usdcMint: USDC_MINT,
      treasuryBase,
      treasuryUsdc,
      oracle,
      tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
      systemProgram: anchor.web3.SystemProgram.programId,
      rent: anchor.web3.SYSVAR_RENT_PUBKEY,
    })
    .signers([lpMintKeypair])
    .rpc()

  console.log('✅ Inferno crucible initialized:', tx)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
