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

  log.info(
    { buildingId, raidId: raidResult.data.id, description, affectedAreas },
    'Scope change detected',
  );

  return ok({
    raidId: raidResult.data.id,
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

  // Determine table type — use first table if not specified
  const room = getRoom(roomResult.data.id);
  const resolvedTableType = tableType || (room ? Object.keys(room.tables)[0] : 'focus');

  // Enter agent into the new room
  const enterResult = enterRoom({
    roomId: roomResult.data.id,
    agentId,
    tableType: resolvedTableType,
  });

  if (!enterResult.ok) return enterResult;

  log.info(
    { buildingId, targetRoomType, agentId, roomId: roomResult.data.id, scopeChangeId },
    'Scope change re-entry initiated',
  );

  return ok({
    roomId: roomResult.data.id,
    floorId: floor.id,
    agentId,
    scopeChangeId,
    tableType: resolvedTableType,
    contextBrief: briefResult.data,
    tools: enterResult.data.tools,
    fileScope: enterResult.data.fileScope,
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
  bus.on('room:escalation:suggested', (data: Record<string, unknown>) => {
    const condition = data.condition as string;
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

    // Emit event for upstream consumers (UI, orchestrator)
    bus.emit('scope-change:detected', {
      buildingId: building.id,
      scopeChangeId: detectResult.data.raidId,
      targetRoomType: targetRoom,
      agentId,
      reason,
    });

    log.info(
      { buildingId: building.id, targetRoom, agentId, scopeChangeId: detectResult.data.raidId },
      'Scope change escalation handled',
    );
  });

  log.info('Scope change handler initialized');
}
