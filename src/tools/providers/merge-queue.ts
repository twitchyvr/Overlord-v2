/**
 * Merge Queue Tool Provider (#944)
 *
 * Sequential merge strategy for worktree branches. Manages a FIFO queue
 * with priority override. Each merge: fetch main → rebase → test → merge.
 *
 * Protected by git:static resource lock via tool middleware — only one
 * git-mutating operation runs at a time per building.
 *
 * Layer: Tools (depends on Storage, Core only)
 *
 * Attribution:
 *   Sequential merge pattern inspired by @m13v's rebase-then-merge workflow.
 *   https://github.com/twitchyvr/Overlord-v2/issues/806#issuecomment-4103250652
 */

import * as crypto from 'node:crypto';
import { ok, err } from '../../core/contracts.js';
import { executeShell } from './shell.js';
import { getDb } from '../../storage/db.js';
import { logger } from '../../core/logger.js';
import type {
  Result,
  MergeQueueEntry,
  MergeDriftInfo,
  MergeQueueSnapshot,
  MergeQueueRow,
  MergeQueuePriority,
} from '../../core/contracts.js';

const log = logger.child({ module: 'tool:merge-queue' });

// Shell metacharacter rejection (same pattern as git-workflow.ts)
const SHELL_META_RE = /[;|&$`\\(){}<>!\n\r]/;
function rejectShellMeta(input: string, context: string): void {
  if (SHELL_META_RE.test(input)) {
    throw new Error(`Unsafe characters in ${context}: shell metacharacters are not allowed`);
  }
}

// ── Drift Thresholds ──

const DEFAULT_DRIFT_THRESHOLDS = {
  lowMaxCommits: 5,
  mediumMaxCommits: 20,
  maxOverlappingFiles: 10,
  maxCommitsBehind: 50,
};

export type MergeQueueAction = 'enqueue' | 'dequeue' | 'process' | 'status' | 'drift';

export interface MergeQueueParams {
  action: string;
  buildingId: string;
  projectDir?: string;
  branch?: string;
  worktreePath?: string;
  agentId?: string;
  priority?: string;
  entryId?: string;
}

// ── Row → Entry Conversion ──

function rowToEntry(row: MergeQueueRow): MergeQueueEntry {
  let mainDrift: MergeDriftInfo | null = null;
  try {
    const parsed = JSON.parse(row.main_drift);
    if (parsed && typeof parsed.commitsBehind === 'number') {
      mainDrift = parsed as MergeDriftInfo;
    }
  } catch { /* ignore invalid JSON */ }

  return {
    id: row.id,
    buildingId: row.building_id,
    branch: row.branch,
    worktreePath: row.worktree_path,
    agentId: row.agent_id,
    priority: row.priority as MergeQueuePriority,
    status: row.status as MergeQueueEntry['status'],
    position: row.position,
    mainDrift,
    failureReason: row.failure_reason,
    enqueuedAt: row.enqueued_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
  };
}

// ── Public API ──

/**
 * Execute a merge queue action.
 * Actions: enqueue, dequeue, process, status, drift
 */
export async function executeMergeQueue(
  params: MergeQueueParams,
): Promise<Result<MergeQueueEntry | MergeQueueSnapshot | MergeDriftInfo | { cancelled: boolean }>> {
  const { action, buildingId } = params;

  try {
    switch (action) {
      case 'enqueue':
        return await enqueue(params);
      case 'dequeue':
        return await dequeue(params);
      case 'process':
        return await processNext(params);
      case 'status':
        return getStatus(buildingId);
      case 'drift':
        return await checkDrift(params);
      default:
        return err('INVALID_ACTION', `Unknown merge queue action: ${action}`, { retryable: false });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error({ error: message, action, buildingId }, 'Merge queue operation failed');
    return err('MERGE_QUEUE_ERROR', `Merge queue failed: ${message}`, { retryable: true });
  }
}

// ── Actions ──

async function enqueue(params: MergeQueueParams): Promise<Result<MergeQueueEntry>> {
  const { buildingId, branch, worktreePath, agentId, priority } = params;

  if (!branch) return err('MISSING_PARAM', 'branch is required for enqueue', { retryable: false });
  if (!worktreePath) return err('MISSING_PARAM', 'worktreePath is required for enqueue', { retryable: false });
  if (!agentId) return err('MISSING_PARAM', 'agentId is required for enqueue', { retryable: false });

  rejectShellMeta(branch, 'branch name');
  rejectShellMeta(worktreePath, 'worktree path');

  const validPriority = (['hotfix', 'feature', 'refactor', 'auto'].includes(priority || '')
    ? priority
    : 'feature') as MergeQueuePriority;

  const db = getDb();
  const id = crypto.randomUUID();

  // Get next position for this building
  const maxRow = db.prepare(
    `SELECT COALESCE(MAX(position), -1) as max_pos FROM merge_queue WHERE building_id = ? AND status = 'queued'`,
  ).get(buildingId) as { max_pos: number } | undefined;
  const position = (maxRow?.max_pos ?? -1) + 1;

  db.prepare(
    `INSERT INTO merge_queue (id, building_id, branch, worktree_path, agent_id, priority, status, position)
     VALUES (?, ?, ?, ?, ?, ?, 'queued', ?)`,
  ).run(id, buildingId, branch, worktreePath, agentId, validPriority, position);

  const row = db.prepare(`SELECT * FROM merge_queue WHERE id = ?`).get(id) as MergeQueueRow;
  const entry = rowToEntry(row);

  log.info({ entryId: id, branch, agentId, priority: validPriority, position }, 'Branch enqueued for merge');
  return ok(entry);
}

async function dequeue(params: MergeQueueParams): Promise<Result<{ cancelled: boolean }>> {
  const { entryId } = params;

  if (!entryId) return err('MISSING_PARAM', 'entryId is required for dequeue', { retryable: false });

  const db = getDb();
  const result = db.prepare(
    `UPDATE merge_queue SET status = 'cancelled', completed_at = datetime('now') WHERE id = ? AND status = 'queued'`,
  ).run(entryId);

  if (result.changes === 0) {
    return err('NOT_FOUND', `Entry ${entryId} not found or not in queued state`, { retryable: false });
  }

  log.info({ entryId }, 'Merge queue entry cancelled');
  return ok({ cancelled: true });
}

async function processNext(params: MergeQueueParams): Promise<Result<MergeQueueEntry>> {
  const { buildingId, projectDir } = params;

  if (!projectDir) return err('MISSING_PARAM', 'projectDir is required for process', { retryable: false });

  const db = getDb();

  // Find next entry: priority ordering, then FIFO
  const row = db.prepare(
    `SELECT * FROM merge_queue
     WHERE building_id = ? AND status = 'queued'
     ORDER BY
       CASE priority WHEN 'hotfix' THEN 0 WHEN 'feature' THEN 1 WHEN 'refactor' THEN 2 WHEN 'auto' THEN 3 END,
       position ASC
     LIMIT 1`,
  ).get(buildingId) as MergeQueueRow | undefined;

  if (!row) {
    return err('QUEUE_EMPTY', 'No queued entries to process', { retryable: false });
  }

  const entryId = row.id;
  const branch = row.branch;
  const wtPath = row.worktree_path;

  // Defense-in-depth: re-validate branch from DB before shell use (#958)
  rejectShellMeta(branch, 'branch name (from DB)');
  rejectShellMeta(wtPath, 'worktree path (from DB)');

  log.info({ entryId, branch }, 'Processing merge queue entry');

  // NOTE: Atomicity of SELECT→UPDATE is guaranteed by the external git:static
  // resource lock acquired by tool-middleware. processNext is never called
  // concurrently for the same building. See tool-resource-map.ts (#958).

  // ── Step 1: Check drift ──
  const updateStatus = (status: string, extra?: Record<string, unknown>) => {
    const sets: string[] = ['status = ?'];
    const params: unknown[] = [status];

    if (status !== 'queued' && !extra?.skipStarted) {
      sets.push('started_at = COALESCE(started_at, datetime(\'now\'))');
    }
    if (extra?.failureReason) {
      sets.push('failure_reason = ?');
      params.push(String(extra.failureReason));
    }
    if (extra?.mainDrift) {
      sets.push('main_drift = ?');
      params.push(JSON.stringify(extra.mainDrift));
    }
    if (['merged', 'failed', 'cancelled'].includes(status)) {
      sets.push('completed_at = datetime(\'now\')');
    }

    params.push(entryId);
    db.prepare(`UPDATE merge_queue SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  };

  // ── Step 2: Fetch and detect drift ──
  updateStatus('rebasing');

  const fetchResult = await executeShell({
    command: `git fetch origin main`,
    cwd: wtPath,
    timeout: 30_000,
  });

  if (fetchResult.exitCode !== 0) {
    updateStatus('failed', { failureReason: 'FETCH_FAILED' });
    return err('FETCH_FAILED', `git fetch failed: ${fetchResult.stderr}`, { retryable: true });
  }

  // Drift detection
  const driftResult = await detectDrift(wtPath);
  if (driftResult) {
    updateStatus('rebasing', { mainDrift: driftResult, skipStarted: true });

    // If drift is too high, reject
    if (driftResult.commitsBehind > DEFAULT_DRIFT_THRESHOLDS.maxCommitsBehind) {
      updateStatus('failed', {
        failureReason: 'DRIFT_TOO_HIGH',
        mainDrift: driftResult,
      });
      return err('DRIFT_TOO_HIGH',
        `Main has moved ${driftResult.commitsBehind} commits since branch creation (threshold: ${DEFAULT_DRIFT_THRESHOLDS.maxCommitsBehind})`,
        { retryable: false },
      );
    }
  }

  // ── Step 3: Rebase ──
  const rebaseResult = await executeShell({
    command: `git rebase origin/main`,
    cwd: wtPath,
    timeout: 60_000,
  });

  if (rebaseResult.exitCode !== 0) {
    // Abort the rebase to clean up
    await executeShell({ command: `git rebase --abort`, cwd: wtPath, timeout: 10_000 });
    updateStatus('failed', { failureReason: 'REBASE_CONFLICT' });
    return err('REBASE_CONFLICT',
      `Rebase onto main failed: ${rebaseResult.stderr || rebaseResult.stdout}`,
      { retryable: false },
    );
  }

  // ── Step 4: Run tests ──
  updateStatus('testing');

  const testResult = await executeShell({
    command: `npm test`,
    cwd: wtPath,
    timeout: 120_000,
  });

  if (testResult.exitCode !== 0) {
    updateStatus('failed', { failureReason: 'TEST_FAILURE' });
    return err('TEST_FAILURE',
      `Tests failed after rebase: ${testResult.stderr || testResult.stdout}`.slice(0, 500),
      { retryable: false },
    );
  }

  // ── Step 5: Merge to main ──
  updateStatus('merging');

  // Switch to main in the project dir and merge
  const mergeResult = await executeShell({
    command: `git checkout main && git merge --ff-only "${branch}"`,
    cwd: projectDir,
    timeout: 30_000,
  });

  if (mergeResult.exitCode !== 0) {
    updateStatus('failed', { failureReason: 'MERGE_FAILED' });
    return err('MERGE_FAILED',
      `Fast-forward merge failed: ${mergeResult.stderr || mergeResult.stdout}`,
      { retryable: true },
    );
  }

  // ── Step 6: Push ──
  const pushResult = await executeShell({
    command: `git push origin main`,
    cwd: projectDir,
    timeout: 30_000,
  });

  const pushFailed = pushResult.exitCode !== 0;
  if (pushFailed) {
    // Merge succeeded locally but push failed — log warning (#958)
    log.warn({ entryId, branch, stderr: pushResult.stderr }, 'Push after merge failed — merged locally only');
  }

  // ── Step 7: Mark complete ──
  updateStatus('merged', pushFailed ? { failureReason: 'PUSH_FAILED_LOCAL_ONLY' } : undefined);

  const updatedRow = db.prepare(`SELECT * FROM merge_queue WHERE id = ?`).get(entryId) as MergeQueueRow;
  const entry = rowToEntry(updatedRow);

  log.info({ entryId, branch, pushFailed }, 'Branch merged successfully');
  return ok(entry);
}

