/**
 * Global Search Tests
 *
 * Tests the globalSearch() function which queries across all entity types
 * (tasks, agents, RAID entries, rooms, milestones, messages).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { globalSearch } from '../../../src/storage/global-search.js';

// ─── In-memory DB setup ───

let db: InstanceType<typeof Database>;

function setupDb() {
  db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE buildings (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      name TEXT NOT NULL,
      active_phase TEXT DEFAULT 'strategy',
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE floors (
      id TEXT PRIMARY KEY,
      building_id TEXT NOT NULL REFERENCES buildings(id),
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      sort_order INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE rooms (
      id TEXT PRIMARY KEY,
      floor_id TEXT NOT NULL REFERENCES floors(id),
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      status TEXT DEFAULT 'idle',
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE agents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'assistant',
      display_name TEXT,
      specialization TEXT,
      bio TEXT,
      photo_url TEXT,
      status TEXT DEFAULT 'idle',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE tasks (
      id TEXT PRIMARY KEY,
      building_id TEXT NOT NULL REFERENCES buildings(id),
      title TEXT NOT NULL,
      description TEXT,
      status TEXT DEFAULT 'pending',
      priority TEXT DEFAULT 'normal',
      phase TEXT,
      assignee_id TEXT REFERENCES agents(id),
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE raid_entries (
      id TEXT PRIMARY KEY,
      building_id TEXT NOT NULL REFERENCES buildings(id),
      room_id TEXT REFERENCES rooms(id),
      type TEXT NOT NULL,
      summary TEXT NOT NULL,
      rationale TEXT,
      status TEXT DEFAULT 'active',
      phase TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE milestones (
      id TEXT PRIMARY KEY,
      building_id TEXT NOT NULL REFERENCES buildings(id),
      title TEXT NOT NULL,
      description TEXT,
      status TEXT DEFAULT 'active',
      due_date TEXT,
      phase TEXT,
      ordinal INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE messages (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL REFERENCES rooms(id),
      agent_id TEXT REFERENCES agents(id),
      role TEXT NOT NULL DEFAULT 'assistant',
      content TEXT,
      thread_id TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  // Seed data
  db.prepare('INSERT INTO buildings (id, name) VALUES (?, ?)').run('b1', 'Test Project');
  db.prepare('INSERT INTO floors (id, building_id, type, name) VALUES (?, ?, ?, ?)').run('f1', 'b1', 'execution', 'Execution Floor');
  db.prepare('INSERT INTO rooms (id, floor_id, type, name) VALUES (?, ?, ?, ?)').run('r1', 'f1', 'code-lab', 'API Code Lab');
  db.prepare('INSERT INTO agents (id, name, display_name, specialization, bio) VALUES (?, ?, ?, ?, ?)').run('a1', 'backend-lead', 'Alice Backend', 'Node.js APIs', 'Expert in REST and GraphQL');
  db.prepare('INSERT INTO agents (id, name, display_name, specialization, bio) VALUES (?, ?, ?, ?, ?)').run('a2', 'frontend-lead', 'Bob Frontend', 'React components', 'UI specialist');
  db.prepare('INSERT INTO tasks (id, building_id, title, description, status, priority, assignee_id) VALUES (?, ?, ?, ?, ?, ?, ?)').run('t1', 'b1', 'Implement API endpoints', 'Create REST endpoints for user management', 'in-progress', 'high', 'a1');
  db.prepare('INSERT INTO tasks (id, building_id, title, description, status, priority, assignee_id) VALUES (?, ?, ?, ?, ?, ?, ?)').run('t2', 'b1', 'Build login page', 'Create authentication UI', 'pending', 'normal', 'a2');
  db.prepare('INSERT INTO tasks (id, building_id, title, description, status, priority, assignee_id) VALUES (?, ?, ?, ?, ?, ?, ?)').run('t3', 'b1', 'Database schema design', 'Design the PostgreSQL schema', 'done', 'high', 'a1');
  db.prepare('INSERT INTO raid_entries (id, building_id, room_id, type, summary, rationale, status) VALUES (?, ?, ?, ?, ?, ?, ?)').run('raid1', 'b1', 'r1', 'risk', 'API rate limiting not implemented', 'Could face DDoS attacks', 'active');
  db.prepare('INSERT INTO raid_entries (id, building_id, room_id, type, summary, rationale, status) VALUES (?, ?, ?, ?, ?, ?, ?)').run('raid2', 'b1', 'r1', 'decision', 'Use PostgreSQL over MySQL', 'Better JSON support', 'active');
  db.prepare('INSERT INTO milestones (id, building_id, title, description, status) VALUES (?, ?, ?, ?, ?)').run('m1', 'b1', 'MVP Launch', 'Minimum viable product release', 'active');
  db.prepare('INSERT INTO milestones (id, building_id, title, description, status) VALUES (?, ?, ?, ?, ?)').run('m2', 'b1', 'Beta Release', 'Public beta with API access', 'active');
  db.prepare('INSERT INTO messages (id, room_id, agent_id, role, content) VALUES (?, ?, ?, ?, ?)').run('msg1', 'r1', 'a1', 'assistant', 'I have finished implementing the API endpoints');
  db.prepare('INSERT INTO messages (id, room_id, agent_id, role, content) VALUES (?, ?, ?, ?, ?)').run('msg2', 'r1', 'a2', 'assistant', 'The login page design is ready for review');

  return db;
}

// Mock getDb to return our in-memory database
import { vi } from 'vitest';
vi.mock('../../../src/storage/db.js', () => ({
  getDb: () => db,
  initDb: vi.fn(),
}));

beforeEach(() => {
  setupDb();
});

// ─── Tests ───

describe('globalSearch()', () => {

  it('returns error for empty query', () => {
    const result = globalSearch({ buildingId: 'b1', query: '' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_QUERY');
    }
  });

  it('returns error for whitespace-only query', () => {
    const result = globalSearch({ buildingId: 'b1', query: '   ' });
    expect(result.ok).toBe(false);
  });

  it('finds tasks by title', () => {
    const result = globalSearch({ buildingId: 'b1', query: 'API' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const data = result.data as { groups: { type: string; items: Record<string, unknown>[] }[] };
    const taskGroup = data.groups.find(g => g.type === 'task');
    expect(taskGroup).toBeDefined();
    expect(taskGroup!.items.length).toBeGreaterThanOrEqual(1);
    expect(taskGroup!.items[0].title).toBe('Implement API endpoints');
  });

  it('finds tasks by description', () => {
    const result = globalSearch({ buildingId: 'b1', query: 'authentication' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const data = result.data as { groups: { type: string; items: Record<string, unknown>[] }[] };
    const taskGroup = data.groups.find(g => g.type === 'task');
    expect(taskGroup).toBeDefined();
    expect(taskGroup!.items[0].title).toBe('Build login page');
  });

  it('finds agents by specialization', () => {
    const result = globalSearch({ buildingId: 'b1', query: 'React' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const data = result.data as { groups: { type: string; items: Record<string, unknown>[] }[] };
    const agentGroup = data.groups.find(g => g.type === 'agent');
    expect(agentGroup).toBeDefined();
    expect(agentGroup!.items[0].display_name).toBe('Bob Frontend');
  });

  it('finds agents by bio', () => {
    const result = globalSearch({ buildingId: 'b1', query: 'GraphQL' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const data = result.data as { groups: { type: string; items: Record<string, unknown>[] }[] };
    const agentGroup = data.groups.find(g => g.type === 'agent');
    expect(agentGroup).toBeDefined();
    expect(agentGroup!.items[0].display_name).toBe('Alice Backend');
  });

  it('finds RAID entries by summary', () => {
    const result = globalSearch({ buildingId: 'b1', query: 'rate limiting' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const data = result.data as { groups: { type: string; items: Record<string, unknown>[] }[] };
    const raidGroup = data.groups.find(g => g.type === 'raid');
    expect(raidGroup).toBeDefined();
    expect(raidGroup!.items[0].summary).toContain('rate limiting');
  });

  it('finds RAID entries by rationale', () => {
    const result = globalSearch({ buildingId: 'b1', query: 'JSON support' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const data = result.data as { groups: { type: string; items: Record<string, unknown>[] }[] };
    const raidGroup = data.groups.find(g => g.type === 'raid');
    expect(raidGroup).toBeDefined();
    expect(raidGroup!.items[0].summary).toContain('PostgreSQL');
  });

  it('finds rooms by name', () => {
    const result = globalSearch({ buildingId: 'b1', query: 'Code Lab' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const data = result.data as { groups: { type: string; items: Record<string, unknown>[] }[] };
    const roomGroup = data.groups.find(g => g.type === 'room');
    expect(roomGroup).toBeDefined();
    expect(roomGroup!.items[0].name).toBe('API Code Lab');
  });

  it('finds milestones by title', () => {
    const result = globalSearch({ buildingId: 'b1', query: 'MVP' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const data = result.data as { groups: { type: string; items: Record<string, unknown>[] }[] };
    const msGroup = data.groups.find(g => g.type === 'milestone');
    expect(msGroup).toBeDefined();
    expect(msGroup!.items[0].title).toBe('MVP Launch');
  });

  it('finds messages by content', () => {
    const result = globalSearch({ buildingId: 'b1', query: 'finished implementing' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const data = result.data as { groups: { type: string; items: Record<string, unknown>[] }[] };
    const msgGroup = data.groups.find(g => g.type === 'message');
    expect(msgGroup).toBeDefined();
    expect(msgGroup!.items[0].content).toContain('finished implementing');
  });

  it('returns empty groups for non-matching query', () => {
    const result = globalSearch({ buildingId: 'b1', query: 'xyznonexistent' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const data = result.data as { groups: { type: string }[]; totalHits: number };
    expect(data.groups.length).toBe(0);
    expect(data.totalHits).toBe(0);
  });

  it('returns empty for wrong buildingId', () => {
    const result = globalSearch({ buildingId: 'nonexistent', query: 'API' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const data = result.data as { groups: { type: string }[] };
    // Tasks, RAID, rooms, milestones, messages are building-scoped — should find nothing
    // Agents are global, so they might still match
    const nonAgentGroups = data.groups.filter(g => g.type !== 'agent');
    expect(nonAgentGroups.length).toBe(0);
  });

  it('respects type filters — only returns matching types', () => {
    const result = globalSearch({ buildingId: 'b1', query: 'API', filters: ['task'] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const data = result.data as { groups: { type: string }[] };
    expect(data.groups.every(g => g.type === 'task')).toBe(true);
  });

  it('respects type filters — multiple types', () => {
    const result = globalSearch({ buildingId: 'b1', query: 'API', filters: ['task', 'raid'] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const data = result.data as { groups: { type: string }[] };
    for (const group of data.groups) {
      expect(['task', 'raid']).toContain(group.type);
    }
  });

  it('respects limit parameter', () => {
    const result = globalSearch({ buildingId: 'b1', query: 'a', limit: 1 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const data = result.data as { groups: { type: string; items: unknown[] }[] };
    for (const group of data.groups) {
      expect(group.items.length).toBeLessThanOrEqual(1);
    }
  });

  it('returns totalHits across all groups', () => {
    const result = globalSearch({ buildingId: 'b1', query: 'API' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const data = result.data as { totalHits: number; groups: { type: string; items: unknown[] }[] };
    expect(data.totalHits).toBeGreaterThan(0);
  });

  it('includes query in response', () => {
    const result = globalSearch({ buildingId: 'b1', query: 'test query' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const data = result.data as { query: string };
    expect(data.query).toBe('test query');
  });

  it('cross-entity search finds results in multiple types', () => {
    const result = globalSearch({ buildingId: 'b1', query: 'API' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const data = result.data as { groups: { type: string }[] };
    const types = data.groups.map(g => g.type);
    expect(types).toContain('task');
    expect(types).toContain('message');
  });
});
