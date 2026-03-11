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

const log = logger.child({ module: 'raid-log' });

/**
 * Add a new RAID entry
 */
export function addRaidEntry({ buildingId, type, phase, roomId, summary, rationale, decidedBy, approvedBy, affectedAreas = [] }) {
  const db = getDb();
  const id = `raid_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  db.prepare(`
    INSERT INTO raid_entries (id, building_id, type, phase, room_id, summary, rationale, decided_by, approved_by, affected_areas)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, buildingId, type, phase, roomId, summary, rationale, decidedBy, approvedBy || null, JSON.stringify(affectedAreas));

  log.info({ id, type, phase, summary }, 'RAID entry added');
  return ok({ id });
}

/**
 * Search RAID log entries
 */
export function searchRaid({ buildingId, type, phase, status, query }) {
  const db = getDb();
  let sql = 'SELECT * FROM raid_entries WHERE building_id = ?';
  const params = [buildingId];

  if (type) { sql += ' AND type = ?'; params.push(type); }
  if (phase) { sql += ' AND phase = ?'; params.push(phase); }
  if (status) { sql += ' AND status = ?'; params.push(status); }
  if (query) { sql += ' AND (summary LIKE ? OR rationale LIKE ?)'; params.push(`%${query}%`, `%${query}%`); }

  sql += ' ORDER BY created_at DESC';

  const entries = db.prepare(sql).all(...params);
  return ok(entries.map(e => ({ ...e, affected_areas: JSON.parse(e.affected_areas || '[]') })));
}

/**
 * Build a context brief from RAID log for scope change re-entry
 */
export function buildContextBrief(buildingId) {
  const db = getDb();
  const entries = db.prepare(`
    SELECT * FROM raid_entries
    WHERE building_id = ? AND status = 'active'
    ORDER BY created_at ASC
  `).all(buildingId);

  const brief = {
    decisions: entries.filter(e => e.type === 'decision'),
    risks: entries.filter(e => e.type === 'risk'),
    assumptions: entries.filter(e => e.type === 'assumption'),
    issues: entries.filter(e => e.type === 'issue'),
    summary: `${entries.length} active RAID entries across project`,
  };

  return ok(brief);
}

/**
 * Update RAID entry status
 */
export function updateRaidStatus(id, status) {
  const db = getDb();
  db.prepare('UPDATE raid_entries SET status = ?, updated_at = datetime(?) WHERE id = ?')
    .run(status, new Date().toISOString(), id);
  return ok({ id, status });
}
