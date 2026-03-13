/**
 * Git Workflow Tool Provider
 * Provides structured git operations: branch, commit, push, pr, status, diff.
 */

import * as fs from 'node:fs';
import { ok, err } from '../../core/contracts.js';
import { executeShell } from './shell.js';
import type { Result } from '../../core/contracts.js';

type GitAction = 'branch' | 'commit' | 'push' | 'pr' | 'status' | 'diff';

export interface GitWorkflowResult {
  action: GitAction;
  success: boolean;
  data: unknown;
  output: string;
}

/**
 * Reject strings containing shell metacharacters that could enable injection.
 */
const SHELL_META_RE = /[;|&$`\\(){}<>!\n\r]/;
function rejectShellMeta(input: string, context: string): void {
  if (SHELL_META_RE.test(input)) {
    throw new Error(`Unsafe characters in ${context}: shell metacharacters are not allowed`);
  }
}

export async function executeGitWorkflow(params: {
  action: GitAction;
  projectDir: string;
  branch?: string;
  message?: string;
  files?: string[];
}): Promise<Result<GitWorkflowResult>> {
  const { action, projectDir, branch, message, files } = params;

  if (!fs.existsSync(projectDir)) {
    return err('NOT_FOUND', 'Project directory does not exist: ' + projectDir, { retryable: false });
  }

  try {
    switch (action) {
      case 'branch': {
        if (!branch) {
          return err('INVALID_PARAMS', 'Branch name is required for branch action', { retryable: false });
        }
        rejectShellMeta(branch, 'branch name');

        const result = await executeShell({
          command: `git checkout -b "${branch}"`,
          cwd: projectDir,
          timeout: 30_000,
        });

        return ok({
          action: 'branch',
          success: result.exitCode === 0,
          data: { branch },
          output: result.exitCode === 0
            ? `Created and switched to branch: ${branch}`
            : result.stderr || result.stdout,
        });
      }

      case 'commit': {
        if (!message) {
          return err('INVALID_PARAMS', 'Commit message is required for commit action', { retryable: false });
        }
        rejectShellMeta(message, 'commit message');

        // Stage files
        let addCmd: string;
        if (files && files.length > 0) {
          for (const f of files) rejectShellMeta(f, 'file path');
          const fileList = files.map(f => `"${f}"`).join(' ');
          addCmd = `git add ${fileList}`;
        } else {
          addCmd = 'git add -A';
        }

        const addResult = await executeShell({
          command: addCmd,
          cwd: projectDir,
          timeout: 30_000,
        });

        if (addResult.exitCode !== 0) {
          return ok({
            action: 'commit',
            success: false,
            data: { staged: false },
            output: 'Failed to stage files: ' + (addResult.stderr || addResult.stdout),
          });
        }

        const commitResult = await executeShell({
          command: `git commit -m "${message}"`,
          cwd: projectDir,
          timeout: 30_000,
        });

        return ok({
          action: 'commit',
          success: commitResult.exitCode === 0,
          data: { message },
          output: commitResult.exitCode === 0
            ? commitResult.stdout.trim()
            : commitResult.stderr || commitResult.stdout,
        });
      }

      case 'push': {
        const pushBranch = branch ? `origin "${branch}"` : '';
        const cmd = pushBranch ? `git push -u ${pushBranch}` : 'git push';

        const result = await executeShell({
          command: cmd,
          cwd: projectDir,
          timeout: 60_000,
        });

        return ok({
          action: 'push',
          success: result.exitCode === 0,
          data: { branch: branch || 'current' },
          output: result.exitCode === 0
            ? result.stderr.trim() || result.stdout.trim() || 'Push successful'
            : result.stderr || result.stdout,
        });
      }

      case 'pr': {
        if (!message) {
          return err('INVALID_PARAMS', 'PR title (message) is required for pr action', { retryable: false });
        }
        rejectShellMeta(message, 'PR title');

        const cmd = `gh pr create --title "${message}" --fill`;
        const result = await executeShell({
          command: cmd,
          cwd: projectDir,
          timeout: 30_000,
        });

        return ok({
          action: 'pr',
          success: result.exitCode === 0,
          data: { url: result.stdout.trim() },
          output: result.exitCode === 0 ? result.stdout.trim() : result.stderr || result.stdout,
        });
      }

      case 'status': {
        const result = await executeShell({
          command: 'git status --porcelain',
          cwd: projectDir,
          timeout: 30_000,
        });

        const lines = result.stdout.trim().split('\n').filter(l => l.trim().length > 0);
        const changes = lines.map(line => {
          const status = line.substring(0, 2).trim();
          const filePath = line.substring(3);
          return { status, file: filePath };
        });

        return ok({
          action: 'status',
          success: result.exitCode === 0,
          data: { changes, totalChanges: changes.length, clean: changes.length === 0 },
          output: changes.length === 0
            ? 'Working tree clean'
            : `${changes.length} change(s):\n${result.stdout.trim()}`,
        });
      }

      case 'diff': {
        let cmd = 'git diff';
        if (files && files.length > 0) {
          for (const f of files) rejectShellMeta(f, 'file path');
          cmd += ' -- ' + files.map(f => `"${f}"`).join(' ');
        }

        const result = await executeShell({
          command: cmd,
          cwd: projectDir,
          timeout: 30_000,
        });

        return ok({
          action: 'diff',
          success: result.exitCode === 0,
          data: { hasChanges: result.stdout.trim().length > 0 },
          output: result.stdout.trim() || '(no diff)',
        });
      }

      default:
        return err('INVALID_PARAMS', `Unknown action: ${action as string}`, { retryable: false });
    }
  } catch (error) {
    const message2 = error instanceof Error ? error.message : String(error);
    return err('GIT_ERROR', 'Git workflow operation failed: ' + message2, { retryable: true });
  }
}
