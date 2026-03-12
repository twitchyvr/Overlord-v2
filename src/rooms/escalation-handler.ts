/**
 * Escalation Handler
 *
 * Periodically checks for stale pending gates and emits escalation events.
 * Rooms define escalation rules; this handler fires when gates exceed
 * their time threshold without being signed off.
 *
 * Runs on a configurable interval (default: 5 minutes).
 * Emits 'escalation:stale-gate' for each stale gate found.
 */

import { logger, broadcastLog } from '../core/logger.js';
import { getStalePendingGates } from './phase-gate.js';
import type { Bus } from '../core/bus.js';

const log = logger.child({ module: 'escalation' });

/** Default check interval: 5 minutes */
const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;

/** Default stale threshold: 30 minutes */
const DEFAULT_THRESHOLD_MS = 30 * 60 * 1000;

interface EscalationConfig {
  bus: Bus;
  /** How often to check for stale gates (ms). Default: 5 minutes. */
  intervalMs?: number;
  /** How old a pending gate must be before it's considered stale (ms). Default: 30 minutes. */
  thresholdMs?: number;
}

/** Track previously escalated gate IDs to avoid duplicate alerts */
const escalatedGates = new Set<string>();

let intervalHandle: ReturnType<typeof setInterval> | null = null;

/**
 * Initialize the escalation handler.
 *
 * Starts a periodic check for stale pending phase gates.
 * When found, emits escalation events to the bus for UI notification.
 */
export function initEscalationHandler({
  bus,
  intervalMs = DEFAULT_INTERVAL_MS,
  thresholdMs = DEFAULT_THRESHOLD_MS,
}: EscalationConfig): void {
  // Clean up any previous interval (hot reload safety)
  if (intervalHandle) {
    clearInterval(intervalHandle);
  }

  const checkStaleGates = (): void => {
    try {
      const result = getStalePendingGates(thresholdMs);
      if (!result.ok) {
        log.warn({ error: result.error }, 'Failed to check stale gates');
        return;
      }

      const staleGates = result.data as Array<{
        id: string;
        building_id: string;
        phase: string;
        status: string;
        building_name: string;
        active_phase: string;
        created_at: string;
      }>;

      if (staleGates.length === 0) return;

      for (const gate of staleGates) {
        // Skip if already escalated (avoid spam)
        if (escalatedGates.has(gate.id)) continue;

        const ageMs = Date.now() - new Date(gate.created_at).getTime();
        const ageMinutes = Math.round(ageMs / 60_000);

        log.warn(
          { gateId: gate.id, buildingId: gate.building_id, phase: gate.phase, ageMinutes },
          `Stale gate detected — pending for ${ageMinutes} minutes`,
        );

        broadcastLog(
          'warn',
          `Phase gate for "${gate.phase}" in "${gate.building_name}" has been pending for ${ageMinutes} minutes — requires sign-off`,
          'escalation',
        );

        bus.emit('escalation:stale-gate', {
          gateId: gate.id,
          buildingId: gate.building_id,
          buildingName: gate.building_name,
          phase: gate.phase,
          ageMs,
          ageMinutes,
          status: gate.status,
          createdAt: gate.created_at,
        });

        escalatedGates.add(gate.id);
      }
    } catch (err) {
      log.error({ err }, 'Escalation check failed');
    }
  };

  // Run initial check after a short delay (let server finish booting)
  setTimeout(checkStaleGates, 10_000);

  // Start periodic checks
  intervalHandle = setInterval(checkStaleGates, intervalMs);

  // Clean up escalated set when gates are resolved
  bus.on('phase:gate:signed-off', (data: Record<string, unknown>) => {
    const gateId = data.gateId as string;
    if (gateId) escalatedGates.delete(gateId);
  });

  // Clean up on server shutdown
  bus.on('server:shutdown', () => {
    if (intervalHandle) {
      clearInterval(intervalHandle);
      intervalHandle = null;
    }
  });

  log.info(
    { intervalMs, thresholdMs },
    `Escalation handler initialized (check every ${intervalMs / 1000}s, threshold ${thresholdMs / 1000}s)`,
  );
}
