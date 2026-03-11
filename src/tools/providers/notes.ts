/**
 * Notes Tool Provider
 *
 * DB-backed note storage and retrieval.
 * Notes are persisted to the `notes` table in SQLite.
 */

import { getDb } from '../../storage/db.js';
import { logger } from '../../core/logger.js';

const log = logger.child({ module: 'tool:notes' });

interface NoteRow {
  id: string;
  agent_id: string | null;
  room_id: string | null;
  content: string;
  tags: string;
  created_at: string;
}

interface RecordNoteParams {
  content: string;
  tags?: string[];
  agentId?: string;
  roomId?: string;
}

interface RecallNotesParams {
  query?: string;
  tag?: string;
  agentId?: string;
  limit?: number;
}

export function recordNote(params: RecordNoteParams): { id: string; content: string } {
  const db = getDb();
  const id = `note_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  db.prepare(
    'INSERT INTO notes (id, agent_id, room_id, content, tags) VALUES (?, ?, ?, ?, ?)',
  ).run(
    id,
    params.agentId || null,
    params.roomId || null,
    params.content,
    JSON.stringify(params.tags || []),
  );

  log.debug({ id, agentId: params.agentId }, 'Note recorded');
  return { id, content: params.content };
}

export function recallNotes(params: RecallNotesParams): NoteRow[] {
  const db = getDb();
  const conditions: string[] = [];
  const bindings: unknown[] = [];

  if (params.agentId) {
    conditions.push('agent_id = ?');
    bindings.push(params.agentId);
  }

  if (params.query) {
    conditions.push('content LIKE ?');
    bindings.push(`%${params.query}%`);
  }

  if (params.tag) {
    conditions.push('tags LIKE ?');
    bindings.push(`%"${params.tag}"%`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = params.limit || 10;

  const rows = db.prepare(
    `SELECT * FROM notes ${where} ORDER BY created_at DESC LIMIT ?`,
  ).all(...bindings, limit) as NoteRow[];

  log.debug({ count: rows.length, query: params.query }, 'Notes recalled');
  return rows;
}
