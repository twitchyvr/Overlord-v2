/**
 * MiniMax Adapter Tests
 *
 * Tests the Anthropic-compatible MiniMax adapter.
 * Uses mocked Anthropic SDK — no real API key needed.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Config } from '../../../src/core/contracts.js';

const mockCreate = vi.fn();
const MockAnthropic = vi.fn().mockImplementation(() => ({
  messages: { create: mockCreate },
}));

vi.mock('../../../src/ai/prompt-cache.js', () => ({
  buildCachedSystemPrompt: (system: string, _provider: string) => system,
  cachePrompt: vi.fn(),
  getCachedPrompt: vi.fn(),
  hashPrompt: vi.fn().mockReturnValue('mock-hash'),
}));

vi.mock('@anthropic-ai/sdk', () => ({
  default: MockAnthropic,
}));

// Import after mocking
const { createMinimaxAdapter } = await import('../../../src/ai/adapters/minimax.js');

function makeConfig(overrides: Record<string, unknown> = {}): Config {
  const values: Record<string, unknown> = {
    MINIMAX_API_KEY: 'test-key',
    MINIMAX_BASE_URL: 'https://api.minimax.io/anthropic',
    MINIMAX_MODEL: 'MiniMax-M2.7',
    AI_REQUEST_TIMEOUT_MS: 60_000,
    ...overrides,
  };
  return {
    get: (key: string) => values[key],
    validate: () => ({ get: (k: string) => values[k] }),
    getAll: () => values,
  } as unknown as Config;
}

const standardResponse = {
  id: 'msg_minimax_1',
  role: 'assistant',
  content: [{ type: 'text', text: 'Hello from MiniMax' }],
  model: 'MiniMax-M2.7',
  stop_reason: 'end_turn',
  usage: { input_tokens: 50, output_tokens: 10 },
};

describe('MiniMax Adapter (Anthropic-Compatible)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates adapter with correct name', () => {
    const adapter = createMinimaxAdapter(makeConfig());
    expect(adapter.name).toBe('minimax');
  });

  it('validates config requires MINIMAX_API_KEY', () => {
    const adapterWithKey = createMinimaxAdapter(makeConfig());
    expect(adapterWithKey.validateConfig()).toBe(true);

    const adapterWithoutKey = createMinimaxAdapter(makeConfig({ MINIMAX_API_KEY: undefined }));
    expect(adapterWithoutKey.validateConfig()).toBe(false);
  });

  it('initializes Anthropic client with MiniMax baseURL', async () => {
    mockCreate.mockResolvedValueOnce(standardResponse);

    const adapter = createMinimaxAdapter(makeConfig());
    await adapter.sendMessage([{ role: 'user', content: 'hello' }], [], {});

    expect(MockAnthropic).toHaveBeenCalledWith({
      apiKey: 'test-key',
      timeout: 60_000,
      baseURL: 'https://api.minimax.io/anthropic',
    });
  });

  it('sends messages using Anthropic-native format', async () => {
    mockCreate.mockResolvedValueOnce({
      ...standardResponse,
      id: 'msg_minimax_2',
    });

    const adapter = createMinimaxAdapter(makeConfig());
    const result = await adapter.sendMessage(
      [{ role: 'user', content: 'What is 2+2?' }],
      [],
      { system: 'You are a math tutor' },
    ) as Record<string, unknown>;

    expect(result.id).toBe('msg_minimax_2');
    expect(result.model).toBe('MiniMax-M2.7');
    expect(result.stop_reason).toBe('end_turn');

    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({
      model: 'MiniMax-M2.7',
      max_tokens: 8192,
      system: 'You are a math tutor',
    }));
  });

  it('passes tools in Anthropic format', async () => {
    mockCreate.mockResolvedValueOnce({
      id: 'msg_minimax_3',
      role: 'assistant',
      content: [{
        type: 'tool_use',
        id: 'toolu_1',
        name: 'read_file',
        input: { path: '/test.ts' },
      }],
      model: 'MiniMax-M2.7',
      stop_reason: 'tool_use',
      usage: { input_tokens: 200, output_tokens: 50 },
    });

    const adapter = createMinimaxAdapter(makeConfig());
    const result = await adapter.sendMessage(
      [{ role: 'user', content: 'Read test.ts' }],
      [{
        name: 'read_file',
        description: 'Read a file',
        inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
      }],
      {},
    ) as Record<string, unknown>;

    expect(result.stop_reason).toBe('tool_use');

    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({
      tools: [expect.objectContaining({
        name: 'read_file',
        description: 'Read a file',
        input_schema: expect.objectContaining({ type: 'object' }),
      })],
    }));
  });

  it('extracts cache usage from response', async () => {
    mockCreate.mockResolvedValueOnce({
      ...standardResponse,
      id: 'msg_minimax_4',
      usage: {
        input_tokens: 150,
        output_tokens: 30,
        cache_creation_input_tokens: 100,
        cache_read_input_tokens: 50,
      },
    });

    const adapter = createMinimaxAdapter(makeConfig());
    const result = await adapter.sendMessage(
      [{ role: 'user', content: 'hello' }],
      [],
      {},
    ) as { usage: { input_tokens: number; output_tokens: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number } };

    expect(result.usage.input_tokens).toBe(150);
    expect(result.usage.output_tokens).toBe(30);
    expect(result.usage.cache_creation_input_tokens).toBe(100);
    expect(result.usage.cache_read_input_tokens).toBe(50);
  });

  it('uses default model from config', async () => {
    mockCreate.mockResolvedValueOnce(standardResponse);

    const adapter = createMinimaxAdapter(makeConfig());
    await adapter.sendMessage([{ role: 'user', content: 'hi' }], [], {});

    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({
      model: 'MiniMax-M2.7',
    }));
  });

  it('allows model override via options', async () => {
    mockCreate.mockResolvedValueOnce({
      ...standardResponse,
      model: 'MiniMax-Text-01',
    });

    const adapter = createMinimaxAdapter(makeConfig());
    await adapter.sendMessage([{ role: 'user', content: 'hi' }], [], { model: 'MiniMax-Text-01' });

    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({
      model: 'MiniMax-Text-01',
    }));
  });

  it('throws when API key is missing at call time', async () => {
    const adapter = createMinimaxAdapter(makeConfig({ MINIMAX_API_KEY: undefined }));

    await expect(
      adapter.sendMessage([{ role: 'user', content: 'hi' }], [], {}),
    ).rejects.toThrow('MINIMAX_API_KEY is not configured');
  });

  describe('timeout configuration', () => {
    it('passes configured timeout to Anthropic client', async () => {
      mockCreate.mockResolvedValueOnce(standardResponse);

      const adapter = createMinimaxAdapter(makeConfig({ AI_REQUEST_TIMEOUT_MS: 30_000 }));
      await adapter.sendMessage([{ role: 'user', content: 'hi' }], [], {});

      expect(MockAnthropic).toHaveBeenCalledWith(
        expect.objectContaining({ timeout: 30_000 }),
      );
    });

    it('uses default 60s timeout', async () => {
      mockCreate.mockResolvedValueOnce(standardResponse);

      const adapter = createMinimaxAdapter(makeConfig());
      await adapter.sendMessage([{ role: 'user', content: 'hi' }], [], {});

      expect(MockAnthropic).toHaveBeenCalledWith(
        expect.objectContaining({ timeout: 60_000 }),
      );
    });

    it('propagates SDK timeout errors', async () => {
      const timeoutError = new Error('Connection timed out');
      timeoutError.name = 'APIConnectionTimeoutError';
      mockCreate.mockRejectedValueOnce(timeoutError);

      const adapter = createMinimaxAdapter(makeConfig());
      await expect(
        adapter.sendMessage([{ role: 'user', content: 'hi' }], [], {}),
      ).rejects.toThrow('Connection timed out');
    });
  });

  describe('Thinking block preservation (#909 — M2.7 interleaved thinking)', () => {
    it('preserves thinking blocks in content for multi-turn conversations', async () => {
      mockCreate.mockResolvedValueOnce({
        id: 'msg_think_1',
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'Let me analyze this...' },
          { type: 'text', text: 'The answer is 4' },
        ],
        model: 'MiniMax-M2.7',
        stop_reason: 'end_turn',
        usage: { input_tokens: 50, output_tokens: 30 },
      });

      const adapter = createMinimaxAdapter(makeConfig());
      const result = await adapter.sendMessage(
        [{ role: 'user', content: 'What is 2+2?' }], [], {},
      ) as { content: AnthropicContentBlock[]; thinking: string };

      // Content must include thinking blocks (not strip them)
      expect(result.content).toHaveLength(2);
      expect(result.content[0].type).toBe('thinking');
      expect(result.content[1].type).toBe('text');
      // Thinking field should still be populated for UI
      expect(result.thinking).toBe('Let me analyze this...');
    });

    it('preserves interleaved thinking between tool calls', async () => {
      mockCreate.mockResolvedValueOnce({
        id: 'msg_think_2',
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'I need to read the file first' },
          { type: 'tool_use', id: 'toolu_1', name: 'read_file', input: { path: '/test.ts' } },
        ],
        model: 'MiniMax-M2.7',
        stop_reason: 'tool_use',
        usage: { input_tokens: 100, output_tokens: 50 },
      });

      const adapter = createMinimaxAdapter(makeConfig());
      const result = await adapter.sendMessage(
        [{ role: 'user', content: 'Read test.ts' }],
        [{ name: 'read_file', description: 'Read a file', inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } }],
        {},
      ) as { content: AnthropicContentBlock[]; thinking: string };

      // Both thinking and tool_use must be in content
      expect(result.content).toHaveLength(2);
      expect(result.content[0].type).toBe('thinking');
      expect(result.content[1].type).toBe('tool_use');
    });

    it('synthesizes text block when response has only thinking blocks', async () => {
      mockCreate.mockResolvedValueOnce({
        id: 'msg_think_3',
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'Deep analysis in progress...' },
        ],
        model: 'MiniMax-M2.7',
        stop_reason: 'max_tokens',
        usage: { input_tokens: 50, output_tokens: 500 },
      });

      const adapter = createMinimaxAdapter(makeConfig());
      const result = await adapter.sendMessage(
        [{ role: 'user', content: 'Complex question' }], [], {},
      ) as { content: AnthropicContentBlock[] };

      // Should have original thinking block + synthesized text block
      expect(result.content).toHaveLength(2);
      expect(result.content[0].type).toBe('thinking');
      expect(result.content[1].type).toBe('text');
      expect(result.content[1].text).toBe('Deep analysis in progress...');
    });
  });

  describe('Model name construction (#853)', () => {
    it('appends -highspeed when USE_HIGHSPEED=true and model lacks suffix', async () => {
      mockCreate.mockResolvedValueOnce(standardResponse);
      const adapter = createMinimaxAdapter(makeConfig({
        MINIMAX_MODEL: 'MiniMax-M2.5',
        MINIMAX_USE_HIGHSPEED: true,
      }));
      await adapter.sendMessage([{ role: 'user', content: 'hi' }], [], {});
      expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({
        model: 'MiniMax-M2.5-highspeed',
      }));
    });

    it('does NOT double-append -highspeed when model already has suffix', async () => {
      mockCreate.mockResolvedValueOnce(standardResponse);
      const adapter = createMinimaxAdapter(makeConfig({
        MINIMAX_MODEL: 'MiniMax-M2.5-highspeed',
        MINIMAX_USE_HIGHSPEED: true,
      }));
      await adapter.sendMessage([{ role: 'user', content: 'hi' }], [], {});
      expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({
        model: 'MiniMax-M2.5-highspeed',
      }));
    });

    it('uses base model without suffix when USE_HIGHSPEED=false', async () => {
      mockCreate.mockResolvedValueOnce(standardResponse);
      const adapter = createMinimaxAdapter(makeConfig({
        MINIMAX_MODEL: 'MiniMax-M2.5',
        MINIMAX_USE_HIGHSPEED: false,
      }));
      await adapter.sendMessage([{ role: 'user', content: 'hi' }], [], {});
      expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({
        model: 'MiniMax-M2.5',
      }));
    });

    it('respects options.model override over config', async () => {
      mockCreate.mockResolvedValueOnce(standardResponse);
      const adapter = createMinimaxAdapter(makeConfig({
        MINIMAX_MODEL: 'MiniMax-M2.5',
        MINIMAX_USE_HIGHSPEED: true,
      }));
      await adapter.sendMessage([{ role: 'user', content: 'hi' }], [], { model: 'CustomModel' });
      expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({
        model: 'CustomModel-highspeed',
      }));
    });
  });
});
