/**
 * Agent Session
 *
 * Manages agent work sessions within rooms.
 * Persistent — survives restarts (stored in DB, not in-memory).
 * Handles: enter room → work on todo → produce exit doc → leave room.
 */

import { logger } from '../core/logger.js';

const log = logger.child({ module: 'agent-session' });

export class AgentSession {
  constructor({ agentId, roomId, tableType, tools, bus }) {
    this.agentId = agentId;
    this.roomId = roomId;
    this.tableType = tableType;
    this.tools = tools;
    this.bus = bus;
    this.status = 'active';
    this.startedAt = Date.now();
    this.messages = [];
  }

  /**
   * Get the tools available to this agent in this session
   * Structurally limited by the room — no overrides possible
   */
  getAvailableTools() {
    return [...this.tools];
  }

  /**
   * Add a message to the session history
   */
  addMessage(message) {
    this.messages.push({
      ...message,
      timestamp: Date.now(),
    });
  }

  /**
   * End the session
   */
  end() {
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
