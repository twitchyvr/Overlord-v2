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

interface InitRoomsParams {
  bus: Bus;
  agents: AgentRegistryAPI;
  tools: ToolRegistryAPI;
  ai: AIProviderAPI;
}

export function initRooms({ bus }: InitRoomsParams): RoomManagerAPI {
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
  activeRooms.set(id, room);

  log.info({ id, type, name, floor: floorId }, 'Room created');
  return ok({ id, type, name });
}

interface EnterRoomParams {
  roomId: string;
  agentId: string;
  tableType?: string;
}

/**
 * Agent enters a room — room's tools merge into agent's context
 */
export function enterRoom({ roomId, agentId, tableType = 'focus' }: EnterRoomParams): Result {
  const room = activeRooms.get(roomId);
  if (!room) {
    return err('ROOM_NOT_FOUND', `Room ${roomId} does not exist`);
  }

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

  // Update agent's current room
  db.prepare('UPDATE agents SET current_room_id = ?, status = ? WHERE id = ?').run(
    roomId,
    'active',
    agentId,
  );

  log.info({ roomId, agentId, tableType }, 'Agent entered room');
  return ok({ roomId, agentId, tools: room.getAllowedTools(), fileScope: room.fileScope });
}

interface ExitRoomParams {
  roomId: string;
  agentId: string;
}

/**
 * Agent exits a room — requires exit document if room mandates it
 */
export function exitRoom({ roomId, agentId }: ExitRoomParams): Result {
  const room = activeRooms.get(roomId);
  if (!room) return err('ROOM_NOT_FOUND', `Room ${roomId} does not exist`);

  const db = getDb();
  db.prepare('UPDATE agents SET current_room_id = NULL, status = ? WHERE id = ?').run(
    'idle',
    agentId,
  );

  log.info({ roomId, agentId }, 'Agent exited room');
  return ok({ roomId, agentId });
}

interface SubmitExitDocParams {
  roomId: string;
  agentId: string;
  document: Record<string, unknown>;
}

/**
 * Submit a structured exit document for a room
 */
export function submitExitDocument({ roomId, agentId, document }: SubmitExitDocParams): Result {
  const room = activeRooms.get(roomId);
  if (!room) return err('ROOM_NOT_FOUND', `Room ${roomId} does not exist`);

  const validation = room.validateExitDocument(document);
  if (!validation.ok) return validation;

  const db = getDb();
  const id = `exitdoc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  db.prepare(`
    INSERT INTO exit_documents (id, room_id, type, completed_by, fields, artifacts)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    id,
    roomId,
    room.exitRequired?.type || 'generic',
    agentId,
    JSON.stringify(document),
    JSON.stringify((document.artifacts as string[]) || []),
  );

  log.info({ id, roomId, agentId }, 'Exit document submitted');
  return ok({ id, roomId });
}

export function getRoom(roomId: string): BaseRoom | null {
  return activeRooms.get(roomId) || null;
}

export function listRooms(): RoomRow[] {
  const db = getDb();
  return db.prepare('SELECT * FROM rooms ORDER BY created_at').all() as RoomRow[];
}
