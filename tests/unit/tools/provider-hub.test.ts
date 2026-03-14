/**
 * Provider Hub Tool Provider Tests
 *
 * Tests switch_provider, compare_models, configure_fallback, test_provider.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  switchProvider,
  compareModels,
  configureFallback,
  testProvider,
  getFallbackChain,
  getAllFallbackChains,
} from '../../../src/tools/providers/provider-hub.js';

describe('Provider Hub Tool Provider', () => {
  describe('switchProvider', () => {
    it('switches provider for a room type', () => {
      const result = switchProvider({ roomType: 'code-lab', provider: 'openai' });
      expect(result.status).toBe('switched');
      expect(result.newProvider).toBe('openai');
      expect(result.roomType).toBe('code-lab');
    });

    it('returns already-active when switching to same provider', () => {
      switchProvider({ roomType: 'test-room', provider: 'minimax' });
      const result = switchProvider({ roomType: 'test-room', provider: 'minimax' });
      expect(result.status).toBe('already-active');
    });

    it('throws on invalid provider', () => {
      expect(() => switchProvider({ roomType: 'code-lab', provider: 'invalid' })).toThrow('Invalid provider');
    });

    it('accepts all valid providers', () => {
      for (const provider of ['anthropic', 'minimax', 'openai', 'ollama']) {
        const result = switchProvider({ roomType: `room-${provider}`, provider });
        expect(result.newProvider).toBe(provider);
      }
    });
  });

  describe('compareModels', () => {
    it('returns error for invalid providers (no AI provider)', async () => {
      const result = await compareModels({
        prompt: 'Hello',
        providers: ['invalid-provider'],
      });
      expect(result.comparisons).toHaveLength(1);
      expect(result.comparisons[0].error).toContain('Invalid provider');
    });

    it('returns error when AI provider not available', async () => {
      const result = await compareModels({
        prompt: 'Hello',
        providers: ['anthropic'],
      });
      expect(result.comparisons).toHaveLength(1);
      expect(result.comparisons[0].error).toContain('AI provider not available');
    });

    it('compares models using mock AI provider', async () => {
      const mockAI = {
        chat: vi.fn().mockResolvedValue({
          ok: true,
          data: { content: [{ type: 'text', text: 'Hello response' }] },
        }),
      };

      const result = await compareModels(
        { prompt: 'Hello', providers: ['anthropic', 'openai'] },
        mockAI,
      );

      expect(result.comparisons).toHaveLength(2);
      expect(result.comparisons[0].output).toBe('Hello response');
      expect(result.comparisons[1].output).toBe('Hello response');
      expect(result.fastest).toBeDefined();
      expect(result.longestOutput).toBeDefined();
    });

    it('handles AI provider errors gracefully', async () => {
      const mockAI = {
        chat: vi.fn().mockResolvedValue({
          ok: false,
          error: { message: 'Rate limited' },
        }),
      };

      const result = await compareModels(
        { prompt: 'Hello', providers: ['anthropic'] },
        mockAI,
      );

      expect(result.comparisons[0].error).toBe('Rate limited');
      expect(result.fastest).toBe('none');
      expect(result.longestOutput).toBe('none');
    });

    it('handles AI provider exceptions gracefully', async () => {
      const mockAI = {
        chat: vi.fn().mockRejectedValue(new Error('Network error')),
      };

      const result = await compareModels(
        { prompt: 'Hello', providers: ['anthropic'] },
        mockAI,
      );

      expect(result.comparisons[0].error).toBe('Network error');
    });
  });

  describe('configureFallback', () => {
    it('creates a new fallback chain', () => {
      const result = configureFallback({
        roomType: 'new-room-type',
        primary: 'anthropic',
        fallbacks: ['openai', 'ollama'],
        priority: 1,
      });
      expect(result.status).toBe('created');
      expect(result.chain.primary).toBe('anthropic');
      expect(result.chain.fallbacks).toEqual(['openai', 'ollama']);
    });

    it('updates existing fallback chain', () => {
      configureFallback({
        roomType: 'update-room',
        primary: 'anthropic',
        fallbacks: ['openai'],
      });
      const result = configureFallback({
        roomType: 'update-room',
        primary: 'openai',
        fallbacks: ['anthropic'],
      });
      expect(result.status).toBe('updated');
      expect(result.chain.primary).toBe('openai');
    });

    it('defaults priority to 1', () => {
      const result = configureFallback({
        roomType: 'priority-room',
        primary: 'anthropic',
        fallbacks: ['openai'],
      });
      expect(result.chain.priority).toBe(1);
    });

    it('throws on invalid primary provider', () => {
      expect(() => configureFallback({
        roomType: 'x',
        primary: 'invalid',
        fallbacks: ['openai'],
      })).toThrow('Invalid primary provider');
    });

    it('throws on invalid fallback provider', () => {
      expect(() => configureFallback({
        roomType: 'x',
        primary: 'anthropic',
        fallbacks: ['invalid-fb'],
      })).toThrow('Invalid fallback provider');
    });

    it('throws when primary is in fallback list (circular)', () => {
      expect(() => configureFallback({
        roomType: 'x',
        primary: 'anthropic',
        fallbacks: ['openai', 'anthropic'],
      })).toThrow('cannot be in its own fallback list');
    });
  });

  describe('testProvider', () => {
    it('throws on invalid provider', async () => {
      await expect(testProvider({ provider: 'invalid' })).rejects.toThrow('Invalid provider');
    });

    it('reports unconfigured provider (no API key)', async () => {
      // Most providers need API keys — anthropic, minimax, openai
      // Save and clear env
      const savedKey = process.env.ANTHROPIC_API_KEY;
      delete process.env.ANTHROPIC_API_KEY;

      const result = await testProvider({ provider: 'anthropic' });
      expect(result.configured).toBe(false);
      expect(result.reachable).toBe(false);
      expect(result.error).toContain('not configured');

      // Restore
      if (savedKey) process.env.ANTHROPIC_API_KEY = savedKey;
    });

    it('reports ollama as always configured', async () => {
      const result = await testProvider({ provider: 'ollama' });
      // Ollama is always configured, but will fail without AI provider
      expect(result.configured).toBe(true);
      expect(result.error).toContain('AI provider not available');
    });

    it('tests successfully with mock AI provider', async () => {
      const savedKey = process.env.ANTHROPIC_API_KEY;
      process.env.ANTHROPIC_API_KEY = 'test-key';

      const mockAI = {
        chat: vi.fn().mockResolvedValue({ ok: true, data: {} }),
      };

      const result = await testProvider({ provider: 'anthropic' }, mockAI);
      expect(result.configured).toBe(true);
      expect(result.reachable).toBe(true);
      expect(result.responseTime).toBeGreaterThanOrEqual(0);

      if (savedKey) {
        process.env.ANTHROPIC_API_KEY = savedKey;
      } else {
        delete process.env.ANTHROPIC_API_KEY;
      }
    });

    it('handles AI provider failure', async () => {
      const savedKey = process.env.ANTHROPIC_API_KEY;
      process.env.ANTHROPIC_API_KEY = 'test-key';

      const mockAI = {
        chat: vi.fn().mockResolvedValue({ ok: false, error: { message: 'Unauthorized' } }),
      };

      const result = await testProvider({ provider: 'anthropic' }, mockAI);
      expect(result.configured).toBe(true);
      expect(result.reachable).toBe(false);
      expect(result.error).toBe('Unauthorized');

      if (savedKey) {
        process.env.ANTHROPIC_API_KEY = savedKey;
      } else {
        delete process.env.ANTHROPIC_API_KEY;
      }
    });
  });

  describe('getFallbackChain / getAllFallbackChains', () => {
    it('returns null for non-existent chain', () => {
      expect(getFallbackChain('nonexistent-room-12345')).toBeNull();
    });

    it('returns configured chain', () => {
      configureFallback({
        roomType: 'chain-lookup-room',
        primary: 'anthropic',
        fallbacks: ['openai'],
      });
      const chain = getFallbackChain('chain-lookup-room');
      expect(chain).not.toBeNull();
      expect(chain!.primary).toBe('anthropic');
    });

    it('getAllFallbackChains returns a Map', () => {
      const all = getAllFallbackChains();
      expect(all instanceof Map).toBe(true);
    });
  });
});
