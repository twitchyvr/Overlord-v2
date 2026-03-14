/**
 * Rate Limiter Tests
 *
 * Tests token bucket behavior: acquire/release, rate limiting,
 * bucket creation, and diagnostics.
 *
 * @see Issue #381
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  acquireSlot,
  releaseSlot,
  resetBuckets,
  configureRateLimit,
  getBucketInfo,
} from '../../../src/ai/rate-limiter.js';

describe('Rate Limiter', () => {
  beforeEach(() => {
    resetBuckets();
    configureRateLimit(60); // 60 RPM default
  });

  describe('acquireSlot', () => {
    it('acquires a slot immediately when tokens are available', async () => {
      await acquireSlot('anthropic');
      const info = getBucketInfo('anthropic');
      expect(info).not.toBeNull();
      expect(info!.tokens).toBe(59); // 60 - 1
    });

    it('creates a new bucket on first call for a provider', async () => {
      expect(getBucketInfo('newprovider')).toBeNull();
      await acquireSlot('newprovider');
      expect(getBucketInfo('newprovider')).not.toBeNull();
    });

    it('drains tokens with successive calls', async () => {
      for (let i = 0; i < 5; i++) {
        await acquireSlot('test-provider');
      }
      const info = getBucketInfo('test-provider');
      expect(info!.tokens).toBe(55); // 60 - 5
    });
  });

  describe('releaseSlot', () => {
    it('adds a token back to the bucket', async () => {
      await acquireSlot('anthropic');
      const before = getBucketInfo('anthropic');
      expect(before!.tokens).toBe(59);

      releaseSlot('anthropic');
      const after = getBucketInfo('anthropic');
      expect(after!.tokens).toBe(60);
    });

    it('does not exceed max tokens on release', async () => {
      // Release without acquiring — should cap at maxTokens
      releaseSlot('fresh-provider');
      await acquireSlot('fresh-provider'); // This creates the bucket with 60 tokens, then acquires 1
      releaseSlot('fresh-provider');
      releaseSlot('fresh-provider');
      releaseSlot('fresh-provider');

      const info = getBucketInfo('fresh-provider');
      expect(info!.tokens).toBeLessThanOrEqual(info!.maxTokens);
    });
  });

  describe('configureRateLimit', () => {
    it('sets the default RPM for new buckets', async () => {
      configureRateLimit(120);
      await acquireSlot('high-rpm');

      const info = getBucketInfo('high-rpm');
      expect(info!.maxTokens).toBe(120);
      expect(info!.tokens).toBe(119);
    });

    it('uses low RPM for restrictive configs', async () => {
      configureRateLimit(10);
      await acquireSlot('low-rpm');

      const info = getBucketInfo('low-rpm');
      expect(info!.maxTokens).toBe(10);
    });
  });

  describe('getBucketInfo', () => {
    it('returns null for unknown providers', () => {
      expect(getBucketInfo('nonexistent')).toBeNull();
    });

    it('returns token count, max, and queue length', async () => {
      await acquireSlot('info-test');
      const info = getBucketInfo('info-test');

      expect(info).toEqual({
        tokens: 59,
        maxTokens: 60,
        queueLength: 0,
      });
    });
  });

  describe('rate limiting behavior', () => {
    it('waits when tokens are exhausted', async () => {
      configureRateLimit(2); // Very low limit: 2 RPM

      // Exhaust all tokens
      await acquireSlot('slow');
      await acquireSlot('slow');

      // Next acquire should wait (we test it resolves eventually)
      // Use a fake timer to avoid actual waiting
      vi.useFakeTimers();
      const acquirePromise = acquireSlot('slow');

      // Advance time to allow refill
      await vi.advanceTimersByTimeAsync(31_000); // 30s = 1 token at 2 RPM

      await acquirePromise;
      vi.useRealTimers();
      // The acquire should have completed (timer was advanced)
    });

    it('releaseSlot drains waiters before adding token back', async () => {
      configureRateLimit(1); // 1 RPM — very tight
      await acquireSlot('drain-test');

      // Start an acquire that will queue
      vi.useFakeTimers();
      const pendingAcquire = acquireSlot('drain-test');

      // Release should drain the waiter
      releaseSlot('drain-test');
      await pendingAcquire;
      vi.useRealTimers();

      // Waiter was resolved, queue should be empty
      const info = getBucketInfo('drain-test');
      expect(info!.queueLength).toBe(0);
    });
  });

  describe('resetBuckets', () => {
    it('clears all provider buckets', async () => {
      await acquireSlot('provider-a');
      await acquireSlot('provider-b');
      resetBuckets();

      expect(getBucketInfo('provider-a')).toBeNull();
      expect(getBucketInfo('provider-b')).toBeNull();
    });
  });
});
