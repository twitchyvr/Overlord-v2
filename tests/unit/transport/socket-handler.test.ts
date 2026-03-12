/**
 * Socket Handler (Transport Layer) Tests
 *
 * Tests the Socket.IO event → bus/API routing.
 * Uses mocked Socket.IO server and bus — no real network IO.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'eventemitter3';
import { initTransport } from '../../../src/transport/socket-handler.js';
import type { RoomManagerAPI, AgentRegistryAPI, ToolRegistryAPI } from '../../../src/core/contracts.js';

// Mock building-manager — imported directly by socket-handler
vi.mock('../../../src/rooms/building-manager.js', () => ({
  createBuilding: vi.fn().mockReturnValue({ ok: true, data: { id: 'bld_1', name: 'Test Building' } }),
  getBuilding: vi.fn().mockReturnValue({ ok: true, data: { id: 'bld_1', name: 'Test Building', floors: [] } }),
  listBuildings: vi.fn().mockReturnValue({ ok: true, data: [] }),
  listFloors: vi.fn().mockReturnValue({ ok: true, data: [] }),
  getFloor: vi.fn().mockReturnValue({ ok: true, data: { id: 'floor_1', type: 'collaboration', rooms: [] } }),
}));

import { createBuilding, getBuilding, listBuildings, listFloors, getFloor } from '../../../src/rooms/building-manager.js';

// Mock phase-gate — imported directly by socket-handler
vi.mock('../../../src/rooms/phase-gate.js', () => ({
  getGates: vi.fn().mockReturnValue({ ok: true, data: [] }),
  canAdvance: vi.fn().mockReturnValue({ ok: true, data: { canAdvance: false, reason: 'No gate exists' } }),
  signoffGate: vi.fn().mockReturnValue({ ok: true, data: { gateId: 'gate_1', verdict: 'GO', status: 'go' } }),
  createGate: vi.fn().mockReturnValue({ ok: true, data: { id: 'gate_1', phase: 'strategy', status: 'pending' } }),
}));

import { getGates, canAdvance, signoffGate, createGate } from '../../../src/rooms/phase-gate.js';

// Mock raid-log — imported directly by socket-handler
vi.mock('../../../src/rooms/raid-log.js', () => ({
  searchRaid: vi.fn().mockReturnValue({ ok: true, data: [] }),
  addRaidEntry: vi.fn().mockReturnValue({ ok: true, data: { id: 'raid_1' } }),
  updateRaidStatus: vi.fn().mockReturnValue({ ok: true, data: { id: 'raid_1', status: 'closed' } }),
}));

import { searchRaid, addRaidEntry, updateRaidStatus } from '../../../src/rooms/raid-log.js';

// Mock room-manager — submitExitDocument imported directly by socket-handler
vi.mock('../../../src/rooms/room-manager.js', () => ({
  submitExitDocument: vi.fn().mockReturnValue({ ok: true, data: { id: 'exitdoc_1', roomId: 'r1', raidEntryIds: [] } }),
}));

import { submitExitDocument } from '../../../src/rooms/room-manager.js';

// Mock storage/db — getDb imported directly by socket-handler for task/todo queries
vi.mock('../../../src/storage/db.js', () => {
  const mockStmt = {
    run: vi.fn(),
    get: vi.fn().mockReturnValue(null),
    all: vi.fn().mockReturnValue([]),
  };
  return {
    getDb: vi.fn().mockReturnValue({
      prepare: vi.fn().mockReturnValue(mockStmt),
    }),
  };
});

import { getDb } from '../../../src/storage/db.js';

// Mock phase-zero — imported directly by socket-handler
vi.mock('../../../src/rooms/phase-zero.js', () => ({
  handleBlueprintSubmission: vi.fn().mockReturnValue({ ok: true, data: { buildingId: 'bld_1', mode: 'quickStart', phaseAdvanced: true } }),
}));

import { handleBlueprintSubmission } from '../../../src/rooms/phase-zero.js';

// Mock socket — emulates a Socket.IO socket with on/emit
class MockSocket extends EventEmitter {
  id = 'socket_test_1';
  emitted: Array<{ event: string; data: unknown }> = [];

  override emit(event: string | symbol, ...args: unknown[]): boolean {
    this.emitted.push({ event: String(event), data: args[0] });
    return super.emit(event, ...args);
  }
}

// Mock Socket.IO server — stores connection handlers and connected sockets
class MockIOServer extends EventEmitter {
  sockets: MockSocket[] = [];
  broadcasted: Array<{ event: string; data: unknown }> = [];

  // Simulate a new client connecting
  simulateConnection(socket: MockSocket): void {
    this.sockets.push(socket);
    // Trigger the 'connection' handler
    super.emit('connection', socket);
  }

  // Mock io.emit for broadcasts
  override emit(event: string | symbol, ...args: unknown[]): boolean {
    this.broadcasted.push({ event: String(event), data: args[0] });
    return true;
  }
}

// Mock bus
class MockBus extends EventEmitter {
  emitted: Array<{ event: string; data: unknown }> = [];

  override emit(event: string | symbol, data?: unknown): boolean {
    this.emitted.push({ event: String(event), data });
    return super.emit(event, data);
  }
}

describe('Socket Handler (Transport Layer)', () => {
  let io: MockIOServer;
  let bus: MockBus;
  let socket: MockSocket;
  let rooms: RoomManagerAPI;
  let agents: AgentRegistryAPI;
  let tools: ToolRegistryAPI;

  beforeEach(() => {
    vi.clearAllMocks();
    io = new MockIOServer();
    bus = new MockBus();
    socket = new MockSocket();

    // Mock room manager
    rooms = {
      createRoom: vi.fn().mockReturnValue({ ok: true, data: { id: 'room_1', type: 'code-lab', name: 'Lab' } }),
      enterRoom: vi.fn().mockReturnValue({ ok: true, data: { roomId: 'room_1', agentId: 'agent_1', tools: ['read_file'] } }),
      exitRoom: vi.fn().mockReturnValue({ ok: true, data: { roomId: 'room_1', agentId: 'agent_1' } }),
      getRoom: vi.fn().mockReturnValue(null),
      listRooms: vi.fn().mockReturnValue([]),
      registerRoomType: vi.fn(),
    };

    // Mock agent registry
    agents = {
      registerAgent: vi.fn().mockReturnValue({ ok: true, data: { id: 'agent_1', name: 'Coder' } }),
      removeAgent: vi.fn().mockReturnValue({ ok: true }),
      getAgent: vi.fn().mockReturnValue(null),
      listAgents: vi.fn().mockReturnValue([]),
      updateAgent: vi.fn().mockReturnValue({ ok: true }),
    };

    // Mock tool registry
    tools = {
      registerTool: vi.fn(),
      getTool: vi.fn().mockReturnValue(null),
      getToolsForRoom: vi.fn().mockReturnValue([]),
      executeInRoom: vi.fn().mockResolvedValue({ ok: true, data: {} }),
    };

    // Initialize transport
    initTransport({ io: io as any, bus: bus as any, rooms, agents, tools });
    io.simulateConnection(socket);
  });

  describe('connection lifecycle', () => {
    it('registers handlers on socket connection', () => {
      // The socket should now have listeners for all our events
      expect(socket.listenerCount('building:create')).toBeGreaterThan(0);
      expect(socket.listenerCount('building:get')).toBeGreaterThan(0);
      expect(socket.listenerCount('building:list')).toBeGreaterThan(0);
      expect(socket.listenerCount('room:create')).toBeGreaterThan(0);
      expect(socket.listenerCount('room:enter')).toBeGreaterThan(0);
      expect(socket.listenerCount('room:exit')).toBeGreaterThan(0);
      expect(socket.listenerCount('room:list')).toBeGreaterThan(0);
      expect(socket.listenerCount('agent:register')).toBeGreaterThan(0);
      expect(socket.listenerCount('agent:list')).toBeGreaterThan(0);
      expect(socket.listenerCount('chat:message')).toBeGreaterThan(0);
      expect(socket.listenerCount('system:health')).toBeGreaterThan(0);
      expect(socket.listenerCount('system:status')).toBeGreaterThan(0);
      expect(socket.listenerCount('disconnect')).toBeGreaterThan(0);
      expect(socket.listenerCount('floor:list')).toBeGreaterThan(0);
      expect(socket.listenerCount('floor:get')).toBeGreaterThan(0);
      expect(socket.listenerCount('room:get')).toBeGreaterThan(0);
      expect(socket.listenerCount('agent:get')).toBeGreaterThan(0);
      expect(socket.listenerCount('phase:gates')).toBeGreaterThan(0);
      expect(socket.listenerCount('phase:can-advance')).toBeGreaterThan(0);
      expect(socket.listenerCount('raid:list')).toBeGreaterThan(0);
      expect(socket.listenerCount('exit-doc:submit')).toBeGreaterThan(0);
      expect(socket.listenerCount('building:apply-blueprint')).toBeGreaterThan(0);
    });
  });

  describe('floor events', () => {
    it('floor:list calls listFloors and acks result', () => {
      const ack = vi.fn();
      socket.emit('floor:list', { buildingId: 'bld_1' }, ack);
      expect(listFloors).toHaveBeenCalledWith('bld_1');
      expect(ack).toHaveBeenCalledWith({ ok: true, data: [] });
    });

    it('floor:get calls getFloor and acks result', () => {
      const ack = vi.fn();
      socket.emit('floor:get', { floorId: 'floor_1' }, ack);
      expect(getFloor).toHaveBeenCalledWith('floor_1');
      expect(ack).toHaveBeenCalledWith(expect.objectContaining({ ok: true }));
    });
  });

  describe('room events', () => {
    it('room:create calls rooms.createRoom and acks result', () => {
      const ack = vi.fn();
      socket.emit('room:create', { type: 'code-lab', floorId: 'f1', name: 'Lab' }, ack);

      expect(rooms.createRoom).toHaveBeenCalledWith({ type: 'code-lab', floorId: 'f1', name: 'Lab' });
      expect(ack).toHaveBeenCalledWith({ ok: true, data: { id: 'room_1', type: 'code-lab', name: 'Lab' } });
    });

    it('room:list calls rooms.listRooms and acks result', () => {
      (rooms.listRooms as ReturnType<typeof vi.fn>).mockReturnValue([
        { id: 'r1', type: 'code-lab', name: 'Lab A' },
      ]);

      const ack = vi.fn();
      socket.emit('room:list', {}, ack);

      expect(rooms.listRooms).toHaveBeenCalled();
      expect(ack).toHaveBeenCalledWith({
        ok: true,
        data: [{ id: 'r1', type: 'code-lab', name: 'Lab A' }],
      });
    });

    it('room:enter calls rooms.enterRoom and acks result', () => {
      const ack = vi.fn();
      socket.emit('room:enter', { roomId: 'room_1', agentId: 'agent_1' }, ack);

      expect(rooms.enterRoom).toHaveBeenCalledWith({ roomId: 'room_1', agentId: 'agent_1' });
      expect(ack).toHaveBeenCalled();
    });

    it('room:exit calls rooms.exitRoom and acks result', () => {
      const ack = vi.fn();
      socket.emit('room:exit', { roomId: 'room_1', agentId: 'agent_1' }, ack);

      expect(rooms.exitRoom).toHaveBeenCalledWith({ roomId: 'room_1', agentId: 'agent_1' });
      expect(ack).toHaveBeenCalled();
    });

    it('room:get returns ROOM_NOT_FOUND when room does not exist', () => {
      const ack = vi.fn();
      socket.emit('room:get', { roomId: 'nonexistent' }, ack);
      expect(ack).toHaveBeenCalledWith(expect.objectContaining({
        ok: false,
        error: expect.objectContaining({ code: 'ROOM_NOT_FOUND' }),
      }));
    });

    it('room:get returns room data when room exists', () => {
      const mockRoom = {
        id: 'room_1',
        type: 'code-lab',
        getAllowedTools: () => ['bash', 'read_file'],
        fileScope: 'assigned',
        exitRequired: { type: 'code-review', fields: ['summary'] },
        escalation: { onComplete: 'review' },
        config: { tables: { focus: { chairs: 1, description: 'Solo work' } } },
      };
      (rooms.getRoom as ReturnType<typeof vi.fn>).mockReturnValueOnce(mockRoom);

      const ack = vi.fn();
      socket.emit('room:get', { roomId: 'room_1' }, ack);
      expect(ack).toHaveBeenCalledWith({
        ok: true,
        data: {
          id: 'room_1',
          type: 'code-lab',
          tools: ['bash', 'read_file'],
          fileScope: 'assigned',
          exitRequired: { type: 'code-review', fields: ['summary'] },
          escalation: { onComplete: 'review' },
          tables: { focus: { chairs: 1, description: 'Solo work' } },
        },
      });
    });
  });

  describe('agent events', () => {
    it('agent:register calls agents.registerAgent and acks', () => {
      const ack = vi.fn();
      socket.emit('agent:register', { name: 'Coder', role: 'developer' }, ack);

      expect(agents.registerAgent).toHaveBeenCalledWith({ name: 'Coder', role: 'developer' });
      expect(ack).toHaveBeenCalledWith({ ok: true, data: { id: 'agent_1', name: 'Coder' } });
    });

    it('agent:list calls agents.listAgents and acks', () => {
      (agents.listAgents as ReturnType<typeof vi.fn>).mockReturnValue([
        { id: 'a1', name: 'Coder', status: 'idle' },
      ]);

      const ack = vi.fn();
      socket.emit('agent:list', {}, ack);

      expect(agents.listAgents).toHaveBeenCalled();
      expect(ack).toHaveBeenCalledWith({
        ok: true,
        data: [{ id: 'a1', name: 'Coder', status: 'idle' }],
      });
    });

    it('agent:get returns AGENT_NOT_FOUND when agent does not exist', () => {
      const ack = vi.fn();
      socket.emit('agent:get', { agentId: 'nonexistent' }, ack);
      expect(ack).toHaveBeenCalledWith(expect.objectContaining({
        ok: false,
        error: expect.objectContaining({ code: 'AGENT_NOT_FOUND' }),
      }));
    });

    it('agent:get returns agent data when agent exists', () => {
      const mockAgent = { id: 'a1', name: 'Coder', role: 'developer', status: 'idle' };
      (agents.getAgent as ReturnType<typeof vi.fn>).mockReturnValueOnce(mockAgent);

      const ack = vi.fn();
      socket.emit('agent:get', { agentId: 'a1' }, ack);
      expect(ack).toHaveBeenCalledWith({ ok: true, data: mockAgent });
    });
  });

  describe('chat events', () => {
    it('chat:message emits to bus with socket ID', () => {
      socket.emit('chat:message', { content: 'Hello', agentId: 'a1' });

      const chatEvent = bus.emitted.find((e) => e.event === 'chat:message');
      expect(chatEvent).toBeDefined();
      expect(chatEvent!.data).toEqual(expect.objectContaining({
        content: 'Hello',
        agentId: 'a1',
        socketId: 'socket_test_1',
      }));
    });
  });

  describe('system events', () => {
    it('system:health returns uptime and version', () => {
      const ack = vi.fn();
      socket.emit('system:health', {}, ack);

      expect(ack).toHaveBeenCalledWith(expect.objectContaining({
        ok: true,
        data: expect.objectContaining({
          version: '0.1.0',
        }),
      }));
    });
  });

  describe('bus → socket broadcasts', () => {
    it('broadcasts room:agent:entered from bus to all sockets', () => {
      bus.emit('room:agent:entered', { roomId: 'r1', agentId: 'a1' });

      const broadcast = io.broadcasted.find((b) => b.event === 'room:agent:entered');
      expect(broadcast).toBeDefined();
    });

    it('broadcasts chat:stream from bus to all sockets', () => {
      bus.emit('chat:stream', { agentId: 'a1', content: 'streaming...' });

      const broadcast = io.broadcasted.find((b) => b.event === 'chat:stream');
      expect(broadcast).toBeDefined();
    });

    it('broadcasts tool:executed from bus to all sockets', () => {
      bus.emit('tool:executed', { toolName: 'bash', success: true });

      const broadcast = io.broadcasted.find((b) => b.event === 'tool:executed');
      expect(broadcast).toBeDefined();
    });

    it('broadcasts phase:advanced from bus to all sockets', () => {
      bus.emit('phase:advanced', { phase: 'architecture' });

      const broadcast = io.broadcasted.find((b) => b.event === 'phase:advanced');
      expect(broadcast).toBeDefined();
    });

    it('broadcasts raid:entry:added from bus to all sockets', () => {
      bus.emit('raid:entry:added', { id: 'r1', type: 'decision' });

      const broadcast = io.broadcasted.find((b) => b.event === 'raid:entry:added');
      expect(broadcast).toBeDefined();
    });

    it('broadcasts room:agent:exited from bus to all sockets', () => {
      bus.emit('room:agent:exited', { roomId: 'r1', agentId: 'a1' });

      const broadcast = io.broadcasted.find((b) => b.event === 'room:agent:exited');
      expect(broadcast).toBeDefined();
    });

    it('broadcasts chat:response from bus to all sockets', () => {
      bus.emit('chat:response', { agentId: 'a1', content: 'reply text' });

      const broadcast = io.broadcasted.find((b) => b.event === 'chat:response');
      expect(broadcast).toBeDefined();
    });
  });

  describe('phase and RAID events', () => {
    it('phase:status emits to bus', () => {
      const ack = vi.fn();
      socket.emit('phase:status', { buildingId: 'b1' }, ack);

      const event = bus.emitted.find((e) => e.event === 'phase:status');
      expect(event).toBeDefined();
      expect(ack).toHaveBeenCalledWith({ ok: true });
    });

    it('raid:search calls searchRaid and acks result', () => {
      const ack = vi.fn();
      socket.emit('raid:search', { type: 'risk' }, ack);

      expect(searchRaid).toHaveBeenCalledWith({ type: 'risk' });
      expect(ack).toHaveBeenCalledWith({ ok: true, data: [] });
    });
  });

  describe('phase gate events', () => {
    it('phase:gates calls getGates and acks result', () => {
      const ack = vi.fn();
      socket.emit('phase:gates', { buildingId: 'bld_1' }, ack);
      expect(getGates).toHaveBeenCalledWith('bld_1');
      expect(ack).toHaveBeenCalledWith({ ok: true, data: [] });
    });

    it('phase:can-advance calls canAdvance and acks result', () => {
      const ack = vi.fn();
      socket.emit('phase:can-advance', { buildingId: 'bld_1' }, ack);
      expect(canAdvance).toHaveBeenCalledWith('bld_1');
      expect(ack).toHaveBeenCalledWith(expect.objectContaining({ ok: true }));
    });
  });

  describe('RAID list events', () => {
    it('raid:list calls searchRaid and acks result', () => {
      const ack = vi.fn();
      socket.emit('raid:list', { buildingId: 'bld_1' }, ack);
      expect(searchRaid).toHaveBeenCalledWith({ buildingId: 'bld_1' });
      expect(ack).toHaveBeenCalledWith({ ok: true, data: [] });
    });
  });

  describe('exit document events', () => {
    it('exit-doc:submit calls submitExitDocument, emits to bus, and acks result', () => {
      const ack = vi.fn();
      socket.emit('exit-doc:submit', { roomId: 'r1', agentId: 'a1', document: { summary: 'test' } }, ack);

      expect(submitExitDocument).toHaveBeenCalledWith(expect.objectContaining({
        roomId: 'r1',
        agentId: 'a1',
        document: { summary: 'test' },
      }));

      const busEvent = bus.emitted.find((e) => e.event === 'exit-doc:submitted');
      expect(busEvent).toBeDefined();
      expect(busEvent!.data).toEqual(expect.objectContaining({
        roomId: 'r1',
        agentId: 'a1',
        document: { summary: 'test' },
      }));
      expect(ack).toHaveBeenCalledWith(expect.objectContaining({ ok: true }));
    });
  });

  describe('building events', () => {
    it('building:create calls createBuilding and acks', () => {
      const ack = vi.fn();
      socket.emit('building:create', { name: 'My Project' }, ack);

      expect(createBuilding).toHaveBeenCalledWith({ name: 'My Project' });
      expect(ack).toHaveBeenCalledWith({ ok: true, data: { id: 'bld_1', name: 'Test Building' } });
    });

    it('building:get calls getBuilding and acks', () => {
      const ack = vi.fn();
      socket.emit('building:get', { buildingId: 'bld_1' }, ack);

      expect(getBuilding).toHaveBeenCalledWith('bld_1');
      expect(ack).toHaveBeenCalledWith({ ok: true, data: { id: 'bld_1', name: 'Test Building', floors: [] } });
    });

    it('building:list calls listBuildings and acks', () => {
      const ack = vi.fn();
      socket.emit('building:list', {}, ack);

      expect(listBuildings).toHaveBeenCalled();
      expect(ack).toHaveBeenCalled();
    });

    it('building:apply-blueprint calls handleBlueprintSubmission and acks', () => {
      const ack = vi.fn();
      socket.emit('building:apply-blueprint', { buildingId: 'bld_1', blueprint: { mode: 'quickStart' }, agentId: 'a1' }, ack);
      expect(handleBlueprintSubmission).toHaveBeenCalledWith({
        buildingId: 'bld_1',
        blueprint: { mode: 'quickStart' },
        agentId: 'a1',
      });
      expect(ack).toHaveBeenCalledWith(expect.objectContaining({ ok: true }));
    });
  });

  describe('system:status (returning-user check)', () => {
    it('returns isNewUser=true when no buildings exist', () => {
      const ack = vi.fn();
      socket.emit('system:status', {}, ack);

      expect(ack).toHaveBeenCalledWith({
        ok: true,
        data: { isNewUser: true, buildings: [] },
      });
    });

    it('returns isNewUser=false when buildings exist', () => {
      (listBuildings as ReturnType<typeof vi.fn>).mockReturnValue({
        ok: true,
        data: [{ id: 'bld_1', name: 'Project Alpha', active_phase: 'discovery' }],
      });

      const ack = vi.fn();
      socket.emit('system:status', {}, ack);

      expect(ack).toHaveBeenCalledWith({
        ok: true,
        data: {
          isNewUser: false,
          buildings: [{ id: 'bld_1', name: 'Project Alpha', activePhase: 'discovery' }],
        },
      });
    });
  });

  describe('Phase Zero bus → socket broadcasts', () => {
    it('broadcasts phase-zero:complete from bus to all sockets', () => {
      bus.emit('phase-zero:complete', { buildingId: 'bld_1', phase: 'strategy' });

      const broadcast = io.broadcasted.find((b) => b.event === 'phase-zero:complete');
      expect(broadcast).toBeDefined();
    });

    it('broadcasts scope-change:detected from bus to all sockets', () => {
      bus.emit('scope-change:detected', { buildingId: 'bld_1', targetRoomType: 'discovery' });

      const broadcast = io.broadcasted.find((b) => b.event === 'scope-change:detected');
      expect(broadcast).toBeDefined();
    });

    it('broadcasts phase-zero:failed from bus to all sockets', () => {
      bus.emit('phase-zero:failed', { buildingId: 'bld_1', error: 'test' });
      const broadcast = io.broadcasted.find((b) => b.event === 'phase-zero:failed');
      expect(broadcast).toBeDefined();
    });

    it('broadcasts exit-doc:submitted from bus to all sockets', () => {
      bus.emit('exit-doc:submitted', { roomId: 'r1', agentId: 'a1' });
      const broadcast = io.broadcasted.find((b) => b.event === 'exit-doc:submitted');
      expect(broadcast).toBeDefined();
    });

    it('broadcasts agent:status-changed from bus to all sockets', () => {
      bus.emit('agent:status-changed', { agentId: 'a1', status: 'active', roomId: 'r1' });
      const broadcast = io.broadcasted.find((b) => b.event === 'agent:status-changed');
      expect(broadcast).toBeDefined();
    });

    it('broadcasts building:updated from bus to all sockets', () => {
      bus.emit('building:updated', { id: 'b1', activePhase: 'discovery' });
      const broadcast = io.broadcasted.find((b) => b.event === 'building:updated');
      expect(broadcast).toBeDefined();
    });
  });

  describe('error handling', () => {
    it('building:create acks VALIDATION_ERROR when name is empty', () => {
      const ack = vi.fn();
      socket.emit('building:create', { name: '' }, ack);

      expect(ack).toHaveBeenCalledWith({
        ok: false,
        error: expect.objectContaining({
          code: 'VALIDATION_ERROR',
          retryable: false,
        }),
      });
      // createBuilding should NOT be called — validation rejects first
      expect(createBuilding).not.toHaveBeenCalled();
    });

    it('building:create acks error result when createBuilding returns failure', () => {
      (createBuilding as ReturnType<typeof vi.fn>).mockReturnValueOnce({
        ok: false,
        error: { code: 'INTERNAL', message: 'DB write failed', retryable: true },
      });

      const ack = vi.fn();
      socket.emit('building:create', { name: 'Valid Name' }, ack);

      expect(ack).toHaveBeenCalledWith({
        ok: false,
        error: { code: 'INTERNAL', message: 'DB write failed', retryable: true },
      });
    });
  });

  // ─── Zod validation rejection ─────────────────────────────────────

  describe('Zod validation rejection', () => {
    it('building:get rejects missing buildingId', () => {
      const ack = vi.fn();
      socket.emit('building:get', {}, ack);

      expect(ack).toHaveBeenCalledWith({
        ok: false,
        error: expect.objectContaining({
          code: 'VALIDATION_ERROR',
          retryable: false,
        }),
      });
      expect(getBuilding).not.toHaveBeenCalled();
    });

    it('building:get rejects empty buildingId', () => {
      const ack = vi.fn();
      socket.emit('building:get', { buildingId: '' }, ack);

      expect(ack).toHaveBeenCalledWith({
        ok: false,
        error: expect.objectContaining({
          code: 'VALIDATION_ERROR',
          retryable: false,
        }),
      });
    });

    it('room:create rejects missing type', () => {
      const ack = vi.fn();
      socket.emit('room:create', { floorId: 'f1' }, ack);

      expect(ack).toHaveBeenCalledWith({
        ok: false,
        error: expect.objectContaining({
          code: 'VALIDATION_ERROR',
          retryable: false,
        }),
      });
      expect(rooms.createRoom).not.toHaveBeenCalled();
    });

    it('room:create rejects missing floorId', () => {
      const ack = vi.fn();
      socket.emit('room:create', { type: 'code-lab' }, ack);

      expect(ack).toHaveBeenCalledWith({
        ok: false,
        error: expect.objectContaining({
          code: 'VALIDATION_ERROR',
          retryable: false,
        }),
      });
    });

    it('agent:register rejects missing name', () => {
      const ack = vi.fn();
      socket.emit('agent:register', {}, ack);

      expect(ack).toHaveBeenCalledWith({
        ok: false,
        error: expect.objectContaining({
          code: 'VALIDATION_ERROR',
          retryable: false,
        }),
      });
      expect(agents.registerAgent).not.toHaveBeenCalled();
    });

    it('agent:register rejects empty name', () => {
      const ack = vi.fn();
      socket.emit('agent:register', { name: '' }, ack);

      expect(ack).toHaveBeenCalledWith({
        ok: false,
        error: expect.objectContaining({
          code: 'VALIDATION_ERROR',
          retryable: false,
        }),
      });
    });

    it('phase:gates rejects missing buildingId', () => {
      const ack = vi.fn();
      socket.emit('phase:gates', {}, ack);

      expect(ack).toHaveBeenCalledWith({
        ok: false,
        error: expect.objectContaining({
          code: 'VALIDATION_ERROR',
          retryable: false,
        }),
      });
      expect(getGates).not.toHaveBeenCalled();
    });

    it('phase:gate:signoff rejects missing required fields', () => {
      const ack = vi.fn();
      socket.emit('phase:gate:signoff', { gateId: 'g1' }, ack);

      expect(ack).toHaveBeenCalledWith({
        ok: false,
        error: expect.objectContaining({
          code: 'VALIDATION_ERROR',
          retryable: false,
        }),
      });
      expect(signoffGate).not.toHaveBeenCalled();
    });

    it('phase:gate:signoff rejects invalid verdict enum', () => {
      const ack = vi.fn();
      socket.emit('phase:gate:signoff', {
        gateId: 'g1',
        reviewer: 'alice',
        verdict: 'MAYBE',
      }, ack);

      expect(ack).toHaveBeenCalledWith({
        ok: false,
        error: expect.objectContaining({
          code: 'VALIDATION_ERROR',
          retryable: false,
        }),
      });
    });

    it('raid:add rejects missing summary', () => {
      const ack = vi.fn();
      socket.emit('raid:add', { buildingId: 'bld_1', type: 'risk' }, ack);

      expect(ack).toHaveBeenCalledWith({
        ok: false,
        error: expect.objectContaining({
          code: 'VALIDATION_ERROR',
          retryable: false,
        }),
      });
      expect(addRaidEntry).not.toHaveBeenCalled();
    });

    it('room:enter rejects missing agentId', () => {
      const ack = vi.fn();
      socket.emit('room:enter', { roomId: 'r1' }, ack);

      expect(ack).toHaveBeenCalledWith({
        ok: false,
        error: expect.objectContaining({
          code: 'VALIDATION_ERROR',
          retryable: false,
        }),
      });
      expect(rooms.enterRoom).not.toHaveBeenCalled();
    });

    it('exit-doc:submit rejects missing roomId', () => {
      const ack = vi.fn();
      socket.emit('exit-doc:submit', { agentId: 'a1' }, ack);

      expect(ack).toHaveBeenCalledWith({
        ok: false,
        error: expect.objectContaining({
          code: 'VALIDATION_ERROR',
          retryable: false,
        }),
      });
      expect(submitExitDocument).not.toHaveBeenCalled();
    });

    it('validation error message includes field path', () => {
      const ack = vi.fn();
      socket.emit('building:get', {}, ack);

      const call = ack.mock.calls[0][0];
      expect(call.error.message).toContain('buildingId');
      expect(call.error.message).toContain('building:get');
    });

    it('handles null/undefined data gracefully', () => {
      const ack = vi.fn();
      socket.emit('building:get', null, ack);

      expect(ack).toHaveBeenCalledWith({
        ok: false,
        error: expect.objectContaining({
          code: 'VALIDATION_ERROR',
          retryable: false,
        }),
      });
    });

    it('handles non-object data gracefully', () => {
      const ack = vi.fn();
      socket.emit('building:get', 'not-an-object', ack);

      expect(ack).toHaveBeenCalledWith({
        ok: false,
        error: expect.objectContaining({
          code: 'VALIDATION_ERROR',
          retryable: false,
        }),
      });
    });
  });

  describe('connection lifecycle (continued)', () => {
    it('disconnect event fires without error', () => {
      expect(() => {
        socket.emit('disconnect');
      }).not.toThrow();
    });
  });
});
