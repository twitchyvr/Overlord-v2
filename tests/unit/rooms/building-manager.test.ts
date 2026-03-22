/**
 * Building Manager Tests
 *
 * Tests building CRUD, floor CRUD, auto-provisioning, and floor lookup.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import * as dbModule from '../../../src/storage/db.js';
import {
  createBuilding,
  getBuilding,
  listBuildings,
  updateBuilding,
  createFloor,
  getFloor,
  listFloors,
  getFloorByType,
  applyBlueprint,
  applyCustomPlan,
  getHealthScore,
  autoDiscoverRepos,
} from '../../../src/rooms/building-manager.js';

let memDb: Database.Database;

function setupDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');

  db.prepare(`CREATE TABLE IF NOT EXISTS buildings (
    id TEXT PRIMARY KEY, project_id TEXT, name TEXT NOT NULL,
    working_directory TEXT, repo_url TEXT, allowed_paths TEXT DEFAULT '[]',
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

  db.prepare(`CREATE TABLE IF NOT EXISTS agents (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, role TEXT NOT NULL,
    building_id TEXT, capabilities TEXT DEFAULT '[]', room_access TEXT DEFAULT '[]',
    badge TEXT, status TEXT DEFAULT 'idle', current_room_id TEXT, current_table_id TEXT,
    config TEXT DEFAULT '{}',
    first_name TEXT, last_name TEXT, display_name TEXT, nickname TEXT,
    bio TEXT, photo_url TEXT, specialization TEXT, gender TEXT,
    profile_generated INTEGER DEFAULT 0,
    age INTEGER, backstory TEXT, communication_style TEXT,
    expertise_areas TEXT DEFAULT '[]', subject_reference TEXT,
    created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
  )`).run();

  db.prepare(`CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY, building_id TEXT NOT NULL REFERENCES buildings(id),
    title TEXT NOT NULL, description TEXT, status TEXT DEFAULT 'pending',
    parent_id TEXT, milestone_id TEXT, assignee_id TEXT, room_id TEXT, table_id TEXT,
    phase TEXT, priority TEXT DEFAULT 'normal',
    created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
  )`).run();

  db.prepare(`CREATE TABLE IF NOT EXISTS raid_entries (
    id TEXT PRIMARY KEY, building_id TEXT NOT NULL REFERENCES buildings(id),
    type TEXT NOT NULL CHECK(type IN ('risk', 'assumption', 'issue', 'decision')),
    phase TEXT NOT NULL, room_id TEXT, summary TEXT NOT NULL, rationale TEXT,
    decided_by TEXT, approved_by TEXT, affected_areas TEXT DEFAULT '[]',
    status TEXT DEFAULT 'active' CHECK(status IN ('active', 'superseded', 'closed')),
    created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
  )`).run();

  db.prepare(`CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY, room_id TEXT NOT NULL REFERENCES rooms(id),
    agent_id TEXT, role TEXT NOT NULL, content TEXT, tool_calls TEXT,
    attachments TEXT DEFAULT '[]', thread_id TEXT, parent_id TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`).run();

  return db;
}

beforeEach(() => {
  memDb = setupDb();
  vi.spyOn(dbModule, 'getDb').mockReturnValue(memDb as unknown as ReturnType<typeof dbModule.getDb>);
});

// ─── Buildings ───

describe('createBuilding', () => {
  it('creates a building with auto-provisioned floors', () => {
    const result = createBuilding({ name: 'Test Project' });
    expect(result.ok).toBe(true);
    expect(result.data.name).toBe('Test Project');
    expect(result.data.floorIds.length).toBe(6);

    const floors = memDb.prepare('SELECT * FROM floors WHERE building_id = ?').all(result.data.id);
    expect(floors).toHaveLength(6);
  });

  it('creates a building without auto-provisioned floors', () => {
    const result = createBuilding({ name: 'Bare Project', provisionFloors: false });
    expect(result.ok).toBe(true);
    expect(result.data.floorIds).toHaveLength(0);

    const floors = memDb.prepare('SELECT * FROM floors WHERE building_id = ?').all(result.data.id);
    expect(floors).toHaveLength(0);
  });

  it('stores project_id and config', () => {
    const result = createBuilding({
      name: 'Linked Project',
      projectId: 'proj_123',
      config: { maxAgents: 10 },
    });
    expect(result.ok).toBe(true);

    const row = memDb.prepare('SELECT * FROM buildings WHERE id = ?').get(result.data.id) as Record<string, unknown>;
    expect(row.project_id).toBe('proj_123');
    expect(JSON.parse(row.config as string)).toEqual({ maxAgents: 10 });
  });

  it('default active_phase is strategy', () => {
    const result = createBuilding({ name: 'New' });
    const row = memDb.prepare('SELECT active_phase FROM buildings WHERE id = ?').get(result.data.id) as Record<string, unknown>;
    expect(row.active_phase).toBe('strategy');
  });
});

describe('getBuilding', () => {
  it('returns building with floors', () => {
    const created = createBuilding({ name: 'Get Test' });
    const result = getBuilding(created.data.id);
    expect(result.ok).toBe(true);
    expect(result.data.name).toBe('Get Test');
    expect(result.data.floors).toHaveLength(6);
    expect(result.data.floors[0].type).toBe('strategy');
  });

  it('returns error for non-existent building', () => {
    const result = getBuilding('bld_nonexistent');
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('BUILDING_NOT_FOUND');
  });
});

describe('listBuildings', () => {
  it('lists all buildings', () => {
    createBuilding({ name: 'A', provisionFloors: false });
    createBuilding({ name: 'B', provisionFloors: false });
    const result = listBuildings();
    expect(result.ok).toBe(true);
    expect(result.data).toHaveLength(2);
  });

  it('filters by project_id', () => {
    createBuilding({ name: 'P1', projectId: 'proj_1', provisionFloors: false });
    createBuilding({ name: 'P2', projectId: 'proj_2', provisionFloors: false });
    createBuilding({ name: 'P1b', projectId: 'proj_1', provisionFloors: false });

    const result = listBuildings('proj_1');
    expect(result.ok).toBe(true);
    expect(result.data).toHaveLength(2);
  });
});

describe('updateBuilding', () => {
  it('updates name', () => {
    const created = createBuilding({ name: 'Old Name', provisionFloors: false });
    const result = updateBuilding(created.data.id, { name: 'New Name' });
    expect(result.ok).toBe(true);

    const row = memDb.prepare('SELECT name FROM buildings WHERE id = ?').get(created.data.id) as Record<string, unknown>;
    expect(row.name).toBe('New Name');
  });

  it('updates config', () => {
    const created = createBuilding({ name: 'Cfg Test', provisionFloors: false });
    const result = updateBuilding(created.data.id, { config: { maxAgents: 20 } });
    expect(result.ok).toBe(true);

    const row = memDb.prepare('SELECT config FROM buildings WHERE id = ?').get(created.data.id) as Record<string, unknown>;
    expect(JSON.parse(row.config as string)).toEqual({ maxAgents: 20 });
  });

  it('returns error for non-existent building', () => {
    const result = updateBuilding('bld_nonexistent', { name: 'X' });
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('BUILDING_NOT_FOUND');
  });
});

// ─── Floors ───

describe('createFloor', () => {
  it('creates a floor in a building', () => {
    const building = createBuilding({ name: 'Floor Test', provisionFloors: false });
    const result = createFloor({ buildingId: building.data.id, type: 'custom', name: 'Custom Floor' });
    expect(result.ok).toBe(true);
    expect(result.data.type).toBe('custom');
    expect(result.data.sortOrder).toBe(0);
  });

  it('auto-increments sort order', () => {
    const building = createBuilding({ name: 'Sort Test', provisionFloors: false });
    createFloor({ buildingId: building.data.id, type: 'a', name: 'A' });
    const second = createFloor({ buildingId: building.data.id, type: 'b', name: 'B' });
    expect(second.data.sortOrder).toBe(1);
  });

  it('accepts explicit sort order', () => {
    const building = createBuilding({ name: 'Explicit', provisionFloors: false });
    const result = createFloor({ buildingId: building.data.id, type: 'x', name: 'X', sortOrder: 99 });
    expect(result.data.sortOrder).toBe(99);
  });

  it('rejects floor for non-existent building', () => {
    const result = createFloor({ buildingId: 'bld_nonexistent', type: 'a', name: 'A' });
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('BUILDING_NOT_FOUND');
  });
});

describe('getFloor', () => {
  it('returns floor with rooms list', () => {
    const building = createBuilding({ name: 'Floor Get' });
    const floors = memDb.prepare('SELECT id FROM floors WHERE building_id = ?').all(building.data.id) as { id: string }[];
    const result = getFloor(floors[0].id);
    expect(result.ok).toBe(true);
    expect(result.data.rooms).toBeDefined();
    expect(Array.isArray(result.data.rooms)).toBe(true);
  });

  it('returns error for non-existent floor', () => {
    const result = getFloor('floor_nonexistent');
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('FLOOR_NOT_FOUND');
  });
});

describe('listFloors', () => {
  it('lists floors sorted by sort_order', () => {
    const building = createBuilding({ name: 'List Floors' });
    const result = listFloors(building.data.id);
    expect(result.ok).toBe(true);
    expect(result.data).toHaveLength(6);
    for (let i = 1; i < result.data.length; i++) {
      expect(result.data[i].sort_order).toBeGreaterThanOrEqual(result.data[i - 1].sort_order);
    }
  });
});

describe('getFloorByType', () => {
  it('finds floor by building and type', () => {
    const building = createBuilding({ name: 'By Type' });
    const result = getFloorByType(building.data.id, 'execution');
    expect(result.ok).toBe(true);
    expect(result.data.type).toBe('execution');
  });

  it('returns error for non-existent floor type', () => {
    const building = createBuilding({ name: 'No Custom' });
    const result = getFloorByType(building.data.id, 'nonexistent');
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('FLOOR_NOT_FOUND');
  });
});

// ─── applyBlueprint ───

describe('applyBlueprint', () => {
  it('provisions floors, rooms, and agents from a blueprint', () => {
    const building = createBuilding({ name: 'Blueprint Test', provisionFloors: false });
    const bid = building.data.id;

    const result = applyBlueprint(bid, {
      floorsNeeded: ['execution', 'governance'],
      roomConfig: [
        { floor: 'execution', rooms: ['code-lab', 'testing-lab'] },
        { floor: 'governance', rooms: ['review-room'] },
      ],
      agentRoster: [
        { name: 'Coder', role: 'developer', rooms: ['code-lab'] },
        { name: 'Tester', role: 'qa', rooms: ['testing-lab'] },
      ],
    });

    expect(result.ok).toBe(true);
    expect(result.data.floorsCreated).toBe(2);
    expect(result.data.roomsCreated).toBe(3);
    expect(result.data.agentsCreated).toBe(2);

    // Verify DB state
    const floors = memDb.prepare('SELECT * FROM floors WHERE building_id = ?').all(bid);
    expect(floors).toHaveLength(2);

    const rooms = memDb.prepare('SELECT * FROM rooms').all() as Array<Record<string, unknown>>;
    expect(rooms).toHaveLength(3);
    expect(rooms.map(r => r.type)).toContain('code-lab');
    expect(rooms.map(r => r.type)).toContain('testing-lab');
    expect(rooms.map(r => r.type)).toContain('review-room');

    const agents = memDb.prepare('SELECT * FROM agents WHERE building_id = ?').all(bid) as Array<Record<string, unknown>>;
    expect(agents).toHaveLength(2);
    expect(agents.map(a => a.name)).toContain('Coder');
    expect(agents.map(a => a.name)).toContain('Tester');
  });

  it('skips already-existing floors', () => {
    const building = createBuilding({ name: 'Existing Floors' });
    const bid = building.data.id;
    // Building already has 6 default floors including 'execution'

    const result = applyBlueprint(bid, {
      floorsNeeded: ['execution', 'custom-new'],
      roomConfig: [],
      agentRoster: [],
    });

    expect(result.ok).toBe(true);
    expect(result.data.floorsCreated).toBe(1); // only 'custom-new' created
  });

  it('returns error for non-existent building', () => {
    const result = applyBlueprint('bld_nonexistent', {
      floorsNeeded: [],
      roomConfig: [],
      agentRoster: [],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('BUILDING_NOT_FOUND');
    }
  });

  it('stores agent room_access as JSON array', () => {
    const building = createBuilding({ name: 'Room Access Test', provisionFloors: false });
    const bid = building.data.id;

    applyBlueprint(bid, {
      floorsNeeded: [],
      roomConfig: [],
      agentRoster: [
        { name: 'MultiRoom', role: 'senior', rooms: ['code-lab', 'review-room', 'testing-lab'] },
      ],
    });

    const agent = memDb.prepare('SELECT room_access FROM agents WHERE building_id = ?').get(bid) as Record<string, unknown>;
    const roomAccess = JSON.parse(agent.room_access as string);
    expect(roomAccess).toEqual(['code-lab', 'review-room', 'testing-lab']);
  });

  it('skips rooms for missing floors gracefully', () => {
    const building = createBuilding({ name: 'Missing Floor', provisionFloors: false });
    const bid = building.data.id;

    const result = applyBlueprint(bid, {
      floorsNeeded: ['execution'],
      roomConfig: [
        { floor: 'execution', rooms: ['code-lab'] },
        { floor: 'nonexistent-floor', rooms: ['phantom-room'] },
      ],
      agentRoster: [],
    });

    expect(result.ok).toBe(true);
    expect(result.data.roomsCreated).toBe(1); // only the execution room
  });
});

// ─── applyCustomPlan ───

describe('applyCustomPlan', () => {
  it('provisions floors, rooms, and agents from a custom plan', () => {
    const building = createBuilding({ name: 'Custom Plan Test', provisionFloors: false });
    const bid = building.data.id;

    const result = applyCustomPlan(bid, {
      floors: [
        { type: 'design', name: 'Design Floor' },
        { type: 'testing', name: 'QA Floor' },
      ],
      roomAssignments: [
        { floor: 'design', roomType: 'ui-lab', roomName: 'UI Design Lab', config: { theme: 'dark' } },
        { floor: 'testing', roomType: 'qa-suite', roomName: 'QA Suite' },
      ],
      agentDefinitions: [
        { name: 'Designer', role: 'ui-designer', capabilities: ['figma', 'css'], roomAccess: ['ui-lab'] },
        { name: 'QA Bot', role: 'tester', capabilities: ['selenium'], roomAccess: ['qa-suite'] },
      ],
    });

    expect(result.ok).toBe(true);
    expect(result.data.floorsCreated).toBe(2);
    expect(result.data.roomsCreated).toBe(2);
    expect(result.data.agentsCreated).toBe(2);
  });

  it('preserves explicit floor naming', () => {
    const building = createBuilding({ name: 'Floor Names', provisionFloors: false });
    const bid = building.data.id;

    applyCustomPlan(bid, {
      floors: [{ type: 'custom-type', name: 'My Custom Floor' }],
      roomAssignments: [],
      agentDefinitions: [],
    });

    const floor = memDb.prepare('SELECT name FROM floors WHERE building_id = ? AND type = ?').get(bid, 'custom-type') as Record<string, unknown>;
    expect(floor.name).toBe('My Custom Floor');
  });

  it('stores room config as JSON', () => {
    const building = createBuilding({ name: 'Room Config', provisionFloors: false });
    const bid = building.data.id;

    applyCustomPlan(bid, {
      floors: [{ type: 'exec', name: 'Exec Floor' }],
      roomAssignments: [
        { floor: 'exec', roomType: 'dev-room', roomName: 'Dev Room', config: { maxAgents: 3, priority: 'high' } },
      ],
      agentDefinitions: [],
    });

    const room = memDb.prepare('SELECT config FROM rooms').get() as Record<string, unknown>;
    expect(JSON.parse(room.config as string)).toEqual({ maxAgents: 3, priority: 'high' });
  });

  it('stores agent capabilities and room_access as JSON arrays', () => {
    const building = createBuilding({ name: 'Agent Fields', provisionFloors: false });
    const bid = building.data.id;

    applyCustomPlan(bid, {
      floors: [],
      roomAssignments: [],
      agentDefinitions: [
        { name: 'Full Agent', role: 'architect', capabilities: ['design', 'review', 'code'], roomAccess: ['arch-room', 'review-room'] },
      ],
    });

    const agent = memDb.prepare('SELECT capabilities, room_access FROM agents WHERE building_id = ?').get(bid) as Record<string, unknown>;
    expect(JSON.parse(agent.capabilities as string)).toEqual(['design', 'review', 'code']);
    expect(JSON.parse(agent.room_access as string)).toEqual(['arch-room', 'review-room']);
  });

  it('skips already-existing floors', () => {
    const building = createBuilding({ name: 'Dupe Floors' });
    const bid = building.data.id;
    // Building already has 6 default floors including 'execution'

    const result = applyCustomPlan(bid, {
      floors: [
        { type: 'execution', name: 'Should Be Skipped' },
        { type: 'brand-new', name: 'Brand New Floor' },
      ],
      roomAssignments: [],
      agentDefinitions: [],
    });

    expect(result.ok).toBe(true);
    expect(result.data.floorsCreated).toBe(1); // only 'brand-new'
  });

  it('returns error for non-existent building', () => {
    const result = applyCustomPlan('bld_nonexistent', {
      floors: [],
      roomAssignments: [],
      agentDefinitions: [],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('BUILDING_NOT_FOUND');
    }
  });

  it('skips rooms for missing floors gracefully', () => {
    const building = createBuilding({ name: 'Missing Floor Custom', provisionFloors: false });
    const bid = building.data.id;

    const result = applyCustomPlan(bid, {
      floors: [{ type: 'real', name: 'Real Floor' }],
      roomAssignments: [
        { floor: 'real', roomType: 'real-room', roomName: 'Real Room' },
        { floor: 'ghost', roomType: 'ghost-room', roomName: 'Ghost Room' },
      ],
      agentDefinitions: [],
    });

    expect(result.ok).toBe(true);
    expect(result.data.roomsCreated).toBe(1);
  });

  it('defaults capabilities and roomAccess to empty arrays', () => {
    const building = createBuilding({ name: 'Defaults Test', provisionFloors: false });
    const bid = building.data.id;

    applyCustomPlan(bid, {
      floors: [],
      roomAssignments: [],
      agentDefinitions: [
        { name: 'Minimal Agent', role: 'assistant' },
      ],
    });

    const agent = memDb.prepare('SELECT capabilities, room_access FROM agents WHERE building_id = ?').get(bid) as Record<string, unknown>;
    expect(JSON.parse(agent.capabilities as string)).toEqual([]);
    expect(JSON.parse(agent.room_access as string)).toEqual([]);
  });
});

// ─── Health Score ───

describe('getHealthScore', () => {
  function createTestBuilding(phase = 'strategy'): string {
    const result = createBuilding({ name: 'Health Test', provisionFloors: true });
    const bid = result.data.id;
    memDb.prepare('UPDATE buildings SET active_phase = ? WHERE id = ?').run(phase, bid);
    return bid;
  }

  it('returns error for non-existent building', () => {
    const result = getHealthScore('fake_id');
    expect(result.ok).toBe(false);
  });

  it('returns zero score for empty building', () => {
    const bid = createTestBuilding('strategy');
    const result = getHealthScore(bid);
    expect(result.ok).toBe(true);

    const { score } = result.data;
    // Phase = strategy = 4, no tasks = 0, no RAID = 25 (healthy), no activity = 0
    expect(score.phaseProgress).toBe(4);
    expect(score.taskCompletion).toBe(0);
    expect(score.raidHealth).toBe(25);
    expect(score.agentActivity).toBe(0);
    expect(score.total).toBe(29);
  });

  it('scores higher for advanced phase', () => {
    const bid = createTestBuilding('deploy');
    const result = getHealthScore(bid);
    expect(result.ok).toBe(true);
    expect(result.data.score.phaseProgress).toBe(25);
  });

  it('calculates task completion correctly', () => {
    const bid = createTestBuilding();
    // Insert 4 tasks: 3 done, 1 pending
    for (let i = 0; i < 3; i++) {
      memDb.prepare('INSERT INTO tasks (id, building_id, title, status) VALUES (?, ?, ?, ?)').run(`t${i}`, bid, `Task ${i}`, 'done');
    }
    memDb.prepare('INSERT INTO tasks (id, building_id, title, status) VALUES (?, ?, ?, ?)').run('t3', bid, 'Task 3', 'pending');

    const result = getHealthScore(bid);
    expect(result.ok).toBe(true);
    // 3/4 = 75%, * 25 = 18.75, rounded to 19
    expect(result.data.score.taskCompletion).toBe(19);
  });

  it('penalizes open risks and issues in RAID', () => {
    const bid = createTestBuilding();
    // 2 active risks (5 pts each) + 1 active issue (3 pts) = 13 penalty
    memDb.prepare('INSERT INTO raid_entries (id, building_id, type, phase, summary, status) VALUES (?, ?, ?, ?, ?, ?)').run('r1', bid, 'risk', 'strategy', 'Risk 1', 'active');
    memDb.prepare('INSERT INTO raid_entries (id, building_id, type, phase, summary, status) VALUES (?, ?, ?, ?, ?, ?)').run('r2', bid, 'risk', 'strategy', 'Risk 2', 'active');
    memDb.prepare('INSERT INTO raid_entries (id, building_id, type, phase, summary, status) VALUES (?, ?, ?, ?, ?, ?)').run('i1', bid, 'issue', 'strategy', 'Issue 1', 'active');

    const result = getHealthScore(bid);
    expect(result.ok).toBe(true);
    // 25 - (2*5 + 1*3) = 25 - 13 = 12
    expect(result.data.score.raidHealth).toBe(12);
  });

  it('does not penalize closed RAID entries', () => {
    const bid = createTestBuilding();
    memDb.prepare('INSERT INTO raid_entries (id, building_id, type, phase, summary, status) VALUES (?, ?, ?, ?, ?, ?)').run('r1', bid, 'risk', 'strategy', 'Closed risk', 'closed');

    const result = getHealthScore(bid);
    expect(result.ok).toBe(true);
    expect(result.data.score.raidHealth).toBe(25);
  });

  it('scores agent activity based on recent messages', () => {
    const bid = createTestBuilding();
    // Get a room from the building's floors
    const floor = memDb.prepare('SELECT id FROM floors WHERE building_id = ? LIMIT 1').get(bid) as { id: string };
    memDb.prepare('INSERT INTO rooms (id, floor_id, type, name) VALUES (?, ?, ?, ?)').run('rm1', floor.id, 'code-lab', 'Lab');

    // Insert 30 messages (should yield 30/50 * 25 = 15)
    for (let i = 0; i < 30; i++) {
      memDb.prepare('INSERT INTO messages (id, room_id, role, content) VALUES (?, ?, ?, ?)').run(`m${i}`, 'rm1', 'assistant', `msg ${i}`);
    }

    const result = getHealthScore(bid);
    expect(result.ok).toBe(true);
    expect(result.data.score.agentActivity).toBe(15);
  });

  it('caps agent activity at 25', () => {
    const bid = createTestBuilding();
    const floor = memDb.prepare('SELECT id FROM floors WHERE building_id = ? LIMIT 1').get(bid) as { id: string };
    memDb.prepare('INSERT INTO rooms (id, floor_id, type, name) VALUES (?, ?, ?, ?)').run('rm1', floor.id, 'code-lab', 'Lab');

    // Insert 100 messages (exceeds 50 cap → should be 25)
    for (let i = 0; i < 100; i++) {
      memDb.prepare('INSERT INTO messages (id, room_id, role, content) VALUES (?, ?, ?, ?)').run(`m${i}`, 'rm1', 'assistant', `msg ${i}`);
    }

    const result = getHealthScore(bid);
    expect(result.ok).toBe(true);
    expect(result.data.score.agentActivity).toBe(25);
  });

  it('total is sum of all components', () => {
    const bid = createTestBuilding('execution');
    // Phase: execution = 17
    // Tasks: 2 done out of 2 = 25
    memDb.prepare('INSERT INTO tasks (id, building_id, title, status) VALUES (?, ?, ?, ?)').run('t1', bid, 'Task 1', 'done');
    memDb.prepare('INSERT INTO tasks (id, building_id, title, status) VALUES (?, ?, ?, ?)').run('t2', bid, 'Task 2', 'done');
    // RAID: no open items = 25
    // Activity: 0 messages = 0
    const result = getHealthScore(bid);
    expect(result.ok).toBe(true);
    const s = result.data.score;
    expect(s.total).toBe(s.phaseProgress + s.taskCompletion + s.raidHealth + s.agentActivity);
    expect(s.total).toBe(17 + 25 + 25 + 0);
  });
});

// ─── Auto-Discovery Tests (#971) ───

// We need to mock the node:fs, node:child_process, and node:os modules
// that autoDiscoverRepos uses internally. Since they're top-level imports
// in building-manager.ts, we mock them via vi.mock.

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return {
    ...actual,
    homedir: vi.fn(() => '/mock/home'),
  };
});

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    execFileSync: vi.fn(() => 'https://github.com/user/repo.git\n'),
  };
});

// Mock fs functions for auto-discover only — keep real behavior for other uses
const mockReaddirSync = vi.fn<() => string[]>(() => []);
const mockStatSync = vi.fn(() => ({ isDirectory: () => true }));
const mockExistsSync = vi.fn(() => true);

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    readdirSync: (...args: unknown[]) => {
      const path = args[0] as string;
      // Only intercept the GitRepos directory reads
      if (path.includes('GitRepos') || path.includes('/mock/home')) {
        return mockReaddirSync();
      }
      return actual.readdirSync(path as string);
    },
    statSync: (...args: unknown[]) => {
      const path = args[0] as string;
      if (path.includes('GitRepos') || path.includes('/mock/home')) {
        return mockStatSync();
      }
      return actual.statSync(path as string);
    },
    existsSync: (...args: unknown[]) => {
      const path = args[0] as string;
      if (path.includes('GitRepos') || path.includes('/mock/home')) {
        return mockExistsSync(path);
      }
      return actual.existsSync(path as string);
    },
  };
});

describe('autoDiscoverRepos (#971)', () => {
  beforeEach(() => {
    memDb = setupDb();
    vi.spyOn(dbModule, 'getDb').mockReturnValue(memDb as unknown as ReturnType<typeof dbModule.getDb>);
    mockReaddirSync.mockReset();
    mockStatSync.mockReset().mockReturnValue({ isDirectory: () => true });
    mockExistsSync.mockReset().mockReturnValue(true);
  });

  it('returns 0 when buildings already exist', () => {
    createBuilding({ name: 'Existing' });
    const count = autoDiscoverRepos();
    expect(count).toBe(0);
  });

  it('returns 0 when GitRepos directory does not exist', () => {
    mockExistsSync.mockReturnValue(false);
    const count = autoDiscoverRepos();
    expect(count).toBe(0);
  });

  it('creates buildings for discovered git repos', () => {
    mockReaddirSync.mockReturnValue(['my-project', 'another-repo']);
    mockExistsSync.mockReturnValue(true); // Both GitRepos dir and .git dirs exist

    const count = autoDiscoverRepos();
    expect(count).toBe(2);

    const result = listBuildings();
    expect(result.ok).toBe(true);
    expect(result.data).toHaveLength(2);

    const names = result.data.map((b: { name: string }) => b.name);
    expect(names).toContain('My Project');
    expect(names).toContain('Another Repo');
  });

  it('skips Overlord-v2 directory', () => {
    mockReaddirSync.mockReturnValue(['Overlord-v2', 'real-project']);
    mockExistsSync.mockReturnValue(true);

    const count = autoDiscoverRepos();
    expect(count).toBe(1);

    const result = listBuildings();
    expect(result.data).toHaveLength(1);
    expect(result.data[0].name).toBe('Real Project');
  });

  it('skips non-directory entries', () => {
    mockReaddirSync.mockReturnValue(['file.txt', 'real-repo']);
    mockStatSync.mockImplementation(() => {
      // First call = file.txt → not a directory; second = real-repo → directory
      return { isDirectory: () => true };
    });
    // For file.txt, statSync should say it's not a directory
    let callCount = 0;
    mockStatSync.mockImplementation(() => {
      callCount++;
      return { isDirectory: () => callCount > 1 };
    });
    mockExistsSync.mockReturnValue(true);

    const count = autoDiscoverRepos();
    expect(count).toBe(1);
  });

  it('returns 0 when no repos found', () => {
    mockReaddirSync.mockReturnValue([]);
    const count = autoDiscoverRepos();
    expect(count).toBe(0);
  });

  it('sets working directory and project ID correctly', () => {
    mockReaddirSync.mockReturnValue(['StatusOwl']);
    mockExistsSync.mockReturnValue(true);

    autoDiscoverRepos();

    const result = listBuildings();
    expect(result.data).toHaveLength(1);
    const building = result.data[0];
    expect(building.name).toBe('StatusOwl');
    expect(building.working_directory).toBe('/mock/home/GitRepos/StatusOwl');
    expect(building.project_id).toBe('project_statusowl');
  });
});
