#!/bin/bash

# Update IDL After Deployment
# This script updates the IDL file after deploying the updated forge-crucibles program

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

print_status "🔄 Updating IDL after deployment"
echo "=========================================="
echo ""

# Check if target/idl/forge_crucibles.json exists
if [ ! -f "target/idl/forge_crucibles.json" ]; then
    print_error "IDL file not found at target/idl/forge_crucibles.json"
    print_status "Building program to generate IDL..."
    anchor build --program-name forge-crucibles
    
    if [ ! -f "target/idl/forge_crucibles.json" ]; then
        print_error "Failed to generate IDL. Please build the program first."
        exit 1
    fi
fi

# Backup existing IDL
if [ -f "src/idl/forge-crucibles.json" ]; then
    print_status "Backing up existing IDL..."
    cp src/idl/forge-crucibles.json src/idl/forge-crucibles.json.backup
    print_success "Backup created: src/idl/forge-crucibles.json.backup"
fi

# Copy new IDL
print_status "Copying new IDL to src/idl/..."
cp target/idl/forge_crucibles.json src/idl/forge-crucibles.json

# Verify the new IDL includes the deposit_arbitrage_profit instruction
if grep -q "deposit_arbitrage_profit" src/idl/forge-crucibles.json; then
    print_success "✅ New IDL includes deposit_arbitrage_profit instruction"
else
    print_warning "⚠️  deposit_arbitrage_profit instruction not found in IDL"
    print_warning "This might be normal if the program wasn't rebuilt after adding the instruction"
fi

# Verify ArbitrageProfitDeposited event
if grep -q "ArbitrageProfitDeposited" src/idl/forge-crucibles.json; then
    print_success "✅ New IDL includes ArbitrageProfitDeposited event"
else
    print_warning "⚠️  ArbitrageProfitDeposited event not found in IDL"
fi

# Verify DepositArbitrageProfit account struct
if grep -q "DepositArbitrageProfit" src/idl/forge-crucibles.json; then
    print_success "✅ New IDL includes DepositArbitrageProfit account struct"
else
    print_warning "⚠️  DepositArbitrageProfit account struct not found in IDL"
fi

print_success "IDL updated successfully!"
print_status "New IDL location: src/idl/forge-crucibles.json"
print_status "Backup location: src/idl/forge-crucibles.json.backup"

echo ""
print_status "Next steps:"
echo "1. Verify the IDL includes all new instructions and events"
echo "2. Test the frontend with the new IDL"
echo "3. Update the arbitrageur bot (see docs/ARBITRAGEUR_BOT_UPDATE.md)"
