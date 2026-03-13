/**
 * Storage Layer — Global Search
 *
 * Searches across all entity types (tasks, agents, RAID entries, rooms,
 * milestones, messages) using parameterized SQL LIKE queries.
 * Returns results grouped by entity type, limited per-type to avoid
 * overwhelming the client.
 */

import { getDb } from './db.js';
import { ok, err } from '../core/contracts.js';
import type { Result } from '../core/contracts.js';

export interface SearchParams {
  buildingId: string;
  query: string;
  /** Filter to specific entity types: 'task', 'agent', 'raid', 'room', 'milestone', 'message' */
  filters?: string[];
  /** Max results per entity type */
  limit?: number;
}

interface SearchResultGroup {
  type: string;
  icon: string;
  label: string;
  items: Record<string, unknown>[];
  total: number;
}

export interface SearchResults {
  query: string;
  groups: SearchResultGroup[];
  totalHits: number;
}

export function globalSearch(params: SearchParams): Result {
  const { buildingId, query, filters = [], limit = 10 } = params;

  if (!query || query.trim().length === 0) {
    return err('INVALID_QUERY', 'Search query cannot be empty');
  }

  const db = getDb();
  const pattern = `%${query}%`;
  const groups: SearchResultGroup[] = [];
  let totalHits = 0;

  const shouldSearch = (type: string) => filters.length === 0 || filters.includes(type);

  // ─── Tasks ───
  if (shouldSearch('task')) {
    const rows = db.prepare(`
      SELECT t.id, t.title, t.description, t.status, t.priority, t.phase,
             a.display_name AS assignee_name
      FROM tasks t
      LEFT JOIN agents a ON t.assignee_id = a.id
      WHERE t.building_id = ? AND (t.title LIKE ? OR t.description LIKE ?)
      ORDER BY t.updated_at DESC
      LIMIT ?
    `).all(buildingId, pattern, pattern, limit + 1) as Record<string, unknown>[];

    const total = rows.length > limit ? rows.length : rows.length;
    const items = rows.slice(0, limit);
    if (items.length > 0) {
      groups.push({ type: 'task', icon: '\u2611', label: 'Tasks', items, total });
      totalHits += total;
    }
  }

  // ─── Agents ───
  if (shouldSearch('agent')) {
    const rows = db.prepare(`
      SELECT id, name, display_name, specialization, bio, role, status, photo_url
      FROM agents
      WHERE (name LIKE ? OR display_name LIKE ? OR specialization LIKE ? OR bio LIKE ?)
      ORDER BY updated_at DESC
      LIMIT ?
    `).all(pattern, pattern, pattern, pattern, limit + 1) as Record<string, unknown>[];

    const total = rows.length > limit ? rows.length : rows.length;
    const items = rows.slice(0, limit);
    if (items.length > 0) {
      groups.push({ type: 'agent', icon: '\u{1F916}', label: 'Agents', items, total });
      totalHits += total;
    }
  }

  // ─── RAID Entries ───
  if (shouldSearch('raid')) {
    const rows = db.prepare(`
      SELECT re.id, re.type, re.summary, re.rationale, re.status, re.phase,
             r.name AS room_name
      FROM raid_entries re
      LEFT JOIN rooms r ON re.room_id = r.id
      WHERE re.building_id = ? AND (re.summary LIKE ? OR re.rationale LIKE ?)
      ORDER BY re.created_at DESC
      LIMIT ?
    `).all(buildingId, pattern, pattern, limit + 1) as Record<string, unknown>[];

    const total = rows.length > limit ? rows.length : rows.length;
    const items = rows.slice(0, limit);
    if (items.length > 0) {
      groups.push({ type: 'raid', icon: '\u26A0', label: 'RAID Entries', items, total });
      totalHits += total;
    }
  }

  // ─── Rooms ───
  if (shouldSearch('room')) {
    const rows = db.prepare(`
      SELECT r.id, r.name, r.type, r.status, f.name AS floor_name
      FROM rooms r
      JOIN floors f ON r.floor_id = f.id
      WHERE f.building_id = ? AND (r.name LIKE ? OR r.type LIKE ?)
      ORDER BY r.created_at DESC
      LIMIT ?
    `).all(buildingId, pattern, pattern, limit + 1) as Record<string, unknown>[];

    const total = rows.length > limit ? rows.length : rows.length;
    const items = rows.slice(0, limit);
    if (items.length > 0) {
      groups.push({ type: 'room', icon: '\u{1F3E0}', label: 'Rooms', items, total });
      totalHits += total;
    }
  }

  // ─── Milestones ───
  if (shouldSearch('milestone')) {
    const rows = db.prepare(`
      SELECT id, title, description, status, due_date, phase
      FROM milestones
      WHERE building_id = ? AND (title LIKE ? OR description LIKE ?)
      ORDER BY ordinal ASC
      LIMIT ?
    `).all(buildingId, pattern, pattern, limit + 1) as Record<string, unknown>[];

    const total = rows.length > limit ? rows.length : rows.length;
    const items = rows.slice(0, limit);
    if (items.length > 0) {
      groups.push({ type: 'milestone', icon: '\u{1F3AF}', label: 'Milestones', items, total });
      totalHits += total;
    }
  }

  // ─── Messages ───
  if (shouldSearch('message')) {
    const rows = db.prepare(`
      SELECT m.id, m.content, m.role, m.created_at, m.thread_id,
             a.display_name AS agent_name, r.name AS room_name
      FROM messages m
      LEFT JOIN agents a ON m.agent_id = a.id
      LEFT JOIN rooms r ON m.room_id = r.id
      LEFT JOIN floors f ON r.floor_id = f.id
      WHERE f.building_id = ? AND m.content LIKE ?
      ORDER BY m.created_at DESC
      LIMIT ?
    `).all(buildingId, pattern, limit + 1) as Record<string, unknown>[];

    const total = rows.length > limit ? rows.length : rows.length;
    const items = rows.slice(0, limit);
    if (items.length > 0) {
      groups.push({ type: 'message', icon: '\u{1F4AC}', label: 'Messages', items, total });
      totalHits += total;
    }
  }

  return ok({ query, groups, totalHits } satisfies SearchResults);
}
