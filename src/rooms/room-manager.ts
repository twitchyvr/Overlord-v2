/**
 * Room Manager
 *
 * Core of the v2 architecture. Rooms define behavior, not agents.
 * Manages room lifecycle, agent entry/exit, tool scoping, and exit documents.
 *
 * Key principle: if a tool isn't in the room's allowed list, it doesn't exist.
 * Binary access — no confidence scores, no tier registry, no escalation chains.
 */

import { logger } from '../core/logger.js';
import { getDb } from '../storage/db.js';
import { ok, err } from '../core/contracts.js';
import { queryHook } from '../plugins/plugin-loader.js';
import type {
  Result,
  RoomManagerAPI,
  RoomRow,
  AgentRow,
  BaseRoomConstructor,
  AgentRegistryAPI,
  ToolRegistryAPI,
  AIProviderAPI,
} from '../core/contracts.js';
import type { Bus } from '../core/bus.js';
import { BaseRoom } from './room-types/base-room.js';
import { parseBadge, checkRoomAccess } from '../agents/security-badge.js';

const log = logger.child({ module: 'room-manager' });

const activeRooms = new Map<string, BaseRoom>();
const roomTypeRegistry = new Map<string, typeof BaseRoom>();

// Module-scope bus reference — injected via initRooms, used by createRoom to inject into rooms
let moduleBus: Bus | null = null;

interface InitRoomsParams {
  bus: Bus;
  agents: AgentRegistryAPI;
  tools: ToolRegistryAPI;
  ai: AIProviderAPI;
}

export function initRooms({ bus }: InitRoomsParams): RoomManagerAPI {
  moduleBus = bus;
  bus.on('room:create', (data: Record<string, unknown>) => createRoom(data as unknown as CreateRoomParams));
  bus.on('room:enter', (data: Record<string, unknown>) => enterRoom(data as unknown as EnterRoomParams));
  bus.on('room:exit', (data: Record<string, unknown>) => exitRoom(data as unknown as ExitRoomParams));
  bus.on('room:submit-exit-doc', (data: Record<string, unknown>) => submitExitDocument(data as unknown as SubmitExitDocParams));

  log.info('Room manager initialized');
  return { createRoom, enterRoom, exitRoom, getRoom, listRooms, registerRoomType, hydrateRoomsFromDb, updateRoom, deleteRoom, updateTable, deleteTable };
}

interface CreateRoomParams {
  type: string;
  floorId: string;
  name: string;
  config?: Record<string, unknown>;
}

/**
 * Register a room type (built-in or plugin)
 */
export function registerRoomType(type: string, factory: BaseRoomConstructor): void {
  roomTypeRegistry.set(type, factory as unknown as typeof BaseRoom);
  log.info({ type }, 'Room type registered');
}

/**
 * Create a new room instance
 */
export function createRoom({ type, floorId, name, config: roomConfig = {} }: CreateRoomParams): Result {
  const Factory = roomTypeRegistry.get(type);
  if (!Factory) {
    return err('UNKNOWN_ROOM_TYPE', `Room type "${type}" is not registered`);
  }

  try {
    const id = `room_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const db = getDb();
    const contract = Factory.contract;

    db.prepare(`
      INSERT INTO rooms (id, floor_id, type, name, allowed_tools, file_scope, exit_template, escalation, provider, config)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      floorId,
      type,
      name,
      JSON.stringify(contract.tools),
      contract.fileScope || 'assigned',
      JSON.stringify(contract.exitRequired),
      JSON.stringify(contract.escalation || {}),
      contract.provider || 'configurable',
      JSON.stringify(roomConfig),
    );

    const room = new Factory(id, { ...contract, ...roomConfig });
    if (moduleBus) room.setBus(moduleBus);
    activeRooms.set(id, room);

    log.info({ id, type, name, floor: floorId }, 'Room created');
    return ok({ id, type, name });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error({ type, name, err: msg }, 'Failed to create room');
    return err('DB_ERROR', `Failed to create room: ${msg}`);
  }
}

