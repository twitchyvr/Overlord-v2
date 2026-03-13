/**
 * Scope Change Protocol
 *
 * When an agent detects scope creep or a breaking change requirement,
 * this module orchestrates the re-entry flow:
 *
 *   1. detectScopeChange() — creates RAID issue entry
 *   2. initiateReEntry() — builds context brief + creates target room
 *   3. handleEscalation() — bus event handler for room:escalation:suggested
 *
 * The scope change protocol is how the building "goes back a phase"
 * without losing work. RAID context travels with the agent.
 */

import { getDb } from '../storage/db.js';
import { logger } from '../core/logger.js';
import { ok, err } from '../core/contracts.js';
import type { Result, BuildingRow } from '../core/contracts.js';
import { addRaidEntry, buildContextBrief } from './raid-log.js';
import { createRoom, enterRoom, getRoom } from './room-manager.js';
import type { Bus } from '../core/bus.js';

const log = logger.child({ module: 'scope-change' });

/** Map room types to their floor types for auto-floor lookup */
const ROOM_FLOOR_MAP: Record<string, string> = {
  strategist: 'strategy',
  'building-architect': 'strategy',
  discovery: 'collaboration',
  architecture: 'collaboration',
  'code-lab': 'execution',
  'testing-lab': 'execution',
  review: 'governance',
  deploy: 'operations',
  'war-room': 'collaboration',
};

// ─── Detection ───

interface DetectScopeChangeParams {
  buildingId: string;
  description: string;
  affectedAreas: string[];
  detectedBy: string;
  currentPhase: string;
  currentRoomId?: string;
}

/**
 * Record a scope change detection.
 * Creates a RAID issue entry with full context for traceability.
 * Returns the RAID entry ID for linking to re-entry.
 */
export function detectScopeChange({
  buildingId,
  description,
  affectedAreas,
  detectedBy,
  currentPhase,
  currentRoomId,
}: DetectScopeChangeParams): Result {
  const db = getDb();

  // Verify building exists
  const building = db.prepare('SELECT id FROM buildings WHERE id = ?').get(buildingId) as { id: string } | undefined;
  if (!building) return err('BUILDING_NOT_FOUND', `Building ${buildingId} does not exist`);

  // Create RAID issue entry
  const raidResult = addRaidEntry({
    buildingId,
    type: 'issue',
    phase: currentPhase,
    roomId: currentRoomId,
    summary: `Scope change: ${description}`,
    rationale: `Detected during ${currentPhase} phase. Affected areas: ${affectedAreas.join(', ')}`,
    decidedBy: detectedBy,
    affectedAreas,
  });

  if (!raidResult.ok) return raidResult;

  const raidData = raidResult.data as { id: string };
  log.info(
    { buildingId, raidId: raidData.id, description, affectedAreas },
    'Scope change detected',
  );

  return ok({
    raidId: raidData.id,
    buildingId,
    description,
    affectedAreas,
    currentPhase,
  });
}

// ─── Re-Entry ───

interface InitiateReEntryParams {
  buildingId: string;
  targetRoomType: string;
  agentId: string;
  scopeChangeId: string;
  tableType?: string;
}

/**
 * Initiate re-entry to a prior phase room with RAID context.
 *
 * Flow:
 *   1. Build context brief from RAID log
 *   2. Find the appropriate floor for the target room type
 *   3. Create a new room instance on that floor
 *   4. Enter the agent into the room
 *   5. Return room + context brief for the agent to work with
 */
