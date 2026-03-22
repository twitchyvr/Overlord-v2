/**
 * Resource Lock — Two-Level Filesystem Locking for Parallel Agent Coordination (#939, #940)
 *
 * Prevents concurrent agents from corrupting shared resources (files, git, browser,
 * build artifacts). Inspired by @m13v's browser-lock architecture:
 *   https://github.com/m13v/browser-lock
 *   https://github.com/twitchyvr/Overlord-v2/issues/806#issuecomment-4103250652
 *
 * Design:
 *   Level 1 — Atomic mkdir mutex (short-lived, protects lock metadata file)
 *   Level 2 — JSON lock file (long-lived, tracks ownership with TTL-based expiry)
 *
 * Lock lifecycle: Acquire -> Refresh -> Expire (no mandatory explicit release).
 * Crashed agents never permanently block resources — TTL expiry handles cleanup.
 *
 * #940 additions:
 *   - Background sweep timer (auto-removes expired locks every 10s)
 *   - withLockRefresh() wrapper (auto-refreshes lock during long-running operations)
 *   - LockHandle.isExpired() / timeRemaining() convenience methods
 *
 * Layer: Core (no upper-layer imports)
 *
 * Attribution:
 *   Architecture inspired by m13v/browser-lock (no license — original implementation).
 *   Error isolation patterns inspired by mediar-ai/terminator (MIT License).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { ok, err } from './contracts.js';
import type { Result } from './contracts.js';
import { logger } from './logger.js';

const log = logger.child({ module: 'resource-lock' });

// ── Types ──

export interface LockState {
  resource: string;
  agentId: string;
  acquiredAt: number;
  refreshedAt: number;
  ttl: number;
  metadata?: Record<string, unknown>;
}

export interface LockHandle {
  resource: string;
  agentId: string;
  acquiredAt: number;
  /** Timestamp of last refresh. May be mutated by `withLockRefresh()` to stay accurate. */
  refreshedAt: number;
  ttl: number;

  /** Check if this lock handle has expired based on current time (includes grace period). */
  isExpired(): boolean;

  /**
   * Milliseconds remaining before this lock expires. Returns 0 if expired.
   * Includes the 2-second grace period in the calculation.
   */
  timeRemaining(): number;
}

export interface LockOptions {
  /** Lock TTL in ms. Default: 30000 (30s) */
  ttl?: number;
  /** Retry poll interval in ms. Default: 2000 (2s) */
  retryInterval?: number;
  /** Max wait time in ms before giving up. Default: 120000 (120s) */
  maxWait?: number;
  /** Arbitrary metadata stored with the lock */
  metadata?: Record<string, unknown>;
}

/** Default TTLs by resource type prefix */
const DEFAULT_TTLS: Record<string, number> = {
  browser: 30_000,
  git: 60_000,
  file: 30_000,
  build: 120_000,
  database: 30_000,
};

const DEFAULT_TTL = 30_000;
const DEFAULT_RETRY_INTERVAL = 2_000;
const DEFAULT_MAX_WAIT = 120_000;
const MUTEX_EXPIRY_MS = 5_000;
const MUTEX_POLL_MS = 50;
const GRACE_PERIOD_MS = 2_000;
const MAX_LOCK_COUNT = 1_000;
export const SWEEP_INTERVAL_MS = 10_000;

/**
 * Create a LockHandle with isExpired() and timeRemaining() convenience methods.
 * These methods are evaluated at call-time against the current clock.
 */
function makeLockHandle(resource: string, agentId: string, acquiredAt: number, refreshedAt: number, ttl: number): LockHandle {
  return {
    resource, agentId, acquiredAt, refreshedAt, ttl,
    isExpired(): boolean {
      return Date.now() > this.refreshedAt + this.ttl + GRACE_PERIOD_MS;
    },
    timeRemaining(): number {
      const remaining = (this.refreshedAt + this.ttl + GRACE_PERIOD_MS) - Date.now();
      return remaining > 0 ? remaining : 0;
    },
  };
}

// ── ResourceLockManager ──

