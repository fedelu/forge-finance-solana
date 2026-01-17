#!/bin/bash

# Script to update Anchor.toml with new program IDs
# Usage: ./update-anchor-config.sh [mainnet|devnet]

set -e

NETWORK=${1:-"mainnet"}

echo "🔧 Updating Anchor.toml for $NETWORK..."

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

# Generate new program IDs
print_status "Generating new program IDs..."
anchor keys list > temp_program_ids.txt

# Read program IDs from the generated file
FORGE_CORE=$(grep "forge_core" temp_program_ids.txt | awk '{print $2}')
FORGE_CRUCIBLES=$(grep "forge_crucibles" temp_program_ids.txt | awk '{print $2}')
FORGE_SPARKS=$(grep "forge_sparks" temp_program_ids.txt | awk '{print $2}')
FORGE_SMELTERS=$(grep "forge_smelters" temp_program_ids.txt | awk '{print $2}')
FORGE_HEAT=$(grep "forge_heat" temp_program_ids.txt | awk '{print $2}')
FORGE_REACTORS=$(grep "forge_reactors" temp_program_ids.txt | awk '{print $2}')
FORGE_FIREWALL=$(grep "forge_firewall" temp_program_ids.txt | awk '{print $2}')
FORGE_ENGINEERS=$(grep "forge_engineers" temp_program_ids.txt | awk '{print $2}')

print_status "Generated program IDs:"
echo "forge_core: $FORGE_CORE"
echo "forge_crucibles: $FORGE_CRUCIBLES"
echo "forge_sparks: $FORGE_SPARKS"
echo "forge_smelters: $FORGE_SMELTERS"
echo "forge_heat: $FORGE_HEAT"
echo "forge_reactors: $FORGE_REACTORS"
echo "forge_firewall: $FORGE_FIREWALL"
echo "forge_engineers: $FORGE_ENGINEERS"

# Update Anchor.toml based on network
if [ "$NETWORK" = "mainnet" ]; then
    print_status "Updating Anchor.toml for mainnet..."
    
    # Create backup
    cp Anchor.toml Anchor.toml.backup
    
    # Update the [programs.mainnet] section
    cat > temp_anchor.toml << EOF
[features]
seeds = false
skip-lint = false

[toolchain]
anchor_version = "0.32.0"

[programs.mainnet]
forge_core = "$FORGE_CORE"
forge_crucibles = "$FORGE_CRUCIBLES"
forge_sparks = "$FORGE_SPARKS"
forge_smelters = "$FORGE_SMELTERS"
forge_heat = "$FORGE_HEAT"
forge_reactors = "$FORGE_REACTORS"
forge_firewall = "$FORGE_FIREWALL"
forge_engineers = "$FORGE_ENGINEERS"

[registry]
url = "https://api.apr.dev"

[provider]
cluster = "mainnet"
wallet = "/Users/federicodelucchi/.config/solana/mainnet-keypair.json"

[scripts]
test = "yarn run ts-mocha -p ./tsconfig.json -t 1000000 tests/**/*.ts"
EOF

else
    echo "Error: Invalid network. Use 'mainnet' or 'devnet'"
    exit 1
fi

# Replace Anchor.toml
mv temp_anchor.toml Anchor.toml

# Clean up
rm temp_program_ids.txt

print_success "Anchor.toml updated for $NETWORK"
print_status "Backup saved as Anchor.toml.backup"

echo ""
echo "📋 Next steps:"
echo "1. Update program source files with new IDs"
echo "2. Run: anchor build"
echo "3. Run: anchor deploy --provider.cluster $NETWORK"
echo ""
