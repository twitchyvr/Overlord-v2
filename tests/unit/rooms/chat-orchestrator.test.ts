/**
 * Chat Orchestrator Tests
 *
 * Tests the central chat message handler that routes messages
 * through the AI pipeline via the conversation loop.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EventEmitter } from 'eventemitter3';
import type { Bus, BusEventData } from '../../../src/core/bus.js';

// Mock conversation-loop
vi.mock('../../../src/agents/conversation-loop.js', () => ({
  runConversationLoop: vi.fn(),
}));

// Mock config
vi.mock('../../../src/core/config.js', () => ({
  config: {
    get: vi.fn((key: string) => {
      if (key === 'MINIMAX_API_KEY') return 'test-minimax-key';
      return undefined;
    }),
  },
}));

// Mock logger
vi.mock('../../../src/core/logger.js', () => {
  const child = () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  });
  return { logger: { child } };
});

import { runConversationLoop } from '../../../src/agents/conversation-loop.js';
import { initChatOrchestrator } from '../../../src/rooms/chat-orchestrator.js';

function createMockBus(): Bus & {
  _emissions: Array<{ event: string; data: unknown }>;
  _trigger: (event: string, data: BusEventData) => void;
} {
  const ee = new EventEmitter();
  const emissions: Array<{ event: string; data: unknown }> = [];
  return {
    emit: (event: string | symbol, data?: Record<string, unknown>) => {
      emissions.push({ event: event as string, data });
      ee.emit(event, data);
      return true;
    },
    on: (event: string | symbol, fn: (...args: unknown[]) => void) => {
      ee.on(event, fn);
      return ee;
    },
    onNamespace: () => {},
    _emissions: emissions,
    _trigger: (event: string, data: BusEventData) => {
      ee.emit(event, data);
    },
  } as unknown as Bus & { _emissions: typeof emissions; _trigger: (event: string, data: BusEventData) => void };
}

function createMockRoom(overrides: Record<string, unknown> = {}) {
  return {
    id: 'room_1',
    type: 'strategist',
    tables: { consultation: { chairs: 2 } },
    config: { provider: 'configurable' },
    ...overrides,
  };
}

function createMockDeps(bus: ReturnType<typeof createMockBus>) {
  const mockRoom = createMockRoom();

  return {
    bus,
    rooms: {
      getRoom: vi.fn((id: string) => (id === 'room_1' ? mockRoom : null)),
      listRooms: vi.fn(() => [{ id: 'room_1', type: 'strategist' }]),
    },
    agents: {
      getAgent: vi.fn((id: string) => {
        if (id === 'agent_1') return { id: 'agent_1', name: 'Strategist', role: 'strategist', room_access: ['strategist'] };
        return null;
      }),
      listAgents: vi.fn(({ roomId }: { roomId?: string }) => {
        if (roomId === 'room_1') return [{ id: 'agent_1', name: 'Strategist', role: 'strategist', room_access: ['strategist'] }];
        return [];
      }),
    },
    tools: {},
    ai: {},
  };
}

describe('Chat Orchestrator', () => {
  let bus: ReturnType<typeof createMockBus>;

  beforeEach(() => {
    bus = createMockBus();
    (runConversationLoop as ReturnType<typeof vi.fn>).mockReset();
  });

  it('initializes without errors', () => {
    const deps = createMockDeps(bus);
    expect(() => initChatOrchestrator(deps as any)).not.toThrow();
  });

  it('processes chat:message and emits chat:response on success', async () => {
    const deps = createMockDeps(bus);

    (runConversationLoop as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      data: {
        finalText: 'Hello from AI',
        thinking: null,
        toolCalls: [],
        totalTokens: 100,
        iterations: 1,
        sessionId: 'sess_1',
      },
    });

    initChatOrchestrator(deps as any);
    bus._trigger('chat:message', {
      socketId: 'socket_1',
      text: 'Hello',
      roomId: 'room_1',
      agentId: 'agent_1',
      buildingId: 'bld_1',
    });

    // Allow async handler to complete
    await vi.waitFor(() => {
      const response = bus._emissions.find(
        (e) => e.event === 'chat:response' && (e.data as Record<string, unknown>).type === 'message',
      );
      expect(response).toBeDefined();
    });

    const response = bus._emissions.find(
      (e) => e.event === 'chat:response' && (e.data as Record<string, unknown>).type === 'message',
    );
    expect((response!.data as Record<string, unknown>).content).toBe('Hello from AI');
    expect((response!.data as Record<string, unknown>).socketId).toBe('socket_1');
  });

  it('emits thinking indicator before AI call', async () => {
    const deps = createMockDeps(bus);

    (runConversationLoop as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      data: {
        finalText: 'Response',
        thinking: null,
        toolCalls: [],
        totalTokens: 50,
        iterations: 1,
        sessionId: 'sess_2',
      },
    });

    initChatOrchestrator(deps as any);
    bus._trigger('chat:message', {
      socketId: 'socket_1',
      text: 'Think first',
      roomId: 'room_1',
      agentId: 'agent_1',
    });

    await vi.waitFor(() => {
      const thinking = bus._emissions.find(
        (e) => e.event === 'chat:stream' && (e.data as Record<string, unknown>).status === 'thinking',
      );
      expect(thinking).toBeDefined();
    });
  });

  it('ignores empty messages', async () => {
    const deps = createMockDeps(bus);

    initChatOrchestrator(deps as any);
    bus._trigger('chat:message', {
      socketId: 'socket_1',
      text: '',
      roomId: 'room_1',
    });

    // Give handler time to (not) run
    await new Promise((r) => setTimeout(r, 50));
    expect(runConversationLoop).not.toHaveBeenCalled();
  });

  it('ignores whitespace-only messages', async () => {
    const deps = createMockDeps(bus);

    initChatOrchestrator(deps as any);
    bus._trigger('chat:message', {
      socketId: 'socket_1',
      text: '   \n   ',
      roomId: 'room_1',
    });

    await new Promise((r) => setTimeout(r, 50));
    expect(runConversationLoop).not.toHaveBeenCalled();
  });

  it('emits error response when no room found', async () => {
    const deps = createMockDeps(bus);
    // Override rooms to return nothing
    deps.rooms.getRoom = vi.fn(() => null);
    deps.rooms.listRooms = vi.fn(() => []);

    initChatOrchestrator(deps as any);
    bus._trigger('chat:message', {
      socketId: 'socket_1',
      text: 'Hello',
    });

    await vi.waitFor(() => {
      const errorResp = bus._emissions.find(
        (e) => e.event === 'chat:response' && (e.data as Record<string, unknown>).type === 'error',
      );
      expect(errorResp).toBeDefined();
    });

    const errorResp = bus._emissions.find(
      (e) => e.event === 'chat:response' && (e.data as Record<string, unknown>).type === 'error',
    );
    expect(((errorResp!.data as Record<string, unknown>).error as Record<string, unknown>).code).toBe('NO_ROOM');
  });

  it('emits error response when conversation loop fails', async () => {
    const deps = createMockDeps(bus);

    (runConversationLoop as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      error: { code: 'AI_ERROR', message: 'Model unavailable' },
    });

    initChatOrchestrator(deps as any);
    bus._trigger('chat:message', {
      socketId: 'socket_1',
      text: 'Hello',
      roomId: 'room_1',
      agentId: 'agent_1',
    });

    await vi.waitFor(() => {
      const errorResp = bus._emissions.find(
        (e) => e.event === 'chat:response' && (e.data as Record<string, unknown>).type === 'error',
      );
      expect(errorResp).toBeDefined();
    });

    const errorResp = bus._emissions.find(
      (e) => e.event === 'chat:response' && (e.data as Record<string, unknown>).type === 'error',
    );
    expect(((errorResp!.data as Record<string, unknown>).error as Record<string, unknown>).code).toBe('AI_ERROR');
  });

  it('emits error response when conversation loop throws', async () => {
    const deps = createMockDeps(bus);

    (runConversationLoop as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Unexpected crash'));

    initChatOrchestrator(deps as any);
    bus._trigger('chat:message', {
      socketId: 'socket_1',
      text: 'Hello',
      roomId: 'room_1',
      agentId: 'agent_1',
    });

    await vi.waitFor(() => {
      const errorResp = bus._emissions.find(
        (e) => e.event === 'chat:response' && (e.data as Record<string, unknown>).type === 'error',
      );
      expect(errorResp).toBeDefined();
    });

    const errorResp = bus._emissions.find(
      (e) => e.event === 'chat:response' && (e.data as Record<string, unknown>).type === 'error',
    );
    expect(((errorResp!.data as Record<string, unknown>).error as Record<string, unknown>).message).toContain('Unexpected crash');
  });

  it('resolves agent from room when agentId not provided', async () => {
    const deps = createMockDeps(bus);

    (runConversationLoop as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      data: {
        finalText: 'Found agent',
        thinking: null,
        toolCalls: [],
        totalTokens: 50,
        iterations: 1,
        sessionId: 'sess_3',
      },
    });

    initChatOrchestrator(deps as any);
    bus._trigger('chat:message', {
      socketId: 'socket_1',
      text: 'Hello',
      roomId: 'room_1',
      // No agentId
    });

    await vi.waitFor(() => {
      expect(runConversationLoop).toHaveBeenCalled();
    });

    const call = (runConversationLoop as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.agentId).toBe('agent_1'); // Resolved from room agents
  });

  it('finds default room when no roomId specified', async () => {
    const deps = createMockDeps(bus);
    // getRoom returns null for empty string, but listRooms returns room_1
    deps.rooms.getRoom = vi.fn((id: string) => {
      if (id === 'room_1') return createMockRoom();
      return null;
    });

    (runConversationLoop as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      data: {
        finalText: 'Default room',
        thinking: null,
        toolCalls: [],
        totalTokens: 50,
        iterations: 1,
        sessionId: 'sess_4',
      },
    });

    initChatOrchestrator(deps as any);
    bus._trigger('chat:message', {
      socketId: 'socket_1',
      text: 'Hello',
      buildingId: 'bld_1',
      // No roomId
    });

    await vi.waitFor(() => {
      expect(runConversationLoop).toHaveBeenCalled();
    });

    const call = (runConversationLoop as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.room.id).toBe('room_1');
  });

  it('includes tool calls in response', async () => {
    const deps = createMockDeps(bus);

    (runConversationLoop as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      data: {
        finalText: 'Done with tools',
        thinking: 'Let me think...',
        toolCalls: [
          { name: 'read_file', input: { path: 'src/index.ts' }, output: '...' },
          { name: 'bash', input: { command: 'npm test' }, output: 'pass' },
        ],
        totalTokens: 500,
        iterations: 3,
        sessionId: 'sess_5',
      },
    });

    initChatOrchestrator(deps as any);
    bus._trigger('chat:message', {
      socketId: 'socket_1',
      text: 'Run tests',
      roomId: 'room_1',
      agentId: 'agent_1',
    });

    await vi.waitFor(() => {
      const response = bus._emissions.find(
        (e) => e.event === 'chat:response' && (e.data as Record<string, unknown>).type === 'message',
      );
      expect(response).toBeDefined();
    });

    const response = bus._emissions.find(
      (e) => e.event === 'chat:response' && (e.data as Record<string, unknown>).type === 'message',
    );
    const data = response!.data as Record<string, unknown>;
    expect(data.thinking).toBe('Let me think...');
    expect((data.toolCalls as unknown[]).length).toBe(2);
    expect(data.iterations).toBe(3);
    expect(data.tokens).toBe(500);
  });

  it('uses room-specific provider when not configurable', async () => {
    const deps = createMockDeps(bus);
    // Override room to have specific provider
    deps.rooms.getRoom = vi.fn(() => createMockRoom({ config: { provider: 'openai' } }));

    (runConversationLoop as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      data: {
        finalText: 'OpenAI response',
        thinking: null,
        toolCalls: [],
        totalTokens: 50,
        iterations: 1,
        sessionId: 'sess_6',
      },
    });

    initChatOrchestrator(deps as any);
    bus._trigger('chat:message', {
      socketId: 'socket_1',
      text: 'Hello',
      roomId: 'room_1',
      agentId: 'agent_1',
    });

    await vi.waitFor(() => {
      expect(runConversationLoop).toHaveBeenCalled();
    });

    const call = (runConversationLoop as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.provider).toBe('openai');
  });
});
