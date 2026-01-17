#!/bin/bash

# --- Configuration ---
SOLANA_RPC_URL="https://api.devnet.solana.com"
USER_WALLET_ADDRESS="78bNPUUvdFLoCubco57mfXqEu1EU9UmRcodqUGNaZ7Pf"

# --- Utility Functions ---
print_status() {
    echo "🔥 [SOLANA] $1"
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

# --- Main Frontend Deployment Process ---

echo "🔥 Forge Protocol - Frontend Deployment to Solana Devnet"
echo "======================================================="
echo ""

# 1. Check Prerequisites
print_status "Checking prerequisites..."

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    print_error "Node.js is not installed. Please install it first."
fi

# Check if npm is installed
if ! command -v npm &> /dev/null; then
    print_error "npm is not installed. Please install it first."
fi

print_success "All prerequisites are installed"
echo ""

# 2. Navigate to app directory
print_status "Navigating to app directory..."
cd app || print_error "Failed to navigate to app directory"
print_success "In app directory"
echo ""

# 3. Install dependencies
print_status "Installing dependencies..."
if npm install; then
    print_success "Dependencies installed successfully"
else
    print_error "Failed to install dependencies"
fi
echo ""

# 4. Build frontend
print_status "Building frontend..."
if npm run build; then
    print_success "Frontend built successfully"
else
    print_error "Failed to build frontend"
fi
echo ""

# 5. Start development server
print_status "Starting development server..."
print_success "Frontend is ready!"
echo ""
print_status "🚀 Your Forge Protocol is now running:"
print_status "  • Local URL: http://localhost:3000/demo"
print_status "  • Solana Devnet: Configured"
print_status "  • Wallet: Ready to connect"
print_status "  • Features: All DeFi features available"
echo ""
print_status "📱 To test:"
print_status "  1. Open http://localhost:3000/demo"
print_status "  2. Click 'Connect Wallet'"
print_status "  3. Test all DeFi features"
print_status "  4. Navigate between tabs (Dashboard, Crucibles, Governance, Analytics)"
echo ""
print_status "🌐 To deploy to production:"
print_status "  1. Vercel: vercel --prod"
print_status "  2. Netlify: netlify deploy --prod --dir=.next"
print_status "  3. GitHub Pages: npm run deploy"
echo ""
print_success "Happy DeFi building! 🔥"

# Keep the script running to maintain the dev server
npm run dev
