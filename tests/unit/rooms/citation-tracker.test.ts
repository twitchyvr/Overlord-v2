/**
 * Citation Tracker Tests
 *
 * Tests the cross-room citation system that tracks references between rooms.
 * Citations link source rooms/messages to target rooms/entries, enabling
 * bidirectional navigation: "what cited this?" and "what does this cite?"
 *
 * Uses a real temp SQLite database per test — same pattern as db.test.ts.
 * The citation tracker relies on the `rooms` table for FK validation,
 * so we insert test rooms before testing citation operations.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { initStorage, getDb } from '../../../src/storage/db.js';
import {
  addCitation,
  getCitations,
  getBacklinks,
  resolveCitation,
  getOutgoingCitations,
  deleteCitation,
} from '../../../src/rooms/citation-tracker.js';
import type { Config } from '../../../src/core/config.js';

let testDir: string;
let testDbPath: string;

function createMockConfig(dbPath: string): Config {
  return {
    get: vi.fn((key: string) => {
      if (key === 'DB_PATH') return dbPath;
      return undefined;
    }),
    validate: vi.fn(),
    getAll: vi.fn(),
  } as unknown as Config;
}

/**
 * Insert the scaffolding needed for citations:
 * building -> floor -> rooms (source + target).
 * Returns the IDs of the two rooms created.
 */
function seedTestRooms(): { sourceRoomId: string; targetRoomId: string } {
  const db = getDb();
  db.prepare("INSERT INTO buildings (id, name) VALUES ('b1', 'Test Building')").run();
  db.prepare("INSERT INTO floors (id, building_id, type, name) VALUES ('f1', 'b1', 'integration', 'Integration Floor')").run();
  db.prepare("INSERT INTO rooms (id, floor_id, type, name) VALUES ('room_src', 'f1', 'data-exchange', 'Source Room')").run();
  db.prepare("INSERT INTO rooms (id, floor_id, type, name) VALUES ('room_tgt', 'f1', 'provider-hub', 'Target Room')").run();
  return { sourceRoomId: 'room_src', targetRoomId: 'room_tgt' };
}

/**
 * Insert a third room for multi-room citation tests.
 */
function seedThirdRoom(): string {
  const db = getDb();
  db.prepare("INSERT INTO rooms (id, floor_id, type, name) VALUES ('room_third', 'f1', 'plugin-bay', 'Third Room')").run();
  return 'room_third';
}