export class ResourceLockManager {
  private readonly lockDir: string;
  private _sweepTimer: ReturnType<typeof setInterval> | null = null;

  constructor(lockDir?: string) {
    this.lockDir = lockDir ?? path.join(process.cwd(), '.overlord', 'locks');
    this._ensureLockDir();
  }

  // ── Background Sweep Timer ──

  /**
   * Start the background sweep timer that removes expired locks every SWEEP_INTERVAL_MS.
   * Idempotent — calling multiple times does not create multiple timers.
   */
  startSweepTimer(intervalMs?: number): void {
    if (this._sweepTimer) return; // Already running
    const interval = intervalMs ?? SWEEP_INTERVAL_MS;
    this._sweepTimer = setInterval(() => {
      try {
        this.sweepExpired();
      } catch (e) {
        log.error({ err: e instanceof Error ? e.message : String(e) }, 'Background sweep failed');
      }
    }, interval);
    // Ensure the timer doesn't prevent Node.js from exiting
    if (this._sweepTimer && typeof this._sweepTimer === 'object' && 'unref' in this._sweepTimer) {
      this._sweepTimer.unref();
    }
    log.info({ intervalMs: interval }, 'Lock sweep timer started');
  }

  /**
   * Stop the background sweep timer. Idempotent.
   */
  stopSweepTimer(): void {
    if (!this._sweepTimer) return;
    clearInterval(this._sweepTimer);
    this._sweepTimer = null;
    log.info('Lock sweep timer stopped');
  }

  /**
   * Whether the background sweep timer is running.
   */
  isSweepTimerRunning(): boolean {
    return this._sweepTimer !== null;
  }

  // ── Public API ──

  /**
   * Acquire a resource lock for an agent.
   * Blocks (polling) until the lock is available or maxWait is exceeded.
   */
  async acquire(agentId: string, resource: string, opts?: LockOptions): Promise<Result<LockHandle>> {
    if (!resource) {
      return err('INVALID_RESOURCE', 'Resource name cannot be empty', { retryable: false });
    }

    const ttl = opts?.ttl ?? this._defaultTtl(resource);
    const retryInterval = opts?.retryInterval ?? DEFAULT_RETRY_INTERVAL;
    const maxWait = opts?.maxWait ?? DEFAULT_MAX_WAIT;
    const metadata = opts?.metadata;
    const deadline = Date.now() + maxWait;

    while (true) {
      const result = await this._tryAcquire(agentId, resource, ttl, metadata);
      if (result.ok) return result;

      // If the error is not LOCK_BUSY, it's a real failure — don't retry
      if (result.error.code !== 'LOCK_BUSY') return result;

      // Check timeout
      if (Date.now() >= deadline) {
        log.warn({ agentId, resource, maxWait }, 'Lock acquisition timed out');
        return err('LOCK_TIMEOUT', `Timed out waiting for resource lock: ${resource}`, {
          retryable: false,
          context: { resource, agentId, maxWait },
        });
      }

      // Wait before retrying (non-blocking — yields to event loop)
      await this._sleep(retryInterval);
    }
  }

  /**
   * Release a resource lock. Only the holder can release (unless force=true).
   * Note: Explicit release is optional — TTL handles cleanup for crashed agents.
   */
  async release(agentId: string, resource: string, force?: boolean): Promise<Result<void>> {
    return this._withMutex(resource, () => {
      const lockFile = this._lockFilePath(resource);
      const state = this._readLockFile(lockFile);

      if (!state) {
        return ok(undefined); // Already unlocked — idempotent
      }

      if (state.agentId !== agentId && !force) {
        return err('NOT_HOLDER', `Lock on ${resource} is held by ${state.agentId}, not ${agentId}`, {
          retryable: false,
          context: { resource, holder: state.agentId, requester: agentId },
        });
      }

      this._deleteLockFile(lockFile);
      log.info({ agentId, resource, force: !!force }, 'Lock released');
      return ok(undefined);
    });
  }

