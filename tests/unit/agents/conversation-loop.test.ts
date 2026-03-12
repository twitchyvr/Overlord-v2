/**
 * Conversation Loop Tests
 *
 * Tests the core conversation loop: message → AI → tool_use → execute → result → done
 * Uses mocked AI provider to simulate the loop without real API calls.
 */

import { describe, it, expect } from 'vitest';
import { runConversationLoop } from '../../../src/agents/conversation-loop.js';
import { ok, err } from '../../../src/core/contracts.js';
import { EventEmitter } from 'eventemitter3';
import type { AIProviderAPI, ToolRegistryAPI, BaseRoomLike, ToolDefinition, ToolContext } from '../../../src/core/contracts.js';

// Mock AI that returns a text response on first call
function createMockAI(responses: unknown[]): AIProviderAPI {
  let callIndex = 0;
  return {
    getAdapter: () => null,
    registerAdapter: () => {},
    sendMessage: async () => {
      const resp = responses[callIndex++];
      return ok(resp);
    },
  };
}

// Mock room
function createMockRoom(tools: string[] = ['bash', 'read_file']): BaseRoomLike {
  return {
    id: 'room_test',
    type: 'code-lab',
    config: {
      roomType: 'code-lab',
      floor: 'execution',
      tables: { focus: { chairs: 1, description: 'test' } },
      tools,
      fileScope: 'full',
      exitRequired: { type: 'test', fields: [] },
      escalation: {},
      provider: 'test',
    },
    getAllowedTools: () => tools,
    hasTool: (name: string) => tools.includes(name),
    get fileScope() { return 'full' as const; },
    get exitRequired() { return { type: 'test', fields: [] }; },
    get escalation() { return {}; },
    validateExitDocument: (doc: Record<string, unknown>) => ok(doc),
    validateExitDocumentValues: (doc: Record<string, unknown>) => ok(doc),
    buildContextInjection: () => ({
      roomType: 'code-lab',
      rules: ['Test rule'],
      tools,
      fileScope: 'full',
      exitTemplate: { type: 'test', fields: [] },
      outputFormat: null,
      escalation: {},
    }),
    getRules: () => ['Test rule'],
    getOutputFormat: () => null,
    // Lifecycle hooks
    onAgentEnter: () => ok(null),
    onAgentExit: () => ok(null),
    onBeforeToolCall: () => ok(null),
    onAfterToolCall: () => {},
    onMessage: () => {},
    setBus: () => {},
  };
}

// Mock tools registry
function createMockTools(): ToolRegistryAPI {
  const toolDefs: ToolDefinition[] = [
    {
      name: 'bash',
      description: 'Execute bash',
      category: 'shell',
      inputSchema: { type: 'object' },
      execute: async (p: Record<string, unknown>) => ({ output: `executed: ${p.command}` }),
    },
    {
      name: 'read_file',
      description: 'Read file',
      category: 'file',
      inputSchema: { type: 'object' },
      execute: async (p: Record<string, unknown>) => ({ content: `contents of ${p.path}` }),
    },
  ];

  return {
    registerTool: () => {},
    getTool: (name: string) => toolDefs.find((t) => t.name === name) || null,
    getToolsForRoom: (allowed: string[]) => toolDefs.filter((t) => allowed.includes(t.name)),
    executeInRoom: async (params: {
      toolName: string;
      params: Record<string, unknown>;
      roomAllowedTools: string[];
      context: ToolContext;
    }) => {
      if (!params.roomAllowedTools.includes(params.toolName)) {
        return { ok: false as const, error: { code: 'TOOL_NOT_AVAILABLE', message: 'Not allowed', retryable: false } };
      }
      const tool = toolDefs.find((t) => t.name === params.toolName);
      if (!tool) {
        return { ok: false as const, error: { code: 'TOOL_NOT_FOUND', message: 'Not found', retryable: false } };
      }
      const result = await tool.execute(params.params);
      return ok(result);
    },
  };
}

// Mock bus
function createMockBus() {
  const ee = new EventEmitter();
  return {
    emit: (event: string | symbol, data?: Record<string, unknown>) => {
      ee.emit(event, data);
      return true;
    },
    on: ee.on.bind(ee),
    onNamespace: () => {},
  } as unknown as import('../../../src/core/bus.js').Bus;
}

