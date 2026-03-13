import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { executeDevServer, getServerMap } from '../../../src/tools/providers/dev-server.js';

// Mock spawn to avoid real process creation
const mockOn = vi.fn();
const mockStdout = { on: vi.fn() };
const mockStderr = { on: vi.fn() };
const mockUnref = vi.fn();
const mockKill = vi.fn();

vi.mock('node:child_process', () => ({
  spawn: vi.fn(() => ({
    pid: 12345,
    stdout: mockStdout,
    stderr: mockStderr,
    on: mockOn,
    unref: mockUnref,
    kill: mockKill,
  })),
}));

// Mock process.kill for stop/status checks
const originalKill = process.kill;

beforeEach(() => {
  vi.clearAllMocks();
  getServerMap().clear();
});

afterEach(() => {
  process.kill = originalKill;
  getServerMap().clear();
});

describe('Dev Server Tool', () => {
  describe('start action', () => {
    it('starts a server and tracks it', async () => {
      const r = await executeDevServer({
        action: 'start',
        projectDir: '/test/project',
        command: 'npm run dev',
        port: 3000,
      });

      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.data.action).toBe('start');
        expect(r.data.pid).toBe(12345);
        expect(r.data.port).toBe(3000);
        expect(r.data.url).toBe('http://localhost:3000');
        expect(r.data.running).toBe(true);
      }

      expect(getServerMap().has('/test/project')).toBe(true);
    });

    it('uses default command and port', async () => {
      const r = await executeDevServer({
        action: 'start',
        projectDir: '/test/project',
      });

      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.data.port).toBe(3000);
      }
    });

    it('rejects starting when already running', async () => {
      // Start first server
      await executeDevServer({ action: 'start', projectDir: '/test/project' });

      // Mock process.kill to indicate the process is alive
      process.kill = vi.fn() as unknown as typeof process.kill;

      const r = await executeDevServer({ action: 'start', projectDir: '/test/project' });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe('ALREADY_RUNNING');
    });
  });

  describe('stop action', () => {
    it('stops a running server', async () => {
      // Start a server first
      await executeDevServer({ action: 'start', projectDir: '/test/project' });
      expect(getServerMap().has('/test/project')).toBe(true);

      // Mock process.kill for the stop call
      process.kill = vi.fn() as unknown as typeof process.kill;

      const r = await executeDevServer({ action: 'stop', projectDir: '/test/project' });
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.data.action).toBe('stop');
        expect(r.data.running).toBe(false);
        expect(r.data.pid).toBe(12345);
      }
      expect(getServerMap().has('/test/project')).toBe(false);
    });

    it('returns error when no server is running', async () => {
      const r = await executeDevServer({ action: 'stop', projectDir: '/test/project' });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe('NOT_RUNNING');
    });
  });

  describe('status action', () => {
    it('reports not running when no server exists', async () => {
      const r = await executeDevServer({ action: 'status', projectDir: '/test/project' });
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.data.running).toBe(false);
        expect(r.data.action).toBe('status');
      }
    });

    it('reports running status with port and URL', async () => {
      await executeDevServer({ action: 'start', projectDir: '/test/project', port: 8080 });

      // Mock process.kill(pid, 0) to indicate alive
      process.kill = vi.fn() as unknown as typeof process.kill;

      const r = await executeDevServer({ action: 'status', projectDir: '/test/project' });
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.data.running).toBe(true);
        expect(r.data.port).toBe(8080);
        expect(r.data.url).toBe('http://localhost:8080');
      }
    });

    it('cleans up dead process on status check', async () => {
      await executeDevServer({ action: 'start', projectDir: '/test/project' });

      // Mock process.kill to throw (process dead)
      process.kill = vi.fn(() => { throw new Error('ESRCH'); }) as unknown as typeof process.kill;

      const r = await executeDevServer({ action: 'status', projectDir: '/test/project' });
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.data.running).toBe(false);
      }
      expect(getServerMap().has('/test/project')).toBe(false);
    });
  });

  describe('logs action', () => {
    it('returns error when no server is running', async () => {
      const r = await executeDevServer({ action: 'logs', projectDir: '/test/project' });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe('NOT_RUNNING');
    });

    it('returns captured log output', async () => {
      await executeDevServer({ action: 'start', projectDir: '/test/project' });

      // Simulate stdout data by calling the on('data') callback
      const entry = getServerMap().get('/test/project')!;
      entry.stdout.push('Server started on port 3000');
      entry.stderr.push('Warning: deprecated API');

      // Mock process.kill for isProcessAlive
      process.kill = vi.fn() as unknown as typeof process.kill;

      const r = await executeDevServer({ action: 'logs', projectDir: '/test/project' });
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.data.output).toContain('Server started on port 3000');
        expect(r.data.output).toContain('Warning: deprecated API');
      }
    });
  });
});
