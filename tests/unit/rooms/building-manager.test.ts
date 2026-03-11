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
} from '../../../src/rooms/building-manager.js';

let memDb: Database.Database;

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
