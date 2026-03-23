/**
 * Agent Registry
 *
 * v2 agents are 10-line identity cards, not 200-line system prompts.
 * Agent = who. Room = what they can do.
 *
 * Manages agent CRUD, room access badges, and current assignments.
 */

import { getDb } from '../storage/db.js';
import { logger, broadcastLog } from '../core/logger.js';
import { ok, err } from '../core/contracts.js';
import type { Result, AgentRow, ParsedAgent, AgentRegistryAPI, AgentProfileFields, ToolRegistryAPI, AIProviderAPI } from '../core/contracts.js';
import type { Bus } from '../core/bus.js';
import { serializeBadge, validateBadge } from './security-badge.js';
import type { SecurityBadge } from './security-badge.js';
import { generateAgentProfilePhoto } from '../ai/profile-generator.js';
import { isImageGenerationAvailable } from '../ai/minimax-image.js';
import { writeAgentPhoto } from '../ai/agent-photo-store.js';
import { generateDiceBearAvatar } from '../ai/dicebear-avatar.js';

const log = logger.child({ module: 'agent-registry' });

/** Bus reference for emitting events from async operations (e.g., photo generation) */
let _bus: Bus | null = null;

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
  firstName?: string | null;
  lastName?: string | null;
  displayName?: string | null;
  nickname?: string | null;
  bio?: string | null;
  photoUrl?: string | null;
  specialization?: string | null;
  gender?: string;
}

interface AgentUpdates {
  name?: string;
  role?: string;
  capabilities?: string[];
  roomAccess?: string[];
  badge?: string | SecurityBadge | null;
  config?: Record<string, unknown>;
  provider?: string;
  model?: string;
}

export function initAgents({ bus }: InitAgentsParams): AgentRegistryAPI {
  _bus = bus;

  bus.on('agent:register', (data: Record<string, unknown>) => registerAgent(data as unknown as RegisterAgentParams));
  bus.on('agent:remove', (data: Record<string, unknown>) => removeAgent(data.agentId as string));

  bus.on('agent:update-profile', (data: Record<string, unknown>) => {
    const agentId = data.agentId as string;
    const profile = data as unknown as AgentProfileFields;
    updateAgentProfile(agentId, profile);
  });

  log.info('Agent registry initialized');
  return { registerAgent, removeAgent, getAgent, listAgents, updateAgent, updateAgentProfile };
}

/**
 * Register a new agent (10-line identity card)
 */
