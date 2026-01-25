// Forge Protocol - Solana Testnet Configuration
// Real deployment configuration

const LEGACY_MODULE_PROGRAM_IDS = {
  // Legacy program IDs (kept for reference)
  FORGE_SPARKS: 'FsWCUFEPYNv6d4b6woJqH11Vp6P6zFdSQ9HSQp9CYEYf',
  FORGE_SMELTERS: 'B4HQzxJXq2ynfSJYBC7pX7KU5ugD19QeHXLtLyqhGtwg',
  FORGE_HEAT: 'Bg3eqdWPYdjYGzVSuFFLcYBYfcY1KJgHSPaHs8qfxmb7',
  FORGE_REACTORS: 'HurGQkPBHqc68txHvHwpxKhEpjHNR3ChNALAw9RMmsSc',
  FORGE_FIREWALL: '6CtfUiqzkUJub4dZzMmbtwBgcfHgNjTHKesdX39SZaTS',
  FORGE_ENGINEERS: '99hNfvzEBChK3XHYxMKWoUXmLXABmLYjZEu1P3wSaH68',
} as const

export const LEGACY_SOLANA_TESTNET_PROGRAM_IDS = {
  // Legacy devnet deployment - updated to current deployed IDs (Jan 25, 2026)
  FORGE_CORE: '9XAEC5TPTzd2UZjJ4DZkTwqzBCyx4VDwHjSp3N7cGWkM',
  FORGE_CRUCIBLES: 'B9qek9NaR3xmBro8pdxixaA2SHzDUExB5KaBt9Kb4fry',
  FORGE_CRUCIBLES_INFERNO: 'HbhXC9vgDfrgq3gAj22TwXPtEkxmBrKp9MidEY4Y3vMk',
  LENDING: '5SXKQRhg6eEXKqqBUnCEVTToVK1YbvXKbE67FCnKzj8c',
  LENDING_POOL: '7hwTzKPSKdio6TZdi4SY7wEuGpFha15ebsaiTPp2y3G2',
  LVF: '6izkeaYVyYFmDfQ4y749jE1Ew3EVtvNDeWxNzebjYFjs',
  ...LEGACY_MODULE_PROGRAM_IDS,
} as const

export const CURRENT_SOLANA_TESTNET_PROGRAM_IDS = {
  // Current devnet deployment (Jan 25, 2026)
  FORGE_CORE: '9XAEC5TPTzd2UZjJ4DZkTwqzBCyx4VDwHjSp3N7cGWkM',
  FORGE_CRUCIBLES: 'B9qek9NaR3xmBro8pdxixaA2SHzDUExB5KaBt9Kb4fry',
  FORGE_CRUCIBLES_INFERNO: 'HbhXC9vgDfrgq3gAj22TwXPtEkxmBrKp9MidEY4Y3vMk',
  LENDING: '5SXKQRhg6eEXKqqBUnCEVTToVK1YbvXKbE67FCnKzj8c',
  LENDING_POOL: '7hwTzKPSKdio6TZdi4SY7wEuGpFha15ebsaiTPp2y3G2',
  LVF: '6izkeaYVyYFmDfQ4y749jE1Ew3EVtvNDeWxNzebjYFjs',
  ...LEGACY_MODULE_PROGRAM_IDS,
} as const

type ForgeProgramSet = 'legacy' | 'current'

const PROGRAM_SET = (process.env.NEXT_PUBLIC_FORGE_PROGRAM_SET || 'legacy').toLowerCase()

export const ACTIVE_PROGRAM_SET: ForgeProgramSet =
  PROGRAM_SET === 'current' ? 'current' : 'legacy'

// Default to legacy so older positions remain closable.
// Set NEXT_PUBLIC_FORGE_PROGRAM_SET=current to use new program IDs.
export const SOLANA_TESTNET_PROGRAM_IDS =
  ACTIVE_PROGRAM_SET === 'current'
    ? CURRENT_SOLANA_TESTNET_PROGRAM_IDS
    : LEGACY_SOLANA_TESTNET_PROGRAM_IDS

// Deployed account addresses on Solana devnet
export const DEPLOYED_ACCOUNTS = {
  // SOL Crucible accounts (v2 - with yield fix)
  SOL_CRUCIBLE: 'GyMyCCMxtn6SX2fNJZp5rDAvCCf9YTscnVsQcvNXJ28X',
  CSOL_MINT: '52a1tHubVruvC9Uxn4PEAdCyDn4xCYnwjNTBXCxjVHXz',
  SOL_VAULT: '8P7uLdQT4Fkaoic4HLtscrMcKSKioGh7FxLAMmvwD9SW',
  // Inferno LP crucible (new program - Jan 25, 2026)
  INFERNO_SOL_CRUCIBLE: '8ry471FkvmnW87XvYxg9SXtopoSHT5Zg7qmUQdXVnXpb',
  INFERNO_SOL_VAULT: '3SPahJ81EPmMHFbbyNvxq56xheS6FqTU11ZyMLuoUvLv',
  INFERNO_USDC_VAULT: '4ReTrUo75tFzKkfsMSoqJzvEhbQXAY4MBhTF5w5pka1d',
  INFERNO_LP_MINT: '4jFPRsNFijEGurcvnX82KjvD3tHUzXo4Cc9A2eVL6xnD',
  // Treasury accounts (wallet's ATAs for WSOL and USDC)
  WSOL_TREASURY: '9VbGJDCXshKXfhA6J2TJv53RpQQeVFocXp2gNuxUxioW',
  USDC_TREASURY: '3JBr8DyZ2ghhPNFqqVLP4kfYbja1jcbJQ9MDZ31uB1RU',
  // Lending pool accounts (Jan 25, 2026)
  LENDING_POOL_PDA: 'Gfb5xoacc8hmGDh96mcAnUepebzJyBdx9RjGCUcEuRP5',
} as const

export const SOLANA_TESTNET_CONFIG = {
  // Use Solana public devnet RPC by default for this project
  RPC_URL: 'https://api.devnet.solana.com',
  // Default demo wallet address (can be overridden by wallet adapter)
  WALLET_ADDRESS: '5R7DQ1baJiYoi4GdVu1hTwBZMHxqabDenzaLVA9V7wV3',
  NETWORK: 'devnet',
  COMMITMENT: 'confirmed' as const,
  EXPLORER_URL: 'https://explorer.solana.com',
  // Token configuration for Solana devnet
  TOKEN_ADDRESSES: {
    SOL: 'So11111111111111111111111111111111111111112', // Wrapped SOL
    FORGE: 'ForgeToken11111111111111111111111111111111111', // Placeholder - replace with actual FORGE token mint when deployed
    USDC: 'Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr', // Devnet USDC mint (USDC dev)
  },
  // Pyth Network price feed addresses on devnet
  PYTH_PRICE_FEEDS: {
    SOL_USD: 'ALP8SdU9oARYVLgLR7LrGzyc6M3zvTyUxE6QfkYYJJEt', // SOL/USD price feed on devnet
    INFERNO_LP_USD: '3ucNos4NbumPLZNWztqGHNFFgkHeRMBQAVemeeomsUxv', // Inferno LP token price feed on devnet
  },
  // Basic APY configuration
  APY_CONFIG: {
    SOL_CRUCIBLE: 0.08,
    USDC_CRUCIBLE: 0.06,
  },
} as const
