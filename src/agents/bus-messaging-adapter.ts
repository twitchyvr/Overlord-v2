/**
 * Bus Messaging Adapter
 *
 * Implements MessagingPort using Overlord's event bus for real-time
 * agent-to-agent messaging. Messages are ephemeral — they exist only
 * in memory for the duration of the session.
 *
 * For persistent messaging, use GnapMessagingAdapter.
 */

import { logger } from '../core/logger.js';
import type { Bus } from '../core/bus.js';
import type { AgentMessage, MessagingPort } from '../core/messaging-port.js';

const log = logger.child({ module: 'bus-messaging' });

export function createBusMessagingAdapter(bus: Bus): MessagingPort {
  const subscriptions = new Map<string, Set<(msg: AgentMessage) => void>>();
  const pendingMessages = new Map<string, AgentMessage[]>();

  // Listen for all agent messages on the bus
  bus.on('agent:message', (data: Record<string, unknown>) => {
    const msg = data as unknown as AgentMessage;
    const toId = msg.to;

    // Store in pending queue
    if (!pendingMessages.has(toId)) {
      pendingMessages.set(toId, []);
    }
    pendingMessages.get(toId)!.push(msg);

    // Notify subscribers
    const subs = subscriptions.get(toId);
    if (subs) {
      for (const callback of subs) {
        try {
          callback(msg);
        } catch (err) {
          log.error({ toId, error: String(err) }, 'Message subscriber error');
        }
      }
    }
  });

  return {
    async send(to, message) {
      const fullMessage: AgentMessage = {
        ...message,
        id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        timestamp: Date.now(),
        transport: 'bus',
      };

      bus.emit('agent:message', fullMessage as unknown as Record<string, unknown>);
      log.debug({ from: message.from, to, type: message.type }, 'Message sent via bus');
    },

    async receive(agentId) {
      const messages = pendingMessages.get(agentId) || [];
      pendingMessages.set(agentId, []); // Clear after reading
      return messages;
    },

    subscribe(agentId, callback) {
      if (!subscriptions.has(agentId)) {
        subscriptions.set(agentId, new Set());
      }
      subscriptions.get(agentId)!.add(callback);

      // Return unsubscribe function
      return () => {
        const subs = subscriptions.get(agentId);
        if (subs) {
          subs.delete(callback);
          if (subs.size === 0) subscriptions.delete(agentId);
        }
      };
    },
  };
}
