/**
 * Storage Layer Tests
 *
 * Tests initStorage creates all 22 tables, 45 indexes,
 * enables WAL mode and foreign keys.
 * Uses a temp directory — cleaned up after each test.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// We need to test initStorage and getDb
import { initStorage, getDb } from '../../../src/storage/db.js';
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

describe('Storage Layer', () => {
  beforeEach(() => {
    // Create a unique temp directory for each test
    testDir = join(tmpdir(), `overlord-test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
    mkdirSync(testDir, { recursive: true });
    testDbPath = join(testDir, 'test.db');
  });

  afterEach(() => {
    // Clean up temp directory
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('initStorage', () => {
    it('creates the database file', async () => {
      const cfg = createMockConfig(testDbPath);
      await initStorage(cfg);

      expect(existsSync(testDbPath)).toBe(true);
    });

    it('creates parent directory if it does not exist', async () => {
      const nestedPath = join(testDir, 'nested', 'deep', 'test.db');
      const cfg = createMockConfig(nestedPath);
      await initStorage(cfg);

      expect(existsSync(nestedPath)).toBe(true);
    });

    it('returns the database instance', async () => {
      const cfg = createMockConfig(testDbPath);
      const db = await initStorage(cfg);

      expect(db).toBeDefined();
      expect(typeof db.prepare).toBe('function');
    });

    it('enables WAL journal mode', async () => {
      const cfg = createMockConfig(testDbPath);
      const db = await initStorage(cfg);

      const result = db.pragma('journal_mode') as { journal_mode: string }[];
      expect(result[0].journal_mode).toBe('wal');
    });

    it('enables foreign keys', async () => {
      const cfg = createMockConfig(testDbPath);
      const db = await initStorage(cfg);

      const result = db.pragma('foreign_keys') as { foreign_keys: number }[];
      expect(result[0].foreign_keys).toBe(1);
    });
  });

  describe('schema — all 30 tables', () => {
    const expectedTables = [
      'buildings',
      'floors',
      'rooms',
      'tables_v2',
      'agents',
      'messages',
      'plans',
      'tasks',
      'todos',
      'milestones',
      'exit_documents',
      'phase_gates',
      'raid_entries',
      'notes',
      'agent_sessions',
      'citations',
      'agent_activity_log',
      'agent_stats',
      'visual_tests',
      'agent_emails',
      'agent_email_recipients',
      'migrations',
      'pipeline_evidence',
      'project_repos',
      'repo_file_origins',
      'doc_libraries',
      'doc_entries',
      'doc_entries_fts',
      'doc_toc',
      'merge_queue',
    ];

    it('creates all 29 tables (plus FTS5 shadow tables)', async () => {
      const cfg = createMockConfig(testDbPath);
      const db = await initStorage(cfg);

      // Exclude FTS5 shadow tables (data, idx, content, docsize, config) but include core tables
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'doc_entries_fts_%' ORDER BY name")
        .all() as { name: string }[];

      const tableNames = tables.map((t) => t.name).sort();
      expect(tableNames).toEqual(expectedTables.sort());
      expect(tableNames).toHaveLength(30);
    });

    it.each(expectedTables)('creates table: %s', async (tableName) => {
      const cfg = createMockConfig(testDbPath);
      const db = await initStorage(cfg);

      const table = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
        .get(tableName) as { name: string } | undefined;

      expect(table).toBeDefined();
      expect(table!.name).toBe(tableName);
    });
  });

  describe('schema — buildings table columns', () => {
    it('has all required columns', async () => {
      const cfg = createMockConfig(testDbPath);
      const db = await initStorage(cfg);

      const columns = db.pragma('table_info(buildings)') as { name: string; type: string; notnull: number }[];
      const columnNames = columns.map((c) => c.name);

      expect(columnNames).toContain('id');
      expect(columnNames).toContain('project_id');
      expect(columnNames).toContain('name');
      expect(columnNames).toContain('config');
      expect(columnNames).toContain('active_phase');
      expect(columnNames).toContain('created_at');
      expect(columnNames).toContain('updated_at');
    });
  });

  describe('schema — agents table columns', () => {
    it('has all required columns', async () => {
      const cfg = createMockConfig(testDbPath);
      const db = await initStorage(cfg);

      const columns = db.pragma('table_info(agents)') as { name: string }[];
      const columnNames = columns.map((c) => c.name);

      expect(columnNames).toContain('id');
      expect(columnNames).toContain('name');
      expect(columnNames).toContain('role');
      expect(columnNames).toContain('building_id');
      expect(columnNames).toContain('capabilities');
      expect(columnNames).toContain('room_access');
      expect(columnNames).toContain('badge');
      expect(columnNames).toContain('status');
      expect(columnNames).toContain('current_room_id');
      expect(columnNames).toContain('current_table_id');
      expect(columnNames).toContain('config');
    });
  });

  describe('schema — raid_entries table constraints', () => {
    it('enforces RAID type CHECK constraint', async () => {
      const cfg = createMockConfig(testDbPath);
      const db = await initStorage(cfg);

      // Create parent building for FK
      db.prepare("INSERT INTO buildings (id, name) VALUES ('b1', 'Test')").run();

      // Valid type should work
      expect(() => {
        db.prepare("INSERT INTO raid_entries (id, building_id, type, phase, summary) VALUES ('r1', 'b1', 'risk', 'strategy', 'test')").run();
      }).not.toThrow();

      // Invalid type should fail
      expect(() => {
        db.prepare("INSERT INTO raid_entries (id, building_id, type, phase, summary) VALUES ('r2', 'b1', 'invalid', 'strategy', 'test')").run();
      }).toThrow();
    });

    it('enforces RAID status CHECK constraint', async () => {
      const cfg = createMockConfig(testDbPath);
      const db = await initStorage(cfg);

      // Create parent building for FK
      db.prepare("INSERT INTO buildings (id, name) VALUES ('b1', 'Test')").run();

      // Valid status should work
      db.prepare("INSERT INTO raid_entries (id, building_id, type, phase, summary, status) VALUES ('r3', 'b1', 'decision', 'strategy', 'test', 'active')").run();

      // Invalid status should fail
      expect(() => {
        db.prepare("INSERT INTO raid_entries (id, building_id, type, phase, summary, status) VALUES ('r4', 'b1', 'decision', 'strategy', 'test', 'invalid')").run();
      }).toThrow();
    });
  });

  describe('schema — all 59 indexes', () => {
    const expectedIndexes = [
      'idx_rooms_floor',
      'idx_rooms_type',
      'idx_messages_room',
      'idx_messages_thread',
      'idx_agents_room',
      'idx_agents_building',
      'idx_tasks_building',
      'idx_todos_task',
      'idx_todos_agent',
      'idx_tasks_table',
      'idx_tasks_room',
      'idx_milestones_building',
      'idx_tasks_milestone',
      'idx_raid_building',
      'idx_raid_phase',
      'idx_raid_type',
      'idx_exit_docs_room',
      'idx_phase_gates_building',
      'idx_notes_agent',
      'idx_sessions_agent',
      'idx_sessions_room',
      'idx_citations_source',
      'idx_citations_target',
      'idx_citations_type',
      'idx_activity_agent',
      'idx_activity_type',
      'idx_activity_created',
      'idx_activity_room',
      'idx_activity_building',
      'idx_stats_agent',
      'idx_stats_metric',
      'idx_stats_compound',
      'idx_plans_building',
      'idx_plans_agent',
      'idx_plans_thread',
      'idx_plans_status',
      'idx_emails_thread',
      'idx_emails_from',
      'idx_emails_building',
      'idx_emails_status',
      'idx_emails_priority',
      'idx_email_recipients_email',
      'idx_email_recipients_agent',
      'idx_email_recipients_unread',
      'idx_pipeline_task',
      'idx_pipeline_building',
      'idx_pipeline_stage',
      'idx_project_repos_building',
      'idx_project_repos_relationship',
      'idx_file_origins_building',
      'idx_file_origins_repo',
      'idx_file_origins_path',
      'idx_doc_libraries_building',
      'idx_doc_entries_library',
      'idx_doc_entries_path',
      'idx_doc_toc_entry',
      'idx_merge_queue_building',
      'idx_merge_queue_status',
      'idx_merge_queue_position',
    ];

    it('creates all 59 custom indexes', async () => {
      const cfg = createMockConfig(testDbPath);
      const db = await initStorage(cfg);

      const indexes = db
        .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%' ORDER BY name")
        .all() as { name: string }[];

      const indexNames = indexes.map((i) => i.name).sort();
      expect(indexNames).toEqual(expectedIndexes.sort());
      expect(indexNames).toHaveLength(59);
    });

    it.each(expectedIndexes)('creates index: %s', async (indexName) => {
      const cfg = createMockConfig(testDbPath);
      const db = await initStorage(cfg);

      const index = db
        .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name=?")
        .get(indexName) as { name: string } | undefined;

      expect(index).toBeDefined();
    });
  });

  describe('schema — idempotent initialization', () => {
    it('can be called twice without error', async () => {
      const cfg = createMockConfig(testDbPath);
      await initStorage(cfg);
      // Second call should not throw (CREATE TABLE IF NOT EXISTS)
      await expect(initStorage(cfg)).resolves.toBeDefined();
    });
  });

  describe('getDb', () => {
    it('returns the initialized database', async () => {
      const cfg = createMockConfig(testDbPath);
      await initStorage(cfg);

      const db = getDb();
      expect(db).toBeDefined();
      expect(typeof db.prepare).toBe('function');
    });

    it('can execute queries after init', async () => {
      const cfg = createMockConfig(testDbPath);
      await initStorage(cfg);

      const db = getDb();
      const tables = db
        .prepare("SELECT count(*) as cnt FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
        .get() as { cnt: number };

      // 29 regular tables + FTS5 shadow tables (doc_entries_fts + 5 shadow tables)
      expect(tables.cnt).toBe(34);
    });
  });

  describe('default values', () => {
    it('buildings.active_phase defaults to strategy', async () => {
      const cfg = createMockConfig(testDbPath);
      const db = await initStorage(cfg);

      db.prepare("INSERT INTO buildings (id, name) VALUES ('b1', 'Test')").run();
      const row = db.prepare('SELECT active_phase FROM buildings WHERE id = ?').get('b1') as { active_phase: string };
      expect(row.active_phase).toBe('strategy');
    });

    it('agents.status defaults to idle', async () => {
      const cfg = createMockConfig(testDbPath);
      const db = await initStorage(cfg);

      db.prepare("INSERT INTO agents (id, name, role) VALUES ('a1', 'Test Agent', 'tester')").run();
      const row = db.prepare('SELECT status FROM agents WHERE id = ?').get('a1') as { status: string };
      expect(row.status).toBe('idle');
    });

    it('rooms.status defaults to idle', async () => {
      const cfg = createMockConfig(testDbPath);
      const db = await initStorage(cfg);

      // Create parent floor + building for FK
      db.prepare("INSERT INTO buildings (id, name) VALUES ('b1', 'Test')").run();
      db.prepare("INSERT INTO floors (id, building_id, type, name) VALUES ('f1', 'b1', 'execution', 'Exec Floor')").run();
      db.prepare("INSERT INTO rooms (id, floor_id, type, name) VALUES ('r1', 'f1', 'testing-lab', 'Lab')").run();
      const row = db.prepare('SELECT status, file_scope, provider FROM rooms WHERE id = ?').get('r1') as {
        status: string;
        file_scope: string;
        provider: string;
      };
      expect(row.status).toBe('idle');
      expect(row.file_scope).toBe('assigned');
      expect(row.provider).toBe('configurable');
    });

    it('phase_gates.status defaults to pending', async () => {
      const cfg = createMockConfig(testDbPath);
      const db = await initStorage(cfg);

      // Create parent building for FK
      db.prepare("INSERT INTO buildings (id, name) VALUES ('b1', 'Test')").run();
      db.prepare("INSERT INTO phase_gates (id, building_id, phase) VALUES ('g1', 'b1', 'strategy')").run();
      const row = db.prepare('SELECT status FROM phase_gates WHERE id = ?').get('g1') as { status: string };
      expect(row.status).toBe('pending');
    });

    it('raid_entries.status defaults to active', async () => {
      const cfg = createMockConfig(testDbPath);
      const db = await initStorage(cfg);

      // Create parent building for FK
      db.prepare("INSERT INTO buildings (id, name) VALUES ('b1', 'Test')").run();
      db.prepare("INSERT INTO raid_entries (id, building_id, type, phase, summary) VALUES ('r1', 'b1', 'risk', 'strategy', 'Test risk')").run();
      const row = db.prepare('SELECT status FROM raid_entries WHERE id = ?').get('r1') as { status: string };
      expect(row.status).toBe('active');
    });
  });
});
