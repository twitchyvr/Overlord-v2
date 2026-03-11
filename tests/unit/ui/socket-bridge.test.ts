// @vitest-environment jsdom
/**
 * Tests for public/ui/engine/socket-bridge.js
 *
 * Covers: initSocketBridge() — connection lifecycle, server→client event mappings,
 *         store updates, engine dispatches, window.overlordSocket API wrappers,
 *         error handling, edge cases.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Helpers ──────────────────────────────────────────────────

/** Create a mock Socket.IO client with on/emit/disconnect */
function createMockSocket() {
  const handlers: Record<string, (...args: unknown[]) => void> = {};
  return {
    id: 'mock-socket-id-abc123',
    handlers,
    on(event: string, fn: (...args: unknown[]) => void) {
      handlers[event] = fn;
    },
    emit: vi.fn((event: string, data?: any, ack?: (...args: unknown[]) => void) => {
      // If the last argument is a function, treat it as an acknowledgement callback
      if (typeof data === 'function') {
        // emit(event, ack) — no data
        ack = data;
        data = undefined;
      }
      // Store the ack so tests can invoke it
      (mockSocket as any)._lastAck = ack;
    }),
    disconnect: vi.fn(),
    /** Test helper: simulate the server emitting an event */
    _trigger(event: string, ...args: any[]) {
      if (handlers[event]) handlers[event](...args);
    },
  };
}

/** Create a minimal mock store */
function createMockStore() {
  const data: Record<string, any> = {};
  return {
    _data: data,
    set: vi.fn((key: string, value: any) => { data[key] = value; }),
    get: vi.fn((key: string) => data[key]),
    update: vi.fn((key: string, fn: (current: unknown) => unknown) => {
      const current = data[key];
      const next = fn(current);
      data[key] = next;
    }),
    batch: vi.fn((fn: () => void) => { fn(); }),
    subscribe: vi.fn(),
  };
}

/** Create a minimal mock engine */
function createMockEngine() {
  return {
    dispatch: vi.fn(),
  };
}

let mockSocket: ReturnType<typeof createMockSocket>;
let mockStore: ReturnType<typeof createMockStore>;
let mockEngine: ReturnType<typeof createMockEngine>;
let initSocketBridge: any;

beforeEach(async () => {
  mockSocket = createMockSocket();
  mockStore = createMockStore();
  mockEngine = createMockEngine();

  // Clean up window.overlordSocket from previous tests
  delete (window as any).overlordSocket;

  // Dynamic import to get fresh module
  const mod = await import('../../../public/ui/engine/socket-bridge.js');
  initSocketBridge = mod.initSocketBridge;
});

afterEach(() => {
  delete (window as any).overlordSocket;
  vi.restoreAllMocks();
});

// ─── initSocketBridge() — basic setup ────────────────────────

describe('initSocketBridge() — initialization', () => {
  it('returns the window.overlordSocket API object', () => {
    const result = initSocketBridge(mockSocket, mockStore, mockEngine);
    expect(result).toBeDefined();
    expect(result).toBe((window as any).overlordSocket);
  });

  it('sets window.overlordSocket on the global window', () => {
    initSocketBridge(mockSocket, mockStore, mockEngine);
    expect((window as any).overlordSocket).toBeDefined();
  });

  it('exposes the raw socket on window.overlordSocket.socket', () => {
    initSocketBridge(mockSocket, mockStore, mockEngine);
    expect((window as any).overlordSocket.socket).toBe(mockSocket);
  });

  it('registers handlers for connect, disconnect, and connect_error', () => {
    initSocketBridge(mockSocket, mockStore, mockEngine);
    expect(mockSocket.handlers['connect']).toBeTypeOf('function');
    expect(mockSocket.handlers['disconnect']).toBeTypeOf('function');
    expect(mockSocket.handlers['connect_error']).toBeTypeOf('function');
  });

  it('registers handlers for all broadcast events', () => {
    initSocketBridge(mockSocket, mockStore, mockEngine);
    const expected = [
      'room:agent:entered', 'room:agent:exited',
      'chat:response', 'chat:stream',
      'tool:executed', 'phase:advanced',
      'raid:entry:added', 'phase-zero:complete', 'phase-zero:failed',
      'scope-change:detected', 'exit-doc:submitted',
    ];
    for (const evt of expected) {
      expect(mockSocket.handlers[evt]).toBeTypeOf('function');
    }
  });

  it('logs initialization message', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    initSocketBridge(mockSocket, mockStore, mockEngine);
    expect(spy).toHaveBeenCalledWith('[SocketBridge] v2 bridge initialized');
    spy.mockRestore();
  });
});

// ─── Connection lifecycle ────────────────────────────────────

