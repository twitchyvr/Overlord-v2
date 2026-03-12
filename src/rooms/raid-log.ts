/**
 * RAID Log — Risks, Assumptions, Issues, Decisions
 *
 * Searchable database of all project decisions and context.
 * Agents reference RAID log before starting work in any room.
 * Scope changes trigger re-entry with RAID context brief.
 */

import { getDb } from '../storage/db.js';
import { logger } from '../core/logger.js';
import { ok, err } from '../core/contracts.js';
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
  return ok({ id });
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
  let sql = 'SELECT * FROM raid_entries WHERE building_id = ?';
  const params: string[] = [buildingId];

  if (type) { sql += ' AND type = ?'; params.push(type); }
  if (phase) { sql += ' AND phase = ?'; params.push(phase); }
  if (status) { sql += ' AND status = ?'; params.push(status); }
  if (query) { sql += ' AND (summary LIKE ? OR rationale LIKE ?)'; params.push(`%${query}%`, `%${query}%`); }

  sql += ' ORDER BY created_at DESC';

  const entries = db.prepare(sql).all(...params) as RaidEntryRow[];
  return ok(entries.map((e) => ({ ...e, affected_areas: JSON.parse(e.affected_areas || '[]') as string[] })));
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
  if (!existing) return err('RAID_NOT_FOUND', `RAID entry ${id} does not exist`);

  const updates: string[] = [];
  const params: unknown[] = [];

  if (summary !== undefined) { updates.push('summary = ?'); params.push(summary); }
  if (rationale !== undefined) { updates.push('rationale = ?'); params.push(rationale); }
  if (decidedBy !== undefined) { updates.push('decided_by = ?'); params.push(decidedBy); }
  if (affectedAreas !== undefined) { updates.push('affected_areas = ?'); params.push(JSON.stringify(affectedAreas)); }

  if (updates.length === 0) return err('NO_CHANGES', 'No fields to update');

  updates.push("updated_at = datetime('now')");
  params.push(id);

  db.prepare(`UPDATE raid_entries SET ${updates.join(', ')} WHERE id = ?`).run(...params);

  const updated = db.prepare('SELECT * FROM raid_entries WHERE id = ?').get(id) as RaidEntryRow;
  log.info({ id, updatedFields: updates.length - 1 }, 'RAID entry updated');
  return ok({ ...updated, affected_areas: JSON.parse(updated.affected_areas || '[]') as string[] });
}

/**
 * Update RAID entry status
 */
export function updateRaidStatus({ id, status }: { id: string; status: string }): Result {
  const db = getDb();
  const VALID_STATUSES = ['active', 'superseded', 'closed'];
  if (!VALID_STATUSES.includes(status)) {
    return err('INVALID_STATUS', `Status must be one of: ${VALID_STATUSES.join(', ')}`);
  }
  const existing = db.prepare('SELECT id FROM raid_entries WHERE id = ?').get(id);
  if (!existing) return err('RAID_NOT_FOUND', `RAID entry ${id} does not exist`);
  db.prepare("UPDATE raid_entries SET status = ?, updated_at = datetime('now') WHERE id = ?").run(status, id);
  return ok({ id, status });
}
