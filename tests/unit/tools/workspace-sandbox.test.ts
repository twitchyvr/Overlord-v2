import { describe, it, expect, vi, beforeEach } from 'vitest';
import { executeWorkspaceSandbox, parseWorktreeList } from '../../../src/tools/providers/workspace-sandbox.js';

vi.mock('../../../src/tools/providers/shell.js', () => ({ executeShell: vi.fn() }));

import { executeShell } from '../../../src/tools/providers/shell.js';
const mockShell = vi.mocked(executeShell);

beforeEach(() => { vi.clearAllMocks(); });

const PORCELAIN_OUTPUT = `worktree /Users/test/repo
HEAD abc1234567890def
branch refs/heads/main

worktree /tmp/overlord-worktree-abc123
HEAD def4567890abc123
branch refs/heads/feat/new

`;

describe('Workspace Sandbox Tool', () => {
  describe('parseWorktreeList', () => {
    it('parses porcelain output into entries', () => {
      const entries = parseWorktreeList(PORCELAIN_OUTPUT);
      expect(entries).toHaveLength(2);
      expect(entries[0]).toEqual({
        worktreePath: '/Users/test/repo',
        branch: 'main',
        commit: 'abc1234567890def',
        bare: false,
      });
      expect(entries[1]).toEqual({
        worktreePath: '/tmp/overlord-worktree-abc123',
        branch: 'feat/new',
        commit: 'def4567890abc123',
        bare: false,
      });
    });

    it('handles empty output', () => {
      expect(parseWorktreeList('')).toHaveLength(0);
    });

    it('handles bare repository marker', () => {
      const output = `worktree /Users/test/repo
HEAD abc123
bare

`;
      const entries = parseWorktreeList(output);
      expect(entries).toHaveLength(1);
      expect(entries[0].bare).toBe(true);
    });
  });

  describe('create action', () => {
    it('creates a new worktree', async () => {
      mockShell
        .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0, timedOut: false }) // worktree list
        .mockResolvedValueOnce({ stdout: 'Preparing worktree', stderr: '', exitCode: 0, timedOut: false }); // worktree add

      const r = await executeWorkspaceSandbox({
        action: 'create',
        projectDir: '/test/repo',
        branch: 'feat/sandbox',
      });

      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.data.action).toBe('create');
        expect(r.data.branch).toBe('feat/sandbox');
        expect(r.data.worktreePath).toContain('/tmp/overlord-worktree-');
        expect(r.data.isClean).toBe(true);
      }
    });

    it('rejects if worktree already exists', async () => {
      // First create succeeds: list (empty) + add (OK)
      mockShell
        .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0, timedOut: false })
        .mockResolvedValueOnce({ stdout: 'OK', stderr: '', exitCode: 0, timedOut: false });

      const r1 = await executeWorkspaceSandbox({ action: 'create', projectDir: '/test/repo', branch: 'main' });
      expect(r1.ok).toBe(true);
      const wtPath = r1.ok ? r1.data.worktreePath : '';

      // Second create: list returns existing worktree containing the path
      mockShell.mockResolvedValueOnce({
        stdout: `worktree ${wtPath}\nHEAD abc123\nbranch refs/heads/main\n\n`,
        stderr: '',
        exitCode: 0,
        timedOut: false,
      });

      const r2 = await executeWorkspaceSandbox({ action: 'create', projectDir: '/test/repo', branch: 'main' });
      expect(r2.ok).toBe(false);
      if (!r2.ok) expect(r2.error.code).toBe('ALREADY_EXISTS');
    });

    it('handles git worktree add failure', async () => {
      mockShell
        .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0, timedOut: false }) // list
        .mockResolvedValueOnce({ stdout: '', stderr: 'fatal: branch already checked out', exitCode: 128, timedOut: false }); // add

      const r = await executeWorkspaceSandbox({ action: 'create', projectDir: '/test/repo', branch: 'main' });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe('CREATE_FAILED');
    });
  });

  describe('destroy action', () => {
    it('removes a worktree', async () => {
      mockShell.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0, timedOut: false });

      const r = await executeWorkspaceSandbox({ action: 'destroy', projectDir: '/test/repo', branch: 'feat/done' });
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.data.action).toBe('destroy');
        expect(r.data.worktreePath).toContain('/tmp/overlord-worktree-');
      }
    });

    it('handles removal failure', async () => {
      mockShell.mockResolvedValue({ stdout: '', stderr: 'fatal: not a valid worktree', exitCode: 128, timedOut: false });

      const r = await executeWorkspaceSandbox({ action: 'destroy', projectDir: '/test/repo', branch: 'main' });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe('DESTROY_FAILED');
    });
  });

  describe('list action', () => {
    it('returns parsed worktree list', async () => {
      mockShell.mockResolvedValue({ stdout: PORCELAIN_OUTPUT, stderr: '', exitCode: 0, timedOut: false });

      const r = await executeWorkspaceSandbox({ action: 'list', projectDir: '/test/repo' });
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.data.action).toBe('list');
        expect(r.data.worktrees).toHaveLength(2);
        expect(r.data.output).toContain('main');
        expect(r.data.output).toContain('feat/new');
      }
    });

    it('handles empty worktree list', async () => {
      mockShell.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0, timedOut: false });

      const r = await executeWorkspaceSandbox({ action: 'list', projectDir: '/test/repo' });
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.data.worktrees).toHaveLength(0);
        expect(r.data.output).toBe('No worktrees');
      }
    });

    it('handles git failure', async () => {
      mockShell.mockResolvedValue({ stdout: '', stderr: 'not a git repo', exitCode: 128, timedOut: false });

      const r = await executeWorkspaceSandbox({ action: 'list', projectDir: '/test/not-git' });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe('LIST_FAILED');
    });
  });

  describe('status action', () => {
    it('reports worktree does not exist', async () => {
      mockShell.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0, timedOut: false });

      const r = await executeWorkspaceSandbox({ action: 'status', projectDir: '/test/repo', branch: 'missing' });
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.data.isClean).toBe(false);
        expect(r.data.output).toContain('does not exist');
      }
    });

    it('reports clean worktree', async () => {
      // First we need the worktree to be in the list
      // We need to know the exact path the status function will look for
      // Use create first to establish the path, then check status
      mockShell
        .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0, timedOut: false }) // list for create check
        .mockResolvedValueOnce({ stdout: 'OK', stderr: '', exitCode: 0, timedOut: false }); // create

      const cr = await executeWorkspaceSandbox({ action: 'create', projectDir: '/test/repo', branch: 'feat/check' });
      expect(cr.ok).toBe(true);
      const wtPath = cr.ok ? cr.data.worktreePath : '';

      // Now check status
      mockShell
        .mockResolvedValueOnce({ stdout: `worktree ${wtPath}\nHEAD abc123\nbranch refs/heads/feat/check\n\n`, stderr: '', exitCode: 0, timedOut: false }) // list
        .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0, timedOut: false }); // git status --porcelain (empty = clean)

      const r = await executeWorkspaceSandbox({ action: 'status', projectDir: '/test/repo', branch: 'feat/check' });
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.data.isClean).toBe(true);
        expect(r.data.output).toContain('clean');
      }
    });

    it('reports dirty worktree', async () => {
      mockShell
        .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0, timedOut: false })
        .mockResolvedValueOnce({ stdout: 'OK', stderr: '', exitCode: 0, timedOut: false });

      const cr = await executeWorkspaceSandbox({ action: 'create', projectDir: '/test/repo2', branch: 'feat/dirty' });
      const wtPath = cr.ok ? cr.data.worktreePath : '';

      mockShell
        .mockResolvedValueOnce({ stdout: `worktree ${wtPath}\nHEAD abc123\nbranch refs/heads/feat/dirty\n\n`, stderr: '', exitCode: 0, timedOut: false })
        .mockResolvedValueOnce({ stdout: 'M src/index.ts\n?? new-file.ts\n', stderr: '', exitCode: 0, timedOut: false });

      const r = await executeWorkspaceSandbox({ action: 'status', projectDir: '/test/repo2', branch: 'feat/dirty' });
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.data.isClean).toBe(false);
        expect(r.data.output).toContain('uncommitted changes');
      }
    });
  });

  describe('error handling', () => {
    it('catches unexpected errors', async () => {
      mockShell.mockRejectedValue(new Error('Network timeout'));

      const r = await executeWorkspaceSandbox({ action: 'create', projectDir: '/test/repo', branch: 'main' });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe('SANDBOX_ERROR');
    });
  });
});
