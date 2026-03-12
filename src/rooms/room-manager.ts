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
  return { createRoom, enterRoom, exitRoom, getRoom, listRooms, registerRoomType };
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
    // Check agent has badge access to this room type
    const db = getDb();
    const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(agentId) as AgentRow | undefined;
    if (!agent) {
      return err('AGENT_NOT_FOUND', `Agent ${agentId} does not exist`);
    }

    const roomAccess = JSON.parse(agent.room_access || '[]') as string[];
    if (!roomAccess.includes(room.type) && !roomAccess.includes('*')) {
      return err('ACCESS_DENIED', `Agent ${agent.name} does not have access to ${room.type} rooms`);
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