describe('socket "connect" event', () => {
  it('sets ui.connected to true in the store', () => {
    initSocketBridge(mockSocket, mockStore, mockEngine);
    mockSocket._trigger('connect');
    expect(mockStore.set).toHaveBeenCalledWith('ui.connected', true);
  });

  it('emits system:status to hydrate initial state', () => {
    initSocketBridge(mockSocket, mockStore, mockEngine);
    mockSocket._trigger('connect');
    expect(mockSocket.emit).toHaveBeenCalledWith('system:status', {}, expect.any(Function));
  });

  it('emits system:health to fetch health data', () => {
    initSocketBridge(mockSocket, mockStore, mockEngine);
    mockSocket._trigger('connect');
    expect(mockSocket.emit).toHaveBeenCalledWith('system:health', {}, expect.any(Function));
  });

  it('hydrates store when system:status ack returns ok', () => {
    initSocketBridge(mockSocket, mockStore, mockEngine);

    // Override emit to invoke the ack callback immediately for system:status
    mockSocket.emit.mockImplementation((event: string, data: any, ack?: (...args: unknown[]) => void) => {
      if (event === 'system:status' && ack) {
        ack({ ok: true, data: { isNewUser: true, buildings: [{ id: 'b1' }] } });
      }
    });

    mockSocket._trigger('connect');

    expect(mockStore.batch).toHaveBeenCalledTimes(1);
    // batch calls set inside it
    expect(mockStore.set).toHaveBeenCalledWith('system.isNewUser', true);
    expect(mockStore.set).toHaveBeenCalledWith('building.list', [{ id: 'b1' }]);
  });

  it('dispatches system:status event to engine on ok response', () => {
    initSocketBridge(mockSocket, mockStore, mockEngine);

    const statusData = { isNewUser: false, buildings: [] };
    mockSocket.emit.mockImplementation((event: string, data: any, ack?: (...args: unknown[]) => void) => {
      if (event === 'system:status' && ack) {
        ack({ ok: true, data: statusData });
      }
    });

    mockSocket._trigger('connect');
    expect(mockEngine.dispatch).toHaveBeenCalledWith('system:status', statusData);
  });

  it('does not update store when system:status ack returns not ok', () => {
    initSocketBridge(mockSocket, mockStore, mockEngine);

    mockSocket.emit.mockImplementation((event: string, data: any, ack?: (...args: unknown[]) => void) => {
      if (event === 'system:status' && ack) {
        ack({ ok: false });
      }
    });

    mockSocket._trigger('connect');
    expect(mockStore.set).not.toHaveBeenCalledWith('system.isNewUser', expect.anything());
  });

  it('does not update store when system:status ack returns null', () => {
    initSocketBridge(mockSocket, mockStore, mockEngine);

    mockSocket.emit.mockImplementation((event: string, data: any, ack?: (...args: unknown[]) => void) => {
      if (event === 'system:status' && ack) {
        ack(null);
      }
    });

    mockSocket._trigger('connect');
    expect(mockStore.batch).not.toHaveBeenCalled();
  });

  it('hydrates system.health when system:health ack returns ok', () => {
    initSocketBridge(mockSocket, mockStore, mockEngine);

    const healthData = { cpu: 50, memory: 70 };
    mockSocket.emit.mockImplementation((event: string, data: any, ack?: (...args: unknown[]) => void) => {
      if (event === 'system:health' && ack) {
        ack({ ok: true, data: healthData });
      }
    });

    mockSocket._trigger('connect');
    expect(mockStore.set).toHaveBeenCalledWith('system.health', healthData);
  });

  it('defaults buildings to empty array when not provided in status', () => {
    initSocketBridge(mockSocket, mockStore, mockEngine);

    mockSocket.emit.mockImplementation((event: string, data: any, ack?: (...args: unknown[]) => void) => {
      if (event === 'system:status' && ack) {
        ack({ ok: true, data: { isNewUser: false } });
      }
    });

    mockSocket._trigger('connect');
    expect(mockStore.set).toHaveBeenCalledWith('building.list', []);
  });
});

describe('socket "disconnect" event', () => {
  it('sets ui.connected to false', () => {
    initSocketBridge(mockSocket, mockStore, mockEngine);
    mockSocket._trigger('disconnect', 'io server disconnect');
    expect(mockStore.set).toHaveBeenCalledWith('ui.connected', false);
  });

  it('dispatches connection:lost with reason to engine', () => {
    initSocketBridge(mockSocket, mockStore, mockEngine);
    mockSocket._trigger('disconnect', 'transport close');
    expect(mockEngine.dispatch).toHaveBeenCalledWith('connection:lost', { reason: 'transport close' });
  });
});

describe('socket "connect_error" event', () => {
  it('dispatches connection:error with error message to engine', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    initSocketBridge(mockSocket, mockStore, mockEngine);
    mockSocket._trigger('connect_error', { message: 'timeout' });
    expect(mockEngine.dispatch).toHaveBeenCalledWith('connection:error', { message: 'timeout' });
    spy.mockRestore();
  });

  it('logs the error message to console.error', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    initSocketBridge(mockSocket, mockStore, mockEngine);
    mockSocket._trigger('connect_error', { message: 'refused' });
    expect(spy).toHaveBeenCalledWith('[SocketBridge] Connection error:', 'refused');
    spy.mockRestore();
  });
});

// ─── Server → Client broadcast events ───────────────────────

