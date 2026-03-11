/**
 * Agent Registry
 *
 * v2 agents are 10-line identity cards, not 200-line system prompts.
 * Agent = who. Room = what they can do.
 *
 * Manages agent CRUD, room access badges, and current assignments.
 */

import { getDb } from '../storage/db.js';
import { logger } from '../core/logger.js';
import { ok, err } from '../core/contracts.js';
import type { Result, AgentRow, ParsedAgent, AgentRegistryAPI, ToolRegistryAPI, AIProviderAPI } from '../core/contracts.js';
import type { Bus } from '../core/bus.js';

const log = logger.child({ module: 'agent-registry' });

interface InitAgentsParams {
  bus: Bus;
  tools: ToolRegistryAPI;
  ai: AIProviderAPI;
}

interface RegisterAgentParams {
  name: string;
  role: string;
  capabilities?: string[];
  roomAccess?: string[];
  badge?: string | null;
  config?: Record<string, unknown>;
}

interface AgentUpdates {
  name?: string;
  role?: string;
  capabilities?: string[];
  roomAccess?: string[];
  badge?: string | null;
  config?: Record<string, unknown>;
}

export function initAgents({ bus }: InitAgentsParams): AgentRegistryAPI {
  bus.on('agent:register', (data: Record<string, unknown>) => registerAgent(data as unknown as RegisterAgentParams));
  bus.on('agent:remove', (data: Record<string, unknown>) => removeAgent(data.agentId as string));

  log.info('Agent registry initialized');
  return { registerAgent, removeAgent, getAgent, listAgents, updateAgent };
}

/**
 * Register a new agent (10-line identity card)
 */
export function registerAgent({ name, role, capabilities = [], roomAccess = [], badge = null, config = {} }: RegisterAgentParams): Result {
  const db = getDb();
  const id = `agent_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  db.prepare(`
    INSERT INTO agents (id, name, role, capabilities, room_access, badge, config)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    name,
    role,
    JSON.stringify(capabilities),
    JSON.stringify(roomAccess),
    badge,
    JSON.stringify(config),
  );

  log.info({ id, name, role, roomAccess }, 'Agent registered');
  return ok({ id, name, role });
}

/**
 * Get agent by ID
 */
export function getAgent(agentId: string): ParsedAgent | null {
  const db = getDb();
  const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(agentId) as AgentRow | undefined;
  if (!agent) return null;

  return {
    ...agent,
    capabilities: JSON.parse(agent.capabilities || '[]') as string[],
    room_access: JSON.parse(agent.room_access || '[]') as string[],
    config: JSON.parse(agent.config || '{}') as Record<string, unknown>,
  };
}

/**
 * List all agents, optionally filtered by status or room
 */
export function listAgents({ status, roomId }: { status?: string; roomId?: string } = {}): ParsedAgent[] {
  const db = getDb();
  let sql = 'SELECT * FROM agents WHERE 1=1';
  const params: string[] = [];

  if (status) { sql += ' AND status = ?'; params.push(status); }
  if (roomId) { sql += ' AND current_room_id = ?'; params.push(roomId); }

  sql += ' ORDER BY name';

  return (db.prepare(sql).all(...params) as AgentRow[]).map((a) => ({
    ...a,
    capabilities: JSON.parse(a.capabilities || '[]') as string[],
    room_access: JSON.parse(a.room_access || '[]') as string[],
    config: JSON.parse(a.config || '{}') as Record<string, unknown>,
  }));
}

/**
 * Update an agent's identity card
 */
export function updateAgent(agentId: string, updates: AgentUpdates): Result {
  const db = getDb();
  const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(agentId) as AgentRow | undefined;
  if (!agent) return err('AGENT_NOT_FOUND', `Agent ${agentId} does not exist`);

  const fields: string[] = [];
  const params: (string | null)[] = [];

  if (updates.name) { fields.push('name = ?'); params.push(updates.name); }
  if (updates.role) { fields.push('role = ?'); params.push(updates.role); }
  if (updates.capabilities) { fields.push('capabilities = ?'); params.push(JSON.stringify(updates.capabilities)); }
  if (updates.roomAccess) { fields.push('room_access = ?'); params.push(JSON.stringify(updates.roomAccess)); }
  if (updates.badge !== undefined) { fields.push('badge = ?'); params.push(updates.badge ?? null); }
  if (updates.config) { fields.push('config = ?'); params.push(JSON.stringify(updates.config)); }

  if (fields.length === 0) return ok({ id: agentId, message: 'No updates provided' });

  fields.push('updated_at = datetime(?)');
  params.push(new Date().toISOString());
  params.push(agentId);

  db.prepare(`UPDATE agents SET ${fields.join(', ')} WHERE id = ?`).run(...params);
  log.info({ agentId, updates: Object.keys(updates) }, 'Agent updated');
  return ok({ id: agentId });
}

/**
 * Remove an agent
 */
export function removeAgent(agentId: string): Result {
  const db = getDb();
  db.prepare('DELETE FROM agents WHERE id = ?').run(agentId);
  log.info({ agentId }, 'Agent removed');
  return ok({ id: agentId });
}
