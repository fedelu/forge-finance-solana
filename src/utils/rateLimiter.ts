/**
 * Rate limiter utility to prevent 429 errors from RPC endpoints
 */

interface QueuedRequest {
  fn: () => Promise<any>
  resolve: (value: any) => void
  reject: (error: any) => void
  retries: number
}

class RateLimiter {
  private queue: QueuedRequest[] = []
  private processing = false
  private lastRequestTime = 0
  private readonly minDelayMs: number
  private readonly maxRetries: number

  constructor(minDelayMs: number = 200, maxRetries: number = 3) {
    this.minDelayMs = minDelayMs
    this.maxRetries = maxRetries
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.queue.push({
        fn,
        resolve,
        reject,
        retries: 0,
      })
      this.processQueue()
    })
  }

  private async processQueue() {
    if (this.processing || this.queue.length === 0) {
      return
    }

    this.processing = true

    while (this.queue.length > 0) {
      const now = Date.now()
      const timeSinceLastRequest = now - this.lastRequestTime

      if (timeSinceLastRequest < this.minDelayMs) {
        await new Promise(resolve => setTimeout(resolve, this.minDelayMs - timeSinceLastRequest))
      }

      const request = this.queue.shift()!
      this.lastRequestTime = Date.now()

      try {
        const result = await request.fn()
        request.resolve(result)
      } catch (error: any) {
        // Handle 429 errors with exponential backoff
        if (error?.message?.includes('429') || error?.code === 429 || error?.status === 429) {
          if (request.retries < this.maxRetries) {
            request.retries++
            const backoffDelay = Math.min(1000 * Math.pow(2, request.retries), 10000) // Max 10s
            console.warn(`Rate limited (429). Retrying after ${backoffDelay}ms...`)
            
            setTimeout(() => {
              this.queue.unshift(request) // Add back to front of queue
              this.processQueue()
            }, backoffDelay)
          } else {
            request.reject(new Error('Rate limit exceeded. Please try again later.'))
          }
        } else {
          request.reject(error)
        }
      }
    }

    this.processing = false
  }
}

// Global rate limiter instance
export const rpcRateLimiter = new RateLimiter(200, 3)

/**
 * Wrap an RPC call with rate limiting
 */
export async function rateLimitedRpcCall<T>(fn: () => Promise<T>): Promise<T> {
  return rpcRateLimiter.execute(fn)
}