export function initiateReEntry({
  buildingId,
  targetRoomType,
  agentId,
  scopeChangeId,
  tableType,
}: InitiateReEntryParams): Result {
  const db = getDb();

  // Verify building exists
  const building = db.prepare('SELECT * FROM buildings WHERE id = ?').get(buildingId) as BuildingRow | undefined;
  if (!building) return err('BUILDING_NOT_FOUND', `Building ${buildingId} does not exist`);

  // Build context brief from RAID log
  const briefResult = buildContextBrief(buildingId);
  if (!briefResult.ok) return briefResult;

  // Resolve floor for the target room type
  const floorType = ROOM_FLOOR_MAP[targetRoomType];
  if (!floorType) return err('UNKNOWN_ROOM_TYPE', `No floor mapping for room type "${targetRoomType}"`);

  const floor = db.prepare(
    'SELECT id FROM floors WHERE building_id = ? AND type = ?',
  ).get(buildingId, floorType) as { id: string } | undefined;

  if (!floor) {
    return err('FLOOR_NOT_FOUND', `No ${floorType} floor exists in building ${buildingId}`);
  }

  // Create a new room for re-entry
  const roomResult = createRoom({
    type: targetRoomType,
    floorId: floor.id,
    name: `Scope Re-entry: ${targetRoomType}`,
    config: { scopeChangeId },
  });

  if (!roomResult.ok) return roomResult;

  const roomData = roomResult.data as { id: string };

  // Determine table type — use first table if not specified
  const room = getRoom(roomData.id);
  if (!room) {
    return err('ROOM_NOT_FOUND', `Room ${roomData.id} was created but could not be retrieved`);
  }
  const resolvedTableType = tableType || Object.keys(room.tables)[0] || 'focus';

  // Enter agent into the new room
  const enterResult = enterRoom({
    roomId: roomData.id,
    agentId,
    tableType: resolvedTableType,
  });

  if (!enterResult.ok) return enterResult;

  const enterData = enterResult.data as { tools: string[]; fileScope: string };

  log.info(
    { buildingId, targetRoomType, agentId, roomId: roomData.id, scopeChangeId },
    'Scope change re-entry initiated',
  );

  return ok({
    roomId: roomData.id,
    floorId: floor.id,
    agentId,
    scopeChangeId,
    tableType: resolvedTableType,
    contextBrief: briefResult.data,
    tools: enterData.tools,
    fileScope: enterData.fileScope,
  });
}

// ─── Escalation Handler ───

/**
 * Wire scope change escalation into the bus.
 * Listens for room:escalation:suggested events with onScopeChange condition.
 *
 * When a room emits an escalation suggestion with condition 'onScopeChange',
 * this handler auto-detects the scope change and initiates re-entry.
 */
export function initScopeChangeHandler(bus: Bus): void {
  // ── onError escalations → War Room ──
  bus.on('room:escalation:suggested', (data: Record<string, unknown>) => {
    const condition = data.condition as string;
    if (condition === 'onError') {
      handleErrorEscalation(bus, data);
      return;
    }
    if (condition !== 'onScopeChange') return;

    const roomId = data.roomId as string;
    const agentId = data.agentId as string;
    const targetRoom = data.targetRoom as string;
    const reason = data.reason as string || 'Scope change detected';

    // Look up the room's building context
    const db = getDb();
    const roomRow = db.prepare('SELECT floor_id FROM rooms WHERE id = ?').get(roomId) as { floor_id: string } | undefined;
    if (!roomRow) return;

    const floor = db.prepare('SELECT building_id FROM floors WHERE id = ?').get(roomRow.floor_id) as { building_id: string } | undefined;
    if (!floor) return;

    const building = db.prepare('SELECT * FROM buildings WHERE id = ?').get(floor.building_id) as BuildingRow | undefined;
    if (!building) return;

    // Detect and record
    const detectResult = detectScopeChange({
      buildingId: building.id,
      description: reason,
      affectedAreas: [targetRoom],
      detectedBy: agentId,
      currentPhase: building.active_phase,
      currentRoomId: roomId,
    });

    if (!detectResult.ok) {
      log.error({ error: detectResult.error }, 'Failed to detect scope change');
      return;
    }

    const detectData = detectResult.data as { raidId: string };

    // Emit event for upstream consumers (UI, orchestrator)
    bus.emit('scope-change:detected', {
      buildingId: building.id,
      scopeChangeId: detectData.raidId,
      targetRoomType: targetRoom,
      agentId,
      reason,
    });

    log.info(
      { buildingId: building.id, targetRoom, agentId, scopeChangeId: detectData.raidId },
      'Scope change escalation handled',
    );
  });

  log.info('Scope change & error escalation handler initialized');
}

// ─── Error Escalation → War Room ───

/**
 * Handle onError escalations by creating/activating a War Room.
 *
 * Flow:
 *   1. Resolve building from the source room
 *   2. Check if a War Room already exists on the collaboration floor
 *   3. If not, create one
 *   4. Record a RAID issue entry for the incident
 *   5. Enter the triggering agent into the War Room
 *   6. Emit escalation:war-room event for the UI
 */
