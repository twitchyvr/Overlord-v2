/**
 * Thinking Config Tests
 *
 * Tests the unified thinking abstraction — config resolution
 * per provider and request mutation.
 *
 * @see Issue #364
 */

import { describe, it, expect } from 'vitest';
import {
  getThinkingConfig,
  applyThinkingToRequest,
} from '../../../src/ai/thinking-config.js';
describe('Thinking Config', () => {
  describe('getThinkingConfig', () => {
    it('returns enabled config for Anthropic', () => {
      const config = getThinkingConfig('anthropic');
      expect(config.enabled).toBe(true);
      expect(config.budget).toBeGreaterThan(0);
      expect(config.model).toBe('claude-sonnet-4-20250514');
    });

    it('returns enabled config for MiniMax', () => {
      const config = getThinkingConfig('minimax');
      expect(config.enabled).toBe(true);
      expect(config.budget).toBeGreaterThan(0);
      expect(config.model).toBe('MiniMax-M2.5');
    });

    it('returns disabled config for OpenAI', () => {
      const config = getThinkingConfig('openai');
      expect(config.enabled).toBe(false);
      expect(config.budget).toBeUndefined();
    });

    it('returns disabled config for Ollama', () => {
      const config = getThinkingConfig('ollama');
      expect(config.enabled).toBe(false);
    });

    it('returns disabled config for unknown providers', () => {
      const config = getThinkingConfig('some-random-provider');
      expect(config.enabled).toBe(false);
    });

    it('returns a copy (not a reference to internal state)', () => {
      const config1 = getThinkingConfig('anthropic');
      const config2 = getThinkingConfig('anthropic');
      expect(config1).toEqual(config2);
      expect(config1).not.toBe(config2);
    });
  });

  describe('applyThinkingToRequest', () => {
    it('adds thinking config for Anthropic', () => {
      const options: Record<string, unknown> = { model: 'claude-sonnet-4-20250514' };
      const result = applyThinkingToRequest('anthropic', options);

      expect(result.thinking).toEqual({
        type: 'enabled',
        budget_tokens: 10000,
      });
      // Should return the same object (mutation)
      expect(result).toBe(options);
    });

    it('adds thinking config for MiniMax', () => {
      const options: Record<string, unknown> = { model: 'MiniMax-M2.5' };
      const result = applyThinkingToRequest('minimax', options);

      expect(result.thinking).toEqual({
        type: 'enabled',
        budget_tokens: 8192,
      });
    });

    it('does not modify options for OpenAI', () => {
      const options: Record<string, unknown> = { model: 'gpt-4o' };
      const result = applyThinkingToRequest('openai', options);

      expect(result.thinking).toBeUndefined();
      expect(result.model).toBe('gpt-4o');
    });

    it('does not modify options for unknown providers', () => {
      const options: Record<string, unknown> = { temperature: 0.7 };
      const result = applyThinkingToRequest('custom', options);

      expect(result.thinking).toBeUndefined();
      expect(result.temperature).toBe(0.7);
    });

    it('preserves existing options when adding thinking', () => {
      const options: Record<string, unknown> = {
        model: 'claude-sonnet-4-20250514',
        temperature: 0.5,
        max_tokens: 4096,
      };
      applyThinkingToRequest('anthropic', options);

      expect(options.model).toBe('claude-sonnet-4-20250514');
      expect(options.temperature).toBe(0.5);
      expect(options.max_tokens).toBe(4096);
      expect(options.thinking).toBeDefined();
    });
  });
});
