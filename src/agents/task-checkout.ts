/**
 * Atomic Task Checkout (#682)
 *
 * Prevents double-work by locking todos when an agent checks them out.
 * Uses SQLite transactions for atomicity — only one agent can hold a
 * todo at a time. Locks expire after a configurable TTL.
 *
 * Flow:
 *   1. Agent requests checkout → atomic check + lock in a transaction
 *   2. Other agents see lock status and who holds it
 *   3. Agent completes work → releases lock (or lock auto-expires)
 *   4. Lock history stored in agent_activity_log for audit
 *
 * Layer: Agents (depends on Storage, Core)
 */

import { logger } from '../core/logger.js';
import { ok, err } from '../core/contracts.js';
import type { Result } from '../core/contracts.js';
import { getDb } from '../storage/db.js';

const log = logger.child({ module: 'task-checkout' });

/** Default lock TTL: 30 minutes */
const DEFAULT_LOCK_TTL_MS = 30 * 60 * 1000;

// ── Checkout Operations ──

/**
 * Atomically check out a todo for an agent.
 * Fails if already locked by another agent (unless expired).
 */
export function checkoutTodo(todoId: string, agentId: string, ttlMs?: number): Result {
  const db = getDb();
  const effectiveTtl = ttlMs || DEFAULT_LOCK_TTL_MS;
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + effectiveTtl).toISOString();

  // Use a transaction for atomicity
  const txn = db.transaction(() => {
    const todo = db.prepare('SELECT id, locked_by, lock_expires_at, status FROM todos WHERE id = ?')
      .get(todoId) as { id: string; locked_by: string | null; lock_expires_at: string | null; status: string } | undefined;

    if (!todo) {
      return err('NOT_FOUND', 'Todo not found', { retryable: false });
    }

    if (todo.status === 'done') {
      return err('ALREADY_DONE', 'Todo is already completed', { retryable: false });
    }

    // Check existing lock
    if (todo.locked_by && todo.locked_by !== agentId) {
      // Is the lock expired?
      // Handle both ISO (2026-03-17T01:39:00.000Z) and SQLite (2026-03-17 01:39:00) formats
      const expiresMs = todo.lock_expires_at ? new Date(todo.lock_expires_at.replace(' ', 'T') + (todo.lock_expires_at.includes('Z') ? '' : 'Z')).getTime() : 0;
      if (expiresMs > Date.now()) {
        return err('LOCKED', `Todo is checked out by another agent`, {
          retryable: true,
          context: { lockedBy: todo.locked_by, expiresAt: todo.lock_expires_at },
        });
      }
      // Lock expired — allow override
      log.info({ todoId, previousHolder: todo.locked_by, newHolder: agentId }, 'Expired lock overridden');
    }

    // Idempotent: if same agent already holds it, just extend
    if (todo.locked_by === agentId) {
      db.prepare('UPDATE todos SET lock_expires_at = ? WHERE id = ?').run(expiresAt, todoId);
      return ok({ todoId, agentId, checkedOutAt: now, expiresAt, extended: true });
    }

    // Acquire the lock
    db.prepare(`
      UPDATE todos SET locked_by = ?, checked_out_at = ?, lock_expires_at = ?, status = 'in-progress'
      WHERE id = ?
    `).run(agentId, now, expiresAt, todoId);

    // Log the checkout for audit
    const logId = `log_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    db.prepare(`
      INSERT INTO agent_activity_log (id, agent_id, event_type, event_data, created_at)
      VALUES (?, ?, 'todo:checked-out', ?, datetime('now'))
    `).run(logId, agentId, JSON.stringify({ todoId }));

    return ok({ todoId, agentId, checkedOutAt: now, expiresAt, extended: false });
  });

  try {
    return txn();
  } catch (e) {
    log.error({ todoId, agentId, err: e instanceof Error ? e.message : String(e) }, 'Checkout failed');
    return err('CHECKOUT_FAILED', 'Failed to checkout todo', { retryable: true });
  }
}

/**
 * Release a todo lock. Only the holder (or force) can release.
 */
export function releaseTodo(todoId: string, agentId: string, force?: boolean): Result {
  const db = getDb();

  const todo = db.prepare('SELECT locked_by, status FROM todos WHERE id = ?')
    .get(todoId) as { locked_by: string | null; status: string } | undefined;

  if (!todo) {
    return err('NOT_FOUND', 'Todo not found', { retryable: false });
  }

  if (!todo.locked_by) {
    return ok({ todoId, released: false, reason: 'not-locked' });
  }

  if (todo.locked_by !== agentId && !force) {
    return err('NOT_HOLDER', 'Only the lock holder can release', {
      retryable: false,
      context: { lockedBy: todo.locked_by },
    });
  }

  db.prepare(`
    UPDATE todos SET locked_by = NULL, checked_out_at = NULL, lock_expires_at = NULL
    WHERE id = ?
  `).run(todoId);

  // Log the release
  const logId = `log_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  db.prepare(`
    INSERT INTO agent_activity_log (id, agent_id, event_type, event_data, created_at)
    VALUES (?, ?, 'todo:released', ?, datetime('now'))
  `).run(logId, agentId, JSON.stringify({ todoId, force: !!force }));

  log.debug({ todoId, agentId, force }, 'Todo lock released');
  return ok({ todoId, released: true });
}

/**
 * Complete a todo and release the lock atomically.
 */
export function completeTodo(todoId: string, agentId: string): Result {
  const db = getDb();

  const todo = db.prepare('SELECT locked_by, status FROM todos WHERE id = ?')
    .get(todoId) as { locked_by: string | null; status: string } | undefined;

  if (!todo) {
    return err('NOT_FOUND', 'Todo not found', { retryable: false });
  }

  // Allow completion even without lock (backward compat)
  if (todo.locked_by && todo.locked_by !== agentId) {
    return err('NOT_HOLDER', 'Todo is locked by another agent', {
      retryable: false,
      context: { lockedBy: todo.locked_by },
    });
  }

  db.prepare(`
    UPDATE todos SET
      locked_by = NULL, checked_out_at = NULL, lock_expires_at = NULL,
      status = 'done', completed_at = datetime('now')
    WHERE id = ?
  `).run(todoId);

  return ok({ todoId, completed: true });
}

/**
 * Get lock status for a todo.
 */
export function getLockStatus(todoId: string): Result {
  const db = getDb();
  const todo = db.prepare(
    'SELECT id, locked_by, checked_out_at, lock_expires_at, status FROM todos WHERE id = ?',
  ).get(todoId) as {
    id: string; locked_by: string | null; checked_out_at: string | null;
    lock_expires_at: string | null; status: string;
  } | undefined;

  if (!todo) {
    return err('NOT_FOUND', 'Todo not found', { retryable: false });
  }

  const expMs = todo.lock_expires_at ? new Date(todo.lock_expires_at.replace(' ', 'T') + (todo.lock_expires_at.includes('Z') ? '' : 'Z')).getTime() : 0;
  const isExpired = todo.lock_expires_at ? expMs <= Date.now() : false;
  const isLocked = !!todo.locked_by && !isExpired;

  return ok({
    todoId: todo.id,
    isLocked,
    lockedBy: isLocked ? todo.locked_by : null,
    checkedOutAt: isLocked ? todo.checked_out_at : null,
    expiresAt: isLocked ? todo.lock_expires_at : null,
    isExpired: !!todo.locked_by && isExpired,
    status: todo.status,
  });
}

/**
 * Release all expired locks (garbage collection).
 * Call periodically or on demand.
 */
export function releaseExpiredLocks(): Result {
  const db = getDb();
  const now = new Date().toISOString();
  const result = db.prepare(`
    UPDATE todos SET locked_by = NULL, checked_out_at = NULL, lock_expires_at = NULL
    WHERE locked_by IS NOT NULL AND lock_expires_at < ?
  `).run(now);

  if (result.changes > 0) {
    log.info({ released: result.changes }, 'Released expired todo locks');
  }

  return ok({ released: result.changes });
}

/**
 * Get all checked-out todos for a building (for the UI dashboard).
 */
export function getCheckedOutTodos(buildingId: string): Result {
  const db = getDb();
  const now = new Date().toISOString();

  const rows = db.prepare(`
    SELECT t.id, t.description, t.locked_by, t.checked_out_at, t.lock_expires_at, t.status,
           a.name AS agent_name, a.display_name AS agent_display_name,
           tk.title AS task_title
    FROM todos t
    JOIN tasks tk ON t.task_id = tk.id
    LEFT JOIN agents a ON t.locked_by = a.id
    WHERE tk.building_id = ? AND t.locked_by IS NOT NULL
    ORDER BY t.checked_out_at DESC
  `).all(buildingId) as Array<{
    id: string; description: string; locked_by: string; checked_out_at: string;
    lock_expires_at: string; status: string; agent_name: string;
    agent_display_name: string | null; task_title: string;
  }>;

  return ok(rows.map(r => ({
    ...r,
    isExpired: new Date(r.lock_expires_at) <= new Date(now),
    agentName: r.agent_display_name || r.agent_name,
  })));
}
