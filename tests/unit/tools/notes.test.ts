/**
 * Notes Tool Provider Tests
 *
 * Tests note recording and recall with in-memory SQLite.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { recordNote, recallNotes } from '../../../src/tools/providers/notes.js';

// Patch getDb to use in-memory database
import * as dbModule from '../../../src/storage/db.js';

let db: Database.Database;

function setupDb(): Database.Database {
  const memDb = new Database(':memory:');
  memDb.pragma('foreign_keys = OFF');
  // Note: Database.prototype.exec() is SQLite's SQL execution method,
  // not Node's child_process exec — no shell injection risk.
  memDb.exec(`
    CREATE TABLE notes (
      id TEXT PRIMARY KEY,
      agent_id TEXT,
      room_id TEXT,
      content TEXT NOT NULL,
      tags TEXT DEFAULT '[]',
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);
  return memDb;
}

describe('Notes Tool Provider', () => {
  beforeEach(() => {
    db = setupDb();
    vi.spyOn(dbModule, 'getDb').mockReturnValue(db as unknown as ReturnType<typeof dbModule.getDb>);
  });

  describe('recordNote', () => {
    it('records a note and returns id + content', () => {
      const result = recordNote({ content: 'Test note content' });
      expect(result.id).toMatch(/^note_/);
      expect(result.content).toBe('Test note content');

      // Verify in DB
      const row = db.prepare('SELECT * FROM notes WHERE id = ?').get(result.id) as { content: string };
      expect(row.content).toBe('Test note content');
    });

    it('stores agent_id when provided', () => {
      const result = recordNote({ content: 'Agent note', agentId: 'agent_1' });
      const row = db.prepare('SELECT agent_id FROM notes WHERE id = ?').get(result.id) as { agent_id: string };
      expect(row.agent_id).toBe('agent_1');
    });

    it('stores room_id when provided', () => {
      const result = recordNote({ content: 'Room note', roomId: 'room_1' });
      const row = db.prepare('SELECT room_id FROM notes WHERE id = ?').get(result.id) as { room_id: string };
      expect(row.room_id).toBe('room_1');
    });

    it('stores tags as JSON array', () => {
      const result = recordNote({ content: 'Tagged note', tags: ['important', 'architecture'] });
      const row = db.prepare('SELECT tags FROM notes WHERE id = ?').get(result.id) as { tags: string };
      expect(JSON.parse(row.tags)).toEqual(['important', 'architecture']);
    });

    it('defaults tags to empty array', () => {
      const result = recordNote({ content: 'No tags' });
      const row = db.prepare('SELECT tags FROM notes WHERE id = ?').get(result.id) as { tags: string };
      expect(JSON.parse(row.tags)).toEqual([]);
    });

    it('defaults agent_id and room_id to null', () => {
      const result = recordNote({ content: 'Minimal note' });
      const row = db.prepare('SELECT agent_id, room_id FROM notes WHERE id = ?').get(result.id) as { agent_id: string | null; room_id: string | null };
      expect(row.agent_id).toBeNull();
      expect(row.room_id).toBeNull();
    });
  });

  describe('recallNotes', () => {
    beforeEach(() => {
      // Seed notes
      recordNote({ content: 'Architecture decision: use rooms pattern', tags: ['architecture'], agentId: 'agent_1' });
      recordNote({ content: 'Bug found in auth module', tags: ['bug', 'auth'], agentId: 'agent_2' });
      recordNote({ content: 'Performance baseline recorded', tags: ['perf'], agentId: 'agent_1' });
      recordNote({ content: 'Deployment checklist complete', tags: ['deploy'] });
    });

    it('recalls all notes when no filters given', () => {
      const result = recallNotes({});
      expect(result.length).toBe(4);
    });

    it('filters by agentId', () => {
      const result = recallNotes({ agentId: 'agent_1' });
      expect(result.length).toBe(2);
      expect(result.every((n: { agent_id: string | null }) => n.agent_id === 'agent_1')).toBe(true);
    });

    it('filters by content query', () => {
      const result = recallNotes({ query: 'auth' });
      expect(result.length).toBe(1);
      expect(result[0].content).toContain('auth');
    });

    it('filters by tag', () => {
      const result = recallNotes({ tag: 'architecture' });
      expect(result.length).toBe(1);
      expect(result[0].content).toContain('Architecture');
    });

    it('combines filters (agentId + query)', () => {
      const result = recallNotes({ agentId: 'agent_1', query: 'Architecture' });
      expect(result.length).toBe(1);
    });

    it('respects limit parameter', () => {
      const result = recallNotes({ limit: 2 });
      expect(result.length).toBe(2);
    });

    it('defaults to 10 results max', () => {
      // Add more notes
      for (let i = 0; i < 15; i++) {
        recordNote({ content: `Bulk note ${i}` });
      }
      const result = recallNotes({});
      expect(result.length).toBe(10);
    });

    it('returns empty array when no matches', () => {
      const result = recallNotes({ query: 'nonexistent' });
      expect(result.length).toBe(0);
    });

    it('orders by created_at descending', () => {
      // Insert a note with an explicit later timestamp
      db.prepare(
        "INSERT INTO notes (id, content, tags, created_at) VALUES (?, ?, '[]', datetime('now', '+1 minute'))",
      ).run('note_latest', 'Latest inserted note');

      const result = recallNotes({});
      // The note with the latest created_at should appear first
      expect(result[0].content).toBe('Latest inserted note');
    });
  });
});
