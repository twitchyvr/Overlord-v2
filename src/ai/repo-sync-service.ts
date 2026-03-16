/**
 * Repo Sync Service — Upstream Change Detection
 *
 * Checks linked repos for upstream changes by comparing the stored
 * last_commit against the current HEAD of the tracked branch via `gh` CLI.
 * Returns sync status for all repos in a building.
 *
 * Layer: AI (imports only from Core)
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import { logger } from '../core/logger.js';
import { ok, err } from '../core/contracts.js';
import type { Result } from '../core/contracts.js';

const execFileAsync = promisify(execFile);

const log = logger.child({ module: 'ai:repo-sync' });

// ─── Types ───

export interface RepoSyncInput {
  id: string;
  name: string;
  repoUrl: string;
  branch: string;
  lastCommit: string | null;
  lastSyncedAt: string | null;
}

export interface RepoSyncStatus {
  id: string;
  name: string;
  repoUrl: string;
  branch: string;
  localCommit: string | null;
  upstreamCommit: string | null;
  commitsBehind: number;
  lastSyncedAt: string | null;
  checkedAt: string;
  isSynced: boolean;
  error: string | null;
}

export interface SyncStatusResult {
  repos: RepoSyncStatus[];
  summary: {
    repoCount: number;
    reposSynced: number;
    reposBehind: number;
    reposErrored: number;
  };
}

// ─── Upstream Commit Fetch ───

/**
 * Extract owner/repo from a GitHub URL.
 * Accepts: https://github.com/owner/repo, https://github.com/owner/repo.git
 */
function extractOwnerRepo(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (!parsed.hostname.includes('github')) return null;
    const parts = parsed.pathname.replace(/^\//, '').replace(/\.git$/, '').split('/');
    if (parts.length < 2) return null;
    return `${parts[0]}/${parts[1]}`;
  } catch {
    return null;
  }
}

/**
 * Fetch the latest commit SHA and commit count ahead of a given commit
 * for a specific branch using `gh` CLI.
 */
const OWNER_REPO_RE = /^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+$/;
const BRANCH_RE = /^[a-zA-Z0-9._\/-]+$/;

async function fetchUpstreamInfo(
  ownerRepo: string,
  branch: string,
  lastCommit: string | null,
): Promise<{ commit: string | null; commitsBehind: number; error: string | null }> {
  // Validate inputs to prevent API path traversal
  if (!OWNER_REPO_RE.test(ownerRepo)) {
    return { commit: null, commitsBehind: 0, error: `Invalid owner/repo format: ${ownerRepo}` };
  }
  if (!BRANCH_RE.test(branch)) {
    return { commit: null, commitsBehind: 0, error: `Invalid branch format: ${branch}` };
  }
  try {
    // Get the latest commit on the tracked branch
    const { stdout } = await execFileAsync('gh', [
      'api',
      `repos/${ownerRepo}/commits/${branch}`,
      '--jq', '.sha',
    ], { timeout: 15_000 });

    const upstreamCommit = stdout.trim();
    if (!upstreamCommit) {
      return { commit: null, commitsBehind: 0, error: 'Empty commit SHA from GitHub API' };
    }

    // If we have a stored commit, count how many commits ahead upstream is
    let commitsBehind = 0;
    if (lastCommit && lastCommit !== upstreamCommit) {
      try {
        const { stdout: compareOut } = await execFileAsync('gh', [
          'api',
          `repos/${ownerRepo}/compare/${lastCommit}...${branch}`,
          '--jq', '.ahead_by',
        ], { timeout: 15_000 });

        const parsed = parseInt(compareOut.trim(), 10);
        if (!isNaN(parsed)) commitsBehind = parsed;
        else commitsBehind = 1; // At least 1 if commits differ
      } catch {
        // Compare failed (commit may have been force-pushed away) — mark as 1 behind
        commitsBehind = 1;
      }
    }

    return { commit: upstreamCommit, commitsBehind, error: null };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.warn({ ownerRepo, branch, err: msg }, 'Failed to fetch upstream info');
    return { commit: null, commitsBehind: 0, error: msg };
  }
}

// ─── Public API ───

/**
 * Check sync status for a list of repos. Returns status for each repo
 * plus a summary.
 */
export async function checkSyncStatus(
  repos: RepoSyncInput[],
): Promise<Result<SyncStatusResult>> {
  if (repos.length === 0) {
    return ok({
      repos: [],
      summary: { repoCount: 0, reposSynced: 0, reposBehind: 0, reposErrored: 0 },
    });
  }

  const now = new Date().toISOString();
  const results: RepoSyncStatus[] = [];

  // Check repos in parallel (bounded to avoid hammering GitHub API)
  const CONCURRENCY = 5;
  for (let i = 0; i < repos.length; i += CONCURRENCY) {
    const batch = repos.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map(async (repo) => {
        const ownerRepo = extractOwnerRepo(repo.repoUrl);
        if (!ownerRepo) {
          return {
            id: repo.id,
            name: repo.name,
            repoUrl: repo.repoUrl,
            branch: repo.branch,
            localCommit: repo.lastCommit,
            upstreamCommit: null,
            commitsBehind: 0,
            lastSyncedAt: repo.lastSyncedAt,
            checkedAt: now,
            isSynced: true, // Can't check non-GitHub URLs — assume synced
            error: 'Not a GitHub URL — sync check skipped',
          };
        }

        const info = await fetchUpstreamInfo(ownerRepo, repo.branch, repo.lastCommit);

        const isSynced = info.error !== null
          ? false // Unknown state — not confirmed synced
          : (repo.lastCommit === null || info.commit === repo.lastCommit);

        return {
          id: repo.id,
          name: repo.name,
          repoUrl: repo.repoUrl,
          branch: repo.branch,
          localCommit: repo.lastCommit,
          upstreamCommit: info.commit,
          commitsBehind: info.commitsBehind,
          lastSyncedAt: repo.lastSyncedAt,
          checkedAt: now,
          isSynced,
          error: info.error,
        };
      }),
    );
    results.push(...batchResults);
  }

  const summary = {
    repoCount: results.length,
    reposSynced: results.filter(r => r.isSynced && !r.error).length,
    reposBehind: results.filter(r => !r.isSynced && !r.error).length,
    reposErrored: results.filter(r => r.error !== null).length,
  };

  return ok({ repos: results, summary });
}

/**
 * Fetch the latest upstream commit for a single repo and return the new SHA.
 * Does NOT update the database — the caller handles persistence.
 */
export async function fetchLatestCommit(
  repoUrl: string,
  branch: string,
): Promise<Result<{ commit: string }>> {
  const ownerRepo = extractOwnerRepo(repoUrl);
  if (!ownerRepo) {
    return err('INVALID_URL', 'Not a valid GitHub URL', { retryable: false });
  }

  const info = await fetchUpstreamInfo(ownerRepo, branch, null);
  if (info.error || !info.commit) {
    return err('FETCH_FAILED', info.error || 'No commit returned', { retryable: true });
  }

  return ok({ commit: info.commit });
}
