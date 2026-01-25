import { PublicKey } from '@solana/web3.js'
import { SOLANA_TESTNET_PROGRAM_IDS } from '../config/solana-testnet'

export const FORGE_CRUCIBLES_INFERNO_PROGRAM_ID = new PublicKey(
  SOLANA_TESTNET_PROGRAM_IDS.FORGE_CRUCIBLES_INFERNO
)

export function deriveInfernoCruciblePDA(baseMint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('crucible'), baseMint.toBuffer()],
    FORGE_CRUCIBLES_INFERNO_PROGRAM_ID
  )
}

export function deriveInfernoVaultPDA(crucible: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('vault'), crucible.toBuffer()],
    FORGE_CRUCIBLES_INFERNO_PROGRAM_ID
  )
}

export function deriveInfernoUSDCVaultPDA(crucible: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('usdc_vault'), crucible.toBuffer()],
    FORGE_CRUCIBLES_INFERNO_PROGRAM_ID
  )
}

export function deriveInfernoLPPositionPDA(user: PublicKey, baseMint: PublicKey, nonce: number = 0): [PublicKey, number] {
  // Convert nonce to 8-byte little-endian buffer (u64)
  const nonceBuffer = Buffer.alloc(8)
  nonceBuffer.writeBigUInt64LE(BigInt(nonce))
  
  return PublicKey.findProgramAddressSync(
    [Buffer.from('lp_position'), user.toBuffer(), baseMint.toBuffer(), nonceBuffer],
    FORGE_CRUCIBLES_INFERNO_PROGRAM_ID
  )
}

// Legacy PDA derivation for positions created before nonce was added
export function deriveInfernoLPPositionPDALegacy(user: PublicKey, baseMint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('lp_position'), user.toBuffer(), baseMint.toBuffer()],
    FORGE_CRUCIBLES_INFERNO_PROGRAM_ID
  )
}

export function deriveInfernoCrucibleAuthorityPDA(baseMint: PublicKey): [PublicKey, number] {
  return deriveInfernoCruciblePDA(baseMint)
}
