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
  #namespaceHandlers: Array<{ prefix: string; handler: (data: BusEventData) => void }> = [];

  /**
   * Emit with structured event envelope.
   * Also invokes any matching namespace handlers.
   */
  override emit(event: string | symbol, data?: Record<string, unknown>): boolean {
    const envelope: BusEventData = {
      event: String(event),
      timestamp: Date.now(),
      ...data,
    };

    const result = super.emit(event, envelope);

    // Invoke namespace handlers whose prefix matches this event
    const eventStr = String(event);
    for (const ns of this.#namespaceHandlers) {
      if (eventStr.startsWith(ns.prefix)) {
        ns.handler(envelope);
      }
    }

    return result;
  }

  /**
   * Subscribe to all events matching a namespace prefix.
   * e.g., onNamespace('room:', handler) fires for 'room:create', 'room:enter', etc.
   */
  onNamespace(prefix: string, handler: (data: BusEventData) => void): void {
    this.#namespaceHandlers.push({ prefix, handler });
  }

  /**
   * Remove a namespace handler
   */
  offNamespace(prefix: string, handler: (data: BusEventData) => void): void {
    this.#namespaceHandlers = this.#namespaceHandlers.filter(
      (ns) => !(ns.prefix === prefix && ns.handler === handler),
    );
  }
}

export const bus = new Bus();
export type { Bus };
