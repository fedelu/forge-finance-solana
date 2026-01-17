#!/bin/bash

# --- Configuration ---
SOLANA_IMAGE="solanalabs/solana:v1.17.0"
ANCHOR_IMAGE="coral-xyz/anchor:0.30.1"

# --- Utility Functions ---
print_status() {
    echo "🐳 [DOCKER] $1"
}

print_success() {
    echo "✅ [SUCCESS] $1"
}

print_warning() {
    echo "⚠️  [WARNING] $1"
}

print_error() {
    echo "❌ [ERROR] $1"
    exit 1
}

# --- Main Docker Build Process ---

echo "🐳 Forge Protocol - Solana Docker Build"
echo "========================================"
echo ""

# 1. Check if Docker is available
print_status "Checking Docker availability..."
if ! command -v docker &> /dev/null; then
    print_error "Docker is not installed or not available in PATH"
fi
print_success "Docker is available"
echo ""

# 2. Pull Solana Docker image
print_status "Pulling Solana Docker image..."
docker pull "$SOLANA_IMAGE"
if [ $? -eq 0 ]; then
    print_success "Solana Docker image pulled successfully"
else
    print_warning "Failed to pull Solana Docker image, trying to use local image"
fi
echo ""

# 3. Run build with Solana Docker image
print_status "Running build with Solana Docker image..."
docker run --rm -v "$(pwd):/workspace" -w /workspace "$SOLANA_IMAGE" bash -c "
    # Install Anchor
    cargo install --git https://github.com/coral-xyz/anchor avm --locked --force
    avm install 0.30.1
    avm use 0.30.1
    
    # Build the project
    anchor build
"
if [ $? -eq 0 ]; then
    print_success "Build completed successfully with Solana Docker"
else
    print_warning "Build failed with Solana Docker, trying alternative approach"
fi
echo ""

# 4. Alternative: Try with Anchor Docker image
print_status "Trying alternative build with Anchor Docker image..."
docker run --rm -v "$(pwd):/workspace" -w /workspace "$ANCHOR_IMAGE" anchor build
if [ $? -eq 0 ]; then
    print_success "Build completed successfully with Anchor Docker"
else
    print_warning "Build failed with Anchor Docker as well"
fi
echo ""

# 5. Check build results
print_status "Checking build results..."
if [ -d "./target/deploy" ]; then
    print_success "Build artifacts found:"
    ls -la ./target/deploy/
else
    print_warning "No build artifacts found"
fi
echo ""

print_success "🎉 Docker build process completed!"
echo ""
print_status "Next steps:"
print_status "1. Check build artifacts in ./target/deploy/"
print_status "2. Deploy programs to Solana devnet"
print_status "3. Update frontend configuration with real program IDs"
