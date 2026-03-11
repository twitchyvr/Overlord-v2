/**
 * Phase Zero — Strategist → Discovery Transition
 *
 * Orchestrates the Phase Zero flow:
 *   1. Strategist submits building-blueprint exit document
 *   2. Blueprint is applied to the building (floors, rooms, agents)
 *   3. Phase gate is created and auto-signed for strategy phase
 *   4. First Discovery room is created on the collaboration floor
 *   5. Bus event emitted for UI/orchestrator to pick up
 *
 * This handler bridges the Strategist exit document to the actual
 * building configuration, turning a plan into structure.
 */

import { getDb } from '../storage/db.js';
import { logger } from '../core/logger.js';
import { ok, err } from '../core/contracts.js';
import type { Result, BuildingRow } from '../core/contracts.js';
import type { Bus } from '../core/bus.js';
import { applyBlueprint, applyCustomPlan, getFloorByType } from './building-manager.js';
import { createGate, signoffGate } from './phase-gate.js';

const log = logger.child({ module: 'phase-zero' });

/**
 * Handle building-blueprint exit document submission.
 *
 * Called when a Strategist room submits an exit doc. Applies the blueprint
 * to the building, creates a strategy phase gate with GO verdict, and
 * emits a transition event so the system can create the first Discovery room.
 */
export function handleBlueprintSubmission({
  buildingId,
  blueprint,
  agentId,
}: {
  buildingId: string;
  blueprint: Record<string, unknown>;
  agentId: string;
}): Result {
  const db = getDb();

  // Verify building exists
  const building = db.prepare('SELECT * FROM buildings WHERE id = ?').get(buildingId) as BuildingRow | undefined;
  if (!building) return err('BUILDING_NOT_FOUND', `Building ${buildingId} does not exist`);

  // Determine if this is a Quick Start blueprint or a custom plan
  const mode = blueprint.mode as string || 'quickStart';

  let applyResult: Result;
  if (mode === 'advanced') {
    // Custom plan from Building Architect
    applyResult = applyCustomPlan(buildingId, {
      floors: blueprint.floors as Array<{ type: string; name: string }> || [],
      roomAssignments: blueprint.roomAssignments as Array<{ floor: string; roomType: string; roomName: string; config?: Record<string, unknown> }> || [],
      agentDefinitions: blueprint.agentDefinitions as Array<{ name: string; role: string; capabilities?: string[]; roomAccess?: string[] }> || [],
    });
  } else {
    // Quick Start or standard blueprint from Strategist
    applyResult = applyBlueprint(buildingId, {
      floorsNeeded: blueprint.floorsNeeded as string[] || [],
      roomConfig: blueprint.roomConfig as Array<{ floor: string; rooms: string[] }> || [],
      agentRoster: blueprint.agentRoster as Array<{ name: string; role: string; rooms: string[] }> || [],
    });
  }

  if (!applyResult.ok) {
    log.error({ buildingId, error: applyResult.error }, 'Failed to apply blueprint');
    return applyResult;
  }

  const applyData = applyResult.data as Record<string, unknown>;

  // Create and auto-sign strategy phase gate
  const gateResult = createGate({ buildingId, phase: 'strategy' });
  if (!gateResult.ok) {
    log.error({ buildingId, error: gateResult.error }, 'Failed to create strategy gate');
    return err('GATE_CREATION_FAILED', `Strategy gate creation failed: ${gateResult.error.message}`);
  }

  const gateData = gateResult.data as { id: string };
  const signoff = signoffGate({
    gateId: gateData.id,
    reviewer: agentId,
    verdict: 'GO',
    nextPhaseInput: {
      projectGoals: blueprint.projectGoals,
      successCriteria: blueprint.successCriteria,
      estimatedPhases: blueprint.estimatedPhases,
    },
  });

  if (!signoff.ok) {
    log.error({ error: signoff.error }, 'Failed to sign off strategy gate');
    return err('GATE_SIGNOFF_FAILED', `Strategy gate signoff failed: ${signoff.error.message}`);
  }

  log.info(
    { buildingId, mode, ...applyData },
    'Phase Zero complete — blueprint applied, strategy gate signed',
  );

  return ok({
    buildingId,
    mode,
    blueprintApplied: applyData,
    phaseAdvanced: true,
    nextPhase: 'discovery',
  });
}

/**
 * Wire Phase Zero handlers into the bus.
 *
 * Listens for:
 * - exit-doc:submitted with room type 'strategist' or 'building-architect'
 *   → applies blueprint and emits phase-zero:complete
 *
 * The bus event flow:
 *   room-manager submits exit doc → bus emits exit-doc:submitted →
 *   this handler applies blueprint → emits phase-zero:complete →
 *   orchestrator creates Discovery room
 */
export function initPhaseZeroHandler(bus: Bus): void {
  bus.on('exit-doc:submitted', (data: Record<string, unknown>) => {
    const roomType = data.roomType as string;
    if (roomType !== 'strategist' && roomType !== 'building-architect') return;

    const buildingId = data.buildingId as string;
    const blueprint = data.document as Record<string, unknown>;
    const agentId = data.agentId as string;

    if (!buildingId || !blueprint) {
      log.warn({ data }, 'Phase Zero handler received incomplete event');
      return;
    }

    const result = handleBlueprintSubmission({ buildingId, blueprint, agentId });

    if (result.ok) {
      const resultData = result.data as Record<string, unknown>;
      bus.emit('phase-zero:complete', {
        buildingId,
        mode: resultData.mode,
        blueprintApplied: resultData.blueprintApplied,
        nextPhase: 'discovery',
        agentId,
      });
    } else {
      bus.emit('phase-zero:failed', {
        buildingId,
        error: result.error,
        agentId,
      });
    }
  });

  log.info('Phase Zero handler initialized');
}

/**
 * Suggest next action after Phase Zero completes.
 *
 * Returns the recommended next room type and floor for the first
 * Discovery room, along with which agents should enter.
 */
export function suggestNextRoom(buildingId: string): Result {
  const db = getDb();

  const building = db.prepare('SELECT * FROM buildings WHERE id = ?').get(buildingId) as BuildingRow | undefined;
  if (!building) return err('BUILDING_NOT_FOUND', `Building ${buildingId} does not exist`);

  // Look for a collaboration floor
  const floorResult = getFloorByType(buildingId, 'collaboration');
  if (!floorResult.ok) {
    return err('NO_COLLABORATION_FLOOR', 'Building has no collaboration floor for Discovery room');
  }

  // Get all agents and filter by discovery room access
  const agents = db.prepare(
    'SELECT id, name, role, room_access FROM agents',
  ).all() as Array<{ id: string; name: string; role: string; room_access: string }>;

  const eligibleAgents = agents.filter((a) => {
    const access = JSON.parse(a.room_access || '[]') as string[];
    return access.includes('discovery') || access.includes('*');
  });

  const floorData = floorResult.data as { id: string };
  return ok({
    roomType: 'discovery',
    floorId: floorData.id,
    floorType: 'collaboration',
    eligibleAgents: eligibleAgents.map((a) => ({ id: a.id, name: a.name, role: a.role })),
  });
}
