/**
 * Tool Middleware Tests (#941, #942)
 *
 * Tests: MiddlewareChain composition, ResourceLockMiddleware locking behavior,
 * short-circuit on no resources, lock failure handling, deadlock prevention,
 * lock release on tool error, room opt-out, concurrency modes (concurrent,
 * serialized, exclusive).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MiddlewareChain, ResourceLockMiddleware, EXCLUSIVE_LOCK_KEY } from '../../../src/tools/tool-middleware.js';
import type { ToolDefinition, ToolContext, ToolResourceDescriptor } from '../../../src/core/contracts.js';
import { ok, err } from '../../../src/core/contracts.js';

// ── Mock resource-lock module ──

const mockAcquire = vi.fn();
const mockRelease = vi.fn();
const mockWithLockRefresh = vi.fn();

vi.mock('../../../src/core/resource-lock.js', () => ({
  getResourceLockManager: () => ({
    acquire: mockAcquire,
    release: mockRelease,
    withLockRefresh: mockWithLockRefresh,
  }),
}));

// ── Helpers ──

function makeTool(overrides: Partial<ToolDefinition> = {}): ToolDefinition {
  return {
    name: 'test_tool',
    description: 'A test tool',
    category: 'test',
    inputSchema: {},
    execute: async () => ({ done: true }),
    ...overrides,
  };
}

function makeContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    roomId: 'room-1',
    roomType: 'code-lab',
    agentId: 'agent-1',
    fileScope: 'full',
    buildingId: 'building-1',
    ...overrides,
  };
}

function makeLockHandle(resource: string, agentId = 'agent-1') {
  return {
    resource,
    agentId,
    acquiredAt: Date.now(),
    refreshedAt: Date.now(),
    ttl: 30_000,
    isExpired: () => false,
    timeRemaining: () => 30_000,
  };
}

describe('MiddlewareChain', () => {
  it('executes final function when no middlewares registered', async () => {
    const chain = new MiddlewareChain();
    const result = await chain.execute(
      makeTool(),
      {},
      makeContext(),
      async () => ok({ value: 'final' }),
    );
    expect(result.ok).toBe(true);
    expect(result.data).toEqual({ value: 'final' });
  });

  it('reports correct size', () => {
    const chain = new MiddlewareChain();
    expect(chain.size).toBe(0);
    chain.add({ name: 'test', execute: async (_t, _p, _c, next) => next() });
    expect(chain.size).toBe(1);
  });

  it('composes middlewares in onion order (first added = outermost)', async () => {
    const chain = new MiddlewareChain();
    const order: string[] = [];

    chain.add({
      name: 'outer',
      execute: async (_t, _p, _c, next) => {
        order.push('outer-before');
        const r = await next();
        order.push('outer-after');
        return r;
      },
    });

    chain.add({
      name: 'inner',
      execute: async (_t, _p, _c, next) => {
        order.push('inner-before');
        const r = await next();
        order.push('inner-after');
        return r;
      },
    });

    await chain.execute(
      makeTool(),
      {},
      makeContext(),
      async () => {
        order.push('final');
        return ok({ done: true });
      },
    );

    expect(order).toEqual([
      'outer-before',
      'inner-before',
      'final',
      'inner-after',
      'outer-after',
    ]);
  });

  it('allows middleware to short-circuit (not calling next)', async () => {
    const chain = new MiddlewareChain();
    const finalFn = vi.fn(async () => ok({ done: true }));

    chain.add({
      name: 'blocker',
      execute: async () => err('BLOCKED', 'Blocked by middleware'),
    });

    const result = await chain.execute(makeTool(), {}, makeContext(), finalFn);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('BLOCKED');
    }
    expect(finalFn).not.toHaveBeenCalled();
  });
});

describe('ResourceLockMiddleware', () => {
  let middleware: ResourceLockMiddleware;
  let nextFn: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    middleware = new ResourceLockMiddleware();
    nextFn = vi.fn(async () => ok({ result: 'success' }));
    mockAcquire.mockReset();
    mockRelease.mockReset().mockResolvedValue(ok(undefined));
    mockWithLockRefresh.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('has name "resource-lock"', () => {
    expect(middleware.name).toBe('resource-lock');
  });

  // ── Zero overhead path ──

  it('passes through directly when tool has no resources', async () => {
    const tool = makeTool({ resources: undefined });
    const result = await middleware.execute(tool, {}, makeContext(), nextFn);

    expect(result.ok).toBe(true);
    expect(nextFn).toHaveBeenCalledOnce();
    expect(mockAcquire).not.toHaveBeenCalled();
    expect(mockRelease).not.toHaveBeenCalled();
  });

  it('passes through directly when tool has empty resources array', async () => {
    const tool = makeTool({ resources: [] });
    const result = await middleware.execute(tool, {}, makeContext(), nextFn);

    expect(result.ok).toBe(true);
    expect(nextFn).toHaveBeenCalledOnce();
    expect(mockAcquire).not.toHaveBeenCalled();
  });

  // ── Static resource locking ──

  it('acquires and releases lock for static resource', async () => {
    const resources: ToolResourceDescriptor[] = [{ type: 'git', mode: 'static' }];
    const tool = makeTool({ name: 'git_workflow', resources });
    const context = makeContext({ buildingId: 'bld-42' });
    const handle = makeLockHandle('git:bld-42');

    mockAcquire.mockResolvedValue(ok(handle));
    mockWithLockRefresh.mockImplementation(async (_h: unknown, fn: () => Promise<unknown>) => fn());

    const result = await middleware.execute(tool, {}, context, nextFn);

    expect(result.ok).toBe(true);
    expect(mockAcquire).toHaveBeenCalledOnce();
    expect(mockAcquire).toHaveBeenCalledWith('agent-1', 'git:bld-42', expect.objectContaining({
      metadata: expect.objectContaining({ toolName: 'git_workflow', roomId: 'room-1' }),
    }));
    expect(mockRelease).toHaveBeenCalledWith('agent-1', 'git:bld-42');
    expect(nextFn).toHaveBeenCalledOnce();
  });

  // ── Param-based resource locking ──

  it('derives resource key from tool params (file:param mode)', async () => {
    const resources: ToolResourceDescriptor[] = [{ type: 'file', mode: 'param', paramKey: 'path' }];
    const tool = makeTool({ name: 'write_file', resources });
    const params = { path: 'src/foo.ts', content: 'hello' };
    const handle = makeLockHandle('file:src/foo.ts');

    mockAcquire.mockResolvedValue(ok(handle));
    mockWithLockRefresh.mockImplementation(async (_h: unknown, fn: () => Promise<unknown>) => fn());

    const result = await middleware.execute(tool, params, makeContext(), nextFn);

    expect(result.ok).toBe(true);
    expect(mockAcquire).toHaveBeenCalledWith('agent-1', 'file:src/foo.ts', expect.any(Object));
  });

  it('falls back to static scope when param is missing', async () => {
    const resources: ToolResourceDescriptor[] = [{ type: 'file', mode: 'param', paramKey: 'path' }];
    const tool = makeTool({ name: 'write_file', resources });
    const context = makeContext({ buildingId: 'bld-99' });

    const handle = makeLockHandle('file:bld-99');
    mockAcquire.mockResolvedValue(ok(handle));
    mockWithLockRefresh.mockImplementation(async (_h: unknown, fn: () => Promise<unknown>) => fn());

    // params has no 'path' key
    await middleware.execute(tool, { content: 'hello' }, context, nextFn);

    expect(mockAcquire).toHaveBeenCalledWith('agent-1', 'file:bld-99', expect.any(Object));
  });

  it('falls back to roomId when buildingId is not available', async () => {
    const resources: ToolResourceDescriptor[] = [{ type: 'shell', mode: 'static' }];
    const tool = makeTool({ name: 'bash', resources });
    const context = makeContext({ buildingId: undefined });
    const handle = makeLockHandle('shell:room-1');

    mockAcquire.mockResolvedValue(ok(handle));
    mockWithLockRefresh.mockImplementation(async (_h: unknown, fn: () => Promise<unknown>) => fn());

    await middleware.execute(tool, {}, context, nextFn);

    expect(mockAcquire).toHaveBeenCalledWith('agent-1', 'shell:room-1', expect.any(Object));
  });

  // ── Single lock uses withLockRefresh ──

  it('uses withLockRefresh for single-lock tools', async () => {
    const resources: ToolResourceDescriptor[] = [{ type: 'git', mode: 'static' }];
    const tool = makeTool({ name: 'git_workflow', resources });
    const handle = makeLockHandle('git:building-1');

    mockAcquire.mockResolvedValue(ok(handle));
    mockWithLockRefresh.mockImplementation(async (_h: unknown, fn: () => Promise<unknown>) => fn());

    await middleware.execute(tool, {}, makeContext(), nextFn);

    expect(mockWithLockRefresh).toHaveBeenCalledOnce();
    expect(mockWithLockRefresh).toHaveBeenCalledWith(handle, expect.any(Function));
  });

  // ── Multiple locks — sorted acquisition ──

  it('acquires multiple locks in sorted order (deadlock prevention)', async () => {
    const resources: ToolResourceDescriptor[] = [
      { type: 'git', mode: 'static' },
      { type: 'file', mode: 'param', paramKey: 'path' },
    ];
    const tool = makeTool({ name: 'complex_tool', resources });
    const params = { path: 'src/bar.ts' };
    const context = makeContext({ buildingId: 'bld-1' });

    const acquireOrder: string[] = [];
    mockAcquire.mockImplementation(async (_agent: string, resource: string) => {
      acquireOrder.push(resource);
      return ok(makeLockHandle(resource));
    });

    await middleware.execute(tool, params, context, nextFn);

    // 'file:src/bar.ts' < 'git:bld-1' alphabetically
    expect(acquireOrder).toEqual(['file:src/bar.ts', 'git:bld-1']);
    expect(nextFn).toHaveBeenCalledOnce();
  });

  it('does not use withLockRefresh for multiple locks (TTL suffices)', async () => {
    const resources: ToolResourceDescriptor[] = [
      { type: 'git', mode: 'static' },
      { type: 'shell', mode: 'static' },
    ];
    const tool = makeTool({ name: 'multi_tool', resources });

    mockAcquire.mockImplementation(async (_a: string, r: string) => ok(makeLockHandle(r)));

    await middleware.execute(tool, {}, makeContext(), nextFn);

    expect(mockWithLockRefresh).not.toHaveBeenCalled();
    expect(nextFn).toHaveBeenCalledOnce();
  });

  // ── Lock failure ──

  it('returns RESOURCE_LOCKED error when lock acquisition fails', async () => {
    const resources: ToolResourceDescriptor[] = [{ type: 'browser', mode: 'static' }];
    const tool = makeTool({ name: 'browser_tools', resources });

    mockAcquire.mockResolvedValue(err('LOCK_TIMEOUT', 'Lock acquisition timed out'));

    const result = await middleware.execute(tool, {}, makeContext(), nextFn);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('RESOURCE_LOCKED');
      expect(result.error.message).toContain('browser_tools');
      expect(result.error.retryable).toBe(true);
    }
    expect(nextFn).not.toHaveBeenCalled();
  });

  it('releases already-acquired locks when subsequent lock fails', async () => {
    const resources: ToolResourceDescriptor[] = [
      { type: 'file', mode: 'param', paramKey: 'path' },
      { type: 'git', mode: 'static' },
    ];
    const tool = makeTool({ name: 'multi_fail_tool', resources });
    const params = { path: 'src/test.ts' };
    const context = makeContext({ buildingId: 'bld-1' });

    let callCount = 0;
    mockAcquire.mockImplementation(async (_a: string, resource: string) => {
      callCount++;
      if (callCount === 1) {
        // First lock succeeds
        return ok(makeLockHandle(resource));
      }
      // Second lock fails
      return err('LOCK_TIMEOUT', 'Timed out');
    });
    mockRelease.mockResolvedValue(ok(undefined));

    const result = await middleware.execute(tool, params, context, nextFn);

    expect(result.ok).toBe(false);
    // First lock should have been released on rollback
    expect(mockRelease).toHaveBeenCalled();
    expect(nextFn).not.toHaveBeenCalled();
  });

  // ── Lock release on tool error ──

  it('releases locks even when tool execution throws', async () => {
    const resources: ToolResourceDescriptor[] = [{ type: 'shell', mode: 'static' }];
    const tool = makeTool({ name: 'bash', resources });
    const handle = makeLockHandle('shell:building-1');

    mockAcquire.mockResolvedValue(ok(handle));
    mockWithLockRefresh.mockImplementation(async (_h: unknown, fn: () => Promise<unknown>) => fn());
    mockRelease.mockResolvedValue(ok(undefined));

    const throwingNext = vi.fn(async () => {
      throw new Error('Command failed');
    });

    await expect(middleware.execute(tool, {}, makeContext(), throwingNext)).rejects.toThrow('Command failed');

    // Lock should still be released in finally block
    expect(mockRelease).toHaveBeenCalledWith('agent-1', 'shell:building-1');
  });

  // ── Lock options passthrough ──

  it('passes lockOptions from descriptor to acquire call', async () => {
    const resources: ToolResourceDescriptor[] = [{
      type: 'build',
      mode: 'static',
      lockOptions: { ttl: 120_000, maxWait: 60_000 },
    }];
    const tool = makeTool({ name: 'game_engine', resources });
    const handle = makeLockHandle('build:building-1');

    mockAcquire.mockResolvedValue(ok(handle));
    mockWithLockRefresh.mockImplementation(async (_h: unknown, fn: () => Promise<unknown>) => fn());

    await middleware.execute(tool, {}, makeContext(), nextFn);

    expect(mockAcquire).toHaveBeenCalledWith('agent-1', 'build:building-1', expect.objectContaining({
      ttl: 120_000,
      maxWait: 60_000,
    }));
  });

  it('uses default maxWait (30_000) when lockOptions not provided', async () => {
    const resources: ToolResourceDescriptor[] = [{ type: 'git', mode: 'static' }];
    const tool = makeTool({ name: 'git_workflow', resources });
    const handle = makeLockHandle('git:building-1');

    mockAcquire.mockResolvedValue(ok(handle));
    mockWithLockRefresh.mockImplementation(async (_h: unknown, fn: () => Promise<unknown>) => fn());

    await middleware.execute(tool, {}, makeContext(), nextFn);

    expect(mockAcquire).toHaveBeenCalledWith('agent-1', 'git:building-1', expect.objectContaining({
      maxWait: 30_000,
    }));
  });

  // ── Deduplication ──

  it('deduplicates identical resource keys', async () => {
    // Two descriptors that resolve to the same key
    const resources: ToolResourceDescriptor[] = [
      { type: 'file', mode: 'param', paramKey: 'path' },
      { type: 'file', mode: 'param', paramKey: 'path' },
    ];
    const tool = makeTool({ name: 'dup_tool', resources });
    const params = { path: 'same/file.ts' };

    mockAcquire.mockImplementation(async (_a: string, r: string) => ok(makeLockHandle(r)));
    mockWithLockRefresh.mockImplementation(async (_h: unknown, fn: () => Promise<unknown>) => fn());

    await middleware.execute(tool, params, makeContext(), nextFn);

    // Should only acquire once due to Set dedup
    expect(mockAcquire).toHaveBeenCalledTimes(1);
  });

  // ── Concurrency modes (#942) ──

  it('passes through for tools with concurrencyMode "concurrent"', async () => {
    const tool = makeTool({
      name: 'read_file',
      concurrencyMode: 'concurrent',
      resources: undefined,
    });

    const result = await middleware.execute(tool, {}, makeContext(), nextFn);

    expect(result.ok).toBe(true);
    expect(nextFn).toHaveBeenCalledOnce();
    expect(mockAcquire).not.toHaveBeenCalled();
  });

  it('passes through for concurrent mode even if resources are somehow set', async () => {
    // Edge case: tool marked concurrent but has resources — concurrency mode takes precedence
    const tool = makeTool({
      name: 'weird_tool',
      concurrencyMode: 'concurrent',
      resources: [{ type: 'file', mode: 'static' }],
    });

    const result = await middleware.execute(tool, {}, makeContext(), nextFn);

    expect(result.ok).toBe(true);
    expect(mockAcquire).not.toHaveBeenCalled();
  });

  it('acquires global exclusive lock for exclusive mode tools', async () => {
    const resources: ToolResourceDescriptor[] = [{ type: 'browser', mode: 'static' }];
    const tool = makeTool({
      name: 'browser_tools',
      concurrencyMode: 'exclusive',
      resources,
    });
    const context = makeContext({ buildingId: 'bld-1' });

    const acquiredKeys: string[] = [];
    mockAcquire.mockImplementation(async (_a: string, resource: string) => {
      acquiredKeys.push(resource);
      return ok(makeLockHandle(resource));
    });

    await middleware.execute(tool, {}, context, nextFn);

    // Should acquire both the resource lock AND the global exclusive lock
    expect(acquiredKeys).toContain(EXCLUSIVE_LOCK_KEY);
    expect(acquiredKeys).toContain('browser:bld-1');
    expect(nextFn).toHaveBeenCalledOnce();
  });

  it('acquires exclusive lock even when tool has no resource descriptors', async () => {
    const tool = makeTool({
      name: 'exclusive_no_resources',
      concurrencyMode: 'exclusive',
      resources: undefined,
    });

    mockAcquire.mockImplementation(async (_a: string, r: string) => ok(makeLockHandle(r)));
    mockWithLockRefresh.mockImplementation(async (_h: unknown, fn: () => Promise<unknown>) => fn());

    await middleware.execute(tool, {}, makeContext(), nextFn);

    // Should acquire just the exclusive lock
    expect(mockAcquire).toHaveBeenCalledTimes(1);
    expect(mockAcquire).toHaveBeenCalledWith('agent-1', EXCLUSIVE_LOCK_KEY, expect.any(Object));
  });

  it('includes concurrencyMode in lock metadata for exclusive tools', async () => {
    const resources: ToolResourceDescriptor[] = [{ type: 'browser', mode: 'static' }];
    const tool = makeTool({
      name: 'browser_tools',
      concurrencyMode: 'exclusive',
      resources,
    });

    mockAcquire.mockImplementation(async (_a: string, r: string) => ok(makeLockHandle(r)));

    await middleware.execute(tool, {}, makeContext(), nextFn);

    // Verify metadata includes concurrencyMode
    expect(mockAcquire).toHaveBeenCalledWith(
      'agent-1',
      expect.any(String),
      expect.objectContaining({
        metadata: expect.objectContaining({ concurrencyMode: 'exclusive' }),
      }),
    );
  });

  it('infers serialized mode for tools with resources but no explicit mode', async () => {
    const resources: ToolResourceDescriptor[] = [{ type: 'git', mode: 'static' }];
    const tool = makeTool({
      name: 'git_workflow',
      concurrencyMode: undefined, // not set
      resources,
    });
    const handle = makeLockHandle('git:building-1');

    mockAcquire.mockResolvedValue(ok(handle));
    mockWithLockRefresh.mockImplementation(async (_h: unknown, fn: () => Promise<unknown>) => fn());

    const result = await middleware.execute(tool, {}, makeContext(), nextFn);

    expect(result.ok).toBe(true);
    expect(mockAcquire).toHaveBeenCalledOnce();
    expect(nextFn).toHaveBeenCalledOnce();
  });

  it('infers concurrent mode for tools without resources and no explicit mode', async () => {
    const tool = makeTool({
      name: 'read_file',
      concurrencyMode: undefined,
      resources: undefined,
    });

    const result = await middleware.execute(tool, {}, makeContext(), nextFn);

    expect(result.ok).toBe(true);
    expect(nextFn).toHaveBeenCalledOnce();
    expect(mockAcquire).not.toHaveBeenCalled();
  });
});

describe('ResourceLockMiddleware integration with MiddlewareChain', () => {
  beforeEach(() => {
    mockAcquire.mockReset();
    mockRelease.mockReset().mockResolvedValue(ok(undefined));
    mockWithLockRefresh.mockReset();
  });

  it('works correctly when composed in a chain', async () => {
    const chain = new MiddlewareChain();
    chain.add(new ResourceLockMiddleware());

    const resources: ToolResourceDescriptor[] = [{ type: 'git', mode: 'static' }];
    const tool = makeTool({ name: 'git_workflow', resources });
    const handle = makeLockHandle('git:building-1');

    mockAcquire.mockResolvedValue(ok(handle));
    mockWithLockRefresh.mockImplementation(async (_h: unknown, fn: () => Promise<unknown>) => fn());
    mockRelease.mockResolvedValue(ok(undefined));

    const result = await chain.execute(
      tool,
      {},
      makeContext(),
      async () => ok({ committed: true }),
    );

    expect(result.ok).toBe(true);
    expect(mockAcquire).toHaveBeenCalledOnce();
    expect(mockRelease).toHaveBeenCalledOnce();
  });

  it('chains with other middlewares correctly', async () => {
    const chain = new MiddlewareChain();
    const order: string[] = [];

    // Add a logging middleware before the lock middleware
    chain.add({
      name: 'logger',
      execute: async (_t, _p, _c, next) => {
        order.push('log-before');
        const r = await next();
        order.push('log-after');
        return r;
      },
    });

    chain.add(new ResourceLockMiddleware());

    const tool = makeTool({ name: 'read_only', resources: undefined });

    const result = await chain.execute(
      tool,
      {},
      makeContext(),
      async () => {
        order.push('execute');
        return ok({ done: true });
      },
    );

    expect(result.ok).toBe(true);
    expect(order).toEqual(['log-before', 'execute', 'log-after']);
  });
});
