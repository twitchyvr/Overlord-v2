/**
 * Model Registry Tests (#909)
 *
 * Validates model catalog entries, pricing accuracy, and registry API.
 */

import { describe, it, expect } from 'vitest';
import { listModels, getModel, getProviderModels, getRecommendedModel, compareModels } from '../../../src/ai/model-registry.js';

describe('Model Registry', () => {
  describe('listModels()', () => {
    it('returns all models', () => {
      const result = listModels();
      expect(result.ok).toBe(true);
      const models = result.data as Array<{ id: string }>;
      expect(models.length).toBeGreaterThanOrEqual(8); // 3 Anthropic + 4 MiniMax + 2 OpenAI + 1 Ollama
    });
  });

  describe('getModel()', () => {
    it('finds MiniMax M2.7 by ID', () => {
      const result = getModel('MiniMax-M2.7');
      expect(result.ok).toBe(true);
      const model = result.data as { id: string; name: string; provider: string };
      expect(model.name).toBe('MiniMax M2.7');
      expect(model.provider).toBe('minimax');
    });

    it('finds MiniMax M2.7 Highspeed by ID', () => {
      const result = getModel('MiniMax-M2.7-highspeed');
      expect(result.ok).toBe(true);
      const model = result.data as { id: string; name: string };
      expect(model.name).toBe('MiniMax M2.7 Highspeed');
    });

    it('returns error for unknown model', () => {
      const result = getModel('nonexistent-model');
      expect(result.ok).toBe(false);
    });
  });

  describe('MiniMax M2.7 pricing (#909)', () => {
    it('M2.7 has correct pricing: $0.3/M input, $1.2/M output', () => {
      const result = getModel('MiniMax-M2.7');
      const model = result.data as { pricing: { input: number; output: number } };
      expect(model.pricing.input).toBe(0.3);
      expect(model.pricing.output).toBe(1.2);
    });

    it('M2.7-highspeed has correct pricing: $0.6/M input, $2.4/M output', () => {
      const result = getModel('MiniMax-M2.7-highspeed');
      const model = result.data as { pricing: { input: number; output: number } };
      expect(model.pricing.input).toBe(0.6);
      expect(model.pricing.output).toBe(2.4);
    });

    it('M2.5 legacy has correct pricing: $0.3/M input, $1.2/M output', () => {
      const result = getModel('MiniMax-M2.5');
      const model = result.data as { pricing: { input: number; output: number } };
      expect(model.pricing.input).toBe(0.3);
      expect(model.pricing.output).toBe(1.2);
    });
  });

  describe('MiniMax context windows (#909)', () => {
    it('M2.7 has 204,800 token context window', () => {
      const result = getModel('MiniMax-M2.7');
      const model = result.data as { contextWindow: number };
      expect(model.contextWindow).toBe(204800);
    });

    it('M2.7-highspeed has 204,800 token context window', () => {
      const result = getModel('MiniMax-M2.7-highspeed');
      const model = result.data as { contextWindow: number };
      expect(model.contextWindow).toBe(204800);
    });
  });

  describe('MiniMax M2.7 capabilities', () => {
    it('M2.7 has interleaved-thinking capability', () => {
      const result = getModel('MiniMax-M2.7');
      const model = result.data as { capabilities: string[] };
      expect(model.capabilities).toContain('interleaved-thinking');
    });

    it('M2.7 has agent-teams capability', () => {
      const result = getModel('MiniMax-M2.7');
      const model = result.data as { capabilities: string[] };
      expect(model.capabilities).toContain('agent-teams');
    });

    it('M2.7 has self-evolution capability', () => {
      const result = getModel('MiniMax-M2.7');
      const model = result.data as { capabilities: string[] };
      expect(model.capabilities).toContain('self-evolution');
    });

    it('M2.7 supports tool use and thinking', () => {
      const result = getModel('MiniMax-M2.7');
      const model = result.data as { thinking: boolean; toolUse: boolean };
      expect(model.thinking).toBe(true);
      expect(model.toolUse).toBe(true);
    });
  });

  describe('getProviderModels()', () => {
    it('returns all MiniMax models', () => {
      const result = getProviderModels('minimax');
      const models = result.data as Array<{ id: string }>;
      expect(models.length).toBe(4); // M2.7, M2.7-hs, M2.5, M2.5-hs
      const ids = models.map(m => m.id);
      expect(ids).toContain('MiniMax-M2.7');
      expect(ids).toContain('MiniMax-M2.7-highspeed');
      expect(ids).toContain('MiniMax-M2.5');
      expect(ids).toContain('MiniMax-M2.5-highspeed');
    });
  });

  describe('getRecommendedModel()', () => {
    it('recommends MiniMax for code-lab when provider is minimax', () => {
      const result = getRecommendedModel('code-lab', 'minimax');
      expect(result.ok).toBe(true);
      const model = result.data as { provider: string };
      expect(model.provider).toBe('minimax');
    });
  });

  describe('compareModels()', () => {
    it('returns requested models for comparison', () => {
      const result = compareModels(['MiniMax-M2.7', 'claude-sonnet-4-6']);
      const models = result.data as Array<{ id: string }>;
      expect(models).toHaveLength(2);
    });
  });
});
