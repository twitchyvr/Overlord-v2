/**
 * Atomic Task Checkout Tests (#682)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { initStorage, getDb } from '../../../src/storage/db.js';
import {
  checkoutTodo,
  releaseTodo,
  completeTodo,
  getLockStatus,
  getCheckedOutTodos,
  releaseExpiredLocks,
} from '../../../src/agents/task-checkout.js';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdirSync, existsSync, rmSync } from 'fs';
import type { Config } from '../../../src/core/config.js';

let testDir: string;

function createMockConfig(dbPath: string): Config {
  return {
    get: vi.fn((key: string) => {
      if (key === 'DB_PATH') return dbPath;
      return undefined;
    }),
    validate: vi.fn(),
    getAll: vi.fn(),
  } as unknown as Config;
}

function seed() {
  const db = getDb();
  db.prepare(`INSERT OR REPLACE INTO buildings (id, name) VALUES ('bld_1', 'Test')`).run();
  db.prepare(`INSERT OR REPLACE INTO agents (id, name, role, building_id) VALUES ('agent_a', 'Alice', 'dev', 'bld_1')`).run();
  db.prepare(`INSERT OR REPLACE INTO agents (id, name, role, building_id) VALUES ('agent_b', 'Bob', 'dev', 'bld_1')`).run();
  db.prepare(`INSERT OR REPLACE INTO tasks (id, building_id, title) VALUES ('task_1', 'bld_1', 'Test Task')`).run();
  db.prepare(`INSERT OR REPLACE INTO todos (id, task_id, description) VALUES ('todo_1', 'task_1', 'Do the thing')`).run();
  db.prepare(`INSERT OR REPLACE INTO todos (id, task_id, description) VALUES ('todo_2', 'task_1', 'Another thing')`).run();
}

describe('Task Checkout', () => {
  beforeEach(async () => {
    testDir = join(tmpdir(), `overlord-checkout-test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
    mkdirSync(testDir, { recursive: true });
    const cfg = createMockConfig(join(testDir, 'test.db'));
    await initStorage(cfg);
    seed();
  });

  afterEach(() => {
    if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
  });

  it('checks out a todo successfully', () => {
    const result = checkoutTodo('todo_1', 'agent_a');
    expect(result.ok).toBe(true);
    expect(result.data.todoId).toBe('todo_1');
    expect(result.data.agentId).toBe('agent_a');
    expect(result.data.extended).toBe(false);
  });

  it('rejects double checkout by different agent', () => {
    checkoutTodo('todo_1', 'agent_a');
    const result = checkoutTodo('todo_1', 'agent_b');
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('LOCKED');
  });

  it('allows same agent to extend checkout (idempotent)', () => {
    checkoutTodo('todo_1', 'agent_a');
    const result = checkoutTodo('todo_1', 'agent_a');
    expect(result.ok).toBe(true);
    expect(result.data.extended).toBe(true);
  });

  it('releases a lock', () => {
    checkoutTodo('todo_1', 'agent_a');
    const result = releaseTodo('todo_1', 'agent_a');
    expect(result.ok).toBe(true);
    expect(result.data.released).toBe(true);

    // Now agent_b can check it out
    const result2 = checkoutTodo('todo_1', 'agent_b');
    expect(result2.ok).toBe(true);
  });

  it('prevents non-holder from releasing', () => {
    checkoutTodo('todo_1', 'agent_a');
    const result = releaseTodo('todo_1', 'agent_b');
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('NOT_HOLDER');
  });

  it('allows force release', () => {
    checkoutTodo('todo_1', 'agent_a');
    const result = releaseTodo('todo_1', 'agent_b', true);
    expect(result.ok).toBe(true);
    expect(result.data.released).toBe(true);
  });

  it('completes a todo and releases lock', () => {
    checkoutTodo('todo_1', 'agent_a');
    const result = completeTodo('todo_1', 'agent_a');
    expect(result.ok).toBe(true);
    expect(result.data.completed).toBe(true);

    // Verify status is 'done' and lock cleared
    const status = getLockStatus('todo_1');
    expect(status.ok).toBe(true);
    expect(status.data.isLocked).toBe(false);
    expect(status.data.status).toBe('done');
  });

  it('rejects checkout of completed todo', () => {
    completeTodo('todo_1', 'agent_a');
    const result = checkoutTodo('todo_1', 'agent_b');
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('ALREADY_DONE');
  });

  it('getLockStatus shows lock info', () => {
    checkoutTodo('todo_1', 'agent_a');
    const result = getLockStatus('todo_1');
    expect(result.ok).toBe(true);
    expect(result.data.isLocked).toBe(true);
    expect(result.data.lockedBy).toBe('agent_a');
  });

  it('getLockStatus shows unlocked for free todo', () => {
    const result = getLockStatus('todo_1');
    expect(result.ok).toBe(true);
    expect(result.data.isLocked).toBe(false);
    expect(result.data.lockedBy).toBe(null);
  });

  it('overrides expired locks', () => {
    // Checkout with very short TTL
    checkoutTodo('todo_1', 'agent_a', 1); // 1ms TTL

    // Wait for expiry (synchronous — SQLite date comparison)
    const db = getDb();
    db.prepare("UPDATE todos SET lock_expires_at = datetime('now', '-1 minute') WHERE id = 'todo_1'").run();

    // agent_b should now be able to checkout
    const result = checkoutTodo('todo_1', 'agent_b');
    expect(result.ok).toBe(true);
    expect(result.data.agentId).toBe('agent_b');
  });

  it('releaseExpiredLocks cleans up', () => {
    checkoutTodo('todo_1', 'agent_a');
    checkoutTodo('todo_2', 'agent_b');

    // Expire both locks
    const db = getDb();
    db.prepare("UPDATE todos SET lock_expires_at = datetime('now', '-1 minute')").run();

    const result = releaseExpiredLocks();
    expect(result.ok).toBe(true);
    expect(result.data.released).toBe(2);
  });

  it('getCheckedOutTodos returns locked todos for building', () => {
    checkoutTodo('todo_1', 'agent_a');
    const result = getCheckedOutTodos('bld_1');
    expect(result.ok).toBe(true);
    expect(result.data.length).toBe(1);
    expect(result.data[0].id).toBe('todo_1');
    expect(result.data[0].agentName).toBe('Alice');
  });
});
