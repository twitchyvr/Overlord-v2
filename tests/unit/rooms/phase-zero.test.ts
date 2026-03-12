/**
 * Phase Zero Tests
 *
 * Tests the Strategist → Discovery transition:
 * - Blueprint application (Quick Start and Advanced modes)
 * - Phase gate creation and auto-sign-off
 * - Bus event handler wiring
 * - Next room suggestion
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import * as dbModule from '../../../src/storage/db.js';
import * as phaseGateModule from '../../../src/rooms/phase-gate.js';
import { EventEmitter } from 'eventemitter3';
import { initRooms, registerRoomType } from '../../../src/rooms/room-manager.js';
import { createBuilding, applyBlueprint, applyCustomPlan } from '../../../src/rooms/building-manager.js';
import { handleBlueprintSubmission, initPhaseZeroHandler, suggestNextRoom } from '../../../src/rooms/phase-zero.js';
import { DiscoveryRoom } from '../../../src/rooms/room-types/discovery.js';
import { StrategistOffice } from '../../../src/rooms/room-types/strategist.js';
import type { Bus } from '../../../src/core/bus.js';

let memDb: Database.Database;
let buildingId: string;
let testBus: Bus;

function setupDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');

  db.prepare(`CREATE TABLE IF NOT EXISTS buildings (
    id TEXT PRIMARY KEY, project_id TEXT, name TEXT NOT NULL,
    config TEXT DEFAULT '{}', active_phase TEXT DEFAULT 'strategy',
    created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
  )`).run();

  db.prepare(`CREATE TABLE IF NOT EXISTS floors (
    id TEXT PRIMARY KEY, building_id TEXT NOT NULL REFERENCES buildings(id),
    type TEXT NOT NULL, name TEXT NOT NULL, sort_order INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 1, config TEXT DEFAULT '{}', created_at TEXT DEFAULT (datetime('now'))
  )`).run();

  db.prepare(`CREATE TABLE IF NOT EXISTS rooms (
    id TEXT PRIMARY KEY, floor_id TEXT NOT NULL REFERENCES floors(id),
    type TEXT NOT NULL, name TEXT NOT NULL, allowed_tools TEXT DEFAULT '[]',
    file_scope TEXT DEFAULT 'assigned', exit_template TEXT DEFAULT '{}',
    escalation TEXT DEFAULT '{}', provider TEXT DEFAULT 'configurable',
    config TEXT DEFAULT '{}', status TEXT DEFAULT 'idle', created_at TEXT DEFAULT (datetime('now'))
  )`).run();

  db.prepare(`CREATE TABLE IF NOT EXISTS tables_v2 (
    id TEXT PRIMARY KEY, room_id TEXT NOT NULL REFERENCES rooms(id),
    type TEXT NOT NULL DEFAULT 'focus', chairs INTEGER DEFAULT 1,
    description TEXT, created_at TEXT DEFAULT (datetime('now'))
  )`).run();

  db.prepare(`CREATE TABLE IF NOT EXISTS agents (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, role TEXT NOT NULL,
    building_id TEXT REFERENCES buildings(id),
    capabilities TEXT DEFAULT '[]', room_access TEXT DEFAULT '[]',
    badge TEXT, status TEXT DEFAULT 'idle', current_room_id TEXT,
    current_table_id TEXT, config TEXT DEFAULT '{}',
    created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
  )`).run();

  db.prepare(`CREATE TABLE IF NOT EXISTS exit_documents (
    id TEXT PRIMARY KEY, room_id TEXT NOT NULL, type TEXT NOT NULL,
    completed_by TEXT NOT NULL, fields TEXT DEFAULT '{}', artifacts TEXT DEFAULT '[]',
    raid_entry_ids TEXT DEFAULT '[]', created_at TEXT DEFAULT (datetime('now'))
  )`).run();

  db.prepare(`CREATE TABLE IF NOT EXISTS raid_entries (
    id TEXT PRIMARY KEY, building_id TEXT NOT NULL REFERENCES buildings(id),
    type TEXT NOT NULL CHECK(type IN ('risk', 'assumption', 'issue', 'decision')),
    phase TEXT NOT NULL, room_id TEXT, summary TEXT NOT NULL, rationale TEXT,
    decided_by TEXT, approved_by TEXT, affected_areas TEXT DEFAULT '[]',
    status TEXT DEFAULT 'active' CHECK(status IN ('active', 'superseded', 'closed')),
    created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
  )`).run();

  db.prepare(`CREATE TABLE IF NOT EXISTS phase_gates (
    id TEXT PRIMARY KEY, building_id TEXT NOT NULL REFERENCES buildings(id),
    phase TEXT NOT NULL, status TEXT DEFAULT 'pending',
    exit_doc_id TEXT, signoff_reviewer TEXT, signoff_verdict TEXT,
    signoff_conditions TEXT DEFAULT '[]', signoff_timestamp TEXT,
    next_phase_input TEXT DEFAULT '{}',
    created_at TEXT DEFAULT (datetime('now'))
  )`).run();

  return db;
}

beforeEach(() => {
  memDb = setupDb();
  vi.spyOn(dbModule, 'getDb').mockReturnValue(memDb as unknown as ReturnType<typeof dbModule.getDb>);

  const ee = new EventEmitter();
  testBus = {
    emit: (event: string | symbol, data?: Record<string, unknown>) => {
      const envelope = { event: String(event), timestamp: Date.now(), ...data };
      ee.emit(event, envelope);
      return true;
    },
    on: ee.on.bind(ee),
    off: ee.off.bind(ee),
    onNamespace: () => {},
    offNamespace: () => {},
  } as unknown as Bus;

  initRooms({ bus: testBus, agents: {} as never, tools: {} as never, ai: {} as never });
  registerRoomType('discovery', DiscoveryRoom as never);
  registerRoomType('strategist', StrategistOffice as never);

  const result = createBuilding({ name: 'Phase Zero Test' });
  buildingId = result.data.id;
});

// ─── Blueprint Application ───

describe('applyBlueprint', () => {
  it('provisions new floors that do not already exist', () => {
    // Building already has 6 default floors; ask for one that exists + one that doesn't
    const result = applyBlueprint(buildingId, {
      floorsNeeded: ['collaboration', 'custom-floor'],
      roomConfig: [],
      agentRoster: [],
    });
    expect(result.ok).toBe(true);
    const data = result.data as { floorsCreated: number };
    // collaboration already exists, custom-floor is new
    expect(data.floorsCreated).toBe(1);
  });

  it('creates rooms on existing floors', () => {
    const result = applyBlueprint(buildingId, {
      floorsNeeded: ['execution'],
      roomConfig: [{ floor: 'execution', rooms: ['code-lab', 'testing-lab'] }],
      agentRoster: [],
    });
    expect(result.ok).toBe(true);
    const data = result.data as { roomsCreated: number };
    expect(data.roomsCreated).toBe(2);

    const rooms = memDb.prepare('SELECT * FROM rooms WHERE type IN (?, ?)').all('code-lab', 'testing-lab');
    expect(rooms).toHaveLength(2);
  });

  it('creates agent DB rows with room access', () => {
    const result = applyBlueprint(buildingId, {
      floorsNeeded: [],
      roomConfig: [],
      agentRoster: [
        { name: 'Dev', role: 'developer', rooms: ['code-lab'] },
        { name: 'QA', role: 'tester', rooms: ['testing-lab', 'review'] },
      ],
    });
    expect(result.ok).toBe(true);
    const data = result.data as { agentsCreated: number };
    expect(data.agentsCreated).toBe(2);

    const agents = memDb.prepare('SELECT * FROM agents WHERE name IN (?, ?)').all('Dev', 'QA') as Array<{ name: string; room_access: string }>;
    expect(agents).toHaveLength(2);
    const dev = agents.find((a) => a.name === 'Dev')!;
    expect(JSON.parse(dev.room_access)).toEqual(['code-lab']);
  });

  it('returns error for non-existent building', () => {
    const result = applyBlueprint('bld_nonexistent', {
      floorsNeeded: [],
      roomConfig: [],
      agentRoster: [],
    });
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('BUILDING_NOT_FOUND');
  });
});

describe('applyCustomPlan', () => {
  it('creates floors with custom names', () => {
    const result = applyCustomPlan(buildingId, {
      floors: [{ type: 'research', name: 'Research Lab Floor' }],
      roomAssignments: [],
      agentDefinitions: [],
    });
    expect(result.ok).toBe(true);
    const data = result.data as { floorsCreated: number };
    expect(data.floorsCreated).toBe(1);

    const floor = memDb.prepare("SELECT * FROM floors WHERE type = 'research'").get() as { name: string };
    expect(floor.name).toBe('Research Lab Floor');
  });

  it('creates rooms with custom names and config', () => {
    const result = applyCustomPlan(buildingId, {
      floors: [],
      roomAssignments: [
        { floor: 'execution', roomType: 'code-lab', roomName: 'Frontend Lab', config: { framework: 'react' } },
      ],
      agentDefinitions: [],
    });
    expect(result.ok).toBe(true);
    const data = result.data as { roomsCreated: number };
    expect(data.roomsCreated).toBe(1);

    const room = memDb.prepare("SELECT * FROM rooms WHERE name = 'Frontend Lab'").get() as { config: string };
    expect(JSON.parse(room.config)).toEqual({ framework: 'react' });
  });

  it('creates agents with capabilities and room access', () => {
    const result = applyCustomPlan(buildingId, {
      floors: [],
      roomAssignments: [],
      agentDefinitions: [
        { name: 'Architect', role: 'architect', capabilities: ['design', 'review'], roomAccess: ['architecture', 'review'] },
      ],
    });
    expect(result.ok).toBe(true);

    const agent = memDb.prepare("SELECT * FROM agents WHERE name = 'Architect'").get() as { capabilities: string; room_access: string };
    expect(JSON.parse(agent.capabilities)).toEqual(['design', 'review']);
    expect(JSON.parse(agent.room_access)).toEqual(['architecture', 'review']);
  });

  it('returns error for non-existent building', () => {
    const result = applyCustomPlan('bld_nonexistent', {
      floors: [],
      roomAssignments: [],
      agentDefinitions: [],
    });
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('BUILDING_NOT_FOUND');
  });
});

// ─── Blueprint Submission Handler ───

describe('handleBlueprintSubmission', () => {
  it('applies blueprint and creates strategy phase gate with GO verdict', () => {
    const result = handleBlueprintSubmission({
      buildingId,
      agentId: 'agent_test',
      blueprint: {
        projectGoals: ['Build a web app'],
        successCriteria: ['App works'],
        floorsNeeded: ['execution'],
        roomConfig: [{ floor: 'execution', rooms: ['code-lab'] }],
        agentRoster: [{ name: 'Dev', role: 'developer', rooms: ['code-lab'] }],
        estimatedPhases: ['discovery', 'execution'],
        mode: 'quickStart',
      },
    });

    expect(result.ok).toBe(true);
    const data = result.data as Record<string, unknown>;
    expect(data.mode).toBe('quickStart');
    expect(data.phaseAdvanced).toBe(true);
    expect(data.nextPhase).toBe('discovery');

    // Verify gate was created and signed
    const gate = memDb.prepare("SELECT * FROM phase_gates WHERE building_id = ? AND phase = 'strategy'").get(buildingId) as { status: string; signoff_verdict: string } | undefined;
    expect(gate).toBeDefined();
    expect(gate!.status).toBe('go');
    expect(gate!.signoff_verdict).toBe('GO');
  });

  it('applies custom plan in advanced mode', () => {
    const result = handleBlueprintSubmission({
      buildingId,
      agentId: 'agent_test',
      blueprint: {
        mode: 'advanced',
        floors: [{ type: 'research', name: 'Research Floor' }],
        roomAssignments: [{ floor: 'research', roomType: 'discovery', roomName: 'Research Room' }],
        agentDefinitions: [{ name: 'Researcher', role: 'analyst' }],
        projectGoals: ['Research project'],
        successCriteria: ['Findings documented'],
        estimatedPhases: ['discovery'],
      },
    });

    expect(result.ok).toBe(true);
    const data = result.data as Record<string, unknown>;
    expect(data.mode).toBe('advanced');
  });

  it('returns error for non-existent building', () => {
    const result = handleBlueprintSubmission({
      buildingId: 'bld_nonexistent',
      agentId: 'agent_test',
      blueprint: {
        floorsNeeded: [],
        roomConfig: [],
        agentRoster: [],
      },
    });
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('BUILDING_NOT_FOUND');
  });

  it('returns GATE_CREATION_FAILED when gate creation fails', () => {
    vi.spyOn(phaseGateModule, 'createGate').mockReturnValue({
      ok: false,
      error: { code: 'DB_ERROR', message: 'insert failed', retryable: false },
    });

    const result = handleBlueprintSubmission({
      buildingId,
      agentId: 'agent_test',
      blueprint: {
        floorsNeeded: [],
        roomConfig: [],
        agentRoster: [],
      },
    });

    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('GATE_CREATION_FAILED');
    vi.restoreAllMocks();
    // Re-mock getDb after restoreAllMocks
    vi.spyOn(dbModule, 'getDb').mockReturnValue(memDb as unknown as ReturnType<typeof dbModule.getDb>);
  });

  it('returns GATE_SIGNOFF_FAILED when signoff fails', () => {
    vi.spyOn(phaseGateModule, 'signoffGate').mockReturnValue({
      ok: false,
      error: { code: 'INVALID_VERDICT', message: 'signoff rejected', retryable: false },
    });

    const result = handleBlueprintSubmission({
      buildingId,
      agentId: 'agent_test',
      blueprint: {
        floorsNeeded: [],
        roomConfig: [],
        agentRoster: [],
      },
    });

    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('GATE_SIGNOFF_FAILED');
    vi.restoreAllMocks();
    // Re-mock getDb after restoreAllMocks
    vi.spyOn(dbModule, 'getDb').mockReturnValue(memDb as unknown as ReturnType<typeof dbModule.getDb>);
  });
});

// ─── Bus Handler ───

describe('initPhaseZeroHandler', () => {
  it('emits phase-zero:complete on strategist exit doc submission', () => {
    initPhaseZeroHandler(testBus);

    const completed: unknown[] = [];
    testBus.on('phase-zero:complete', (data: unknown) => completed.push(data));

    testBus.emit('exit-doc:submitted', {
      roomType: 'strategist',
      buildingId,
      agentId: 'agent_test',
      document: {
        floorsNeeded: ['execution'],
        roomConfig: [{ floor: 'execution', rooms: ['code-lab'] }],
        agentRoster: [{ name: 'Dev', role: 'dev', rooms: ['code-lab'] }],
        projectGoals: ['Build'],
        successCriteria: ['Done'],
        estimatedPhases: ['execution'],
      },
    });

    expect(completed).toHaveLength(1);
    const event = completed[0] as Record<string, unknown>;
    expect(event.buildingId).toBe(buildingId);
    expect(event.nextPhase).toBe('discovery');
  });

  it('emits phase-zero:complete on building-architect exit doc submission', () => {
    initPhaseZeroHandler(testBus);

    const completed: unknown[] = [];
    testBus.on('phase-zero:complete', (data: unknown) => completed.push(data));

    testBus.emit('exit-doc:submitted', {
      roomType: 'building-architect',
      buildingId,
      agentId: 'agent_test',
      document: {
        mode: 'advanced',
        floors: [{ type: 'custom', name: 'Custom' }],
        roomAssignments: [{ floor: 'custom', roomType: 'code-lab', roomName: 'Lab' }],
        agentDefinitions: [{ name: 'Dev', role: 'dev' }],
        projectGoals: ['Build'],
        successCriteria: ['Done'],
        estimatedPhases: ['execution'],
      },
    });

    expect(completed).toHaveLength(1);
  });

  it('ignores non-strategist exit doc events', () => {
    initPhaseZeroHandler(testBus);

    const completed: unknown[] = [];
    testBus.on('phase-zero:complete', (data: unknown) => completed.push(data));

    testBus.emit('exit-doc:submitted', {
      roomType: 'code-lab',
      buildingId,
      agentId: 'agent_test',
      document: {},
    });

    expect(completed).toHaveLength(0);
  });

  it('emits phase-zero:failed when blueprint application fails', () => {
    initPhaseZeroHandler(testBus);

    const failed: unknown[] = [];
    testBus.on('phase-zero:failed', (data: unknown) => failed.push(data));

    testBus.emit('exit-doc:submitted', {
      roomType: 'strategist',
      buildingId: 'bld_nonexistent',
      agentId: 'agent_test',
      document: {
        floorsNeeded: ['execution'],
        roomConfig: [],
        agentRoster: [],
      },
    });

    expect(failed).toHaveLength(1);
    const event = failed[0] as Record<string, unknown>;
    expect(event.buildingId).toBe('bld_nonexistent');
    expect(event.error).toBeDefined();
  });

  it('ignores event with missing buildingId', () => {
    initPhaseZeroHandler(testBus);

    const completed: unknown[] = [];
    const failed: unknown[] = [];
    testBus.on('phase-zero:complete', (data: unknown) => completed.push(data));
    testBus.on('phase-zero:failed', (data: unknown) => failed.push(data));

    testBus.emit('exit-doc:submitted', {
      roomType: 'strategist',
      agentId: 'agent_test',
      document: {
        floorsNeeded: ['execution'],
        roomConfig: [],
        agentRoster: [],
      },
    });

    expect(completed).toHaveLength(0);
    expect(failed).toHaveLength(0);
  });

  it('ignores event with missing document', () => {
    initPhaseZeroHandler(testBus);

    const completed: unknown[] = [];
    const failed: unknown[] = [];
    testBus.on('phase-zero:complete', (data: unknown) => completed.push(data));
    testBus.on('phase-zero:failed', (data: unknown) => failed.push(data));

    testBus.emit('exit-doc:submitted', {
      roomType: 'strategist',
      buildingId,
      agentId: 'agent_test',
    });

    expect(completed).toHaveLength(0);
    expect(failed).toHaveLength(0);
  });
});

// ─── Next Room Suggestion ───

describe('suggestNextRoom', () => {
  it('suggests discovery room on collaboration floor', () => {
    const result = suggestNextRoom(buildingId);
    expect(result.ok).toBe(true);
    const data = result.data as Record<string, unknown>;
    expect(data.roomType).toBe('discovery');
    expect(data.floorType).toBe('collaboration');
    expect(data.floorId).toBeDefined();
  });

  it('returns error for non-existent building', () => {
    const result = suggestNextRoom('bld_nonexistent');
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('BUILDING_NOT_FOUND');
  });

  it('identifies agents eligible for discovery rooms', () => {
    // Add an agent with discovery access
    memDb.prepare(`
      INSERT INTO agents (id, name, role, room_access)
      VALUES ('agent_disco', 'Discovery Agent', 'analyst', '["discovery"]')
    `).run();
    // Add an agent with wildcard access
    memDb.prepare(`
      INSERT INTO agents (id, name, role, room_access)
      VALUES ('agent_wild', 'Wild Agent', 'dev', '["*"]')
    `).run();
    // Add an agent with NO discovery access
    memDb.prepare(`
      INSERT INTO agents (id, name, role, room_access)
      VALUES ('agent_code', 'Coder', 'dev', '["code-lab"]')
    `).run();

    const result = suggestNextRoom(buildingId);
    expect(result.ok).toBe(true);
    const data = result.data as { eligibleAgents: Array<{ id: string }> };
    const ids = data.eligibleAgents.map((a) => a.id);
    expect(ids).toContain('agent_disco');
    expect(ids).toContain('agent_wild');
    expect(ids).not.toContain('agent_code');
  });

  it('returns NO_COLLABORATION_FLOOR when building has no collaboration floor', () => {
    // Delete the collaboration floor from the DB
    memDb.prepare("DELETE FROM floors WHERE building_id = ? AND type = 'collaboration'").run(buildingId);

    const result = suggestNextRoom(buildingId);
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('NO_COLLABORATION_FLOOR');
  });
});
