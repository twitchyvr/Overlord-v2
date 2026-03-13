/**
 * GitHub Issues Tool Provider
 * Uses the gh CLI to manage GitHub Issues.
 */

import { ok, err } from '../../core/contracts.js';
import { executeShell } from './shell.js';
import type { Result } from '../../core/contracts.js';

type IssueAction = 'create' | 'list' | 'get' | 'close' | 'comment';

export interface GitHubIssueResult {
  action: IssueAction;
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

export async function executeGitHubIssues(params: {
  action: IssueAction;
  repo?: string;
  title?: string;
  body?: string;
  issueNumber?: number;
  labels?: string[];
  cwd?: string;
}): Promise<Result<GitHubIssueResult>> {
  const { action, repo, title, body, issueNumber, labels, cwd } = params;

  try {
    const repoFlag = repo ? ` -R "${repo}"` : '';

    switch (action) {
      case 'create': {
        if (!title) {
          return err('INVALID_PARAMS', 'Title is required for creating an issue', { retryable: false });
        }
        rejectShellMeta(title, 'issue title');
        if (body) rejectShellMeta(body, 'issue body');

        let cmd = `gh issue create --title "${title}"${repoFlag}`;
        if (body) cmd += ` --body "${body}"`;
        if (labels && labels.length > 0) {
          for (const label of labels) rejectShellMeta(label, 'label');
          cmd += ` --label "${labels.join(',')}"`;
        }

        const result = await executeShell({ command: cmd, timeout: 30_000, cwd });
        return ok({
          action: 'create',
          success: result.exitCode === 0,
          data: { url: result.stdout.trim() },
          output: result.exitCode === 0 ? result.stdout.trim() : result.stderr || result.stdout,
        });
      }

      case 'list': {
        const cmd = `gh issue list --json number,title,state,labels,assignees --limit 30${repoFlag}`;
        const result = await executeShell({ command: cmd, timeout: 30_000, cwd });

        let issues: unknown[] = [];
        try {
          issues = JSON.parse(result.stdout);
        } catch {
          // parse failed — return raw output
        }

        return ok({
          action: 'list',
          success: result.exitCode === 0,
          data: { issues, count: issues.length },
          output: result.exitCode === 0 ? `Found ${issues.length} issue(s)` : result.stderr || result.stdout,
        });
      }

      case 'get': {
        if (!issueNumber) {
          return err('INVALID_PARAMS', 'Issue number is required for get action', { retryable: false });
        }

        const cmd = `gh issue view ${issueNumber} --json number,title,state,body,labels,assignees,comments${repoFlag}`;
        const result = await executeShell({ command: cmd, timeout: 30_000, cwd });

        let issue: unknown = null;
        try {
          issue = JSON.parse(result.stdout);
        } catch {
          // parse failed
        }

        return ok({
          action: 'get',
          success: result.exitCode === 0,
          data: issue,
          output: result.exitCode === 0 ? result.stdout.trim() : result.stderr || result.stdout,
        });
      }

      case 'close': {
        if (!issueNumber) {
          return err('INVALID_PARAMS', 'Issue number is required for close action', { retryable: false });
        }

        const cmd = `gh issue close ${issueNumber}${repoFlag}`;
        const result = await executeShell({ command: cmd, timeout: 30_000, cwd });

        return ok({
          action: 'close',
          success: result.exitCode === 0,
          data: { issueNumber },
          output: result.exitCode === 0 ? `Issue #${issueNumber} closed` : result.stderr || result.stdout,
        });
      }

      case 'comment': {
        if (!issueNumber) {
          return err('INVALID_PARAMS', 'Issue number is required for comment action', { retryable: false });
        }
        if (!body) {
          return err('INVALID_PARAMS', 'Body is required for comment action', { retryable: false });
        }
        rejectShellMeta(body, 'comment body');

        const cmd = `gh issue comment ${issueNumber} --body "${body}"${repoFlag}`;
        const result = await executeShell({ command: cmd, timeout: 30_000, cwd });

        return ok({
          action: 'comment',
          success: result.exitCode === 0,
          data: { issueNumber },
          output: result.exitCode === 0 ? `Comment added to issue #${issueNumber}` : result.stderr || result.stdout,
        });
      }

      default:
        return err('INVALID_PARAMS', `Unknown action: ${action as string}`, { retryable: false });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return err('GITHUB_ERROR', 'GitHub issue operation failed: ' + message, { retryable: true });
  }
}
