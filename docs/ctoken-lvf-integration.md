# cToken & LVF Integration Guide

## Overview

This document describes the new cToken minting/burning and Leveraged Volatility Farming (LVF) functionality that has been added to the Forge Protocol.

## What's New

### 1. Smart Contract Extensions

**File: `programs/forge-crucibles/src/ctoken.rs`**

Added Anchor program functions:
- `mint_ctoken`: Mints cTokens when users deposit base tokens (SOL/FORGE)
- `burn_ctoken`: Burns cTokens and returns base tokens plus accrued yield

**Key Features:**
- Exchange rate tracking (1 cToken = vault_amount / ctoken_supply)
- Yield accrual through exchange rate growth
- Fee distribution (80% to holders, 20% to treasury) via exchange rate
- SVM/Anchor-compatible implementation

### 2. Frontend Hooks

**File: `src/hooks/useCToken.ts`**

React hook for managing cToken operations:
- Balance fetching
- Deposit/withdraw functions
- Leverage position management
- Effective APY calculations

### 3. UI Components

**New Components:**
- `LeverageControl.tsx`: Leverage slider (1x-3x) with risk meter
- `CTokenDepositModal.tsx`: Deposit modal with leverage options
- `CTokenWithdrawModal.tsx`: Withdraw modal showing exchange rate
- `CTokenPortfolio.tsx`: Portfolio view showing all cToken positions
- `LeveragedProjectionChart.tsx`: Yield visualization with leverage projections

### 4. Integration Steps

#### Step 1: Update CrucibleManager

Add to your existing `CrucibleManager.tsx`:

```tsx
import CTokenDepositModal from '../components/CTokenDepositModal'
import CTokenWithdrawModal from '../components/CTokenWithdrawModal'
import LeveragedProjectionChart from '../components/LeveragedProjectionChart'
import { useCToken } from '../hooks/useCToken'

// Inside your crucible card component:
const { balance, leverage, deposit, withdraw } = useCToken(crucible.address, crucible.ctokenMint)
const [showDeposit, setShowDeposit] = useState(false)
const [showWithdraw, setShowWithdraw] = useState(false)
const [selectedLeverage, setSelectedLeverage] = useState(1.0)

// Add buttons:
<button onClick={() => setShowDeposit(true)}>
  Open Position
</button>
<button onClick={() => setShowWithdraw(true)}>
  Close Position
</button>

// Add modals:
<CTokenDepositModal
  isOpen={showDeposit}
  onClose={() => setShowDeposit(false)}
  crucibleAddress={crucible.address}
  ctokenMint={crucible.ctokenMint}
  baseTokenSymbol="FORGE"
  ctokenSymbol="cFORGE"
  currentAPY={crucible.apy}
/>

// Replace existing yield visualization:
<LeveragedProjectionChart
  baseAPY={crucible.apy}
  leverage={selectedLeverage}
  currentPrice={crucible.price}
  currentExchangeRate={balance?.exchangeRate || 1.0}
/>
```

#### Step 2: Update Portfolio Page

Replace the existing portfolio with:

```tsx
import CTokenPortfolio from '../components/CTokenPortfolio'

// In your analytics/portfolio tab:
<CTokenPortfolio />
```

#### Step 3: Build & Deploy Programs

```bash
# Build the updated crucibles program
cd programs/forge-crucibles
anchor build

# Deploy to devnet/testnet
anchor deploy --provider.cluster devnet
```

#### Step 4: Update Frontend Configuration

Add crucible addresses and cToken mints to your config:

```typescript
// src/config/crucibles.ts
export const crucibles = [
  {
    address: 'YOUR_CRUCIBLE_ADDRESS',
    ctokenMint: 'YOUR_CTOKEN_MINT',
    baseTokenSymbol: 'FORGE',
    ctokenSymbol: 'cFORGE',
    baseMint: 'YOUR_BASE_MINT',
  },
  // ... more crucibles
]
```

## Usage Flow

### Opening a Position (Deposit)

1. User clicks "Open Position" on a Crucible card
2. Modal opens showing:
   - Amount input (base token)
   - Leverage slider (1x-3x)
   - Risk meter
   - Preview (cTokens to receive, exchange rate, effective APY)
3. User selects leverage (optional)
4. Transaction mints cTokens to user's wallet

### Closing a Position (Withdraw)

1. User clicks "Close Position" or "Manage" from portfolio
2. Modal opens showing:
   - Current cToken balance
   - Exchange rate (may have increased with yield)
   - Estimated base tokens to receive
3. User enters amount to withdraw
4. Transaction burns cTokens and returns base tokens + yield

### Leveraged Positions

- When leverage > 1x, user borrows additional liquidity (simulated off-chain for now)
- Effective APY = Base APY × Leverage - Borrow Cost
- Risk meter visualizes position risk (green → red)
- Projection charts show both base and leveraged scenarios

## Exchange Rate Calculation

```
Exchange Rate = Vault Amount / cToken Supply

As fees accrue and are distributed:
- Vault Amount increases
- cToken Supply stays constant (unless new deposits)
- Exchange Rate increases = Yield earned
```

## Leverage Risk Levels

- **1x - 1.5x**: Low risk (green)
- **1.5x - 2x**: Medium risk (yellow)
- **2x - 2.5x**: High risk (orange)
- **2.5x - 3x**: Critical risk (red)

## Next Steps

1. **On-chain Integration**: Connect frontend to deployed Anchor programs
2. **Lending Pool**: Implement real borrowing logic (currently simulated)
3. **Price Feeds**: Integrate oracles for accurate exchange rates
4. **Fee Distribution**: Implement automatic fee accrual and distribution
5. **Event Indexing**: Set up indexer for real-time balance updates

## Testing

Test the new functionality:

```bash
# Unit tests (when implemented)
anchor test

# Frontend development
yarn dev

# Navigate to:
# - /demo - See crucibles with new CTAs
# - Portfolio tab - See cToken balances
```

## Notes

- Exchange rates are calculated on-chain for accuracy
- Leverage borrowing is currently simulated (off-chain mock)
- All UI maintains existing Forge branding (dark theme, orange accents)
- Components are fully typed with TypeScript
- Error handling and loading states included