describe('socket "room:agent:entered" event', () => {
  it('updates building.agentPositions in the store', () => {
    initSocketBridge(mockSocket, mockStore, mockEngine);
    const data = { agentId: 'agent-1', roomId: 'room-1', roomType: 'strategy', tableType: 'lead' };
    mockSocket._trigger('room:agent:entered', data);
    expect(mockStore.update).toHaveBeenCalledWith('building.agentPositions', expect.any(Function));
  });

  it('adds agent position to the positions map', () => {
    initSocketBridge(mockSocket, mockStore, mockEngine);
    mockStore._data['building.agentPositions'] = { 'agent-0': { roomId: 'r0', roomType: 'a', tableType: 'b' } };
    const data = { agentId: 'agent-1', roomId: 'room-1', roomType: 'strategy', tableType: 'lead' };
    mockSocket._trigger('room:agent:entered', data);

    // Grab the updater function and invoke it with existing positions
    const updaterFn = mockStore.update.mock.calls[0][1];
    const result = updaterFn({ 'agent-0': { roomId: 'r0' } });
    expect(result['agent-1']).toEqual({ roomId: 'room-1', roomType: 'strategy', tableType: 'lead' });
    expect(result['agent-0']).toEqual({ roomId: 'r0' });
  });

  it('handles null/undefined positions gracefully', () => {
    initSocketBridge(mockSocket, mockStore, mockEngine);
    const data = { agentId: 'agent-1', roomId: 'room-1', roomType: 'strategy', tableType: 'lead' };
    mockSocket._trigger('room:agent:entered', data);

    const updaterFn = mockStore.update.mock.calls[0][1];
    const result = updaterFn(undefined);
    expect(result['agent-1']).toEqual({ roomId: 'room-1', roomType: 'strategy', tableType: 'lead' });
  });

  it('dispatches room:agent:entered to engine', () => {
    initSocketBridge(mockSocket, mockStore, mockEngine);
    const data = { agentId: 'agent-1', roomId: 'room-1', roomType: 'strategy', tableType: 'lead' };
    mockSocket._trigger('room:agent:entered', data);
    expect(mockEngine.dispatch).toHaveBeenCalledWith('room:agent:entered', data);
  });
});

describe('socket "room:agent:exited" event', () => {
  it('removes agent from building.agentPositions', () => {
    initSocketBridge(mockSocket, mockStore, mockEngine);
    const data = { agentId: 'agent-1' };
    mockSocket._trigger('room:agent:exited', data);

    const updaterFn = mockStore.update.mock.calls[0][1];
    const result = updaterFn({ 'agent-1': { roomId: 'r1' }, 'agent-2': { roomId: 'r2' } });
    expect(result['agent-1']).toBeUndefined();
    expect(result['agent-2']).toEqual({ roomId: 'r2' });
  });

  it('handles null positions gracefully on exit', () => {
    initSocketBridge(mockSocket, mockStore, mockEngine);
    mockSocket._trigger('room:agent:exited', { agentId: 'ghost' });

    const updaterFn = mockStore.update.mock.calls[0][1];
    const result = updaterFn(null);
    expect(result).toEqual({});
  });

  it('dispatches room:agent:exited to engine', () => {
    initSocketBridge(mockSocket, mockStore, mockEngine);
    const data = { agentId: 'agent-1' };
    mockSocket._trigger('room:agent:exited', data);
    expect(mockEngine.dispatch).toHaveBeenCalledWith('room:agent:exited', data);
  });
});

describe('socket "chat:response" event', () => {
  it('appends message to chat.messages with type "response" and timestamp', () => {
    initSocketBridge(mockSocket, mockStore, mockEngine);
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now);

    const data = { content: 'Hello from agent', agentId: 'a1' };
    mockSocket._trigger('chat:response', data);

    const updaterFn = mockStore.update.mock.calls[0][1];
    const result = updaterFn([]);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ ...data, type: 'response', timestamp: now });
  });

  it('appends to existing messages', () => {
    initSocketBridge(mockSocket, mockStore, mockEngine);
    mockSocket._trigger('chat:response', { content: 'msg2' });

    const updaterFn = mockStore.update.mock.calls[0][1];
    const existing = [{ content: 'msg1', type: 'user', timestamp: 100 }];
    const result = updaterFn(existing);
    expect(result).toHaveLength(2);
    expect(result[0].content).toBe('msg1');
  });

  it('handles undefined messages array', () => {
    initSocketBridge(mockSocket, mockStore, mockEngine);
    mockSocket._trigger('chat:response', { content: 'first' });

    const updaterFn = mockStore.update.mock.calls[0][1];
    const result = updaterFn(undefined);
    expect(result).toHaveLength(1);
  });

  it('sets ui.processing to false', () => {
    initSocketBridge(mockSocket, mockStore, mockEngine);
    mockSocket._trigger('chat:response', { content: 'done' });
    expect(mockStore.set).toHaveBeenCalledWith('ui.processing', false);
  });

  it('sets ui.streaming to false', () => {
    initSocketBridge(mockSocket, mockStore, mockEngine);
    mockSocket._trigger('chat:response', { content: 'done' });
    expect(mockStore.set).toHaveBeenCalledWith('ui.streaming', false);
  });

  it('dispatches chat:response to engine', () => {
    initSocketBridge(mockSocket, mockStore, mockEngine);
    const data = { content: 'reply' };
    mockSocket._trigger('chat:response', data);
    expect(mockEngine.dispatch).toHaveBeenCalledWith('chat:response', data);
  });
});

