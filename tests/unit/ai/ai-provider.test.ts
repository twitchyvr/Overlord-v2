/**
 * AI Provider Tests
 *
 * Tests the provider-agnostic layer (not individual adapters, which need API keys).
 * Includes timeout detection and bus event emission tests.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerAdapter, getAdapter, sendMessage, initAI } from '../../../src/ai/ai-provider.js';
import type { AIAdapter, Config } from '../../../src/core/contracts.js';
import type { Bus } from '../../../src/core/bus.js';

function makeConfig(): Config {
  const values: Record<string, unknown> = {
    ANTHROPIC_API_KEY: undefined,
    ANTHROPIC_BASE_URL: undefined,
    ANTHROPIC_MODEL: 'claude-sonnet-4-20250514',
    MINIMAX_API_KEY: undefined,
    MINIMAX_BASE_URL: 'https://api.minimax.io/anthropic',
    MINIMAX_MODEL: 'MiniMax-M2.7',
    OPENAI_API_KEY: undefined,
    OPENAI_MODEL: 'gpt-4o',
    OLLAMA_BASE_URL: 'http://localhost:11434',
    OLLAMA_MODEL: 'llama3',
    AI_REQUEST_TIMEOUT_MS: 60_000,
  };
  return {
    get: (key: string) => values[key],
    validate: () => ({ get: (k: string) => values[k] }),
    getAll: () => values,
  } as unknown as Config;
}

function makeBus(): Bus {
  return {
    emit: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
  } as unknown as Bus;
}

describe('AI Provider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

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

  describe('timeout handling', () => {
    it('returns AI_TIMEOUT error when adapter throws timeout error', async () => {
      const timeoutError = new Error('Request timed out');
      timeoutError.name = 'APIConnectionTimeoutError';

      registerAdapter('timeout-test', {
        name: 'timeout-test',
        async sendMessage() { throw timeoutError; },
        validateConfig: () => true,
      });

      const result = await sendMessage({
        provider: 'timeout-test',
        messages: [{ role: 'user', content: 'hi' }],
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('AI_TIMEOUT');
        expect(result.error.retryable).toBe(true);
        expect(result.error.message).toContain('timed out');
      }
    });

    it('emits ai:timeout bus event when timeout occurs', async () => {
      const mockBus = makeBus();
      initAI(makeConfig(), mockBus);

      const timeoutError = new Error('Connection timed out');
      timeoutError.name = 'APIConnectionTimeoutError';

      registerAdapter('timeout-bus', {
        name: 'timeout-bus',
        async sendMessage() { throw timeoutError; },
        validateConfig: () => true,
      });

      await sendMessage({
        provider: 'timeout-bus',
        messages: [{ role: 'user', content: 'hi' }],
      });

      expect(mockBus.emit).toHaveBeenCalledWith('ai:timeout', { provider: 'timeout-bus' });
    });

    it('detects timeout from error message (not just name)', async () => {
      registerAdapter('msg-timeout', {
        name: 'msg-timeout',
        async sendMessage() { throw new Error('Request timed out after 60000ms'); },
        validateConfig: () => true,
      });

      const result = await sendMessage({
        provider: 'msg-timeout',
        messages: [{ role: 'user', content: 'hi' }],
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('AI_TIMEOUT');
      }
    });

    it('does not treat non-timeout errors as timeouts', async () => {
      registerAdapter('normal-error', {
        name: 'normal-error',
        async sendMessage() { throw new Error('Rate limit exceeded'); },
        validateConfig: () => true,
      });

      const result = await sendMessage({
        provider: 'normal-error',
        messages: [{ role: 'user', content: 'hi' }],
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('AI_ERROR');
      }
    });
  });
});
