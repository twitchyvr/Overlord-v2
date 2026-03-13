/**
 * Deep Analysis Tool Provider Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import { executeDeepAnalysis } from '../../../src/tools/providers/deep-analysis.js';

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

describe('Deep Analysis Tool', () => {
  describe('Security analysis', () => {
    it('returns structured npm audit output', async () => {
      mockExists.mockImplementation((p: fs.PathLike) => {
        const s = String(p);
        return s.endsWith('package.json') || s === '/test/project';
      });
      const auditOutput = JSON.stringify({
        metadata: { vulnerabilities: { total: 5, critical: 1, high: 2, moderate: 1, low: 1 } },
      });
      mockShell.mockResolvedValue({ stdout: auditOutput, stderr: '', exitCode: 1, timedOut: false });
      const result = await executeDeepAnalysis({ projectDir: '/test/project', analysisType: 'security' });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.security).not.toBeNull();
        expect(result.data.security!.vulnerabilities).toBe(5);
        expect(result.data.security!.critical).toBe(1);
        expect(result.data.security!.high).toBe(2);
      }
    });

    it('handles malformed npm audit output gracefully', async () => {
      mockExists.mockImplementation((p: fs.PathLike) => {
        const s = String(p);
        return s.endsWith('package.json') || s === '/test/project';
      });
      mockShell.mockResolvedValue({ stdout: 'not json', stderr: '', exitCode: 1, timedOut: false });
      const result = await executeDeepAnalysis({ projectDir: '/test/project', analysisType: 'security' });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.security).not.toBeNull();
        expect(result.data.security!.vulnerabilities).toBe(1);
      }
    });
  });

  describe('Dependency analysis', () => {
    it('returns structured npm outdated output', async () => {
      mockExists.mockImplementation((p: fs.PathLike) => {
        const s = String(p);
        return s.endsWith('package.json') || s === '/test/project';
      });
      const outdatedOutput = JSON.stringify({
        lodash: { current: '4.17.0', wanted: '4.17.21', latest: '5.0.0' },
        express: { current: '4.18.0', wanted: '4.18.2', latest: '4.18.2' },
      });
      mockShell.mockResolvedValue({ stdout: outdatedOutput, stderr: '', exitCode: 1, timedOut: false });
      const result = await executeDeepAnalysis({ projectDir: '/test/project', analysisType: 'dependencies' });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.dependencies).not.toBeNull();
        expect(result.data.dependencies!.outdated).toBe(2);
        expect(result.data.dependencies!.major).toBe(1);
      }
    });

    it('returns zero outdated for non-npm projects', async () => {
      mockExists.mockImplementation((p: fs.PathLike) => {
        const s = String(p);
        return s.endsWith('Cargo.toml') || s === '/test/rust';
      });
      const result = await executeDeepAnalysis({ projectDir: '/test/rust', analysisType: 'dependencies' });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.dependencies).not.toBeNull();
        expect(result.data.dependencies!.outdated).toBe(0);
      }
    });
  });

  describe('Complexity analysis', () => {
    it('counts files and lines from find/wc output', async () => {
      mockExists.mockImplementation((p: fs.PathLike) => {
        const s = String(p);
        return s.endsWith('package.json') || s === '/test/project';
      });
      const wcOutput = '  100 ./src/index.ts\n  200 ./src/app.ts\n  50 ./src/util.ts\n  350 total';
      mockShell.mockResolvedValue({ stdout: wcOutput, stderr: '', exitCode: 0, timedOut: false });
      const result = await executeDeepAnalysis({ projectDir: '/test/project', analysisType: 'complexity' });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.complexity).not.toBeNull();
        expect(result.data.complexity!.totalFiles).toBe(3);
        expect(result.data.complexity!.totalLines).toBe(350);
        expect(result.data.complexity!.largestFiles[0].lines).toBe(200);
      }
    });
  });

  describe('Error handling', () => {
    it('returns error for non-existent directory', async () => {
      mockExists.mockReturnValue(false);
      const result = await executeDeepAnalysis({ projectDir: '/nonexistent' });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('NOT_FOUND');
    });

    it('handles missing tools gracefully', async () => {
      mockExists.mockImplementation((p: fs.PathLike) => String(p) === '/test/empty');
      const result = await executeDeepAnalysis({ projectDir: '/test/empty', analysisType: 'security' });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.security).not.toBeNull();
        expect(result.data.security!.details).toContain('No security audit tool');
      }
    });
  });

  describe('Summary', () => {
    it('includes all analysis types in summary', async () => {
      mockExists.mockImplementation((p: fs.PathLike) => {
        const s = String(p);
        return s.endsWith('package.json') || s === '/test/project';
      });
      mockShell.mockResolvedValue({ stdout: '{}', stderr: '', exitCode: 0, timedOut: false });
      const result = await executeDeepAnalysis({ projectDir: '/test/project', analysisType: 'all' });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.summary).toContain('Security');
        expect(result.data.summary).toContain('Dependencies');
        expect(result.data.summary).toContain('Complexity');
      }
    });
  });
});
