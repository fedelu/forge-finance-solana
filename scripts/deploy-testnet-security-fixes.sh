#!/bin/bash

# Testnet Deployment Script for Security Fixes
# Deploys all programs with security fixes to Solana testnet

set -e

echo "🔥 Deploying Forge Protocol with Security Fixes to Testnet"
echo "=========================================================="

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Check prerequisites
if ! command -v solana &> /dev/null; then
    echo -e "${RED}Error: Solana CLI not found${NC}"
    exit 1
fi

if ! command -v anchor &> /dev/null; then
    echo -e "${RED}Error: Anchor CLI not found${NC}"
    exit 1
fi

# Set testnet
echo -e "${BLUE}Setting cluster to testnet...${NC}"
solana config set --url https://api.testnet.solana.com

# Get wallet info
WALLET=$(solana address)
BALANCE=$(solana balance | awk '{print $1}')

echo -e "${GREEN}Wallet: $WALLET${NC}"
echo -e "${GREEN}Balance: $BALANCE SOL${NC}"

# Check balance
if (( $(echo "$BALANCE < 5" | bc -l 2>/dev/null || echo "0") )); then
    echo -e "${YELLOW}⚠️  Low balance. Need at least 5 SOL for deployment.${NC}"
    echo -e "${YELLOW}Requesting airdrop...${NC}"
    solana airdrop 5 || {
        echo -e "${RED}❌ Airdrop failed. Please get testnet SOL manually:${NC}"
        echo "   https://faucet.solana.com/"
        echo "   Or use: solana airdrop 5 --url https://api.testnet.solana.com"
        exit 1
    }
    sleep 3
    BALANCE=$(solana balance | awk '{print $1}')
    echo -e "${GREEN}New Balance: $BALANCE SOL${NC}"
fi

# Build programs
echo -e "${BLUE}Building programs...${NC}"
if ! anchor build; then
    echo -e "${RED}❌ Build failed${NC}"
    exit 1
fi
echo -e "${GREEN}✅ Build successful${NC}"

# Deploy programs
echo -e "${BLUE}Deploying programs to testnet...${NC}"

# 1. Forge Core
echo -e "${YELLOW}Deploying forge-core...${NC}"
anchor deploy --program-name forge_core --provider.cluster testnet || {
    echo -e "${YELLOW}⚠️  forge-core deployment failed or already deployed${NC}"
}

# 2. Forge Crucibles
echo -e "${YELLOW}Deploying forge-crucibles...${NC}"
anchor deploy --program-name forge_crucibles --provider.cluster testnet || {
    echo -e "${YELLOW}⚠️  forge-crucibles deployment failed or already deployed${NC}"
}

# 3. Lending
echo -e "${YELLOW}Deploying lending...${NC}"
anchor deploy --program-name lending --provider.cluster testnet || {
    echo -e "${YELLOW}⚠️  lending deployment failed or already deployed${NC}"
}

# 4. Lending Pool
echo -e "${YELLOW}Deploying lending-pool...${NC}"
anchor deploy --program-name lending_pool --provider.cluster testnet || {
    echo -e "${YELLOW}⚠️  lending-pool deployment failed or already deployed${NC}"
}

# 5. LVF
echo -e "${YELLOW}Deploying lvf...${NC}"
anchor deploy --program-name lvf --provider.cluster testnet || {
    echo -e "${YELLOW}⚠️  lvf deployment failed or already deployed${NC}"
}

echo -e "${GREEN}✅ Deployment process completed${NC}"

# Verify deployments
echo -e "${BLUE}Verifying deployments...${NC}"
echo -e "${YELLOW}Program IDs from Anchor.toml:${NC}"
grep -A 5 "\[programs.testnet\]" Anchor.toml | grep -v "^\[" | grep "=" | while read line; do
    PROG_NAME=$(echo $line | cut -d'=' -f1 | xargs)
    PROG_ID=$(echo $line | cut -d'=' -f2 | xargs | tr -d '"')
    echo -e "  ${GREEN}$PROG_NAME: $PROG_ID${NC}"
    solana program show "$PROG_ID" 2>/dev/null && echo -e "    ✅ Deployed" || echo -e "    ⚠️  Not found"
done

echo ""
echo -e "${GREEN}🎉 Deployment Summary${NC}"
echo "================================"
echo -e "${BLUE}Next steps:${NC}"
echo "1. Update IDL files if program IDs changed"
echo "2. Initialize markets: ts-node scripts/init-lending-pool.ts"
echo "3. Initialize crucibles: ts-node scripts/init-sol-crucible.ts"
echo "4. Run tests: anchor test --provider.cluster testnet"
echo ""
echo -e "${YELLOW}See TESTNET_DEPLOYMENT_CHECKLIST.md for detailed steps${NC}"
