/**
 * Context Manager Tests
 *
 * Tests token estimation, budget allocation, message pruning,
 * and context metrics for AI conversation management.
 */

import { describe, it, expect } from 'vitest';
import {
  estimateTokens,
  estimateContentBlockTokens,
  estimateMessageTokens,
  getProviderContextWindow,
  allocateBudget,
  pruneMessages,
  getContextMetrics,
} from '../../../src/agents/context-manager.js';

// ── Token Estimation ────────────────────────────────────────────────────────

describe('estimateTokens', () => {
  it('returns 0 for an empty string', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('returns 0 for a null-ish value', () => {
    // The function guards with `if (!text)` so undefined/null coerced to falsy
    expect(estimateTokens(undefined as unknown as string)).toBe(0);
    expect(estimateTokens(null as unknown as string)).toBe(0);
  });

  it('estimates plain English text at ~4 chars per token', () => {
    const text = 'Hello world'; // 11 chars => ceil(11/4) = 3
    expect(estimateTokens(text)).toBe(3);
  });

  it('estimates longer plain text correctly', () => {
    const text = 'a'.repeat(100); // 100 chars => ceil(100/4) = 25
    expect(estimateTokens(text)).toBe(25);
  });

  it('estimates JSON content at ~3.5 chars per token', () => {
    const json = '{"key": "value", "count": 42}'; // starts with '{', 29 chars => ceil(29/3.5) = 9
    expect(estimateTokens(json)).toBe(Math.ceil(29 / 3.5));
  });

  it('estimates array JSON at ~3.5 chars per token', () => {
    const json = '[1, 2, 3, 4, 5]'; // starts with '[', 15 chars => ceil(15/3.5) = 5
    expect(estimateTokens(json)).toBe(Math.ceil(15 / 3.5));
  });

  it('estimates code with "function " keyword at ~3.5 chars per token', () => {
    const code = 'const x = function (a, b) { return a + b; }';
    expect(estimateTokens(code)).toBe(Math.ceil(code.length / 3.5));
  });

  it('uses 4 chars per token for text that merely contains braces mid-string', () => {
    // Does not start with '{' or '[', does not contain 'function '
    const text = 'The result was {unknown} at the time';
    expect(estimateTokens(text)).toBe(Math.ceil(text.length / 4));
  });

  it('handles a single character', () => {
    expect(estimateTokens('x')).toBe(1); // ceil(1/4) = 1
  });
});

// ── Content Block Token Estimation ──────────────────────────────────────────

describe('estimateContentBlockTokens', () => {
  it('returns 0 for an empty array', () => {
    expect(estimateContentBlockTokens([])).toBe(0);
  });

  it('estimates a single text block', () => {
    const blocks = [{ type: 'text' as const, text: 'Hello world' }];
    expect(estimateContentBlockTokens(blocks)).toBe(estimateTokens('Hello world'));
  });

  it('estimates a thinking block', () => {
    const thinking = 'Let me analyze this problem carefully.';
    const blocks = [{ type: 'thinking' as const, thinking }];
    expect(estimateContentBlockTokens(blocks)).toBe(estimateTokens(thinking));
  });

  it('estimates a tool_use block with overhead', () => {
    const input = { command: 'ls -la', cwd: '/home' };
    const blocks = [{ type: 'tool_use' as const, id: 'tu_1', name: 'bash', input }];
    const expected = estimateTokens(JSON.stringify(input)) + 20;
    expect(estimateContentBlockTokens(blocks)).toBe(expected);
  });

  it('estimates a tool_result block', () => {
    const content = 'file1.txt\nfile2.txt\nfile3.txt';
    const blocks = [{ type: 'tool_result' as const, tool_use_id: 'tu_1', content }];
    expect(estimateContentBlockTokens(blocks)).toBe(estimateTokens(content));
  });

  it('sums tokens across mixed block types', () => {
    const blocks = [
      { type: 'text' as const, text: 'I will run a command.' },
      { type: 'tool_use' as const, id: 'tu_1', name: 'bash', input: { cmd: 'echo hi' } },
      { type: 'tool_result' as const, tool_use_id: 'tu_1', content: 'hi' },
      { type: 'thinking' as const, thinking: 'That worked.' },
    ];
    const expected =
      estimateTokens('I will run a command.') +
      estimateTokens(JSON.stringify({ cmd: 'echo hi' })) + 20 +
      estimateTokens('hi') +
      estimateTokens('That worked.');
    expect(estimateContentBlockTokens(blocks)).toBe(expected);
  });

  it('skips text blocks with missing text property', () => {
    const blocks = [{ type: 'text' as const }]; // no .text
    expect(estimateContentBlockTokens(blocks)).toBe(0);
  });

  it('skips tool_use blocks with missing input property', () => {
    const blocks = [{ type: 'tool_use' as const, id: 'tu_1', name: 'bash' }]; // no .input
    expect(estimateContentBlockTokens(blocks)).toBe(0);
  });
});

// ── Message Token Estimation ────────────────────────────────────────────────

describe('estimateMessageTokens', () => {
  it('estimates a message with string content (adds 4 for role overhead)', () => {
    const msg = { role: 'user' as const, content: 'Hello' };
    expect(estimateMessageTokens(msg)).toBe(estimateTokens('Hello') + 4);
  });

  it('estimates a message with content block array (adds 4 for role overhead)', () => {
    const msg = {
      role: 'assistant' as const,
      content: [{ type: 'text' as const, text: 'Sure, I can help.' }],
    };
    expect(estimateMessageTokens(msg)).toBe(estimateTokens('Sure, I can help.') + 4);
  });

  it('role overhead is always 4 regardless of role type', () => {
    const user = { role: 'user' as const, content: 'test' };
    const asst = { role: 'assistant' as const, content: 'test' };
    // Both should have the same token count since content is identical
    expect(estimateMessageTokens(user)).toBe(estimateMessageTokens(asst));
  });
});

// ── Provider Context Windows ────────────────────────────────────────────────

describe('getProviderContextWindow', () => {
  it('returns 200000 for anthropic', () => {
    expect(getProviderContextWindow('anthropic')).toBe(200_000);
  });

  it('returns 204800 for minimax', () => {
    expect(getProviderContextWindow('minimax')).toBe(204_800);
  });

  it('returns 128000 for openai', () => {
    expect(getProviderContextWindow('openai')).toBe(128_000);
  });

  it('returns 8000 for ollama', () => {
    expect(getProviderContextWindow('ollama')).toBe(8_000);
  });

  it('returns 128000 as fallback for an unknown provider', () => {
    expect(getProviderContextWindow('unknown-provider')).toBe(128_000);
  });
});

// ── Budget Allocation ───────────────────────────────────────────────────────

describe('allocateBudget', () => {
  it('returns the correct total for the provider', () => {
    const budget = allocateBudget('anthropic', 1000);
    expect(budget.total).toBe(200_000);
  });

  it('reserves the system prompt tokens', () => {
    const budget = allocateBudget('anthropic', 5000);
    expect(budget.systemPrompt).toBe(5000);
  });

  it('uses default responseReserve of 4096 when not specified', () => {
    const budget = allocateBudget('anthropic', 1000);
    // reserved = 4096 + ceil(200000 * 0.05) = 4096 + 10000 = 14096
    expect(budget.reserved).toBe(4096 + Math.ceil(200_000 * 0.05));
  });

  it('accepts a custom responseReserve', () => {
    const budget = allocateBudget('anthropic', 1000, 8192);
    // reserved = 8192 + ceil(200000 * 0.05) = 8192 + 10000 = 18192
    expect(budget.reserved).toBe(8192 + Math.ceil(200_000 * 0.05));
  });

  it('splits available tokens 80/20 between history and toolResults', () => {
    const budget = allocateBudget('anthropic', 1000);
    // total=200000, reserved=14096, available=200000-1000-14096=184904
    // history=floor(184904*0.8)=147923, toolResults=184904-147923=36981
    const available = 200_000 - 1000 - budget.reserved;
    expect(budget.history).toBe(Math.floor(available * 0.8));
    expect(budget.toolResults).toBe(available - Math.floor(available * 0.8));
  });

  it('enforces minimum 1000 tokens for history', () => {
    // Use ollama (8000 total) with a large system prompt to squeeze history
    // total=8000, reserved=4096+400=4496, available=8000-7000-4496=-3496
    // floor(-3496*0.8)=-2797 => max(-2797,1000) = 1000
    const budget = allocateBudget('ollama', 7000);
    expect(budget.history).toBeGreaterThanOrEqual(1000);
  });

  it('enforces minimum 500 tokens for toolResults', () => {
    const budget = allocateBudget('ollama', 7000);
    expect(budget.toolResults).toBeGreaterThanOrEqual(500);
  });

  it('works correctly for minimax provider', () => {
    const budget = allocateBudget('minimax', 2000);
    expect(budget.total).toBe(204_800);
    // reserved = 4096 + ceil(204800 * 0.05) = 4096 + 10240 = 14336
    expect(budget.reserved).toBe(4096 + Math.ceil(204_800 * 0.05));
  });
});

// ── Message Pruning ─────────────────────────────────────────────────────────

describe('pruneMessages', () => {
  // Helper to create simple messages
  function userMsg(text: string) {
    return { role: 'user' as const, content: text };
  }
  function assistantMsg(text: string) {
    return { role: 'assistant' as const, content: text };
  }

  it('returns all messages unchanged when under budget', () => {
    const messages = [userMsg('Hello'), assistantMsg('Hi there')];
    const budget = allocateBudget('anthropic', 100);
    const result = pruneMessages(messages, budget, 10);
    expect(result.prunedCount).toBe(0);
    expect(result.messages).toHaveLength(2);
  });

  it('sets budgetUsed as a ratio of totalTokens to history budget', () => {
    const messages = [userMsg('Hello'), assistantMsg('Hi')];
    const budget = allocateBudget('anthropic', 100);
    const result = pruneMessages(messages, budget, 10);
    expect(result.budgetUsed).toBeGreaterThan(0);
    expect(result.budgetUsed).toBeLessThanOrEqual(1);
  });

  it('prunes oldest non-anchored messages when over budget', () => {
    // Each message ~300 chars => ~75+4=79 tokens. 30 messages => ~2370 tokens.
    // ollama budget: total=8000, reserved=2000+400=2400, available=8000-3000-2400=2600
    // history=max(floor(2600*0.8),1000)=2080. 2370 > 2080, so pruning kicks in.
    const padding = 'x'.repeat(280);
    const messages = Array.from({ length: 30 }, (_, i) =>
      i % 2 === 0 ? userMsg(`User ${i} ${padding}`) : assistantMsg(`Assistant ${i} ${padding}`),
    );
    const budget = allocateBudget('ollama', 3000, 2000);
    const result = pruneMessages(messages, budget, 5);
    expect(result.prunedCount).toBeGreaterThan(0);
    expect(result.messages.length).toBeLessThan(messages.length);
  });

  it('preserves anchored messages with [EXIT DOCUMENT]', () => {
    const messages = [
      userMsg('Old message 1'),
      assistantMsg('Old response 1'),
      userMsg('[EXIT DOCUMENT] Phase 1 completed with all criteria met.'),
      userMsg('Old message 2'),
      assistantMsg('Old response 2'),
      userMsg('Recent 1'),
      assistantMsg('Recent 2'),
    ];
    const budget = allocateBudget('ollama', 3000, 2000);
    const result = pruneMessages(messages, budget, 2);
    const hasExitDoc = result.messages.some(
      m => typeof m.content === 'string' && m.content.includes('[EXIT DOCUMENT]'),
    );
    expect(hasExitDoc).toBe(true);
  });

  it('preserves anchored messages with [PHASE GATE]', () => {
    const messages = [
      userMsg('Early message'),
      assistantMsg('[PHASE GATE] Architecture review passed.'),
      userMsg('Middle message'),
      assistantMsg('Middle response'),
      userMsg('Recent'),
      assistantMsg('Recent response'),
    ];
    const budget = allocateBudget('ollama', 3000, 2000);
    const result = pruneMessages(messages, budget, 2);
    const hasPhaseGate = result.messages.some(
      m => typeof m.content === 'string' && m.content.includes('[PHASE GATE]'),
    );
    expect(hasPhaseGate).toBe(true);
  });

  it('preserves anchored messages with [MILESTONE]', () => {
    const messages = [
      userMsg('Old'),
      assistantMsg('[MILESTONE] v1.0 released'),
      userMsg('Recent'),
      assistantMsg('Recent response'),
    ];
    const budget = allocateBudget('ollama', 3000, 2000);
    const result = pruneMessages(messages, budget, 2);
    const hasMilestone = result.messages.some(
      m => typeof m.content === 'string' && m.content.includes('[MILESTONE]'),
    );
    expect(hasMilestone).toBe(true);
  });

  it('preserves anchored messages with [KEY DECISION]', () => {
    const messages = [
      userMsg('Old'),
      assistantMsg('[KEY DECISION] Using PostgreSQL over MongoDB.'),
      userMsg('Recent'),
      assistantMsg('Recent response'),
    ];
    const budget = allocateBudget('ollama', 3000, 2000);
    const result = pruneMessages(messages, budget, 2);
    const hasKeyDecision = result.messages.some(
      m => typeof m.content === 'string' && m.content.includes('[KEY DECISION]'),
    );
    expect(hasKeyDecision).toBe(true);
  });

  it('always keeps the most recent N messages (keepRecent parameter)', () => {
    const padding = 'x'.repeat(280);
    const messages = Array.from({ length: 30 }, (_, i) =>
      i % 2 === 0 ? userMsg(`User ${i} ${padding}`) : assistantMsg(`Assistant ${i} ${padding}`),
    );
    const budget = allocateBudget('ollama', 3000, 2000);
    const keepRecent = 4;
    const result = pruneMessages(messages, budget, keepRecent);

    // Pruning must have occurred for this test to be meaningful
    expect(result.prunedCount).toBeGreaterThan(0);

    // The last 4 original messages must appear in the result
    const lastFour = messages.slice(-keepRecent);
    for (const expected of lastFour) {
      const found = result.messages.some(
        m => typeof m.content === 'string' && m.content === expected.content,
      );
      expect(found).toBe(true);
    }
  });

  it('inserts a pruning notice when messages are removed', () => {
    const padding = 'x'.repeat(280);
    const messages = Array.from({ length: 30 }, (_, i) =>
      i % 2 === 0
        ? userMsg(`User message ${i} ${padding}`)
        : assistantMsg(`Assistant message ${i} ${padding}`),
    );
    const budget = allocateBudget('ollama', 3000, 2000);
    const result = pruneMessages(messages, budget, 4);

    expect(result.prunedCount).toBeGreaterThan(0);
    const hasNotice = result.messages.some(
      m => typeof m.content === 'string' && (m.content.includes('Context pruned') || m.content.includes('Context note')),
    );
    expect(hasNotice).toBe(true);
  });

  it('truncates large tool results within messages', () => {
    const largeContent = 'x'.repeat(10000);
    const messages = [
      userMsg('Run the command'),
      {
        role: 'assistant' as const,
        content: [
          { type: 'tool_result' as const, tool_use_id: 'tu_1', content: largeContent },
        ],
      },
      userMsg('Thanks'),
      assistantMsg('You are welcome'),
    ];
    // Use a budget where the tool result per-message allocation is small
    const budget = allocateBudget('ollama', 2000, 1000);
    const result = pruneMessages(messages, budget, 4);

    // Find the tool result message in the result
    const toolMsg = result.messages.find(
      m => Array.isArray(m.content) && m.content.some(b => b.type === 'tool_result'),
    );
    if (toolMsg && Array.isArray(toolMsg.content)) {
      const toolBlock = toolMsg.content.find(b => b.type === 'tool_result');
      if (toolBlock && toolBlock.content) {
        // Should be shorter than the original or contain truncation indicator
        const isTruncated =
          toolBlock.content.length < largeContent.length ||
          toolBlock.content.includes('truncated');
        expect(isTruncated).toBe(true);
      }
    }
  });

  it('returns prunedCount of 0 when no pruning is needed', () => {
    const messages = [userMsg('Hi'), assistantMsg('Hello')];
    const budget = allocateBudget('anthropic', 100);
    const result = pruneMessages(messages, budget, 10);
    expect(result.prunedCount).toBe(0);
  });

  it('returns totalTokens reflecting the final message set', () => {
    const messages = [userMsg('Hello'), assistantMsg('World')];
    const budget = allocateBudget('anthropic', 100);
    const result = pruneMessages(messages, budget, 10);
    const expectedTokens = messages.reduce(
      (sum, m) => sum + estimateMessageTokens(m), 0,
    );
    expect(result.totalTokens).toBe(expectedTokens);
  });
});

// ── Context Metrics ─────────────────────────────────────────────────────────

describe('getContextMetrics', () => {
  it('populates all fields correctly without pruneResult', () => {
    const provider = 'anthropic';
    const systemPrompt = 'You are a helpful assistant.';
    const messages = [
      { role: 'user' as const, content: 'Hello' },
      { role: 'assistant' as const, content: 'Hi there!' },
    ];

    const metrics = getContextMetrics(provider, systemPrompt, messages);

    expect(metrics.provider).toBe('anthropic');
    expect(metrics.windowSize).toBe(200_000);
    expect(metrics.systemPromptTokens).toBe(estimateTokens(systemPrompt));
    expect(metrics.historyTokens).toBe(
      messages.reduce((sum, m) => sum + estimateMessageTokens(m), 0),
    );
    expect(metrics.messageCount).toBe(2);
    expect(metrics.budgetUsed).toBeGreaterThan(0);
    expect(metrics.budgetUsed).toBeLessThan(1);
    expect(metrics.pruningActive).toBe(false);
    expect(metrics.prunedMessageCount).toBe(0);
  });

  it('reflects pruneResult when provided', () => {
    const provider = 'minimax';
    const systemPrompt = 'System instructions here.';
    const messages = [
      { role: 'user' as const, content: 'Hello' },
    ];
    const pruneResult = {
      messages,
      prunedCount: 5,
      totalTokens: 1000,
      budgetUsed: 0.3,
    };

    const metrics = getContextMetrics(provider, systemPrompt, messages, pruneResult);

    expect(metrics.pruningActive).toBe(true);
    expect(metrics.prunedMessageCount).toBe(5);
  });

  it('shows pruningActive as false when prunedCount is 0', () => {
    const pruneResult = {
      messages: [],
      prunedCount: 0,
      totalTokens: 0,
      budgetUsed: 0,
    };
    const metrics = getContextMetrics('openai', '', [], pruneResult);
    expect(metrics.pruningActive).toBe(false);
  });

  it('calculates budgetUsed as (systemPromptTokens + historyTokens) / windowSize', () => {
    const systemPrompt = 'a'.repeat(400); // 100 tokens at 4 chars/token
    const messages = [
      { role: 'user' as const, content: 'a'.repeat(400) }, // 100 + 4 overhead
    ];
    const metrics = getContextMetrics('anthropic', systemPrompt, messages);

    const expectedSystemTokens = estimateTokens(systemPrompt);
    const expectedHistoryTokens = estimateMessageTokens(messages[0]);
    const expectedBudgetUsed = (expectedSystemTokens + expectedHistoryTokens) / 200_000;

    expect(metrics.budgetUsed).toBeCloseTo(expectedBudgetUsed, 10);
  });

  it('works with an unknown provider (falls back to 128000 window)', () => {
    const metrics = getContextMetrics('custom-llm', 'prompt', [
      { role: 'user' as const, content: 'test' },
    ]);
    expect(metrics.windowSize).toBe(128_000);
  });
});
