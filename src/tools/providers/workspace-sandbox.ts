/**
 * Workspace Sandbox Tool Provider
 *
 * Creates isolated workspaces using git worktrees. Each sandbox is a
 * separate checkout of a branch, enabling parallel work without conflicts.
 */

import * as crypto from 'node:crypto';
import { ok, err } from '../../core/contracts.js';
import { executeShell } from './shell.js';
import type { Result } from '../../core/contracts.js';

export type SandboxAction = 'create' | 'destroy' | 'list' | 'status' | 'merge-ready';

export interface WorktreeEntry {
  worktreePath: string;
  branch: string;
  commit: string;
  bare: boolean;
}

export interface WorkspaceSandboxResult {
  action: SandboxAction;
  worktreePath?: string;
  branch?: string;
  isClean?: boolean;
  worktrees?: WorktreeEntry[];
  ready?: boolean;
  commitsAhead?: number;
  output: string;
}

/**
 * Generate a deterministic short hash for a worktree path based on
 * the project directory and branch name.
 */
function worktreeHash(projectDir: string, branch: string): string {
  return crypto.createHash('sha256').update(projectDir + ':' + branch).digest('hex').slice(0, 12);
}

/**
 * Build the worktree path under /tmp.
 */
function worktreePath(projectDir: string, branch: string): string {
  return '/tmp/overlord-worktree-' + worktreeHash(projectDir, branch);
}

/**
 * Parse `git worktree list --porcelain` output into structured entries.
 */
export function parseWorktreeList(output: string): WorktreeEntry[] {
  const entries: WorktreeEntry[] = [];
  let current: Partial<WorktreeEntry> = {};

  for (const line of output.split('\n')) {
    if (line.startsWith('worktree ')) {
      if (current.worktreePath) {
        entries.push(current as WorktreeEntry);
      }
      current = { worktreePath: line.slice(9).trim(), branch: '', commit: '', bare: false };
    } else if (line.startsWith('HEAD ')) {
      current.commit = line.slice(5).trim();
    } else if (line.startsWith('branch ')) {
      // branch refs/heads/main -> main
      const ref = line.slice(7).trim();
      current.branch = ref.replace('refs/heads/', '');
    } else if (line.trim() === 'bare') {
      current.bare = true;
    }
  }

  // Push last entry
  if (current.worktreePath) {
    entries.push(current as WorktreeEntry);
  }

  return entries;
}