describe('socket "chat:stream" event', () => {
  it('sets ui.streaming to true', () => {
    initSocketBridge(mockSocket, mockStore, mockEngine);
    mockSocket._trigger('chat:stream', { chunk: 'partial' });
    expect(mockStore.set).toHaveBeenCalledWith('ui.streaming', true);
  });

  it('dispatches chat:stream to engine', () => {
    initSocketBridge(mockSocket, mockStore, mockEngine);
    const data = { chunk: 'partial text' };
    mockSocket._trigger('chat:stream', data);
    expect(mockEngine.dispatch).toHaveBeenCalledWith('chat:stream', data);
  });
});

describe('socket "tool:executed" event', () => {
  it('prepends tool activity item to activity.items', () => {
    initSocketBridge(mockSocket, mockStore, mockEngine);
    const now = 1700000000000;
    vi.spyOn(Date, 'now').mockReturnValue(now);

    const data = { toolName: 'read_file', result: 'ok' };
    mockSocket._trigger('tool:executed', data);

    const updaterFn = mockStore.update.mock.calls[0][1];
    const result = updaterFn([]);
    expect(result[0]).toEqual({ type: 'tool', toolName: 'read_file', result: 'ok', timestamp: now });
  });

  it('caps activity.items at 100 entries', () => {
    initSocketBridge(mockSocket, mockStore, mockEngine);
    mockSocket._trigger('tool:executed', { toolName: 'test' });

    const updaterFn = mockStore.update.mock.calls[0][1];
    const existingItems = Array.from({ length: 120 }, (_, i) => ({ id: i }));
    const result = updaterFn(existingItems);
    // 1 new item + 99 sliced from existing = 100
    expect(result).toHaveLength(100);
  });

  it('dispatches tool:executed to engine', () => {
    initSocketBridge(mockSocket, mockStore, mockEngine);
    const data = { toolName: 'search' };
    mockSocket._trigger('tool:executed', data);
    expect(mockEngine.dispatch).toHaveBeenCalledWith('tool:executed', data);
  });
});

describe('socket "phase:advanced" event', () => {
  it('sets building.activePhase from data.phase', () => {
    initSocketBridge(mockSocket, mockStore, mockEngine);
    mockSocket._trigger('phase:advanced', { phase: 'design' });
    expect(mockStore.set).toHaveBeenCalledWith('building.activePhase', 'design');
  });

  it('falls back to data.nextPhase if data.phase is falsy', () => {
    initSocketBridge(mockSocket, mockStore, mockEngine);
    mockSocket._trigger('phase:advanced', { nextPhase: 'build' });
    expect(mockStore.set).toHaveBeenCalledWith('building.activePhase', 'build');
  });

  it('prepends phase activity item', () => {
    initSocketBridge(mockSocket, mockStore, mockEngine);
    mockSocket._trigger('phase:advanced', { phase: 'deploy' });

    const updaterFn = mockStore.update.mock.calls[0][1];
    const result = updaterFn([]);
    expect(result[0].type).toBe('phase');
    expect(result[0].phase).toBe('deploy');
  });

  it('dispatches phase:advanced to engine', () => {
    initSocketBridge(mockSocket, mockStore, mockEngine);
    const data = { phase: 'testing' };
    mockSocket._trigger('phase:advanced', data);
    expect(mockEngine.dispatch).toHaveBeenCalledWith('phase:advanced', data);
  });
});

describe('socket "raid:entry:added" event', () => {
  it('prepends entry to raid.entries', () => {
    initSocketBridge(mockSocket, mockStore, mockEngine);
    const data = { id: 'raid-1', type: 'risk', description: 'high latency' };
    mockSocket._trigger('raid:entry:added', data);

    const raidUpdater = mockStore.update.mock.calls.find((c: any) => c[0] === 'raid.entries');
    expect(raidUpdater).toBeDefined();
    const result = raidUpdater![1]([{ id: 'old' }]);
    expect(result[0]).toEqual(data);
    expect(result[1]).toEqual({ id: 'old' });
  });

  it('prepends raid activity item to activity.items', () => {
    initSocketBridge(mockSocket, mockStore, mockEngine);
    const now = 1700000000000;
    vi.spyOn(Date, 'now').mockReturnValue(now);

    const data = { id: 'raid-1' };
    mockSocket._trigger('raid:entry:added', data);

    const activityUpdater = mockStore.update.mock.calls.find((c: any) => c[0] === 'activity.items');
    expect(activityUpdater).toBeDefined();
    const result = activityUpdater![1]([]);
    expect(result[0]).toEqual({ type: 'raid', id: 'raid-1', timestamp: now });
  });

  it('dispatches raid:entry:added to engine', () => {
    initSocketBridge(mockSocket, mockStore, mockEngine);
    const data = { id: 'r1' };
    mockSocket._trigger('raid:entry:added', data);
    expect(mockEngine.dispatch).toHaveBeenCalledWith('raid:entry:added', data);
  });
});

