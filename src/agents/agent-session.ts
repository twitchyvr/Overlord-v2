/**
 * Agent Session
 *
 * Manages agent work sessions within rooms.
 * Persistent — survives restarts (stored in DB, not in-memory).
 * Handles: enter room → work on todo → produce exit doc → leave room.
 */

import { logger } from '../core/logger.js';
import type { Bus } from '../core/bus.js';

const log = logger.child({ module: 'agent-session' });

interface SessionMessage {
  role: string;
  content: string;
  timestamp?: number;
  [key: string]: unknown;
}

interface AgentSessionParams {
  agentId: string;
  roomId: string;
  tableType: string;
  tools: string[];
  bus: Bus;
}

export class AgentSession {
  agentId: string;
  roomId: string;
  tableType: string;
  tools: string[];
  bus: Bus;
  status: 'active' | 'ended';
  startedAt: number;
  endedAt: number | null;
  messages: SessionMessage[];

  constructor({ agentId, roomId, tableType, tools, bus }: AgentSessionParams) {
    this.agentId = agentId;
    this.roomId = roomId;
    this.tableType = tableType;
    this.tools = tools;
    this.bus = bus;
    this.status = 'active';
    this.startedAt = Date.now();
    this.endedAt = null;
    this.messages = [];
  }

  /**
   * Get the tools available to this agent in this session
   * Structurally limited by the room — no overrides possible
   */
  getAvailableTools(): string[] {
    return [...this.tools];
  }

  /**
   * Add a message to the session history
   */
  addMessage(message: SessionMessage): void {
    this.messages.push({
      ...message,
      timestamp: Date.now(),
    });
  }

  /**
   * End the session
   */
  end(): void {
    this.status = 'ended';
    this.endedAt = Date.now();
    log.info({
      agentId: this.agentId,
      roomId: this.roomId,
      duration: this.endedAt - this.startedAt,
      messageCount: this.messages.length,
    }, 'Agent session ended');
  }
}