  /**
   * Refresh the TTL on a held lock. Extends the expiry window.
   */
  async refresh(agentId: string, resource: string): Promise<Result<LockHandle>> {
    return this._withMutex(resource, () => {
      const lockFile = this._lockFilePath(resource);
      const state = this._readLockFile(lockFile);

      if (!state) {
        return err('NOT_LOCKED', `Resource ${resource} is not locked`, {
          retryable: false,
          context: { resource },
        });
      }

      if (state.agentId !== agentId) {
        return err('NOT_HOLDER', `Lock on ${resource} is held by ${state.agentId}, not ${agentId}`, {
          retryable: false,
          context: { resource, holder: state.agentId, requester: agentId },
        });
      }

      const now = Date.now();
      const updated: LockState = { ...state, refreshedAt: now };
      this._writeLockFile(lockFile, updated);

      log.debug({ agentId, resource, ttl: state.ttl }, 'Lock refreshed');
      return ok(makeLockHandle(updated.resource, updated.agentId, updated.acquiredAt, updated.refreshedAt, updated.ttl));
    });
  }

  /**
   * Check if a resource is currently locked (non-expired).
   */
  async isLocked(resource: string): Promise<Result<LockState | null>> {
    return this._withMutex(resource, () => {
      const lockFile = this._lockFilePath(resource);
      const state = this._readLockFile(lockFile);

      if (!state) return ok(null);

      if (this._isExpired(state)) {
        // Clean up expired lock
        this._deleteLockFile(lockFile);
        log.debug({ resource, agentId: state.agentId }, 'Expired lock cleaned during query');
        return ok(null);
      }

      return ok(state);
    });
  }

  /**
   * List all active (non-expired) locks.
   * Note: This is a best-effort read — does not acquire per-resource mutexes
   * for performance. Suitable for dashboard display, not for lock decisions.
   */
  listLocks(): Result<LockState[]> {
    try {
      this._ensureLockDir();
      const files = fs.readdirSync(this.lockDir).filter(f => f.endsWith('.lock.json'));
      const locks: LockState[] = [];

      for (const file of files) {
        const filePath = path.join(this.lockDir, file);
        const state = this._readLockFile(filePath);
        if (state && !this._isExpired(state)) {
          locks.push(state);
        } else if (state && this._isExpired(state)) {
          // Clean up expired
          this._deleteLockFile(filePath);
          log.debug({ resource: state.resource, agentId: state.agentId }, 'Expired lock cleaned during list');
        }
      }

      return ok(locks);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log.error({ err: msg }, 'Failed to list locks');
      return err('LIST_FAILED', `Failed to list locks: ${msg}`, { retryable: true });
    }
  }

  /**
   * Release all locks held by a specific agent.
   * Used for crash recovery / error boundary cleanup.
   * Note: Best-effort cleanup — does not acquire per-resource mutexes.
   * Should only be called when the agent is known to be dead/disconnected.
   */
  releaseAllForAgent(agentId: string): Result<{ released: number }> {
    try {
      this._ensureLockDir();
      const files = fs.readdirSync(this.lockDir).filter(f => f.endsWith('.lock.json'));
      let released = 0;

      for (const file of files) {
        const filePath = path.join(this.lockDir, file);
        const state = this._readLockFile(filePath);
        if (state && state.agentId === agentId) {
          this._deleteLockFile(filePath);
          released++;
          log.info({ agentId, resource: state.resource }, 'Lock released (agent cleanup)');
        }
      }

      return ok({ released });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log.error({ agentId, err: msg }, 'Failed to release agent locks');
      return err('RELEASE_ALL_FAILED', `Failed to release locks for agent: ${msg}`, { retryable: true });
    }
  }

