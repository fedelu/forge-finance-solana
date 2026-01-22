#!/bin/bash
# Auto-deploy script that waits for sufficient balance then deploys

set -e

echo "🔍 Monitoring balance and waiting for sufficient SOL..."
echo "Wallet: 5R7DQ1baJiYoi4GdVu1hTwBZMHxqabDenzaLVA9V7wV3"
echo "Required: ~6 SOL"
echo ""

while true; do
    BALANCE=$(solana balance --url devnet 2>/dev/null | awk '{print $1}')
    echo "Current balance: $BALANCE SOL"
    
    if (( $(echo "$BALANCE >= 6" | bc -l 2>/dev/null || echo "0") )); then
        echo "✅ Sufficient balance detected! Starting deployment..."
        echo ""
        
        # Deploy forge_crucibles
        echo "🔷 Deploying forge_crucibles..."
        BUFFER=$(solana program write-buffer target/deploy/forge_crucibles.so --url devnet 2>&1 | grep "Buffer" | awk '{print $3}')
        if [ ! -z "$BUFFER" ]; then
            solana program deploy --program-id target/deploy/forge_crucibles-keypair.json --buffer $BUFFER --url devnet --max-sign-attempts 3
            echo "✅ forge_crucibles deployed"
        fi
        
        # Deploy lending
        echo "🔷 Deploying lending..."
        BUFFER=$(solana program write-buffer target/deploy/lending.so --url devnet 2>&1 | grep "Buffer" | awk '{print $3}')
        if [ ! -z "$BUFFER" ]; then
            solana program deploy --program-id target/deploy/lending-keypair.json --buffer $BUFFER --url devnet --max-sign-attempts 3
            echo "✅ lending deployed"
        fi
        
        # Deploy lending_pool_usdc
        echo "🔷 Deploying lending_pool_usdc..."
        BUFFER=$(solana program write-buffer target/deploy/lending_pool_usdc.so --url devnet 2>&1 | grep "Buffer" | awk '{print $3}')
        if [ ! -z "$BUFFER" ]; then
            solana program deploy --program-id target/deploy/lending_pool_usdc-keypair.json --buffer $BUFFER --url devnet --max-sign-attempts 3
            echo "✅ lending_pool_usdc deployed"
        fi
        
        echo ""
        echo "✅ All programs deployed successfully!"
        break
    else
        echo "⏳ Waiting for SOL... (checking again in 5 seconds)"
        sleep 5
    fi
done
