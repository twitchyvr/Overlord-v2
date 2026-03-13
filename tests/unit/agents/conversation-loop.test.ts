/**
 * Conversation Loop Tests
 *
 * Tests the core conversation loop: message → AI → tool_use → execute → result → done
 * Uses mocked AI provider to simulate the loop without real API calls.
 */

import { describe, it, expect, vi } from 'vitest';
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
        // Always fail — never succeed
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
    // Should have been called 3 times: 1 initial + 2 retries (AI_MAX_RETRIES=2 in test env)
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

  it('rejects AI-hallucinated tool names not in the allowed list', async () => {
    const ai = createMockAI([
      {
        id: 'msg_1',
        role: 'assistant',
        content: [{
          type: 'tool_use',
          id: 'tc_1',
          name: 'delete_everything',  // hallucinated tool name
          input: { target: '/' },
        }],
        model: 'test',
        stop_reason: 'tool_use',
        usage: { input_tokens: 10, output_tokens: 5 },
      },
      {
        id: 'msg_2',
        role: 'assistant',
        content: [{ type: 'text', text: 'That tool was not available.' }],
        model: 'test',
        stop_reason: 'end_turn',
        usage: { input_tokens: 20, output_tokens: 10 },
      },
    ]);

    // Track bus events
    const busEvents: Array<{ event: string; data: unknown }> = [];
    const bus = createMockBus();
    const originalEmit = bus.emit;
    bus.emit = (event: string | symbol, data?: Record<string, unknown>) => {
      busEvents.push({ event: String(event), data });
      return originalEmit(event, data);
    };

    let toolExecuted = false;
    const tools = createMockTools();
    const originalExecuteInRoom = tools.executeInRoom;
    tools.executeInRoom = async (params) => {
      toolExecuted = true;
      return originalExecuteInRoom(params);
    };

    const result = await runConversationLoop({
      provider: 'anthropic',
      room: createMockRoom(['bash', 'read_file']),
      agentId: 'agent_1',
      messages: [{ role: 'user', content: 'Delete everything' }],
      ai,
      tools,
      bus,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      // Tool should NOT have been executed
      expect(toolExecuted).toBe(false);
      // Tool call should be logged with error
      expect(result.data.toolCalls.length).toBe(1);
      expect(result.data.toolCalls[0].name).toBe('delete_everything');
      expect(result.data.toolCalls[0].result).toEqual({ error: 'Tool "delete_everything" is not available' });
    }

    // Guardrail violation event should have been emitted
    const violationEvent = busEvents.find(e => e.event === 'tool:guardrail-violation');
    expect(violationEvent).toBeDefined();
    expect(violationEvent!.data).toEqual(expect.objectContaining({
      type: 'unknown_tool',
      toolName: 'delete_everything',
      agentId: 'agent_1',
    }));
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

  // ─── Edge Cases ───────────────────────────────────────────

  it('emits warning when max tool iterations (20) reached', async () => {
    // Create 20 tool_use responses — AI never returns end_turn
    const responses = Array.from({ length: 20 }, (_, i) => ({
      id: `msg_${i + 1}`,
      role: 'assistant',
      content: [{
        type: 'tool_use',
        id: `tc_${i + 1}`,
        name: 'bash',
        input: { command: `step_${i + 1}` },
      }],
      model: 'test',
      stop_reason: 'tool_use',
      usage: { input_tokens: 5, output_tokens: 5 },
    }));

    const ai = createMockAI(responses);

    // Track bus events to verify the warning
    const busEvents: Array<{ event: string; data: unknown }> = [];
    const bus = createMockBus();
    const originalEmit = bus.emit;
    bus.emit = (event: string | symbol, data?: Record<string, unknown>) => {
      busEvents.push({ event: String(event), data });
      return originalEmit(event, data);
    };

    const result = await runConversationLoop({
      provider: 'anthropic',
      room: createMockRoom(),
      agentId: 'agent_1',
      messages: [{ role: 'user', content: 'Loop forever' }],
      ai,
      tools: createMockTools(),
      bus,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.iterations).toBe(20);
      expect(result.data.toolCalls.length).toBe(20);
    }

    // Should set maxIterationsReached flag instead of emitting its own chat:response
    // (orchestrator handles all response emission to avoid double-sending)
    if (result.ok) {
      expect(result.data.maxIterationsReached).toBe(true);
    }
  });

  it('calls onAfterToolCall after successful tool execution', async () => {
    const afterToolCalls: Array<{ tool: string; agentId: string; ok: boolean }> = [];

    const room = createMockRoom(['bash']);
    room.onAfterToolCall = (toolName: string, agentId: string, result: { ok: boolean }) => {
      afterToolCalls.push({ tool: toolName, agentId, ok: result.ok });
    };

    const ai = createMockAI([
      {
        id: 'msg_1',
        role: 'assistant',
        content: [{
          type: 'tool_use',
          id: 'tc_1',
          name: 'bash',
          input: { command: 'echo hi' },
        }],
        model: 'test',
        stop_reason: 'tool_use',
        usage: { input_tokens: 10, output_tokens: 5 },
      },
      {
        id: 'msg_2',
        role: 'assistant',
        content: [{ type: 'text', text: 'Done.' }],
        model: 'test',
        stop_reason: 'end_turn',
        usage: { input_tokens: 15, output_tokens: 5 },
      },
    ]);

    await runConversationLoop({
      provider: 'anthropic',
      room,
      agentId: 'agent_1',
      messages: [{ role: 'user', content: 'Run it' }],
      ai,
      tools: createMockTools(),
      bus: createMockBus(),
    });

    expect(afterToolCalls).toHaveLength(1);
    expect(afterToolCalls[0]).toEqual({ tool: 'bash', agentId: 'agent_1', ok: true });
  });

  it('calls onAfterToolCall after failed tool execution', async () => {
    const afterToolCalls: Array<{ tool: string; ok: boolean }> = [];

    const room = createMockRoom(['bash']);
    room.onAfterToolCall = (toolName: string, _agentId: string, result: { ok: boolean }) => {
      afterToolCalls.push({ tool: toolName, ok: result.ok });
    };

    const ai = createMockAI([
      {
        id: 'msg_1',
        role: 'assistant',
        content: [{
          type: 'tool_use',
          id: 'tc_1',
          name: 'bash',
          input: { command: 'fail' },
        }],
        model: 'test',
        stop_reason: 'tool_use',
        usage: { input_tokens: 10, output_tokens: 5 },
      },
      {
        id: 'msg_2',
        role: 'assistant',
        content: [{ type: 'text', text: 'Tool failed.' }],
        model: 'test',
        stop_reason: 'end_turn',
        usage: { input_tokens: 15, output_tokens: 5 },
      },
    ]);

    // Return error from executeInRoom
    const tools = createMockTools();
    tools.executeInRoom = async () => ({
      ok: false as const,
      error: { code: 'EXEC_FAIL', message: 'Command failed', retryable: false },
    });

    await runConversationLoop({
      provider: 'anthropic',
      room,
      agentId: 'agent_1',
      messages: [{ role: 'user', content: 'Fail it' }],
      ai,
      tools,
      bus: createMockBus(),
    });

    expect(afterToolCalls).toHaveLength(1);
    expect(afterToolCalls[0]).toEqual({ tool: 'bash', ok: false });
  });

  it('accumulates thinking blocks across multiple iterations', async () => {
    const ai = createMockAI([
      {
        id: 'msg_1',
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'Thinking about step 1...' },
          {
            type: 'tool_use',
            id: 'tc_1',
            name: 'bash',
            input: { command: 'step1' },
          },
        ],
        model: 'MiniMax-M2.5',
        stop_reason: 'tool_use',
        usage: { input_tokens: 10, output_tokens: 10 },
      },
      {
        id: 'msg_2',
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'Now thinking about step 2...' },
          {
            type: 'tool_use',
            id: 'tc_2',
            name: 'read_file',
            input: { path: 'test.ts' },
          },
        ],
        model: 'MiniMax-M2.5',
        stop_reason: 'tool_use',
        usage: { input_tokens: 15, output_tokens: 10 },
      },
      {
        id: 'msg_3',
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'Final thoughts...' },
          { type: 'text', text: 'All steps complete.' },
        ],
        model: 'MiniMax-M2.5',
        stop_reason: 'end_turn',
        usage: { input_tokens: 20, output_tokens: 15 },
      },
    ]);

    const result = await runConversationLoop({
      provider: 'minimax',
      room: createMockRoom(),
      agentId: 'agent_1',
      messages: [{ role: 'user', content: 'Think through it' }],
      ai,
      tools: createMockTools(),
      bus: createMockBus(),
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.thinking).toEqual([
        'Thinking about step 1...',
        'Now thinking about step 2...',
        'Final thoughts...',
      ]);
      expect(result.data.iterations).toBe(3);
      expect(result.data.toolCalls.length).toBe(2);
    }
  });

  it('handles tool execution timeout gracefully', async () => {
    const ai = createMockAI([
      {
        id: 'msg_1',
        role: 'assistant',
        content: [{
          type: 'tool_use',
          id: 'tc_1',
          name: 'bash',
          input: { command: 'sleep 999' },
        }],
        model: 'test',
        stop_reason: 'tool_use',
        usage: { input_tokens: 10, output_tokens: 5 },
      },
      {
        id: 'msg_2',
        role: 'assistant',
        content: [{ type: 'text', text: 'Timed out.' }],
        model: 'test',
        stop_reason: 'end_turn',
        usage: { input_tokens: 15, output_tokens: 5 },
      },
    ]);

    // Simulate a tool that never resolves (within test timeframe)
    const tools = createMockTools();
    tools.executeInRoom = () =>
      new Promise((_resolve) => {
        // Never resolves — will be caught by withTimeout
        // Use vi.useFakeTimers would be needed for real 60s timeout,
        // but we can test the error path by making it reject
      });

    // Override to reject with timeout-like error directly
    tools.executeInRoom = async () => {
      throw new Error('Tool "bash" timed out after 60000ms');
    };

    const result = await runConversationLoop({
      provider: 'anthropic',
      room: createMockRoom(),
      agentId: 'agent_1',
      messages: [{ role: 'user', content: 'Hang forever' }],
      ai,
      tools,
      bus: createMockBus(),
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.toolCalls.length).toBe(1);
      expect(result.data.toolCalls[0].result).toEqual({
        error: 'Tool "bash" timed out after 60000ms',
      });
      expect(result.data.finalText).toBe('Timed out.');
    }
  });

  it('does NOT call onAfterToolCall when tool is blocked by onBeforeToolCall', async () => {
    const afterToolCalls: string[] = [];

    const room = createMockRoom(['bash']);
    room.onBeforeToolCall = () => err('BLOCKED', 'Nope');
    room.onAfterToolCall = (toolName: string) => {
      afterToolCalls.push(toolName);
    };

    const ai = createMockAI([
      {
        id: 'msg_1',
        role: 'assistant',
        content: [{
          type: 'tool_use',
          id: 'tc_1',
          name: 'bash',
          input: { command: 'echo hi' },
        }],
        model: 'test',
        stop_reason: 'tool_use',
        usage: { input_tokens: 10, output_tokens: 5 },
      },
      {
        id: 'msg_2',
        role: 'assistant',
        content: [{ type: 'text', text: 'Blocked.' }],
        model: 'test',
        stop_reason: 'end_turn',
        usage: { input_tokens: 15, output_tokens: 5 },
      },
    ]);

    await runConversationLoop({
      provider: 'anthropic',
      room,
      agentId: 'agent_1',
      messages: [{ role: 'user', content: 'Try it' }],
      ai,
      tools: createMockTools(),
      bus: createMockBus(),
    });

    // onAfterToolCall should NOT have been called since onBeforeToolCall blocked
    expect(afterToolCalls).toHaveLength(0);
  });

  it('does NOT call onAfterToolCall when tool execution throws', async () => {
    const afterToolCalls: string[] = [];

    const room = createMockRoom(['bash']);
    room.onAfterToolCall = (toolName: string) => {
      afterToolCalls.push(toolName);
    };

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
        content: [{ type: 'text', text: 'Crashed.' }],
        model: 'test',
        stop_reason: 'end_turn',
        usage: { input_tokens: 15, output_tokens: 5 },
      },
    ]);

    const tools = createMockTools();
    tools.executeInRoom = async () => {
      throw new Error('Boom');
    };

    await runConversationLoop({
      provider: 'anthropic',
      room,
      agentId: 'agent_1',
      messages: [{ role: 'user', content: 'Crash it' }],
      ai,
      tools,
      bus: createMockBus(),
    });

    // When tool throws, onAfterToolCall is NOT called (the catch block continues)
    expect(afterToolCalls).toHaveLength(0);
  });

  it('accumulates token counts across iterations', async () => {
    const ai = createMockAI([
      {
        id: 'msg_1',
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'tc_1', name: 'bash', input: { command: 'a' } }],
        model: 'test',
        stop_reason: 'tool_use',
        usage: { input_tokens: 100, output_tokens: 50 },
      },
      {
        id: 'msg_2',
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'tc_2', name: 'bash', input: { command: 'b' } }],
        model: 'test',
        stop_reason: 'tool_use',
        usage: { input_tokens: 200, output_tokens: 75 },
      },
      {
        id: 'msg_3',
        role: 'assistant',
        content: [{ type: 'text', text: 'Done.' }],
        model: 'test',
        stop_reason: 'end_turn',
        usage: { input_tokens: 300, output_tokens: 100 },
      },
    ]);

    const result = await runConversationLoop({
      provider: 'anthropic',
      room: createMockRoom(),
      agentId: 'agent_1',
      messages: [{ role: 'user', content: 'Go' }],
      ai,
      tools: createMockTools(),
      bus: createMockBus(),
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.totalTokens.input).toBe(600);  // 100 + 200 + 300
      expect(result.data.totalTokens.output).toBe(225); // 50 + 75 + 100
      expect(result.data.iterations).toBe(3);
    }
  });

  it('handles multiple tool_use blocks in a single response', async () => {
    const ai = createMockAI([
      {
        id: 'msg_1',
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 'tc_1', name: 'bash', input: { command: 'ls' } },
          { type: 'tool_use', id: 'tc_2', name: 'read_file', input: { path: 'a.ts' } },
        ],
        model: 'test',
        stop_reason: 'tool_use',
        usage: { input_tokens: 10, output_tokens: 10 },
      },
      {
        id: 'msg_2',
        role: 'assistant',
        content: [{ type: 'text', text: 'Both done.' }],
        model: 'test',
        stop_reason: 'end_turn',
        usage: { input_tokens: 20, output_tokens: 10 },
      },
    ]);

    const result = await runConversationLoop({
      provider: 'anthropic',
      room: createMockRoom(),
      agentId: 'agent_1',
      messages: [{ role: 'user', content: 'Do both' }],
      ai,
      tools: createMockTools(),
      bus: createMockBus(),
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.toolCalls.length).toBe(2);
      expect(result.data.toolCalls[0].name).toBe('bash');
      expect(result.data.toolCalls[1].name).toBe('read_file');
      // Both tools executed in single iteration
      expect(result.data.iterations).toBe(2);
    }
  });

  it('returns empty finalText when no assistant message exists', async () => {
    // Edge case: AI immediately returns tool_use and then max iterations is hit
    // but we make a simpler version — just check empty final text for end_turn with no text blocks
    const ai = createMockAI([{
      id: 'msg_1',
      role: 'assistant',
      content: [],  // No content blocks at all
      model: 'test',
      stop_reason: 'end_turn',
      usage: { input_tokens: 5, output_tokens: 0 },
    }]);

    const result = await runConversationLoop({
      provider: 'anthropic',
      room: createMockRoom(),
      agentId: 'agent_1',
      messages: [{ role: 'user', content: 'Empty please' }],
      ai,
      tools: createMockTools(),
      bus: createMockBus(),
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.finalText).toBe('');
    }
  });
});
