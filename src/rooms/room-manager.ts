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

const log = logger.child({ module: 'room-manager' });

/** @type {Map<string, import('./room-types/base-room.js').BaseRoom>} */
const activeRooms = new Map();

/** @type {Map<string, Function>} */
const roomTypeRegistry = new Map();

export function initRooms({ bus, agents, tools, ai }) {
  // Register built-in room types
  // Each room type is loaded from room-types/ directory
  bus.on('room:create', (data) => createRoom(data));
  bus.on('room:enter', (data) => enterRoom(data));
  bus.on('room:exit', (data) => exitRoom(data));
  bus.on('room:submit-exit-doc', (data) => submitExitDocument(data));

  log.info('Room manager initialized');
  return { createRoom, enterRoom, exitRoom, getRoom, listRooms, registerRoomType };
}

/**
 * Register a room type (built-in or plugin)
 * @param {string} type - Room type identifier (e.g., 'code-lab', 'testing-lab')
 * @param {Function} factory - Room class or factory function
 */
export function registerRoomType(type, factory) {
  roomTypeRegistry.set(type, factory);
  log.info({ type }, 'Room type registered');
}

/**
 * Create a new room instance
 * @param {object} params
 * @param {string} params.type - Room type
 * @param {string} params.floorId - Floor this room belongs to
 * @param {string} params.name - Display name
 * @param {object} [params.config] - Room-specific config overrides
 */
export function createRoom({ type, floorId, name, config: roomConfig = {} }) {
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
    JSON.stringify(roomConfig)
  );

  const room = new Factory(id, { ...contract, ...roomConfig });
  activeRooms.set(id, room);

  log.info({ id, type, name, floor: floorId }, 'Room created');
  return ok({ id, type, name });
}

/**
 * Agent enters a room — room's tools merge into agent's context
 * @param {object} params
 * @param {string} params.roomId
 * @param {string} params.agentId
 * @param {string} [params.tableType='focus'] - Table mode to sit at
 */
export function enterRoom({ roomId, agentId, tableType = 'focus' }) {
  const room = activeRooms.get(roomId);
  if (!room) {
    return err('ROOM_NOT_FOUND', `Room ${roomId} does not exist`);
  }

  // Check agent has badge access to this room type
  const db = getDb();
  const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(agentId);
  if (!agent) {
    return err('AGENT_NOT_FOUND', `Agent ${agentId} does not exist`);
  }

  const roomAccess = JSON.parse(agent.room_access || '[]');
  if (!roomAccess.includes(room.type) && !roomAccess.includes('*')) {
    return err('ACCESS_DENIED', `Agent ${agent.name} does not have access to ${room.type} rooms`);
  }

  // Update agent's current room
  db.prepare('UPDATE agents SET current_room_id = ?, status = ? WHERE id = ?').run(
    roomId,
    'active',
    agentId
  );

  log.info({ roomId, agentId, tableType }, 'Agent entered room');
  return ok({ roomId, agentId, tools: room.getAllowedTools(), fileScope: room.fileScope });
}

/**
 * Agent exits a room — requires exit document if room mandates it
 */
export function exitRoom({ roomId, agentId }) {
  const room = activeRooms.get(roomId);
  if (!room) return err('ROOM_NOT_FOUND', `Room ${roomId} does not exist`);

  const db = getDb();
  db.prepare('UPDATE agents SET current_room_id = NULL, status = ? WHERE id = ?').run(
    'idle',
    agentId
  );

  log.info({ roomId, agentId }, 'Agent exited room');
  return ok({ roomId, agentId });
}

/**
 * Submit a structured exit document for a room
 */
export function submitExitDocument({ roomId, agentId, document }) {
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
    JSON.stringify(document.artifacts || [])
  );

  log.info({ id, roomId, agentId }, 'Exit document submitted');
  return ok({ id, roomId });
}

export function getRoom(roomId) {
  return activeRooms.get(roomId) || null;
}

export function listRooms() {
  const db = getDb();
  return db.prepare('SELECT * FROM rooms ORDER BY created_at').all();
}
