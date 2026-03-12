/**
 * RAID Log Tests
 *
 * Tests the Risks, Assumptions, Issues, Decisions log system.
 * Uses in-memory SQLite — no disk IO.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { addRaidEntry, searchRaid, buildContextBrief, updateRaidEntry, updateRaidStatus } from '../../../src/rooms/raid-log.js';

// Patch getDb to use in-memory database
import * as dbModule from '../../../src/storage/db.js';
import { vi } from 'vitest';

let db: Database.Database;

function setupDb(): Database.Database {
  const memDb = new Database(':memory:');
  memDb.pragma('foreign_keys = OFF');
  // Note: Database.prototype.exec() is SQLite's SQL execution method,
  // not Node's child_process exec — no shell injection risk.
  memDb.exec(`
    CREATE TABLE buildings (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      name TEXT NOT NULL,
      config TEXT DEFAULT '{}',
      active_phase TEXT DEFAULT 'strategy',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE raid_entries (
      id TEXT PRIMARY KEY,
      building_id TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('risk', 'assumption', 'issue', 'decision')),
      phase TEXT NOT NULL,
      room_id TEXT,
      summary TEXT NOT NULL,
      rationale TEXT,
      decided_by TEXT,
      approved_by TEXT,
      affected_areas TEXT DEFAULT '[]',
      status TEXT DEFAULT 'active' CHECK(status IN ('active', 'superseded', 'closed')),
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `);
  return memDb;
}

describe('RAID Log', () => {
  beforeEach(() => {
    db = setupDb();
    vi.spyOn(dbModule, 'getDb').mockReturnValue(db as unknown as ReturnType<typeof dbModule.getDb>);

    // Seed a building
    db.prepare(`INSERT INTO buildings (id, name) VALUES ('bld_1', 'Test Project')`).run();
  });

  describe('addRaidEntry', () => {
    it('adds a decision entry', () => {
      const result = addRaidEntry({
        buildingId: 'bld_1',
        type: 'decision',
        phase: 'strategy',
        summary: 'Use TypeScript for all modules',
        rationale: 'Type safety reduces runtime errors',
        decidedBy: 'architect',
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.id).toMatch(/^raid_/);
      }
    });

    it('adds a risk entry with affected areas', () => {
      const result = addRaidEntry({
        buildingId: 'bld_1',
        type: 'risk',
        phase: 'discovery',
        summary: 'Third-party API may have rate limits',
        affectedAreas: ['api-layer', 'auth-module'],
      });
      expect(result.ok).toBe(true);

      const row = db.prepare('SELECT affected_areas FROM raid_entries WHERE building_id = ?').get('bld_1') as { affected_areas: string };
      expect(JSON.parse(row.affected_areas)).toEqual(['api-layer', 'auth-module']);
    });

    it('adds an assumption entry', () => {
      const result = addRaidEntry({
        buildingId: 'bld_1',
        type: 'assumption',
        phase: 'architecture',
        summary: 'Users will have stable internet connection',
      });
      expect(result.ok).toBe(true);
    });

    it('adds an issue entry with room context', () => {
      const result = addRaidEntry({
        buildingId: 'bld_1',
        type: 'issue',
        phase: 'execution',
        roomId: 'room_code_lab',
        summary: 'Memory leak in websocket handler',
        rationale: 'Detected during load testing',
      });
      expect(result.ok).toBe(true);

      const row = db.prepare('SELECT room_id FROM raid_entries WHERE building_id = ?').get('bld_1') as { room_id: string };
      expect(row.room_id).toBe('room_code_lab');
    });
  });

  describe('searchRaid', () => {
    beforeEach(() => {
      // Seed multiple entries
      addRaidEntry({ buildingId: 'bld_1', type: 'decision', phase: 'strategy', summary: 'Use SQLite for storage' });
      addRaidEntry({ buildingId: 'bld_1', type: 'risk', phase: 'strategy', summary: 'SQLite may not scale' });
      addRaidEntry({ buildingId: 'bld_1', type: 'decision', phase: 'discovery', summary: 'REST API over GraphQL' });
      addRaidEntry({ buildingId: 'bld_1', type: 'issue', phase: 'execution', summary: 'Auth token expiry bug' });
    });

    it('returns all entries for a building', () => {
      const result = searchRaid({ buildingId: 'bld_1' });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data).toHaveLength(4);
      }
    });

    it('filters by type', () => {
      const result = searchRaid({ buildingId: 'bld_1', type: 'decision' });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data).toHaveLength(2);
        expect(result.data.every((e: { type: string }) => e.type === 'decision')).toBe(true);
      }
    });

    it('filters by phase', () => {
      const result = searchRaid({ buildingId: 'bld_1', phase: 'strategy' });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data).toHaveLength(2);
      }
    });

    it('filters by keyword query', () => {
      const result = searchRaid({ buildingId: 'bld_1', query: 'SQLite' });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data).toHaveLength(2);
      }
    });

    it('combines filters', () => {
      const result = searchRaid({ buildingId: 'bld_1', type: 'decision', phase: 'strategy' });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data).toHaveLength(1);
        expect(result.data[0].summary).toBe('Use SQLite for storage');
      }
    });

    it('returns empty for non-matching query', () => {
      const result = searchRaid({ buildingId: 'bld_1', query: 'nonexistent' });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data).toHaveLength(0);
      }
    });

    it('parses affected_areas JSON', () => {
      addRaidEntry({
        buildingId: 'bld_1',
        type: 'risk',
        phase: 'architecture',
        summary: 'Scalability concern',
        affectedAreas: ['database', 'cache'],
      });

      const result = searchRaid({ buildingId: 'bld_1', type: 'risk', phase: 'architecture' });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data[0].affected_areas).toEqual(['database', 'cache']);
      }
    });
  });

  describe('buildContextBrief', () => {
    it('builds brief from active entries', () => {
      addRaidEntry({ buildingId: 'bld_1', type: 'decision', phase: 'strategy', summary: 'Use TS' });
      addRaidEntry({ buildingId: 'bld_1', type: 'risk', phase: 'strategy', summary: 'Tight deadline' });
      addRaidEntry({ buildingId: 'bld_1', type: 'assumption', phase: 'discovery', summary: 'Team knows TS' });
      addRaidEntry({ buildingId: 'bld_1', type: 'issue', phase: 'execution', summary: 'Flaky CI' });

      const result = buildContextBrief('bld_1');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.decisions).toHaveLength(1);
        expect(result.data.risks).toHaveLength(1);
        expect(result.data.assumptions).toHaveLength(1);
        expect(result.data.issues).toHaveLength(1);
        expect(result.data.summary).toContain('4 active RAID entries');
      }
    });

    it('excludes non-active entries', () => {
      addRaidEntry({ buildingId: 'bld_1', type: 'decision', phase: 'strategy', summary: 'Active decision' });
      addRaidEntry({ buildingId: 'bld_1', type: 'decision', phase: 'strategy', summary: 'Old decision' });

      // Mark one as superseded
      const rows = db.prepare('SELECT id FROM raid_entries').all() as { id: string }[];
      db.prepare('UPDATE raid_entries SET status = ? WHERE id = ?').run('superseded', rows[1].id);

      const result = buildContextBrief('bld_1');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.decisions).toHaveLength(1);
        expect(result.data.summary).toContain('1 active RAID entries');
      }
    });

    it('returns empty brief for building with no entries', () => {
      const result = buildContextBrief('bld_1');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.decisions).toHaveLength(0);
        expect(result.data.risks).toHaveLength(0);
        expect(result.data.assumptions).toHaveLength(0);
        expect(result.data.issues).toHaveLength(0);
        expect(result.data.summary).toContain('0 active RAID entries');
      }
    });
  });

  describe('updateRaidEntry', () => {
    it('updates summary and rationale', () => {
      const entry = addRaidEntry({ buildingId: 'bld_1', type: 'risk', phase: 'strategy', summary: 'Old summary', rationale: 'Old rationale' });
      if (!entry.ok) throw new Error('failed');

      const result = updateRaidEntry({ id: entry.data.id, summary: 'New summary', rationale: 'New rationale' });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.summary).toBe('New summary');
        expect(result.data.rationale).toBe('New rationale');
      }
    });

    it('updates decided_by field', () => {
      const entry = addRaidEntry({ buildingId: 'bld_1', type: 'decision', phase: 'strategy', summary: 'Test' });
      if (!entry.ok) throw new Error('failed');

      const result = updateRaidEntry({ id: entry.data.id, decidedBy: 'architect' });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.decided_by).toBe('architect');
      }
    });

    it('updates affected_areas', () => {
      const entry = addRaidEntry({ buildingId: 'bld_1', type: 'risk', phase: 'strategy', summary: 'Test', affectedAreas: ['old'] });
      if (!entry.ok) throw new Error('failed');

      const result = updateRaidEntry({ id: entry.data.id, affectedAreas: ['api', 'auth'] });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.affected_areas).toEqual(['api', 'auth']);
      }
    });

    it('returns error for non-existent entry', () => {
      const result = updateRaidEntry({ id: 'nonexistent', summary: 'Test' });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('RAID_NOT_FOUND');
      }
    });

    it('returns error when no fields to update', () => {
      const entry = addRaidEntry({ buildingId: 'bld_1', type: 'risk', phase: 'strategy', summary: 'Test' });
      if (!entry.ok) throw new Error('failed');

      const result = updateRaidEntry({ id: entry.data.id });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NO_CHANGES');
      }
    });
  });

  describe('updateRaidStatus', () => {
    it('updates entry status to superseded', () => {
      const entry = addRaidEntry({ buildingId: 'bld_1', type: 'decision', phase: 'strategy', summary: 'Old approach' });
      if (!entry.ok) throw new Error('failed');

      const result = updateRaidStatus({ id: entry.data.id, status: 'superseded' });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.status).toBe('superseded');
      }

      const row = db.prepare('SELECT status FROM raid_entries WHERE id = ?').get(entry.data.id) as { status: string };
      expect(row.status).toBe('superseded');
    });

    it('updates entry status to closed', () => {
      const entry = addRaidEntry({ buildingId: 'bld_1', type: 'issue', phase: 'execution', summary: 'Bug fixed' });
      if (!entry.ok) throw new Error('failed');

      const result = updateRaidStatus({ id: entry.data.id, status: 'closed' });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.status).toBe('closed');
      }
    });
  });
});