  /**
   * Sweep all expired locks. Call periodically for garbage collection.
   */
  sweepExpired(): Result<{ swept: number }> {
    try {
      this._ensureLockDir();
      const files = fs.readdirSync(this.lockDir).filter(f => f.endsWith('.lock.json'));
      let swept = 0;

      for (const file of files) {
        const filePath = path.join(this.lockDir, file);
        const state = this._readLockFile(filePath);
        if (state && this._isExpired(state)) {
          this._deleteLockFile(filePath);
          swept++;
          log.info({ resource: state.resource, agentId: state.agentId }, 'Expired lock swept');
        }
      }

      // Also clean up any stale mutex dirs
      const mutexDirs = fs.readdirSync(this.lockDir).filter(f => f.endsWith('.mutex.d'));
      for (const dir of mutexDirs) {
        const dirPath = path.join(this.lockDir, dir);
        try {
          const stat = fs.statSync(dirPath);
          if (Date.now() - stat.mtimeMs > MUTEX_EXPIRY_MS) {
            fs.rmdirSync(dirPath);
            log.debug({ mutex: dir }, 'Stale mutex directory cleaned');
          }
        } catch {
          // Already removed — fine
        }
      }

      return ok({ swept });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log.error({ err: msg }, 'Failed to sweep expired locks');
      return err('SWEEP_FAILED', `Failed to sweep expired locks: ${msg}`, { retryable: true });
    }
  }

  // ── Internal: Lock Acquisition ──

  private async _tryAcquire(
    agentId: string,
    resource: string,
    ttl: number,
    metadata?: Record<string, unknown>,
  ): Promise<Result<LockHandle>> {
    return this._withMutex(resource, () => {
      const lockFile = this._lockFilePath(resource);
      const existing = this._readLockFile(lockFile);

      if (existing) {
        // Same agent re-acquiring — just refresh
        if (existing.agentId === agentId) {
          const now = Date.now();
          const updated: LockState = { ...existing, refreshedAt: now, ttl };
          this._writeLockFile(lockFile, updated);
          log.debug({ agentId, resource }, 'Lock re-acquired (same agent)');
          return ok(makeLockHandle(resource, agentId, existing.acquiredAt, now, ttl));
        }

        // Different agent — check expiry (with grace period)
        if (!this._isExpired(existing)) {
          return err('LOCK_BUSY', `Resource ${resource} is locked by ${existing.agentId}`, {
            retryable: true,
            context: {
              resource,
              holder: existing.agentId,
              requester: agentId,
              expiresIn: (existing.refreshedAt + existing.ttl) - Date.now(),
            },
          });
        }

        // Expired — take over
        log.info({
          agentId, resource,
          previousHolder: existing.agentId,
        }, 'Expired lock overridden');
      }

      // Check lock count limit (DoS protection)
      try {
        const lockCount = fs.readdirSync(this.lockDir).filter(f => f.endsWith('.lock.json')).length;
        if (lockCount >= MAX_LOCK_COUNT) {
          return err('LOCK_LIMIT', `Maximum lock count (${MAX_LOCK_COUNT}) exceeded`, {
            retryable: false,
            context: { resource, agentId, currentCount: lockCount },
          });
        }
      } catch {
        // If we can't count, proceed anyway — don't block on a guard check
      }

      // Acquire fresh lock
      const now = Date.now();
      const state: LockState = {
        resource,
        agentId,
        acquiredAt: now,
        refreshedAt: now,
        ttl,
        metadata,
      };
      this._writeLockFile(lockFile, state);
      log.info({ agentId, resource, ttl }, 'Lock acquired');

      return ok(makeLockHandle(resource, agentId, now, now, ttl));
    });
  }

  // ── Internal: Filesystem Mutex (Level 1) ──

  /**
   * Atomic mkdir-based mutex. Protects lock file reads/writes from torn state.
   * Short-lived: held only during the callback, auto-expires after MUTEX_EXPIRY_MS.
   * Uses async polling (setTimeout) instead of busy-wait to avoid blocking the event loop.
   */
  private async _withMutex<T>(resource: string, fn: () => T): Promise<T> {
    const mutexPath = this._mutexPath(resource);
    const acquired = await this._acquireMutex(mutexPath);

    if (!acquired) {
      // Return error result instead of throwing — callers expect Result types
      log.error({ resource }, 'Failed to acquire mutex');
      // We need to throw here because fn() returns T not Result<T> in all cases
      // The callers (_tryAcquire, release, refresh, isLocked) all catch this
      throw new Error(`Failed to acquire mutex for resource: ${resource}`);
    }

    try {
      return fn();
    } finally {
      this._releaseMutex(mutexPath);
    }
  }

