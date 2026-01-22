// Forge Protocol - Solana Testnet Configuration
// Real deployment configuration

export const SOLANA_TESTNET_PROGRAM_IDS = {
  // Deployed to Solana devnet - January 2026
  FORGE_CORE: 'CtR5tkwzpUmyxMNnihkPdSZzVk5fws1LumXXGyU4phJa',
  FORGE_CRUCIBLES: 'B9qek9NaR3xmBro8pdxixaA2SHzDUExB5KaBt9Kb4fry',
  LENDING: 'BeJW4TrT31GWgW5wpLeYS4tFiCQquHd5bHcfYrPykErs',
  LENDING_POOL: '3UPgC2UJ6odJwWPBqDEx19ycL5ccuS3mbF1pt5SU39dx',
  LVF: 'DNV9nTmTztTaufsdKQd3WW1vfaKHMB5uiGzWRXD3AgYd',
  // Legacy program IDs (kept for reference)
  FORGE_SPARKS: 'FsWCUFEPYNv6d4b6woJqH11Vp6P6zFdSQ9HSQp9CYEYf',
  FORGE_SMELTERS: 'B4HQzxJXq2ynfSJYBC7pX7KU5ugD19QeHXLtLyqhGtwg',
  FORGE_HEAT: 'Bg3eqdWPYdjYGzVSuFFLcYBYfcY1KJgHSPaHs8qfxmb7',
  FORGE_REACTORS: 'HurGQkPBHqc68txHvHwpxKhEpjHNR3ChNALAw9RMmsSc',
  FORGE_FIREWALL: '6CtfUiqzkUJub4dZzMmbtwBgcfHgNjTHKesdX39SZaTS',
  FORGE_ENGINEERS: '99hNfvzEBChK3XHYxMKWoUXmLXABmLYjZEu1P3wSaH68',
} as const

// Deployed account addresses on Solana devnet
export const DEPLOYED_ACCOUNTS = {
  // SOL Crucible accounts (v2 - with yield fix)
  SOL_CRUCIBLE: 'GyMyCCMxtn6SX2fNJZp5rDAvCCf9YTscnVsQcvNXJ28X',
  CSOL_MINT: '52a1tHubVruvC9Uxn4PEAdCyDn4xCYnwjNTBXCxjVHXz',
  SOL_VAULT: '8P7uLdQT4Fkaoic4HLtscrMcKSKioGh7FxLAMmvwD9SW',
  // Treasury accounts
  WSOL_TREASURY: '9VbGJDCXshKXfhA6J2TJv53RpQQeVFocXp2gNuxUxioW',
  USDC_TREASURY: '5eE5bpne9hNWrbRNrgSrAK3h6H2QzFSAb46YFMbeFj6w',
  // Lending pool accounts
  LENDING_POOL_PDA: 'DfiLCC9sFHuNvbpfA5JxaK9DFmSjoCYoFrXn4a4trr5R',
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
    USDC: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU', // Real devnet USDC mint
  },
  // Pyth Network price feed addresses on devnet
  PYTH_PRICE_FEEDS: {
    SOL_USD: 'ALP8SdU9oARYVLgLR7LrGzyc6M3zvTyUxE6QfkYYJJEt', // SOL/USD price feed on devnet
  },
  // Basic APY configuration
  APY_CONFIG: {
    SOL_CRUCIBLE: 0.08,
    USDC_CRUCIBLE: 0.06,
  },
} as const
