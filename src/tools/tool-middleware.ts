/**
 * Tool Middleware — Transparent Tool Interception (#941, #942)
 *
 * Provides a composable middleware chain for tool execution. The primary
 * middleware is ResourceLockMiddleware, which acquires/releases resource
 * locks around tool calls without any changes to tool implementations.
 *
 * Middleware Pattern:
 *   execute(tool, params, context, next) → Promise<Result>
 *   Call next() to proceed. Return early to short-circuit (e.g., lock failure).
 *
 * Concurrency modes (#942):
 *   - 'concurrent': No locking (read-only tools) — zero overhead passthrough
 *   - 'serialized': Per-resource locking (write tools) — sorted acquisition
 *   - 'exclusive': Global lock (destructive ops) — blocks all other tool execution
 *
 * Layer: Tools (imports from Core only)
 *
 * Attribution:
 *   Pattern inspired by @m13v's browser-lock PreToolUse/PostToolUse hooks.
 *   https://github.com/m13v/browser-lock
 *   Concurrency model inspired by mediar-ai/terminator Send+Sync trait bounds.
 */

import { logger } from '../core/logger.js';
import { err } from '../core/contracts.js';
import { getResourceLockManager } from '../core/resource-lock.js';
import type { Result, ToolDefinition, ToolContext, ToolResourceDescriptor } from '../core/contracts.js';
import type { LockHandle } from '../core/resource-lock.js';

const log = logger.child({ module: 'tool-middleware' });

/** Well-known resource key for the global exclusive lock (#942). */
export const EXCLUSIVE_LOCK_KEY = '__exclusive__';

// ── Middleware Interface ──

export interface ToolMiddleware {
  name: string;
  /**
   * Wraps tool execution. Call next() to proceed to the tool (or next middleware).
   * Return a Result directly to short-circuit.
   */
  execute(
    tool: ToolDefinition,
    params: Record<string, unknown>,
    context: ToolContext,
    next: () => Promise<Result>,
  ): Promise<Result>;
}

// ── Middleware Chain ──

/**
 * Composes multiple middlewares in an onion pattern.
 * Middlewares execute in order: first added = outermost wrapper.
 */
export class MiddlewareChain {
  private middlewares: ToolMiddleware[] = [];

  add(middleware: ToolMiddleware): void {
    this.middlewares.push(middleware);
  }

  async execute(
    tool: ToolDefinition,
    params: Record<string, unknown>,
    context: ToolContext,
    finalExecute: () => Promise<Result>,
  ): Promise<Result> {
    // Build chain from last to first (onion wrapping)
    let next = finalExecute;
    for (let i = this.middlewares.length - 1; i >= 0; i--) {
      const mw = this.middlewares[i];
      const currentNext = next;
      next = () => mw.execute(tool, params, context, currentNext);
    }
    return next();
  }

  /** Number of registered middlewares */
  get size(): number {
    return this.middlewares.length;
  }
}

// ── Resource Lock Middleware ──

/**
 * Transparently acquires/releases resource locks around tool execution.
 *
 * Flow:
 *   1. Check concurrencyMode — 'concurrent' tools pass through (zero overhead)
 *   2. For 'exclusive' tools, prepend the global exclusive lock key
 *   3. Resolve resource keys from descriptors + params
 *   4. Acquire locks in sorted order (deadlock prevention)
 *   5. Execute tool (with auto-refresh for single locks)
 *   6. Release locks in finally block (TTL is crash safety net)
 */
export class ResourceLockMiddleware implements ToolMiddleware {
  name = 'resource-lock';

