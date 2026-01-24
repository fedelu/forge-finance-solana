/**
 * Oracle service for fetching token prices from CoinGecko
 * Implements rate limiting and caching to respect CoinGecko's 50 calls/min limit
 */

const CACHE_TTL = 60000; // 60 seconds cache
const PYTH_CACHE_TTL = 60000; // 60 seconds cache for Pyth feeds
const MIN_REQUEST_INTERVAL = 1200; // 50 calls/min = 1200ms between calls (conservative)

interface PriceCache {
  price: number;
  timestamp: number;
}

// In-memory cache for SOL price
let solPriceCache: PriceCache | null = null;
let lastRequestTime: number = 0;
const pythPriceCache = new Map<string, PriceCache>();

function parsePythPrice(accountData: Uint8Array): number {
  const MIN_REQUIRED_SIZE = 132;
  if (accountData.length < MIN_REQUIRED_SIZE) {
    throw new Error('Invalid Pyth price account data');
  }

  const PRICE_OFFSET = 96;
  const EXPO_OFFSET = 104;

  const view = new DataView(accountData.buffer, accountData.byteOffset, accountData.byteLength);
  const price = Number(view.getBigInt64(PRICE_OFFSET, true));
  const expo = view.getInt32(EXPO_OFFSET, true);

  if (!Number.isFinite(price)) {
    throw new Error('Invalid price value');
  }

  const scale = Math.pow(10, Math.abs(expo));
  const priceUsd = expo >= 0 ? price * scale : price / scale;

  if (!Number.isFinite(priceUsd) || priceUsd <= 0) {
    throw new Error('Invalid price data');
  }

  return priceUsd;
}

export async function fetchPythPrice(
  connection: import('@solana/web3.js').Connection,
  priceAccount: import('@solana/web3.js').PublicKey
): Promise<number> {
  const accountInfo = await connection.getAccountInfo(priceAccount);
  if (!accountInfo?.data) {
    throw new Error('Price account not found');
  }

  return parsePythPrice(accountInfo.data);
}

export async function getCachedPythPrice(
  connection: import('@solana/web3.js').Connection,
  priceAccount: import('@solana/web3.js').PublicKey
): Promise<number> {
  const cacheKey = priceAccount.toBase58();
  const now = Date.now();
  const cached = pythPriceCache.get(cacheKey);

  if (cached && (now - cached.timestamp) < PYTH_CACHE_TTL) {
    return cached.price;
  }

  const price = await fetchPythPrice(connection, priceAccount);
  pythPriceCache.set(cacheKey, { price, timestamp: now });
  return price;
}

/**
 * Fetch current SOL/USD price from CoinGecko
 * @returns SOL price in USD
 */
export async function fetchSolPriceFromCoinGecko(): Promise<number> {
  const now = Date.now();
  
  // Rate limiting: ensure minimum interval between requests
  const timeSinceLastRequest = now - lastRequestTime;
  if (timeSinceLastRequest < MIN_REQUEST_INTERVAL) {
    const waitTime = MIN_REQUEST_INTERVAL - timeSinceLastRequest;
    await new Promise(resolve => setTimeout(resolve, waitTime));
  }
  
  try {
    lastRequestTime = Date.now();
    
    const response = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd'
    );
    
    if (!response.ok) {
      throw new Error(`CoinGecko API error: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json();
    const price = data.solana?.usd;
    
    if (!price || typeof price !== 'number' || price <= 0) {
      throw new Error('Invalid price data from CoinGecko');
    }
    
    // Update cache
    solPriceCache = {
      price,
      timestamp: Date.now(),
    };
    
    return price;
  } catch (error: any) {
    console.warn('⚠️ Failed to fetch SOL price from CoinGecko:', error.message);
    throw error;
  }
}

/**
 * Get cached SOL price if still valid, otherwise fetch new price
 * @returns SOL price in USD
 */
export async function getCachedSolPrice(): Promise<number> {
  const now = Date.now();
  
  // Return cached price if still valid
  if (solPriceCache && (now - solPriceCache.timestamp) < CACHE_TTL) {
    return solPriceCache.price;
  }
  
  // Cache expired or doesn't exist - fetch new price
  try {
    return await fetchSolPriceFromCoinGecko();
  } catch (error) {
    // If fetch fails, return cached price if available (even if expired)
    if (solPriceCache) {
      console.warn('⚠️ Using expired cached SOL price due to fetch failure');
      return solPriceCache.price;
    }
    
    // No cache available - throw error (caller should handle fallback)
    throw new Error('No cached price available and fetch failed');
  }
}

/**
 * Get current SOL price (synchronous - returns cached value or fallback)
 * Use this for non-critical reads where async is not practical
 * @param fallback - Fallback price if cache is not available (default: 200)
 * @returns SOL price in USD
 */
export function getSolPriceSync(fallback: number = 200): number {
  if (solPriceCache) {
    return solPriceCache.price;
  }
  return fallback;
}
