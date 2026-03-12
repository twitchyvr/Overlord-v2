/**
 * Mention Handler Tests
 *
 * Tests initMentionHandler and handleMention with mocked agent registry.
 * Covers ID lookup, name search, partial match, not found, and uninitialized state.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

let initMentionHandler: typeof import('../../../src/commands/mention-handler.js').initMentionHandler;
let handleMention: typeof import('../../../src/commands/mention-handler.js').handleMention;

// Suppress logger output
vi.mock('../../../src/core/logger.js', () => ({
  logger: {
    child: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  },
}));

/** Helper: create a ParsedToken for @mention */
function makeToken(overrides: Partial<{ id: string; label: string }> = {}) {
  return {
    type: 'agent' as const,
    char: '@',
    id: overrides.id ?? 'agent-1',
    label: overrides.label ?? 'Architect',
  };
}

/** Helper: create a minimal CommandContext */
function makeCtx(overrides: Partial<{
  command: string;
  args: string[];
  rawText: string;
  socketId: string;
  buildingId: string;
  roomId: string;
  bus: { emit: ReturnType<typeof vi.fn> };
}> = {}) {
  return {
    command: overrides.command ?? '',
    args: overrides.args ?? [],
    rawText: overrides.rawText ?? '@Architect hello',
    socketId: overrides.socketId ?? 'sock-1',
    buildingId: overrides.buildingId,
    roomId: overrides.roomId,
    tokens: [],
    bus: overrides.bus ?? { emit: vi.fn() },
  };
}

/** Helper: create a mock agent */
function makeAgent(overrides: Partial<{ id: string; name: string; role: string }> = {}) {
  return {
    id: overrides.id ?? 'agent-1',
    name: overrides.name ?? 'Architect',
    role: overrides.role ?? 'system-architect',
    building_id: null,
    capabilities: [],
    room_access: [],
    badge: null,
    status: 'idle',
    current_room_id: null,
    current_table_id: null,
    config: {},
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
  };
}

/** Helper: create a mock AgentRegistryAPI */
function makeAgentAPI(agents: ReturnType<typeof makeAgent>[] = []) {
  return {
    registerAgent: vi.fn(),
    removeAgent: vi.fn(),
    getAgent: vi.fn((id: string) => agents.find(a => a.id === id) ?? null),
    listAgents: vi.fn(() => agents),
    updateAgent: vi.fn(),
  };
}

