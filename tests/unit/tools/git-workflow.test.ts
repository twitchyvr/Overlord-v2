import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import { executeGitWorkflow } from '../../../src/tools/providers/git-workflow.js';
vi.mock('../../../src/tools/providers/shell.js', () => ({ executeShell: vi.fn() }));
vi.mock('node:fs', async () => { const actual = await vi.importActual<typeof import('node:fs')>('node:fs'); return { ...actual, existsSync: vi.fn() }; });
import { executeShell } from '../../../src/tools/providers/shell.js';
const mockShell = vi.mocked(executeShell); const mockExists = vi.mocked(fs.existsSync);
beforeEach(() => { vi.clearAllMocks(); });

describe('Git Workflow Tool', () => {
  describe('Error handling', () => {
    it('returns error for non-existent directory', async () => {
      mockExists.mockReturnValue(false);
      const r = await executeGitWorkflow({ action: 'status', projectDir: '/nonexistent' });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe('NOT_FOUND');
    });

    it('handles shell exceptions', async () => {
      mockExists.mockReturnValue(true);
      mockShell.mockRejectedValue(new Error('Shell crashed'));
      const r = await executeGitWorkflow({ action: 'status', projectDir: '/test/project' });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe('GIT_ERROR');
    });
  });

  describe('branch', () => {
    it('creates a new branch', async () => {
      mockExists.mockReturnValue(true);
      mockShell.mockResolvedValue({ stdout: "Switched to a new branch 'feat/test'", stderr: '', exitCode: 0, timedOut: false });
      const r = await executeGitWorkflow({ action: 'branch', projectDir: '/test/project', branch: 'feat/test' });
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.data.success).toBe(true);
        expect(r.data.output).toContain('feat/test');
      }
      expect(mockShell).toHaveBeenCalledWith(expect.objectContaining({ command: 'git checkout -b "feat/test"' }));
    });

    it('returns error without branch name', async () => {
      mockExists.mockReturnValue(true);
      const r = await executeGitWorkflow({ action: 'branch', projectDir: '/test/project' });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe('INVALID_PARAMS');
    });

    it('rejects shell metacharacters in branch name', async () => {
      mockExists.mockReturnValue(true);
      const r = await executeGitWorkflow({ action: 'branch', projectDir: '/test/project', branch: 'bad; evil' });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe('GIT_ERROR');
    });
  });

  describe('commit', () => {
    it('stages and commits files', async () => {
      mockExists.mockReturnValue(true);
      mockShell
        .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0, timedOut: false }) // git add
        .mockResolvedValueOnce({ stdout: '[main abc1234] fix: thing', stderr: '', exitCode: 0, timedOut: false }); // git commit
      const r = await executeGitWorkflow({ action: 'commit', projectDir: '/test/project', message: 'fix: thing', files: ['a.ts'] });
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.data.success).toBe(true);
        expect(r.data.output).toContain('fix: thing');
      }
      expect(mockShell.mock.calls[0][0].command).toContain('git add "a.ts"');
    });

    it('uses git add -A when no files specified', async () => {
      mockExists.mockReturnValue(true);
      mockShell
        .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0, timedOut: false })
        .mockResolvedValueOnce({ stdout: 'committed', stderr: '', exitCode: 0, timedOut: false });
      await executeGitWorkflow({ action: 'commit', projectDir: '/test/project', message: 'chore: all' });
      expect(mockShell.mock.calls[0][0].command).toBe('git add -A');
    });

    it('returns error without commit message', async () => {
      mockExists.mockReturnValue(true);
      const r = await executeGitWorkflow({ action: 'commit', projectDir: '/test/project' });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe('INVALID_PARAMS');
    });

    it('reports staging failure', async () => {
      mockExists.mockReturnValue(true);
      mockShell.mockResolvedValueOnce({ stdout: '', stderr: 'fatal: not a git repo', exitCode: 128, timedOut: false });
      const r = await executeGitWorkflow({ action: 'commit', projectDir: '/test/project', message: 'test' });
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.data.success).toBe(false);
        expect(r.data.output).toContain('Failed to stage');
      }
    });
  });

  describe('push', () => {
    it('pushes to remote', async () => {
      mockExists.mockReturnValue(true);
      mockShell.mockResolvedValue({ stdout: '', stderr: 'Everything up-to-date', exitCode: 0, timedOut: false });
      const r = await executeGitWorkflow({ action: 'push', projectDir: '/test/project' });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.data.success).toBe(true);
    });

    it('pushes specific branch with -u', async () => {
      mockExists.mockReturnValue(true);
      mockShell.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0, timedOut: false });
      await executeGitWorkflow({ action: 'push', projectDir: '/test/project', branch: 'feat/x' });
      expect(mockShell.mock.calls[0][0].command).toContain('git push -u origin "feat/x"');
    });
  });

  describe('pr', () => {
    it('creates a PR', async () => {
      mockExists.mockReturnValue(true);
      mockShell.mockResolvedValue({ stdout: 'https://github.com/owner/repo/pull/1', stderr: '', exitCode: 0, timedOut: false });
      const r = await executeGitWorkflow({ action: 'pr', projectDir: '/test/project', message: 'Add feature' });
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.data.success).toBe(true);
        expect((r.data.data as { url: string }).url).toContain('pull/1');
      }
    });

    it('returns error without message', async () => {
      mockExists.mockReturnValue(true);
      const r = await executeGitWorkflow({ action: 'pr', projectDir: '/test/project' });
      expect(r.ok).toBe(false);
    });
  });

  describe('status', () => {
    it('reports clean working tree', async () => {
      mockExists.mockReturnValue(true);
      mockShell.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0, timedOut: false });
      const r = await executeGitWorkflow({ action: 'status', projectDir: '/test/project' });
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect((r.data.data as { clean: boolean }).clean).toBe(true);
        expect(r.data.output).toContain('clean');
      }
    });

    it('reports changes', async () => {
      mockExists.mockReturnValue(true);
      mockShell.mockResolvedValue({ stdout: 'M  src/a.ts\n?? new.ts', stderr: '', exitCode: 0, timedOut: false });
      const r = await executeGitWorkflow({ action: 'status', projectDir: '/test/project' });
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect((r.data.data as { totalChanges: number }).totalChanges).toBe(2);
        expect(r.data.output).toContain('2 change(s)');
      }
    });
  });

  describe('diff', () => {
    it('returns diff output', async () => {
      mockExists.mockReturnValue(true);
      mockShell.mockResolvedValue({ stdout: 'diff --git a/x b/x\n+line', stderr: '', exitCode: 0, timedOut: false });
      const r = await executeGitWorkflow({ action: 'diff', projectDir: '/test/project' });
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect((r.data.data as { hasChanges: boolean }).hasChanges).toBe(true);
      }
    });

    it('diffs specific files', async () => {
      mockExists.mockReturnValue(true);
      mockShell.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0, timedOut: false });
      await executeGitWorkflow({ action: 'diff', projectDir: '/test/project', files: ['a.ts', 'b.ts'] });
      expect(mockShell.mock.calls[0][0].command).toContain('-- "a.ts" "b.ts"');
    });
  });
});
