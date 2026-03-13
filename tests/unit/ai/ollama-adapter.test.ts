/**
 * Ollama Adapter Tests
 *
 * Tests the Ollama local LLM adapter.
 * Uses mocked fetch() — no real Ollama instance needed.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Config } from '../../../src/core/contracts.js';

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const { createOllamaAdapter } = await import('../../../src/ai/adapters/ollama.js');

function makeConfig(overrides: Record<string, string | undefined> = {}): Config {
  const values: Record<string, unknown> = {
    OLLAMA_BASE_URL: 'http://localhost:11434',
    OLLAMA_MODEL: 'llama3',
    ...overrides,
  };
  return {
    get: (key: string) => values[key],
    validate: () => ({ get: (k: string) => values[k] }),
    getAll: () => values,
  } as unknown as Config;
}

function makeOllamaResponse(content: string, overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    json: async () => ({
      model: 'llama3',
      message: { role: 'assistant', content },
      done: true,
      eval_count: 50,
      prompt_eval_count: 100,
      ...overrides,
    }),
    text: async () => content,
  };
}

describe('Ollama Adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates adapter with correct name', () => {
    const adapter = createOllamaAdapter(makeConfig());
    expect(adapter.name).toBe('ollama');
  });

  it('validates config always returns true (no API key needed)', () => {
    const adapter = createOllamaAdapter(makeConfig());
    expect(adapter.validateConfig()).toBe(true);
  });

  it('sends messages to local Ollama endpoint', async () => {
    mockFetch.mockResolvedValueOnce(makeOllamaResponse('Hello from Ollama'));

    const adapter = createOllamaAdapter(makeConfig());
    const result = await adapter.sendMessage(
      [{ role: 'user', content: 'Hello' }],
      [],
      {},
    ) as Record<string, unknown>;

    expect(result.role).toBe('assistant');
    expect(result.model).toBe('llama3');
    expect(result.stop_reason).toBe('end_turn');
    const content = result.content as Array<Record<string, unknown>>;
    expect(content[0]).toEqual({ type: 'text', text: 'Hello from Ollama' });

    // Verify fetch was called with correct URL and body
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:11434/api/chat',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.model).toBe('llama3');
    expect(body.stream).toBe(false);
  });

  it('translates Anthropic content blocks to Ollama text format', async () => {
    mockFetch.mockResolvedValueOnce(makeOllamaResponse('Response'));

    const adapter = createOllamaAdapter(makeConfig());
    await adapter.sendMessage(
      [{
        role: 'assistant',
        content: [
          { type: 'text', text: 'Thinking about it...' },
          { type: 'tool_use', name: 'bash', input: { command: 'ls' } },
        ],
      }, {
        role: 'user',
        content: [
          { type: 'tool_result', content: 'file1.ts\nfile2.ts' },
        ],
      }],
      [],
      {},
    );

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    // Ollama flattens content blocks to text
    expect(body.messages[0].content).toContain('Thinking about it...');
    expect(body.messages[0].content).toContain('[Tool Call: bash');
    expect(body.messages[1].content).toContain('[Tool Result: file1.ts');
  });

  it('injects system prompt', async () => {
    mockFetch.mockResolvedValueOnce(makeOllamaResponse('Yes'));

    const adapter = createOllamaAdapter(makeConfig());
    await adapter.sendMessage(
      [{ role: 'user', content: 'hi' }],
      [],
      { system: 'You are a coding assistant' },
    );

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.messages[0]).toEqual({ role: 'system', content: 'You are a coding assistant' });
    expect(body.messages[1]).toEqual({ role: 'user', content: 'hi' });
  });

  it('injects tool descriptions in system prompt when tools present and no system', async () => {
    mockFetch.mockResolvedValueOnce(makeOllamaResponse('I will read the file'));

    const adapter = createOllamaAdapter(makeConfig());
    await adapter.sendMessage(
      [{ role: 'user', content: 'read file' }],
      [{ name: 'read_file', description: 'Read a file', category: 'file', inputSchema: {}, execute: async () => ({}) }],
      {},
    );

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    const systemMsg = body.messages.find((m: Record<string, string>) => m.role === 'system');
    expect(systemMsg).toBeDefined();
    expect(systemMsg.content).toContain('read_file');
    expect(systemMsg.content).toContain('Read a file');
  });

  it('detects tool calls from JSON response', async () => {
    const toolCallJson = JSON.stringify({ tool: 'read_file', input: { path: '/test.ts' } });
    mockFetch.mockResolvedValueOnce(makeOllamaResponse(toolCallJson));

    const adapter = createOllamaAdapter(makeConfig());
    const result = await adapter.sendMessage(
      [{ role: 'user', content: 'read test.ts' }],
      [{ name: 'read_file', description: 'Read a file', category: 'file', inputSchema: {}, execute: async () => ({}) }],
      {},
    ) as Record<string, unknown>;

    expect(result.stop_reason).toBe('tool_use');
    const content = result.content as Array<Record<string, unknown>>;
    expect(content[0].type).toBe('tool_use');
    expect(content[0].name).toBe('read_file');
    expect(content[0].input).toEqual({ path: '/test.ts' });
  });

  it('handles non-JSON response as normal text', async () => {
    mockFetch.mockResolvedValueOnce(makeOllamaResponse('Just a regular text response'));

    const adapter = createOllamaAdapter(makeConfig());
    const result = await adapter.sendMessage(
      [{ role: 'user', content: 'hello' }],
      [],
      {},
    ) as Record<string, unknown>;

    expect(result.stop_reason).toBe('end_turn');
    const content = result.content as Array<Record<string, unknown>>;
    expect(content[0].type).toBe('text');
    expect(content[0].text).toBe('Just a regular text response');
  });

  it('reports token usage from eval counts', async () => {
    mockFetch.mockResolvedValueOnce(makeOllamaResponse('hi', {
      eval_count: 42,
      prompt_eval_count: 100,
    }));

    const adapter = createOllamaAdapter(makeConfig());
    const result = await adapter.sendMessage(
      [{ role: 'user', content: 'hi' }], [], {},
    ) as Record<string, unknown>;

    const usage = result.usage as Record<string, number>;
    expect(usage.input_tokens).toBe(100);
    expect(usage.output_tokens).toBe(42);
  });

  it('throws on HTTP error', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => 'Internal Server Error',
    });

    const adapter = createOllamaAdapter(makeConfig());
    await expect(
      adapter.sendMessage([{ role: 'user', content: 'hi' }], [], {}),
    ).rejects.toThrow('Ollama API error 500');
  });

  it('allows model override via options', async () => {
    mockFetch.mockResolvedValueOnce(makeOllamaResponse('hi', { model: 'mistral' }));

    const adapter = createOllamaAdapter(makeConfig());
    await adapter.sendMessage(
      [{ role: 'user', content: 'hi' }], [], { model: 'mistral' },
    );

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.model).toBe('mistral');
  });
});
