/**
 * Session Notes — Agent Scratchpad
 *
 * Persistent key-value scratchpad for agents. Notes survive context pruning
 * and are always injected into the system prompt. Agents can read, write,
 * and clear their notes. Cross-agent reading is supported.
 *
 * Storage: SQLite `session_notes` table.
 */

import { getDb } from '../../storage/db.js';
import { logger } from '../../core/logger.js';

const log = logger.child({ module: 'session-notes' });

const MAX_NOTE_SIZE = 2000; // characters per note
const MAX_NOTES_PER_AGENT = 20;

// ── DB Schema ────────────────────────────────────────────────────────────

/**
 * Ensure the session_notes table exists.
 * Called lazily on first access.
 */
let initialized = false;

function ensureTable(): void {
  if (initialized) return;
  const db = getDb();
  db.prepare(`
    CREATE TABLE IF NOT EXISTS session_notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT NOT NULL,
      building_id TEXT,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(agent_id, key)
    )
  `).run();
  initialized = true;
}

// ── Types ────────────────────────────────────────────────────────────────

export interface SessionNote {
  key: string;
  value: string;
  updatedAt: string;
}

// ── Operations ───────────────────────────────────────────────────────────

/**
 * Write or update a note for an agent.
 * Truncates value to MAX_NOTE_SIZE characters.
 */
export function writeNote(agentId: string, key: string, value: string, buildingId?: string): { ok: boolean; message: string } {
  ensureTable();
  const truncated = value.slice(0, MAX_NOTE_SIZE);

  try {
    const db = getDb();

    // Atomic count-check + insert via transaction to prevent race condition
    const result = db.transaction(() => {
      const count = db.prepare('SELECT COUNT(*) as cnt FROM session_notes WHERE agent_id = ?').get(agentId) as { cnt: number };
      if (count.cnt >= MAX_NOTES_PER_AGENT) {
        const existing = db.prepare('SELECT id FROM session_notes WHERE agent_id = ? AND key = ?').get(agentId, key);
        if (!existing) {
          return { ok: false as const, message: `Agent has reached the maximum of ${MAX_NOTES_PER_AGENT} notes. Delete some notes first.` };
        }
      }

      db.prepare(`
        INSERT INTO session_notes (agent_id, building_id, key, value)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(agent_id, key) DO UPDATE SET
          value = excluded.value,
          building_id = COALESCE(excluded.building_id, building_id),
          updated_at = datetime('now')
      `).run(agentId, buildingId || null, key, truncated);

      return { ok: true as const, message: `Note "${key}" saved (${truncated.length} chars)` };
    })();

    if (result.ok) log.debug({ agentId, key, size: truncated.length }, 'Session note written');
    return result;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error({ err: e, agentId, key }, 'Failed to write session note');
    return { ok: false, message: msg };
  }
}

/**
 * Read a specific note for an agent.
 */
export function readNote(agentId: string, key: string): SessionNote | null {
  ensureTable();
  try {
    const db = getDb();
    const row = db.prepare('SELECT key, value, updated_at FROM session_notes WHERE agent_id = ? AND key = ?').get(agentId, key) as { key: string; value: string; updated_at: string } | undefined;
    if (!row) return null;
    return { key: row.key, value: row.value, updatedAt: row.updated_at };
  } catch (e) {
    log.error({ err: e, agentId, key }, 'Failed to read session note');
    return null;
  }
}

/**
 * List all notes for an agent.
 */
export function listNotes(agentId: string): SessionNote[] {
  ensureTable();
  try {
    const db = getDb();
    const rows = db.prepare('SELECT key, value, updated_at FROM session_notes WHERE agent_id = ? ORDER BY updated_at DESC').all(agentId) as { key: string; value: string; updated_at: string }[];
    return rows.map(r => ({ key: r.key, value: r.value, updatedAt: r.updated_at }));
  } catch (e) {
    log.error({ err: e, agentId }, 'Failed to list session notes');
    return [];
  }
}

/**
 * Delete a specific note.
 */
export function deleteNote(agentId: string, key: string): { ok: boolean; message: string } {
  ensureTable();
  try {
    const db = getDb();
    const result = db.prepare('DELETE FROM session_notes WHERE agent_id = ? AND key = ?').run(agentId, key);
    if (result.changes === 0) {
      return { ok: false, message: `Note "${key}" not found` };
    }
    log.debug({ agentId, key }, 'Session note deleted');
    return { ok: true, message: `Note "${key}" deleted` };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error({ err: e, agentId, key }, 'Failed to delete session note');
    return { ok: false, message: msg };
  }
}

/**
 * Clear all notes for an agent.
 */
export function clearNotes(agentId: string): { ok: boolean; count: number } {
  ensureTable();
  try {
    const db = getDb();
    const result = db.prepare('DELETE FROM session_notes WHERE agent_id = ?').run(agentId);
    log.info({ agentId, count: result.changes }, 'Session notes cleared');
    return { ok: true, count: result.changes };
  } catch (e) {
    log.error({ err: e, agentId }, 'Failed to clear session notes');
    return { ok: true, count: 0 };
  }
}

/**
 * Build the scratchpad injection text for a system prompt.
 * This text is always injected, surviving context pruning.
 */
export function buildScratchpadInjection(agentId: string): string {
  const notes = listNotes(agentId);
  if (notes.length === 0) return '';

  const lines = ['## Agent Scratchpad (Session Notes)', ''];
  for (const note of notes) {
    lines.push(`### ${note.key}`);
    lines.push(note.value);
    lines.push('');
  }
  lines.push('These notes persist across context pruning. Use the session_note tool to update them.');

  return lines.join('\n');
}

/**
 * Read another agent's notes (cross-agent readable).
 * Useful for PM agents to read team notes, etc.
 */
export function readAgentNotes(targetAgentId: string): SessionNote[] {
  return listNotes(targetAgentId);
}