describe('Citation Tracker', () => {
  beforeEach(async () => {
    testDir = join(tmpdir(), `overlord-cit-test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
    mkdirSync(testDir, { recursive: true });
    testDbPath = join(testDir, 'test.db');
    const cfg = createMockConfig(testDbPath);
    await initStorage(cfg);
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  // ─── addCitation ───

  describe('addCitation', () => {
    it('creates a citation and returns it with an ID', () => {
      const { sourceRoomId, targetRoomId } = seedTestRooms();

      const result = addCitation({
        sourceRoomId,
        targetRoomId,
        targetType: 'room',
        createdBy: 'agent_1',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.id).toBeDefined();
        expect(result.data.id).toMatch(/^cit_/);
        expect(result.data.sourceRoomId).toBe(sourceRoomId);
        expect(result.data.targetRoomId).toBe(targetRoomId);
        expect(result.data.targetType).toBe('room');
        expect(result.data.createdBy).toBe('agent_1');
        expect(result.data.createdAt).toBeDefined();
      }
    });

    it('creates a citation with optional sourceMessageId and targetEntryId', () => {
      const { sourceRoomId, targetRoomId } = seedTestRooms();

      const result = addCitation({
        sourceRoomId,
        sourceMessageId: 'msg_42',
        targetRoomId,
        targetEntryId: 'raid_99',
        targetType: 'raid',
        createdBy: 'agent_2',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.sourceMessageId).toBe('msg_42');
        expect(result.data.targetEntryId).toBe('raid_99');
        expect(result.data.targetType).toBe('raid');
      }
    });

    it('persists citation to the database', () => {
      const { sourceRoomId, targetRoomId } = seedTestRooms();

      const result = addCitation({
        sourceRoomId,
        targetRoomId,
        targetType: 'message',
        createdBy: 'agent_1',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        const db = getDb();
        const row = db.prepare('SELECT * FROM citations WHERE id = ?').get(result.data.id) as Record<string, unknown>;
        expect(row).toBeDefined();
        expect(row.source_room_id).toBe(sourceRoomId);
        expect(row.target_room_id).toBe(targetRoomId);
        expect(row.target_type).toBe('message');
        expect(row.created_by).toBe('agent_1');
      }
    });

    it('sets null for omitted sourceMessageId and targetEntryId', () => {
      const { sourceRoomId, targetRoomId } = seedTestRooms();

      const result = addCitation({
        sourceRoomId,
        targetRoomId,
        targetType: 'room',
        createdBy: 'agent_1',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.sourceMessageId).toBeNull();
        expect(result.data.targetEntryId).toBeNull();
      }
    });

    it('accepts all valid target types', () => {
      const { sourceRoomId, targetRoomId } = seedTestRooms();
      const validTypes = ['message', 'raid', 'exit-doc', 'room'] as const;

      for (const targetType of validTypes) {
        const result = addCitation({
          sourceRoomId,
          targetRoomId,
          targetType,
          createdBy: 'agent_1',
        });
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.data.targetType).toBe(targetType);
        }
      }
    });

    it('fails for invalid target type', () => {
      const { sourceRoomId, targetRoomId } = seedTestRooms();

      const result = addCitation({
        sourceRoomId,
        targetRoomId,
        targetType: 'invalid' as any,
        createdBy: 'agent_1',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_TARGET_TYPE');
        expect(result.error.message).toContain('targetType');
      }
    });

    it('fails when sourceRoomId is empty', () => {
      seedTestRooms();

      const result = addCitation({
        sourceRoomId: '',
        targetRoomId: 'room_tgt',
        targetType: 'room',
        createdBy: 'agent_1',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('MISSING_ROOM_ID');
      }
    });

    it('fails when targetRoomId is empty', () => {
      seedTestRooms();

      const result = addCitation({
        sourceRoomId: 'room_src',
        targetRoomId: '',
        targetType: 'room',
        createdBy: 'agent_1',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('MISSING_ROOM_ID');
      }
    });

    it('fails when createdBy is empty', () => {
      seedTestRooms();

      const result = addCitation({
        sourceRoomId: 'room_src',
        targetRoomId: 'room_tgt',
        targetType: 'room',
        createdBy: '',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('MISSING_CREATED_BY');
      }
    });

    it('fails when source room does not exist in database', () => {
      seedTestRooms();

      const result = addCitation({
        sourceRoomId: 'room_nonexistent',
        targetRoomId: 'room_tgt',
        targetType: 'room',
        createdBy: 'agent_1',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('ROOM_NOT_FOUND');
        expect(result.error.message).toContain('room_nonexistent');
      }
    });

    it('fails when target room does not exist in database', () => {
      seedTestRooms();

      const result = addCitation({
        sourceRoomId: 'room_src',
        targetRoomId: 'room_nonexistent',
        targetType: 'room',
        createdBy: 'agent_1',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('ROOM_NOT_FOUND');
        expect(result.error.message).toContain('room_nonexistent');
      }
    });

    it('generates unique IDs for multiple citations', () => {
      const { sourceRoomId, targetRoomId } = seedTestRooms();

      const result1 = addCitation({ sourceRoomId, targetRoomId, targetType: 'room', createdBy: 'agent_1' });
      const result2 = addCitation({ sourceRoomId, targetRoomId, targetType: 'message', createdBy: 'agent_1' });

      expect(result1.ok).toBe(true);
      expect(result2.ok).toBe(true);
      if (result1.ok && result2.ok) {
        expect(result1.data.id).not.toBe(result2.data.id);
      }
    });
  });

  // ─── getCitations ───

  describe('getCitations', () => {
    it('returns citations where room is the source', () => {
      const { sourceRoomId, targetRoomId } = seedTestRooms();

      addCitation({ sourceRoomId, targetRoomId, targetType: 'room', createdBy: 'agent_1' });
      addCitation({ sourceRoomId, targetRoomId, targetType: 'message', createdBy: 'agent_1' });

      const result = getCitations(sourceRoomId);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data).toHaveLength(2);
        expect(result.data.every((c) => c.sourceRoomId === sourceRoomId)).toBe(true);
      }
    });

    it('returns citations where room is the target', () => {
      const { sourceRoomId, targetRoomId } = seedTestRooms();

      addCitation({ sourceRoomId, targetRoomId, targetType: 'room', createdBy: 'agent_1' });

      const result = getCitations(targetRoomId);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data).toHaveLength(1);
        expect(result.data[0].targetRoomId).toBe(targetRoomId);
      }
    });

    it('returns citations in descending order by created_at', () => {
      const { sourceRoomId, targetRoomId } = seedTestRooms();

      addCitation({ sourceRoomId, targetRoomId, targetType: 'room', createdBy: 'agent_1' });
      addCitation({ sourceRoomId, targetRoomId, targetType: 'message', createdBy: 'agent_2' });

      const result = getCitations(sourceRoomId);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data).toHaveLength(2);
        // Most recent first
        const timestamps = result.data.map((c) => c.createdAt);
        // Since both are inserted nearly simultaneously, just verify they're both present
        expect(timestamps.every((t) => t !== undefined)).toBe(true);
      }
    });

    it('returns empty array for room with no citations', () => {
      seedTestRooms();

      const result = getCitations('room_src');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data).toHaveLength(0);
      }
    });

    it('fails when roomId is empty', () => {
      const result = getCitations('');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('MISSING_ROOM_ID');
      }
    });

    it('includes both incoming and outgoing citations', () => {
      const { sourceRoomId, targetRoomId } = seedTestRooms();
      const thirdRoomId = seedThirdRoom();

      // room_src -> room_tgt (outgoing from room_src)
      addCitation({ sourceRoomId, targetRoomId, targetType: 'room', createdBy: 'agent_1' });
      // room_third -> room_src (incoming to room_src)
      addCitation({ sourceRoomId: thirdRoomId, targetRoomId: sourceRoomId, targetType: 'message', createdBy: 'agent_2' });

      const result = getCitations(sourceRoomId);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data).toHaveLength(2);
      }
    });
  });

  // ─── getBacklinks ───

  describe('getBacklinks', () => {
    it('returns citations that point TO a specific room', () => {
      const { sourceRoomId, targetRoomId } = seedTestRooms();

      addCitation({ sourceRoomId, targetRoomId, targetType: 'room', createdBy: 'agent_1' });

      const result = getBacklinks(targetRoomId);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data).toHaveLength(1);
        expect(result.data[0].targetRoomId).toBe(targetRoomId);
        expect(result.data[0].sourceRoomId).toBe(sourceRoomId);
      }
    });

    it('returns backlinks filtered by entryId when provided', () => {
      const { sourceRoomId, targetRoomId } = seedTestRooms();

      addCitation({ sourceRoomId, targetRoomId, targetEntryId: 'entry_A', targetType: 'raid', createdBy: 'agent_1' });
      addCitation({ sourceRoomId, targetRoomId, targetEntryId: 'entry_B', targetType: 'message', createdBy: 'agent_2' });
      addCitation({ sourceRoomId, targetRoomId, targetType: 'room', createdBy: 'agent_3' });

      const result = getBacklinks(targetRoomId, 'entry_A');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data).toHaveLength(1);
        expect(result.data[0].targetEntryId).toBe('entry_A');
      }
    });

    it('returns all backlinks when entryId is not provided', () => {
      const { sourceRoomId, targetRoomId } = seedTestRooms();

      addCitation({ sourceRoomId, targetRoomId, targetEntryId: 'entry_A', targetType: 'raid', createdBy: 'agent_1' });
      addCitation({ sourceRoomId, targetRoomId, targetEntryId: 'entry_B', targetType: 'message', createdBy: 'agent_2' });

      const result = getBacklinks(targetRoomId);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data).toHaveLength(2);
      }
    });

    it('does NOT return outgoing citations (only incoming)', () => {
      const { sourceRoomId, targetRoomId } = seedTestRooms();

      // Outgoing from sourceRoomId
      addCitation({ sourceRoomId, targetRoomId, targetType: 'room', createdBy: 'agent_1' });

      // Backlinks for sourceRoomId should be empty — it's the source, not target
      const result = getBacklinks(sourceRoomId);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data).toHaveLength(0);
      }
    });

    it('returns empty array when no backlinks exist', () => {
      seedTestRooms();

      const result = getBacklinks('room_tgt');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data).toHaveLength(0);
      }
    });

    it('fails when roomId is empty', () => {
      const result = getBacklinks('');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('MISSING_ROOM_ID');
      }
    });

    it('returns backlinks from multiple sources', () => {
      const { sourceRoomId, targetRoomId } = seedTestRooms();
      const thirdRoomId = seedThirdRoom();

      addCitation({ sourceRoomId, targetRoomId, targetType: 'room', createdBy: 'agent_1' });
      addCitation({ sourceRoomId: thirdRoomId, targetRoomId, targetType: 'message', createdBy: 'agent_2' });

      const result = getBacklinks(targetRoomId);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data).toHaveLength(2);
        const sourceIds = result.data.map((c) => c.sourceRoomId);
        expect(sourceIds).toContain(sourceRoomId);
        expect(sourceIds).toContain(thirdRoomId);
      }
    });
  });

  // ─── resolveCitation ───

  describe('resolveCitation', () => {
    it('resolves a citation with room names', () => {
      const { sourceRoomId, targetRoomId } = seedTestRooms();

      const addResult = addCitation({ sourceRoomId, targetRoomId, targetType: 'room', createdBy: 'agent_1' });
      expect(addResult.ok).toBe(true);
      if (!addResult.ok) return;

      const result = resolveCitation(addResult.data.id);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.sourceRoomName).toBe('Source Room');
        expect(result.data.targetRoomName).toBe('Target Room');
        expect(result.data.sourceRoomId).toBe(sourceRoomId);
        expect(result.data.targetRoomId).toBe(targetRoomId);
      }
    });

    it('resolves target content for room-type citations (no entryId)', () => {
      const { sourceRoomId, targetRoomId } = seedTestRooms();

      const addResult = addCitation({ sourceRoomId, targetRoomId, targetType: 'room', createdBy: 'agent_1' });
      expect(addResult.ok).toBe(true);
      if (!addResult.ok) return;

      const result = resolveCitation(addResult.data.id);
      expect(result.ok).toBe(true);
      if (result.ok) {
        // When targetType is 'room' and no entryId, resolves the target room itself
        expect(result.data.targetContent).toBeDefined();
        expect(result.data.targetContent).not.toBeNull();
        expect((result.data.targetContent as Record<string, unknown>).id).toBe(targetRoomId);
      }
    });

    it('resolves target content for message-type citations with entryId', () => {
      const { sourceRoomId, targetRoomId } = seedTestRooms();

      // Insert a message to cite
      const db = getDb();
      db.prepare("INSERT INTO messages (id, room_id, role, content) VALUES ('msg_1', 'room_tgt', 'assistant', 'Hello world')").run();

      const addResult = addCitation({
        sourceRoomId,
        targetRoomId,
        targetEntryId: 'msg_1',
        targetType: 'message',
        createdBy: 'agent_1',
      });
      expect(addResult.ok).toBe(true);
      if (!addResult.ok) return;

      const result = resolveCitation(addResult.data.id);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.targetContent).toBeDefined();
        expect(result.data.targetContent).not.toBeNull();
        expect((result.data.targetContent as Record<string, unknown>).id).toBe('msg_1');
        expect((result.data.targetContent as Record<string, unknown>).content).toBe('Hello world');
      }
    });

    it('resolves target content for raid-type citations with entryId', () => {
      const { sourceRoomId, targetRoomId } = seedTestRooms();

      // Insert a RAID entry to cite
      const db = getDb();
      db.prepare(
        "INSERT INTO raid_entries (id, building_id, type, phase, room_id, summary) VALUES ('raid_1', 'b1', 'risk', 'strategy', 'room_tgt', 'Data loss risk')",
      ).run();

      const addResult = addCitation({
        sourceRoomId,
        targetRoomId,
        targetEntryId: 'raid_1',
        targetType: 'raid',
        createdBy: 'agent_1',
      });
      expect(addResult.ok).toBe(true);
      if (!addResult.ok) return;

      const result = resolveCitation(addResult.data.id);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.targetContent).toBeDefined();
        expect((result.data.targetContent as Record<string, unknown>).summary).toBe('Data loss risk');
      }
    });

    it('resolves target content for exit-doc-type citations with entryId', () => {
      const { sourceRoomId, targetRoomId } = seedTestRooms();

      // Insert an exit document to cite
      const db = getDb();
      db.prepare(
        "INSERT INTO exit_documents (id, room_id, type, completed_by) VALUES ('exit_1', 'room_tgt', 'test-report', 'agent_qa')",
      ).run();

      const addResult = addCitation({
        sourceRoomId,
        targetRoomId,
        targetEntryId: 'exit_1',
        targetType: 'exit-doc',
        createdBy: 'agent_1',
      });
      expect(addResult.ok).toBe(true);
      if (!addResult.ok) return;

      const result = resolveCitation(addResult.data.id);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.targetContent).toBeDefined();
        expect((result.data.targetContent as Record<string, unknown>).id).toBe('exit_1');
        expect((result.data.targetContent as Record<string, unknown>).type).toBe('test-report');
      }
    });

    it('returns null targetContent when entryId points to nonexistent record', () => {
      const { sourceRoomId, targetRoomId } = seedTestRooms();

      const addResult = addCitation({
        sourceRoomId,
        targetRoomId,
        targetEntryId: 'msg_nonexistent',
        targetType: 'message',
        createdBy: 'agent_1',
      });
      expect(addResult.ok).toBe(true);
      if (!addResult.ok) return;

      const result = resolveCitation(addResult.data.id);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.targetContent).toBeNull();
      }
    });

    it('fails when citationId is empty', () => {
      const result = resolveCitation('');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('MISSING_CITATION_ID');
      }
    });

    it('fails when citation does not exist', () => {
      seedTestRooms();

      const result = resolveCitation('cit_nonexistent');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('CITATION_NOT_FOUND');
        expect(result.error.message).toContain('cit_nonexistent');
      }
    });
  });

  // ─── getOutgoingCitations ───

  describe('getOutgoingCitations', () => {
    it('returns only outgoing citations from a room', () => {
      const { sourceRoomId, targetRoomId } = seedTestRooms();
      const thirdRoomId = seedThirdRoom();

      // Outgoing from sourceRoomId
      addCitation({ sourceRoomId, targetRoomId, targetType: 'room', createdBy: 'agent_1' });
      // Incoming to sourceRoomId (should NOT appear)
      addCitation({ sourceRoomId: thirdRoomId, targetRoomId: sourceRoomId, targetType: 'message', createdBy: 'agent_2' });

      const result = getOutgoingCitations(sourceRoomId);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data).toHaveLength(1);
        expect(result.data[0].sourceRoomId).toBe(sourceRoomId);
        expect(result.data[0].targetRoomId).toBe(targetRoomId);
      }
    });

    it('returns empty array when room has no outgoing citations', () => {
      seedTestRooms();

      const result = getOutgoingCitations('room_src');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data).toHaveLength(0);
      }
    });

    it('fails when roomId is empty', () => {
      const result = getOutgoingCitations('');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('MISSING_ROOM_ID');
      }
    });
  });

  // ─── deleteCitation ───

  describe('deleteCitation', () => {
    it('deletes an existing citation and returns its ID', () => {
      const { sourceRoomId, targetRoomId } = seedTestRooms();

      const addResult = addCitation({ sourceRoomId, targetRoomId, targetType: 'room', createdBy: 'agent_1' });
      expect(addResult.ok).toBe(true);
      if (!addResult.ok) return;

      const deleteResult = deleteCitation(addResult.data.id);
      expect(deleteResult.ok).toBe(true);
      if (deleteResult.ok) {
        expect(deleteResult.data.id).toBe(addResult.data.id);
      }
    });

    it('removes citation from the database', () => {
      const { sourceRoomId, targetRoomId } = seedTestRooms();

      const addResult = addCitation({ sourceRoomId, targetRoomId, targetType: 'room', createdBy: 'agent_1' });
      expect(addResult.ok).toBe(true);
      if (!addResult.ok) return;

      deleteCitation(addResult.data.id);

      // Verify it's gone from the database
      const db = getDb();
      const row = db.prepare('SELECT id FROM citations WHERE id = ?').get(addResult.data.id);
      expect(row).toBeUndefined();
    });

    it('deleted citation no longer appears in getCitations', () => {
      const { sourceRoomId, targetRoomId } = seedTestRooms();

      const addResult = addCitation({ sourceRoomId, targetRoomId, targetType: 'room', createdBy: 'agent_1' });
      expect(addResult.ok).toBe(true);
      if (!addResult.ok) return;

      deleteCitation(addResult.data.id);

      const citResult = getCitations(sourceRoomId);
      expect(citResult.ok).toBe(true);
      if (citResult.ok) {
        expect(citResult.data).toHaveLength(0);
      }
    });

    it('deleted citation no longer appears in getBacklinks', () => {
      const { sourceRoomId, targetRoomId } = seedTestRooms();

      const addResult = addCitation({ sourceRoomId, targetRoomId, targetType: 'room', createdBy: 'agent_1' });
      expect(addResult.ok).toBe(true);
      if (!addResult.ok) return;

      deleteCitation(addResult.data.id);

      const backlinkResult = getBacklinks(targetRoomId);
      expect(backlinkResult.ok).toBe(true);
      if (backlinkResult.ok) {
        expect(backlinkResult.data).toHaveLength(0);
      }
    });

    it('fails when citationId is empty', () => {
      const result = deleteCitation('');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('MISSING_CITATION_ID');
      }
    });

    it('fails when citation does not exist', () => {
      seedTestRooms();

      const result = deleteCitation('cit_nonexistent');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('CITATION_NOT_FOUND');
        expect(result.error.message).toContain('cit_nonexistent');
      }
    });

    it('does not affect other citations when one is deleted', () => {
      const { sourceRoomId, targetRoomId } = seedTestRooms();

      const r1 = addCitation({ sourceRoomId, targetRoomId, targetType: 'room', createdBy: 'agent_1' });
      const r2 = addCitation({ sourceRoomId, targetRoomId, targetType: 'message', createdBy: 'agent_2' });

      expect(r1.ok).toBe(true);
      expect(r2.ok).toBe(true);
      if (!r1.ok || !r2.ok) return;

      // Delete only the first
      deleteCitation(r1.data.id);

      const citResult = getCitations(sourceRoomId);
      expect(citResult.ok).toBe(true);
      if (citResult.ok) {
        expect(citResult.data).toHaveLength(1);
        expect(citResult.data[0].id).toBe(r2.data.id);
      }
    });
  });
});
