/**
 * OpenAI Adapter Tests
 *
 * Tests the OpenAI adapter including the Anthropic → OpenAI format translation.
 * Verifies the text batching fix (multiple text blocks → single message).
 * Uses mocked OpenAI SDK — no real API key needed.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Config } from '../../../src/core/contracts.js';

const mockCreate = vi.fn();
const MockOpenAI = vi.fn().mockImplementation(() => ({
  chat: { completions: { create: mockCreate } },
}));

vi.mock('openai', () => ({
  default: MockOpenAI,
}));

const { createOpenAIAdapter } = await import('../../../src/ai/adapters/openai.js');

function makeConfig(overrides: Record<string, string | undefined> = {}): Config {
  const values: Record<string, unknown> = {
    OPENAI_API_KEY: 'sk-test-openai-key',
    OPENAI_MODEL: 'gpt-4o',
    ...overrides,
  };
  return {
    get: (key: string) => values[key],
    validate: () => ({ get: (k: string) => values[k] }),
    getAll: () => values,
  } as unknown as Config;
}

const standardOpenAIResponse = {
  id: 'chatcmpl-1',
  choices: [{
    message: { role: 'assistant', content: 'Hello from OpenAI', tool_calls: null },
    finish_reason: 'stop',
    index: 0,
  }],
  model: 'gpt-4o',
  usage: { prompt_tokens: 50, completion_tokens: 10, total_tokens: 60 },
};

describe('OpenAI Adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates adapter with correct name', () => {
    const adapter = createOpenAIAdapter(makeConfig());
    expect(adapter.name).toBe('openai');
  });

  it('validates config requires OPENAI_API_KEY', () => {
    const withKey = createOpenAIAdapter(makeConfig());
    expect(withKey.validateConfig()).toBe(true);

    const withoutKey = createOpenAIAdapter(makeConfig({ OPENAI_API_KEY: undefined }));
    expect(withoutKey.validateConfig()).toBe(false);
  });

  it('sends messages and translates response to Anthropic format', async () => {
    mockCreate.mockResolvedValueOnce(standardOpenAIResponse);

    const adapter = createOpenAIAdapter(makeConfig());
    const result = await adapter.sendMessage(
      [{ role: 'user', content: 'Hello' }],
      [],
      {},
    ) as Record<string, unknown>;

    expect(result.id).toBe('chatcmpl-1');
    expect(result.role).toBe('assistant');
    expect(result.model).toBe('gpt-4o');
    expect(result.stop_reason).toBe('end_turn');
    expect((result.content as Array<Record<string, unknown>>)[0]).toEqual({
      type: 'text',
      text: 'Hello from OpenAI',
    });
    expect((result.usage as Record<string, number>).input_tokens).toBe(50);
    expect((result.usage as Record<string, number>).output_tokens).toBe(10);
  });

  it('translates tool_use response from OpenAI format', async () => {
    mockCreate.mockResolvedValueOnce({
      id: 'chatcmpl-2',
      choices: [{
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [{
            id: 'call_1',
            type: 'function',
            function: { name: 'read_file', arguments: '{"path":"/test.ts"}' },
          }],
        },
        finish_reason: 'tool_calls',
        index: 0,
      }],
      model: 'gpt-4o',
      usage: { prompt_tokens: 200, completion_tokens: 50, total_tokens: 250 },
    });

    const adapter = createOpenAIAdapter(makeConfig());
    const result = await adapter.sendMessage(
      [{ role: 'user', content: 'Read test.ts' }],
      [{ name: 'read_file', description: 'Read a file', category: 'file', inputSchema: { type: 'object' }, execute: async () => ({}) }],
      {},
    ) as Record<string, unknown>;

    expect(result.stop_reason).toBe('tool_use');
    const content = result.content as Array<Record<string, unknown>>;
    expect(content[0].type).toBe('tool_use');
    expect(content[0].id).toBe('call_1');
    expect(content[0].name).toBe('read_file');
    expect(content[0].input).toEqual({ path: '/test.ts' });
  });

  describe('text batching fix', () => {
    it('batches multiple text blocks into single message (not duplicates)', async () => {
      mockCreate.mockResolvedValueOnce(standardOpenAIResponse);

      const adapter = createOpenAIAdapter(makeConfig());
      await adapter.sendMessage(
        [{
          role: 'assistant',
          content: [
            { type: 'text', text: 'Part 1' },
            { type: 'text', text: 'Part 2' },
            { type: 'text', text: 'Part 3' },
          ],
        }, {
          role: 'user',
          content: 'Continue',
        }],
        [],
        {},
      );

      const calledMessages = mockCreate.mock.calls[0][0].messages;
      // Should have ONE assistant message (batched), then one user message
      const assistantMsgs = calledMessages.filter((m: Record<string, string>) => m.role === 'assistant');
      expect(assistantMsgs).toHaveLength(1);
      expect(assistantMsgs[0].content).toBe('Part 1\nPart 2\nPart 3');
    });

    it('handles mixed text and tool_use blocks correctly', async () => {
      mockCreate.mockResolvedValueOnce(standardOpenAIResponse);

      const adapter = createOpenAIAdapter(makeConfig());
      await adapter.sendMessage(
        [{
          role: 'assistant',
          content: [
            { type: 'text', text: 'Thinking...' },
            { type: 'tool_use', id: 'tc_1', name: 'read_file', input: { path: '/a.ts' } },
          ],
        }],
        [],
        {},
      );

      const calledMessages = mockCreate.mock.calls[0][0].messages;
      // Text should be one message, tool_use should be another
      expect(calledMessages).toHaveLength(2);
      expect(calledMessages[0].content).toBe('Thinking...');
      expect(calledMessages[1].tool_calls).toBeDefined();
      expect(calledMessages[1].tool_calls[0].function.name).toBe('read_file');
    });

    it('handles tool_result blocks', async () => {
      mockCreate.mockResolvedValueOnce(standardOpenAIResponse);

      const adapter = createOpenAIAdapter(makeConfig());
      await adapter.sendMessage(
        [{
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 'tc_1', content: 'file contents here' },
          ],
        }],
        [],
        {},
      );

      const calledMessages = mockCreate.mock.calls[0][0].messages;
      const toolMsg = calledMessages.find((m: Record<string, string>) => m.role === 'tool');
      expect(toolMsg).toBeDefined();
      expect(toolMsg.tool_call_id).toBe('tc_1');
      expect(toolMsg.content).toBe('file contents here');
    });
  });

  it('passes system prompt as system message', async () => {
    mockCreate.mockResolvedValueOnce(standardOpenAIResponse);

    const adapter = createOpenAIAdapter(makeConfig());
    await adapter.sendMessage(
      [{ role: 'user', content: 'hi' }],
      [],
      { system: 'You are a helpful assistant' },
    );

    const calledMessages = mockCreate.mock.calls[0][0].messages;
    expect(calledMessages[0]).toEqual({ role: 'system', content: 'You are a helpful assistant' });
  });

  it('converts tools to OpenAI function format', async () => {
    mockCreate.mockResolvedValueOnce(standardOpenAIResponse);

    const adapter = createOpenAIAdapter(makeConfig());
    await adapter.sendMessage(
      [{ role: 'user', content: 'help' }],
      [{
        name: 'bash',
        description: 'Run a shell command',
        category: 'shell',
        inputSchema: { type: 'object', properties: { command: { type: 'string' } } },
        execute: async () => ({}),
      }],
      {},
    );

    const calledTools = mockCreate.mock.calls[0][0].tools;
    expect(calledTools).toHaveLength(1);
    expect(calledTools[0]).toEqual({
      type: 'function',
      function: {
        name: 'bash',
        description: 'Run a shell command',
        parameters: { type: 'object', properties: { command: { type: 'string' } } },
      },
    });
  });

  it('throws when API key is missing at call time', async () => {
    const adapter = createOpenAIAdapter(makeConfig({ OPENAI_API_KEY: undefined }));
    await expect(
      adapter.sendMessage([{ role: 'user', content: 'hi' }], [], {}),
    ).rejects.toThrow('OPENAI_API_KEY is not configured');
  });

  it('allows model override via options', async () => {
    mockCreate.mockResolvedValueOnce({ ...standardOpenAIResponse, model: 'gpt-4-turbo' });

    const adapter = createOpenAIAdapter(makeConfig());
    await adapter.sendMessage([{ role: 'user', content: 'hi' }], [], { model: 'gpt-4-turbo' });

    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({
      model: 'gpt-4-turbo',
    }));
  });
});
