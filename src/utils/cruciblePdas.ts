import { PublicKey } from '@solana/web3.js'

/**
 * Program ID for forge-crucibles
 * From Anchor.toml or deployed address
 */
export const FORGE_CRUCIBLES_PROGRAM_ID = new PublicKey('B9qek9NaR3xmBro8pdxixaA2SHzDUExB5KaBt9Kb4fry')

/**
 * Derive crucible PDA address
 * Seeds: ["crucible", base_mint]
 */
export function deriveCruciblePDA(baseMint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('crucible'), baseMint.toBuffer()],
    FORGE_CRUCIBLES_PROGRAM_ID
  )
}

/**
 * Derive vault PDA address
 * Seeds: ["vault", crucible]
 */
export function deriveVaultPDA(crucible: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('vault'), crucible.toBuffer()],
    FORGE_CRUCIBLES_PROGRAM_ID
  )
}

/**
 * Derive crucible authority PDA (same as crucible PDA)
 * Seeds: ["crucible", base_mint]
 */
export function deriveCrucibleAuthorityPDA(baseMint: PublicKey): [PublicKey, number] {
  return deriveCruciblePDA(baseMint)
}

/**
 * Derive LP position PDA address
 * Seeds: ["lp_position", user, base_mint, nonce]
 * NOTE: The program uses base_mint in the seeds, not crucible
 * nonce allows multiple positions per user per base_mint (like cToken minting)
 */
export function deriveLPPositionPDA(user: PublicKey, baseMint: PublicKey, nonce: number = 0): [PublicKey, number] {
  // Convert nonce to 8-byte little-endian buffer (u64)
  const nonceBuffer = Buffer.alloc(8)
  nonceBuffer.writeBigUInt64LE(BigInt(nonce))
  
  return PublicKey.findProgramAddressSync(
    [Buffer.from('lp_position'), user.toBuffer(), baseMint.toBuffer(), nonceBuffer],
    FORGE_CRUCIBLES_PROGRAM_ID
  )
}

/**
 * Derive LP position PDA address (legacy - for backward compatibility)
 * Seeds: ["lp_position", user, base_mint]
 * @deprecated Use deriveLPPositionPDA with nonce parameter instead
 */
export function deriveLPPositionPDALegacy(user: PublicKey, baseMint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('lp_position'), user.toBuffer(), baseMint.toBuffer()],
    FORGE_CRUCIBLES_PROGRAM_ID
  )
}

/**
 * Derive USDC vault PDA for LP positions
 * Seeds: ["usdc_vault", crucible]
 * Note: This is a separate vault for USDC used in LP positions
 */
export function deriveUSDCVaultPDA(crucible: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('usdc_vault'), crucible.toBuffer()],
    FORGE_CRUCIBLES_PROGRAM_ID
  )
}

/**
 * Derive leveraged (LVF) position PDA address
 * Seeds: ["position", user, crucible]
 */
export function deriveLeveragedPositionPDA(user: PublicKey, crucible: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('position'), user.toBuffer(), crucible.toBuffer()],
    FORGE_CRUCIBLES_PROGRAM_ID
  )
}
