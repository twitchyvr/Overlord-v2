/**
 * Dev Loop Enforcer (#652)
 *
 * Event-driven pipeline progression for the development loop.
 * Listens for exit-doc submissions and phase gate verdicts,
 * then auto-triggers the next stage in the pipeline:
 *
 *   Code Lab → Review → Testing Lab → Dogfood (notify user)
 *
 * This replaces the manual "hope the agent remembers" approach
 * with event-driven room-to-room handoffs.
 *
 * Layer: Rooms (depends on Storage, Core)
 */

import { logger, broadcastLog } from '../core/logger.js';
import { getDb } from '../storage/db.js';
import type { Bus } from '../core/bus.js';

const log = logger.child({ module: 'dev-loop-enforcer' });

/**
 * Pipeline stage definitions — what triggers what.
 * Each stage listens for a specific event and emits the next stage trigger.
 */
interface PipelineStage {
  name: string;
  description: string;
}

const PIPELINE: PipelineStage[] = [
  { name: 'code', description: 'Code Lab submits implementation' },
  { name: 'review', description: 'Review room provides GO/NO-GO verdict' },
  { name: 'testing', description: 'Testing Lab runs E2E tests' },
  { name: 'dogfood', description: 'User verifies through the live app' },
];

/**
 * Initialize the dev loop enforcer.
 * Subscribes to bus events and auto-triggers pipeline progression.
 */
