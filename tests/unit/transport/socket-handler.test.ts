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
}));

import { createBuilding, getBuilding, listBuildings } from '../../../src/rooms/building-manager.js';

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
  });

  describe('phase and RAID events', () => {
    it('phase:status emits to bus', () => {
      const ack = vi.fn();
      socket.emit('phase:status', { buildingId: 'b1' }, ack);

      const event = bus.emitted.find((e) => e.event === 'phase:status');
      expect(event).toBeDefined();
      expect(ack).toHaveBeenCalledWith({ ok: true });
    });

    it('raid:search emits to bus', () => {
      const ack = vi.fn();
      socket.emit('raid:search', { type: 'risk' }, ack);

      const event = bus.emitted.find((e) => e.event === 'raid:search');
      expect(event).toBeDefined();
      expect(ack).toHaveBeenCalledWith({ ok: true });
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
  });
});