function getStatus(buildingId: string): Result<MergeQueueSnapshot> {
  const db = getDb();
  const rows = db.prepare(
    `SELECT * FROM merge_queue
     WHERE building_id = ? AND status NOT IN ('merged', 'cancelled')
     ORDER BY
       CASE priority WHEN 'hotfix' THEN 0 WHEN 'feature' THEN 1 WHEN 'refactor' THEN 2 WHEN 'auto' THEN 3 END,
       position ASC`,
  ).all(buildingId) as MergeQueueRow[];

  const entries = rows.map(rowToEntry);
  const currentlyMerging = rows.find(r =>
    ['rebasing', 'testing', 'merging'].includes(r.status),
  )?.id ?? null;

  return ok({
    buildingId,
    entries,
    currentlyMerging,
    updatedAt: Date.now(),
  });
}

async function checkDrift(params: MergeQueueParams): Promise<Result<MergeDriftInfo>> {
  const { projectDir, branch } = params;

  if (!projectDir) return err('MISSING_PARAM', 'projectDir is required for drift', { retryable: false });
  if (!branch) return err('MISSING_PARAM', 'branch is required for drift', { retryable: false });

  rejectShellMeta(branch, 'branch name');

  // Fetch latest main
  await executeShell({ command: `git fetch origin main`, cwd: projectDir, timeout: 30_000 });

  const drift = await detectDrift(projectDir, branch);
  if (!drift) {
    return ok({ commitsBehind: 0, overlappingFiles: [], driftLevel: 'low' });
  }

  return ok(drift);
}