describe('socket "phase-zero:complete" event', () => {
  it('prepends phase-zero activity item', () => {
    initSocketBridge(mockSocket, mockStore, mockEngine);
    const now = 1700000000000;
    vi.spyOn(Date, 'now').mockReturnValue(now);

    mockSocket._trigger('phase-zero:complete', { buildingId: 'b1' });

    const updaterFn = mockStore.update.mock.calls[0][1];
    const result = updaterFn([]);
    expect(result[0].type).toBe('phase-zero');
    expect(result[0].buildingId).toBe('b1');
    expect(result[0].timestamp).toBe(now);
  });

  it('dispatches phase-zero:complete to engine', () => {
    initSocketBridge(mockSocket, mockStore, mockEngine);
    const data = { buildingId: 'b1' };
    mockSocket._trigger('phase-zero:complete', data);
    expect(mockEngine.dispatch).toHaveBeenCalledWith('phase-zero:complete', data);
  });
});

describe('socket "phase-zero:failed" event', () => {
  it('dispatches phase-zero:failed to engine without store update', () => {
    initSocketBridge(mockSocket, mockStore, mockEngine);
    const data = { error: 'strategist failed' };
    mockSocket._trigger('phase-zero:failed', data);
    expect(mockEngine.dispatch).toHaveBeenCalledWith('phase-zero:failed', data);
    // No store.update or store.set called for this event (besides any from init)
    expect(mockStore.update).not.toHaveBeenCalled();
  });
});

describe('socket "scope-change:detected" event', () => {
  it('prepends scope-change entry to raid.entries with type "scope-change"', () => {
    initSocketBridge(mockSocket, mockStore, mockEngine);
    const data = { description: 'scope creep detected', severity: 'high' };
    mockSocket._trigger('scope-change:detected', data);

    const raidUpdater = mockStore.update.mock.calls.find((c: any) => c[0] === 'raid.entries');
    expect(raidUpdater).toBeDefined();
    const result = raidUpdater![1]([]);
    expect(result[0]).toEqual({ ...data, type: 'scope-change' });
  });

  it('dispatches scope-change:detected to engine', () => {
    initSocketBridge(mockSocket, mockStore, mockEngine);
    const data = { description: 'new requirement added' };
    mockSocket._trigger('scope-change:detected', data);
    expect(mockEngine.dispatch).toHaveBeenCalledWith('scope-change:detected', data);
  });
});

describe('socket "exit-doc:submitted" event', () => {
  it('dispatches exit-doc:submitted to engine without store update', () => {
    initSocketBridge(mockSocket, mockStore, mockEngine);
    const data = { roomId: 'r1', agentId: 'a1', document: { summary: 'done' } };
    mockSocket._trigger('exit-doc:submitted', data);
    expect(mockEngine.dispatch).toHaveBeenCalledWith('exit-doc:submitted', data);
    expect(mockStore.update).not.toHaveBeenCalled();
  });
});

// ─── window.overlordSocket API wrappers ──────────────────────

describe('window.overlordSocket.fetchBuilding()', () => {
  it('emits building:get and resolves with the response', async () => {
    initSocketBridge(mockSocket, mockStore, mockEngine);
    const api = (window as any).overlordSocket;

    const ackData = { ok: true, data: { id: 'b1', name: 'HQ' } };
    mockSocket.emit.mockImplementation((_e: string, _d: any, ack?: (...args: unknown[]) => void) => {
      if (ack) ack(ackData);
    });

    const result = await api.fetchBuilding('b1');
    expect(mockSocket.emit).toHaveBeenCalledWith('building:get', { buildingId: 'b1' }, expect.any(Function));
    expect(result).toEqual(ackData);
    expect(mockStore.set).toHaveBeenCalledWith('building.data', ackData.data);
  });

  it('does not set store when response is not ok', async () => {
    initSocketBridge(mockSocket, mockStore, mockEngine);
    const api = (window as any).overlordSocket;

    mockSocket.emit.mockImplementation((_e: string, _d: any, ack?: (...args: unknown[]) => void) => {
      if (ack) ack({ ok: false, error: 'not found' });
    });

    const result = await api.fetchBuilding('bad-id');
    expect(result.ok).toBe(false);
    expect(mockStore.set).not.toHaveBeenCalledWith('building.data', expect.anything());
  });
});

describe('window.overlordSocket.fetchFloors()', () => {
  it('emits floor:list and sets floors.list on ok', async () => {
    initSocketBridge(mockSocket, mockStore, mockEngine);
    const api = (window as any).overlordSocket;

    const floors = [{ id: 'f1' }, { id: 'f2' }];
    mockSocket.emit.mockImplementation((_e: string, _d: any, ack?: (...args: unknown[]) => void) => {
      if (ack) ack({ ok: true, data: floors });
    });

    const result = await api.fetchFloors('b1');
    expect(mockSocket.emit).toHaveBeenCalledWith('floor:list', { buildingId: 'b1' }, expect.any(Function));
    expect(mockStore.set).toHaveBeenCalledWith('floors.list', floors);
    expect(result.ok).toBe(true);
  });
});

