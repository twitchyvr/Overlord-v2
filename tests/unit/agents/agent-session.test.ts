/**
 * Agent Session Tests
 *
 * Tests session lifecycle, persistence (save/load/delete),
 * message tracking, and the findActive/listForAgent queries.
 * Uses in-memory SQLite — no disk IO.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { AgentSession } from '../../../src/agents/agent-session.js';

import * as dbModule from '../../../src/storage/db.js';

let db: Database.Database;

function setupDb(): Database.Database {
  const memDb = new Database(':memory:');
  memDb.pragma('foreign_keys = OFF');
  memDb.prepare(`CREATE TABLE agent_sessions (
    id TEXT PRIMARY KEY, agent_id TEXT NOT NULL, room_id TEXT NOT NULL,
    table_type TEXT NOT NULL DEFAULT 'focus', tools TEXT DEFAULT '[]',
    status TEXT DEFAULT 'active', messages TEXT DEFAULT '[]',
    started_at TEXT DEFAULT (datetime('now')), ended_at TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`).run();
  return memDb;
}

describe('AgentSession', () => {
  beforeEach(() => {
    db = setupDb();
    vi.spyOn(dbModule, 'getDb').mockReturnValue(db as unknown as ReturnType<typeof dbModule.getDb>);
  });

  describe('constructor', () => {
    it('creates a session with correct initial state', () => {
      const session = new AgentSession({
        agentId: 'agent_1',
        roomId: 'room_1',
        tableType: 'focus',
        tools: ['read_file', 'bash'],
      });

      expect(session.id).toMatch(/^session_/);
      expect(session.agentId).toBe('agent_1');
      expect(session.roomId).toBe('room_1');
      expect(session.tableType).toBe('focus');
      expect(session.tools).toEqual(['read_file', 'bash']);
      expect(session.status).toBe('active');
      expect(session.startedAt).toBeGreaterThan(0);
      expect(session.endedAt).toBeNull();
      expect(session.messages).toEqual([]);
    });
  });

  describe('getAvailableTools', () => {
    it('returns a copy of the tools array', () => {
      const session = new AgentSession({
        agentId: 'a1', roomId: 'r1', tableType: 'focus',
        tools: ['read_file', 'write_file'],
      });

      const tools = session.getAvailableTools();
      expect(tools).toEqual(['read_file', 'write_file']);

      // Modifying the returned array should not affect session
      tools.push('bash');
      expect(session.getAvailableTools()).toEqual(['read_file', 'write_file']);
    });
  });

  describe('addMessage', () => {
    it('adds messages with timestamps', () => {
      const session = new AgentSession({
        agentId: 'a1', roomId: 'r1', tableType: 'focus', tools: [],
      });

      session.addMessage({ role: 'user', content: 'Hello' });
      session.addMessage({ role: 'assistant', content: 'Hi there' });

      expect(session.messages).toHaveLength(2);
      expect(session.messages[0].role).toBe('user');
      expect(session.messages[0].content).toBe('Hello');
      expect(session.messages[0].timestamp).toBeGreaterThan(0);
      expect(session.messages[1].role).toBe('assistant');
    });

    it('preserves provided timestamp', () => {
      const session = new AgentSession({
        agentId: 'a1', roomId: 'r1', tableType: 'focus', tools: [],
      });

      session.addMessage({ role: 'user', content: 'test', timestamp: 12345 });
      expect(session.messages[0].timestamp).toBe(12345);
    });
  });

  describe('end', () => {
    it('sets status to ended and records endedAt', () => {
      const session = new AgentSession({
        agentId: 'a1', roomId: 'r1', tableType: 'focus', tools: [],
      });

      expect(session.status).toBe('active');
      session.end();
      expect(session.status).toBe('ended');
      expect(session.endedAt).toBeGreaterThan(0);
    });
  });

  describe('save / load', () => {
    it('persists and retrieves a session', () => {
      const session = new AgentSession({
        agentId: 'a1', roomId: 'r1', tableType: 'collab',
        tools: ['read_file', 'bash'],
      });
      session.addMessage({ role: 'user', content: 'Hello' });
      session.save();

      const loaded = AgentSession.load(session.id);
      expect(loaded).not.toBeNull();
      expect(loaded!.id).toBe(session.id);
      expect(loaded!.agentId).toBe('a1');
      expect(loaded!.roomId).toBe('r1');
      expect(loaded!.tableType).toBe('collab');
      expect(loaded!.tools).toEqual(['read_file', 'bash']);
      expect(loaded!.status).toBe('active');
      expect(loaded!.messages).toHaveLength(1);
      expect(loaded!.messages[0].content).toBe('Hello');
    });

    it('updates existing session on second save', () => {
      const session = new AgentSession({
        agentId: 'a1', roomId: 'r1', tableType: 'focus', tools: [],
      });
      session.save();

      session.addMessage({ role: 'user', content: 'msg1' });
      session.addMessage({ role: 'assistant', content: 'msg2' });
      session.end();
      session.save();

      const loaded = AgentSession.load(session.id);
      expect(loaded!.status).toBe('ended');
      expect(loaded!.endedAt).toBeGreaterThan(0);
      expect(loaded!.messages).toHaveLength(2);
    });

    it('returns null for non-existent session', () => {
      expect(AgentSession.load('session_ghost')).toBeNull();
    });
  });

  describe('findActive', () => {
    it('finds the most recent active session for agent+room', () => {
      const s1 = new AgentSession({ agentId: 'a1', roomId: 'r1', tableType: 'focus', tools: [] });
      s1.save();

      const s2 = new AgentSession({ agentId: 'a1', roomId: 'r1', tableType: 'focus', tools: [] });
      s2.save();

      const found = AgentSession.findActive('a1', 'r1');
      expect(found).not.toBeNull();
      // Should be the most recent (s2)
      expect(found!.id).toBe(s2.id);
    });

    it('does not return ended sessions', () => {
      const session = new AgentSession({ agentId: 'a1', roomId: 'r1', tableType: 'focus', tools: [] });
      session.end();
      session.save();

      expect(AgentSession.findActive('a1', 'r1')).toBeNull();
    });

    it('returns null when no active session exists', () => {
      expect(AgentSession.findActive('a1', 'r1')).toBeNull();
    });
  });

  describe('listForAgent', () => {
    it('returns all sessions for an agent', () => {
      const s1 = new AgentSession({ agentId: 'a1', roomId: 'r1', tableType: 'focus', tools: [] });
      s1.save();
      const s2 = new AgentSession({ agentId: 'a1', roomId: 'r2', tableType: 'collab', tools: ['bash'] });
      s2.save();
      const s3 = new AgentSession({ agentId: 'a2', roomId: 'r1', tableType: 'focus', tools: [] });
      s3.save();

      const sessions = AgentSession.listForAgent('a1');
      expect(sessions).toHaveLength(2);
    });

    it('returns empty array for agent with no sessions', () => {
      expect(AgentSession.listForAgent('a_unknown')).toEqual([]);
    });
  });

  describe('delete', () => {
    it('removes session from database', () => {
      const session = new AgentSession({ agentId: 'a1', roomId: 'r1', tableType: 'focus', tools: [] });
      session.save();

      expect(AgentSession.load(session.id)).not.toBeNull();
      const deleted = AgentSession.delete(session.id);
      expect(deleted).toBe(true);
      expect(AgentSession.load(session.id)).toBeNull();
    });

    it('returns false for non-existent session', () => {
      expect(AgentSession.delete('session_ghost')).toBe(false);
    });
  });

  describe('fromRow hydration', () => {
    it('hydrated session has working methods', () => {
      const session = new AgentSession({
        agentId: 'a1', roomId: 'r1', tableType: 'focus',
        tools: ['read_file'],
      });
      session.addMessage({ role: 'user', content: 'test' });
      session.save();

      const loaded = AgentSession.load(session.id)!;
      // Methods should work on hydrated session
      expect(loaded.getAvailableTools()).toEqual(['read_file']);

      loaded.addMessage({ role: 'assistant', content: 'response' });
      expect(loaded.messages).toHaveLength(2);

      loaded.end();
      expect(loaded.status).toBe('ended');

      // Can save again
      loaded.save();
      const reloaded = AgentSession.load(session.id)!;
      expect(reloaded.messages).toHaveLength(2);
      expect(reloaded.status).toBe('ended');
    });
  });
});