interface EnterRoomParams {
  roomId: string;
  agentId: string;
  tableType?: string;
}

/**
 * Agent enters a room — room's tools merge into agent's context.
 * Validates table type exists in room's contract and checks chair capacity.
 */
export function enterRoom({ roomId, agentId, tableType }: EnterRoomParams): Result {
  const room = activeRooms.get(roomId);
  if (!room) {
    return err('ROOM_NOT_FOUND', `Room ${roomId} does not exist`);
  }

  // Auto-resolve table type: use requested, fall back to first valid table (#573)
  const validTables = Object.keys(room.tables);
  let resolvedTable = tableType || validTables[0] || 'focus';
  if (!room.tables[resolvedTable]) {
    // Requested table doesn't exist — use first available instead of failing
    resolvedTable = validTables[0] || 'focus';
    if (!room.tables[resolvedTable]) {
      return err(
        'NO_TABLES',
        `Room ${room.type} has no valid table types`,
      );
    }
  }
  const tableConfig = room.tables[resolvedTable];

  try {
    // Check agent has badge/access to this room type
    const db = getDb();
    const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(agentId) as AgentRow | undefined;
    if (!agent) {
      return err('AGENT_NOT_FOUND', `Agent ${agentId} does not exist`);
    }

    // If agent is already in another room, auto-exit it first (prevents orphaned state)
    if (agent.current_room_id && agent.current_room_id !== roomId) {
      log.info({ agentId, previousRoom: agent.current_room_id, newRoom: roomId }, 'Agent already in another room — auto-exiting before entry');
      const autoExit = exitRoom({ roomId: agent.current_room_id, agentId, reason: 'reassignment' });
      if (!autoExit.ok) {
        return err('AUTO_EXIT_FAILED', `Agent is in room ${agent.current_room_id} and auto-exit failed: ${autoExit.error}`, { context: { previousRoom: agent.current_room_id } });
      }
    }

    // If agent is already in THIS room, return success with current state
    if (agent.current_room_id === roomId) {
      log.info({ agentId, roomId }, 'Agent already in this room — returning current state');
      const currentTable = agent.current_table_id;
      return ok({ roomId, agentId, tableId: currentTable, tools: room.getAllowedTools(), fileScope: room.fileScope, alreadyPresent: true });
    }

    let roomAccess: string[];
    try {
      roomAccess = JSON.parse(agent.room_access || '[]') as string[];
    } catch {
      log.warn({ agentId, raw: (agent.room_access || '').slice(0, 100) }, 'Malformed room_access JSON — defaulting to empty');
      roomAccess = [];
    }

    // Security badge check — badge takes priority, falls back to roomAccess
    const badge = parseBadge(agent.badge);
    const accessResult = checkRoomAccess(agentId, room.type, badge, roomAccess);
    if (!accessResult.ok) {
      return accessResult;
    }

    // Find or create table, check capacity, and seat agent — all in one transaction
    // to prevent race conditions where two agents grab the last chair simultaneously
    const seatAgent = db.transaction(() => {
      let tableRow = db
        .prepare('SELECT id FROM tables_v2 WHERE room_id = ? AND type = ?')
        .get(roomId, resolvedTable) as { id: string } | undefined;

      if (!tableRow) {
        const tableId = `table_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        db.prepare('INSERT INTO tables_v2 (id, room_id, type, chairs, description) VALUES (?, ?, ?, ?, ?)').run(
          tableId,
          roomId,
          resolvedTable,
          tableConfig.chairs,
          tableConfig.description,
        );
        tableRow = { id: tableId };
      }

      // Check chair capacity — count agents already seated at this table
      const seatedCount = db
        .prepare('SELECT COUNT(*) as cnt FROM agents WHERE current_table_id = ?')
        .get(tableRow.id) as { cnt: number };

      if (seatedCount.cnt >= tableConfig.chairs) {
        return { error: true as const, tableId: tableRow.id, occupancy: seatedCount.cnt };
      }

      // Seat the agent atomically within the same transaction
      // Keep current status (idle) — only the play button should transition to 'active' (#998)
      db.prepare('UPDATE agents SET current_room_id = ?, current_table_id = ? WHERE id = ?').run(
        roomId,
        tableRow.id,
        agentId,
      );

      return { error: false as const, tableId: tableRow.id };
    });

    const seatResult = seatAgent();
    if (seatResult.error) {
      return err(
        'TABLE_FULL',
        `Table "${resolvedTable}" in ${room.type} room is full (${tableConfig.chairs} chair${tableConfig.chairs === 1 ? '' : 's'})`,
        { context: { tableType: resolvedTable, maxChairs: tableConfig.chairs, currentOccupancy: seatResult.occupancy } },
      );
    }

    const tableId = seatResult.tableId;

    // Fire lifecycle hook — room can track agent, emit bus events, run setup logic
    const enterResult = room.onAgentEnter(agentId, resolvedTable);
    if (!enterResult.ok) {
      // Roll back DB change if room rejects entry
      db.prepare('UPDATE agents SET current_room_id = NULL, current_table_id = NULL, status = ? WHERE id = ?').run(
        'idle',
        agentId,
      );
      return enterResult;
    }

    log.info({ roomId, agentId, tableType: resolvedTable, tableId }, 'Agent entered room');
    return ok({ roomId, agentId, tableId, tools: room.getAllowedTools(), fileScope: room.fileScope });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error({ roomId, agentId, tableType: resolvedTable, err: msg }, 'Failed to enter room');
    return err('DB_ERROR', `Failed to enter room: ${msg}`);
  }
}

interface ExitRoomParams {
  roomId: string;
  agentId: string;
  reason?: 'disconnect' | 'normal' | 'reassignment';
}

/**
 * Agent exits a room — requires exit document if room mandates it.
 * If the room has required exit fields, the agent MUST have submitted
 * an exit document before they can leave. Structural enforcement.
 */
export function exitRoom({ roomId, agentId, reason }: ExitRoomParams): Result {
  const room = activeRooms.get(roomId);
  if (!room) return err('ROOM_NOT_FOUND', `Room ${roomId} does not exist`);

  try {
    const db = getDb();

    // Verify agent is actually in this room
    const agent = db.prepare('SELECT current_room_id FROM agents WHERE id = ?').get(agentId) as { current_room_id: string | null } | undefined;
    if (!agent) return err('AGENT_NOT_FOUND', `Agent ${agentId} does not exist`);
    if (agent.current_room_id !== roomId) {
      log.warn({ agentId, roomId, actualRoom: agent.current_room_id }, 'Agent tried to exit room they are not in');
      return err('NOT_IN_ROOM', `Agent ${agentId} is not in room ${roomId}`);
    }

    // Enforce exit document requirement
    // Skip for disconnect (agent can't submit docs) and reassignment (system-initiated move, #571)
    const skipExitDoc = reason === 'disconnect' || reason === 'reassignment';
    const exitReq = room.exitRequired;
    if (!skipExitDoc && exitReq && exitReq.fields.length > 0) {
      const exitDoc = db
        .prepare('SELECT id FROM exit_documents WHERE room_id = ? AND completed_by = ? ORDER BY created_at DESC LIMIT 1')
        .get(roomId, agentId) as { id: string } | undefined;

      if (!exitDoc) {
        return err(
          'EXIT_DOC_REQUIRED',
          `Room "${room.type}" requires an exit document before leaving. Required fields: ${exitReq.fields.join(', ')}`,
          { context: { roomType: room.type, requiredFields: exitReq.fields } },
        );
      }
    }

    // Fire lifecycle hook — room can clean up agent state, emit bus events
    const exitResult = room.onAgentExit(agentId);
    if (!exitResult.ok) {
      return exitResult;
    }

    db.prepare('UPDATE agents SET current_room_id = NULL, current_table_id = NULL, status = ? WHERE id = ?').run(
      'idle',
      agentId,
    );

    if (skipExitDoc) {
      log.info({ roomId, agentId, reason: reason || 'auto' }, 'Agent exited room (exit doc bypassed)');
    } else {
      log.info({ roomId, agentId }, 'Agent exited room');
    }
    return ok({ roomId, agentId });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error({ roomId, agentId, err: msg }, 'Failed to exit room');
    return err('DB_ERROR', `Failed to exit room: ${msg}`);
  }
}

/**
 * Extract a meaningful summary from exit document fields (#675).
 * Iterates over ALL fields rather than hardcoding names, since each
 * room type has different field names (filesModified, verdict, projectGoals, etc.)
 */
function _extractExitDocSummary(doc: Record<string, unknown>, _docType: string, roomType: string): string {
  // Try each field — use the first meaningful string value
  for (const [key, value] of Object.entries(doc)) {
    if (typeof value === 'string' && value.trim().length > 5) {
      const text = value.trim();
      const label = _humanizeFieldName(key);
      const truncated = text.length > 160 ? text.slice(0, 157) + '...' : text;
      return `${label}: ${truncated}`;
    }
    // For arrays of strings, join them
    if (Array.isArray(value) && value.length > 0 && typeof value[0] === 'string') {
      const label = _humanizeFieldName(key);
      const joined = value.slice(0, 3).join(', ');
      return `${label}: ${joined}${value.length > 3 ? ` (+${value.length - 3} more)` : ''}`;
    }
  }
  return `${_humanizeFieldName(roomType)} completed`;
}

/**
 * Extract rationale from exit document — concatenate key field names and values (#675).
 */
function _extractExitDocRationale(doc: Record<string, unknown>, _docType: string): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(doc)) {
    if (key === 'artifacts') continue; // skip artifact arrays
    const label = _humanizeFieldName(key);
    if (typeof value === 'string' && value.trim().length > 0) {
      parts.push(`${label}: ${value.trim().slice(0, 80)}`);
    } else if (typeof value === 'number') {
      parts.push(`${label}: ${value}`);
    } else if (Array.isArray(value)) {
      parts.push(`${label}: ${value.length} items`);
    }
    if (parts.length >= 4) break; // enough context
  }
  return parts.join(' | ') || `Exit document submitted`;
}

/** Convert camelCase/snake_case field names to readable labels */
function _humanizeFieldName(name: string): string {
  return name
    .replace(/([a-z])([A-Z])/g, '$1 $2')  // camelCase → camel Case
    .replace(/[_-]/g, ' ')                  // snake_case → snake case
    .replace(/\b\w/g, c => c.toUpperCase()) // capitalize words
    .trim();
}

interface SubmitExitDocParams {
  roomId: string;
  agentId: string;
  document: Record<string, unknown>;
  buildingId?: string;
  phase?: string;
}

/**
 * Submit a structured exit document for a room.
 * If buildingId and phase are provided, a RAID decision entry is automatically
 * created linking this exit document to the project's decision log.
 */
export async function submitExitDocument({ roomId, agentId, document, buildingId, phase }: SubmitExitDocParams): Promise<Result> {
  const room = activeRooms.get(roomId);
  if (!room) return err('ROOM_NOT_FOUND', `Room ${roomId} does not exist`);

  const validation = room.validateExitDocument(document);
  if (!validation.ok) return validation;

  // Queryable hook: Let Lua plugins do additional exit document validation
  try {
    const hookResult = await queryHook('onExitDocValidate', {
      roomId, roomType: room.type, agentId, exitDoc: document,
    });
    if (hookResult && typeof hookResult === 'object') {
      const override = hookResult as { valid?: boolean; reason?: string };
      if (override.valid === false) {
        log.info({ roomId, reason: override.reason }, 'Plugin hook rejected exit document');
        return err('PLUGIN_VALIDATION_FAILED', override.reason || 'Plugin rejected exit document');
      }
    }
  } catch (hookErr) {
    log.warn({ roomId, error: String(hookErr) }, 'Exit doc hook validation failed (proceeding with default)');
  }

  try {
    const db = getDb();
    const id = `exitdoc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const raidEntryIds: string[] = [];

    // Auto-create RAID decision entry linking exit doc to project log (#675)
    // Extract meaningful content from the exit document instead of generic templates
    if (buildingId && phase) {
      const raidId = `raid_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const docType = room.exitRequired?.type || 'generic';
      const roomType = room.type;

      // Build a meaningful summary from exit doc fields
      const docSummary = _extractExitDocSummary(document, docType, roomType);
      const docRationale = _extractExitDocRationale(document, docType);

      // Resolve agent name for rationale — use SELECT * to handle schema variations
      const agentRow = db.prepare('SELECT * FROM agents WHERE id = ?').get(agentId) as Record<string, unknown> | undefined;
      const agentName = (agentRow?.display_name as string) || (agentRow?.name as string) || 'Agent';

      db.prepare(`
        INSERT INTO raid_entries (id, building_id, type, phase, room_id, summary, rationale, decided_by, affected_areas)
        VALUES (?, ?, 'decision', ?, ?, ?, ?, ?, ?)
      `).run(
        raidId,
        buildingId,
        phase,
        roomId,
        docSummary,
        `${agentName}: ${docRationale}`,
        agentId,
        JSON.stringify([roomType]),
      );
      raidEntryIds.push(raidId);
      log.info({ raidId, exitDocId: id, roomId }, 'RAID entry auto-created for exit document');
    }

    db.prepare(`
      INSERT INTO exit_documents (id, room_id, type, completed_by, fields, artifacts, raid_entry_ids)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      roomId,
      room.exitRequired?.type || 'generic',
      agentId,
      JSON.stringify(document),
      JSON.stringify((document.artifacts as string[]) || []),
      JSON.stringify(raidEntryIds),
    );

    log.info({ id, roomId, agentId, raidEntryIds }, 'Exit document submitted');
    return ok({ id, roomId, raidEntryIds });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error({ roomId, agentId, err: msg }, 'Failed to submit exit document');
    return err('DB_ERROR', `Failed to submit exit document: ${msg}`);
  }
}

/**
 * Delegate a task from one room to another.
 * The agent exits the source room and enters the target room,
 * carrying context about what task to work on.
 */
export function delegateTask({
  fromRoomId, toRoomId, agentId, taskContext,
}: {
  fromRoomId: string;
  toRoomId: string;
  agentId: string;
  taskContext: Record<string, unknown>;
}): Result {
  const fromRoom = activeRooms.get(fromRoomId);
  const toRoom = activeRooms.get(toRoomId);

  if (!fromRoom) return err('ROOM_NOT_FOUND', `Source room ${fromRoomId} not found`);
  if (!toRoom) return err('ROOM_NOT_FOUND', `Target room ${toRoomId} not found`);

  // Exit source room
  const exitResult = exitRoom({ roomId: fromRoomId, agentId, reason: 'normal' });
  if (!exitResult.ok) return exitResult;

  // Enter target room
  const enterResult = enterRoom({ roomId: toRoomId, agentId });
  if (!enterResult.ok) return enterResult;

  // Emit delegation event
  if (moduleBus) {
    moduleBus.emit('room:task:delegated', {
      fromRoomId, toRoomId, agentId,
      fromRoomType: fromRoom.type,
      toRoomType: toRoom.type,
      taskContext,
    });
  }

  log.info({ fromRoomId, toRoomId, agentId }, 'Task delegated across rooms');
  return ok({ fromRoomId, toRoomId, agentId });
}

export function getRoom(roomId: string): BaseRoom | null {
  return activeRooms.get(roomId) || null;
}

/**
 * Hydrate all rooms from the database into active in-memory instances.
 *
 * This bridges the gap between "rooms as DB records" (created by
 * blueprint/custom plan) and "rooms as active BaseRoom objects" (needed
 * by room-manager for getRoom, enterRoom, tool scoping, etc.).
 *
 * Called:
 * - On server startup after room types are registered
 * - After applyBlueprint/applyCustomPlan to activate newly created rooms
 *
 * Rooms that are already active (in the activeRooms Map) are skipped.
 */
export function hydrateRoomsFromDb(): { activated: number; skipped: number; failed: number } {
  const db = getDb();
  const allRooms = db.prepare('SELECT * FROM rooms ORDER BY created_at').all() as RoomRow[];

  let activated = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of allRooms) {
    // Skip if already active
    if (activeRooms.has(row.id)) {
      skipped++;
      continue;
    }

    const Factory = roomTypeRegistry.get(row.type);
    if (!Factory) {
      log.warn({ roomId: row.id, type: row.type }, 'Cannot hydrate room — type not registered');
      failed++;
      continue;
    }

    try {
      let roomConfig: Record<string, unknown> = {};
      try {
        roomConfig = JSON.parse(row.config || '{}');
      } catch { /* use empty config */ }

      const room = new Factory(row.id, { ...Factory.contract, ...roomConfig });
      if (moduleBus) room.setBus(moduleBus);
      activeRooms.set(row.id, room);
      activated++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log.error({ roomId: row.id, type: row.type, err: msg }, 'Failed to hydrate room from DB');
      failed++;
    }
  }

  log.info({ total: allRooms.length, activated, skipped, failed }, 'Room hydration complete');
  return { activated, skipped, failed };
}

export function listRooms(): RoomRow[] {
  try {
    const db = getDb();
    return db.prepare('SELECT * FROM rooms ORDER BY created_at').all() as RoomRow[];
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error({ err: msg }, 'Failed to list rooms');
    return [];
  }
}

/**
 * Update a room's mutable properties.
 * Does NOT allow changing the room's type or floor — those are identity.
 */
export function updateRoom(
  roomId: string,
  updates: {
    name?: string;
    config?: Record<string, unknown>;
    allowedTools?: string[];
    fileScope?: string;
    exitTemplate?: Record<string, unknown>;
    provider?: string;
  },
): Result {
  const db = getDb();
  const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(roomId) as RoomRow | undefined;
  if (!room) return err('ROOM_NOT_FOUND', `Room ${roomId} does not exist`);

  const fields: string[] = [];
  const values: unknown[] = [];

  if (updates.name !== undefined) {
    fields.push('name = ?');
    values.push(updates.name);
  }
  if (updates.config !== undefined) {
    fields.push('config = ?');
    values.push(JSON.stringify(updates.config));
  }
  if (updates.allowedTools !== undefined) {
    fields.push('allowed_tools = ?');
    values.push(JSON.stringify(updates.allowedTools));
  }
  if (updates.fileScope !== undefined) {
    fields.push('file_scope = ?');
    values.push(updates.fileScope);
  }
  if (updates.exitTemplate !== undefined) {
    fields.push('exit_template = ?');
    values.push(JSON.stringify(updates.exitTemplate));
  }
  if (updates.provider !== undefined) {
    fields.push('provider = ?');
    values.push(updates.provider);
  }

  if (fields.length === 0) {
    return ok({ roomId, message: 'No fields to update' });
  }

  values.push(roomId);
  db.prepare(`UPDATE rooms SET ${fields.join(', ')} WHERE id = ?`).run(...values);

  log.info({ roomId, updates: Object.keys(updates) }, 'Room updated');
  return ok({ roomId });
}

/**
 * Delete a room after exiting all seated agents and destroying the active instance.
 * Also removes all tables associated with this room.
 */
export function deleteRoom(roomId: string): Result {
  const db = getDb();
  const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(roomId) as RoomRow | undefined;
  if (!room) return err('ROOM_NOT_FOUND', `Room ${roomId} does not exist`);

  try {
    // 1. Exit all agents currently seated in this room
    const seatedAgents = db.prepare(
      'SELECT id FROM agents WHERE current_room_id = ?',
    ).all(roomId) as Array<{ id: string }>;

    for (const agent of seatedAgents) {
      db.prepare(
        'UPDATE agents SET current_room_id = NULL, current_table_id = NULL, status = ? WHERE id = ?',
      ).run('idle', agent.id);
      log.info({ agentId: agent.id, roomId }, 'Agent force-exited for room deletion');
    }

    // 2. Delete all tables in this room
    db.prepare('DELETE FROM tables_v2 WHERE room_id = ?').run(roomId);

    // 3. Remove from active rooms map
    activeRooms.delete(roomId);

    // 4. Delete the room row
    db.prepare('DELETE FROM rooms WHERE id = ?').run(roomId);

    log.info({ roomId, agentsExited: seatedAgents.length }, 'Room deleted');
    return ok({ roomId, agentsExited: seatedAgents.length });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error({ roomId, err: msg }, 'Failed to delete room');
    return err('DB_ERROR', `Failed to delete room: ${msg}`);
  }
}

/**
 * Update a table's mutable properties (type, chairs, description).
 */
export function updateTable(
  tableId: string,
  updates: { type?: string; chairs?: number; description?: string },
): Result {
  const db = getDb();
  const table = db.prepare('SELECT * FROM tables_v2 WHERE id = ?').get(tableId) as Record<string, unknown> | undefined;
  if (!table) return err('TABLE_NOT_FOUND', `Table ${tableId} does not exist`);

  const fields: string[] = [];
  const values: unknown[] = [];

  if (updates.type !== undefined) {
    fields.push('type = ?');
    values.push(updates.type);
  }
  if (updates.chairs !== undefined) {
    fields.push('chairs = ?');
    values.push(updates.chairs);
  }
  if (updates.description !== undefined) {
    fields.push('description = ?');
    values.push(updates.description);
  }

  if (fields.length === 0) {
    return ok({ tableId, message: 'No fields to update' });
  }

  values.push(tableId);
  db.prepare(`UPDATE tables_v2 SET ${fields.join(', ')} WHERE id = ?`).run(...values);

  log.info({ tableId, updates: Object.keys(updates) }, 'Table updated');
  return ok({ tableId });
}

/**
 * Delete a table after unseating all agents currently at it.
 */
export function deleteTable(tableId: string): Result {
  const db = getDb();
  const table = db.prepare('SELECT * FROM tables_v2 WHERE id = ?').get(tableId) as Record<string, unknown> | undefined;
  if (!table) return err('TABLE_NOT_FOUND', `Table ${tableId} does not exist`);

  try {
    // 1. Unseat all agents currently at this table
    const seatedAgents = db.prepare(
      'SELECT id FROM agents WHERE current_table_id = ?',
    ).all(tableId) as Array<{ id: string }>;

    for (const agent of seatedAgents) {
      db.prepare(
        'UPDATE agents SET current_table_id = NULL WHERE id = ?',
      ).run(agent.id);
      log.info({ agentId: agent.id, tableId }, 'Agent unseated for table deletion');
    }

    // 2. Delete the table row
    db.prepare('DELETE FROM tables_v2 WHERE id = ?').run(tableId);

    log.info({ tableId, roomId: table.room_id, agentsUnseated: seatedAgents.length }, 'Table deleted');
    return ok({ tableId, agentsUnseated: seatedAgents.length });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error({ tableId, err: msg }, 'Failed to delete table');
    return err('DB_ERROR', `Failed to delete table: ${msg}`);
  }
}
