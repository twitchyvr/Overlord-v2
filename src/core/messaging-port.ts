/**
 * MessagingPort — Unified Agent Messaging Interface
 *
 * Defines the contract for agent-to-agent messaging regardless of
 * transport. Implementations:
 * - BusMessagingAdapter: real-time via event bus (< 100ms, ephemeral)
 * - GnapMessagingAdapter: git-backed via GNAP (persistent, auditable)
 *
 * This interface was designed around the GNAP (Git-Native Agent Protocol)
 * created by Farol Labs (https://github.com/farol-team).
 * GNAP is licensed under the MIT License — Copyright (c) 2026 Farol Labs.
 * See: https://github.com/farol-team/gnap
 */

export interface AgentMessage {
  id: string;
  from: string;       // Agent ID
  to: string;         // Agent ID or room path
  type: 'task' | 'question' | 'update' | 'handoff' | 'escalation' | 'notification';
  subject: string;
  body: string;
  metadata?: Record<string, unknown>;
  timestamp: number;
  transport?: 'bus' | 'gnap';  // Which transport delivered this message
}

export interface MessagingPort {
  /** Send a message to an agent or room */
  send(to: string, message: Omit<AgentMessage, 'id' | 'timestamp' | 'transport'>): Promise<void>;

  /** Receive pending messages for an agent */
  receive(agentId: string): Promise<AgentMessage[]>;

  /** Subscribe to live messages for an agent */
  subscribe(agentId: string, callback: (msg: AgentMessage) => void): () => void;

  /** Get message history for an agent (GNAP only — bus is ephemeral) */
  history?(agentId: string, limit?: number): Promise<AgentMessage[]>;
}

/**
 * Dual-mode messaging router.
 * Routes messages to the appropriate transport based on urgency.
 * All messages are sent via bus for real-time. Durable messages are
 * also persisted via GNAP for audit trail.
 */
export interface DualModeRouter {
  /** Send real-time (bus only) */
  sendRealtime(to: string, message: Omit<AgentMessage, 'id' | 'timestamp' | 'transport'>): Promise<void>;

  /** Send durable (bus + GNAP) */
  sendDurable(to: string, message: Omit<AgentMessage, 'id' | 'timestamp' | 'transport'>): Promise<void>;

  /** Get the bus adapter */
  getBusAdapter(): MessagingPort;

  /** Get the GNAP adapter (if available) */
  getGnapAdapter(): MessagingPort | null;
}
