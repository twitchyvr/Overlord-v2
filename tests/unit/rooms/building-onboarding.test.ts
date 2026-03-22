/**
 * Building Onboarding Tests
 *
 * Tests auto-provisioning of rooms and agents when buildings are created
 * or when phases advance.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EventEmitter } from 'eventemitter3';
import Database from 'better-sqlite3';
import type { Bus, BusEventData } from '../../../src/core/bus.js';
import type { RoomManagerAPI, AgentRegistryAPI } from '../../../src/core/contracts.js';
import { initBuildingOnboarding } from '../../../src/rooms/building-onboarding.js';

let db: Database.Database;

// Mock getDb at module level so it survives dynamic imports
vi.mock('../../../src/storage/db.js', () => ({
  getDb: () => db,
}));

function setupDb(): Database.Database {
  const memDb = new Database(':memory:');
  memDb.pragma('foreign_keys = OFF');
  memDb.pragma('journal_mode = MEMORY');
  // SQLite Database.prototype methods — not shell commands
  const stmts = [
    `CREATE TABLE buildings (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      active_phase TEXT DEFAULT 'strategy',
      created_at TEXT DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE floors (
      id TEXT PRIMARY KEY,
      building_id TEXT NOT NULL,
      type TEXT NOT NULL,
      name TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE rooms (
      id TEXT PRIMARY KEY,
      floor_id TEXT NOT NULL,
      type TEXT NOT NULL,
      name TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )`,
  ];
  for (const stmt of stmts) {
    memDb.prepare(stmt).run();
  }
  return memDb;
}

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

function createMockRooms(): RoomManagerAPI {
  let roomCounter = 0;
  const activeRooms = new Map<string, { id: string; type: string; tables: Record<string, { chairs: number }>; config: Record<string, unknown> }>();

  return {
    createRoom: vi.fn(({ type, floorId, name }: { type: string; floorId: string; name: string }) => {
      const id = `room_${++roomCounter}`;
      const room = { id, type, tables: { focus: { chairs: 1 } }, config: {} };
      activeRooms.set(id, room);
      db.prepare('INSERT INTO rooms (id, floor_id, type, name) VALUES (?, ?, ?, ?)').run(id, floorId, type, name);
      return { ok: true, data: { id } };
    }),
    getRoom: vi.fn((id: string) => activeRooms.get(id) || null),
    enterRoom: vi.fn(() => ({ ok: true, data: { tools: [], fileScope: 'read-only' } })),
    listRooms: vi.fn(() => Array.from(activeRooms.values()).map((r) => ({ id: r.id, type: r.type }))),
  } as unknown as RoomManagerAPI;
}

function createMockAgents(): AgentRegistryAPI {
  let agentCounter = 0;
  const registeredAgents = new Map<string, { id: string; name: string; role: string; room_access: string[] }>();

  return {
    registerAgent: vi.fn(({ name, role, roomAccess }: { name: string; role: string; capabilities: string[]; roomAccess: string[]; buildingId: string }) => {
      const id = `agent_${++agentCounter}`;
      registeredAgents.set(id, { id, name, role, room_access: roomAccess });
      return { ok: true, data: { id } };
    }),
    getAgent: vi.fn((id: string) => registeredAgents.get(id) || null),
    listAgents: vi.fn(({ roomId: _roomId }: { roomId?: string }) => {
      return Array.from(registeredAgents.values());
    }),
  } as unknown as AgentRegistryAPI;
}

function seedBuilding(buildingId: string, name: string): void {
  db.prepare('INSERT INTO buildings (id, name) VALUES (?, ?)').run(buildingId, name);
  db.prepare('INSERT INTO floors (id, building_id, type, name) VALUES (?, ?, ?, ?)').run(`floor_strategy_${buildingId}`, buildingId, 'strategy', 'Strategy Floor');
  db.prepare('INSERT INTO floors (id, building_id, type, name) VALUES (?, ?, ?, ?)').run(`floor_collab_${buildingId}`, buildingId, 'collaboration', 'Collaboration Floor');
  db.prepare('INSERT INTO floors (id, building_id, type, name) VALUES (?, ?, ?, ?)').run(`floor_exec_${buildingId}`, buildingId, 'execution', 'Execution Floor');
  db.prepare('INSERT INTO floors (id, building_id, type, name) VALUES (?, ?, ?, ?)').run(`floor_gov_${buildingId}`, buildingId, 'governance', 'Governance Floor');
  db.prepare('INSERT INTO floors (id, building_id, type, name) VALUES (?, ?, ?, ?)').run(`floor_ops_${buildingId}`, buildingId, 'operations', 'Operations Floor');
}

describe('Building Onboarding', () => {
  let bus: ReturnType<typeof createMockBus>;
  let rooms: ReturnType<typeof createMockRooms>;
  let agents: ReturnType<typeof createMockAgents>;

  beforeEach(() => {
    db = setupDb();
    bus = createMockBus();
    rooms = createMockRooms();
    agents = createMockAgents();
  });

  it('provisions strategist room on building:created', () => {
    seedBuilding('bld_1', 'Test Project');

    initBuildingOnboarding({ bus, rooms, agents });
    bus._trigger('building:created', { buildingId: 'bld_1', name: 'Test Project' });

    expect(rooms.createRoom).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'strategist', name: 'Strategist Office' }),
    );
    expect(agents.registerAgent).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Strategist', role: 'strategist' }),
    );

    const onboarded = bus._emissions.find((e) => e.event === 'building:onboarded');
    expect(onboarded).toBeDefined();
    expect((onboarded!.data as Record<string, unknown>).phase).toBe('strategy');
  });

  it('skips when buildingId is missing', () => {
    initBuildingOnboarding({ bus, rooms, agents });
    bus._trigger('building:created', {} as BusEventData);

    expect(rooms.createRoom).not.toHaveBeenCalled();
  });

  it('emits building:onboard-failed when floor not found', () => {
    db.prepare('INSERT INTO buildings (id, name) VALUES (?, ?)').run('bld_nofloor', 'No Floor');

    initBuildingOnboarding({ bus, rooms, agents });
    bus._trigger('building:created', { buildingId: 'bld_nofloor', name: 'No Floor' });

    const failed = bus._emissions.find((e) => e.event === 'building:onboard-failed');
    expect(failed).toBeDefined();
    expect((failed!.data as Record<string, unknown>).error).toContain('No strategy floor');
  });

  it('provisions next phase room on phase:advanced', () => {
    seedBuilding('bld_2', 'Phase Test');

    initBuildingOnboarding({ bus, rooms, agents });
    bus._trigger('phase:advanced', { buildingId: 'bld_2', to: 'discovery' });

    expect(rooms.createRoom).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'discovery', name: 'Discovery Room' }),
    );

    const provisioned = bus._emissions.find((e) => e.event === 'phase:room-provisioned');
    expect(provisioned).toBeDefined();
    expect((provisioned!.data as Record<string, unknown>).phase).toBe('discovery');
  });

  it('handles unknown phase gracefully', () => {
    seedBuilding('bld_3', 'Unknown Phase');
    // Pre-seed a room so the building isn't treated as orphaned (#975)
    db.prepare('INSERT INTO rooms (id, floor_id, type, name) VALUES (?, ?, ?, ?)').run('room_seed_3', 'floor_strategy_bld_3', 'strategist', 'Seeded Room');

    initBuildingOnboarding({ bus, rooms, agents });
    bus._trigger('phase:advanced', { buildingId: 'bld_3', to: 'unknown-phase' });

    expect(rooms.createRoom).not.toHaveBeenCalled();
    const provisioned = bus._emissions.find((e) => e.event === 'phase:room-provisioned');
    expect(provisioned).toBeUndefined();
  });

  it('skips phase:advanced when buildingId is missing', () => {
    initBuildingOnboarding({ bus, rooms, agents });
    bus._trigger('phase:advanced', { to: 'discovery' } as BusEventData);

    expect(rooms.createRoom).not.toHaveBeenCalled();
  });

  it('reuses existing room if one already exists', () => {
    seedBuilding('bld_4', 'Reuse Room');

    const floorId = `floor_strategy_bld_4`;
    db.prepare('INSERT INTO rooms (id, floor_id, type, name) VALUES (?, ?, ?, ?)').run('existing_room', floorId, 'strategist', 'Existing Room');

    (rooms.getRoom as ReturnType<typeof vi.fn>).mockImplementation((id: string) => {
      if (id === 'existing_room') return { id, type: 'strategist', tables: {}, config: {} };
      return null;
    });

    initBuildingOnboarding({ bus, rooms, agents });
    bus._trigger('building:created', { buildingId: 'bld_4', name: 'Reuse Room' });

    expect(rooms.createRoom).not.toHaveBeenCalled();

    const onboarded = bus._emissions.find((e) => e.event === 'building:onboarded');
    expect(onboarded).toBeDefined();
  });

  it('provisions all 6 phase types', () => {
    seedBuilding('bld_all', 'All Phases');

    initBuildingOnboarding({ bus, rooms, agents });

    const phases = ['strategy', 'discovery', 'architecture', 'execution', 'review', 'deploy'];
    const roomTypes = ['strategist', 'discovery', 'architecture', 'code-lab', 'review', 'deploy'];

    bus._trigger('building:created', { buildingId: 'bld_all', name: 'All Phases' });

    for (let i = 1; i < phases.length; i++) {
      bus._trigger('phase:advanced', { buildingId: 'bld_all', to: phases[i] });
    }

    const createCalls = (rooms.createRoom as ReturnType<typeof vi.fn>).mock.calls;
    expect(createCalls.length).toBe(6);
    for (let i = 0; i < roomTypes.length; i++) {
      expect(createCalls[i][0].type).toBe(roomTypes[i]);
    }
  });

  it('enters agent into room after provisioning', () => {
    seedBuilding('bld_5', 'Enter Room');

    initBuildingOnboarding({ bus, rooms, agents });
    bus._trigger('building:created', { buildingId: 'bld_5', name: 'Enter Room' });

    expect(rooms.enterRoom).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: expect.stringContaining('agent_') }),
    );
  });

  it('auto-onboards orphaned buildings with floors but no rooms (#975)', () => {
    // Create two buildings: one with rooms, one without
    seedBuilding('bld_orphan', 'Orphaned Project');
    seedBuilding('bld_healthy', 'Healthy Project');
    db.prepare('INSERT INTO rooms (id, floor_id, type, name) VALUES (?, ?, ?, ?)').run('room_h', 'floor_strategy_bld_healthy', 'strategist', 'Existing Room');

    initBuildingOnboarding({ bus, rooms, agents });

    // Only orphaned building should get a room provisioned
    const createCalls = (rooms.createRoom as ReturnType<typeof vi.fn>).mock.calls;
    const orphanCalls = createCalls.filter((call) => call[0]?.floorId?.includes('bld_orphan'));
    expect(orphanCalls.length).toBeGreaterThanOrEqual(1);
    expect(orphanCalls[0][0].type).toBe('strategist');

    // Should emit building:onboarded with wasOrphaned flag
    const onboarded = bus._emissions.find(
      (e) => e.event === 'building:onboarded' && (e.data as Record<string, unknown>).buildingId === 'bld_orphan',
    );
    expect(onboarded).toBeDefined();
    expect((onboarded!.data as Record<string, unknown>).wasOrphaned).toBe(true);
  });

  it('skips buildings that already have rooms during orphan check (#975)', () => {
    seedBuilding('bld_ok', 'Has Rooms');
    db.prepare('INSERT INTO rooms (id, floor_id, type, name) VALUES (?, ?, ?, ?)').run('room_ok', 'floor_strategy_bld_ok', 'strategist', 'Existing Room');

    initBuildingOnboarding({ bus, rooms, agents });

    // No orphan onboarding should happen
    expect(rooms.createRoom).not.toHaveBeenCalled();
  });

  it('deduplicates agents — does not re-register existing agent', () => {
    seedBuilding('bld_6', 'Dedup Agent');

    (agents.listAgents as ReturnType<typeof vi.fn>).mockReturnValue([
      { id: 'agent_existing', name: 'Strategist', role: 'strategist', room_access: ['strategist'] },
    ]);

    initBuildingOnboarding({ bus, rooms, agents });
    bus._trigger('building:created', { buildingId: 'bld_6', name: 'Dedup Agent' });

    // Strategist should NOT be re-registered (dedup), but team agents should be created (#766)
    const registerCalls = (agents.registerAgent as ReturnType<typeof vi.fn>).mock.calls;
    const strategistCalls = registerCalls.filter(
      (call) => call[0]?.role === 'strategist',
    );
    expect(strategistCalls).toHaveLength(0); // Strategist NOT re-registered

    // Team agents (analyst, architect, 2x developer, tester, reviewer) ARE registered
    expect(registerCalls.length).toBeGreaterThanOrEqual(6);

    const onboarded = bus._emissions.find((e) => e.event === 'building:onboarded');
    expect(onboarded).toBeDefined();
    expect((onboarded!.data as Record<string, unknown>).agentId).toBe('agent_existing');
  });
});
