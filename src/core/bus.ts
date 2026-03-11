/**
 * Core Event Bus
 *
 * Thin event emitter — the ONLY shared communication channel.
 * Replaces v1's 2300-line hub.js with ~40 lines.
 * No business logic. No socket handlers. Just emit/on/off.
 */

import { EventEmitter } from 'eventemitter3';

export interface BusEventData {
  event: string;
  timestamp: number;
  [key: string]: unknown;
}

class Bus extends EventEmitter {
  /**
   * Emit with structured event envelope
   */
  override emit(event: string | symbol, data?: Record<string, unknown>): boolean {
    return super.emit(event, {
      event,
      timestamp: Date.now(),
      ...data,
    });
  }

  /**
   * Subscribe to events matching a namespace prefix
   */
  onNamespace(prefix: string, handler: (data: BusEventData) => void): void {
    this.on('*', (data: BusEventData) => {
      if (data?.event?.startsWith(prefix)) {
        handler(data);
      }
    });
  }
}

export const bus = new Bus();
export type { Bus };
