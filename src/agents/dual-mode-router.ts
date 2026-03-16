/**
 * Dual-Mode Messaging Router (#600)
 *
 * Routes messages to the appropriate transport:
 * - sendRealtime: bus only (ephemeral, sub-100ms)
 * - sendDurable: bus + GNAP (persistent, auditable)
 *
 * GNAP transport powered by GNAP (Git-Native Agent Protocol) by Farol Labs.
 * GNAP is licensed under the MIT License — Copyright (c) 2026 Farol Labs.
 * Repository: https://github.com/farol-team/gnap
 *
 * Layer: Agents (depends on Core)
 */

import { logger } from '../core/logger.js';
import type { MessagingPort, DualModeRouter, AgentMessage } from '../core/messaging-port.js';

const log = logger.child({ module: 'dual-mode-router' });

export class DualModeRouterImpl implements DualModeRouter {
  private _bus: MessagingPort;
  private _gnap: MessagingPort | null;

  constructor(bus: MessagingPort, gnap: MessagingPort | null = null) {
    this._bus = bus;
    this._gnap = gnap;
    log.info({ hasGnap: !!gnap }, 'Dual-mode router initialized');
  }

  async sendRealtime(to: string, message: Omit<AgentMessage, 'id' | 'timestamp' | 'transport'>): Promise<void> {
    await this._bus.send(to, message);
  }

  async sendDurable(to: string, message: Omit<AgentMessage, 'id' | 'timestamp' | 'transport'>): Promise<void> {
    // Always send via bus for real-time delivery
    await this._bus.send(to, message);

    // Also persist via GNAP if available
    if (this._gnap) {
      try {
        await this._gnap.send(to, message);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        log.warn({ err: msg, to }, 'GNAP persistence failed — message delivered via bus only');
        // Don't throw — bus delivery succeeded, GNAP is best-effort
      }
    }
  }

  getBusAdapter(): MessagingPort {
    return this._bus;
  }

  getGnapAdapter(): MessagingPort | null {
    return this._gnap;
  }
}
