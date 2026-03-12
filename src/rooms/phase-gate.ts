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
  let phaseAdvanced = false;
  let nextPhase: string | null = null;
  if (verdict === 'GO') {
    const currentIdx = PHASE_ORDER.indexOf(gate.phase);
    if (currentIdx === -1) {
      log.warn({ gateId, phase: gate.phase }, 'Gate phase not in PHASE_ORDER — cannot determine advancement');
    } else if (currentIdx >= PHASE_ORDER.length - 1) {
      log.info({ gateId, phase: gate.phase, buildingId: gate.building_id }, 'Final phase signed off — no further advancement possible');
    } else {
      nextPhase = PHASE_ORDER[currentIdx + 1];
      db.prepare('UPDATE buildings SET active_phase = ?, updated_at = datetime(?) WHERE id = ?')
        .run(nextPhase, new Date().toISOString(), gate.building_id);
      phaseAdvanced = true;
      log.info({ buildingId: gate.building_id, from: gate.phase, to: nextPhase }, 'Phase advanced');
    }
  }

  log.info({ gateId, verdict, reviewer }, 'Phase gate signed off');
  return ok({ gateId, verdict, status, phaseAdvanced, nextPhase });
}

/**
 * Check if a phase transition is allowed
 */
export function canAdvance(buildingId: string): Result {
  const db = getDb();
  const building = db.prepare('SELECT * FROM buildings WHERE id = ?').get(buildingId) as BuildingRow | undefined;
  if (!building) return err('BUILDING_NOT_FOUND', `Building ${buildingId} does not exist`);

  const currentPhase = building.active_phase;
  const idx = PHASE_ORDER.indexOf(currentPhase);
  if (idx === -1) return err('UNKNOWN_PHASE', `Phase '${currentPhase}' not in phase order`);
  if (idx >= PHASE_ORDER.length - 1) return ok({ canAdvance: false, currentPhase, reason: 'Final phase reached' });

  const gate = db.prepare(`
    SELECT * FROM phase_gates
    WHERE building_id = ? AND phase = ?
    ORDER BY created_at DESC LIMIT 1
  `).get(buildingId, currentPhase) as PhaseGateRow | undefined;

  if (!gate) return ok({ canAdvance: false, reason: 'No gate exists for current phase' });
  if (gate.status !== 'go') return ok({ canAdvance: false, reason: `Gate verdict: ${gate.signoff_verdict}`, gate });

  return ok({ canAdvance: true, currentPhase, nextPhase: PHASE_ORDER[idx + 1] });
}

/**
 * Get all gates for a building
 */
export function getGates(buildingId: string): Result {
  const db = getDb();
  return ok(db.prepare('SELECT * FROM phase_gates WHERE building_id = ? ORDER BY created_at').all(buildingId));
}

/**
 * Get pending gates across all buildings (for UI "pending approvals" view).
 * Returns gates with status 'pending' or 'conditional'.
 */
export function getPendingGates(buildingId?: string): Result {
  const db = getDb();
  if (buildingId) {
    const rows = db.prepare(`
      SELECT pg.*, b.name as building_name, b.active_phase
      FROM phase_gates pg
      JOIN buildings b ON pg.building_id = b.id
      WHERE pg.building_id = ? AND pg.status IN ('pending', 'conditional')
      ORDER BY pg.created_at
    `).all(buildingId);
    return ok(rows);
  }
  const rows = db.prepare(`
    SELECT pg.*, b.name as building_name, b.active_phase
    FROM phase_gates pg
    JOIN buildings b ON pg.building_id = b.id
    WHERE pg.status IN ('pending', 'conditional')
    ORDER BY pg.created_at
  `).all();
  return ok(rows);
}

/**
 * Resolve conditions on a CONDITIONAL gate.
 * Once all conditions are resolved, the gate can be re-signed as GO.
 *
 * @param gateId — the conditional gate
 * @param resolvedConditions — conditions that have been met (subset of original)
 */
export function resolveConditions({ gateId, resolvedConditions, resolver }: {
  gateId: string;
  resolvedConditions: string[];
  resolver: string;
}): Result {
  const db = getDb();
  const gate = db.prepare('SELECT * FROM phase_gates WHERE id = ?').get(gateId) as PhaseGateRow | undefined;
  if (!gate) return err('GATE_NOT_FOUND', `Phase gate ${gateId} does not exist`);
  if (gate.status !== 'conditional') {
    return err('GATE_NOT_CONDITIONAL', `Gate ${gateId} is not in CONDITIONAL status (current: ${gate.status})`);
  }

  const originalConditions: string[] = JSON.parse(gate.signoff_conditions || '[]');
  const remaining = originalConditions.filter((c) => !resolvedConditions.includes(c));

  if (remaining.length === 0) {
    // All conditions resolved — auto-advance by re-signing as GO
    log.info({ gateId, resolver }, 'All conditions resolved — advancing gate to GO');
    return signoffGate({
      gateId,
      reviewer: resolver,
      verdict: 'GO',
      conditions: [],
      exitDocId: gate.exit_doc_id || undefined,
      nextPhaseInput: JSON.parse(gate.next_phase_input || '{}'),
    });
  }

  // Update with remaining conditions
  db.prepare(`
    UPDATE phase_gates SET signoff_conditions = ? WHERE id = ?
  `).run(JSON.stringify(remaining), gateId);

  log.info({ gateId, resolved: resolvedConditions.length, remaining: remaining.length, resolver }, 'Conditions partially resolved');
  return ok({
    gateId,
    resolvedCount: resolvedConditions.length,
    remainingConditions: remaining,
    allResolved: false,
  });
}

/**
 * Check for stale pending gates that have been waiting too long.
 * Returns gates older than the specified threshold (ms).
 * Used by the orchestrator to trigger escalation.
 */
export function getStalePendingGates(thresholdMs: number = 30 * 60 * 1000): Result {
  const db = getDb();
  const cutoff = new Date(Date.now() - thresholdMs).toISOString();
  const rows = db.prepare(`
    SELECT pg.*, b.name as building_name, b.active_phase
    FROM phase_gates pg
    JOIN buildings b ON pg.building_id = b.id
    WHERE pg.status = 'pending' AND pg.created_at < datetime(?)
    ORDER BY pg.created_at
  `).all(cutoff);
  return ok(rows);
}

/**
 * Get the phase order (useful for UI display)
 */
export function getPhaseOrder(): string[] {
  return [...PHASE_ORDER];
}
