# 🔥 Forge Finance - Solana DeFi Protocol

A comprehensive DeFi protocol built on Solana, featuring token wrapping (cTokens), leveraged positions, lending pools, and yield farming capabilities.

## 🚀 Features

### 🏦 **Token Wrapping (cTokens)**
- Wrap SOL tokens into yield-bearing cTokens (cSOL)
- Earn APY through exchange rate appreciation
- Real-time balance tracking and portfolio management
- Seamless wrap/unwrap operations

### 💰 **Leveraged Positions (LVF)**
- Create leveraged liquidity positions up to 2x
- Borrow USDC from lending pool to amplify positions
- Health factor monitoring and risk management
- Partial position closing support

### 🏛️ **Lending Pool**
- Supply USDC to earn lending yields
- Borrow USDC for leveraged positions
- Dynamic interest rates (5% APY borrowing)
- Real-time collateralization tracking

### 📊 **Portfolio & Analytics**
- Comprehensive portfolio dashboard
- Transaction history with detailed analytics
- Real-time APY earnings tracking
- Performance metrics and insights

## 🛠️ **Technology Stack**

### **Frontend**
- **Next.js 14** - React framework
- **TypeScript** - Type safety
- **Tailwind CSS** - Styling
- **Heroicons** - Icons
- **Framer Motion** - Animations

### **Blockchain**
- **Solana Devnet** - Solana test network for development
- **Solana Web3.js** - Blockchain interaction
- **Phantom Wallet** - Primary wallet support

### **Smart Contracts**
- **forge-core** - Main protocol registry
- **forge-crucibles** - Token wrapping and LP position management
  - cToken minting and burning
  - LP position tracking
  - Leveraged position management (LVF)
- **lending** - Lending pool operations
- **lending-pool** - USDC lending and borrowing
- **lvf** - Leveraged Volatility Farming positions

## 🚀 **Quick Start**

### **Prerequisites**
- Node.js 18+
- Solana CLI
- Anchor CLI
- Git

### **Installation**

```bash
# Clone the repository
git clone https://github.com/YOUR_USERNAME/forge-finance.git
cd forge-finance

# Install dependencies
npm install

# Start development server
npm run dev
```

**Note**: The project structure uses `src/` directory instead of `app/` for the frontend.

### **Environment Setup**

Create `.env.local` in the root directory:

```env
NEXT_PUBLIC_SOLANA_NETWORK=devnet
NEXT_PUBLIC_RPC_URL=https://api.devnet.solana.com
NEXT_PUBLIC_COMMITMENT=confirmed
NEXT_PUBLIC_APP_DOMAIN=http://localhost:3000
```

## 🔧 **Development**

### **Build Smart Contracts**

```bash
# Build all programs
anchor build

# Deploy to Solana devnet
anchor deploy --provider.cluster devnet
```

### **Run Frontend**

```bash
npm run dev
```

The development server will start on `http://localhost:3000`

### **Test**

```bash
# Run smart contract tests
anchor test

# Run frontend tests
cd app
npm test
```

## 📱 **Usage**

### **For Users**

1. **Connect Wallet**
   - Install Phantom wallet
   - Connect to Solana devnet
   - Get devnet SOL and SPL tokens from a Solana devnet faucet

2. **Wrap Tokens**
   - Navigate to the main dashboard
   - Select SOL or FORGE token
   - Enter amount to wrap
   - Confirm transaction to receive cTokens

3. **Create Leveraged Positions**
   - Select a token pair (cSOL/USDC or cFORGE/USDC)
   - Choose leverage multiplier (1.5x or 2x)
   - Deposit collateral and borrow USDC
   - Monitor health factor

4. **Supply to Lending Pool**
   - Supply USDC to earn lending yields
   - Borrow USDC for leveraged positions
   - Track your lending position in portfolio

5. **View Analytics**
   - Track portfolio performance
   - View transaction history
   - Monitor APY earnings

### **For Developers**

1. **Smart Contract Development**
   - Modify programs in `programs/`
   - Update IDL files in `src/idl/`
   - Deploy with `anchor deploy`

2. **Frontend Development**
   - Update components in `src/components/`
   - Modify pages in `src/pages/`
   - Update contexts in `src/contexts/`
   - Add new hooks in `src/hooks/`

3. **Integration**
   - Connect new wallets via `src/contexts/WalletContext.tsx`
   - Add new token types in `src/config/solana-testnet.ts`
   - Extend functionality with custom hooks

## 🏗️ **Architecture**

```
forge-finance/
├── programs/              # Anchor smart contracts
│   ├── forge-core/        # Main protocol registry
│   ├── forge-crucibles/   # Token wrapping & LP positions
│   ├── lending/           # Lending pool operations
│   ├── lending-pool/      # USDC lending/borrowing
│   └── lvf/               # Leveraged positions
├── src/                   # Next.js frontend
│   ├── components/        # React components
│   ├── contexts/          # State management (Balance, Crucible, Analytics)
│   ├── pages/             # Next.js pages
│   ├── hooks/             # Custom React hooks
│   ├── utils/             # Utility functions
│   └── config/            # Configuration files
├── sdk/                   # TypeScript SDK
├── scripts/               # Deployment scripts
└── docs/                  # Documentation
```

## 🔒 **Security**

- **Smart Contract Audits**: Regular security reviews
- **Firewall Protection**: Multi-layer security
- **Access Controls**: Role-based permissions
- **Input Validation**: Comprehensive checks

## 🌐 **Deployment**

### **Vercel (Recommended)**

1. Connect GitHub repository to Vercel
2. Configure build settings:
   - Root Directory: `app`
   - Build Command: `npm run build`
   - Output Directory: `.next`
3. Deploy automatically

### **Other Platforms**

- **Netlify**: Static site hosting
- **GitHub Pages**: Free hosting
- **Firebase**: Google Cloud hosting

## 📊 **Analytics**

- **Transaction Tracking**: Real-time monitoring
- **Performance Metrics**: Yield and volume data
- **User Analytics**: Engagement statistics
- **Protocol Health**: System status

## 🤝 **Contributing**

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests
5. Submit a pull request

## 📄 **License**

MIT License - see [LICENSE](LICENSE) file for details.

## 📚 **Documentation**

- **[Deployment Status](docs/DEPLOYMENT_STATUS.md)** - Current smart contract deployment status and missing features
- **[cToken-LVF Integration](docs/ctoken-lvf-integration.md)** - Technical documentation on cToken and leveraged position integration
- **[Lending-LVF Architecture](docs/lending-lvf-architecture.md)** - Architecture documentation for lending and leveraged positions
- **[MVP Documentation](docs/mvp-pfogo-pusdc.md)** - MVP feature documentation

## 🔗 **Links**

- **Solana Explorer**: [explorer.solana.com](https://explorer.solana.com)
- **Solana Devnet**: [api.devnet.solana.com](https://api.devnet.solana.com)

## 🙏 **Acknowledgments**

- Solana Foundation for the blockchain infrastructure
- Anchor team for the development framework
- Vercel for hosting and deployment
- Open source community for inspiration

---

**Built with ❤️ for the Solana DeFi ecosystem**