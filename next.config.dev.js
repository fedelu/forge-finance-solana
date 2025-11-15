/** @type {import('next').NextConfig} */
const webpackLib = require('webpack')

const nextConfig = {
  // Remove output: 'export' for development
  trailingSlash: true,
  images: {
    unoptimized: true
  },
  env: {
    NEXT_PUBLIC_SOLANA_NETWORK: 'devnet',
    NEXT_PUBLIC_RPC_URL: 'https://api.devnet.solana.com',
    NEXT_PUBLIC_EXPLORER_URL: 'https://explorer.solana.com',
    NEXT_PUBLIC_COMMITMENT: 'confirmed',
    NEXT_PUBLIC_PAYMASTER_URL: undefined,
    NEXT_PUBLIC_APP_DOMAIN: 'http://localhost:3000',
  },
  webpack: (config) => {
    config.resolve = config.resolve || {}
    config.resolve.alias = {
      ...(config.resolve.alias || {}),
      '@solana/errors': require('path').resolve(__dirname, 'src/shims/solana-errors.js'),
      '@solana/errors/dist/index.node.mjs': require('path').resolve(__dirname, 'src/shims/solana-errors.js'),
      '@solana/transaction-messages': require('path').resolve(__dirname, 'src/shims/transaction-messages.js'),
      '@solana/transaction-messages/dist/index.node.mjs': require('path').resolve(__dirname, 'src/shims/transaction-messages.js'),
      '@solana/kit': require('path').resolve(__dirname, 'src/shims/solana-kit.js'),
    }
    config.plugins = config.plugins || []
    config.plugins.push(
      new webpackLib.NormalModuleReplacementPlugin(
        /@solana\/errors(\/dist\/index\.node\.mjs)?$/,
        require('path').resolve(__dirname, 'src/shims/solana-errors.js')
      ),
      new webpackLib.NormalModuleReplacementPlugin(
        /@solana\/transaction-messages(\/dist\/index\.node\.mjs)?$/,
        require('path').resolve(__dirname, 'src/shims/transaction-messages.js')
      ),
      new webpackLib.NormalModuleReplacementPlugin(
        /@solana\/kit$/,
        require('path').resolve(__dirname, 'src/shims/solana-kit.js')
      ),
    )
    return config
  }
}

module.exports = nextConfig