  private async _acquireMutex(mutexPath: string): Promise<boolean> {
    const deadline = Date.now() + MUTEX_EXPIRY_MS;

    while (Date.now() < deadline) {
      try {
        fs.mkdirSync(mutexPath, { recursive: false });
        return true; // mkdir succeeded — mutex acquired
      } catch (e: unknown) {
        const code = (e as NodeJS.ErrnoException).code;
        if (code === 'EEXIST') {
          // Mutex held by another process — check if stale
          try {
            const stat = fs.statSync(mutexPath);
            if (Date.now() - stat.mtimeMs > MUTEX_EXPIRY_MS) {
              // Stale mutex — force remove and retry
              try { fs.rmdirSync(mutexPath); } catch { /* race ok */ }
              continue;
            }
          } catch {
            // stat failed — dir was removed between our mkdir and stat
            continue;
          }

          // Not stale — yield to event loop then retry (non-blocking)
          await this._sleep(MUTEX_POLL_MS);
          continue;
        }
        // Unexpected error — don't spin, just fail
        log.error({ mutexPath, code }, 'Unexpected error acquiring mutex');
        return false;
      }
    }

    return false; // Timed out
  }

  private _releaseMutex(mutexPath: string): void {
    try {
      fs.rmdirSync(mutexPath);
    } catch {
      // Already removed — fine
    }
  }

  // ── Internal: Lock File Operations (Level 2) ──

