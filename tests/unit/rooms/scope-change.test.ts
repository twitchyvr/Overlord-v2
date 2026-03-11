/**
 * Scope Change Protocol Tests
 *
 * Tests detection, re-entry orchestration, and bus escalation handling.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import * as dbModule from '../../../src/storage/db.js';
import { EventEmitter } from 'eventemitter3';
import { initRooms, registerRoomType } from '../../../src/rooms/room-manager.js';
import { createBuilding } from '../../../src/rooms/building-manager.js';
import { detectScopeChange, initiateReEntry, initScopeChangeHandler } from '../../../src/rooms/scope-change.js';
import { DiscoveryRoom } from '../../../src/rooms/room-types/discovery.js';
import { CodeLab } from '../../../src/rooms/room-types/code-lab.js';
import { ArchitectureRoom } from '../../../src/rooms/room-types/architecture.js';
import type { RaidEntryRow } from '../../../src/core/contracts.js';
import type { Bus } from '../../../src/core/bus.js';

let memDb: Database.Database;
let buildingId: string;
let testBus: Bus;
const agentId = 'agent_scope_test';

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

  return db;
}

beforeEach(() => {
  memDb = setupDb();
  vi.spyOn(dbModule, 'getDb').mockReturnValue(memDb as unknown as ReturnType<typeof dbModule.getDb>);

  // Create a fresh bus per test
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

  // Init room system
  initRooms({ bus: testBus, agents: {} as never, tools: {} as never, ai: {} as never });

  // Register room types
  registerRoomType('discovery', DiscoveryRoom as never);
  registerRoomType('code-lab', CodeLab as never);
  registerRoomType('architecture', ArchitectureRoom as never);

  // Create building with default floors
  const result = createBuilding({ name: 'Scope Change Test Project' });
  buildingId = result.data.id;

  // Create agent with wildcard room access
  memDb.prepare(`
    INSERT INTO agents (id, name, role, capabilities, room_access, status, config)
    VALUES (?, 'Scope Tester', 'developer', '[]', '["*"]', 'idle', '{}')
  `).run(agentId);
});

// ─── Detection ───

describe('detectScopeChange', () => {
  it('creates a RAID issue entry for the scope change', () => {
    const result = detectScopeChange({
      buildingId,
      description: 'New auth requirement discovered',
      affectedAreas: ['authentication', 'user-management'],
      detectedBy: agentId,
      currentPhase: 'execution',
    });

    expect(result.ok).toBe(true);
    expect(result.data.raidId).toBeDefined();
    expect(result.data.buildingId).toBe(buildingId);

    // Verify RAID entry in DB
    const raid = memDb.prepare('SELECT * FROM raid_entries WHERE id = ?').get(result.data.raidId) as RaidEntryRow;
    expect(raid.type).toBe('issue');
    expect(raid.phase).toBe('execution');
    expect(raid.summary).toContain('Scope change');
    expect(raid.summary).toContain('New auth requirement');
    expect(JSON.parse(raid.affected_areas)).toEqual(['authentication', 'user-management']);
  });

  it('links scope change to current room if provided', () => {
    // Need a valid room for the FK — insert floor+room manually
    const floors = memDb.prepare('SELECT id FROM floors WHERE building_id = ?').all(buildingId) as { id: string }[];
    memDb.prepare(`INSERT INTO rooms (id, floor_id, type, name) VALUES ('room_abc', ?, 'code-lab', 'Test')`).run(floors[0].id);

    const result = detectScopeChange({
      buildingId,
      description: 'API redesign needed',
      affectedAreas: ['api'],
      detectedBy: agentId,
      currentPhase: 'execution',
      currentRoomId: 'room_abc',
    });

    expect(result.ok).toBe(true);
    const raid = memDb.prepare('SELECT room_id FROM raid_entries WHERE id = ?').get(result.data.raidId) as { room_id: string };
    expect(raid.room_id).toBe('room_abc');
  });

  it('returns error for non-existent building', () => {
    const result = detectScopeChange({
      buildingId: 'bld_nonexistent',
      description: 'test',
      affectedAreas: [],
      detectedBy: agentId,
      currentPhase: 'execution',
    });

    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('BUILDING_NOT_FOUND');
  });
});

// ─── Re-Entry ───

describe('initiateReEntry', () => {
  it('creates room on correct floor and enters agent with context brief', () => {
    const detect = detectScopeChange({
      buildingId,
      description: 'Need to revisit requirements',
      affectedAreas: ['core-api'],
      detectedBy: agentId,
      currentPhase: 'execution',
    });

    const result = initiateReEntry({
      buildingId,
      targetRoomType: 'discovery',
      agentId,
      scopeChangeId: detect.data.raidId,
    });

    expect(result.ok).toBe(true);
    expect(result.data.roomId).toBeDefined();
    expect(result.data.agentId).toBe(agentId);
    expect(result.data.scopeChangeId).toBe(detect.data.raidId);
    expect(result.data.contextBrief).toBeDefined();
    expect(result.data.contextBrief.issues.length).toBeGreaterThanOrEqual(1);
    expect(result.data.tools).toBeDefined();
    expect(result.data.fileScope).toBeDefined();
  });

  it('auto-selects first table type when not specified', () => {
    const detect = detectScopeChange({
      buildingId,
      description: 'test',
      affectedAreas: [],
      detectedBy: agentId,
      currentPhase: 'execution',
    });

    const result = initiateReEntry({
      buildingId,
      targetRoomType: 'discovery',
      agentId,
      scopeChangeId: detect.data.raidId,
    });

    expect(result.ok).toBe(true);
    expect(result.data.tableType).toBe('collab');
  });

  it('places room on the correct floor', () => {
    const detect = detectScopeChange({
      buildingId,
      description: 'test',
      affectedAreas: [],
      detectedBy: agentId,
      currentPhase: 'execution',
    });

    const result = initiateReEntry({
      buildingId,
      targetRoomType: 'discovery',
      agentId,
      scopeChangeId: detect.data.raidId,
    });

    expect(result.ok).toBe(true);

    const room = memDb.prepare('SELECT floor_id FROM rooms WHERE id = ?').get(result.data.roomId) as { floor_id: string };
    const floor = memDb.prepare('SELECT type FROM floors WHERE id = ?').get(room.floor_id) as { type: string };
    expect(floor.type).toBe('collaboration');
  });

  it('returns error for unknown room type', () => {
    const result = initiateReEntry({
      buildingId,
      targetRoomType: 'nonexistent-room',
      agentId,
      scopeChangeId: 'raid_123',
    });

    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('UNKNOWN_ROOM_TYPE');
  });

  it('returns error for non-existent building', () => {
    const result = initiateReEntry({
      buildingId: 'bld_nonexistent',
      targetRoomType: 'discovery',
      agentId,
      scopeChangeId: 'raid_123',
    });

    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('BUILDING_NOT_FOUND');
  });
});

// ─── Escalation Handler ───

describe('initScopeChangeHandler', () => {
  it('listens for room:escalation:suggested with onScopeChange condition', () => {
    initScopeChangeHandler(testBus);

    // Create a room so the handler can look up the building chain
    const floors = memDb.prepare('SELECT id FROM floors WHERE building_id = ? AND type = ?').all(buildingId, 'execution') as { id: string }[];
    const floorId = floors[0].id;

    memDb.prepare(`
      INSERT INTO rooms (id, floor_id, type, name, allowed_tools, file_scope, exit_template, escalation, config)
      VALUES ('room_handler_test', ?, 'code-lab', 'Handler Test', '[]', 'assigned', '{}', '{}', '{}')
    `).run(floorId);

    // Spy on scope-change:detected events
    const detected: unknown[] = [];
    testBus.on('scope-change:detected', (data: unknown) => detected.push(data));

    // Emit an escalation event
    testBus.emit('room:escalation:suggested', {
      roomId: 'room_handler_test',
      roomType: 'code-lab',
      agentId,
      condition: 'onScopeChange',
      targetRoom: 'discovery',
      reason: 'New requirement found',
    });

    expect(detected).toHaveLength(1);
    const event = detected[0] as Record<string, unknown>;
    expect(event.buildingId).toBe(buildingId);
    expect(event.targetRoomType).toBe('discovery');
    expect(event.scopeChangeId).toBeDefined();
  });

  it('ignores escalation events that are not onScopeChange', () => {
    initScopeChangeHandler(testBus);

    const detected: unknown[] = [];
    testBus.on('scope-change:detected', (data: unknown) => detected.push(data));

    testBus.emit('room:escalation:suggested', {
      roomId: 'room_abc',
      condition: 'onFailure',
      targetRoom: 'war-room',
      agentId,
    });

    expect(detected).toHaveLength(0);
  });
});
