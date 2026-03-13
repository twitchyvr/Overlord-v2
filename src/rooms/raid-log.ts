/**
 * RAID Log — Risks, Assumptions, Issues, Decisions
 *
 * Searchable database of all project decisions and context.
 * Agents reference RAID log before starting work in any room.
 * Scope changes trigger re-entry with RAID context brief.
 */

import { getDb } from '../storage/db.js';
import { logger } from '../core/logger.js';
import { ok, err, safeJsonParse } from '../core/contracts.js';
import type { Result, RaidEntryRow } from '../core/contracts.js';

const log = logger.child({ module: 'raid-log' });

interface AddRaidEntryParams {
  buildingId: string;
  type: string;
  phase: string;
  roomId?: string;
  summary: string;
  rationale?: string;
  decidedBy?: string;
  approvedBy?: string;
  affectedAreas?: string[];
}

/**
 * Add a new RAID entry
 */
export function addRaidEntry({ buildingId, type, phase, roomId, summary, rationale, decidedBy, approvedBy, affectedAreas = [] }: AddRaidEntryParams): Result {
  const db = getDb();
  const id = `raid_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  db.prepare(`
    INSERT INTO raid_entries (id, building_id, type, phase, room_id, summary, rationale, decided_by, approved_by, affected_areas)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, buildingId, type, phase, roomId || null, summary, rationale || null, decidedBy || null, approvedBy || null, JSON.stringify(affectedAreas));

  log.info({ id, type, phase, summary }, 'RAID entry added');

  // Return the full entry with room name so consumers (socket-bridge) can push it into the store directly
  const inserted = db.prepare(`
    SELECT raid_entries.*, rooms.name AS room_name
    FROM raid_entries
    LEFT JOIN rooms ON raid_entries.room_id = rooms.id
    WHERE raid_entries.id = ?
  `).get(id) as RaidEntryRow & { room_name?: string };
  return ok({ ...inserted, affected_areas: safeJsonParse<string[]>(inserted.affected_areas, []) });
}

interface SearchRaidParams {
  buildingId: string;
  type?: string;
  phase?: string;
  status?: string;
  query?: string;
}

/**
 * Search RAID log entries
 */
export function searchRaid({ buildingId, type, phase, status, query }: SearchRaidParams): Result {
  const db = getDb();
  let sql = `SELECT raid_entries.*, rooms.name AS room_name
    FROM raid_entries
    LEFT JOIN rooms ON raid_entries.room_id = rooms.id
    WHERE raid_entries.building_id = ?`;
  const params: string[] = [buildingId];

  if (type) { sql += ' AND raid_entries.type = ?'; params.push(type); }
  if (phase) { sql += ' AND raid_entries.phase = ?'; params.push(phase); }
  if (status) { sql += ' AND raid_entries.status = ?'; params.push(status); }
  if (query) { sql += ' AND (raid_entries.summary LIKE ? OR raid_entries.rationale LIKE ?)'; params.push(`%${query}%`, `%${query}%`); }

  sql += ' ORDER BY raid_entries.created_at DESC';

  const entries = db.prepare(sql).all(...params) as (RaidEntryRow & { room_name?: string })[];
  return ok(entries.map((e) => ({ ...e, affected_areas: safeJsonParse<string[]>(e.affected_areas, []) })));
}

/**
 * Build a context brief from RAID log for scope change re-entry
 */
export function buildContextBrief(buildingId: string): Result {
  const db = getDb();
  const entries = db.prepare(`
    SELECT * FROM raid_entries
    WHERE building_id = ? AND status = 'active'
    ORDER BY created_at ASC
  `).all(buildingId) as RaidEntryRow[];

  const brief = {
    decisions: entries.filter((e) => e.type === 'decision'),
    risks: entries.filter((e) => e.type === 'risk'),
    assumptions: entries.filter((e) => e.type === 'assumption'),
    issues: entries.filter((e) => e.type === 'issue'),
    summary: `${entries.length} active RAID entries across project`,
  };

  return ok(brief);
}

interface UpdateRaidEntryParams {
  id: string;
  summary?: string;
  rationale?: string;
  decidedBy?: string;
  affectedAreas?: string[];
}

/**
 * Update RAID entry fields (summary, rationale, decided_by, affected_areas)
 */
export function updateRaidEntry({ id, summary, rationale, decidedBy, affectedAreas }: UpdateRaidEntryParams): Result {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM raid_entries WHERE id = ?').get(id) as RaidEntryRow | undefined;
  if (!existing) return err('RAID_NOT_FOUND', 'This entry no longer exists. It may have been deleted.');

  const updates: string[] = [];
  const params: unknown[] = [];

  if (summary !== undefined) { updates.push('summary = ?'); params.push(summary); }
  if (rationale !== undefined) { updates.push('rationale = ?'); params.push(rationale); }
  if (decidedBy !== undefined) { updates.push('decided_by = ?'); params.push(decidedBy); }
  if (affectedAreas !== undefined) { updates.push('affected_areas = ?'); params.push(JSON.stringify(affectedAreas)); }

  if (updates.length === 0) return err('NO_CHANGES', 'No changes were made. Edit a field and try again.');

  updates.push("updated_at = datetime('now')");
  params.push(id);

  db.prepare(`UPDATE raid_entries SET ${updates.join(', ')} WHERE id = ?`).run(...params);

  const updated = db.prepare('SELECT * FROM raid_entries WHERE id = ?').get(id) as RaidEntryRow;
  log.info({ id, updatedFields: updates.length - 1 }, 'RAID entry updated');
  return ok({ ...updated, affected_areas: safeJsonParse<string[]>(updated.affected_areas, []) });
}

/**
 * Update RAID entry status
 */
export function updateRaidStatus({ id, status }: { id: string; status: string }): Result {
  const db = getDb();
  const VALID_STATUSES = ['active', 'superseded', 'closed'];
  if (!VALID_STATUSES.includes(status)) {
    return err('INVALID_STATUS', `Please choose a valid status: ${VALID_STATUSES.join(', ')}`);
  }
  const existing = db.prepare('SELECT id FROM raid_entries WHERE id = ?').get(id);
  if (!existing) return err('RAID_NOT_FOUND', 'This entry no longer exists. It may have been deleted.');
  db.prepare("UPDATE raid_entries SET status = ?, updated_at = datetime('now') WHERE id = ?").run(status, id);
  const updated = db.prepare('SELECT * FROM raid_entries WHERE id = ?').get(id) as Record<string, unknown>;
  return ok(updated);
}
