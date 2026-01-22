// Utility functions for wallet connection and public key resolution
import { PublicKey } from '@solana/web3.js'

/**
 * Resolve the current public key from multiple possible sources
 * Priority order:
 * 1. sessionContext.walletPublicKey (if provided)
 * 2. providedPublicKey (if provided)
 * 3. hookPublicKey (if provided)
 * 4. walletContext.publicKey (if provided)
 * 
 * @returns Resolved PublicKey or null if none available
 */
export function resolvePublicKey(
  sessionContext?: { walletPublicKey?: PublicKey | string | object | null } | null,
  providedPublicKey?: PublicKey | string | null,
  hookPublicKey?: PublicKey | null,
  walletContext?: { publicKey?: PublicKey | null } | null
): PublicKey | null {
  // Priority 1: sessionContext
  if (sessionContext?.walletPublicKey) {
    try {
      if (sessionContext.walletPublicKey instanceof PublicKey) {
        return sessionContext.walletPublicKey
      } else if (typeof sessionContext.walletPublicKey === 'string') {
        return new PublicKey(sessionContext.walletPublicKey)
      } else if (typeof sessionContext.walletPublicKey === 'object' && sessionContext.walletPublicKey !== null) {
        if ('_bn' in sessionContext.walletPublicKey || 'toBase58' in sessionContext.walletPublicKey || 'toString' in sessionContext.walletPublicKey) {
          const pkString = (sessionContext.walletPublicKey as any).toString?.() || 
                          (sessionContext.walletPublicKey as any).toBase58?.() || 
                          String(sessionContext.walletPublicKey)
          return new PublicKey(pkString)
        }
      }
    } catch (e) {
      // Continue to next priority
    }
  }
  
  // Priority 2: providedPublicKey
  if (providedPublicKey) {
    try {
      if (providedPublicKey instanceof PublicKey) {
        return providedPublicKey
      } else if (typeof providedPublicKey === 'string') {
        return new PublicKey(providedPublicKey)
      }
    } catch (e) {
      // Continue to next priority
    }
  }
  
  // Priority 3: hookPublicKey
  if (hookPublicKey) {
    return hookPublicKey
  }
  
  // Priority 4: walletContext
  if (walletContext?.publicKey) {
    return walletContext.publicKey
  }
  
  return null
}

/**
 * Validate wallet connection and return publicKey or throw error
 */
export function requireWallet(
  sessionContext?: { walletPublicKey?: PublicKey | string | object | null } | null,
  providedPublicKey?: PublicKey | string | null,
  hookPublicKey?: PublicKey | null,
  walletContext?: { publicKey?: PublicKey | null } | null
): PublicKey {
  const publicKey = resolvePublicKey(sessionContext, providedPublicKey, hookPublicKey, walletContext)
  if (!publicKey) {
    throw new Error('Wallet not connected. Please connect your wallet first.')
  }
  return publicKey
}
