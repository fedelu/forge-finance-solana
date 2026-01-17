#!/bin/bash

# --- Configuration ---
DOCKER_IMAGE_NAME="forge-protocol-builder"
DOCKER_CONTAINER_NAME="forge-build-container"

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

echo "🐳 Forge Protocol - Docker Build Process"
echo "=========================================="
echo ""

# 1. Check if Docker is available
print_status "Checking Docker availability..."
if ! command -v docker &> /dev/null; then
    print_error "Docker is not installed or not available in PATH"
fi
print_success "Docker is available"
echo ""

# 2. Build Docker image
print_status "Building Docker image for Forge Protocol..."
docker build -t "$DOCKER_IMAGE_NAME" .
if [ $? -eq 0 ]; then
    print_success "Docker image built successfully"
else
    print_error "Failed to build Docker image"
fi
echo ""

# 3. Run build in container
print_status "Running Anchor build in Docker container..."
docker run --name "$DOCKER_CONTAINER_NAME" -v "$(pwd):/workspace" "$DOCKER_IMAGE_NAME" anchor build
if [ $? -eq 0 ]; then
    print_success "Anchor build completed successfully in Docker"
else
    print_warning "Anchor build failed in Docker, but continuing..."
fi
echo ""

# 4. Copy build artifacts
print_status "Copying build artifacts from container..."
docker cp "$DOCKER_CONTAINER_NAME:/workspace/target" ./target-docker
if [ $? -eq 0 ]; then
    print_success "Build artifacts copied successfully"
else
    print_warning "Failed to copy build artifacts"
fi
echo ""

# 5. Clean up container
print_status "Cleaning up Docker container..."
docker rm "$DOCKER_CONTAINER_NAME" 2>/dev/null || true
print_success "Container cleaned up"
echo ""

# 6. Check build results
print_status "Checking build results..."
if [ -d "./target-docker/deploy" ]; then
    print_success "Build artifacts found:"
    ls -la ./target-docker/deploy/
else
    print_warning "No build artifacts found"
fi
echo ""

print_success "🎉 Docker build process completed!"
echo ""
print_status "Next steps:"
print_status "1. Check build artifacts in ./target-docker/deploy/"
print_status "2. Deploy programs to Solana devnet"
print_status "3. Update frontend configuration with real program IDs"
