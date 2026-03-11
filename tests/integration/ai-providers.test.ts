/**
 * AI Provider Integration Tests
 *
 * These tests hit real APIs. They only run when API keys are present in .env.
 * Run with: npx vitest run tests/integration/
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { config as loadDotenv } from 'dotenv';
import { config } from '../../src/core/config.js';
import { createAnthropicAdapter } from '../../src/ai/adapters/anthropic.js';
import { createMinimaxAdapter } from '../../src/ai/adapters/minimax.js';

loadDotenv();

// Only run if keys exist
const hasAnthropicKey = !!process.env.ANTHROPIC_API_KEY;
const hasMinimaxKey = !!process.env.MINIMAX_API_KEY;

beforeAll(() => {
  config.validate();
});

describe.skipIf(!hasAnthropicKey)('Anthropic Integration', () => {
  it('sends a simple message and gets a response', async () => {
    const adapter = createAnthropicAdapter(config);
    const response = await adapter.sendMessage(
      [{ role: 'user', content: 'Reply with exactly: "hello world"' }],
      [],
      { max_tokens: 100 },
    ) as { id: string; content: { type: string; text?: string }[]; stop_reason: string; usage: { input_tokens: number; output_tokens: number } };

    expect(response.id).toBeTruthy();
    expect(response.content.length).toBeGreaterThan(0);
    expect(response.content[0].type).toBe('text');
    expect(response.stop_reason).toBe('end_turn');
    expect(response.usage.input_tokens).toBeGreaterThan(0);
    expect(response.usage.output_tokens).toBeGreaterThan(0);
  }, 30000);

  it('handles tool use', async () => {
    const adapter = createAnthropicAdapter(config);
    const response = await adapter.sendMessage(
      [{ role: 'user', content: 'What time is it? Use the get_time tool.' }],
      [{
        name: 'get_time',
        description: 'Get the current time',
        inputSchema: { type: 'object', properties: {}, required: [] },
      }],
      { max_tokens: 200 },
    ) as { content: { type: string; name?: string }[]; stop_reason: string };

    expect(response.stop_reason).toBe('tool_use');
    const toolUse = response.content.find((c) => c.type === 'tool_use');
    expect(toolUse).toBeTruthy();
    expect(toolUse!.name).toBe('get_time');
  }, 30000);
});

describe.skipIf(!hasMinimaxKey)('MiniMax Integration (Anthropic-Compatible)', () => {
  it('sends a simple message and gets a response', async () => {
    const adapter = createMinimaxAdapter(config);
    const response = await adapter.sendMessage(
      [{ role: 'user', content: 'Reply with exactly: "hello world"' }],
      [],
      { max_tokens: 100 },
    ) as { id: string; content: { type: string; text?: string }[]; stop_reason: string; usage: { input_tokens: number; output_tokens: number } };

    expect(response.id).toBeTruthy();
    expect(response.content.length).toBeGreaterThan(0);
    expect(response.content[0].type).toBe('text');
    expect(response.stop_reason).toBe('end_turn');
    expect(response.usage.input_tokens).toBeGreaterThan(0);
    expect(response.usage.output_tokens).toBeGreaterThan(0);
  }, 30000);

  it('handles tool use', async () => {
    const adapter = createMinimaxAdapter(config);
    const response = await adapter.sendMessage(
      [{ role: 'user', content: 'What time is it? Use the get_time tool.' }],
      [{
        name: 'get_time',
        description: 'Get the current time',
        inputSchema: { type: 'object', properties: {}, required: [] },
      }],
      { max_tokens: 200 },
    ) as { content: { type: string; name?: string }[]; stop_reason: string };

    expect(response.stop_reason).toBe('tool_use');
    const toolUse = response.content.find((c) => c.type === 'tool_use');
    expect(toolUse).toBeTruthy();
    expect(toolUse!.name).toBe('get_time');
  }, 30000);
});
