/**
 * Agent Registry Tests
 *
 * Tests CRUD operations for agent identity cards.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { registerAgent, getAgent, listAgents, updateAgent, removeAgent } from '../../../src/agents/agent-registry.js';

// Mock the database
import { vi } from 'vitest';

let mockDb: Database.Database;

vi.mock('../../../src/storage/db.js', () => ({
  getDb: () => mockDb,
}));

describe('Agent Registry', () => {
  beforeEach(() => {
    mockDb = new Database(':memory:');
    mockDb.exec(`
      CREATE TABLE agents (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        role TEXT NOT NULL,
        building_id TEXT,
        capabilities TEXT DEFAULT '[]',
        room_access TEXT DEFAULT '[]',
        badge TEXT,
        status TEXT DEFAULT 'idle',
        current_room_id TEXT,
        current_table_id TEXT,
        config TEXT DEFAULT '{}',
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );
    `);
  });

  describe('registerAgent', () => {
    it('creates an agent with all fields', () => {
      const result = registerAgent({
        name: 'Dev Agent',
        role: 'developer',
        capabilities: ['code', 'test'],
        roomAccess: ['code-lab', 'testing-lab'],
        badge: 'senior',
        config: { preferredModel: 'claude' },
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.name).toBe('Dev Agent');
        expect(result.data.role).toBe('developer');
        expect(result.data.id).toMatch(/^agent_/);
      }
    });

    it('creates an agent with defaults', () => {
      const result = registerAgent({ name: 'Simple', role: 'assistant' });
      expect(result.ok).toBe(true);
    });
  });

  describe('getAgent', () => {
    it('retrieves a registered agent with parsed JSON fields', () => {
      registerAgent({
        name: 'Test Agent',
        role: 'tester',
        capabilities: ['qa'],
        roomAccess: ['testing-lab'],
      });

      const agents = listAgents();
      const agent = getAgent(agents[0].id);

      expect(agent).not.toBeNull();
      expect(agent!.name).toBe('Test Agent');
      expect(agent!.capabilities).toEqual(['qa']);
      expect(agent!.room_access).toEqual(['testing-lab']);
      expect(typeof agent!.config).toBe('object');
    });

    it('returns null for nonexistent agent', () => {
      expect(getAgent('nonexistent')).toBeNull();
    });
  });

  describe('listAgents', () => {
    it('lists all agents', () => {
      registerAgent({ name: 'A', role: 'dev' });
      registerAgent({ name: 'B', role: 'test' });
      registerAgent({ name: 'C', role: 'pm' });

      const agents = listAgents();
      expect(agents.length).toBe(3);
    });

    it('filters by status', () => {
      registerAgent({ name: 'A', role: 'dev' });
      registerAgent({ name: 'B', role: 'test' });

      // All agents start as 'idle'
      const idle = listAgents({ status: 'idle' });
      expect(idle.length).toBe(2);

      const active = listAgents({ status: 'active' });
      expect(active.length).toBe(0);
    });
  });

  describe('updateAgent', () => {
    it('updates agent fields', () => {
      registerAgent({ name: 'Original', role: 'dev' });
      const agents = listAgents();
      const id = agents[0].id;

      const result = updateAgent(id, { name: 'Updated', role: 'senior-dev' });
      expect(result.ok).toBe(true);

      const updated = getAgent(id);
      expect(updated!.name).toBe('Updated');
      expect(updated!.role).toBe('senior-dev');
    });

    it('returns error for nonexistent agent', () => {
      const result = updateAgent('fake_id', { name: 'X' });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('AGENT_NOT_FOUND');
      }
    });

    it('handles no updates gracefully', () => {
      registerAgent({ name: 'A', role: 'dev' });
      const agents = listAgents();
      const result = updateAgent(agents[0].id, {});
      expect(result.ok).toBe(true);
    });
  });

  describe('removeAgent', () => {
    it('removes an agent', () => {
      registerAgent({ name: 'Doomed', role: 'intern' });
      const agents = listAgents();
      expect(agents.length).toBe(1);

      removeAgent(agents[0].id);
      expect(listAgents().length).toBe(0);
    });
  });

  describe('malformed JSON resilience', () => {
    it('getAgent handles corrupted capabilities JSON gracefully', () => {
      // Insert agent with malformed JSON directly via SQL
      mockDb.prepare(`
        INSERT INTO agents (id, name, role, capabilities, room_access, config)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('agent_corrupt_1', 'Corrupt', 'dev', '{not valid json', '["testing-lab"]', '{}');

      const agent = getAgent('agent_corrupt_1');
      expect(agent).not.toBeNull();
      expect(agent!.capabilities).toEqual([]); // fallback
      expect(agent!.room_access).toEqual(['testing-lab']); // valid JSON still parsed
    });

    it('getAgent handles corrupted room_access JSON gracefully', () => {
      mockDb.prepare(`
        INSERT INTO agents (id, name, role, capabilities, room_access, config)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('agent_corrupt_2', 'Corrupt2', 'dev', '["code"]', 'broken!!!', '{}');

      const agent = getAgent('agent_corrupt_2');
      expect(agent).not.toBeNull();
      expect(agent!.capabilities).toEqual(['code']); // valid
      expect(agent!.room_access).toEqual([]); // fallback
    });

    it('getAgent handles corrupted config JSON gracefully', () => {
      mockDb.prepare(`
        INSERT INTO agents (id, name, role, capabilities, room_access, config)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('agent_corrupt_3', 'Corrupt3', 'dev', '[]', '[]', '{{{{');

      const agent = getAgent('agent_corrupt_3');
      expect(agent).not.toBeNull();
      expect(agent!.config).toEqual({}); // fallback
    });

    it('listAgents handles corrupted JSON across multiple agents', () => {
      mockDb.prepare(`
        INSERT INTO agents (id, name, role, capabilities, room_access, config)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('agent_ok', 'Good', 'dev', '["code"]', '["code-lab"]', '{"key":"val"}');

      mockDb.prepare(`
        INSERT INTO agents (id, name, role, capabilities, room_access, config)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('agent_bad', 'Bad', 'dev', 'not json', 'also broken', '???');

      const agents = listAgents();
      expect(agents.length).toBe(2);

      const good = agents.find(a => a.id === 'agent_ok')!;
      expect(good.capabilities).toEqual(['code']);
      expect(good.room_access).toEqual(['code-lab']);
      expect(good.config).toEqual({ key: 'val' });

      const bad = agents.find(a => a.id === 'agent_bad')!;
      expect(bad.capabilities).toEqual([]);
      expect(bad.room_access).toEqual([]);
      expect(bad.config).toEqual({});
    });

    it('getAgent handles null/empty JSON fields gracefully', () => {
      mockDb.prepare(`
        INSERT INTO agents (id, name, role, capabilities, room_access, config)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('agent_null', 'Null', 'dev', null, '', null);

      const agent = getAgent('agent_null');
      expect(agent).not.toBeNull();
      expect(agent!.capabilities).toEqual([]);
      expect(agent!.room_access).toEqual([]);
      expect(agent!.config).toEqual({});
    });
  });
});