export function initDevLoopEnforcer(bus: Bus): void {
  log.info('Dev loop enforcer initializing');

  // ─── Stage 1 → 2: Code Lab exit doc → trigger Review ───
  bus.on('exit-doc:submitted', (data) => {
    const roomType = data.roomType as string;
    if (roomType !== 'code-lab') return;

    const buildingId = data.buildingId as string;
    const agentId = data.agentId as string;
    const exitDocId = data.id as string;

    log.info(
      { buildingId, agentId, exitDocId, stage: 'code→review' },
      'Dev loop: Code Lab exit doc submitted — triggering review stage',
    );

    // Find or identify a review room in this building
    const reviewRoom = findRoomByType(buildingId, 'review');

    bus.emit('dev-loop:stage-transition', {
      buildingId,
      from: 'code-lab',
      to: 'review',
      trigger: 'exit-doc:submitted',
      exitDocId,
      agentId,
      reviewRoomId: reviewRoom?.id || null,
      stage: PIPELINE[1],
      message: `Code Lab submitted implementation report. Review needed before merging.${reviewRoom ? ` Review room: ${reviewRoom.name}` : ' No review room found — create one.'}`,
    });

    broadcastLog(
      'info',
      `[Dev Loop] Code Lab → Review: implementation report submitted for building ${buildingId}`,
      'dev-loop',
    );
  });

  // ─── Stage 2 → 3: Review GO verdict → trigger Testing Lab ───
  bus.on('phase:gate:signed-off', (data) => {
    const verdict = data.verdict as string;
    const buildingId = data.buildingId as string;
    const gateId = data.gateId as string;

    if (verdict === 'GO' || verdict === 'CONDITIONAL') {
      log.info(
        { buildingId, gateId, verdict, stage: 'review→testing' },
        'Dev loop: Review passed — triggering testing stage',
      );

      const testingRoom = findRoomByType(buildingId, 'testing-lab');

      bus.emit('dev-loop:stage-transition', {
        buildingId,
        from: 'review',
        to: 'testing-lab',
        trigger: 'phase:gate:signed-off',
        verdict,
        gateId,
        testingRoomId: testingRoom?.id || null,
        stage: PIPELINE[2],
        message: `Review verdict: ${verdict}. E2E testing needed.${testingRoom ? ` Testing room: ${testingRoom.name}` : ' No testing room found — create one.'}`,
      });

      broadcastLog(
        'info',
        `[Dev Loop] Review → Testing: ${verdict} verdict for building ${buildingId}`,
        'dev-loop',
      );
    } else if (verdict === 'NO-GO') {
      log.info(
        { buildingId, gateId, verdict, stage: 'review→code-lab' },
        'Dev loop: Review rejected — routing back to Code Lab',
      );

      bus.emit('dev-loop:stage-transition', {
        buildingId,
        from: 'review',
        to: 'code-lab',
        trigger: 'phase:gate:signed-off',
        verdict,
        gateId,
        stage: PIPELINE[0],
        message: 'Review verdict: NO-GO. Routing back to Code Lab for fixes.',
      });

      broadcastLog(
        'warn',
        `[Dev Loop] Review → Code Lab: NO-GO for building ${buildingId} — needs fixes`,
        'dev-loop',
      );
    }
  });

  // ─── Stage 3 → 4: Testing Lab exit doc → trigger Dogfood notification ───
  bus.on('exit-doc:submitted', (data) => {
    const roomType = data.roomType as string;
    if (roomType !== 'testing-lab') return;

    const buildingId = data.buildingId as string;
    const exitDocId = data.id as string;
    const document = data.document as Record<string, unknown> | undefined;

    const testsPassed = (document?.testsPassed as number) || 0;
    const testsFailed = (document?.testsFailed as number) || 0;

    if (testsFailed > 0) {
      log.info(
        { buildingId, exitDocId, testsFailed, stage: 'testing→code-lab' },
        'Dev loop: Tests failed — routing back to Code Lab',
      );

      bus.emit('dev-loop:stage-transition', {
        buildingId,
        from: 'testing-lab',
        to: 'code-lab',
        trigger: 'exit-doc:submitted',
        exitDocId,
        testsPassed,
        testsFailed,
        stage: PIPELINE[0],
        message: `${testsFailed} test(s) failed. Routing back to Code Lab for fixes.`,
      });

      broadcastLog(
        'warn',
        `[Dev Loop] Testing → Code Lab: ${testsFailed} test failures in building ${buildingId}`,
        'dev-loop',
      );
    } else {
      log.info(
        { buildingId, exitDocId, testsPassed, stage: 'testing→dogfood' },
        'Dev loop: All tests passed — dogfood stage ready',
      );

      bus.emit('dev-loop:stage-transition', {
        buildingId,
        from: 'testing-lab',
        to: 'dogfood',
        trigger: 'exit-doc:submitted',
        exitDocId,
        testsPassed,
        testsFailed: 0,
        stage: PIPELINE[3],
        message: `All ${testsPassed} tests passed! Ready for dogfooding — verify the change through the live app.`,
      });

      broadcastLog(
        'info',
        `[Dev Loop] Testing → Dogfood: ${testsPassed} tests passed in building ${buildingId}. Ready for user verification.`,
        'dev-loop',
      );
    }
  });

  // ─── Broadcast stage transitions to connected clients ───
  bus.on('dev-loop:stage-transition', (data) => {
    // This event is picked up by the transport layer and forwarded to
    // all clients viewing this building, showing the pipeline progression.
    log.info(
      { from: data.from, to: data.to, buildingId: data.buildingId },
      'Dev loop stage transition',
    );
  });

  log.info({ stages: PIPELINE.map(s => s.name) }, 'Dev loop enforcer initialized');
}

// ─── Helpers ───

/**
 * Find a room of a specific type within a building.
 */
function findRoomByType(buildingId: string, roomType: string): { id: string; name: string } | null {
  try {
    const db = getDb();
    const room = db.prepare(`
      SELECT r.id, r.name FROM rooms r
      JOIN floors f ON r.floor_id = f.id
      WHERE f.building_id = ? AND r.type = ?
      LIMIT 1
    `).get(buildingId, roomType) as { id: string; name: string } | undefined;
    return room || null;
  } catch (e) {
    log.warn({ buildingId, roomType, err: e instanceof Error ? e.message : String(e) }, 'Failed to find room by type');
    return null;
  }
}
