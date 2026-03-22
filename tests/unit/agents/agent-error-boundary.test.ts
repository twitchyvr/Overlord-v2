/**
 * Agent Error Boundary Tests (#945)
 *
 * Tests for per-agent fault containment: error catching, lock cleanup,
 * bus event emission, and graceful degradation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentErrorBoundary } from '../../../src/agents/agent-error-boundary.js';

// ── Mocks ──

vi.mock('../../../src/core/logger.js', () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
}));

// ── Test Helpers ──

function createMockLockManager() {
  return {
    releaseAllForAgent: vi.fn().mockReturnValue({ ok: true, data: { released: 2 } }),
  };
}

function createMockBus() {
  return {
    emit: vi.fn().mockReturnValue(true),
  };
}

// ── Tests ──

describe('AgentErrorBoundary (#945)', () => {
  let mockLockMgr: ReturnType<typeof createMockLockManager>;
  let mockBus: ReturnType<typeof createMockBus>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockLockMgr = createMockLockManager();
    mockBus = createMockBus();
  });

  describe('execute — success path', () => {
    it('returns ok(value) when function succeeds', async () => {
      const boundary = new AgentErrorBoundary('agent-1', mockLockMgr as any, mockBus as any);

      const result = await boundary.execute(async () => 42);

      expect(result.ok).toBe(true);
      expect(result.data).toBe(42);
    });

    it('does not release locks on success', async () => {
      const boundary = new AgentErrorBoundary('agent-1', mockLockMgr as any, mockBus as any);

      await boundary.execute(async () => 'ok');

      expect(mockLockMgr.releaseAllForAgent).not.toHaveBeenCalled();
    });

    it('does not emit error event on success', async () => {
      const boundary = new AgentErrorBoundary('agent-1', mockLockMgr as any, mockBus as any);

      await boundary.execute(async () => 'ok');

      expect(mockBus.emit).not.toHaveBeenCalled();
    });
  });

  describe('execute — error path', () => {
    it('catches thrown Error and returns Result err', async () => {
      const boundary = new AgentErrorBoundary('agent-1', mockLockMgr as any, mockBus as any);

      const result = await boundary.execute(async () => {
        throw new Error('something broke');
      });

      expect(result.ok).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error!.code).toBe('AGENT_ERROR');
      expect(result.error!.message).toContain('something broke');
      expect(result.error!.message).toContain('agent-1');
    });

    it('releases all locks on error', async () => {
      const boundary = new AgentErrorBoundary('agent-1', mockLockMgr as any, mockBus as any);

      await boundary.execute(async () => { throw new Error('fail'); });

      expect(mockLockMgr.releaseAllForAgent).toHaveBeenCalledWith('agent-1');
    });

    it('emits agent:error event on bus', async () => {
      const boundary = new AgentErrorBoundary('agent-1', mockLockMgr as any, mockBus as any);

      await boundary.execute(async () => { throw new Error('crash'); });

      expect(mockBus.emit).toHaveBeenCalledWith('agent:error', expect.objectContaining({
        agentId: 'agent-1',
        error: { code: 'AGENT_ERROR', message: 'crash' },
      }));
    });

    it('marks error as retryable', async () => {
      const boundary = new AgentErrorBoundary('agent-1', mockLockMgr as any, mockBus as any);

      const result = await boundary.execute(async () => { throw new Error('x'); });

      expect(result.error!.retryable).toBe(true);
    });

    it('handles non-Error throws (strings)', async () => {
      const boundary = new AgentErrorBoundary('agent-1', mockLockMgr as any, mockBus as any);

      const result = await boundary.execute(async () => {
        throw 'string error';  // eslint-disable-line no-throw-literal
      });

      expect(result.ok).toBe(false);
      expect(result.error!.message).toContain('string error');
    });

    it('handles non-Error throws (numbers)', async () => {
      const boundary = new AgentErrorBoundary('agent-1', mockLockMgr as any, mockBus as any);

      const result = await boundary.execute(async () => {
        throw 404;  // eslint-disable-line no-throw-literal
      });

      expect(result.ok).toBe(false);
      expect(result.error!.message).toContain('404');
    });
  });

  describe('graceful degradation', () => {
    it('works without lockManager (no-op cleanup)', async () => {
      const boundary = new AgentErrorBoundary('agent-1', undefined, mockBus as any);

      const result = await boundary.execute(async () => { throw new Error('no locks'); });

      expect(result.ok).toBe(false);
      expect(result.error!.code).toBe('AGENT_ERROR');
      // Should not throw — gracefully handles missing lockManager
    });

    it('works without bus (no-op events)', async () => {
      const boundary = new AgentErrorBoundary('agent-1', mockLockMgr as any, undefined);

      const result = await boundary.execute(async () => { throw new Error('no bus'); });

      expect(result.ok).toBe(false);
      expect(mockLockMgr.releaseAllForAgent).toHaveBeenCalled();
      // Should not throw — gracefully handles missing bus
    });

    it('works without lockManager and bus', async () => {
      const boundary = new AgentErrorBoundary('agent-1');

      const result = await boundary.execute(async () => { throw new Error('bare'); });

      expect(result.ok).toBe(false);
      expect(result.error!.code).toBe('AGENT_ERROR');
    });

    it('handles lock cleanup failure gracefully', async () => {
      mockLockMgr.releaseAllForAgent.mockImplementation(() => { throw new Error('lock dir gone'); });
      const boundary = new AgentErrorBoundary('agent-1', mockLockMgr as any, mockBus as any);

      const result = await boundary.execute(async () => { throw new Error('main error'); });

      // Should still return the original error, not the lock cleanup error
      expect(result.ok).toBe(false);
      expect(result.error!.message).toContain('main error');
    });
  });

  describe('cleanup()', () => {
    it('releases all locks', () => {
      const boundary = new AgentErrorBoundary('agent-1', mockLockMgr as any, mockBus as any);

      boundary.cleanup();

      expect(mockLockMgr.releaseAllForAgent).toHaveBeenCalledWith('agent-1');
    });

    it('emits agent:cleanup event', () => {
      const boundary = new AgentErrorBoundary('agent-1', mockLockMgr as any, mockBus as any);

      boundary.cleanup();

      expect(mockBus.emit).toHaveBeenCalledWith('agent:cleanup', expect.objectContaining({
        agentId: 'agent-1',
      }));
    });

    it('works without lockManager', () => {
      const boundary = new AgentErrorBoundary('agent-1', undefined, mockBus as any);

      expect(() => boundary.cleanup()).not.toThrow();
      expect(mockBus.emit).toHaveBeenCalled();
    });
  });
});