export async function executeWorkspaceSandbox(params: {
  action: SandboxAction;
  projectDir: string;
  branch?: string;
}): Promise<Result<WorkspaceSandboxResult>> {
  const { action, projectDir, branch } = params;

  try {
    switch (action) {
      case 'create':
        return await createWorktree(projectDir, branch || 'main');
      case 'destroy':
        return await destroyWorktree(projectDir, branch || 'main');
      case 'list':
        return await listWorktrees(projectDir);
      case 'status':
        return await worktreeStatus(projectDir, branch || 'main');
      case 'merge-ready':
        return await checkMergeReady(projectDir, branch || 'main');
      default:
        return err('INVALID_ACTION', `Unknown sandbox action: ${action}`, { retryable: false });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return err('SANDBOX_ERROR', `Workspace sandbox failed: ${message}`, { retryable: true });
  }
}

async function createWorktree(projectDir: string, branch: string): Promise<Result<WorkspaceSandboxResult>> {
  const wtPath = worktreePath(projectDir, branch);

  // Check if worktree already exists
  const checkResult = await executeShell({
    command: `git worktree list --porcelain`,
    cwd: projectDir,
    timeout: 10_000,
  });

  if (checkResult.stdout.includes(wtPath)) {
    return err('ALREADY_EXISTS', `Worktree already exists at ${wtPath}`, { retryable: false });
  }

  const result = await executeShell({
    command: `git worktree add "${wtPath}" "${branch}"`,
    cwd: projectDir,
    timeout: 30_000,
  });

  if (result.exitCode !== 0) {
    return err('CREATE_FAILED', `Failed to create worktree: ${result.stderr || result.stdout}`, { retryable: true });
  }

  return ok({
    action: 'create',
    worktreePath: wtPath,
    branch,
    isClean: true,
    output: `Created worktree at ${wtPath} on branch ${branch}`,
  });
}

async function destroyWorktree(projectDir: string, branch: string): Promise<Result<WorkspaceSandboxResult>> {
  const wtPath = worktreePath(projectDir, branch);

  const result = await executeShell({
    command: `git worktree remove "${wtPath}" --force`,
    cwd: projectDir,
    timeout: 30_000,
  });

  if (result.exitCode !== 0) {
    return err('DESTROY_FAILED', `Failed to remove worktree: ${result.stderr || result.stdout}`, { retryable: true });
  }

  return ok({
    action: 'destroy',
    worktreePath: wtPath,
    branch,
    output: `Removed worktree at ${wtPath}`,
  });
}

async function listWorktrees(projectDir: string): Promise<Result<WorkspaceSandboxResult>> {
  const result = await executeShell({
    command: 'git worktree list --porcelain',
    cwd: projectDir,
    timeout: 10_000,
  });

  if (result.exitCode !== 0) {
    return err('LIST_FAILED', `Failed to list worktrees: ${result.stderr || result.stdout}`, { retryable: true });
  }

  const worktrees = parseWorktreeList(result.stdout);

  return ok({
    action: 'list',
    worktrees,
    output: worktrees.length === 0
      ? 'No worktrees'
      : worktrees.map(w => `${w.worktreePath} [${w.branch || 'detached'}] ${w.commit.slice(0, 8)}`).join('\n'),
  });
}

async function worktreeStatus(projectDir: string, branch: string): Promise<Result<WorkspaceSandboxResult>> {
  const wtPath = worktreePath(projectDir, branch);

  // Check if worktree exists
  const listResult = await executeShell({
    command: 'git worktree list --porcelain',
    cwd: projectDir,
    timeout: 10_000,
  });

  const worktrees = parseWorktreeList(listResult.stdout);
  const entry = worktrees.find(w => w.worktreePath === wtPath);

  if (!entry) {
    return ok({
      action: 'status',
      worktreePath: wtPath,
      branch,
      isClean: false,
      output: `Worktree does not exist at ${wtPath}`,
    });
  }

  // Check if working tree is clean
  const statusResult = await executeShell({
    command: 'git status --porcelain',
    cwd: wtPath,
    timeout: 10_000,
  });

  const isClean = statusResult.stdout.trim().length === 0;

  return ok({
    action: 'status',
    worktreePath: wtPath,
    branch,
    isClean,
    output: `Worktree at ${wtPath}: ${isClean ? 'clean' : 'has uncommitted changes'}`,
  });
}

/**
 * Check if a worktree branch is ready to merge (#944).
 * Verifies the worktree exists, is clean, and has commits ahead of main.
 */
async function checkMergeReady(projectDir: string, branch: string): Promise<Result<WorkspaceSandboxResult>> {
  const wtPath = worktreePath(projectDir, branch);

  // Check worktree exists
  const listResult = await executeShell({
    command: 'git worktree list --porcelain',
    cwd: projectDir,
    timeout: 10_000,
  });

  const worktrees = parseWorktreeList(listResult.stdout);
  const entry = worktrees.find(w => w.worktreePath === wtPath);

  if (!entry) {
    return ok({
      action: 'merge-ready',
      worktreePath: wtPath,
      branch,
      ready: false,
      isClean: false,
      commitsAhead: 0,
      output: `Worktree does not exist at ${wtPath}`,
    });
  }

  // Check if working tree is clean
  const statusResult = await executeShell({
    command: 'git status --porcelain',
    cwd: wtPath,
    timeout: 10_000,
  });
  const isClean = statusResult.stdout.trim().length === 0;

  // Count commits ahead of main
  const countResult = await executeShell({
    command: 'git rev-list --count main..HEAD',
    cwd: wtPath,
    timeout: 10_000,
  });
  const commitsAhead = parseInt(countResult.stdout.trim(), 10) || 0;

  const ready = isClean && commitsAhead > 0;

  return ok({
    action: 'merge-ready',
    worktreePath: wtPath,
    branch,
    ready,
    isClean,
    commitsAhead,
    output: ready
      ? `Worktree at ${wtPath} is ready to merge (${commitsAhead} commits ahead, clean)`
      : `Worktree at ${wtPath} is NOT ready: ${!isClean ? 'has uncommitted changes' : 'no commits ahead of main'}`,
  });
}
