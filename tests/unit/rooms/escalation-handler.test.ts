/**
 * Escalation Handler Tests
 *
 * Tests the periodic stale gate checker and escalation event emission.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'eventemitter3';
import type { Bus, BusEventData } from '../../../src/core/bus.js';

// Mock getStalePendingGates
vi.mock('../../../src/rooms/phase-gate.js', () => ({
  getStalePendingGates: vi.fn(),
}));

// Mock broadcastLog
vi.mock('../../../src/core/logger.js', () => {
  const child = () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  });
  return {
    logger: { child },
    broadcastLog: vi.fn(),
  };
});

import { getStalePendingGates } from '../../../src/rooms/phase-gate.js';
import { initEscalationHandler } from '../../../src/rooms/escalation-handler.js';

function createMockBus(): Bus & {
  _emissions: Array<{ event: string; data: unknown }>;
  _trigger: (event: string, data: Record<string, unknown>) => void;
} {
  const ee = new EventEmitter();
  const emissions: Array<{ event: string; data: unknown }> = [];
  return {
    emit: (event: string | symbol, data?: Record<string, unknown>) => {
      emissions.push({ event: event as string, data });
      ee.emit(event, data);
      return true;
    },
    on: (event: string | symbol, fn: (...args: unknown[]) => void) => {
      ee.on(event, fn);
      return ee;
    },
    onNamespace: () => {},
    _emissions: emissions,
    _trigger: (event: string, data: Record<string, unknown>) => {
      ee.emit(event, data);
    },
  } as unknown as Bus & { _emissions: typeof emissions; _trigger: typeof Bus.prototype.emit };
}

describe('Escalation Handler', () => {
  let bus: ReturnType<typeof createMockBus>;

  beforeEach(() => {
    vi.useFakeTimers();
    bus = createMockBus();
    (getStalePendingGates as ReturnType<typeof vi.fn>).mockReset();
  });

  afterEach(() => {
    // Trigger shutdown to clean up intervals
    bus._trigger('server:shutdown', {});
    // Clear all pending timers (setTimeout leaks across tests since it's not tracked by shutdown)
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('initializes without errors', () => {
    (getStalePendingGates as ReturnType<typeof vi.fn>).mockReturnValue({ ok: true, data: [] });
    expect(() => initEscalationHandler({ bus, intervalMs: 60000, thresholdMs: 60000 })).not.toThrow();
  });

  it('checks stale gates after initial delay', () => {
    (getStalePendingGates as ReturnType<typeof vi.fn>).mockReturnValue({ ok: true, data: [] });
    initEscalationHandler({ bus, intervalMs: 60000, thresholdMs: 60000 });

    // Initial check fires after 10s delay
    vi.advanceTimersByTime(10_001);
    expect(getStalePendingGates).toHaveBeenCalledOnce();
  });

  it('emits escalation:stale-gate for stale gates', () => {
    const staleGate = {
      id: 'gate_1',
      building_id: 'bld_1',
      phase: 'strategy',
      status: 'pending',
      building_name: 'Test Project',
      active_phase: 'strategy',
      created_at: new Date(Date.now() - 45 * 60_000).toISOString(), // 45 minutes ago
    };

    (getStalePendingGates as ReturnType<typeof vi.fn>).mockReturnValue({
      ok: true,
      data: [staleGate],
    });

    initEscalationHandler({ bus, intervalMs: 60000, thresholdMs: 30 * 60_000 });

    // Trigger the initial check
    vi.advanceTimersByTime(10_001);

    const escalation = bus._emissions.find((e) => e.event === 'escalation:stale-gate');
    expect(escalation).toBeDefined();
    expect((escalation!.data as Record<string, unknown>).gateId).toBe('gate_1');
    expect((escalation!.data as Record<string, unknown>).buildingId).toBe('bld_1');
    expect((escalation!.data as Record<string, unknown>).phase).toBe('strategy');
  });

  it('does not re-escalate the same gate', () => {
    const staleGate = {
      id: 'gate_repeat',
      building_id: 'bld_1',
      phase: 'discovery',
      status: 'pending',
      building_name: 'Test',
      active_phase: 'discovery',
      created_at: new Date(Date.now() - 60 * 60_000).toISOString(),
    };

    (getStalePendingGates as ReturnType<typeof vi.fn>).mockReturnValue({
      ok: true,
      data: [staleGate],
    });

    initEscalationHandler({ bus, intervalMs: 5000, thresholdMs: 30 * 60_000 });

    // First check
    vi.advanceTimersByTime(10_001);
    const firstCount = bus._emissions.filter((e) => e.event === 'escalation:stale-gate').length;
    expect(firstCount).toBe(1);

    // Second check — same gate, should not re-escalate
    vi.advanceTimersByTime(5000);
    const secondCount = bus._emissions.filter((e) => e.event === 'escalation:stale-gate').length;
    expect(secondCount).toBe(1); // Still just 1
  });

  it('clears escalated gate when signed off', () => {
    const staleGate = {
      id: 'gate_signoff',
      building_id: 'bld_1',
      phase: 'strategy',
      status: 'pending',
      building_name: 'Test',
      active_phase: 'strategy',
      created_at: new Date(Date.now() - 60 * 60_000).toISOString(),
    };

    (getStalePendingGates as ReturnType<typeof vi.fn>).mockReturnValue({
      ok: true,
      data: [staleGate],
    });

    initEscalationHandler({ bus, intervalMs: 5000, thresholdMs: 30 * 60_000 });

    // First check — escalates
    vi.advanceTimersByTime(10_001);
    expect(bus._emissions.filter((e) => e.event === 'escalation:stale-gate').length).toBe(1);

    // Sign off the gate
    bus._trigger('phase:gate:signed-off', { gateId: 'gate_signoff' });

    // Next check — gate appears again, should re-escalate since we cleared it
    vi.advanceTimersByTime(5000);
    expect(bus._emissions.filter((e) => e.event === 'escalation:stale-gate').length).toBe(2);
  });

  it('handles getStalePendingGates failure gracefully', () => {
    (getStalePendingGates as ReturnType<typeof vi.fn>).mockReturnValue({
      ok: false,
      error: { code: 'DB_ERROR', message: 'Database unavailable' },
    });

    initEscalationHandler({ bus, intervalMs: 60000, thresholdMs: 60000 });

    // Should not throw
    vi.advanceTimersByTime(10_001);

    // No escalation events emitted
    const escalations = bus._emissions.filter((e) => e.event === 'escalation:stale-gate');
    expect(escalations.length).toBe(0);
  });

  it('runs periodic checks at configured interval', () => {
    (getStalePendingGates as ReturnType<typeof vi.fn>).mockReturnValue({ ok: true, data: [] });

    // Use intervalMs > 10s so setInterval doesn't fire during the initial setTimeout delay
    initEscalationHandler({ bus, intervalMs: 20000, thresholdMs: 60000 });

    // Initial delay (only setTimeout fires at 10s; setInterval at 20s hasn't fired yet)
    vi.advanceTimersByTime(10_001);
    expect(getStalePendingGates).toHaveBeenCalledTimes(1);

    // First periodic check (setInterval fires at 20s)
    vi.advanceTimersByTime(10_000);
    expect(getStalePendingGates).toHaveBeenCalledTimes(2);

    // Second periodic check (setInterval fires at 40s)
    vi.advanceTimersByTime(20_000);
    expect(getStalePendingGates).toHaveBeenCalledTimes(3);
  });

  it('cleans up interval on server:shutdown', () => {
    (getStalePendingGates as ReturnType<typeof vi.fn>).mockReturnValue({ ok: true, data: [] });

    // Use intervalMs > 10s so setInterval doesn't fire during initial setTimeout delay
    initEscalationHandler({ bus, intervalMs: 20000, thresholdMs: 60000 });

    vi.advanceTimersByTime(10_001);
    expect(getStalePendingGates).toHaveBeenCalledTimes(1);

    // Shutdown
    bus._trigger('server:shutdown', {});

    // Advance past when the interval would have fired — should NOT trigger
    vi.advanceTimersByTime(30_000);
    expect(getStalePendingGates).toHaveBeenCalledTimes(1); // Still just the initial
  });

  it('skips empty stale gates array', () => {
    (getStalePendingGates as ReturnType<typeof vi.fn>).mockReturnValue({ ok: true, data: [] });

    initEscalationHandler({ bus, intervalMs: 60000, thresholdMs: 60000 });
    vi.advanceTimersByTime(10_001);

    const escalations = bus._emissions.filter((e) => e.event === 'escalation:stale-gate');
    expect(escalations.length).toBe(0);
  });
});
