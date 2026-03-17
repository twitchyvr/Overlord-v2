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
  'syntax', 'review', 'e2e', 'visual-test', 'uat', 'dogfood',
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
    currentStage: currentIndex >= 0 ? currentIndex : (allPassed ? PIPELINE_STAGES.length - 1 : 0),
    allPassed,
    totalAttempts: stages.reduce((sum, s) => sum + s.attempts, 0),
  });
}

// ─── Failure Loop-Back (#613) ───

const MAX_ATTEMPTS = 5;

export interface FailureContext {
  failedStage: PipelineStage;
  failedAtAttempt: number;
  errors: string[];
  previousAttempts: Array<{ stage: string; status: string; attempt: number }>;
  suggestion: string;
}

/**
 * Record a stage failure and prepare context for loop-back to Stage 1.
 * Returns structured failure context that agents can use to fix the issue.
 */
export function loopBackToCode(params: {
  taskId: string;
  buildingId: string;
  failedStage: PipelineStage;
  errors: string[];
  attempt: number;
}): Result {
  const { taskId, buildingId, failedStage, errors, attempt } = params;

  // Record the failure as evidence
  const failResult = recordEvidence({
    taskId,
    buildingId,
    stage: failedStage,
    status: 'failed',
    evidenceData: { errors, loopBack: true },
    attempt,
  });

  if (!failResult.ok) return failResult;

  // Check if max attempts exceeded
  if (attempt >= MAX_ATTEMPTS) {
    log.warn({ taskId, failedStage, attempt }, 'Max pipeline attempts exceeded — escalating');
    return ok({
      action: 'escalate',
      reason: `Stage "${failedStage}" has failed ${attempt} times. Manual intervention required.`,
      failureContext: buildFailureContext(taskId, failedStage, errors, attempt),
    });
  }

  // Prepare loop-back context for the code stage
  const context = buildFailureContext(taskId, failedStage, errors, attempt);

  log.info({ taskId, failedStage, attempt, nextAttempt: attempt + 1 }, 'Pipeline loop-back to Stage 1');

  return ok({
    action: 'loop-back',
    targetStage: 'code',
    nextAttempt: attempt + 1,
    failureContext: context,
  });
}

function buildFailureContext(taskId: string, failedStage: PipelineStage, errors: string[], attempt: number): FailureContext {
  const db = getDb();

  // Get previous attempts for this task
  const previousAttempts = db.prepare(
    'SELECT stage, status, attempt FROM pipeline_evidence WHERE task_id = ? ORDER BY stage_index, attempt',
  ).all(taskId) as Array<{ stage: string; status: string; attempt: number }>;

  // Generate a suggestion based on the failed stage
  const suggestions: Record<string, string> = {
    'static-test': 'Fix the failing tests. Do NOT weaken tests or skip them.',
    'deep-test': 'Fix type errors or layer violations. Run tsc --noEmit locally.',
    'syntax': 'Fix lint/formatting errors. Run eslint with --fix if possible.',
    'review': 'Address code review feedback. Re-read the review comments.',
    'e2e': 'The feature broke at runtime. Boot the server and verify manually.',
    'visual-test': 'Screenshot comparison failed. Check the visual diff and fix layout/styling.',
    'uat': 'User acceptance test not approved. Address reviewer feedback before proceeding.',
    'dogfood': 'The feature does not work as expected through the UI. Test it yourself.',
  };

  return {
    failedStage,
    failedAtAttempt: attempt,
    errors,
    previousAttempts,
    suggestion: suggestions[failedStage] || 'Review the errors and fix the root cause.',
  };
}

// ─── Pipeline Dashboard (#684) ───

/**
 * Get a building-level pipeline dashboard summary.
 * Aggregates pass/fail/total across all tasks for each stage.
 */
export function getPipelineDashboard(buildingId: string): Result {
  const db = getDb();

  // Per-stage aggregate stats
  const stageStats = PIPELINE_STAGES.map((stage, index) => {
    const counts = db.prepare(`
      SELECT status, COUNT(*) as count FROM pipeline_evidence
      WHERE building_id = ? AND stage = ?
      GROUP BY status
    `).all(buildingId, stage) as Array<{ status: string; count: number }>;

    const stats: Record<string, number> = { passed: 0, failed: 0, skipped: 0, total: 0 };
    for (const c of counts) {
      stats[c.status] = c.count;
      stats.total += c.count;
    }

    const passRate = stats.total > 0 ? Math.round((stats.passed / stats.total) * 100) : 0;

    return { stage, index, ...stats, passRate };
  });

  // Overall stats
  const overallCounts = db.prepare(`
    SELECT status, COUNT(*) as count FROM pipeline_evidence
    WHERE building_id = ? GROUP BY status
  `).all(buildingId) as Array<{ status: string; count: number }>;

  const overall: Record<string, number> = { passed: 0, failed: 0, skipped: 0, total: 0 };
  for (const c of overallCounts) {
    overall[c.status] = c.count;
    overall.total += c.count;
  }

  // Active tasks (have pipeline evidence but not all stages passed)
  const activeTasks = db.prepare(`
    SELECT DISTINCT task_id FROM pipeline_evidence
    WHERE building_id = ?
    ORDER BY completed_at DESC LIMIT 20
  `).all(buildingId) as Array<{ task_id: string }>;

  const taskSummaries = activeTasks.map(t => {
    const status = getTaskPipelineStatus(t.task_id);
    return status.ok ? status.data : null;
  }).filter(Boolean);

  return ok({
    stages: stageStats,
    overall,
    stageCount: PIPELINE_STAGES.length,
    stageNames: [...PIPELINE_STAGES],
    activeTasks: taskSummaries,
  });
}
