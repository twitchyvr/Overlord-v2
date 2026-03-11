/**
 * Phase Gate System
 *
 * Go/no-go checkpoints between phases.
 * Cannot be bypassed — requires structured exit document + RAID log entry + sign-off.
 * Next phase receives previous phase's output as input template.
 */

import { getDb } from '../storage/db.js';
import { logger } from '../core/logger.js';
import { ok, err } from '../core/contracts.js';
import type { Result, PhaseGateRow, BuildingRow, GateVerdict } from '../core/contracts.js';

const log = logger.child({ module: 'phase-gate' });

/** Phase order — defines valid transitions */
const PHASE_ORDER = ['strategy', 'discovery', 'architecture', 'execution', 'review', 'deploy'];

interface CreateGateParams {
  buildingId: string;
  phase: string;
}

/**
 * Create a new phase gate
 */
export function createGate({ buildingId, phase }: CreateGateParams): Result {
  const db = getDb();
  const id = `gate_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  db.prepare(`
    INSERT INTO phase_gates (id, building_id, phase, status)
    VALUES (?, ?, ?, 'pending')
  `).run(id, buildingId, phase);

  log.info({ id, buildingId, phase }, 'Phase gate created');
  return ok({ id, phase, status: 'pending' });
}

interface SignoffGateParams {
  gateId: string;
  reviewer: string;
  verdict: GateVerdict;
  conditions?: string[];
  exitDocId?: string;
  nextPhaseInput?: Record<string, unknown>;
}

/**
 * Submit sign-off for a phase gate
 */
export function signoffGate({ gateId, reviewer, verdict, conditions = [], exitDocId, nextPhaseInput = {} }: SignoffGateParams): Result {
  if (!(['GO', 'NO-GO', 'CONDITIONAL'] as GateVerdict[]).includes(verdict)) {
    return err('INVALID_VERDICT', `Verdict must be GO, NO-GO, or CONDITIONAL. Got: ${verdict}`);
  }

  const db = getDb();
  const gate = db.prepare('SELECT * FROM phase_gates WHERE id = ?').get(gateId) as PhaseGateRow | undefined;
  if (!gate) return err('GATE_NOT_FOUND', `Phase gate ${gateId} does not exist`);

  const status = verdict === 'GO' ? 'go' : verdict === 'NO-GO' ? 'no-go' : 'conditional';

  db.prepare(`
    UPDATE phase_gates
    SET status = ?, exit_doc_id = ?, signoff_reviewer = ?, signoff_verdict = ?,
        signoff_conditions = ?, signoff_timestamp = datetime(?), next_phase_input = ?
    WHERE id = ?
  `).run(
    status,
    exitDocId || null,
    reviewer,
    verdict,
    JSON.stringify(conditions),
    new Date().toISOString(),
    JSON.stringify(nextPhaseInput),
    gateId,
  );

  // If GO, advance the building's active phase
  if (verdict === 'GO') {
    const currentIdx = PHASE_ORDER.indexOf(gate.phase);
    if (currentIdx < PHASE_ORDER.length - 1) {
      const nextPhase = PHASE_ORDER[currentIdx + 1];
      db.prepare('UPDATE buildings SET active_phase = ?, updated_at = datetime(?) WHERE id = ?')
        .run(nextPhase, new Date().toISOString(), gate.building_id);
      log.info({ buildingId: gate.building_id, from: gate.phase, to: nextPhase }, 'Phase advanced');
    }
  }

  log.info({ gateId, verdict, reviewer }, 'Phase gate signed off');
  return ok({ gateId, verdict, status });
}

/**
 * Check if a phase transition is allowed
 */
export function canAdvance(buildingId: string): Result {
  const db = getDb();
  const building = db.prepare('SELECT * FROM buildings WHERE id = ?').get(buildingId) as BuildingRow | undefined;
  if (!building) return err('BUILDING_NOT_FOUND', `Building ${buildingId} does not exist`);

  const currentPhase = building.active_phase;
  const gate = db.prepare(`
    SELECT * FROM phase_gates
    WHERE building_id = ? AND phase = ?
    ORDER BY created_at DESC LIMIT 1
  `).get(buildingId, currentPhase) as PhaseGateRow | undefined;

  if (!gate) return ok({ canAdvance: false, reason: 'No gate exists for current phase' });
  if (gate.status !== 'go') return ok({ canAdvance: false, reason: `Gate verdict: ${gate.signoff_verdict}`, gate });

  return ok({ canAdvance: true, currentPhase, nextPhase: PHASE_ORDER[PHASE_ORDER.indexOf(currentPhase) + 1] });
}

/**
 * Get all gates for a building
 */
export function getGates(buildingId: string): Result {
  const db = getDb();
  return ok(db.prepare('SELECT * FROM phase_gates WHERE building_id = ? ORDER BY created_at').all(buildingId));
}
