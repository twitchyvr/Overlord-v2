/**
 * Anthropic Adapter Tests
 *
 * Tests the Anthropic-native adapter (no format translation needed).
 * Uses mocked Anthropic SDK — no real API key needed.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Config } from '../../../src/core/contracts.js';

const mockCreate = vi.fn();
const MockAnthropic = vi.fn().mockImplementation(() => ({
  messages: { create: mockCreate },
}));

vi.mock('@anthropic-ai/sdk', () => ({
  default: MockAnthropic,
}));

const { createAnthropicAdapter } = await import('../../../src/ai/adapters/anthropic.js');

function makeConfig(overrides: Record<string, string | undefined> = {}): Config {
  const values: Record<string, unknown> = {
    ANTHROPIC_API_KEY: 'sk-ant-test-key',
    ANTHROPIC_MODEL: 'claude-sonnet-4-20250514',
    ANTHROPIC_BASE_URL: undefined,
    ...overrides,
  };
  return {
    get: (key: string) => values[key],
    validate: () => ({ get: (k: string) => values[k] }),
    getAll: () => values,
  } as unknown as Config;
}

const standardResponse = {
  id: 'msg_anthropic_1',
  role: 'assistant',
  content: [{ type: 'text', text: 'Hello from Anthropic' }],
  model: 'claude-sonnet-4-20250514',
  stop_reason: 'end_turn',
  usage: { input_tokens: 50, output_tokens: 10 },
};

describe('Anthropic Adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates adapter with correct name', () => {
    const adapter = createAnthropicAdapter(makeConfig());
    expect(adapter.name).toBe('anthropic');
  });

  it('validates config requires ANTHROPIC_API_KEY', () => {
    const withKey = createAnthropicAdapter(makeConfig());
    expect(withKey.validateConfig()).toBe(true);

    const withoutKey = createAnthropicAdapter(makeConfig({ ANTHROPIC_API_KEY: undefined }));
    expect(withoutKey.validateConfig()).toBe(false);
  });

  it('initializes Anthropic client with API key', async () => {
    mockCreate.mockResolvedValueOnce(standardResponse);

    const adapter = createAnthropicAdapter(makeConfig());
    await adapter.sendMessage([{ role: 'user', content: 'hello' }], [], {});

    expect(MockAnthropic).toHaveBeenCalledWith({
      apiKey: 'sk-ant-test-key',
    });
  });

  it('initializes Anthropic client with custom baseURL', async () => {
    mockCreate.mockResolvedValueOnce(standardResponse);

    const adapter = createAnthropicAdapter(makeConfig({ ANTHROPIC_BASE_URL: 'https://custom.api.com' }));
    await adapter.sendMessage([{ role: 'user', content: 'hello' }], [], {});

    expect(MockAnthropic).toHaveBeenCalledWith({
      apiKey: 'sk-ant-test-key',
      baseURL: 'https://custom.api.com',
    });
  });

  it('sends messages in native Anthropic format', async () => {
    mockCreate.mockResolvedValueOnce({ ...standardResponse, id: 'msg_2' });

    const adapter = createAnthropicAdapter(makeConfig());
    const result = await adapter.sendMessage(
      [{ role: 'user', content: 'What is 2+2?' }],
      [],
      { system: 'You are a math tutor' },
    ) as Record<string, unknown>;

    expect(result.id).toBe('msg_2');
    expect(result.model).toBe('claude-sonnet-4-20250514');
    expect(result.stop_reason).toBe('end_turn');

    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: 'You are a math tutor',
    }));
  });

  it('passes tools in Anthropic format', async () => {
    mockCreate.mockResolvedValueOnce({
      id: 'msg_3',
      role: 'assistant',
      content: [{ type: 'tool_use', id: 'toolu_1', name: 'read_file', input: { path: '/test.ts' } }],
      model: 'claude-sonnet-4-20250514',
      stop_reason: 'tool_use',
      usage: { input_tokens: 200, output_tokens: 50 },
    });

    const adapter = createAnthropicAdapter(makeConfig());
    const result = await adapter.sendMessage(
      [{ role: 'user', content: 'Read test.ts' }],
      [{ name: 'read_file', description: 'Read a file', category: 'file', inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] }, execute: async () => ({}) }],
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
      id: 'msg_4',
      usage: {
        input_tokens: 150,
        output_tokens: 30,
        cache_creation_input_tokens: 100,
        cache_read_input_tokens: 50,
      },
    });

    const adapter = createAnthropicAdapter(makeConfig());
    const result = await adapter.sendMessage(
      [{ role: 'user', content: 'hello' }], [], {},
    ) as { usage: Record<string, number> };

    expect(result.usage.input_tokens).toBe(150);
    expect(result.usage.output_tokens).toBe(30);
    expect(result.usage.cache_creation_input_tokens).toBe(100);
    expect(result.usage.cache_read_input_tokens).toBe(50);
  });

  it('allows model override via options', async () => {
    mockCreate.mockResolvedValueOnce({ ...standardResponse, model: 'claude-opus-4-20250514' });

    const adapter = createAnthropicAdapter(makeConfig());
    await adapter.sendMessage([{ role: 'user', content: 'hi' }], [], { model: 'claude-opus-4-20250514' });

    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({
      model: 'claude-opus-4-20250514',
    }));
  });

  it('throws when API key is missing at call time', async () => {
    const adapter = createAnthropicAdapter(makeConfig({ ANTHROPIC_API_KEY: undefined }));
    await expect(
      adapter.sendMessage([{ role: 'user', content: 'hi' }], [], {}),
    ).rejects.toThrow('ANTHROPIC_API_KEY is not configured');
  });

  it('passes temperature when provided', async () => {
    mockCreate.mockResolvedValueOnce(standardResponse);

    const adapter = createAnthropicAdapter(makeConfig());
    await adapter.sendMessage([{ role: 'user', content: 'hi' }], [], { temperature: 0.7 });

    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({
      temperature: 0.7,
    }));
  });
});
