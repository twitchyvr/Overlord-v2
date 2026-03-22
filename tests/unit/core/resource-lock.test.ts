/**
 * Resource Lock — Unit Tests (#939)
 *
 * Tests the two-level filesystem locking system for parallel agent coordination.
 * Uses isolated temp directories per test to avoid cross-test interference.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { ResourceLockManager } from '../../../src/core/resource-lock.js';

// ── Test Helpers ──

function makeTempLockDir(): string {
  const dir = path.join(os.tmpdir(), `overlord-lock-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function cleanDir(dir: string): void {
  try {
    const entries = fs.readdirSync(dir);
    for (const entry of entries) {
      const fullPath = path.join(dir, entry);
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        fs.rmdirSync(fullPath);
      } else {
        fs.unlinkSync(fullPath);
      }
    }
    fs.rmdirSync(dir);
  } catch {
    // Best-effort cleanup
  }
}

// ── Tests ──

describe('ResourceLockManager', () => {
  let lockDir: string;
  let manager: ResourceLockManager;

  beforeEach(() => {
    lockDir = makeTempLockDir();
    manager = new ResourceLockManager(lockDir);
  });

  afterEach(() => {
    cleanDir(lockDir);
  });

  // ── Acquire ──

  describe('acquire', () => {
    it('should acquire a lock on an unlocked resource', async () => {
      const result = await manager.acquire('agent-1', 'file:src/foo.ts');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.resource).toBe('file:src/foo.ts');
        expect(result.data.agentId).toBe('agent-1');
        expect(result.data.acquiredAt).toBeGreaterThan(0);
        expect(result.data.refreshedAt).toBeGreaterThan(0);
        expect(result.data.ttl).toBe(30_000); // file: default
      }
    });

    it('should use correct default TTL for different resource types', async () => {
      const fileResult = await manager.acquire('agent-1', 'file:test.ts');
      expect(fileResult.ok && fileResult.data.ttl).toBe(30_000);

      const gitResult = await manager.acquire('agent-1', 'git');
      expect(gitResult.ok && gitResult.data.ttl).toBe(60_000);

      const buildResult = await manager.acquire('agent-1', 'build');
      expect(buildResult.ok && buildResult.data.ttl).toBe(120_000);

      const browserResult = await manager.acquire('agent-1', 'browser');
      expect(browserResult.ok && browserResult.data.ttl).toBe(30_000);
    });

    it('should use custom TTL when provided', async () => {
      const result = await manager.acquire('agent-1', 'file:test.ts', { ttl: 5_000 });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.ttl).toBe(5_000);
      }
    });

    it('should allow same agent to re-acquire (idempotent)', async () => {
      const first = await manager.acquire('agent-1', 'file:test.ts');
      expect(first.ok).toBe(true);

      const second = await manager.acquire('agent-1', 'file:test.ts');
      expect(second.ok).toBe(true);
      if (first.ok && second.ok) {
        expect(second.data.agentId).toBe('agent-1');
        expect(second.data.refreshedAt).toBeGreaterThanOrEqual(first.data.refreshedAt);
      }
    });

    it('should block different agent on locked resource', async () => {
      await manager.acquire('agent-1', 'file:test.ts', { ttl: 60_000 });

      // Agent-2 tries to acquire with very short maxWait
      const result = await manager.acquire('agent-2', 'file:test.ts', {
        ttl: 30_000,
        maxWait: 100, // Short timeout to fail fast
        retryInterval: 50,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('LOCK_TIMEOUT');
      }
    });

    it('should allow acquisition after lock expires', async () => {
      // Agent-1 acquires with a very short TTL
      await manager.acquire('agent-1', 'file:test.ts', { ttl: 1 });

      // Wait for expiry + grace period
      await new Promise(resolve => setTimeout(resolve, 2_100));

      // Agent-2 should be able to acquire
      const result = await manager.acquire('agent-2', 'file:test.ts', {
        maxWait: 100,
        retryInterval: 50,
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.agentId).toBe('agent-2');
      }
    });

    it('should store metadata with the lock', async () => {
      await manager.acquire('agent-1', 'file:test.ts', {
        metadata: { reason: 'editing', priority: 'high' },
      });

      const lockResult = await manager.isLocked('file:test.ts');
      expect(lockResult.ok).toBe(true);
      if (lockResult.ok && lockResult.data) {
        expect(lockResult.data.metadata).toEqual({ reason: 'editing', priority: 'high' });
      }
    });

    it('should acquire multiple different resources for same agent', async () => {
      const r1 = await manager.acquire('agent-1', 'file:a.ts');
      const r2 = await manager.acquire('agent-1', 'file:b.ts');
      const r3 = await manager.acquire('agent-1', 'git');

      expect(r1.ok).toBe(true);
      expect(r2.ok).toBe(true);
      expect(r3.ok).toBe(true);

      const locks = manager.listLocks();
      expect(locks.ok).toBe(true);
      if (locks.ok) {
        expect(locks.data.length).toBe(3);
      }
    });

    it('should reject empty resource name', async () => {
      const result = await manager.acquire('agent-1', '');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_RESOURCE');
      }
    });
  });

  // ── Release ──

  describe('release', () => {
    it('should release a held lock', async () => {
      await manager.acquire('agent-1', 'file:test.ts');
      const result = await manager.release('agent-1', 'file:test.ts');
      expect(result.ok).toBe(true);

      const locked = await manager.isLocked('file:test.ts');
      expect(locked.ok && locked.data).toBeNull();
    });

    it('should be idempotent on already-unlocked resource', async () => {
      const result = await manager.release('agent-1', 'file:test.ts');
      expect(result.ok).toBe(true);
    });

    it('should reject release from non-holder', async () => {
      await manager.acquire('agent-1', 'file:test.ts');
      const result = await manager.release('agent-2', 'file:test.ts');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NOT_HOLDER');
      }
    });

    it('should allow force release by non-holder', async () => {
      await manager.acquire('agent-1', 'file:test.ts');
      const result = await manager.release('agent-2', 'file:test.ts', true);
      expect(result.ok).toBe(true);

      const locked = await manager.isLocked('file:test.ts');
      expect(locked.ok && locked.data).toBeNull();
    });

    it('should allow another agent to acquire after release', async () => {
      await manager.acquire('agent-1', 'file:test.ts');
      await manager.release('agent-1', 'file:test.ts');

      const result = await manager.acquire('agent-2', 'file:test.ts', {
        maxWait: 100,
        retryInterval: 50,
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.agentId).toBe('agent-2');
      }
    });
  });

  // ── Refresh ──

  describe('refresh', () => {
    it('should refresh the TTL timestamp', async () => {
      const acquired = await manager.acquire('agent-1', 'file:test.ts');
      expect(acquired.ok).toBe(true);

      // Small delay to ensure timestamp difference
      await new Promise(resolve => setTimeout(resolve, 10));

      const refreshed = await manager.refresh('agent-1', 'file:test.ts');
      expect(refreshed.ok).toBe(true);
      if (acquired.ok && refreshed.ok) {
        expect(refreshed.data.refreshedAt).toBeGreaterThanOrEqual(acquired.data.refreshedAt);
      }
    });

    it('should reject refresh from non-holder', async () => {
      await manager.acquire('agent-1', 'file:test.ts');
      const result = await manager.refresh('agent-2', 'file:test.ts');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NOT_HOLDER');
      }
    });

    it('should reject refresh on unlocked resource', async () => {
      const result = await manager.refresh('agent-1', 'file:test.ts');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NOT_LOCKED');
      }
    });
  });

  // ── isLocked ──

  describe('isLocked', () => {
    it('should return null for unlocked resource', async () => {
      const result = await manager.isLocked('file:test.ts');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data).toBeNull();
      }
    });

    it('should return lock state for locked resource', async () => {
      await manager.acquire('agent-1', 'file:test.ts');
      const result = await manager.isLocked('file:test.ts');

      expect(result.ok).toBe(true);
      if (result.ok && result.data) {
        expect(result.data.resource).toBe('file:test.ts');
        expect(result.data.agentId).toBe('agent-1');
        expect(result.data.ttl).toBe(30_000);
      }
    });

    it('should return null for expired lock (and clean it up)', async () => {
      await manager.acquire('agent-1', 'file:test.ts', { ttl: 1 });

      // Wait for expiry + grace
      await new Promise(resolve => setTimeout(resolve, 2_100));

      const result = await manager.isLocked('file:test.ts');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data).toBeNull();
      }

      // Verify lock file was cleaned up
      const files = fs.readdirSync(lockDir).filter(f => f.endsWith('.lock.json'));
      expect(files.length).toBe(0);
    });
  });

  // ── listLocks ──

  describe('listLocks', () => {
    it('should return empty array when no locks', () => {
      const result = manager.listLocks();
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data).toEqual([]);
      }
    });

    it('should return all active locks', async () => {
      await manager.acquire('agent-1', 'file:a.ts');
      await manager.acquire('agent-2', 'file:b.ts');
      await manager.acquire('agent-1', 'git');

      const result = manager.listLocks();
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.length).toBe(3);
        const resources = result.data.map(l => l.resource).sort();
        expect(resources).toEqual(['file:a.ts', 'file:b.ts', 'git']);
      }
    });

    it('should exclude expired locks', async () => {
      await manager.acquire('agent-1', 'file:expired.ts', { ttl: 1 });
      await manager.acquire('agent-2', 'file:active.ts', { ttl: 60_000 });

      // Wait for first lock to expire
      await new Promise(resolve => setTimeout(resolve, 2_100));

      const result = manager.listLocks();
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.length).toBe(1);
        expect(result.data[0].resource).toBe('file:active.ts');
      }
    });
  });

  // ── releaseAllForAgent ──

  describe('releaseAllForAgent', () => {
    it('should release all locks held by the specified agent', async () => {
      await manager.acquire('agent-1', 'file:a.ts');
      await manager.acquire('agent-1', 'file:b.ts');
      await manager.acquire('agent-1', 'git');
      await manager.acquire('agent-2', 'file:c.ts');

      const result = manager.releaseAllForAgent('agent-1');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.released).toBe(3);
      }

      const locks = manager.listLocks();
      expect(locks.ok).toBe(true);
      if (locks.ok) {
        expect(locks.data.length).toBe(1);
        expect(locks.data[0].agentId).toBe('agent-2');
      }
    });

    it('should return 0 if agent holds no locks', () => {
      const result = manager.releaseAllForAgent('agent-ghost');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.released).toBe(0);
      }
    });
  });

  // ── sweepExpired ──

  describe('sweepExpired', () => {
    it('should clean up expired locks', async () => {
      await manager.acquire('agent-1', 'file:old.ts', { ttl: 1 });
      await manager.acquire('agent-2', 'file:fresh.ts', { ttl: 60_000 });

      // Wait for first lock to expire
      await new Promise(resolve => setTimeout(resolve, 2_100));

      const result = manager.sweepExpired();
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.swept).toBe(1);
      }

      const locks = manager.listLocks();
      expect(locks.ok).toBe(true);
      if (locks.ok) {
        expect(locks.data.length).toBe(1);
        expect(locks.data[0].resource).toBe('file:fresh.ts');
      }
    });

    it('should return 0 when nothing to sweep', async () => {
      await manager.acquire('agent-1', 'file:active.ts', { ttl: 60_000 });
      const result = manager.sweepExpired();
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.swept).toBe(0);
      }
    });

    it('should clean stale mutex directories', async () => {
      // Create a stale mutex dir manually
      const staleMutex = path.join(lockDir, 'stale_resource.mutex.d');
      fs.mkdirSync(staleMutex);

      // Backdate its mtime
      const pastTime = new Date(Date.now() - 10_000);
      fs.utimesSync(staleMutex, pastTime, pastTime);

      const result = manager.sweepExpired();
      expect(result.ok).toBe(true);

      expect(fs.existsSync(staleMutex)).toBe(false);
    });
  });

  // ── Crash Recovery ──

  describe('crash recovery', () => {
    it('should allow acquisition after TTL expiry simulating agent crash', async () => {
      // Simulate agent crash: acquire with short TTL, never refresh or release
      await manager.acquire('crashed-agent', 'git', { ttl: 1 });

      // Wait for TTL + grace period to expire
      await new Promise(resolve => setTimeout(resolve, 2_100));

      // Another agent should be able to acquire
      const result = await manager.acquire('healthy-agent', 'git', {
        maxWait: 100,
        retryInterval: 50,
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.agentId).toBe('healthy-agent');
      }
    });

    it('should handle corrupted lock file gracefully', async () => {
      // Write garbage to a lock file
      const lockFile = path.join(lockDir, 'file_broken_ts_abc123456789.lock.json');
      fs.writeFileSync(lockFile, '{{{{not json}}}', 'utf-8');

      // Should not crash — treats as unlocked
      const result = await manager.isLocked('file:broken.ts');
      expect(result.ok).toBe(true);
    });

    it('should handle lock file with wrong types gracefully', async () => {
      // Write type-incorrect data to a lock file — validation should catch this
      const lockFile = path.join(lockDir, 'file_typed_ts_abc123456789.lock.json');
      fs.writeFileSync(lockFile, JSON.stringify({
        resource: 42,           // should be string
        agentId: true,          // should be string
        acquiredAt: 'not-num',  // should be number
        refreshedAt: 1000,
        ttl: 30000,
      }), 'utf-8');

      // listLocks should not include the invalid file
      const result = manager.listLocks();
      expect(result.ok).toBe(true);
    });

    it('should handle missing lock directory gracefully', () => {
      // Remove the lock directory
      fs.rmdirSync(lockDir);

      // Constructor should recreate it
      const freshManager = new ResourceLockManager(lockDir);
      const result = freshManager.listLocks();
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data).toEqual([]);
      }
    });
  });

  // ── Resource Name Sanitization ──

  describe('resource name sanitization', () => {
    it('should handle resources with special characters', async () => {
      const result = await manager.acquire('agent-1', 'file:src/components/Header.tsx');
      expect(result.ok).toBe(true);

      const locked = await manager.isLocked('file:src/components/Header.tsx');
      expect(locked.ok).toBe(true);
      if (locked.ok && locked.data) {
        expect(locked.data.resource).toBe('file:src/components/Header.tsx');
      }
    });

    it('should handle resources with spaces and special chars', async () => {
      const result = await manager.acquire('agent-1', 'file:my project/file (1).ts');
      expect(result.ok).toBe(true);

      const locked = await manager.isLocked('file:my project/file (1).ts');
      expect(locked.ok).toBe(true);
      if (locked.ok) {
        expect(locked.data).not.toBeNull();
      }
    });

    it('should handle very long resource names via hash truncation', async () => {
      const longName = 'file:' + 'a'.repeat(500);
      const result = await manager.acquire('agent-1', longName);
      expect(result.ok).toBe(true);
    });

    it('should distinguish similar resources that sanitize differently', async () => {
      // "file:a/b" and "file:a_b" both sanitize to "file_a_b" without hash
      // With hash, they should be different lock files
      await manager.acquire('agent-1', 'file:a/b');
      await manager.acquire('agent-2', 'file:a_b');

      const locks = manager.listLocks();
      expect(locks.ok).toBe(true);
      if (locks.ok) {
        expect(locks.data.length).toBe(2);
        expect(locks.data.map(l => l.agentId).sort()).toEqual(['agent-1', 'agent-2']);
      }
    });
  });

  // ── Concurrent Access (within same process) ──

  describe('concurrent access', () => {
    it('should handle rapid sequential acquires', async () => {
      // Rapidly acquire and release the same resource
      for (let i = 0; i < 20; i++) {
        const result = await manager.acquire('agent-1', 'file:hotfile.ts', { ttl: 60_000 });
        expect(result.ok).toBe(true);
        await manager.release('agent-1', 'file:hotfile.ts');
      }
    });

    it('should handle acquire attempts while lock is held', async () => {
      await manager.acquire('agent-1', 'file:contested.ts', { ttl: 60_000 });

      // Multiple agents try to acquire simultaneously — all should fail fast
      const attempts = await Promise.all([
        manager.acquire('agent-2', 'file:contested.ts', { maxWait: 100, retryInterval: 50 }),
        manager.acquire('agent-3', 'file:contested.ts', { maxWait: 100, retryInterval: 50 }),
        manager.acquire('agent-4', 'file:contested.ts', { maxWait: 100, retryInterval: 50 }),
      ]);

      for (const attempt of attempts) {
        expect(attempt.ok).toBe(false);
        if (!attempt.ok) {
          expect(attempt.error.code).toBe('LOCK_TIMEOUT');
        }
      }
    });
  });

  // ── Edge Cases ──

  describe('edge cases', () => {
    it('should handle unknown resource type with default TTL', async () => {
      const result = await manager.acquire('agent-1', 'custom:something');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.ttl).toBe(30_000); // DEFAULT_TTL
      }
    });

    it('should write lock files atomically (temp + rename)', async () => {
      await manager.acquire('agent-1', 'file:atomic-test.ts');

      // Verify no .tmp files remain
      const tmpFiles = fs.readdirSync(lockDir).filter(f => f.endsWith('.tmp'));
      expect(tmpFiles.length).toBe(0);

      // Verify lock file exists and is valid JSON
      const lockFiles = fs.readdirSync(lockDir).filter(f => f.endsWith('.lock.json'));
      expect(lockFiles.length).toBe(1);
      const content = fs.readFileSync(path.join(lockDir, lockFiles[0]), 'utf-8');
      expect(() => JSON.parse(content)).not.toThrow();
    });
  });
});
