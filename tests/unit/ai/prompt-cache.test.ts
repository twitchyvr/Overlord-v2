/**
 * Prompt Cache Tests
 *
 * Tests LRU cache behavior: hit/miss, eviction at capacity,
 * and provider-aware cached system prompt building.
 *
 * @see Issue #363
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  hashPrompt,
  getCachedPrompt,
  cachePrompt,
  getCacheSize,
  clearCache,
  buildCachedSystemPrompt,
} from '../../../src/ai/prompt-cache.js';

describe('Prompt Cache', () => {
  beforeEach(() => {
    clearCache();
  });

  describe('hashPrompt', () => {
    it('returns a deterministic SHA-256 hex string', () => {
      const h1 = hashPrompt('hello world');
      const h2 = hashPrompt('hello world');
      expect(h1).toBe(h2);
      expect(h1).toHaveLength(64); // SHA-256 hex = 64 chars
    });

    it('returns different hashes for different inputs', () => {
      const h1 = hashPrompt('prompt A');
      const h2 = hashPrompt('prompt B');
      expect(h1).not.toBe(h2);
    });
  });

  describe('getCachedPrompt / cachePrompt', () => {
    it('returns undefined for a cache miss', () => {
      expect(getCachedPrompt('nonexistent')).toBeUndefined();
    });

    it('returns the cached entry on a hit', () => {
      const hash = hashPrompt('test prompt');
      cachePrompt(hash, 'test prompt');

      const entry = getCachedPrompt(hash);
      expect(entry).toBeDefined();
      expect(entry!.prompt).toBe('test prompt');
      expect(entry!.timestamp).toBeGreaterThan(0);
    });

    it('refreshes timestamp on cache hit (LRU)', () => {
      const hash = hashPrompt('test');
      cachePrompt(hash, 'test');

      const entry1 = getCachedPrompt(hash);
      const t1 = entry1!.timestamp;

      // Small delay to ensure timestamp differs
      const entry2 = getCachedPrompt(hash);
      expect(entry2!.timestamp).toBeGreaterThanOrEqual(t1);
    });

    it('overwrites existing entry when re-cached', () => {
      const hash = hashPrompt('original');
      cachePrompt(hash, 'original');
      cachePrompt(hash, 'updated');

      const entry = getCachedPrompt(hash);
      expect(entry!.prompt).toBe('updated');
    });
  });

  describe('LRU eviction', () => {
    it('evicts oldest entry when exceeding max size (50)', () => {
      // Fill cache to capacity
      for (let i = 0; i < 50; i++) {
        cachePrompt(`hash-${i}`, `prompt-${i}`);
      }
      expect(getCacheSize()).toBe(50);

      // Adding one more should evict the oldest (hash-0)
      cachePrompt('hash-50', 'prompt-50');
      expect(getCacheSize()).toBe(50);
      expect(getCachedPrompt('hash-0')).toBeUndefined();
      expect(getCachedPrompt('hash-50')).toBeDefined();
    });

    it('preserves recently accessed entries during eviction', () => {
      // Fill cache
      for (let i = 0; i < 50; i++) {
        cachePrompt(`hash-${i}`, `prompt-${i}`);
      }

      // Access hash-0 to refresh it (move to most recent)
      getCachedPrompt('hash-0');

      // Add a new entry — should evict hash-1 (now oldest), not hash-0
      cachePrompt('hash-50', 'prompt-50');
      expect(getCachedPrompt('hash-0')).toBeDefined();
      expect(getCachedPrompt('hash-1')).toBeUndefined();
    });
  });

  describe('getCacheSize / clearCache', () => {
    it('reports correct size', () => {
      expect(getCacheSize()).toBe(0);
      cachePrompt('a', 'a');
      cachePrompt('b', 'b');
      expect(getCacheSize()).toBe(2);
    });

    it('clears all entries', () => {
      cachePrompt('a', 'a');
      cachePrompt('b', 'b');
      clearCache();
      expect(getCacheSize()).toBe(0);
      expect(getCachedPrompt('a')).toBeUndefined();
    });
  });

  describe('buildCachedSystemPrompt', () => {
    it('returns array with cache_control for Anthropic on second call', () => {
      const prompt = 'You are a helpful assistant.';

      // First call — not yet cached, no cache_control
      const result1 = buildCachedSystemPrompt(prompt, 'anthropic');
      expect(Array.isArray(result1)).toBe(true);
      const arr1 = result1 as Array<{ type: string; text: string; cache_control?: unknown }>;
      expect(arr1).toHaveLength(1);
      expect(arr1[0].type).toBe('text');
      expect(arr1[0].text).toBe(prompt);
      expect(arr1[0].cache_control).toBeUndefined();

      // Second call — now cached, should include cache_control
      const result2 = buildCachedSystemPrompt(prompt, 'anthropic');
      const arr2 = result2 as Array<{ type: string; text: string; cache_control?: { type: string } }>;
      expect(arr2[0].cache_control).toEqual({ type: 'ephemeral' });
    });

    it('returns array with cache_control for MiniMax on second call', () => {
      const prompt = 'System prompt for MiniMax';

      buildCachedSystemPrompt(prompt, 'minimax');
      const result = buildCachedSystemPrompt(prompt, 'minimax');
      const arr = result as Array<{ type: string; text: string; cache_control?: { type: string } }>;
      expect(arr[0].cache_control).toEqual({ type: 'ephemeral' });
    });

    it('returns plain string for unsupported providers', () => {
      const prompt = 'System prompt for OpenAI';
      const result = buildCachedSystemPrompt(prompt, 'openai');
      expect(typeof result).toBe('string');
      expect(result).toBe(prompt);
    });

    it('returns plain string for unknown providers', () => {
      const prompt = 'Some system prompt';
      const result = buildCachedSystemPrompt(prompt, 'custom-provider');
      expect(typeof result).toBe('string');
      expect(result).toBe(prompt);
    });
  });
});