  private _readLockFile(filePath: string): LockState | null {
    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const parsed = JSON.parse(raw) as Record<string, unknown>;

      // Type-safe validation
      if (
        typeof parsed.resource !== 'string' || !parsed.resource ||
        typeof parsed.agentId !== 'string' || !parsed.agentId ||
        typeof parsed.acquiredAt !== 'number' || !Number.isFinite(parsed.acquiredAt) ||
        typeof parsed.refreshedAt !== 'number' || !Number.isFinite(parsed.refreshedAt) ||
        typeof parsed.ttl !== 'number' || !Number.isFinite(parsed.ttl) || parsed.ttl <= 0
      ) {
        log.warn({ filePath }, 'Invalid lock file — removing');
        this._deleteLockFile(filePath);
        return null;
      }

      return {
        resource: parsed.resource,
        agentId: parsed.agentId,
        acquiredAt: parsed.acquiredAt,
        refreshedAt: parsed.refreshedAt,
        ttl: parsed.ttl,
        metadata: (typeof parsed.metadata === 'object' && parsed.metadata !== null)
          ? parsed.metadata as Record<string, unknown>
          : undefined,
      };
    } catch (e: unknown) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') return null; // File doesn't exist — not locked
      log.warn({ filePath, err: (e as Error).message }, 'Failed to read lock file');
      return null;
    }
  }

  /**
   * Atomic write: write to temp file, then rename.
   * rename() is atomic on POSIX when source and destination are on the same filesystem.
   */
  private _writeLockFile(filePath: string, state: LockState): void {
    const tmpPath = `${filePath}.${process.pid}.tmp`;
    try {
      fs.writeFileSync(tmpPath, JSON.stringify(state, null, 2), 'utf-8');
      fs.renameSync(tmpPath, filePath);
    } catch (e) {
      // Clean up temp file on failure
      try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
      throw e;
    }
  }

  private _deleteLockFile(filePath: string): void {
    try {
      fs.unlinkSync(filePath);
    } catch {
      // Already removed — fine
    }
  }

  // ── Internal: Helpers ──

  private _isExpired(state: LockState): boolean {
    return Date.now() > state.refreshedAt + state.ttl + GRACE_PERIOD_MS;
  }

  private _defaultTtl(resource: string): number {
    // Match resource prefix (e.g., "file:src/foo.ts" -> "file")
    const prefix = resource.split(':')[0];
    return DEFAULT_TTLS[prefix] ?? DEFAULT_TTL;
  }

  /**
   * Produce a filesystem-safe name from a resource identifier.
   * Always includes a short hash to prevent collisions from sanitization
   * (e.g., "file:a/b" and "file:a_b" both sanitize to "file_a_b").
   */
  private _safeName(resource: string): string {
    const hash = crypto.createHash('sha256').update(resource).digest('hex').slice(0, 12);
    const safe = resource.replace(/[^a-zA-Z0-9._-]/g, '_');
    // Keep prefix readable, append hash for uniqueness
    const prefix = safe.slice(0, 80);
    return `${prefix}_${hash}`;
  }

  private _lockFilePath(resource: string): string {
    return path.join(this.lockDir, `${this._safeName(resource)}.lock.json`);
  }

  private _mutexPath(resource: string): string {
    return path.join(this.lockDir, `${this._safeName(resource)}.mutex.d`);
  }

  private _ensureLockDir(): void {
    if (!fs.existsSync(this.lockDir)) {
      fs.mkdirSync(this.lockDir, { recursive: true });
    }
  }

  private _sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ── Public: withLockRefresh ──

  /**
   * Execute an async function while automatically refreshing a held lock.
   * Refreshes the lock at ~half the TTL interval to keep it alive during
   * long-running operations. The refresh loop stops when the function
   * completes (or throws).
   *
   * **Important:** If the lock is lost during execution (e.g., force-released
   * by another agent or filesystem error), `fn()` continues running but will
   * no longer be protected by the lock. The refresh failure is logged as a
   * warning. If `fn()` needs to know the lock is still held, it should
   * periodically check `handle.isExpired()`.
   *
   * **Side effect:** `handle.refreshedAt` is mutated on each successful
   * refresh, keeping `isExpired()` and `timeRemaining()` accurate.
   *
   * Usage:
   *   const handle = (await mgr.acquire(agentId, resource)).data;
   *   const result = await mgr.withLockRefresh(handle, async () => {
   *     // ... long-running tool work ...
   *   });
   */
  async withLockRefresh<T>(handle: LockHandle, fn: () => Promise<T>): Promise<T> {
    const refreshInterval = Math.max(handle.ttl / 2, 1_000); // At least 1s
    let stopped = false;

    const refreshLoop = async (): Promise<void> => {
      while (!stopped) {
        await this._sleep(refreshInterval);
        if (stopped) break;
        try {
          const result = await this.refresh(handle.agentId, handle.resource);
          if (result.ok) {
            // Update the handle's refreshedAt so isExpired/timeRemaining stay accurate
            handle.refreshedAt = result.data.refreshedAt;
          } else {
            log.warn({
              agentId: handle.agentId,
              resource: handle.resource,
              error: result.error.code,
            }, 'Lock refresh failed during withLockRefresh');
            break; // Stop refreshing if we lost the lock
          }
        } catch (e) {
          log.warn({ err: e instanceof Error ? e.message : String(e) }, 'Lock refresh error');
          break;
        }
      }
    };

    // Start refresh loop in background (fire-and-forget, errors already logged inside)
    const refreshPromise = refreshLoop().catch(() => { /* logged inside refreshLoop */ });

    try {
      return await fn();
    } finally {
      stopped = true;
      // Wait for the refresh loop to notice the stop flag (at most one interval)
      await Promise.race([refreshPromise, this._sleep(100)]);
    }
  }
}

// ── Singleton (lazy init with configurable path) ──

let _instance: ResourceLockManager | null = null;

/**
 * Get or create the singleton ResourceLockManager.
 * The lockDir parameter is only used on first initialization.
 * Subsequent calls return the existing instance regardless of lockDir.
 */
export function getResourceLockManager(lockDir?: string): ResourceLockManager {
  if (!_instance) {
    _instance = new ResourceLockManager(lockDir);
  }
  return _instance;
}

/** Reset singleton (for testing). Stops sweep timer if running. */
export function _resetResourceLockManager(): void {
  if (_instance) {
    _instance.stopSweepTimer();
  }
  _instance = null;
}
