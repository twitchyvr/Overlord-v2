/**
 * Rate Limiter — Token Bucket per AI Provider
 *
 * Simple token bucket rate limiter that enforces a configurable
 * requests-per-minute (RPM) limit per provider. The bucket refills
 * at a constant rate; callers wait if no tokens are available.
 *
 * @see Issue #381
 */

import { logger } from '../core/logger.js';

const log = logger.child({ module: 'rate-limiter' });

interface Bucket {
  tokens: number;
  maxTokens: number;
  lastRefill: number;
  refillRate: number; // tokens per millisecond
  waitQueue: Array<() => void>;
}

/** One bucket per provider */
const buckets = new Map<string, Bucket>();

/** Default RPM used when no config override is provided */
let defaultRpm = 60;

/**
 * Configure the default requests-per-minute limit.
 * Call this once during initialization.
 */
export function configureRateLimit(rpm: number): void {
  defaultRpm = rpm;
  log.info({ rpm }, 'Rate limiter configured');
}

/**
 * Get or create a token bucket for the given provider.
 */
function getBucket(provider: string): Bucket {
  let bucket = buckets.get(provider);
  if (!bucket) {
    const maxTokens = defaultRpm;
    bucket = {
      tokens: maxTokens,
      maxTokens,
      lastRefill: Date.now(),
      refillRate: maxTokens / 60_000, // tokens per ms
      waitQueue: [],
    };
    buckets.set(provider, bucket);
    log.debug({ provider, maxTokens }, 'Created rate limit bucket');
  }
  return bucket;
}

/**
 * Refill a bucket based on elapsed time since last refill.
 */
function refillBucket(bucket: Bucket): void {
  const now = Date.now();
  const elapsed = now - bucket.lastRefill;
  if (elapsed <= 0) return;

  const newTokens = elapsed * bucket.refillRate;
  bucket.tokens = Math.min(bucket.maxTokens, bucket.tokens + newTokens);
  bucket.lastRefill = now;
}

/**
 * Acquire a slot (token) for the given provider.
 * Resolves immediately if a token is available; otherwise waits
 * until a token becomes available through refill or release.
 */
export async function acquireSlot(provider: string): Promise<void> {
  const bucket = getBucket(provider);
  refillBucket(bucket);

  if (bucket.tokens >= 1) {
    bucket.tokens -= 1;
    log.debug({ provider, remainingTokens: Math.floor(bucket.tokens) }, 'Rate limit slot acquired');
    return;
  }

  // No tokens available — calculate wait time for 1 token
  const waitMs = Math.ceil((1 - bucket.tokens) / bucket.refillRate);
  log.info({ provider, waitMs }, 'Rate limit reached, waiting for slot');

  return new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      refillBucket(bucket);
      bucket.tokens = Math.max(0, bucket.tokens - 1);
      // Process next waiter if any
      const nextWaiter = bucket.waitQueue.shift();
      if (nextWaiter) nextWaiter();
      resolve();
    }, waitMs);

    // Store the resolve callback so releaseSlot can drain the queue
    bucket.waitQueue.push(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}

/**
 * Release a slot back to the provider's bucket.
 * If there are waiters in the queue, the first one is drained immediately.
 */
export function releaseSlot(provider: string): void {
  const bucket = getBucket(provider);

  // If there's a waiter, drain it immediately instead of adding a token
  const waiter = bucket.waitQueue.shift();
  if (waiter) {
    log.debug({ provider }, 'Rate limit slot released to waiter');
    waiter();
    return;
  }

  // No waiters — add the token back
  bucket.tokens = Math.min(bucket.maxTokens, bucket.tokens + 1);
  log.debug({ provider, remainingTokens: Math.floor(bucket.tokens) }, 'Rate limit slot released');
}

/**
 * Reset all buckets (primarily for testing).
 */
export function resetBuckets(): void {
  buckets.clear();
}

/**
 * Get current bucket info for diagnostics.
 */
export function getBucketInfo(provider: string): { tokens: number; maxTokens: number; queueLength: number } | null {
  const bucket = buckets.get(provider);
  if (!bucket) return null;
  refillBucket(bucket);
  return {
    tokens: Math.floor(bucket.tokens),
    maxTokens: bucket.maxTokens,
    queueLength: bucket.waitQueue.length,
  };
}
