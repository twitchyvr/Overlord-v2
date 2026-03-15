/**
 * Pipeline Evidence Collection & Storage (#612)
 *
 * Captures, validates, and stores evidence for each stage of the
 * 8-Stage Continuous Development Loop. Evidence is stored in the
 * pipeline_evidence table and queryable by task, building, or stage.
 *
 * Layer: Rooms (depends on Storage, Core)
 */

import { randomUUID } from 'crypto';
import { getDb } from '../storage/db.js';
import { logger } from '../core/logger.js';
import { ok, err } from '../core/contracts.js';
import type { Result } from '../core/contracts.js';

const log = logger.child({ module: 'pipeline-evidence' });

// ─── Stage Definitions ───

export const PIPELINE_STAGES = [
  'code', 'iterate', 'static-test', 'deep-test',
  'syntax', 'review', 'e2e', 'dogfood',
] as const;

export type PipelineStage = typeof PIPELINE_STAGES[number];

// ─── Evidence CRUD ───

export interface RecordEvidenceParams {
  taskId: string;
  buildingId: string;
  stage: PipelineStage;
  status: 'passed' | 'failed' | 'skipped';
  evidenceData?: Record<string, unknown>;
  attempt?: number;
  durationMs?: number;
}

export function recordEvidence(params: RecordEvidenceParams): Result {
  const db = getDb();
  const id = randomUUID();
  const stageIndex = PIPELINE_STAGES.indexOf(params.stage);

  if (stageIndex === -1) {
    return err('INVALID_STAGE', `Unknown pipeline stage: ${params.stage}`);
  }

  db.prepare(`
    INSERT INTO pipeline_evidence (id, task_id, building_id, stage, stage_index, status, evidence_data, attempt, completed_at, duration_ms)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?)
  `).run(
    id, params.taskId, params.buildingId, params.stage, stageIndex,
    params.status, JSON.stringify(params.evidenceData || {}),
    params.attempt ?? 1, params.durationMs ?? null,
  );

  log.info({ id, taskId: params.taskId, stage: params.stage, status: params.status }, 'Pipeline evidence recorded');
  return ok({ id, stage: params.stage, status: params.status });
}

export function getTaskEvidence(taskId: string): Result {
  const db = getDb();
  const rows = db.prepare(
    'SELECT * FROM pipeline_evidence WHERE task_id = ? ORDER BY stage_index, attempt',
  ).all(taskId) as Array<Record<string, unknown>>;

  return ok(rows.map(row => ({
    ...row,
    evidence_data: typeof row.evidence_data === 'string' ? JSON.parse(row.evidence_data as string) : row.evidence_data,
  })));
}

export function getBuildingEvidence(buildingId: string, stage?: PipelineStage): Result {
  const db = getDb();
  let sql = 'SELECT * FROM pipeline_evidence WHERE building_id = ?';
  const params: unknown[] = [buildingId];

  if (stage) {
    sql += ' AND stage = ?';
    params.push(stage);
  }

  sql += ' ORDER BY completed_at DESC LIMIT 100';
  const rows = db.prepare(sql).all(...params) as Array<Record<string, unknown>>;

  return ok(rows.map(row => ({
    ...row,
    evidence_data: typeof row.evidence_data === 'string' ? JSON.parse(row.evidence_data as string) : row.evidence_data,
  })));
}

/**
 * Get the latest pipeline status for a task — which stages have passed.
 */
export function getTaskPipelineStatus(taskId: string): Result {
  const db = getDb();

  const stages = PIPELINE_STAGES.map((stage, index) => {
    const latest = db.prepare(
      'SELECT status, attempt, completed_at, duration_ms FROM pipeline_evidence WHERE task_id = ? AND stage = ? ORDER BY attempt DESC LIMIT 1',
    ).get(taskId, stage) as { status: string; attempt: number; completed_at: string | null; duration_ms: number | null } | undefined;

    return {
      stage,
      index,
      status: latest?.status || 'not-reached',
      attempts: latest?.attempt || 0,
      completedAt: latest?.completed_at || null,
      durationMs: latest?.duration_ms || null,
    };
  });

  const currentIndex = stages.findIndex(s => s.status === 'not-reached' || s.status === 'failed');
  const allPassed = stages.every(s => s.status === 'passed');

  return ok({
    taskId,
    stages,
    currentStage: currentIndex >= 0 ? currentIndex : (allPassed ? 7 : 0),
    allPassed,
    totalAttempts: stages.reduce((sum, s) => sum + s.attempts, 0),
  });
}
