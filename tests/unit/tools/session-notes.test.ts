/**
 * Session Notes — Agent Scratchpad Tests
 *
 * Tests persistent key-value scratchpad for agents.
 * Uses in-memory SQLite with dynamic imports to reset the module-level
 * `initialized` flag between tests (ensuring ensureTable() runs fresh).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';

let memDb: Database.Database;
let sessionNotes: typeof import('../../../src/tools/providers/session-notes.js');

beforeEach(async () => {
  vi.resetModules();
  memDb = new Database(':memory:');
  vi.doMock('../../../src/storage/db.js', () => ({
    getDb: () => memDb,
  }));
  sessionNotes = await import('../../../src/tools/providers/session-notes.js');
});

afterEach(() => {
  memDb.close();
});

// ── writeNote ───────────────────────────────────────────────────────────────

describe('writeNote', () => {
  it('writes a new note and returns success', () => {
    const result = sessionNotes.writeNote('agent_1', 'todo', 'finish the report');
    expect(result.ok).toBe(true);
    expect(result.message).toContain('todo');
    expect(result.message).toContain('saved');
  });

  it('persists the note to the database', () => {
    sessionNotes.writeNote('agent_1', 'status', 'in progress');
    const row = memDb.prepare('SELECT value FROM session_notes WHERE agent_id = ? AND key = ?').get('agent_1', 'status') as { value: string };
    expect(row.value).toBe('in progress');
  });

  it('updates an existing note with the same key', () => {
    sessionNotes.writeNote('agent_1', 'status', 'draft');
    sessionNotes.writeNote('agent_1', 'status', 'final');

    const row = memDb.prepare('SELECT value FROM session_notes WHERE agent_id = ? AND key = ?').get('agent_1', 'status') as { value: string };
    expect(row.value).toBe('final');

    // Should still only be one row for this agent+key
    const count = memDb.prepare('SELECT COUNT(*) as cnt FROM session_notes WHERE agent_id = ? AND key = ?').get('agent_1', 'status') as { cnt: number };
    expect(count.cnt).toBe(1);
  });

  it('truncates value at 2000 characters', () => {
    const longValue = 'x'.repeat(3000);
    const result = sessionNotes.writeNote('agent_1', 'big', longValue);
    expect(result.ok).toBe(true);
    expect(result.message).toContain('2000 chars');

    const row = memDb.prepare('SELECT value FROM session_notes WHERE agent_id = ? AND key = ?').get('agent_1', 'big') as { value: string };
    expect(row.value.length).toBe(2000);
  });

  it('accepts a value exactly at the 2000 character limit', () => {
    const exactValue = 'a'.repeat(2000);
    const result = sessionNotes.writeNote('agent_1', 'exact', exactValue);
    expect(result.ok).toBe(true);
    expect(result.message).toContain('2000 chars');

    const row = memDb.prepare('SELECT value FROM session_notes WHERE agent_id = ? AND key = ?').get('agent_1', 'exact') as { value: string };
    expect(row.value.length).toBe(2000);
  });

  it('stores buildingId when provided', () => {
    sessionNotes.writeNote('agent_1', 'scope', 'building context', 'bld_42');
    const row = memDb.prepare('SELECT building_id FROM session_notes WHERE agent_id = ? AND key = ?').get('agent_1', 'scope') as { building_id: string };
    expect(row.building_id).toBe('bld_42');
  });

  it('stores null for buildingId when omitted', () => {
    sessionNotes.writeNote('agent_1', 'scope', 'no building');
    const row = memDb.prepare('SELECT building_id FROM session_notes WHERE agent_id = ? AND key = ?').get('agent_1', 'scope') as { building_id: string | null };
    expect(row.building_id).toBeNull();
  });

  it('enforces the 20 note per agent limit', () => {
    for (let i = 0; i < 20; i++) {
      const r = sessionNotes.writeNote('agent_1', `note_${i}`, `value_${i}`);
      expect(r.ok).toBe(true);
    }

    // 21st note with a new key should be rejected
    const result = sessionNotes.writeNote('agent_1', 'note_overflow', 'too many');
    expect(result.ok).toBe(false);
    expect(result.message).toContain('maximum');
    expect(result.message).toContain('20');
  });

  it('allows updating an existing note when at the 20-note limit', () => {
    for (let i = 0; i < 20; i++) {
      sessionNotes.writeNote('agent_1', `note_${i}`, `value_${i}`);
    }

    // Updating an existing key should succeed even at the limit
    const result = sessionNotes.writeNote('agent_1', 'note_0', 'updated value');
    expect(result.ok).toBe(true);

    const row = memDb.prepare('SELECT value FROM session_notes WHERE agent_id = ? AND key = ?').get('agent_1', 'note_0') as { value: string };
    expect(row.value).toBe('updated value');
  });

  it('counts notes per agent independently (limit is per-agent)', () => {
    for (let i = 0; i < 20; i++) {
      sessionNotes.writeNote('agent_1', `note_${i}`, `value_${i}`);
    }

    // Different agent should still be able to write
    const result = sessionNotes.writeNote('agent_2', 'note_0', 'agent 2 note');
    expect(result.ok).toBe(true);
  });

  it('reports the correct character count in success message', () => {
    const result = sessionNotes.writeNote('agent_1', 'msg', 'hello');
    expect(result.message).toContain('5 chars');
  });
});

// ── readNote ────────────────────────────────────────────────────────────────

describe('readNote', () => {
  it('reads an existing note', () => {
    sessionNotes.writeNote('agent_1', 'status', 'active');
    const note = sessionNotes.readNote('agent_1', 'status');

    expect(note).not.toBeNull();
    expect(note!.key).toBe('status');
    expect(note!.value).toBe('active');
    expect(note!.updatedAt).toBeDefined();
  });

  it('returns null for a non-existent key', () => {
    const note = sessionNotes.readNote('agent_1', 'does_not_exist');
    expect(note).toBeNull();
  });

  it('returns null for a non-existent agent', () => {
    sessionNotes.writeNote('agent_1', 'status', 'active');
    const note = sessionNotes.readNote('agent_999', 'status');
    expect(note).toBeNull();
  });

  it('returns the updated value after an overwrite', () => {
    sessionNotes.writeNote('agent_1', 'status', 'draft');
    sessionNotes.writeNote('agent_1', 'status', 'published');
    const note = sessionNotes.readNote('agent_1', 'status');

    expect(note).not.toBeNull();
    expect(note!.value).toBe('published');
  });
});

// ── listNotes ───────────────────────────────────────────────────────────────

describe('listNotes', () => {
  it('returns an empty array when the agent has no notes', () => {
    const notes = sessionNotes.listNotes('agent_1');
    expect(notes).toEqual([]);
  });

  it('returns all notes for an agent', () => {
    sessionNotes.writeNote('agent_1', 'a', '1');
    sessionNotes.writeNote('agent_1', 'b', '2');
    sessionNotes.writeNote('agent_1', 'c', '3');

    const notes = sessionNotes.listNotes('agent_1');
    expect(notes).toHaveLength(3);
  });

  it('returns notes ordered by updatedAt descending (most recent first)', () => {
    // Insert notes with explicit timestamps so ordering is deterministic
    sessionNotes.writeNote('agent_1', 'old', 'first');
    // Force a later timestamp on the second note via direct SQL
    memDb.prepare(
      "INSERT INTO session_notes (agent_id, key, value, updated_at) VALUES (?, ?, ?, datetime('now', '+1 minute'))",
    ).run('agent_1', 'new', 'second');

    const notes = sessionNotes.listNotes('agent_1');
    expect(notes[0].key).toBe('new');
    expect(notes[1].key).toBe('old');
  });

  it('returns SessionNote objects with key, value, and updatedAt', () => {
    sessionNotes.writeNote('agent_1', 'status', 'running');
    const notes = sessionNotes.listNotes('agent_1');

    expect(notes).toHaveLength(1);
    expect(notes[0]).toHaveProperty('key', 'status');
    expect(notes[0]).toHaveProperty('value', 'running');
    expect(notes[0]).toHaveProperty('updatedAt');
    expect(typeof notes[0].updatedAt).toBe('string');
  });
});

// ── deleteNote ──────────────────────────────────────────────────────────────

describe('deleteNote', () => {
  it('deletes an existing note and returns success', () => {
    sessionNotes.writeNote('agent_1', 'temp', 'to be deleted');
    const result = sessionNotes.deleteNote('agent_1', 'temp');

    expect(result.ok).toBe(true);
    expect(result.message).toContain('deleted');

    // Verify it is gone
    const note = sessionNotes.readNote('agent_1', 'temp');
    expect(note).toBeNull();
  });

  it('returns failure when deleting a non-existent key', () => {
    const result = sessionNotes.deleteNote('agent_1', 'ghost');
    expect(result.ok).toBe(false);
    expect(result.message).toContain('not found');
  });

  it('does not affect other notes when deleting one', () => {
    sessionNotes.writeNote('agent_1', 'keep', 'stays');
    sessionNotes.writeNote('agent_1', 'remove', 'goes away');

    sessionNotes.deleteNote('agent_1', 'remove');

    expect(sessionNotes.readNote('agent_1', 'keep')).not.toBeNull();
    expect(sessionNotes.readNote('agent_1', 'remove')).toBeNull();
  });

  it('frees a slot so a new note can be written after deletion at the limit', () => {
    for (let i = 0; i < 20; i++) {
      sessionNotes.writeNote('agent_1', `note_${i}`, `value_${i}`);
    }

    // At limit — new key should fail
    expect(sessionNotes.writeNote('agent_1', 'overflow', 'nope').ok).toBe(false);

    // Delete one and try again
    sessionNotes.deleteNote('agent_1', 'note_19');
    const result = sessionNotes.writeNote('agent_1', 'replacement', 'yes');
    expect(result.ok).toBe(true);
  });
});

// ── clearNotes ──────────────────────────────────────────────────────────────

describe('clearNotes', () => {
  it('clears all notes for an agent and returns the count', () => {
    sessionNotes.writeNote('agent_1', 'a', '1');
    sessionNotes.writeNote('agent_1', 'b', '2');
    sessionNotes.writeNote('agent_1', 'c', '3');

    const result = sessionNotes.clearNotes('agent_1');
    expect(result.ok).toBe(true);
    expect(result.count).toBe(3);

    const notes = sessionNotes.listNotes('agent_1');
    expect(notes).toEqual([]);
  });

  it('returns count 0 when clearing an agent with no notes', () => {
    const result = sessionNotes.clearNotes('agent_empty');
    expect(result.ok).toBe(true);
    expect(result.count).toBe(0);
  });

  it('does not affect other agents when clearing one agent', () => {
    sessionNotes.writeNote('agent_1', 'a', '1');
    sessionNotes.writeNote('agent_2', 'b', '2');

    sessionNotes.clearNotes('agent_1');

    expect(sessionNotes.listNotes('agent_1')).toHaveLength(0);
    expect(sessionNotes.listNotes('agent_2')).toHaveLength(1);
  });
});

// ── buildScratchpadInjection ────────────────────────────────────────────────

describe('buildScratchpadInjection', () => {
  it('returns an empty string when the agent has no notes', () => {
    const injection = sessionNotes.buildScratchpadInjection('agent_empty');
    expect(injection).toBe('');
  });

  it('returns formatted markdown with a header', () => {
    sessionNotes.writeNote('agent_1', 'status', 'running');
    const injection = sessionNotes.buildScratchpadInjection('agent_1');

    expect(injection).toContain('## Agent Scratchpad (Session Notes)');
  });

  it('includes each note as a markdown section', () => {
    sessionNotes.writeNote('agent_1', 'status', 'running');
    sessionNotes.writeNote('agent_1', 'context', 'building the dashboard');

    const injection = sessionNotes.buildScratchpadInjection('agent_1');

    expect(injection).toContain('### status');
    expect(injection).toContain('running');
    expect(injection).toContain('### context');
    expect(injection).toContain('building the dashboard');
  });

  it('includes the persistence reminder at the end', () => {
    sessionNotes.writeNote('agent_1', 'status', 'running');
    const injection = sessionNotes.buildScratchpadInjection('agent_1');

    expect(injection).toContain('session_note tool');
    expect(injection).toContain('persist');
  });

  it('formats multiple notes as separate sections separated by blank lines', () => {
    sessionNotes.writeNote('agent_1', 'alpha', 'first');
    sessionNotes.writeNote('agent_1', 'beta', 'second');

    const injection = sessionNotes.buildScratchpadInjection('agent_1');
    const lines = injection.split('\n');

    // Should have the header, blank line, then sections with blank line separators
    expect(lines[0]).toBe('## Agent Scratchpad (Session Notes)');
    expect(lines[1]).toBe('');
  });
});

// ── readAgentNotes (cross-agent reading) ────────────────────────────────────

describe('readAgentNotes', () => {
  it('reads notes from another agent', () => {
    sessionNotes.writeNote('agent_target', 'plan', 'build the API');
    sessionNotes.writeNote('agent_target', 'blockers', 'none');

    const notes = sessionNotes.readAgentNotes('agent_target');
    expect(notes).toHaveLength(2);
    expect(notes.map(n => n.key)).toContain('plan');
    expect(notes.map(n => n.key)).toContain('blockers');
  });

  it('returns empty array for an agent with no notes', () => {
    const notes = sessionNotes.readAgentNotes('agent_nonexistent');
    expect(notes).toEqual([]);
  });
});

// ── Agent Isolation ─────────────────────────────────────────────────────────

describe('Agent Isolation', () => {
  it('agents cannot read each other\'s notes via readNote', () => {
    sessionNotes.writeNote('agent_1', 'secret', 'only mine');
    sessionNotes.writeNote('agent_2', 'secret', 'only theirs');

    expect(sessionNotes.readNote('agent_1', 'secret')!.value).toBe('only mine');
    expect(sessionNotes.readNote('agent_2', 'secret')!.value).toBe('only theirs');
  });

  it('listNotes only returns the requesting agent\'s notes', () => {
    sessionNotes.writeNote('agent_1', 'a', '1');
    sessionNotes.writeNote('agent_1', 'b', '2');
    sessionNotes.writeNote('agent_2', 'c', '3');

    const agent1Notes = sessionNotes.listNotes('agent_1');
    const agent2Notes = sessionNotes.listNotes('agent_2');

    expect(agent1Notes).toHaveLength(2);
    expect(agent2Notes).toHaveLength(1);
    expect(agent1Notes.every(n => n.key !== 'c')).toBe(true);
    expect(agent2Notes[0].key).toBe('c');
  });

  it('clearNotes only affects the specified agent', () => {
    sessionNotes.writeNote('agent_1', 'a', '1');
    sessionNotes.writeNote('agent_2', 'b', '2');

    sessionNotes.clearNotes('agent_1');

    expect(sessionNotes.listNotes('agent_1')).toHaveLength(0);
    expect(sessionNotes.listNotes('agent_2')).toHaveLength(1);
  });

  it('deleteNote only removes the note for the specified agent', () => {
    sessionNotes.writeNote('agent_1', 'shared_key', 'agent 1 value');
    sessionNotes.writeNote('agent_2', 'shared_key', 'agent 2 value');

    sessionNotes.deleteNote('agent_1', 'shared_key');

    expect(sessionNotes.readNote('agent_1', 'shared_key')).toBeNull();
    expect(sessionNotes.readNote('agent_2', 'shared_key')!.value).toBe('agent 2 value');
  });

  it('buildScratchpadInjection only includes the specified agent\'s notes', () => {
    sessionNotes.writeNote('agent_1', 'visible', 'yes');
    sessionNotes.writeNote('agent_2', 'invisible', 'no');

    const injection = sessionNotes.buildScratchpadInjection('agent_1');
    expect(injection).toContain('visible');
    expect(injection).not.toContain('invisible');
  });

  it('note limit is independent per agent', () => {
    // Fill agent_1 to the limit
    for (let i = 0; i < 20; i++) {
      sessionNotes.writeNote('agent_1', `note_${i}`, `val_${i}`);
    }

    // agent_2 should still be able to write freely
    for (let i = 0; i < 20; i++) {
      const r = sessionNotes.writeNote('agent_2', `note_${i}`, `val_${i}`);
      expect(r.ok).toBe(true);
    }

    // Both are at their limit now
    expect(sessionNotes.writeNote('agent_1', 'extra', 'nope').ok).toBe(false);
    expect(sessionNotes.writeNote('agent_2', 'extra', 'nope').ok).toBe(false);
  });
});

// ── Table Creation ──────────────────────────────────────────────────────────

describe('Table Creation (ensureTable)', () => {
  it('creates the session_notes table lazily on first operation', () => {
    // Before any operation, table should not exist
    const beforeTables = memDb
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='session_notes'")
      .all();
    expect(beforeTables).toHaveLength(0);

    // Trigger table creation via any operation
    sessionNotes.listNotes('agent_1');

    const afterTables = memDb
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='session_notes'")
      .all();
    expect(afterTables).toHaveLength(1);
  });

  it('table has the expected columns', () => {
    sessionNotes.listNotes('agent_1'); // triggers ensureTable

    const columns = memDb.pragma('table_info(session_notes)') as { name: string }[];
    const columnNames = columns.map(c => c.name);

    expect(columnNames).toContain('id');
    expect(columnNames).toContain('agent_id');
    expect(columnNames).toContain('building_id');
    expect(columnNames).toContain('key');
    expect(columnNames).toContain('value');
    expect(columnNames).toContain('created_at');
    expect(columnNames).toContain('updated_at');
  });

  it('enforces UNIQUE constraint on (agent_id, key)', () => {
    sessionNotes.writeNote('agent_1', 'unique_test', 'first');

    // Direct SQL insert with same agent_id + key should violate constraint
    expect(() => {
      memDb.prepare(
        "INSERT INTO session_notes (agent_id, key, value) VALUES (?, ?, ?)",
      ).run('agent_1', 'unique_test', 'duplicate');
    }).toThrow();
  });
});
