import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import { executeStaticAnalysis } from '../../../src/tools/providers/static-analysis.js';
vi.mock('../../../src/tools/providers/shell.js', () => ({ executeShell: vi.fn() }));
vi.mock('node:fs', async () => { const actual = await vi.importActual<typeof import('node:fs')>('node:fs'); return { ...actual, existsSync: vi.fn() }; });
import { executeShell } from '../../../src/tools/providers/shell.js';
const mockShell = vi.mocked(executeShell); const mockExists = vi.mocked(fs.existsSync);
beforeEach(() => { vi.clearAllMocks(); });
describe('Static Analysis Tool', () => {
  describe('Project type detection', () => {
    it('detects Node.js', async () => { mockExists.mockImplementation((p: fs.PathLike) => { const s = String(p); return s.endsWith('package.json') || s === '/test/project'; }); mockShell.mockResolvedValue({ stdout: '[]', stderr: '', exitCode: 0, timedOut: false }); const r = await executeStaticAnalysis({ projectDir: '/test/project' }); expect(r.ok).toBe(true); if (r.ok) expect(r.data.projectType).toBe('node'); });
    it('detects Rust', async () => { mockExists.mockImplementation((p: fs.PathLike) => { const s = String(p); return s.endsWith('Cargo.toml') || s === '/test/rust'; }); mockShell.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0, timedOut: false }); const r = await executeStaticAnalysis({ projectDir: '/test/rust' }); expect(r.ok).toBe(true); if (r.ok) expect(r.data.projectType).toBe('rust'); });
    it('detects Python', async () => { mockExists.mockImplementation((p: fs.PathLike) => { const s = String(p); return s.endsWith('pyproject.toml') || s === '/test/py'; }); mockShell.mockResolvedValue({ stdout: '[]', stderr: '', exitCode: 0, timedOut: false }); const r = await executeStaticAnalysis({ projectDir: '/test/py' }); expect(r.ok).toBe(true); if (r.ok) expect(r.data.projectType).toBe('python'); });
    it('detects Go', async () => { mockExists.mockImplementation((p: fs.PathLike) => { const s = String(p); return s.endsWith('go.mod') || s === '/test/go'; }); mockShell.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0, timedOut: false }); const r = await executeStaticAnalysis({ projectDir: '/test/go' }); expect(r.ok).toBe(true); if (r.ok) expect(r.data.projectType).toBe('go'); });
    it('returns unknown', async () => { mockExists.mockImplementation((p: fs.PathLike) => String(p) === '/test/empty'); const r = await executeStaticAnalysis({ projectDir: '/test/empty' }); expect(r.ok).toBe(true); if (r.ok) { expect(r.data.projectType).toBe('unknown'); expect(r.data.summary).toBe('No lint tools detected'); } });
  });
  describe('Error handling', () => {
    it('non-existent dir', async () => { mockExists.mockReturnValue(false); const r = await executeStaticAnalysis({ projectDir: '/nonexistent' }); expect(r.ok).toBe(false); if (!r.ok) expect(r.error.code).toBe('NOT_FOUND'); });
    it('shell errors', async () => { mockExists.mockImplementation((p: fs.PathLike) => { const s = String(p); return s.endsWith('package.json') || s === '/test/project'; }); mockShell.mockRejectedValue(new Error('Shell crashed')); const r = await executeStaticAnalysis({ projectDir: '/test/project' }); expect(r.ok).toBe(false); if (!r.ok) expect(r.error.code).toBe('ANALYSIS_ERROR'); });
  });
  describe('Node.js analysis', () => {
    it('parses ESLint', async () => { mockExists.mockImplementation((p: fs.PathLike) => { const s = String(p); return s.endsWith('package.json') || s === '/test/project'; }); mockShell.mockResolvedValueOnce({ stdout: JSON.stringify([{ filePath: '/a.ts', errorCount: 3, warningCount: 1, messages: [] }, { filePath: '/b.ts', errorCount: 0, warningCount: 2, messages: [] }]), stderr: '', exitCode: 1, timedOut: false }).mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0, timedOut: false }); const r = await executeStaticAnalysis({ projectDir: '/test/project' }); expect(r.ok).toBe(true); if (r.ok) { expect(r.data.lintErrors).toBe(3); expect(r.data.warnings).toBe(3); } });
    it('counts tsc errors', async () => { mockExists.mockImplementation((p: fs.PathLike) => { const s = String(p); return s.endsWith('package.json') || s === '/test/project'; }); mockShell.mockResolvedValueOnce({ stdout: '[]', stderr: '', exitCode: 0, timedOut: false }).mockResolvedValueOnce({ stdout: 'src/a.ts(1,5): error TS2322: Type...\nsrc/b.ts(10,3): error TS2345: Arg...', stderr: '', exitCode: 1, timedOut: false }); const r = await executeStaticAnalysis({ projectDir: '/test/project' }); expect(r.ok).toBe(true); if (r.ok) expect(r.data.typeErrors).toBe(2); });
    it('respects checks param', async () => { mockExists.mockImplementation((p: fs.PathLike) => { const s = String(p); return s.endsWith('package.json') || s === '/test/project'; }); mockShell.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0, timedOut: false }); await executeStaticAnalysis({ projectDir: '/test/project', checks: ['typecheck'] }); expect(mockShell).toHaveBeenCalledTimes(1); expect(mockShell.mock.calls[0][0].command).toContain('tsc'); });
  });
});
