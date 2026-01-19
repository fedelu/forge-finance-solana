#!/bin/bash

# Deploy Security Fixes - Forge Finance Protocol
# This script deploys all programs with security fixes to devnet
# WARNING: This deployment includes BREAKING CHANGES

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

print_status "🔥 Deploying Forge Finance Security Fixes"
echo "================================================"
echo ""

# Check if we're on devnet
CLUSTER=$(solana config get | grep "RPC URL" | awk '{print $3}')
if [[ ! "$CLUSTER" == *"devnet"* ]]; then
    print_warning "Not on devnet! Current cluster: $CLUSTER"
    read -p "Continue anyway? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

# Check wallet balance
WALLET_ADDRESS=$(solana address)
BALANCE=$(solana balance --output json 2>/dev/null | jq -r '.result.value' 2>/dev/null || echo "0")

print_status "Wallet: $WALLET_ADDRESS"
print_status "Balance: $(echo "scale=2; $BALANCE / 1000000000" | bc) SOL"

if (( $(echo "$BALANCE < 5000000000" | bc -l) )); then
    print_warning "Low balance! Need at least 5 SOL for deployment."
    print_status "Requesting airdrop..."
    solana airdrop 5
    sleep 5
fi

echo ""
print_warning "⚠️  BREAKING CHANGES DETECTED:"
echo "======================================"
echo "1. close_leveraged_position now requires max_slippage_bps parameter"
echo "2. Market state struct changed (added pause_proposed_at field)"
echo "3. Treasury accounts now require TokenAccount validation"
echo "4. Borrower accounts now auto-initialize (backward compatible)"
echo ""
print_warning "⚠️  EXISTING TRANSACTIONS WILL BREAK IF:"
echo "- Frontend code calls close_leveraged_position without max_slippage_bps"
echo "- Existing Market accounts need to be reinitialized (if already deployed)"
echo ""
read -p "Have you updated the frontend code? (y/N): " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    print_error "Please update frontend code first!"
    print_status "Update useLVFPosition.ts to include max_slippage_bps parameter"
    exit 1
fi

# Build programs
print_status "Building programs..."
anchor build

if [ $? -ne 0 ]; then
    print_error "Build failed!"
    exit 1
fi

print_success "Build successful!"

# Deploy programs
echo ""
print_status "Deploying programs to devnet..."
echo ""

# Program IDs from Anchor.toml
PROGRAMS=(
    "forge_crucibles:B9qek9NaR3xmBro8pdxixaA2SHzDUExB5KaBt9Kb4fry"
    "lending_pool:3UPgC2UJ6odJwWPBqDEx19ycL5ccuS3mbF1pt5SU39dx"
    "lending:BeJW4TrT31GWgW5wpLeYS4tFiCQquHd5bHcfYrPykErs"
)

for PROGRAM_INFO in "${PROGRAMS[@]}"; do
    IFS=':' read -r PROGRAM_NAME PROGRAM_ID <<< "$PROGRAM_INFO"
    print_status "Deploying $PROGRAM_NAME..."
    
    # Deploy using anchor deploy (upgrades existing program)
    anchor deploy --program-name $PROGRAM_NAME --provider.cluster devnet
    
    if [ $? -eq 0 ]; then
        print_success "$PROGRAM_NAME deployed successfully!"
    else
        print_error "$PROGRAM_NAME deployment failed!"
        exit 1
    fi
done

echo ""
print_success "✅ All programs deployed successfully!"
echo ""
print_status "📋 Next Steps:"
echo "1. Regenerate IDL files: anchor idl parse -f target/idl/forge_crucibles.json -o src/idl/"
echo "2. Update frontend to use new IDL"
echo "3. Test all transactions with new parameters"
echo "4. If Market accounts exist, they may need reinitialization"
echo ""
print_warning "⚠️  IMPORTANT: Update frontend code to pass max_slippage_bps to close_leveraged_position!"
