/**
 * Room Manager Tests
 *
 * Tests room lifecycle: create, enter, exit, exit documents.
 * Uses in-memory SQLite — no disk IO.
 *
 * Note: This file uses better-sqlite3's Database.prototype.exec()
 * which is SQLite's SQL execution method for running DDL statements.
 * It is NOT Node's child_process exec — no shell injection risk.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import {
  createRoom,
  enterRoom,
  exitRoom,
  submitExitDocument,
  registerRoomType,
  getRoom,
  listRooms,
} from '../../../src/rooms/room-manager.js';

// Patch getDb to use in-memory database
import * as dbModule from '../../../src/storage/db.js';
import { vi } from 'vitest';
import { BaseRoom } from '../../../src/rooms/room-types/base-room.js';
import type { RoomContract, Result } from '../../../src/core/contracts.js';
import { err } from '../../../src/core/contracts.js';

let db: Database.Database;

/**
 * Create an in-memory SQLite database with test schema.
 * Uses better-sqlite3's .exec() method (SQL DDL execution, not shell).
 */
function setupDb(): Database.Database {
  const memDb = new Database(':memory:');
  memDb.pragma('foreign_keys = OFF');
  // Create tables individually using prepare().run() — SQLite DDL, not shell
  memDb.prepare(`CREATE TABLE rooms (
    id TEXT PRIMARY KEY, floor_id TEXT NOT NULL, type TEXT NOT NULL, name TEXT NOT NULL,
    allowed_tools TEXT DEFAULT '[]', file_scope TEXT DEFAULT 'assigned',
    exit_template TEXT DEFAULT '{}', escalation TEXT DEFAULT '{}',
    provider TEXT DEFAULT 'configurable', config TEXT DEFAULT '{}',
    status TEXT DEFAULT 'idle', created_at TEXT DEFAULT (datetime('now'))
  )`).run();
  memDb.prepare(`CREATE TABLE tables_v2 (
    id TEXT PRIMARY KEY, room_id TEXT NOT NULL, type TEXT NOT NULL DEFAULT 'focus',
    chairs INTEGER DEFAULT 1, description TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`).run();
  memDb.prepare(`CREATE TABLE agents (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, role TEXT NOT NULL,
    building_id TEXT,
    capabilities TEXT DEFAULT '[]', room_access TEXT DEFAULT '[]', badge TEXT,
    status TEXT DEFAULT 'idle', current_room_id TEXT, current_table_id TEXT,
    config TEXT DEFAULT '{}', created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`).run();
  memDb.prepare(`CREATE TABLE exit_documents (
    id TEXT PRIMARY KEY, room_id TEXT NOT NULL, type TEXT NOT NULL,
    completed_by TEXT NOT NULL, fields TEXT DEFAULT '{}', artifacts TEXT DEFAULT '[]',
    raid_entry_ids TEXT DEFAULT '[]', created_at TEXT DEFAULT (datetime('now'))
  )`).run();
  return memDb;
}

// Test room type
class TestCodeLab extends BaseRoom {
  static override contract: RoomContract = {
    roomType: 'code-lab',
    floor: 'execution',
    tables: {
      focus: { chairs: 1, description: 'Solo coding' },
      pair: { chairs: 2, description: 'Pair programming' },
    },
    tools: ['read_file', 'write_file', 'patch_file', 'bash'],
    fileScope: 'assigned',
    exitRequired: {
      type: 'code-review',
      fields: ['filesChanged', 'testsAdded', 'summary'],
    },
    escalation: { onFailure: 'testing-lab' },
    provider: 'configurable',
  };

  override getRules(): string[] {
    return ['Write clean code.', 'Add tests for new logic.'];
  }
}

// Room type whose onAgentEnter always rejects — tests rollback path
class RejectingCodeLab extends BaseRoom {
  static override contract: RoomContract = {
    ...TestCodeLab.contract,
    roomType: 'rejecting-lab',
  };

  override onAgentEnter(_agentId: string, _tableType?: string): Result {
    return err('ROOM_REJECTED', 'Room is in lockdown — no entry allowed');
  }

  override getRules(): string[] {
    return ['No entry.'];
  }
}