describe('Mention Handler', () => {
  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('../../../src/commands/mention-handler.js');
    initMentionHandler = mod.initMentionHandler;
    handleMention = mod.handleMention;
  });

  describe('uninitialized state', () => {
    it('returns not-available when handler is not initialized', async () => {
      const result = await handleMention(makeToken(), makeCtx() as never);
      expect(result.notified).toBe(false);
      expect(result.response).toContain('not available');
    });
  });

  describe('direct ID lookup', () => {
    it('finds agent by token.id via getAgent', async () => {
      const agents = [makeAgent({ id: 'agent-1', name: 'Architect', role: 'architect' })];
      initMentionHandler(makeAgentAPI(agents) as never);

      const bus = { emit: vi.fn() };
      const result = await handleMention(
        makeToken({ id: 'agent-1', label: 'Architect' }),
        makeCtx({ bus }) as never,
      );

      expect(result.notified).toBe(true);
      expect(result.agentId).toBe('agent-1');
      expect(result.response).toContain('Architect');
    });

    it('emits agent:mentioned event on bus', async () => {
      const agents = [makeAgent({ id: 'agent-1', name: 'Architect', role: 'architect' })];
      initMentionHandler(makeAgentAPI(agents) as never);

      const bus = { emit: vi.fn() };
      await handleMention(
        makeToken({ id: 'agent-1', label: 'Architect' }),
        makeCtx({ bus, socketId: 'sock-5', roomId: 'room-1', buildingId: 'bld-1' }) as never,
      );

      expect(bus.emit).toHaveBeenCalledOnce();
      expect(bus.emit).toHaveBeenCalledWith('agent:mentioned', expect.objectContaining({
        agentId: 'agent-1',
        agentName: 'Architect',
        mentionedBy: 'sock-5',
        roomId: 'room-1',
        buildingId: 'bld-1',
      }));
    });
  });

  describe('name-based fallback', () => {
    it('falls back to exact name match when ID not found', async () => {
      const agents = [makeAgent({ id: 'agent-99', name: 'Tester', role: 'qa' })];
      initMentionHandler(makeAgentAPI(agents) as never);

      const result = await handleMention(
        makeToken({ id: 'wrong-id', label: 'Tester' }),
        makeCtx() as never,
      );

      expect(result.notified).toBe(true);
      expect(result.agentId).toBe('agent-99');
    });

    it('name match is case-insensitive', async () => {
      const agents = [makeAgent({ id: 'agent-2', name: 'DevLead', role: 'lead' })];
      initMentionHandler(makeAgentAPI(agents) as never);

      const result = await handleMention(
        makeToken({ id: 'no-match', label: 'devlead' }),
        makeCtx() as never,
      );

      expect(result.notified).toBe(true);
      expect(result.agentId).toBe('agent-2');
    });
  });

  describe('partial name match', () => {
    it('falls back to partial name match when exact name not found', async () => {
      const agents = [makeAgent({ id: 'agent-3', name: 'Security Analyst', role: 'security' })];
      initMentionHandler(makeAgentAPI(agents) as never);

      const result = await handleMention(
        makeToken({ id: 'no-match', label: 'security' }),
        makeCtx() as never,
      );

      expect(result.notified).toBe(true);
      expect(result.agentId).toBe('agent-3');
    });

    it('partial match is case-insensitive', async () => {
      const agents = [makeAgent({ id: 'agent-4', name: 'Backend Engineer', role: 'backend' })];
      initMentionHandler(makeAgentAPI(agents) as never);

      const result = await handleMention(
        makeToken({ id: 'no-match', label: 'BACKEND' }),
        makeCtx() as never,
      );

      expect(result.notified).toBe(true);
      expect(result.agentId).toBe('agent-4');
    });
  });

  describe('agent not found', () => {
    it('returns not-found when no agent matches ID, name, or partial', async () => {
      const agents = [makeAgent({ id: 'agent-1', name: 'Architect' })];
      initMentionHandler(makeAgentAPI(agents) as never);

      const result = await handleMention(
        makeToken({ id: 'no-match', label: 'NonExistent' }),
        makeCtx() as never,
      );

      expect(result.notified).toBe(false);
      expect(result.response).toContain('not found');
      expect(result.response).toContain('NonExistent');
    });

    it('does not emit bus event when agent not found', async () => {
      initMentionHandler(makeAgentAPI([]) as never);

      const bus = { emit: vi.fn() };
      await handleMention(
        makeToken({ id: 'ghost', label: 'Ghost' }),
        makeCtx({ bus }) as never,
      );

      expect(bus.emit).not.toHaveBeenCalled();
    });
  });

  describe('bus event payload', () => {
    it('includes null for missing roomId and buildingId', async () => {
      const agents = [makeAgent({ id: 'a1', name: 'Bot', role: 'bot' })];
      initMentionHandler(makeAgentAPI(agents) as never);

      const bus = { emit: vi.fn() };
      await handleMention(
        makeToken({ id: 'a1', label: 'Bot' }),
        makeCtx({ bus }) as never, // no roomId or buildingId
      );

      const payload = bus.emit.mock.calls[0][1];
      expect(payload.roomId).toBeNull();
      expect(payload.buildingId).toBeNull();
    });

    it('includes rawText from context', async () => {
      const agents = [makeAgent({ id: 'a1', name: 'Bot', role: 'bot' })];
      initMentionHandler(makeAgentAPI(agents) as never);

      const bus = { emit: vi.fn() };
      await handleMention(
        makeToken({ id: 'a1', label: 'Bot' }),
        makeCtx({ bus, rawText: '@Bot do the thing' }) as never,
      );

      const payload = bus.emit.mock.calls[0][1];
      expect(payload.rawText).toBe('@Bot do the thing');
    });
  });

  describe('error handling', () => {
    it('catches exceptions and returns error result', async () => {
      const api = makeAgentAPI([]);
      api.getAgent.mockImplementation(() => { throw new Error('db down'); });
      initMentionHandler(api as never);

      const result = await handleMention(
        makeToken({ id: 'a1', label: 'Bot' }),
        makeCtx() as never,
      );

      expect(result.notified).toBe(false);
      expect(result.response).toContain('db down');
    });
  });
});