describe('window.overlordSocket.fetchFloor()', () => {
  it('emits floor:get and resolves with response', async () => {
    initSocketBridge(mockSocket, mockStore, mockEngine);
    const api = (window as any).overlordSocket;

    const response = { ok: true, data: { id: 'f1', rooms: [] } };
    mockSocket.emit.mockImplementation((_e: string, _d: any, ack?: (...args: unknown[]) => void) => {
      if (ack) ack(response);
    });

    const result = await api.fetchFloor('f1');
    expect(mockSocket.emit).toHaveBeenCalledWith('floor:get', { floorId: 'f1' }, expect.any(Function));
    expect(result).toEqual(response);
  });
});

describe('window.overlordSocket.fetchRoom()', () => {
  it('emits room:get and resolves with response', async () => {
    initSocketBridge(mockSocket, mockStore, mockEngine);
    const api = (window as any).overlordSocket;

    const response = { ok: true, data: { id: 'r1', type: 'strategy' } };
    mockSocket.emit.mockImplementation((_e: string, _d: any, ack?: (...args: unknown[]) => void) => {
      if (ack) ack(response);
    });

    const result = await api.fetchRoom('r1');
    expect(mockSocket.emit).toHaveBeenCalledWith('room:get', { roomId: 'r1' }, expect.any(Function));
    expect(result).toEqual(response);
  });
});

describe('window.overlordSocket.fetchRooms()', () => {
  it('emits room:list and sets rooms.list on ok', async () => {
    initSocketBridge(mockSocket, mockStore, mockEngine);
    const api = (window as any).overlordSocket;

    const rooms = [{ id: 'r1' }];
    mockSocket.emit.mockImplementation((_e: string, _d: any, ack?: (...args: unknown[]) => void) => {
      if (ack) ack({ ok: true, data: rooms });
    });

    const result = await api.fetchRooms();
    expect(mockSocket.emit).toHaveBeenCalledWith('room:list', {}, expect.any(Function));
    expect(mockStore.set).toHaveBeenCalledWith('rooms.list', rooms);
    expect(result.ok).toBe(true);
  });
});

describe('window.overlordSocket.fetchAgents()', () => {
  it('emits agent:list with default empty filters and sets agents.list on ok', async () => {
    initSocketBridge(mockSocket, mockStore, mockEngine);
    const api = (window as any).overlordSocket;

    const agents = [{ id: 'a1', name: 'Strategist' }];
    mockSocket.emit.mockImplementation((_e: string, _d: any, ack?: (...args: unknown[]) => void) => {
      if (ack) ack({ ok: true, data: agents });
    });

    const result = await api.fetchAgents();
    expect(mockSocket.emit).toHaveBeenCalledWith('agent:list', {}, expect.any(Function));
    expect(mockStore.set).toHaveBeenCalledWith('agents.list', agents);
    expect(result.ok).toBe(true);
  });

  it('passes custom filters to agent:list', async () => {
    initSocketBridge(mockSocket, mockStore, mockEngine);
    const api = (window as any).overlordSocket;

    mockSocket.emit.mockImplementation((_e: string, _d: any, ack?: (...args: unknown[]) => void) => {
      if (ack) ack({ ok: true, data: [] });
    });

    await api.fetchAgents({ role: 'lead' });
    expect(mockSocket.emit).toHaveBeenCalledWith('agent:list', { role: 'lead' }, expect.any(Function));
  });
});

describe('window.overlordSocket.fetchAgent()', () => {
  it('emits agent:get and resolves with response', async () => {
    initSocketBridge(mockSocket, mockStore, mockEngine);
    const api = (window as any).overlordSocket;

    const response = { ok: true, data: { id: 'a1' } };
    mockSocket.emit.mockImplementation((_e: string, _d: any, ack?: (...args: unknown[]) => void) => {
      if (ack) ack(response);
    });

    const result = await api.fetchAgent('a1');
    expect(mockSocket.emit).toHaveBeenCalledWith('agent:get', { agentId: 'a1' }, expect.any(Function));
    expect(result).toEqual(response);
  });
});

describe('window.overlordSocket.fetchGates()', () => {
  it('emits phase:gates and sets phase.gates on ok', async () => {
    initSocketBridge(mockSocket, mockStore, mockEngine);
    const api = (window as any).overlordSocket;

    const gates = [{ phase: 'design', passed: true }];
    mockSocket.emit.mockImplementation((_e: string, _d: any, ack?: (...args: unknown[]) => void) => {
      if (ack) ack({ ok: true, data: gates });
    });

    const result = await api.fetchGates('b1');
    expect(mockSocket.emit).toHaveBeenCalledWith('phase:gates', { buildingId: 'b1' }, expect.any(Function));
    expect(mockStore.set).toHaveBeenCalledWith('phase.gates', gates);
    expect(result.ok).toBe(true);
  });
});

describe('window.overlordSocket.fetchCanAdvance()', () => {
  it('emits phase:can-advance and sets phase.canAdvance on ok', async () => {
    initSocketBridge(mockSocket, mockStore, mockEngine);
    const api = (window as any).overlordSocket;

    mockSocket.emit.mockImplementation((_e: string, _d: any, ack?: (...args: unknown[]) => void) => {
      if (ack) ack({ ok: true, data: { canAdvance: true } });
    });

    const result = await api.fetchCanAdvance('b1');
    expect(mockSocket.emit).toHaveBeenCalledWith('phase:can-advance', { buildingId: 'b1' }, expect.any(Function));
    expect(mockStore.set).toHaveBeenCalledWith('phase.canAdvance', true);
    expect(result.ok).toBe(true);
  });
});