// ── Internal Helpers ──

async function detectDrift(cwd: string, branch?: string): Promise<MergeDriftInfo | null> {
  // Defense-in-depth: validate branch before shell interpolation (#958)
  if (branch) rejectShellMeta(branch, 'branch name (drift check)');
  const ref = branch ? `${branch}` : 'HEAD';

  // Count commits behind main
  const countResult = await executeShell({
    command: `git rev-list --count ${ref}..origin/main`,
    cwd,
    timeout: 10_000,
  });

  const commitsBehind = parseInt(countResult.stdout.trim(), 10) || 0;

  // Find overlapping files (modified in both branch and main since divergence)
  const overlapResult = await executeShell({
    command: `git diff --name-only origin/main...${ref}`,
    cwd,
    timeout: 10_000,
  });

  const overlappingFiles = overlapResult.stdout.trim()
    ? overlapResult.stdout.trim().split('\n').filter(Boolean)
    : [];

  // Classify drift level
  let driftLevel: 'low' | 'medium' | 'high';
  if (commitsBehind <= DEFAULT_DRIFT_THRESHOLDS.lowMaxCommits && overlappingFiles.length === 0) {
    driftLevel = 'low';
  } else if (
    commitsBehind <= DEFAULT_DRIFT_THRESHOLDS.mediumMaxCommits &&
    overlappingFiles.length <= DEFAULT_DRIFT_THRESHOLDS.maxOverlappingFiles
  ) {
    driftLevel = 'medium';
  } else {
    driftLevel = 'high';
  }

  return { commitsBehind, overlappingFiles, driftLevel };
}
