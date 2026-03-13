/**
 * Agent Session
 *
 * Manages agent work sessions within rooms.
 * Persistent — stored in SQLite agent_sessions table.
 * Handles: enter room → work on todo → produce exit doc → leave room.
 */

import { logger } from '../core/logger.js';
import { getDb } from '../storage/db.js';
import { safeJsonParse } from '../core/contracts.js';

const log = logger.child({ module: 'agent-session' });

export interface SessionMessage {
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
}

interface SessionRow {
  id: string;
  agent_id: string;
  room_id: string;
  table_type: string;
  tools: string;
  status: string;
  messages: string;
  started_at: string;
  ended_at: string | null;
}

export class AgentSession {
  id: string;
  agentId: string;
  roomId: string;
  tableType: string;
  tools: string[];
  status: 'active' | 'ended';
  startedAt: number;
  endedAt: number | null;
  messages: SessionMessage[];

  constructor({ agentId, roomId, tableType, tools }: AgentSessionParams) {
    this.id = `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    this.agentId = agentId;
    this.roomId = roomId;
    this.tableType = tableType;
    this.tools = tools;
    this.status = 'active';
    this.startedAt = Date.now();
    this.endedAt = null;
    this.messages = [];
  }

  /**
   * Get the tools available to this agent in this session.
   * Structurally limited by the room — no overrides possible.
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
      timestamp: message.timestamp ?? Date.now(),
    });
  }

  /**
   * End the session
   */
  end(): void {
    this.status = 'ended';
    this.endedAt = Date.now();
    log.info({
      sessionId: this.id,
      agentId: this.agentId,
      roomId: this.roomId,
      duration: this.endedAt - this.startedAt,
      messageCount: this.messages.length,
    }, 'Agent session ended');
  }

  /**
   * Persist session to SQLite
   */
  save(): void {
    const db = getDb();
    const existing = db.prepare('SELECT id FROM agent_sessions WHERE id = ?').get(this.id) as { id: string } | undefined;

    if (existing) {
      db.prepare(`
        UPDATE agent_sessions SET status = ?, messages = ?, ended_at = ?
        WHERE id = ?
      `).run(
        this.status,
        JSON.stringify(this.messages),
        this.endedAt ? new Date(this.endedAt).toISOString() : null,
        this.id,
      );
    } else {
      db.prepare(`
        INSERT INTO agent_sessions (id, agent_id, room_id, table_type, tools, status, messages, started_at, ended_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        this.id,
        this.agentId,
        this.roomId,
        this.tableType,
        JSON.stringify(this.tools),
        this.status,
        JSON.stringify(this.messages),
        new Date(this.startedAt).toISOString(),
        this.endedAt ? new Date(this.endedAt).toISOString() : null,
      );
    }

    log.debug({ sessionId: this.id }, 'Session saved to database');
  }

  /**
   * Load a session from SQLite by ID
   */
  static load(id: string): AgentSession | null {
    const db = getDb();
    const row = db.prepare('SELECT * FROM agent_sessions WHERE id = ?').get(id) as SessionRow | undefined;
    if (!row) return null;

    return AgentSession.fromRow(row);
  }

  /**
   * Find active session for an agent in a room
   */
  static findActive(agentId: string, roomId: string): AgentSession | null {
    const db = getDb();
    const row = db.prepare(
      'SELECT * FROM agent_sessions WHERE agent_id = ? AND room_id = ? AND status = ? ORDER BY started_at DESC, rowid DESC LIMIT 1',
    ).get(agentId, roomId, 'active') as SessionRow | undefined;
    if (!row) return null;

    return AgentSession.fromRow(row);
  }

  /**
   * List all sessions for an agent
   */
  static listForAgent(agentId: string): AgentSession[] {
    const db = getDb();
    const rows = db.prepare(
      'SELECT * FROM agent_sessions WHERE agent_id = ? ORDER BY started_at DESC',
    ).all(agentId) as SessionRow[];

    return rows.map(AgentSession.fromRow);
  }

  /**
   * Delete a session from SQLite
   */
  static delete(id: string): boolean {
    const db = getDb();
    const result = db.prepare('DELETE FROM agent_sessions WHERE id = ?').run(id);
    return result.changes > 0;
  }

  /**
   * Hydrate an AgentSession from a database row
   */
  private static fromRow(row: SessionRow): AgentSession {
    const session = Object.create(AgentSession.prototype) as AgentSession;
    session.id = row.id;
    session.agentId = row.agent_id;
    session.roomId = row.room_id;
    session.tableType = row.table_type;
    session.tools = safeJsonParse<string[]>(row.tools, []);
    session.status = row.status as 'active' | 'ended';
    session.messages = safeJsonParse<SessionMessage[]>(row.messages, []);
    session.startedAt = new Date(row.started_at).getTime();
    session.endedAt = row.ended_at ? new Date(row.ended_at).getTime() : null;
    return session;
  }
}