describe('window.overlordSocket.searchRaid()', () => {
  it('emits raid:search and sets raid.searchResults on ok', async () => {
    initSocketBridge(mockSocket, mockStore, mockEngine);
    const api = (window as any).overlordSocket;

    const results = [{ id: 'r1', type: 'risk' }];
    mockSocket.emit.mockImplementation((_e: string, _d: any, ack?: (...args: unknown[]) => void) => {
      if (ack) ack({ ok: true, data: results });
    });

    const result = await api.searchRaid({ query: 'latency' });
    expect(mockSocket.emit).toHaveBeenCalledWith('raid:search', { query: 'latency' }, expect.any(Function));
    expect(mockStore.set).toHaveBeenCalledWith('raid.searchResults', results);
    expect(result.ok).toBe(true);
  });
});

describe('window.overlordSocket.fetchRaidEntries()', () => {
  it('emits raid:list and sets raid.entries on ok', async () => {
    initSocketBridge(mockSocket, mockStore, mockEngine);
    const api = (window as any).overlordSocket;

    const entries = [{ id: 'e1' }, { id: 'e2' }];
    mockSocket.emit.mockImplementation((_e: string, _d: any, ack?: (...args: unknown[]) => void) => {
      if (ack) ack({ ok: true, data: entries });
    });

    const result = await api.fetchRaidEntries('b1');
    expect(mockSocket.emit).toHaveBeenCalledWith('raid:list', { buildingId: 'b1' }, expect.any(Function));
    expect(mockStore.set).toHaveBeenCalledWith('raid.entries', entries);
    expect(result.ok).toBe(true);
  });
});

describe('window.overlordSocket.createBuilding()', () => {
  it('emits building:create and appends to building.list on ok', async () => {
    initSocketBridge(mockSocket, mockStore, mockEngine);
    const api = (window as any).overlordSocket;

    const newBuilding = { id: 'b-new', name: 'New HQ' };
    mockSocket.emit.mockImplementation((_e: string, _d: any, ack?: (...args: unknown[]) => void) => {
      if (ack) ack({ ok: true, data: newBuilding });
    });

    const result = await api.createBuilding({ name: 'New HQ' });
    expect(mockSocket.emit).toHaveBeenCalledWith('building:create', { name: 'New HQ' }, expect.any(Function));
    expect(mockStore.update).toHaveBeenCalledWith('building.list', expect.any(Function));
    expect(result.ok).toBe(true);

    // Verify the updater appends
    const updaterFn = mockStore.update.mock.calls.find((c: any) => c[0] === 'building.list')![1];
    const updated = updaterFn([{ id: 'existing' }]);
    expect(updated).toEqual([{ id: 'existing' }, newBuilding]);
  });

  it('handles null existing list', async () => {
    initSocketBridge(mockSocket, mockStore, mockEngine);
    const api = (window as any).overlordSocket;

    mockSocket.emit.mockImplementation((_e: string, _d: any, ack?: (...args: unknown[]) => void) => {
      if (ack) ack({ ok: true, data: { id: 'b1' } });
    });

    await api.createBuilding({ name: 'Test' });
    const updaterFn = mockStore.update.mock.calls.find((c: any) => c[0] === 'building.list')![1];
    const result = updaterFn(undefined);
    expect(result).toEqual([{ id: 'b1' }]);
  });
});

describe('window.overlordSocket.applyBlueprint()', () => {
  it('emits building:apply-blueprint and resolves', async () => {
    initSocketBridge(mockSocket, mockStore, mockEngine);
    const api = (window as any).overlordSocket;

    const response = { ok: true };
    mockSocket.emit.mockImplementation((_e: string, _d: any, ack?: (...args: unknown[]) => void) => {
      if (ack) ack(response);
    });

    const result = await api.applyBlueprint('b1', { rooms: 5 }, 'agent-1');
    expect(mockSocket.emit).toHaveBeenCalledWith(
      'building:apply-blueprint',
      { buildingId: 'b1', blueprint: { rooms: 5 }, agentId: 'agent-1' },
      expect.any(Function)
    );
    expect(result).toEqual(response);
  });
});

describe('window.overlordSocket.registerAgent()', () => {
  it('emits agent:register and appends to agents.list on ok', async () => {
    initSocketBridge(mockSocket, mockStore, mockEngine);
    const api = (window as any).overlordSocket;

    const newAgent = { id: 'a-new', name: 'Builder' };
    mockSocket.emit.mockImplementation((_e: string, _d: any, ack?: (...args: unknown[]) => void) => {
      if (ack) ack({ ok: true, data: newAgent });
    });

    const result = await api.registerAgent({ name: 'Builder', role: 'worker' });
    expect(mockSocket.emit).toHaveBeenCalledWith('agent:register', { name: 'Builder', role: 'worker' }, expect.any(Function));
    expect(result.ok).toBe(true);

    const updaterFn = mockStore.update.mock.calls.find((c: any) => c[0] === 'agents.list')![1];
    const updated = updaterFn([{ id: 'existing' }]);
    expect(updated).toEqual([{ id: 'existing' }, newAgent]);
  });
});

