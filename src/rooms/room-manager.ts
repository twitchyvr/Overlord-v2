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
export function enterRoom({ roomId, agentId, tableType = 'focus' }: EnterRoomParams): Result {
  const room = activeRooms.get(roomId);
  if (!room) {
    return err('ROOM_NOT_FOUND', `Room ${roomId} does not exist`);
  }

  // Validate table type exists in room's contract
  const tableConfig = room.tables[tableType];
  if (!tableConfig) {
    const validTables = Object.keys(room.tables);
    return err(
      'INVALID_TABLE_TYPE',
      `Table type "${tableType}" does not exist in ${room.type} room. Valid tables: ${validTables.join(', ')}`,
      { context: { validTables, requestedTable: tableType } },
    );
  }

  try {
    // Check agent has badge/access to this room type
    const db = getDb();
    const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(agentId) as AgentRow | undefined;
    if (!agent) {
      return err('AGENT_NOT_FOUND', `Agent ${agentId} does not exist`);
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

    // Find or create the table row for this room+type
    let tableRow = db
      .prepare('SELECT id FROM tables_v2 WHERE room_id = ? AND type = ?')
      .get(roomId, tableType) as { id: string } | undefined;

    if (!tableRow) {
      const tableId = `table_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      db.prepare('INSERT INTO tables_v2 (id, room_id, type, chairs, description) VALUES (?, ?, ?, ?, ?)').run(
        tableId,
        roomId,
        tableType,
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
      return err(
        'TABLE_FULL',
        `Table "${tableType}" in ${room.type} room is full (${tableConfig.chairs} chair${tableConfig.chairs === 1 ? '' : 's'})`,
        { context: { tableType, maxChairs: tableConfig.chairs, currentOccupancy: seatedCount.cnt } },
      );
    }

    // Update agent's current room and table
    db.prepare('UPDATE agents SET current_room_id = ?, current_table_id = ?, status = ? WHERE id = ?').run(
      roomId,
      tableRow.id,
      'active',
      agentId,
    );

    // Fire lifecycle hook — room can track agent, emit bus events, run setup logic
    const enterResult = room.onAgentEnter(agentId, tableType);
    if (!enterResult.ok) {
      // Roll back DB change if room rejects entry
      db.prepare('UPDATE agents SET current_room_id = NULL, current_table_id = NULL, status = ? WHERE id = ?').run(
        'idle',
        agentId,
      );
      return enterResult;
    }

    log.info({ roomId, agentId, tableType, tableId: tableRow.id }, 'Agent entered room');
    return ok({ roomId, agentId, tableId: tableRow.id, tools: room.getAllowedTools(), fileScope: room.fileScope });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error({ roomId, agentId, tableType, err: msg }, 'Failed to enter room');
    return err('DB_ERROR', `Failed to enter room: ${msg}`);
  }
}

interface ExitRoomParams {
  roomId: string;
  agentId: string;
}

/**
 * Agent exits a room — requires exit document if room mandates it.
 * If the room has required exit fields, the agent MUST have submitted
 * an exit document before they can leave. Structural enforcement.
 */
export function exitRoom({ roomId, agentId }: ExitRoomParams): Result {
  const room = activeRooms.get(roomId);
  if (!room) return err('ROOM_NOT_FOUND', `Room ${roomId} does not exist`);

  try {
    // Enforce exit document requirement
    const exitReq = room.exitRequired;
    if (exitReq && exitReq.fields.length > 0) {
      const db = getDb();
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

    const db = getDb();
    db.prepare('UPDATE agents SET current_room_id = NULL, current_table_id = NULL, status = ? WHERE id = ?').run(
      'idle',
      agentId,
    );

    log.info({ roomId, agentId }, 'Agent exited room');
    return ok({ roomId, agentId });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error({ roomId, agentId, err: msg }, 'Failed to exit room');
    return err('DB_ERROR', `Failed to exit room: ${msg}`);
  }
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
export function submitExitDocument({ roomId, agentId, document, buildingId, phase }: SubmitExitDocParams): Result {
  const room = activeRooms.get(roomId);
  if (!room) return err('ROOM_NOT_FOUND', `Room ${roomId} does not exist`);

  const validation = room.validateExitDocument(document);
  if (!validation.ok) return validation;

  try {
    const db = getDb();
    const id = `exitdoc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const raidEntryIds: string[] = [];

    // Auto-create RAID decision entry linking exit doc to project log
    if (buildingId && phase) {
      const raidId = `raid_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      db.prepare(`
        INSERT INTO raid_entries (id, building_id, type, phase, room_id, summary, rationale, decided_by, affected_areas)
        VALUES (?, ?, 'decision', ?, ?, ?, ?, ?, ?)
      `).run(
        raidId,
        buildingId,
        phase,
        roomId,
        `Exit document submitted: ${room.exitRequired?.type || 'generic'}`,
        `Agent ${agentId} completed ${room.type} room work`,
        agentId,
        JSON.stringify([room.type]),
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