export function registerAgent({
  name, role, capabilities = [], roomAccess = [], badge = null, config = {}, buildingId = null,
  firstName = null, lastName = null, displayName = null, nickname = null, bio = null, photoUrl = null, specialization = null,
  gender,
}: RegisterAgentParams): Result {
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

  // Auto-generate human name if not provided (#560)
  if (!firstName) {
    const g = gender || (Math.random() < 0.5 ? 'female' : 'male');
    const fNames = g === 'female'
      ? ['Aria', 'Maya', 'Elena', 'Zara', 'Nadia', 'Sierra', 'Luna', 'Freya', 'Ivy', 'Cora', 'Iris', 'Sage', 'Nova', 'Ada', 'Vera', 'Mila', 'Leah', 'Rosa', 'Tara', 'Kira']
      : ['Leo', 'Kai', 'Ravi', 'Omar', 'Felix', 'Jace', 'Marco', 'Theo', 'Ezra', 'Dion', 'Cole', 'Atlas', 'Nico', 'Reid', 'Quinn', 'Soren', 'Arlo', 'Dean', 'Rhys', 'Elio'];
    const lNames = ['Chen', 'Park', 'Santos', 'Andersen', 'Russo', 'Okafor', 'Nakamura', 'Levy', 'Rivera', 'Singh', 'Kim', 'Weber', 'Torres', 'Laurent', 'Yamamoto', 'Shah', 'Moreau', 'Petrov', 'Ngozi', 'Alvarez'];
    firstName = fNames[Math.floor(Math.random() * fNames.length)];
    lastName = lastName || lNames[Math.floor(Math.random() * lNames.length)];
    if (!gender) gender = g;
  }

  // Auto-populate room_access from role if not provided (#796)
  let effectiveRoomAccess = roomAccess;
  if (effectiveRoomAccess.length === 0 && role) {
    const roleToRooms: Record<string, string[]> = {
      strategist: ['strategist'],
      lead: ['strategist', 'review'],
      analyst: ['discovery'],
      'business-analyst': ['discovery'],
      architect: ['architecture'],
      developer: ['code-lab'],
      engineer: ['code-lab'],
      tester: ['testing-lab'],
      qa: ['testing-lab'],
      reviewer: ['review'],
      'code-reviewer': ['review'],
      operator: ['deploy'],
      devops: ['deploy'],
      sre: ['deploy'],
      security: ['security-review'],
    };
    const mapped = roleToRooms[role.toLowerCase()];
    if (mapped) effectiveRoomAccess = mapped;
  }

  // Compute display_name: explicit value > "First Last" > fallback to name
  const computedDisplayName = displayName
    || (firstName && lastName ? `${firstName} ${lastName}` : null)
    || (firstName || null);

  // Auto-generate age and bio if not provided (#562)
  const autoAge = 25 + Math.floor(Math.random() * 36);
  const autoYears = Math.max(1, autoAge - 22 - Math.floor(Math.random() * 5));
  // Only auto-generate bio when not explicitly provided (bio param defaults to null)
  const autoBio = bio !== null && bio !== undefined ? bio : `${computedDisplayName || name} is a ${specialization || role} specialist with ${autoYears} years of experience.`;

  db.prepare(`
    INSERT INTO agents (id, name, role, building_id, capabilities, room_access, badge, config,
      first_name, last_name, display_name, nickname, bio, photo_url, specialization, gender, profile_generated, age)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    name,
    role,
    buildingId || null,
    JSON.stringify(capabilities),
    JSON.stringify(effectiveRoomAccess),
    badgeStr,
    JSON.stringify(config),
    firstName || null,
    lastName || null,
    computedDisplayName,
    nickname || null,
    autoBio,
    photoUrl || null,
    specialization || null,
    gender || null,
    0,
    autoAge,
  );

  log.info({ id, name, role, buildingId, roomAccess, hasBadge: !!badgeStr }, 'Agent registered');

  // Auto-generate avatar (#1012):
  // 1. DiceBear (free, instant, no API) — always available as default
  // 2. MiniMax image API — only if configured and not in test mode (rate-limited, costs tokens)
  const isTestMode = process.env.NODE_ENV === 'test' || process.env.CI === 'true';
  if (!photoUrl) {
    // Always generate a DiceBear avatar as the instant default
    try {
      const avatarResult = generateDiceBearAvatar(displayName || name);
      if (avatarResult.ok) {
        const svgData = (avatarResult.data as { svg: string }).svg;
        // Store as data URI in photo_url
        const dataUri = `data:image/svg+xml;base64,${Buffer.from(svgData).toString('base64')}`;
        db.prepare('UPDATE agents SET photo_url = ? WHERE id = ?').run(dataUri, id);
      }
    } catch {
      // DiceBear not available — continue without avatar
    }

    // Optionally upgrade to MiniMax photo (if configured, not test, rate-limited)
    if (isImageGenerationAvailable() && !isTestMode) {
      scheduleProfilePhotoGeneration(id, name, role, specialization ?? undefined, gender);
    }
  }

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
    profile_generated: !!(agent.profile_generated),
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
    profile_generated: !!(a.profile_generated),
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
  if (updates.provider) { fields.push('provider = ?'); params.push(updates.provider); }
  if (updates.model !== undefined) { fields.push('model = ?'); params.push(updates.model || null); }

  if (fields.length === 0) return ok({ id: agentId, message: 'No updates provided' });

  fields.push('updated_at = datetime(?)');
  params.push(new Date().toISOString());
  params.push(agentId);

  db.prepare(`UPDATE agents SET ${fields.join(', ')} WHERE id = ?`).run(...params);
  log.info({ agentId, updates: Object.keys(updates) }, 'Agent updated');
  return ok({ id: agentId });
}

/**
 * Update an agent's profile fields (first/last name, bio, photo_url, specialization).
 * Separate from updateAgent to allow targeted profile updates without affecting
 * identity card fields (name, role, capabilities, etc.).
 */
export function updateAgentProfile(agentId: string, profile: AgentProfileFields): Result {
  const db = getDb();
  const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(agentId) as AgentRow | undefined;
  if (!agent) return err('AGENT_NOT_FOUND', `Agent ${agentId} does not exist`);

  const fields: string[] = [];
  const params: (string | number | null)[] = [];

  if (profile.firstName !== undefined) { fields.push('first_name = ?'); params.push(profile.firstName ?? null); }
  if (profile.lastName !== undefined) { fields.push('last_name = ?'); params.push(profile.lastName ?? null); }
  if (profile.bio !== undefined) { fields.push('bio = ?'); params.push(profile.bio ?? null); }
  if (profile.photoUrl !== undefined) { fields.push('photo_url = ?'); params.push(profile.photoUrl ?? null); }
  if (profile.nickname !== undefined) { fields.push('nickname = ?'); params.push(profile.nickname ?? null); }
  if (profile.specialization !== undefined) { fields.push('specialization = ?'); params.push(profile.specialization ?? null); }
  if (profile.gender !== undefined) { fields.push('gender = ?'); params.push(profile.gender ?? null); }
  if (profile.profileGenerated !== undefined) { fields.push('profile_generated = ?'); params.push(profile.profileGenerated ? 1 : 0); }

  // Compute display_name: explicit value > "First Last" > keep existing
  if (profile.displayName !== undefined) {
    fields.push('display_name = ?');
    params.push(profile.displayName ?? null);
  } else if (profile.firstName !== undefined || profile.lastName !== undefined) {
    const first = profile.firstName !== undefined ? profile.firstName : agent.first_name;
    const last = profile.lastName !== undefined ? profile.lastName : agent.last_name;
    const computed = first && last ? `${first} ${last}` : (first || null);
    fields.push('display_name = ?');
    params.push(computed);
  }

  if (fields.length === 0) return ok({ id: agentId, message: 'No profile updates provided' });

  fields.push('updated_at = datetime(?)');
  params.push(new Date().toISOString());
  params.push(agentId);

  db.prepare(`UPDATE agents SET ${fields.join(', ')} WHERE id = ?`).run(...params);
  log.info({ agentId, profileFields: fields.length - 1 }, 'Agent profile updated');
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

/**
 * Reset all agents for a building — clear status, room assignments, and activity.
 * Agents remain registered but return to idle state (#559).
 */
export function resetBuildingAgents(buildingId: string): Result {
  const db = getDb();

  // Reset agent status to idle and clear current room
  const updated = db.prepare(`
    UPDATE agents SET status = 'idle', current_room_id = NULL
    WHERE building_id = ?
  `).run(buildingId);

  // Clear activity log for this building
  db.prepare('DELETE FROM agent_activity_log WHERE building_id = ?').run(buildingId);

  // Reset stats for agents in this building
  const agentIds = db.prepare('SELECT id FROM agents WHERE building_id = ?')
    .all(buildingId) as Array<{ id: string }>;
  for (const { id } of agentIds) {
    db.prepare('DELETE FROM agent_stats WHERE agent_id = ?').run(id);
  }

  log.info({ buildingId, count: updated.changes }, 'Building agents reset');
  return ok({ buildingId, agentsReset: updated.changes });
}

// ─── Auto Profile Photo Generation ───

/**
 * Schedule asynchronous profile photo generation for a newly registered agent.
 * Runs in the background — does not block the registration call.
 * On success, updates the agent's photo_url and emits agent:profile-updated.
 * On failure, logs a warning but does not affect agent registration.
 */
// Rate-limit photo generation to avoid hammering the API (#1082)
let _photoQueueDelay = 0;
const PHOTO_DELAY_MS = 3000; // 3s between each photo generation

function scheduleProfilePhotoGeneration(
  agentId: string,
  agentName: string,
  role: string,
  specialization?: string,
  gender?: string,
): void {
  const delay = _photoQueueDelay;
  _photoQueueDelay += PHOTO_DELAY_MS;
  // Reset delay counter after all queued photos would have finished
  setTimeout(() => { _photoQueueDelay = Math.max(0, _photoQueueDelay - PHOTO_DELAY_MS); }, delay + PHOTO_DELAY_MS);

  // Use void to explicitly discard the promise (fire-and-forget)
  void (async () => {
    if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay));
    try {
      log.info({ agentId, agentName, role, delayMs: delay }, 'Starting auto profile photo generation');

      const result = await generateAgentProfilePhoto(agentName, role, specialization, gender);

      if (!result.ok) {
        log.warn(
          { agentId, agentName, error: result.error },
          'Auto profile photo generation failed — agent registered without photo',
        );
        return;
      }

      // Write the photo to disk and get the serving URL
      const writeResult = writeAgentPhoto(agentId, result.data.base64);
      if (!writeResult.ok) {
        log.warn(
          { agentId, error: writeResult.error },
          'Failed to write agent photo to disk',
        );
        return;
      }

      const photoUrl = (writeResult.data as { photoUrl: string }).photoUrl;

      // Update the agent's profile with the photo URL
      const updateResult = updateAgentProfile(agentId, {
        photoUrl,
        profileGenerated: true,
      });

      if (updateResult.ok) {
        log.info({ agentId, agentName, photoUrl }, 'Auto-generated profile photo saved');
        broadcastLog('info', `Profile photo auto-generated for "${agentName}"`, 'agent-registry');

        // Emit profile-updated event so connected clients update in real-time
        if (_bus) {
          const updatedAgent = getAgent(agentId);
          _bus.emit('agent:profile-updated', { agentId, profile: updatedAgent });
        }
      } else {
        log.warn(
          { agentId, error: updateResult.error },
          'Auto profile photo generated but failed to update agent profile',
        );
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      log.error(
        { agentId, agentName, error: message },
        'Unexpected error during auto profile photo generation',
      );
    }
  })();
}
