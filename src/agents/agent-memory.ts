/**
 * Agent Memory System (#557)
 *
 * Provides conversation memory retrieval for agents. Agents can search
 * their past interactions across rooms and sessions, enabling cross-room
 * context and continuity.
 *
 * Layer: Agents (depends on Storage, Core)
 */

import { getDb } from '../storage/db.js';
import { logger } from '../core/logger.js';
import { ok, err } from '../core/contracts.js';
import type { Result } from '../core/contracts.js';

const log = logger.child({ module: 'agent-memory' });

/** Escape SQL LIKE metacharacters for safe text search */
function escapeLike(s: string): string {
  return s.replace(/[%_\\]/g, '\\$&');
}

// ─── Types ───

export interface MemoryEntry {
  id: string;
  content: string;
  role: string;
  room_id: string;
  agent_id: string | null;
  created_at: string;
  relevance?: number;
}

export interface MemorySearchParams {
  agentId?: string;
  buildingId: string;
  query?: string;
  roomId?: string;
  limit?: number;
  offset?: number;
}

// ─── Conversation Memory ───

/**
 * Search an agent's conversation history across all rooms in a building.
 * Returns messages matching the query, ordered by relevance (recency + text match).
 */
export function searchMemory(params: MemorySearchParams): Result {
  const db = getDb();
  const limit = params.limit ?? 20;
  const offset = params.offset ?? 0;

  let sql = `
    SELECT m.id, m.content, m.role, m.room_id, m.agent_id, m.created_at
    FROM messages m
    JOIN rooms r ON m.room_id = r.id
    JOIN floors f ON r.floor_id = f.id
    WHERE f.building_id = ?
  `;
  const sqlParams: unknown[] = [params.buildingId];

  if (params.agentId) {
    sql += ' AND m.agent_id = ?';
    sqlParams.push(params.agentId);
  }

  if (params.roomId) {
    sql += ' AND m.room_id = ?';
    sqlParams.push(params.roomId);
  }

  if (params.query) {
    sql += " AND m.content LIKE ? ESCAPE '\\'";
    sqlParams.push(`%${escapeLike(params.query)}%`);
  }

  sql += ' ORDER BY m.created_at DESC LIMIT ? OFFSET ?';
  sqlParams.push(limit, offset);

  try {
    const rows = db.prepare(sql).all(...sqlParams) as MemoryEntry[];
    log.debug({ buildingId: params.buildingId, query: params.query, results: rows.length }, 'Memory search');
    return ok(rows);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error({ err: msg }, 'Memory search failed');
    return err('MEMORY_ERROR', msg);
  }
}

/**
 * Get recent conversation context for an agent — last N messages across all rooms.
 * Used to build agent context for AI requests.
 */
export function getRecentContext(buildingId: string, agentId?: string, limit: number = 50): Result {
  const db = getDb();

  let sql = `
    SELECT m.id, m.content, m.role, m.room_id, m.agent_id, m.created_at,
           r.type as room_type, r.name as room_name
    FROM messages m
    JOIN rooms r ON m.room_id = r.id
    JOIN floors f ON r.floor_id = f.id
    WHERE f.building_id = ?
  `;
  const sqlParams: unknown[] = [buildingId];

  if (agentId) {
    sql += ' AND (m.agent_id = ? OR m.role = ?)';
    sqlParams.push(agentId, 'user');
  }

  sql += ' ORDER BY m.created_at DESC LIMIT ?';
  sqlParams.push(limit);

  try {
    const rows = db.prepare(sql).all(...sqlParams) as Array<MemoryEntry & { room_type: string; room_name: string }>;
    // Reverse to chronological order
    rows.reverse();
    return ok(rows);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return err('MEMORY_ERROR', msg);
  }
}

/**
 * Get memory statistics for a building — message counts by room and agent.
 */
export function getMemoryStats(buildingId: string): Result {
  const db = getDb();

  try {
    const totalMessages = db.prepare(`
      SELECT COUNT(*) as cnt FROM messages m
      JOIN rooms r ON m.room_id = r.id
      JOIN floors f ON r.floor_id = f.id
      WHERE f.building_id = ?
    `).get(buildingId) as { cnt: number };

    const byRoom = db.prepare(`
      SELECT r.name, r.type, COUNT(*) as cnt FROM messages m
      JOIN rooms r ON m.room_id = r.id
      JOIN floors f ON r.floor_id = f.id
      WHERE f.building_id = ?
      GROUP BY r.id ORDER BY cnt DESC LIMIT 50
    `).all(buildingId) as Array<{ name: string; type: string; cnt: number }>;

    const byAgent = db.prepare(`
      SELECT a.display_name, a.name, a.role, COUNT(*) as cnt FROM messages m
      JOIN agents a ON m.agent_id = a.id
      JOIN rooms r ON m.room_id = r.id
      JOIN floors f ON r.floor_id = f.id
      WHERE f.building_id = ?
      GROUP BY a.id ORDER BY cnt DESC LIMIT 50
    `).all(buildingId) as Array<{ display_name: string | null; name: string; role: string; cnt: number }>;

    return ok({
      totalMessages: totalMessages.cnt,
      byRoom,
      byAgent,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return err('MEMORY_ERROR', msg);
  }
}