describe('Conversation Loop', () => {
  it('completes a simple text response (no tool use)', async () => {
    const ai = createMockAI([{
      id: 'msg_1',
      role: 'assistant',
      content: [{ type: 'text', text: 'Hello, I am ready to help.' }],
      model: 'test',
      stop_reason: 'end_turn',
      usage: { input_tokens: 10, output_tokens: 20 },
    }]);

    const result = await runConversationLoop({
      provider: 'anthropic',
      room: createMockRoom(),
      agentId: 'agent_1',
      messages: [{ role: 'user', content: 'Hello' }],
      ai,
      tools: createMockTools(),
      bus: createMockBus(),
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.finalText).toBe('Hello, I am ready to help.');
      expect(result.data.thinking).toEqual([]);
      expect(result.data.toolCalls.length).toBe(0);
      expect(result.data.iterations).toBe(1);
      expect(result.data.totalTokens.input).toBe(10);
      expect(result.data.totalTokens.output).toBe(20);
    }
  });

  it('executes a tool use loop', async () => {
    const ai = createMockAI([
      // First response: tool_use
      {
        id: 'msg_1',
        role: 'assistant',
        content: [{
          type: 'tool_use',
          id: 'tc_1',
          name: 'bash',
          input: { command: 'ls' },
        }],
        model: 'test',
        stop_reason: 'tool_use',
        usage: { input_tokens: 10, output_tokens: 5 },
      },
      // Second response: final text
      {
        id: 'msg_2',
        role: 'assistant',
        content: [{ type: 'text', text: 'I listed the files.' }],
        model: 'test',
        stop_reason: 'end_turn',
        usage: { input_tokens: 15, output_tokens: 10 },
      },
    ]);

    const result = await runConversationLoop({
      provider: 'anthropic',
      room: createMockRoom(),
      agentId: 'agent_1',
      messages: [{ role: 'user', content: 'List files' }],
      ai,
      tools: createMockTools(),
      bus: createMockBus(),
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.finalText).toBe('I listed the files.');
      expect(result.data.toolCalls.length).toBe(1);
      expect(result.data.toolCalls[0].name).toBe('bash');
      expect(result.data.iterations).toBe(2);
      expect(result.data.totalTokens.input).toBe(25);
      expect(result.data.totalTokens.output).toBe(15);
    }
  });

  it('handles multiple tool calls in sequence', async () => {
    const ai = createMockAI([
      {
        id: 'msg_1',
        role: 'assistant',
        content: [{
          type: 'tool_use',
          id: 'tc_1',
          name: 'read_file',
          input: { path: 'src/main.ts' },
        }],
        model: 'test',
        stop_reason: 'tool_use',
        usage: { input_tokens: 10, output_tokens: 5 },
      },
      {
        id: 'msg_2',
        role: 'assistant',
        content: [{
          type: 'tool_use',
          id: 'tc_2',
          name: 'bash',
          input: { command: 'npm test' },
        }],
        model: 'test',
        stop_reason: 'tool_use',
        usage: { input_tokens: 20, output_tokens: 5 },
      },
      {
        id: 'msg_3',
        role: 'assistant',
        content: [{ type: 'text', text: 'All done.' }],
        model: 'test',
        stop_reason: 'end_turn',
        usage: { input_tokens: 25, output_tokens: 10 },
      },
    ]);

    const result = await runConversationLoop({
      provider: 'anthropic',
      room: createMockRoom(),
      agentId: 'agent_1',
      messages: [{ role: 'user', content: 'Read and test' }],
      ai,
      tools: createMockTools(),
      bus: createMockBus(),
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.toolCalls.length).toBe(2);
      expect(result.data.toolCalls[0].name).toBe('read_file');
      expect(result.data.toolCalls[1].name).toBe('bash');
      expect(result.data.iterations).toBe(3);
    }
  });

  it('captures thinking blocks from MiniMax M2.5 responses', async () => {
    const ai = createMockAI([{
      id: 'msg_1',
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: 'Let me think about this carefully...', signature: 'sig_123' },
        { type: 'text', text: 'Here is my answer.' },
      ],
      model: 'MiniMax-M2.5',
      stop_reason: 'end_turn',
      usage: { input_tokens: 10, output_tokens: 30 },
    }]);

    const result = await runConversationLoop({
      provider: 'minimax',
      room: createMockRoom(),
      agentId: 'agent_1',
      messages: [{ role: 'user', content: 'Think about this' }],
      ai,
      tools: createMockTools(),
      bus: createMockBus(),
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.finalText).toBe('Here is my answer.');
      expect(result.data.thinking).toEqual(['Let me think about this carefully...']);
      expect(result.data.iterations).toBe(1);
    }
  });

  it('propagates non-retryable AI errors immediately', async () => {
    const ai: AIProviderAPI = {
      getAdapter: () => null,
      registerAdapter: () => {},
      sendMessage: async () => ({
        ok: false as const,
        error: { code: 'AI_ERROR', message: 'Invalid API key', retryable: false },
      }),
    };

    const result = await runConversationLoop({
      provider: 'anthropic',
      room: createMockRoom(),
      agentId: 'agent_1',
      messages: [{ role: 'user', content: 'Hello' }],
      ai,
      tools: createMockTools(),
      bus: createMockBus(),
    });

    expect(result.ok).toBe(false);
  });

  it('retries transient AI failures before giving up', async () => {
    let callCount = 0;
    const ai: AIProviderAPI = {
      getAdapter: () => null,
      registerAdapter: () => {},
      sendMessage: async () => {
        callCount++;
        // Fail first 3 calls (1 initial + 2 retries), never succeed
        return {
          ok: false as const,
          error: { code: 'RATE_LIMIT', message: 'rate limit exceeded', retryable: true },
        };
      },
    };

    const result = await runConversationLoop({
      provider: 'anthropic',
      room: createMockRoom(),
      agentId: 'agent_1',
      messages: [{ role: 'user', content: 'Hello' }],
      ai,
      tools: createMockTools(),
      bus: createMockBus(),
    });

    expect(result.ok).toBe(false);
    // Should have been called 3 times: 1 initial + 2 retries
    expect(callCount).toBe(3);
  });

  it('succeeds after transient AI failure on retry', async () => {
    let callCount = 0;
    const ai: AIProviderAPI = {
      getAdapter: () => null,
      registerAdapter: () => {},
      sendMessage: async () => {
        callCount++;
        if (callCount === 1) {
          return {
            ok: false as const,
            error: { code: 'OVERLOADED', message: 'overloaded', retryable: true },
          };
        }
        return ok({
          id: 'msg_1',
          role: 'assistant',
          content: [{ type: 'text', text: 'Recovered!' }],
          model: 'test',
          stop_reason: 'end_turn',
          usage: { input_tokens: 10, output_tokens: 5 },
        });
      },
    };

    const result = await runConversationLoop({
      provider: 'anthropic',
      room: createMockRoom(),
      agentId: 'agent_1',
      messages: [{ role: 'user', content: 'Hello' }],
      ai,
      tools: createMockTools(),
      bus: createMockBus(),
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.finalText).toBe('Recovered!');
    }
    expect(callCount).toBe(2);
  });

  it('handles tool execution exceptions gracefully', async () => {
    const ai = createMockAI([
      {
        id: 'msg_1',
        role: 'assistant',
        content: [{
          type: 'tool_use',
          id: 'tc_1',
          name: 'bash',
          input: { command: 'crash' },
        }],
        model: 'test',
        stop_reason: 'tool_use',
        usage: { input_tokens: 10, output_tokens: 5 },
      },
      {
        id: 'msg_2',
        role: 'assistant',
        content: [{ type: 'text', text: 'Tool failed, continuing.' }],
        model: 'test',
        stop_reason: 'end_turn',
        usage: { input_tokens: 20, output_tokens: 10 },
      },
    ]);

    // Tools registry that throws on execution
    const throwingTools = createMockTools();
    throwingTools.executeInRoom = async () => {
      throw new Error('Segfault in tool execution');
    };

    const result = await runConversationLoop({
      provider: 'anthropic',
      room: createMockRoom(),
      agentId: 'agent_1',
      messages: [{ role: 'user', content: 'Crash it' }],
      ai,
      tools: throwingTools,
      bus: createMockBus(),
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.finalText).toBe('Tool failed, continuing.');
      expect(result.data.toolCalls.length).toBe(1);
      expect(result.data.toolCalls[0].result).toEqual({ error: 'Segfault in tool execution' });
    }
  });

  it('blocks tool execution when onBeforeToolCall returns err', async () => {
    // AI requests a tool call, then gives a final text response
    const ai = createMockAI([
      {
        id: 'msg_1',
        role: 'assistant',
        content: [{
          type: 'tool_use',
          id: 'tc_1',
          name: 'bash',
          input: { command: 'rm -rf /' },
        }],
        model: 'test',
        stop_reason: 'tool_use',
        usage: { input_tokens: 10, output_tokens: 5 },
      },
      {
        id: 'msg_2',
        role: 'assistant',
        content: [{ type: 'text', text: 'Tool was blocked.' }],
        model: 'test',
        stop_reason: 'end_turn',
        usage: { input_tokens: 15, output_tokens: 10 },
      },
    ]);

    // Room that blocks bash tool via onBeforeToolCall
    const blockingRoom = createMockRoom(['bash', 'read_file']);
    blockingRoom.onBeforeToolCall = (toolName: string, _agentId: string, _input: Record<string, unknown>) => {
      if (toolName === 'bash') {
        return err('TOOL_BLOCKED', 'Destructive commands are not allowed in this room');
      }
      return ok(null);
    };

    // Track whether bash tool actually executed
    let bashExecuted = false;
    const tools = createMockTools();
    const originalExecuteInRoom = tools.executeInRoom;
    tools.executeInRoom = async (params) => {
      if (params.toolName === 'bash') {
        bashExecuted = true;
      }
      return originalExecuteInRoom(params);
    };

    const result = await runConversationLoop({
      provider: 'anthropic',
      room: blockingRoom,
      agentId: 'agent_1',
      messages: [{ role: 'user', content: 'Delete everything' }],
      ai,
      tools,
      bus: createMockBus(),
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.finalText).toBe('Tool was blocked.');
      // The tool should NOT have been executed
      expect(bashExecuted).toBe(false);
      // Loop still completes — blocked tool counts as an iteration
      expect(result.data.iterations).toBe(2);
    }
  });
});