describe('Room Manager', () => {
  beforeEach(() => {
    db = setupDb();
    vi.spyOn(dbModule, 'getDb').mockReturnValue(db as unknown as ReturnType<typeof dbModule.getDb>);

    // Register the test room type
    registerRoomType('code-lab', TestCodeLab as any);
  });

  describe('registerRoomType', () => {
    it('registers a room type for creation', () => {
      // Already registered in beforeEach, just verify createRoom works
      const result = createRoom({ type: 'code-lab', floorId: 'floor_exec', name: 'My Code Lab' });
      expect(result.ok).toBe(true);
    });
  });

  describe('createRoom', () => {
    it('creates a room with correct properties', () => {
      const result = createRoom({ type: 'code-lab', floorId: 'floor_exec', name: 'Code Lab Alpha' });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.type).toBe('code-lab');
        expect(result.data.name).toBe('Code Lab Alpha');
        expect(result.data.id).toMatch(/^room_/);
      }
    });

    it('persists room to database', () => {
      createRoom({ type: 'code-lab', floorId: 'floor_exec', name: 'Persisted Lab' });
      const rows = db.prepare('SELECT * FROM rooms WHERE type = ?').all('code-lab');
      expect(rows).toHaveLength(1);
    });

    it('stores contract tools in database', () => {
      createRoom({ type: 'code-lab', floorId: 'floor_exec', name: 'Tool Lab' });
      const row = db.prepare('SELECT allowed_tools FROM rooms WHERE type = ?').get('code-lab') as { allowed_tools: string };
      expect(JSON.parse(row.allowed_tools)).toEqual(['read_file', 'write_file', 'patch_file', 'bash']);
    });

    it('rejects unknown room type', () => {
      const result = createRoom({ type: 'nonexistent', floorId: 'floor_exec', name: 'Bad Room' });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('UNKNOWN_ROOM_TYPE');
      }
    });

    it('makes room accessible via getRoom', () => {
      const created = createRoom({ type: 'code-lab', floorId: 'floor_exec', name: 'Accessible Lab' });
      if (!created.ok) throw new Error('failed');

      const room = getRoom(created.data.id);
      expect(room).not.toBeNull();
      expect(room!.type).toBe('code-lab');
    });
  });

  describe('enterRoom', () => {
    let roomId: string;

    beforeEach(() => {
      const room = createRoom({ type: 'code-lab', floorId: 'floor_exec', name: 'Entry Lab' });
      if (!room.ok) throw new Error('room creation failed');
      roomId = room.data.id;

      // Seed an agent with code-lab access
      db.prepare(`INSERT INTO agents (id, name, role, room_access) VALUES ('agent_1', 'Coder', 'developer', '["code-lab", "*"]')`).run();
    });

    it('allows agent with matching room access', () => {
      const result = enterRoom({ roomId, agentId: 'agent_1' });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.tools).toEqual(['read_file', 'write_file', 'patch_file', 'bash']);
        expect(result.data.fileScope).toBe('assigned');
        expect(result.data.tableId).toBeDefined();
      }
    });

    it('updates agent status to active and assigns table', () => {
      enterRoom({ roomId, agentId: 'agent_1' });
      const agent = db.prepare('SELECT status, current_room_id, current_table_id FROM agents WHERE id = ?').get('agent_1') as {
        status: string;
        current_room_id: string;
        current_table_id: string;
      };
      expect(agent.status).toBe('active');
      expect(agent.current_room_id).toBe(roomId);
      expect(agent.current_table_id).toBeDefined();
      expect(agent.current_table_id).toMatch(/^table_/);
    });

    it('creates a table_v2 row for the room', () => {
      enterRoom({ roomId, agentId: 'agent_1', tableType: 'focus' });
      const table = db.prepare('SELECT * FROM tables_v2 WHERE room_id = ?').get(roomId) as {
        room_id: string;
        type: string;
        chairs: number;
      };
      expect(table).toBeDefined();
      expect(table.type).toBe('focus');
      expect(table.chairs).toBe(1);
    });

    it('rejects invalid table type', () => {
      const result = enterRoom({ roomId, agentId: 'agent_1', tableType: 'nonexistent' });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_TABLE_TYPE');
        expect(result.error.message).toContain('nonexistent');
        expect(result.error.message).toContain('focus');
        expect(result.error.message).toContain('pair');
      }
    });

    it('enforces chair capacity on focus table (1 chair)', () => {
      // First agent takes the only chair at the focus table
      db.prepare(`INSERT INTO agents (id, name, role, room_access) VALUES ('agent_3', 'Coder2', 'developer', '["code-lab"]')`).run();
      const first = enterRoom({ roomId, agentId: 'agent_1', tableType: 'focus' });
      expect(first.ok).toBe(true);

      // Second agent should be rejected — focus only has 1 chair
      const second = enterRoom({ roomId, agentId: 'agent_3', tableType: 'focus' });
      expect(second.ok).toBe(false);
      if (!second.ok) {
        expect(second.error.code).toBe('TABLE_FULL');
        expect(second.error.message).toContain('1 chair');
      }
    });

    it('allows multiple agents at pair table (2 chairs)', () => {
      db.prepare(`INSERT INTO agents (id, name, role, room_access) VALUES ('agent_3', 'Coder2', 'developer', '["code-lab"]')`).run();
      const first = enterRoom({ roomId, agentId: 'agent_1', tableType: 'pair' });
      expect(first.ok).toBe(true);

      const second = enterRoom({ roomId, agentId: 'agent_3', tableType: 'pair' });
      expect(second.ok).toBe(true);
    });

    it('rejects third agent at pair table (2 chairs)', () => {
      db.prepare(`INSERT INTO agents (id, name, role, room_access) VALUES ('agent_3', 'Coder2', 'developer', '["code-lab"]')`).run();
      db.prepare(`INSERT INTO agents (id, name, role, room_access) VALUES ('agent_4', 'Coder3', 'developer', '["code-lab"]')`).run();

      enterRoom({ roomId, agentId: 'agent_1', tableType: 'pair' });
      enterRoom({ roomId, agentId: 'agent_3', tableType: 'pair' });

      const third = enterRoom({ roomId, agentId: 'agent_4', tableType: 'pair' });
      expect(third.ok).toBe(false);
      if (!third.ok) {
        expect(third.error.code).toBe('TABLE_FULL');
        expect(third.error.message).toContain('2 chairs');
      }
    });

    it('rejects agent without room access', () => {
      db.prepare(`INSERT INTO agents (id, name, role, room_access) VALUES ('agent_2', 'Reviewer', 'reviewer', '["review"]')`).run();
      const result = enterRoom({ roomId, agentId: 'agent_2' });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('ACCESS_DENIED');
      }
    });

    it('rejects non-existent room', () => {
      const result = enterRoom({ roomId: 'room_ghost', agentId: 'agent_1' });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('ROOM_NOT_FOUND');
      }
    });

    it('rejects non-existent agent', () => {
      const result = enterRoom({ roomId, agentId: 'agent_ghost' });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('AGENT_NOT_FOUND');
      }
    });

    it('allows agent with wildcard access', () => {
      db.prepare(`INSERT INTO agents (id, name, role, room_access) VALUES ('agent_wild', 'Admin', 'admin', '["*"]')`).run();
      const result = enterRoom({ roomId, agentId: 'agent_wild' });
      expect(result.ok).toBe(true);
    });

    it('rolls back DB state when onAgentEnter rejects entry', () => {
      // Register the rejecting room type and create one
      registerRoomType('rejecting-lab', RejectingCodeLab as any);
      const created = createRoom({ type: 'rejecting-lab', floorId: 'floor_exec', name: 'Locked Lab' });
      if (!created.ok) throw new Error('room creation failed');
      const rejectRoomId = created.data.id;

      // Seed an agent with access
      db.prepare(`INSERT INTO agents (id, name, role, room_access) VALUES ('agent_reject', 'Tester', 'developer', '["rejecting-lab"]')`).run();

      // Attempt entry — should fail because onAgentEnter returns err
      const result = enterRoom({ roomId: rejectRoomId, agentId: 'agent_reject' });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('ROOM_REJECTED');
        expect(result.error.message).toContain('lockdown');
      }

      // Verify rollback: agent should be back to idle with no room/table
      const agent = db.prepare('SELECT status, current_room_id, current_table_id FROM agents WHERE id = ?').get('agent_reject') as {
        status: string;
        current_room_id: string | null;
        current_table_id: string | null;
      };
      expect(agent.status).toBe('idle');
      expect(agent.current_room_id).toBeNull();
      expect(agent.current_table_id).toBeNull();
    });
  });

  describe('exitRoom', () => {
    let roomId: string;

    beforeEach(() => {
      const room = createRoom({ type: 'code-lab', floorId: 'floor_exec', name: 'Exit Lab' });
      if (!room.ok) throw new Error('room creation failed');
      roomId = room.data.id;

      db.prepare(`INSERT INTO agents (id, name, role, room_access) VALUES ('agent_1', 'Coder', 'developer', '["code-lab"]')`).run();
      enterRoom({ roomId, agentId: 'agent_1' });
    });

    it('rejects exit without exit document when room requires one', () => {
      const result = exitRoom({ roomId, agentId: 'agent_1' });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('EXIT_DOC_REQUIRED');
        expect(result.error.message).toContain('filesChanged');
        expect(result.error.message).toContain('testsAdded');
        expect(result.error.message).toContain('summary');
      }
    });

    it('allows exit after submitting valid exit document', () => {
      // Submit exit document first
      submitExitDocument({
        roomId,
        agentId: 'agent_1',
        document: { filesChanged: ['a.ts'], testsAdded: 1, summary: 'Done' },
      });

      const result = exitRoom({ roomId, agentId: 'agent_1' });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.roomId).toBe(roomId);
        expect(result.data.agentId).toBe('agent_1');
      }
    });

    it('sets agent status to idle and clears table after valid exit', () => {
      submitExitDocument({
        roomId,
        agentId: 'agent_1',
        document: { filesChanged: ['a.ts'], testsAdded: 1, summary: 'Done' },
      });
      exitRoom({ roomId, agentId: 'agent_1' });

      const agent = db.prepare('SELECT status, current_room_id, current_table_id FROM agents WHERE id = ?').get('agent_1') as {
        status: string;
        current_room_id: string | null;
        current_table_id: string | null;
      };
      expect(agent.status).toBe('idle');
      expect(agent.current_room_id).toBeNull();
      expect(agent.current_table_id).toBeNull();
    });

    it('frees chair for next agent after exit', () => {
      // Agent 1 takes the focus chair (1 chair limit)
      db.prepare(`INSERT INTO agents (id, name, role, room_access) VALUES ('agent_3', 'Coder2', 'developer', '["code-lab"]')`).run();

      // Agent 3 can't enter — focus table is full
      const blocked = enterRoom({ roomId, agentId: 'agent_3', tableType: 'focus' });
      expect(blocked.ok).toBe(false);

      // Agent 1 submits exit doc and leaves
      submitExitDocument({
        roomId,
        agentId: 'agent_1',
        document: { filesChanged: ['a.ts'], testsAdded: 1, summary: 'Done' },
      });
      exitRoom({ roomId, agentId: 'agent_1' });

      // Now agent 3 can enter
      const allowed = enterRoom({ roomId, agentId: 'agent_3', tableType: 'focus' });
      expect(allowed.ok).toBe(true);
    });

    it('rejects non-existent room', () => {
      const result = exitRoom({ roomId: 'room_ghost', agentId: 'agent_1' });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('ROOM_NOT_FOUND');
      }
    });
  });

  describe('submitExitDocument', () => {
    let roomId: string;

    beforeEach(() => {
      const room = createRoom({ type: 'code-lab', floorId: 'floor_exec', name: 'Doc Lab' });
      if (!room.ok) throw new Error('room creation failed');
      roomId = room.data.id;
    });

    it('accepts valid exit document with all required fields', () => {
      const result = submitExitDocument({
        roomId,
        agentId: 'agent_1',
        document: {
          filesChanged: ['src/auth.ts', 'src/auth.test.ts'],
          testsAdded: 3,
          summary: 'Added auth middleware with JWT validation',
        },
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.id).toMatch(/^exitdoc_/);
        expect(result.data.roomId).toBe(roomId);
      }
    });

    it('persists exit document to database', () => {
      submitExitDocument({
        roomId,
        agentId: 'agent_1',
        document: { filesChanged: ['a.ts'], testsAdded: 1, summary: 'Quick fix' },
      });
      const rows = db.prepare('SELECT * FROM exit_documents WHERE room_id = ?').all(roomId);
      expect(rows).toHaveLength(1);
    });

    it('rejects document missing required fields', () => {
      const result = submitExitDocument({
        roomId,
        agentId: 'agent_1',
        document: { filesChanged: ['a.ts'] }, // missing testsAdded and summary
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('EXIT_DOC_INCOMPLETE');
        expect(result.error.message).toContain('testsAdded');
        expect(result.error.message).toContain('summary');
      }
    });

    it('rejects non-existent room', () => {
      const result = submitExitDocument({
        roomId: 'room_ghost',
        agentId: 'agent_1',
        document: { filesChanged: [], testsAdded: 0, summary: 'Nothing' },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('ROOM_NOT_FOUND');
      }
    });
  });

  describe('listRooms', () => {
    it('returns all rooms from database', () => {
      createRoom({ type: 'code-lab', floorId: 'floor_exec', name: 'Lab A' });
      createRoom({ type: 'code-lab', floorId: 'floor_exec', name: 'Lab B' });

      const rooms = listRooms();
      expect(rooms).toHaveLength(2);
    });

    it('returns empty array when no rooms exist', () => {
      const rooms = listRooms();
      expect(rooms).toHaveLength(0);
    });
  });

  describe('error handling — DB failures', () => {
    it('createRoom returns DB_ERROR when insert fails', () => {
      // Drop the rooms table to force a DB error
      db.prepare('DROP TABLE rooms').run();
      const result = createRoom({ type: 'code-lab', floorId: 'floor_exec', name: 'Broken Lab' });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('DB_ERROR');
        expect(result.error.message).toContain('Failed to create room');
      }
    });

    it('enterRoom returns DB_ERROR when agent lookup fails', () => {
      const room = createRoom({ type: 'code-lab', floorId: 'floor_exec', name: 'Lab' });
      if (!room.ok) throw new Error('room creation failed');

      // Drop agents table to force DB error
      db.prepare('DROP TABLE agents').run();
      const result = enterRoom({ roomId: room.data.id, agentId: 'agent_1' });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('DB_ERROR');
        expect(result.error.message).toContain('Failed to enter room');
      }
    });

    it('exitRoom returns DB_ERROR when exit doc lookup fails', () => {
      const room = createRoom({ type: 'code-lab', floorId: 'floor_exec', name: 'Lab' });
      if (!room.ok) throw new Error('room creation failed');

      db.prepare(`INSERT INTO agents (id, name, role, room_access) VALUES ('agent_1', 'Coder', 'developer', '["code-lab"]')`).run();
      enterRoom({ roomId: room.data.id, agentId: 'agent_1' });

      // Drop exit_documents table to force DB error on exit doc check
      db.prepare('DROP TABLE exit_documents').run();
      const result = exitRoom({ roomId: room.data.id, agentId: 'agent_1' });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('DB_ERROR');
        expect(result.error.message).toContain('Failed to exit room');
      }
    });

    it('submitExitDocument returns DB_ERROR when insert fails', () => {
      const room = createRoom({ type: 'code-lab', floorId: 'floor_exec', name: 'Lab' });
      if (!room.ok) throw new Error('room creation failed');

      // Drop exit_documents table to force DB error
      db.prepare('DROP TABLE exit_documents').run();
      const result = submitExitDocument({
        roomId: room.data.id,
        agentId: 'agent_1',
        document: { filesChanged: ['a.ts'], testsAdded: 1, summary: 'Done' },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('DB_ERROR');
        expect(result.error.message).toContain('Failed to submit exit document');
      }
    });

    it('listRooms returns empty array on DB failure', () => {
      db.prepare('DROP TABLE rooms').run();
      const rooms = listRooms();
      expect(rooms).toEqual([]);
    });
  });

  describe('room tool scoping', () => {
    it('room only exposes its contracted tools', () => {
      const created = createRoom({ type: 'code-lab', floorId: 'floor_exec', name: 'Scoped Lab' });
      if (!created.ok) throw new Error('failed');

      const room = getRoom(created.data.id);
      expect(room!.getAllowedTools()).toEqual(['read_file', 'write_file', 'patch_file', 'bash']);
      expect(room!.hasTool('write_file')).toBe(true);
      expect(room!.hasTool('web_search')).toBe(false);
    });

    it('room enforces file scope', () => {
      const created = createRoom({ type: 'code-lab', floorId: 'floor_exec', name: 'Scope Lab' });
      if (!created.ok) throw new Error('failed');

      const room = getRoom(created.data.id);
      expect(room!.fileScope).toBe('assigned');
    });

    it('room provides context injection', () => {
      const created = createRoom({ type: 'code-lab', floorId: 'floor_exec', name: 'Context Lab' });
      if (!created.ok) throw new Error('failed');

      const room = getRoom(created.data.id);
      const ctx = room!.buildContextInjection();
      expect(ctx.roomType).toBe('code-lab');
      expect(ctx.rules).toEqual(['Write clean code.', 'Add tests for new logic.']);
      expect(ctx.tools).toEqual(['read_file', 'write_file', 'patch_file', 'bash']);
      expect(ctx.fileScope).toBe('assigned');
    });
  });
});
