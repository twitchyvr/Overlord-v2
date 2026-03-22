/**
 * Agent Error Boundary — Per-Agent Fault Containment (#945)
 *
 * Wraps agent execution to contain failures. When an agent crashes:
 *   1. All resource locks held by the agent are released immediately
 *   2. A structured agent:error event is emitted on the bus
 *   3. A contained Result error is returned (not thrown)
 *
 * Other agents continue unaffected — the blast radius is limited to
 * the failing agent only.
 *
 * Layer: Agents (depends on Core only)
 *
 * Attribution:
 *   Inspired by std::panic::catch_unwind from mediar-ai/terminator.
 *   https://github.com/mediar-ai/terminator/blob/main/crates/terminator/src/element.rs
 */

import { ok, err } from '../core/contracts.js';
import { logger } from '../core/logger.js';
import type { Result } from '../core/contracts.js';
import type { ResourceLockManager } from '../core/resource-lock.js';
import type { Bus } from '../core/bus.js';

const log = logger.child({ module: 'agent-error-boundary' });

export class AgentErrorBoundary {
  constructor(
    private readonly agentId: string,
    private readonly lockManager?: ResourceLockManager,
    private readonly bus?: Bus,
  ) {}

  /**
   * Execute an async function within the error boundary.
   * On success: returns ok(value).
   * On failure: cleans up agent state and returns err().
   */
  async execute<T>(fn: () => Promise<T>): Promise<Result<T>> {
    try {
      const value = await fn();
      return ok(value);
    } catch (error) {
      return this.handleError(error);
    }
  }

  /**
   * Manual cleanup trigger for disconnect/shutdown scenarios.
   * Releases all locks and emits a cleanup event.
   */
  cleanup(): void {
    this.releaseLocks();

    if (this.bus) {
      this.bus.emit('agent:cleanup', {
        agentId: this.agentId,
      });
    }

    log.info({ agentId: this.agentId }, 'Agent cleanup completed');
  }

  // ── Internal ──

  private handleError(error: unknown): Result<never> {
    const message = error instanceof Error ? error.message : String(error);

    log.error({ agentId: this.agentId, error: message }, 'Agent error caught by boundary');

    // 1. Release all locks held by this agent
    this.releaseLocks();

    // 2. Emit structured error event (not raw throw)
    if (this.bus) {
      this.bus.emit('agent:error', {
        agentId: this.agentId,
        error: { code: 'AGENT_ERROR', message },
      });
    }

    // 3. Return contained error — does NOT propagate to other agents
    return err('AGENT_ERROR', `Agent ${this.agentId} failed: ${message}`, {
      retryable: true,
      context: { agentId: this.agentId },
    });
  }

  private releaseLocks(): void {
    if (!this.lockManager) return;

    try {
      const result = this.lockManager.releaseAllForAgent(this.agentId);
      if (result.ok) {
        const released = result.data.released;
        if (released > 0) {
          log.info({ agentId: this.agentId, released }, 'Locks released by error boundary');
        }
      }
    } catch (e) {
      // Best-effort cleanup — TTL is the ultimate safety net
      log.warn(
        { agentId: this.agentId, err: e instanceof Error ? e.message : String(e) },
        'Lock cleanup failed in error boundary',
      );
    }
  }
}