function handleErrorEscalation(bus: Bus, data: Record<string, unknown>): void {
  const roomId = data.roomId as string;
  const roomType = data.roomType as string;
  const agentId = data.agentId as string;
  const targetRoom = (data.targetRoom as string) || 'war-room';
  const reason = (data.reason as string) || 'Error detected';

  if (targetRoom !== 'war-room') {
    // Non-war-room error escalation — log and skip
    log.debug({ roomId, targetRoom, reason }, 'Non-war-room error escalation — skipping auto-routing');
    return;
  }

  const db = getDb();

  // Resolve building context
  const roomRow = db.prepare('SELECT floor_id FROM rooms WHERE id = ?').get(roomId) as { floor_id: string } | undefined;
  if (!roomRow) {
    log.warn({ roomId }, 'Error escalation: source room not found in DB');
    return;
  }

  const floor = db.prepare('SELECT building_id FROM floors WHERE id = ?').get(roomRow.floor_id) as { building_id: string } | undefined;
  if (!floor) {
    log.warn({ roomId, floorId: roomRow.floor_id }, 'Error escalation: floor not found');
    return;
  }

  const buildingId = floor.building_id;

  // Find collaboration floor for War Room
  const collabFloor = db.prepare(
    'SELECT id FROM floors WHERE building_id = ? AND type = ?',
  ).get(buildingId, 'collaboration') as { id: string } | undefined;

  if (!collabFloor) {
    log.error({ buildingId }, 'Error escalation: no collaboration floor found — cannot create War Room');
    bus.emit('escalation:failed', {
      buildingId,
      reason: 'No collaboration floor available for War Room',
      sourceRoomId: roomId,
      sourceRoomType: roomType,
    });
    return;
  }

  // Check if a War Room already exists on this floor
  let warRoomId: string;
  const existingWarRoom = db.prepare(
    'SELECT id FROM rooms WHERE floor_id = ? AND type = ?',
  ).get(collabFloor.id, 'war-room') as { id: string } | undefined;

  if (existingWarRoom) {
    warRoomId = existingWarRoom.id;
    // Make sure it's an active room instance
    const active = getRoom(warRoomId);
    if (!active) {
      const createResult = createRoom({
        type: 'war-room',
        floorId: collabFloor.id,
        name: 'War Room',
      });
      if (createResult.ok) {
        warRoomId = (createResult.data as { id: string }).id;
      } else {
        log.error({ error: createResult.error }, 'Failed to re-activate War Room');
        return;
      }
    }
    log.info({ warRoomId }, 'Reusing existing War Room');
  } else {
    // Create new War Room
    const createResult = createRoom({
      type: 'war-room',
      floorId: collabFloor.id,
      name: 'War Room',
    });
    if (!createResult.ok) {
      log.error({ error: createResult.error }, 'Failed to create War Room');
      return;
    }
    warRoomId = (createResult.data as { id: string }).id;
    log.info({ warRoomId, buildingId }, 'War Room created for error escalation');
  }

  // Record RAID issue
  const building = db.prepare('SELECT active_phase FROM buildings WHERE id = ?').get(buildingId) as { active_phase: string } | undefined;
  addRaidEntry({
    buildingId,
    type: 'issue',
    phase: building?.active_phase || 'unknown',
    roomId,
    summary: `Error escalation from ${roomType}: ${reason}`,
    rationale: `Auto-escalated to War Room. Source room: ${roomId} (${roomType}).`,
    decidedBy: 'system',
    affectedAreas: [roomType],
  });

  // Enter agent into War Room
  const enterResult = enterRoom({
    roomId: warRoomId,
    agentId,
    tableType: 'boardroom',
  });

  if (!enterResult.ok) {
    log.warn(
      { warRoomId, agentId, error: enterResult.error },
      'Agent could not enter War Room — room ready but agent not seated',
    );
  }

  // Emit event for UI and other consumers
  bus.emit('escalation:war-room', {
    buildingId,
    warRoomId,
    agentId,
    sourceRoomId: roomId,
    sourceRoomType: roomType,
    reason,
  });

  log.info(
    { buildingId, warRoomId, agentId, sourceRoom: roomType, reason },
    'Error escalation routed to War Room',
  );
}
