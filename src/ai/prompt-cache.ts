/**
 * Prompt Cache — LRU Cache for System Prompts
 *
 * Caches system prompt text by content hash to enable prompt caching
 * with AI providers that support it (Anthropic cache_control, MiniMax cache_id).
 *
 * Max 50 entries; oldest evicted on overflow.
 *
 * @see Issue #363
 */

import { createHash } from 'node:crypto';
import { logger } from '../core/logger.js';

const log = logger.child({ module: 'prompt-cache' });

const MAX_CACHE_SIZE = 50;

export interface CachedPrompt {
  prompt: string;
  timestamp: number;
}

/** Internal LRU cache: hash → { prompt, timestamp } */
const cache = new Map<string, CachedPrompt>();

/**
 * Compute a SHA-256 hash of the given text, returned as a hex string.
 */
export function hashPrompt(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/**
 * Look up a cached prompt by its hash.
 * Returns the cached entry if found, otherwise undefined.
 * On hit, the entry is refreshed (moved to most-recent position).
 */
export function getCachedPrompt(hash: string): CachedPrompt | undefined {
  const entry = cache.get(hash);
  if (!entry) return undefined;

  // LRU refresh: delete and re-insert to move to end (most recent)
  cache.delete(hash);
  entry.timestamp = Date.now();
  cache.set(hash, entry);

  log.debug({ hash: hash.slice(0, 12) }, 'Prompt cache hit');
  return entry;
}

/**
 * Store a prompt in the cache under the given hash.
 * If the cache exceeds MAX_CACHE_SIZE, the oldest entry is evicted.
 */
export function cachePrompt(hash: string, prompt: string): void {
  // If already present, delete first to refresh position
  if (cache.has(hash)) {
    cache.delete(hash);
  }

  // Evict oldest entry if at capacity
  if (cache.size >= MAX_CACHE_SIZE) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey !== undefined) {
      cache.delete(oldestKey);
      log.debug({ evictedHash: (oldestKey as string).slice(0, 12) }, 'Prompt cache LRU eviction');
    }
  }

  cache.set(hash, { prompt, timestamp: Date.now() });
  log.debug({ hash: hash.slice(0, 12), size: cache.size }, 'Prompt cached');
}

/**
 * Get the current cache size (for diagnostics/testing).
 */
export function getCacheSize(): number {
  return cache.size;
}

/**
 * Clear the entire cache (primarily for testing).
 */
export function clearCache(): void {
  cache.clear();
}

/**
 * Build a system prompt payload with cache_control marker for Anthropic-compatible APIs.
 * If the prompt hash is already cached, the marker signals the provider to reuse cached content.
 *
 * @param systemPrompt - The raw system prompt text
 * @param provider - The AI provider name ('anthropic', 'minimax', etc.)
 * @returns An object suitable for the request's `system` field, with cache_control if applicable
 */
export function buildCachedSystemPrompt(
  systemPrompt: string,
  provider: string,
): string | Array<{ type: 'text'; text: string; cache_control?: { type: 'ephemeral' } }> {
  const hash = hashPrompt(systemPrompt);
  const isCached = getCachedPrompt(hash) !== undefined;

  // Always store/refresh the prompt in the cache
  cachePrompt(hash, systemPrompt);

  // Only Anthropic and MiniMax (Anthropic-compatible) support cache_control
  if (provider === 'anthropic' || provider === 'minimax') {
    return [
      {
        type: 'text' as const,
        text: systemPrompt,
        ...(isCached ? { cache_control: { type: 'ephemeral' as const } } : {}),
      },
    ];
  }

  // Other providers: return the plain string (no caching support)
  return systemPrompt;
}
