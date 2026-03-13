import { describe, it, expect, vi, beforeEach } from 'vitest';
import { executeGitHubIssues } from '../../../src/tools/providers/github-issues.js';
vi.mock('../../../src/tools/providers/shell.js', () => ({ executeShell: vi.fn() }));
import { executeShell } from '../../../src/tools/providers/shell.js';
const mockShell = vi.mocked(executeShell);
beforeEach(() => { vi.clearAllMocks(); });

describe('GitHub Issues Tool', () => {
  describe('create', () => {
    it('creates an issue with title', async () => {
      mockShell.mockResolvedValue({ stdout: 'https://github.com/owner/repo/issues/42', stderr: '', exitCode: 0, timedOut: false });
      const r = await executeGitHubIssues({ action: 'create', title: 'Test issue' });
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.data.action).toBe('create');
        expect(r.data.success).toBe(true);
        expect((r.data.data as { url: string }).url).toContain('issues/42');
      }
      expect(mockShell).toHaveBeenCalledWith(expect.objectContaining({ command: expect.stringContaining('gh issue create --title "Test issue"') }));
    });

    it('includes body and labels when provided', async () => {
      mockShell.mockResolvedValue({ stdout: 'https://github.com/owner/repo/issues/43', stderr: '', exitCode: 0, timedOut: false });
      await executeGitHubIssues({ action: 'create', title: 'Bug report', body: 'Something broke', labels: ['bug', 'priority: high'] });
      const cmd = mockShell.mock.calls[0][0].command;
      expect(cmd).toContain('--body "Something broke"');
      expect(cmd).toContain('--label "bug,priority: high"');
    });

    it('returns error when title is missing', async () => {
      const r = await executeGitHubIssues({ action: 'create' });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe('INVALID_PARAMS');
    });

    it('includes repo flag when repo is specified', async () => {
      mockShell.mockResolvedValue({ stdout: 'https://github.com/other/repo/issues/1', stderr: '', exitCode: 0, timedOut: false });
      await executeGitHubIssues({ action: 'create', title: 'Cross-repo', repo: 'other/repo' });
      const cmd = mockShell.mock.calls[0][0].command;
      expect(cmd).toContain('-R "other/repo"');
    });

    it('rejects shell metacharacters in title', async () => {
      const r = await executeGitHubIssues({ action: 'create', title: 'bad; rm -rf /' });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe('GITHUB_ERROR');
    });
  });

  describe('list', () => {
    it('lists issues as JSON', async () => {
      const issues = [{ number: 1, title: 'Issue 1', state: 'OPEN' }, { number: 2, title: 'Issue 2', state: 'OPEN' }];
      mockShell.mockResolvedValue({ stdout: JSON.stringify(issues), stderr: '', exitCode: 0, timedOut: false });
      const r = await executeGitHubIssues({ action: 'list' });
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.data.action).toBe('list');
        expect((r.data.data as { count: number }).count).toBe(2);
      }
    });

    it('handles unparseable output', async () => {
      mockShell.mockResolvedValue({ stdout: 'not json', stderr: '', exitCode: 0, timedOut: false });
      const r = await executeGitHubIssues({ action: 'list' });
      expect(r.ok).toBe(true);
      if (r.ok) expect((r.data.data as { count: number }).count).toBe(0);
    });
  });

  describe('get', () => {
    it('gets a single issue', async () => {
      const issue = { number: 10, title: 'Test', state: 'OPEN', body: 'Details' };
      mockShell.mockResolvedValue({ stdout: JSON.stringify(issue), stderr: '', exitCode: 0, timedOut: false });
      const r = await executeGitHubIssues({ action: 'get', issueNumber: 10 });
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.data.action).toBe('get');
        expect((r.data.data as { number: number }).number).toBe(10);
      }
    });

    it('returns error without issue number', async () => {
      const r = await executeGitHubIssues({ action: 'get' });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe('INVALID_PARAMS');
    });
  });

  describe('close', () => {
    it('closes an issue', async () => {
      mockShell.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0, timedOut: false });
      const r = await executeGitHubIssues({ action: 'close', issueNumber: 5 });
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.data.output).toContain('#5 closed');
      }
    });

    it('returns error without issue number', async () => {
      const r = await executeGitHubIssues({ action: 'close' });
      expect(r.ok).toBe(false);
    });
  });

  describe('comment', () => {
    it('adds a comment to an issue', async () => {
      mockShell.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0, timedOut: false });
      const r = await executeGitHubIssues({ action: 'comment', issueNumber: 7, body: 'LGTM' });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.data.output).toContain('#7');
    });

    it('returns error without body', async () => {
      const r = await executeGitHubIssues({ action: 'comment', issueNumber: 7 });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe('INVALID_PARAMS');
    });

    it('returns error without issue number', async () => {
      const r = await executeGitHubIssues({ action: 'comment', body: 'LGTM' });
      expect(r.ok).toBe(false);
    });
  });

  describe('shell failures', () => {
    it('handles gh CLI errors', async () => {
      mockShell.mockResolvedValue({ stdout: '', stderr: 'auth required', exitCode: 1, timedOut: false });
      const r = await executeGitHubIssues({ action: 'list' });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.data.success).toBe(false);
    });
  });
});
