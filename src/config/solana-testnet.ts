// Forge Protocol - Solana Testnet Configuration
// Real deployment configuration

export const SOLANA_TESTNET_PROGRAM_IDS = {
  // TODO: Replace these with the actual program IDs after deploying to Solana devnet
  FORGE_CORE: 'DWkDGw5Pvqgh3DN6HZwssn31AUAkuWLtjDnjyEUdgRHU',
  FORGE_CRUCIBLES: 'Ab84n2rkgEnDnQmJKfMsr88jbJqYPcgBW7irwoYWwCL2',
  FORGE_SPARKS: 'FsWCUFEPYNv6d4b6woJqH11Vp6P6zFdSQ9HSQp9CYEYf',
  FORGE_SMELTERS: 'B4HQzxJXq2ynfSJYBC7pX7KU5ugD19QeHXLtLyqhGtwg',
  FORGE_HEAT: 'Bg3eqdWPYdjYGzVSuFFLcYBYfcY1KJgHSPaHs8qfxmb7',
  FORGE_REACTORS: 'HurGQkPBHqc68txHvHwpxKhEpjHNR3ChNALAw9RMmsSc',
  FORGE_FIREWALL: '6CtfUiqzkUJub4dZzMmbtwBgcfHgNjTHKesdX39SZaTS',
  FORGE_ENGINEERS: '99hNfvzEBChK3XHYxMKWoUXmLXABmLYjZEu1P3wSaH68',
} as const

export const SOLANA_TESTNET_CONFIG = {
  // Use Solana public devnet RPC by default for this project
  RPC_URL: 'https://api.devnet.solana.com',
  // Default demo wallet address (can be overridden by wallet adapter)
  WALLET_ADDRESS: '5R7DQ1baJiYoi4GdVu1hTwBZMHxqabDenzaLVA9V7wV3',
  NETWORK: 'devnet',
  COMMITMENT: 'confirmed' as const,
  EXPLORER_URL: 'https://explorer.solana.com',
  // Token configuration for Solana devnet (placeholders – replace with real mints)
  TOKEN_ADDRESSES: {
    SOL: 'So11111111111111111111111111111111111111112', // Wrapped SOL
    FORGE: 'ForgeToken11111111111111111111111111111111111', // TODO: replace with real devnet mint
    USDC: 'USDCDevnet111111111111111111111111111111111', // TODO: replace with real devnet mint
  },
  // Basic APY configuration mirroring previous demo values
  APY_CONFIG: {
    SOL_CRUCIBLE: 0.08,
    FORGE_CRUCIBLE: 0.12,
    USDC_CRUCIBLE: 0.06,
  },
} as const
