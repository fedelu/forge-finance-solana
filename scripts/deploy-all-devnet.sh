#!/bin/bash

# Deploy all Forge Protocol programs to Solana Devnet
# This script builds and deploys all programs, then updates configuration files

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

print_status() {
    echo -e "${YELLOW}📋 $1${NC}"
}

print_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

# Check if anchor is installed
if ! command -v anchor &> /dev/null; then
    print_error "Anchor CLI not found. Please install Anchor first."
    exit 1
fi

# Check if solana CLI is installed
if ! command -v solana &> /dev/null; then
    print_error "Solana CLI not found. Please install Solana CLI first."
    exit 1
fi

print_status "Setting Solana cluster to devnet..."
solana config set --url devnet

print_status "Checking wallet balance..."
BALANCE=$(solana balance --lamports)
print_status "Current balance: $BALANCE lamports"

if [ "$(echo "$BALANCE < 1000000000" | bc -l 2>/dev/null || echo "1")" = "1" ]; then
    print_status "Balance low, requesting airdrop..."
    solana airdrop 2
    sleep 5
fi

print_status "Building programs..."
anchor build

print_status "Deploying lending-pool program..."
anchor deploy --provider.cluster devnet --program-name lending-pool
LENDING_POOL_ID=$(solana address -k target/deploy/lending_pool_usdc-keypair.json)
print_success "Lending pool deployed: $LENDING_POOL_ID"

print_status "Deploying forge-crucibles program..."
anchor deploy --provider.cluster devnet --program-name forge-crucibles
FORGE_CRUCIBLES_ID=$(solana address -k target/deploy/forge_crucibles-keypair.json)
print_success "Forge crucibles deployed: $FORGE_CRUCIBLES_ID"

print_status "Deploying forge-core program..."
anchor deploy --provider.cluster devnet --program-name forge-core
FORGE_CORE_ID=$(solana address -k target/deploy/forge_core-keypair.json)
print_success "Forge core deployed: $FORGE_CORE_ID"

print_status "Updating Anchor.toml with deployed program IDs..."
# Update Anchor.toml
sed -i.bak "s|lending_pool = \".*\"|lending_pool = \"$LENDING_POOL_ID\"|g" Anchor.toml
sed -i.bak "s|forge_crucibles = \".*\"|forge_crucibles = \"$FORGE_CRUCIBLES_ID\"|g" Anchor.toml
sed -i.bak "s|forge_core = \".*\"|forge_core = \"$FORGE_CORE_ID\"|g" Anchor.toml

print_status "Updating frontend configuration..."
# Update src/config/solana-testnet.ts
sed -i.bak "s|LENDING_POOL: '.*'|LENDING_POOL: '$LENDING_POOL_ID'|g" src/config/solana-testnet.ts
sed -i.bak "s|FORGE_CRUCIBLES: '.*'|FORGE_CRUCIBLES: '$FORGE_CRUCIBLES_ID'|g" src/config/solana-testnet.ts
sed -i.bak "s|FORGE_CORE: '.*'|FORGE_CORE: '$FORGE_CORE_ID'|g" src/config/solana-testnet.ts

# Update src/utils/cruciblePdas.ts
sed -i.bak "s|new PublicKey('.*')|new PublicKey('$FORGE_CRUCIBLES_ID')|g" src/utils/cruciblePdas.ts

# Update programs/forge-crucibles/src/lib.rs
sed -i.bak "s|pub const LENDING_POOL_PROGRAM_ID: Pubkey = anchor_lang::solana_program::pubkey!(\".*\");|pub const LENDING_POOL_PROGRAM_ID: Pubkey = anchor_lang::solana_program::pubkey!(\"$LENDING_POOL_ID\");|g" programs/forge-crucibles/src/lib.rs

print_success "All programs deployed successfully!"
print_status "Program IDs:"
echo "  - Lending Pool: $LENDING_POOL_ID"
echo "  - Forge Crucibles: $FORGE_CRUCIBLES_ID"
echo "  - Forge Core: $FORGE_CORE_ID"

print_status "Next steps:"
echo "  1. Run: ts-node scripts/init-lending-pool.ts"
echo "  2. Run: ts-node scripts/init-sol-crucible.ts --treasury <TREASURY_TOKEN_ACCOUNT>"
echo "  3. Test the protocol on devnet"
