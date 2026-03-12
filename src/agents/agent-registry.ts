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
import { parseBadge, serializeBadge, validateBadge } from './security-badge.js';
import type { SecurityBadge } from './security-badge.js';

const log = logger.child({ module: 'agent-registry' });

/**
 * Safely parse a JSON string from the database.
 * Returns the fallback value if parsing fails (corrupted DB data).
 */
function safeJsonParse<T>(raw: string | null | undefined, fallback: T, context: string): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    log.warn({ raw: raw.slice(0, 100), context }, 'Malformed JSON in database — using fallback');
    return fallback;
  }
}

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
  badge?: string | SecurityBadge | null;
  config?: Record<string, unknown>;
  buildingId?: string | null;
}

interface AgentUpdates {
  name?: string;
  role?: string;
  capabilities?: string[];
  roomAccess?: string[];
  badge?: string | SecurityBadge | null;
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
export function registerAgent({ name, role, capabilities = [], roomAccess = [], badge = null, config = {}, buildingId = null }: RegisterAgentParams): Result {
  const db = getDb();
  const id = `agent_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  // Serialize badge: accept structured object or raw string
  let badgeStr: string | null = null;
  if (badge && typeof badge === 'object') {
    const validation = validateBadge(badge);
    if (!validation.ok) return validation;
    badgeStr = serializeBadge(badge as SecurityBadge);
  } else if (typeof badge === 'string') {
    badgeStr = badge;
  }

  db.prepare(`
    INSERT INTO agents (id, name, role, building_id, capabilities, room_access, badge, config)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    name,
    role,
    buildingId || null,
    JSON.stringify(capabilities),
    JSON.stringify(roomAccess),
    badgeStr,
    JSON.stringify(config),
  );

  log.info({ id, name, role, buildingId, roomAccess, hasBadge: !!badgeStr }, 'Agent registered');
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
    capabilities: safeJsonParse<string[]>(agent.capabilities, [], `agent.capabilities[${agentId}]`),
    room_access: safeJsonParse<string[]>(agent.room_access, [], `agent.room_access[${agentId}]`),
    config: safeJsonParse<Record<string, unknown>>(agent.config, {}, `agent.config[${agentId}]`),
  };
}

/**
 * List all agents, optionally filtered by status, room, or building
 */
export function listAgents({ status, roomId, buildingId }: { status?: string; roomId?: string; buildingId?: string } = {}): ParsedAgent[] {
  const db = getDb();
  let sql = 'SELECT * FROM agents WHERE 1=1';
  const params: string[] = [];

  if (status) { sql += ' AND status = ?'; params.push(status); }
  if (roomId) { sql += ' AND current_room_id = ?'; params.push(roomId); }
  if (buildingId) { sql += ' AND building_id = ?'; params.push(buildingId); }

  sql += ' ORDER BY name';

  return (db.prepare(sql).all(...params) as AgentRow[]).map((a) => ({
    ...a,
    capabilities: safeJsonParse<string[]>(a.capabilities, [], `agent.capabilities[${a.id}]`),
    room_access: safeJsonParse<string[]>(a.room_access, [], `agent.room_access[${a.id}]`),
    config: safeJsonParse<Record<string, unknown>>(a.config, {}, `agent.config[${a.id}]`),
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
  if (updates.badge !== undefined) {
    if (updates.badge && typeof updates.badge === 'object') {
      const validation = validateBadge(updates.badge);
      if (!validation.ok) return validation;
      fields.push('badge = ?'); params.push(serializeBadge(updates.badge as SecurityBadge));
    } else {
      fields.push('badge = ?'); params.push((updates.badge as string) ?? null);
    }
  }
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
