/**
 * Git Detector
 *
 * Detects git repositories, reads repo info, and provides
 * git init/clone operations for building setup.
 */

import { existsSync } from 'node:fs';
import path from 'node:path';
import { execSync, execFileSync } from 'node:child_process';
import { logger } from '../core/logger.js';

const log = logger.child({ module: 'tool:git-detector' });

const EXEC_OPTIONS = { encoding: 'utf-8' as const, timeout: 10000 };

/**
 * Checks whether the given directory is a git repository
 * by looking for a `.git` directory.
 */
export function isGitRepo(dirPath: string): boolean {
  try {
    return existsSync(path.join(dirPath, '.git'));
  } catch (err) {
    log.warn({ err, dirPath }, 'Error checking for git repo');
    return false;
  }
}

/**
 * Gathers git metadata for a directory: current branch,
 * remote origin URL, and whether there are uncommitted changes.
 */
export function getGitInfo(dirPath: string): {
  isRepo: boolean;
  branch?: string;
  remoteUrl?: string;
  hasUncommitted?: boolean;
} {
  if (!isGitRepo(dirPath)) {
    return { isRepo: false };
  }

  let branch: string | undefined;
  let remoteUrl: string | undefined;
  let hasUncommitted: boolean | undefined;

  try {
    branch = execSync(
      `git -C ${dirPath} rev-parse --abbrev-ref HEAD`,
      EXEC_OPTIONS,
    ).trim();
  } catch (err) {
    log.warn({ err, dirPath }, 'Failed to read git branch');
  }

  try {
    remoteUrl = execSync(
      `git -C ${dirPath} remote get-url origin`,
      EXEC_OPTIONS,
    ).trim();
  } catch (err) {
    log.debug({ err, dirPath }, 'No remote origin URL found');
  }

  try {
    const status = execSync(
      `git -C ${dirPath} status --porcelain`,
      EXEC_OPTIONS,
    ).trim();
    hasUncommitted = status.length > 0;
  } catch (err) {
    log.warn({ err, dirPath }, 'Failed to read git status');
  }

  // Resolve correct GitHub URL casing via gh API (#1249)
  if (remoteUrl) {
    try {
      // Extract owner/repo from git remote URL (handles https and git@ formats)
      const httpsMatch = remoteUrl.match(/github\.com[/:]([^/]+\/[^/.]+)/);
      const ownerRepo = httpsMatch ? httpsMatch[1].replace(/\.git$/, '') : null;

      if (ownerRepo) {
        const resolved = execFileSync('gh', ['api', `repos/${ownerRepo}`, '--jq', '.html_url'], {
          encoding: 'utf-8',
          timeout: 5000,
          stdio: ['pipe', 'pipe', 'pipe'],
        }).trim();
        if (resolved && resolved.startsWith('https://')) {
          remoteUrl = resolved;
        }
      }
    } catch {
      // gh CLI not available or API failed — keep the raw remote URL
    }
  }

  return { isRepo: true, branch, remoteUrl, hasUncommitted };
}

/**
 * Initializes a new git repository in the given directory.
 */
export function initGitRepo(dirPath: string): {
  success: boolean;
  message: string;
} {
  try {
    execSync(`git -C ${dirPath} init`, EXEC_OPTIONS);
    log.info({ dirPath }, 'Initialized git repository');
    return { success: true, message: `Initialized git repository in ${dirPath}` };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error({ err, dirPath }, 'Failed to initialize git repository');
    return { success: false, message };
  }
}

/** Characters that are dangerous in shell arguments. */
const DANGEROUS_CHARS_RE = /[;|&$`\\]/;

/**
 * Clones a remote git repository into the target directory.
 * The URL is validated against shell metacharacters before execution.
 */
export function cloneGitRepo(
  url: string,
  targetDir: string,
): { success: boolean; message: string } {
  if (DANGEROUS_CHARS_RE.test(url)) {
    const message = 'URL contains potentially dangerous shell metacharacters';
    log.error({ url }, message);
    return { success: false, message };
  }

  try {
    execSync(`git clone ${url} ${targetDir}`, EXEC_OPTIONS);
    log.info({ url, targetDir }, 'Cloned git repository');
    return { success: true, message: `Cloned ${url} into ${targetDir}` };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error({ err, url, targetDir }, 'Failed to clone git repository');
    return { success: false, message };
  }
}
