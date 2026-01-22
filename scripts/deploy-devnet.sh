#!/bin/bash
# Deploy all Forge Finance programs to Solana Devnet
# Requires: ~6 SOL in wallet for buffer accounts

set -e

echo "🚀 Deploying Forge Finance programs to Devnet..."
echo ""

# Check balance
BALANCE=$(solana balance --url devnet | awk '{print $1}')
echo "Current balance: $BALANCE SOL"
echo ""

# Check if we have enough SOL (need ~6 SOL for all buffers)
REQUIRED_SOL=6
if (( $(echo "$BALANCE < $REQUIRED_SOL" | bc -l) )); then
    echo "⚠️  Warning: Insufficient balance. Need at least $REQUIRED_SOL SOL for deployment."
    echo "   Current balance: $BALANCE SOL"
    echo "   Requesting airdrop..."
    solana airdrop 5 --url devnet || echo "Airdrop failed - please get SOL from faucet"
    sleep 5
fi

cd "$(dirname "$0")/.."

echo "📦 Building programs..."
anchor build

echo ""
echo "🔷 Deploying forge_core..."
solana program deploy \
    --program-id target/deploy/forge_core-keypair.json \
    target/deploy/forge_core.so \
    --url devnet \
    --max-sign-attempts 3

echo ""
echo "🔷 Deploying forge_crucibles..."
BUFFER_CRUCIBLES=$(solana program write-buffer target/deploy/forge_crucibles.so --url devnet 2>&1 | grep "Buffer" | awk '{print $3}')
solana program deploy \
    --program-id target/deploy/forge_crucibles-keypair.json \
    --buffer "$BUFFER_CRUCIBLES" \
    --url devnet \
    --max-sign-attempts 3

echo ""
echo "🔷 Deploying lending..."
BUFFER_LENDING=$(solana program write-buffer target/deploy/lending.so --url devnet 2>&1 | grep "Buffer" | awk '{print $3}')
solana program deploy \
    --program-id target/deploy/lending-keypair.json \
    --buffer "$BUFFER_LENDING" \
    --url devnet \
    --max-sign-attempts 3

echo ""
echo "🔷 Deploying lending_pool_usdc..."
BUFFER_LENDING_POOL=$(solana program write-buffer target/deploy/lending_pool_usdc.so --url devnet 2>&1 | grep "Buffer" | awk '{print $3}')
solana program deploy \
    --program-id target/deploy/lending_pool_usdc-keypair.json \
    --buffer "$BUFFER_LENDING_POOL" \
    --url devnet \
    --max-sign-attempts 3

echo ""
echo "🔷 Deploying lvf..."
solana program deploy \
    --program-id target/deploy/lvf-keypair.json \
    target/deploy/lvf.so \
    --url devnet \
    --max-sign-attempts 3

echo ""
echo "✅ Deployment complete!"
echo ""
echo "Program IDs:"
echo "  forge_core:        CtR5tkwzpUmyxMNnihkPdSZzVk5fws1LumXXGyU4phJa"
echo "  forge_crucibles:   B9qek9NaR3xmBro8pdxixaA2SHzDUExB5KaBt9Kb4fry"
echo "  lending:           BeJW4TrT31GWgW5wpLeYS4tFiCQquHd5bHcfYrPykErs"
echo "  lending_pool:      3UPgC2UJ6odJwWPBqDEx19ycL5ccuS3mbF1pt5SU39dx"
echo "  lvf:               DNV9nTmTztTaufsdKQd3WW1vfaKHMB5uiGzWRXD3AgYd"
echo ""
echo "Verifying deployments..."
for prog in "CtR5tkwzpUmyxMNnihkPdSZzVk5fws1LumXXGyU4phJa" "B9qek9NaR3xmBro8pdxixaA2SHzDUExB5KaBt9Kb4fry" "BeJW4TrT31GWgW5wpLeYS4tFiCQquHd5bHcfYrPykErs" "3UPgC2UJ6odJwWPBqDEx19ycL5ccuS3mbF1pt5SU39dx" "DNV9nTmTztTaufsdKQd3WW1vfaKHMB5uiGzWRXD3AgYd"; do
    if solana program show "$prog" --url devnet > /dev/null 2>&1; then
        echo "  ✅ $prog - Deployed"
    else
        echo "  ❌ $prog - Not found"
    fi
done
