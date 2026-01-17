// Summary: BigInt-safe helpers for utilization and APY math
// Note: Exchange rate RATE_SCALE is 1e6 (in math.ts), but utilization uses 1e9 for precision

export const UTILIZATION_SCALE = 1_000_000_000n // 9 decimal places for utilization calculations
export const RATE_SCALE = 1_000_000n // 6 decimal places - matches on-chain exchange_rate

export function toBigIntAmount(amount: string, decimals: number): bigint {
  const [whole, frac = ''] = amount.split('.')
  const fracPadded = (frac + '0'.repeat(decimals)).slice(0, decimals)
  return BigInt(whole) * BigInt(10) ** BigInt(decimals) + BigInt(fracPadded || '0')
}

export function fromBigIntAmount(amount: bigint, decimals: number): string {
  const d = BigInt(10) ** BigInt(decimals)
  const whole = amount / d
  const frac = amount % d
  const fracStr = frac.toString().padStart(decimals, '0').replace(/0+$/, '')
  return fracStr.length ? `${whole.toString()}.${fracStr}` : whole.toString()
}

export function computeUtilization(totalBorrowed: bigint, totalSupply: bigint): bigint {
  if (totalSupply === 0n) return 0n
  return (totalBorrowed * UTILIZATION_SCALE) / totalSupply
}


