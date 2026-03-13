import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import { executeDeepAnalysis } from '../../../src/tools/providers/deep-analysis.js';
vi.mock('../../../src/tools/providers/shell.js', () => ({ executeShell: vi.fn() }));
vi.mock('node:fs', async () => { const actual = await vi.importActual<typeof import('node:fs')>('node:fs'); return { ...actual, existsSync: vi.fn() }; });
import { executeShell } from '../../../src/tools/providers/shell.js';
const mockShell = vi.mocked(executeShell); const mockExists = vi.mocked(fs.existsSync);
beforeEach(() => { vi.clearAllMocks(); });
describe('Deep Analysis Tool', () => {
  describe('Security', () => {
    it('structured npm audit', async () => { mockExists.mockImplementation((p: fs.PathLike) => { const s = String(p); return s.endsWith('package.json') || s === '/test/project'; }); mockShell.mockResolvedValue({ stdout: JSON.stringify({ metadata: { vulnerabilities: { total: 5, critical: 1, high: 2, moderate: 1, low: 1 } } }), stderr: '', exitCode: 1, timedOut: false }); const r = await executeDeepAnalysis({ projectDir: '/test/project', analysisType: 'security' }); expect(r.ok).toBe(true); if (r.ok) { expect(r.data.security!.vulnerabilities).toBe(5); expect(r.data.security!.critical).toBe(1); } });
    it('malformed audit', async () => { mockExists.mockImplementation((p: fs.PathLike) => { const s = String(p); return s.endsWith('package.json') || s === '/test/project'; }); mockShell.mockResolvedValue({ stdout: 'not json', stderr: '', exitCode: 1, timedOut: false }); const r = await executeDeepAnalysis({ projectDir: '/test/project', analysisType: 'security' }); expect(r.ok).toBe(true); if (r.ok) expect(r.data.security!.vulnerabilities).toBe(1); });
  });
  describe('Dependencies', () => {
    it('npm outdated', async () => { mockExists.mockImplementation((p: fs.PathLike) => { const s = String(p); return s.endsWith('package.json') || s === '/test/project'; }); mockShell.mockResolvedValue({ stdout: JSON.stringify({ lodash: { current: '4.17.0', wanted: '4.17.21', latest: '5.0.0' }, express: { current: '4.18.0', wanted: '4.18.2', latest: '4.18.2' } }), stderr: '', exitCode: 1, timedOut: false }); const r = await executeDeepAnalysis({ projectDir: '/test/project', analysisType: 'dependencies' }); expect(r.ok).toBe(true); if (r.ok) { expect(r.data.dependencies!.outdated).toBe(2); expect(r.data.dependencies!.major).toBe(1); } });
    it('non-npm zero', async () => { mockExists.mockImplementation((p: fs.PathLike) => { const s = String(p); return s.endsWith('Cargo.toml') || s === '/test/rust'; }); const r = await executeDeepAnalysis({ projectDir: '/test/rust', analysisType: 'dependencies' }); expect(r.ok).toBe(true); if (r.ok) expect(r.data.dependencies!.outdated).toBe(0); });
  });
  describe('Complexity', () => {
    it('counts files', async () => { mockExists.mockImplementation((p: fs.PathLike) => { const s = String(p); return s.endsWith('package.json') || s === '/test/project'; }); mockShell.mockResolvedValue({ stdout: '  100 ./src/index.ts\n  200 ./src/app.ts\n  50 ./src/util.ts\n  350 total', stderr: '', exitCode: 0, timedOut: false }); const r = await executeDeepAnalysis({ projectDir: '/test/project', analysisType: 'complexity' }); expect(r.ok).toBe(true); if (r.ok) { expect(r.data.complexity!.totalFiles).toBe(3); expect(r.data.complexity!.totalLines).toBe(350); } });
  });
  describe('Errors', () => {
    it('non-existent dir', async () => { mockExists.mockReturnValue(false); const r = await executeDeepAnalysis({ projectDir: '/nonexistent' }); expect(r.ok).toBe(false); if (!r.ok) expect(r.error.code).toBe('NOT_FOUND'); });
    it('missing tools', async () => { mockExists.mockImplementation((p: fs.PathLike) => String(p) === '/test/empty'); const r = await executeDeepAnalysis({ projectDir: '/test/empty', analysisType: 'security' }); expect(r.ok).toBe(true); if (r.ok) expect(r.data.security!.details).toContain('No security audit tool'); });
  });
  describe('Summary', () => {
    it('all types', async () => { mockExists.mockImplementation((p: fs.PathLike) => { const s = String(p); return s.endsWith('package.json') || s === '/test/project'; }); mockShell.mockResolvedValue({ stdout: '{}', stderr: '', exitCode: 0, timedOut: false }); const r = await executeDeepAnalysis({ projectDir: '/test/project', analysisType: 'all' }); expect(r.ok).toBe(true); if (r.ok) { expect(r.data.summary).toContain('Security'); expect(r.data.summary).toContain('Dependencies'); expect(r.data.summary).toContain('Complexity'); } });
  });
});