describe('window.overlordSocket.createRoom()', () => {
  it('emits room:create and resolves with response', async () => {
    initSocketBridge(mockSocket, mockStore, mockEngine);
    const api = (window as any).overlordSocket;

    const response = { ok: true, data: { id: 'r-new' } };
    mockSocket.emit.mockImplementation((_e: string, _d: any, ack?: (...args: unknown[]) => void) => {
      if (ack) ack(response);
    });

    const result = await api.createRoom({ type: 'strategy', floorId: 'f1' });
    expect(mockSocket.emit).toHaveBeenCalledWith('room:create', { type: 'strategy', floorId: 'f1' }, expect.any(Function));
    expect(result).toEqual(response);
  });
});

describe('window.overlordSocket.enterRoom()', () => {
  it('emits room:enter with correct params', async () => {
    initSocketBridge(mockSocket, mockStore, mockEngine);
    const api = (window as any).overlordSocket;

    mockSocket.emit.mockImplementation((_e: string, _d: any, ack?: (...args: unknown[]) => void) => {
      if (ack) ack({ ok: true });
    });

    await api.enterRoom('r1', 'a1', 'lead');
    expect(mockSocket.emit).toHaveBeenCalledWith(
      'room:enter',
      { roomId: 'r1', agentId: 'a1', tableType: 'lead' },
      expect.any(Function)
    );
  });
});

describe('window.overlordSocket.exitRoom()', () => {
  it('emits room:exit with correct params', async () => {
    initSocketBridge(mockSocket, mockStore, mockEngine);
    const api = (window as any).overlordSocket;

    mockSocket.emit.mockImplementation((_e: string, _d: any, ack?: (...args: unknown[]) => void) => {
      if (ack) ack({ ok: true });
    });

    await api.exitRoom('r1', 'a1');
    expect(mockSocket.emit).toHaveBeenCalledWith(
      'room:exit',
      { roomId: 'r1', agentId: 'a1' },
      expect.any(Function)
    );
  });
});

describe('window.overlordSocket.sendMessage()', () => {
  it('appends user message to chat.messages', () => {
    initSocketBridge(mockSocket, mockStore, mockEngine);
    const api = (window as any).overlordSocket;
    const now = 1700000000000;
    vi.spyOn(Date, 'now').mockReturnValue(now);

    api.sendMessage('hello', 'a1');

    expect(mockStore.update).toHaveBeenCalledWith('chat.messages', expect.any(Function));
    const updaterFn = mockStore.update.mock.calls.find((c: any) => c[0] === 'chat.messages')![1];
    const result = updaterFn([]);
    expect(result[0]).toEqual({ content: 'hello', agentId: 'a1', type: 'user', timestamp: now });
  });

  it('sets ui.processing to true', () => {
    initSocketBridge(mockSocket, mockStore, mockEngine);
    const api = (window as any).overlordSocket;
    api.sendMessage('test', 'a1');
    expect(mockStore.set).toHaveBeenCalledWith('ui.processing', true);
  });

  it('emits chat:message via socket (fire-and-forget, no ack)', () => {
    initSocketBridge(mockSocket, mockStore, mockEngine);
    const api = (window as any).overlordSocket;
    api.sendMessage('hello world', 'agent-5');
    expect(mockSocket.emit).toHaveBeenCalledWith('chat:message', { content: 'hello world', agentId: 'agent-5' });
  });

  it('does not return a promise (synchronous fire-and-forget)', () => {
    initSocketBridge(mockSocket, mockStore, mockEngine);
    const api = (window as any).overlordSocket;
    const result = api.sendMessage('msg', 'a1');
    expect(result).toBeUndefined();
  });
});

describe('window.overlordSocket.submitExitDoc()', () => {
  it('emits exit-doc:submit with correct params', async () => {
    initSocketBridge(mockSocket, mockStore, mockEngine);
    const api = (window as any).overlordSocket;

    const doc = { summary: 'Phase complete', artifacts: [] };
    mockSocket.emit.mockImplementation((_e: string, _d: any, ack?: (...args: unknown[]) => void) => {
      if (ack) ack({ ok: true });
    });

    await api.submitExitDoc('r1', 'a1', doc);
    expect(mockSocket.emit).toHaveBeenCalledWith(
      'exit-doc:submit',
      { roomId: 'r1', agentId: 'a1', document: doc },
      expect.any(Function)
    );
  });
});

describe('window.overlordSocket.submitGate()', () => {
  it('emits phase:gate and resolves with response', async () => {
    initSocketBridge(mockSocket, mockStore, mockEngine);
    const api = (window as any).overlordSocket;

    const response = { ok: true, data: { passed: true } };
    mockSocket.emit.mockImplementation((_e: string, _d: any, ack?: (...args: unknown[]) => void) => {
      if (ack) ack(response);
    });

    const result = await api.submitGate({ buildingId: 'b1', phase: 'design' });
    expect(mockSocket.emit).toHaveBeenCalledWith(
      'phase:gate',
      { buildingId: 'b1', phase: 'design' },
      expect.any(Function)
    );
    expect(result).toEqual(response);
  });
});
