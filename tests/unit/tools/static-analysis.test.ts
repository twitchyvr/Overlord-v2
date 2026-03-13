/**
 * Static Analysis Tool Provider Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import { executeStaticAnalysis } from '../../../src/tools/providers/static-analysis.js';

vi.mock('../../../src/tools/providers/shell.js', () => ({
  executeShell: vi.fn(),
}));

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return { ...actual, existsSync: vi.fn() };
});

import { executeShell } from '../../../src/tools/providers/shell.js';

const mockShell = vi.mocked(executeShell);
const mockExists = vi.mocked(fs.existsSync);

beforeEach(() => { vi.clearAllMocks(); });

describe('Static Analysis Tool', () => {
  describe('Project type detection', () => {
    it('detects Node.js from package.json', async () => {
      mockExists.mockImplementation((p: fs.PathLike) => {
        const s = String(p);
        return s.endsWith('package.json') || s === '/test/project';
      });
      mockShell.mockResolvedValue({ stdout: '[]', stderr: '', exitCode: 0, timedOut: false });
      const result = await executeStaticAnalysis({ projectDir: '/test/project' });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.data.projectType).toBe('node');
    });

    it('detects Rust from Cargo.toml', async () => {
      mockExists.mockImplementation((p: fs.PathLike) => {
        const s = String(p);
        return s.endsWith('Cargo.toml') || s === '/test/rust';
      });
      mockShell.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0, timedOut: false });
      const result = await executeStaticAnalysis({ projectDir: '/test/rust' });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.data.projectType).toBe('rust');
    });

    it('detects Python from pyproject.toml', async () => {
      mockExists.mockImplementation((p: fs.PathLike) => {
        const s = String(p);
        return s.endsWith('pyproject.toml') || s === '/test/py';
      });
      mockShell.mockResolvedValue({ stdout: '[]', stderr: '', exitCode: 0, timedOut: false });
      const result = await executeStaticAnalysis({ projectDir: '/test/py' });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.data.projectType).toBe('python');
    });

    it('detects Go from go.mod', async () => {
      mockExists.mockImplementation((p: fs.PathLike) => {
        const s = String(p);
        return s.endsWith('go.mod') || s === '/test/go';
      });
      mockShell.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0, timedOut: false });
      const result = await executeStaticAnalysis({ projectDir: '/test/go' });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.data.projectType).toBe('go');
    });

    it('returns unknown when no project files found', async () => {
      mockExists.mockImplementation((p: fs.PathLike) => String(p) === '/test/empty');
      const result = await executeStaticAnalysis({ projectDir: '/test/empty' });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.projectType).toBe('unknown');
        expect(result.data.summary).toBe('No lint tools detected');
      }
    });
  });

  describe('Error handling', () => {
    it('returns error for non-existent directory', async () => {
      mockExists.mockReturnValue(false);
      const result = await executeStaticAnalysis({ projectDir: '/nonexistent' });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('NOT_FOUND');
    });

    it('handles shell execution errors gracefully', async () => {
      mockExists.mockImplementation((p: fs.PathLike) => {
        const s = String(p);
        return s.endsWith('package.json') || s === '/test/project';
      });
      mockShell.mockRejectedValue(new Error('Shell crashed'));
      const result = await executeStaticAnalysis({ projectDir: '/test/project' });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('ANALYSIS_ERROR');
    });
  });

  describe('Node.js analysis', () => {
    it('parses ESLint JSON output for error counts', async () => {
      mockExists.mockImplementation((p: fs.PathLike) => {
        const s = String(p);
        return s.endsWith('package.json') || s === '/test/project';
      });
      const eslintOutput = JSON.stringify([
        { filePath: '/test/a.ts', errorCount: 3, warningCount: 1, messages: [] },
        { filePath: '/test/b.ts', errorCount: 0, warningCount: 2, messages: [] },
      ]);
      mockShell
        .mockResolvedValueOnce({ stdout: eslintOutput, stderr: '', exitCode: 1, timedOut: false })
        .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0, timedOut: false });
      const result = await executeStaticAnalysis({ projectDir: '/test/project' });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.lintErrors).toBe(3);
        expect(result.data.warnings).toBe(3);
        expect(result.data.typeErrors).toBe(0);
      }
    });

    it('counts tsc type errors from output', async () => {
      mockExists.mockImplementation((p: fs.PathLike) => {
        const s = String(p);
        return s.endsWith('package.json') || s === '/test/project';
      });
      const tscOutput = 'src/a.ts(1,5): error TS2322: Type...\nsrc/b.ts(10,3): error TS2345: Arg...';
      mockShell
        .mockResolvedValueOnce({ stdout: '[]', stderr: '', exitCode: 0, timedOut: false })
        .mockResolvedValueOnce({ stdout: tscOutput, stderr: '', exitCode: 1, timedOut: false });
      const result = await executeStaticAnalysis({ projectDir: '/test/project' });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.data.typeErrors).toBe(2);
    });

    it('respects checks parameter to skip lint', async () => {
      mockExists.mockImplementation((p: fs.PathLike) => {
        const s = String(p);
        return s.endsWith('package.json') || s === '/test/project';
      });
      mockShell.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0, timedOut: false });
      await executeStaticAnalysis({ projectDir: '/test/project', checks: ['typecheck'] });
      expect(mockShell).toHaveBeenCalledTimes(1);
      expect(mockShell.mock.calls[0][0].command).toContain('tsc');
    });
  });
});
