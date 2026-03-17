/**
 * Visual Testing & UAT (#681)
 *
 * Stores visual test results (screenshot captures, comparisons) and
 * UAT sign-off gates. Blocks phase advancement without sign-off.
 *
 * Flow:
 *   1. Agent captures screenshot via screenshot tool
 *   2. Result stored as visual_test record with status
 *   3. User reviews in UI — approve/reject with notes
 *   4. UAT gate checks all visual tests passed before phase advance
 *
 * Layer: Rooms (depends on Storage, Core)
 */

import { logger } from '../core/logger.js';
import { ok, err } from '../core/contracts.js';
import type { Result } from '../core/contracts.js';
import { getDb } from '../storage/db.js';

const log = logger.child({ module: 'visual-testing' });

// ── Visual Test CRUD ──

export interface VisualTestRecord {
  id: string;
  buildingId: string;
  taskId?: string;
  title: string;
  description?: string;
  screenshotPath?: string;
  baselinePath?: string;
  diffScore?: number;
  status: 'pending' | 'passed' | 'failed' | 'needs-review';
  reviewedBy?: string;
  reviewNotes?: string;
  reviewedAt?: string;
  createdAt: string;
}

/** Create a new visual test record */
export function createVisualTest(params: {
  buildingId: string;
  taskId?: string;
  title: string;
  description?: string;
  screenshotPath?: string;
  baselinePath?: string;
}): Result {
  const db = getDb();
  const id = `vt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  db.prepare(`
    INSERT INTO visual_tests (id, building_id, task_id, title, description, screenshot_path, baseline_path, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')
  `).run(id, params.buildingId, params.taskId || null, params.title,
    params.description || null, params.screenshotPath || null, params.baselinePath || null);

  log.info({ id, title: params.title }, 'Visual test created');
  return ok({ id, status: 'pending' });
}

/** Review a visual test — approve or reject */
export function reviewVisualTest(testId: string, params: {
  status: 'passed' | 'failed';
  reviewedBy: string;
  notes?: string;
}): Result {
  const db = getDb();
  const test = db.prepare('SELECT id, status FROM visual_tests WHERE id = ?').get(testId) as { id: string; status: string } | undefined;

  if (!test) return err('NOT_FOUND', 'Visual test not found');

  db.prepare(`
    UPDATE visual_tests SET status = ?, reviewed_by = ?, review_notes = ?,
      reviewed_at = datetime('now') WHERE id = ?
  `).run(params.status, params.reviewedBy, params.notes || null, testId);

  log.info({ testId, status: params.status, reviewedBy: params.reviewedBy }, 'Visual test reviewed');
  return ok({ testId, status: params.status });
}

/** List visual tests for a building */
export function listVisualTests(buildingId: string, options?: {
  status?: string;
  taskId?: string;
  limit?: number;
}): Result {
  const db = getDb();
  let sql = 'SELECT * FROM visual_tests WHERE building_id = ?';
  const params: (string | number)[] = [buildingId];

  if (options?.status) {
    sql += ' AND status = ?';
    params.push(options.status);
  }
  if (options?.taskId) {
    sql += ' AND task_id = ?';
    params.push(options.taskId);
  }

  sql += ' ORDER BY created_at DESC';

  if (options?.limit) {
    sql += ' LIMIT ?';
    params.push(options.limit);
  }

  const rows = db.prepare(sql).all(...params);
  return ok(rows);
}

/** Get UAT summary for a building — how many pass/fail/pending */
export function getUATSummary(buildingId: string): Result {
  const db = getDb();
  const rows = db.prepare(`
    SELECT status, COUNT(*) as count FROM visual_tests
    WHERE building_id = ? GROUP BY status
  `).all(buildingId) as Array<{ status: string; count: number }>;

  const summary: Record<string, number> = {
    pending: 0, passed: 0, failed: 0, 'needs-review': 0, total: 0,
  };
  for (const r of rows) {
    summary[r.status] = r.count;
    summary.total += r.count;
  }

  // UAT gate: passes only if no pending/failed tests exist
  const gateStatus = summary.total === 0
    ? 'no-tests'
    : (summary.pending > 0 || summary.failed > 0 || summary['needs-review'] > 0)
      ? 'blocked'
      : 'passed';

  return ok({ ...summary, gateStatus });
}

/** Check if UAT gate passes (for phase advancement) */
export function checkUATGate(buildingId: string): Result {
  const summary = getUATSummary(buildingId);
  if (!summary.ok) return summary;

  const data = summary.data as { gateStatus: string; total: number; pending: number; failed: number };
  if (data.gateStatus === 'no-tests') {
    return ok({ passes: true, reason: 'No visual tests defined' });
  }
  if (data.gateStatus === 'passed') {
    return ok({ passes: true, reason: 'All visual tests passed' });
  }

  return ok({
    passes: false,
    reason: `UAT blocked: ${data.pending} pending, ${data.failed} failed`,
    pending: data.pending,
    failed: data.failed,
  });
}
