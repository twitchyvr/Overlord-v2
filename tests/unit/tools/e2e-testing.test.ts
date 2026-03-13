import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { executeE2ETest } from '../../../src/tools/providers/e2e-testing.js';
vi.mock('../../../src/tools/providers/shell.js', () => ({ executeShell: vi.fn() }));
vi.mock('node:fs', async () => { const actual = await vi.importActual<typeof import('node:fs')>('node:fs'); return { ...actual, existsSync: vi.fn() }; });
import { executeShell } from '../../../src/tools/providers/shell.js';
const mockShell = vi.mocked(executeShell); const mockExists = vi.mocked(fs.existsSync);
beforeEach(() => { vi.clearAllMocks(); });

describe('E2E Testing Tool', () => {
  describe('Error handling', () => {
    it('returns error for non-existent directory', async () => {
      mockExists.mockReturnValue(false);
      const r = await executeE2ETest({ projectDir: '/nonexistent' });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe('NOT_FOUND');
    });

    it('handles shell exceptions', async () => {
      mockExists.mockReturnValue(true);
      mockShell.mockRejectedValue(new Error('Shell crashed'));
      const r = await executeE2ETest({ projectDir: '/test/project' });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe('E2E_ERROR');
    });
  });

  describe('Framework detection', () => {
    it('detects Playwright', async () => {
      mockExists.mockImplementation((p: fs.PathLike) => {
        const s = String(p);
        return s === '/test/project' || s === path.join('/test/project', 'playwright.config.ts');
      });
      mockShell.mockResolvedValue({ stdout: '3 passed', stderr: '', exitCode: 0, timedOut: false });
      const r = await executeE2ETest({ projectDir: '/test/project' });
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.data.framework).toBe('playwright');
        expect(r.data.passed).toBe(3);
      }
      expect(mockShell).toHaveBeenCalledWith(expect.objectContaining({ command: 'npx playwright test' }));
    });

    it('detects Cypress', async () => {
      mockExists.mockImplementation((p: fs.PathLike) => {
        const s = String(p);
        return s === '/test/project' || s === path.join('/test/project', 'cypress.config.ts');
      });
      mockShell.mockResolvedValue({ stdout: 'Passing: 5\nFailing: 1', stderr: '', exitCode: 1, timedOut: false });
      const r = await executeE2ETest({ projectDir: '/test/project' });
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.data.framework).toBe('cypress');
        expect(r.data.passed).toBe(5);
        expect(r.data.failed).toBe(1);
      }
    });

    it('detects Jest', async () => {
      mockExists.mockImplementation((p: fs.PathLike) => {
        const s = String(p);
        return s === '/test/project' || s === path.join('/test/project', 'jest.config.ts');
      });
      mockShell.mockResolvedValue({ stdout: 'Tests:  10 passed, 2 failed, 12 total', stderr: '', exitCode: 1, timedOut: false });
      const r = await executeE2ETest({ projectDir: '/test/project' });
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.data.framework).toBe('jest');
        expect(r.data.passed).toBe(10);
        expect(r.data.failed).toBe(2);
        expect(r.data.testsRun).toBe(12);
      }
    });

    it('detects Vitest', async () => {
      mockExists.mockImplementation((p: fs.PathLike) => {
        const s = String(p);
        return s === '/test/project' || s === path.join('/test/project', 'vitest.config.ts');
      });
      mockShell.mockResolvedValue({ stdout: 'Tests 7 passed | 0 failed', stderr: '', exitCode: 0, timedOut: false });
      const r = await executeE2ETest({ projectDir: '/test/project' });
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.data.framework).toBe('vitest');
        expect(r.data.passed).toBe(7);
        expect(r.data.failed).toBe(0);
      }
    });

    it('falls back to npm test when no framework detected', async () => {
      // Only the projectDir itself exists
      mockExists.mockImplementation((p: fs.PathLike) => String(p) === '/test/project');
      mockShell.mockResolvedValue({ stdout: '4 passing\n0 failing', stderr: '', exitCode: 0, timedOut: false });
      const r = await executeE2ETest({ projectDir: '/test/project' });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.data.framework).toBe('npm');
      expect(mockShell).toHaveBeenCalledWith(expect.objectContaining({ command: 'npm test' }));
    });
  });

  describe('Custom command', () => {
    it('uses testCommand when provided', async () => {
      mockExists.mockImplementation((p: fs.PathLike) => String(p) === '/test/project');
      mockShell.mockResolvedValue({ stdout: '2 passed', stderr: '', exitCode: 0, timedOut: false });
      const r = await executeE2ETest({ projectDir: '/test/project', testCommand: 'npx vitest run --coverage' });
      expect(r.ok).toBe(true);
      expect(mockShell).toHaveBeenCalledWith(expect.objectContaining({ command: 'npx vitest run --coverage' }));
    });

    it('uses explicit framework name with testCommand', async () => {
      mockExists.mockImplementation((p: fs.PathLike) => String(p) === '/test/project');
      mockShell.mockResolvedValue({ stdout: '1 passed', stderr: '', exitCode: 0, timedOut: false });
      const r = await executeE2ETest({ projectDir: '/test/project', testCommand: 'custom-runner', framework: 'playwright' });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.data.framework).toBe('playwright');
    });
  });

  describe('Timeout', () => {
    it('uses 300s timeout for test execution', async () => {
      mockExists.mockImplementation((p: fs.PathLike) => String(p) === '/test/project');
      mockShell.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0, timedOut: false });
      await executeE2ETest({ projectDir: '/test/project' });
      expect(mockShell).toHaveBeenCalledWith(expect.objectContaining({ timeout: 300_000 }));
    });
  });

  describe('Duration tracking', () => {
    it('records duration of test run', async () => {
      mockExists.mockImplementation((p: fs.PathLike) => String(p) === '/test/project');
      mockShell.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0, timedOut: false });
      const r = await executeE2ETest({ projectDir: '/test/project' });
      expect(r.ok).toBe(true);
      if (r.ok) expect(typeof r.data.duration).toBe('number');
    });
  });
});