  async execute(
    tool: ToolDefinition,
    params: Record<string, unknown>,
    context: ToolContext,
    next: () => Promise<Result>,
  ): Promise<Result> {
    // Determine effective concurrency mode (#942)
    const mode = tool.concurrencyMode ?? (
      (tool.resources && tool.resources.length > 0) ? 'serialized' : 'concurrent'
    );

    // Concurrent tools — no locking needed (zero overhead path)
    if (mode === 'concurrent') {
      return next();
    }

    // No resources and not exclusive — also pass through (defensive)
    if ((!tool.resources || tool.resources.length === 0) && mode !== 'exclusive') {
      return next();
    }

    const mgr = getResourceLockManager();
    const agentId = context.agentId;

    // ── Exclusive gate (#954) ──
    // Serialized tools must wait if an exclusive tool is running.
    // This ensures exclusive mode truly blocks ALL other tool execution.
    if (mode === 'serialized') {
      const gateResult = await this._waitForExclusiveGate(mgr, agentId, tool.name);
      if (!gateResult.ok) return gateResult;
    }

    // Resolve resource keys from descriptors + tool params
    const resourceKeys = tool.resources
      ? this._resolveResources(tool.resources, params, context)
      : [];

    // For exclusive mode, add the global exclusive lock (#942)
    // This prevents ANY other tool from executing while an exclusive tool runs.
    if (mode === 'exclusive') {
      resourceKeys.push(EXCLUSIVE_LOCK_KEY);
    }

    // Sort keys alphabetically to prevent deadlocks, deduplicate
    const sortedKeys = [...new Set(resourceKeys)].sort();

    // Derive lock TTL for the exclusive lock from tool's longest descriptor (#954)
    const maxDescriptorTtl = this._getMaxDescriptorTtl(tool);

    // Acquire all locks
    const handles: LockHandle[] = [];
    for (const key of sortedKeys) {
      // Find the descriptor for this key to get lockOptions
      const descriptor = tool.resources?.find(
        r => this._makeKey(r, params, context) === key,
      );

      // For EXCLUSIVE_LOCK_KEY, use the tool's longest TTL since no descriptor matches (#954)
      const ttl = key === EXCLUSIVE_LOCK_KEY ? maxDescriptorTtl : descriptor?.lockOptions?.ttl;
      const maxWait = key === EXCLUSIVE_LOCK_KEY ? 30_000 : (descriptor?.lockOptions?.maxWait ?? 30_000);

      const lockResult = await mgr.acquire(agentId, key, {
        ttl,
        maxWait,
        metadata: { toolName: tool.name, roomId: context.roomId, concurrencyMode: mode },
      });

      if (!lockResult.ok) {
        // Release any locks already acquired
        for (const h of handles) {
          await mgr.release(agentId, h.resource).catch(() => { /* TTL handles it */ });
        }

        log.warn({
          agentId,
          toolName: tool.name,
          resource: key,
          concurrencyMode: mode,
          error: lockResult.error.code,
        }, 'Tool blocked by resource lock');

        return err(
          'RESOURCE_LOCKED',
          `Cannot execute ${tool.name}: resource "${key}" is locked. ${lockResult.error.message}`,
          {
            retryable: true,
            context: { toolName: tool.name, resource: key, agentId, concurrencyMode: mode },
          },
        );
      }

      handles.push(lockResult.data);
    }

    log.debug({
      agentId,
      toolName: tool.name,
      resources: sortedKeys,
      concurrencyMode: mode,
    }, 'Locks acquired for tool execution');

    // Execute tool with lock management
    try {
      if (handles.length >= 1) {
        // Use withLockRefresh on the first handle (sorted alphabetically,
        // which for exclusive tools means __exclusive__ comes first).
        // For multi-lock scenarios (#954), this keeps at least the primary
        // lock alive during long operations.
        return await mgr.withLockRefresh(handles[0], () => next());
      }
      // No handles (shouldn't happen, but defensive)
      return await next();
    } finally {
      // Explicit release on success/error (TTL is the crash safety net)
      for (const h of handles) {
        await mgr.release(agentId, h.resource).catch(() => { /* TTL handles it */ });
      }

      log.debug({
        agentId,
        toolName: tool.name,
        resources: sortedKeys,
        concurrencyMode: mode,
      }, 'Locks released after tool execution');
    }
  }

  // ── Internal: Resource Resolution ──

  private _resolveResources(
    descriptors: ToolResourceDescriptor[],
    params: Record<string, unknown>,
    context: ToolContext,
  ): string[] {
    return descriptors.map(d => this._makeKey(d, params, context));
  }

  /**
   * Build a resource key from a descriptor and the current execution context.
   * Static mode: `type:<buildingId|roomId>`
   * Param mode: `type:<paramValue>` (falls back to static if param missing)
   */
  private _makeKey(
    d: ToolResourceDescriptor,
    params: Record<string, unknown>,
    context: ToolContext,
  ): string {
    const scope = context.buildingId || context.roomId || 'global';

    if (d.mode === 'static') {
      return `${d.type}:${scope}`;
    }

    // Param mode — resolve value from tool params
    const paramValue = d.paramKey ? params[d.paramKey] : undefined;
    if (!paramValue || typeof paramValue !== 'string') {
      // Fallback to static scope if param not available
      return `${d.type}:${scope}`;
    }

    return `${d.type}:${paramValue}`;
  }

  // ── Exclusive Gate (#954) ──

  /**
   * Wait for the global exclusive lock to be free before proceeding.
   * Serialized tools call this to ensure they don't run alongside exclusive tools.
   * Polls isLocked at 500ms intervals with a 30s timeout.
   */
  private async _waitForExclusiveGate(
    mgr: ReturnType<typeof getResourceLockManager>,
    agentId: string,
    toolName: string,
  ): Promise<Result> {
    const maxWait = 30_000;
    const pollInterval = 500;
    const deadline = Date.now() + maxWait;

    while (true) {
      const lockState = await mgr.isLocked(EXCLUSIVE_LOCK_KEY);
      if (!lockState.ok) {
        // Can't check — proceed optimistically (same as no-lock path)
        break;
      }

      // Not locked — gate is open
      if (!lockState.data) break;

      // Locked by us — gate is open (we hold exclusive, shouldn't happen for serialized, but safe)
      if (lockState.data.agentId === agentId) break;

      // Locked by another agent — wait
      if (Date.now() >= deadline) {
        log.warn({ agentId, toolName, holder: lockState.data.agentId }, 'Serialized tool timed out waiting for exclusive gate');
        return err(
          'EXCLUSIVE_GATE_TIMEOUT',
          `Cannot execute ${toolName}: exclusive operation in progress by ${lockState.data.agentId}`,
          { retryable: true, context: { toolName, agentId, holder: lockState.data.agentId } },
        );
      }

      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }

    return { ok: true, data: undefined } as Result;
  }

  /**
   * Get the maximum TTL from a tool's resource descriptors (#954).
   * Used so the exclusive lock gets a TTL that matches the tool's needs.
   */
  private _getMaxDescriptorTtl(tool: ToolDefinition): number | undefined {
    if (!tool.resources || tool.resources.length === 0) return undefined;

    let maxTtl: number | undefined;
    for (const r of tool.resources) {
      const ttl = r.lockOptions?.ttl;
      if (ttl !== undefined && (maxTtl === undefined || ttl > maxTtl)) {
        maxTtl = ttl;
      }
    }
    return maxTtl;
  }
}
