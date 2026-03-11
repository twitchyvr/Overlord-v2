/**
 * AI Provider Tests
 *
 * Tests the provider-agnostic layer (not individual adapters, which need API keys).
 */

import { describe, it, expect } from 'vitest';
import { registerAdapter, getAdapter, sendMessage } from '../../../src/ai/ai-provider.js';
import type { AIAdapter } from '../../../src/core/contracts.js';

describe('AI Provider', () => {
  const mockAdapter: AIAdapter = {
    name: 'mock',
    async sendMessage(messages, _tools, _options) {
      return {
        id: 'mock_1',
        role: 'assistant',
        content: [{ type: 'text', text: `Mock response to ${messages.length} messages` }],
        model: 'mock-v1',
        stop_reason: 'end_turn',
        usage: { input_tokens: 10, output_tokens: 5 },
      };
    },
    validateConfig: () => true,
  };

  it('registers and retrieves adapters', () => {
    registerAdapter('mock', mockAdapter);
    expect(getAdapter('mock')).toBe(mockAdapter);
  });

  it('returns null for unknown adapter', () => {
    expect(getAdapter('nonexistent')).toBeNull();
  });

  it('sends message through adapter', async () => {
    registerAdapter('mock', mockAdapter);
    const result = await sendMessage({
      provider: 'mock',
      messages: [{ role: 'user', content: 'hello' }],
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      const data = result.data as Record<string, unknown>;
      expect(data.id).toBe('mock_1');
      expect(data.model).toBe('mock-v1');
    }
  });

  it('returns error for unknown provider', async () => {
    const result = await sendMessage({
      provider: 'ghost',
      messages: [],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('UNKNOWN_PROVIDER');
    }
  });

  it('catches adapter errors', async () => {
    registerAdapter('failing', {
      name: 'failing',
      async sendMessage() { throw new Error('API down'); },
      validateConfig: () => true,
    });

    const result = await sendMessage({
      provider: 'failing',
      messages: [{ role: 'user', content: 'test' }],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('AI_ERROR');
      expect(result.error.retryable).toBe(true);
    }
  });
});
