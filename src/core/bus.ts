/**
 * Core Event Bus
 *
 * Thin event emitter — the ONLY shared communication channel.
 * Replaces v1's 2300-line hub.js with ~40 lines.
 * No business logic. No socket handlers. Just emit/on/off.
 */

import EventEmitter from 'eventemitter3';

class Bus extends EventEmitter {
  /**
   * Emit with structured event envelope
   * @param {string} event - Dot-namespaced event name (e.g., 'room:agent:entered')
   * @param {object} data - Event payload
   */
  emit(event, data) {
    return super.emit(event, {
      event,
      timestamp: Date.now(),
      ...data,
    });
  }

  /**
   * Subscribe to events matching a namespace prefix
   * @param {string} prefix - e.g., 'room:' matches 'room:created', 'room:agent:entered'
   * @param {Function} handler
   */
  onNamespace(prefix, handler) {
    this.on('*', (data) => {
      if (data?.event?.startsWith(prefix)) {
        handler(data);
      }
    });
  }
}

export const bus = new Bus();
