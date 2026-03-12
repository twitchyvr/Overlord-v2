/**
 * Room Behavioral Logic Tests
 *
 * Tests the behavioral overrides added to room types:
 * - onBeforeToolCall guardrails (read-only enforcement, scope enforcement)
 * - onAfterToolCall escalation logic
 * - Verdict-based routing (Review Room)
 * - War Room time-boxing
 * - Plugin Bay destructive operation warnings
 * - Data Exchange schema validation tracking
 * - Provider Hub fallback chain validation
 */

import { describe, it, expect } from 'vitest';
import { EventEmitter } from 'eventemitter3';
import type { Bus } from '../../../src/core/bus.js';
import { ok, err } from '../../../src/core/contracts.js';

// Room imports
import { DiscoveryRoom } from '../../../src/rooms/room-types/discovery.js';
import { ArchitectureRoom } from '../../../src/rooms/room-types/architecture.js';
import { StrategistOffice } from '../../../src/rooms/room-types/strategist.js';
import { ReviewRoom } from '../../../src/rooms/room-types/review.js';
import { WarRoom } from '../../../src/rooms/room-types/war-room.js';
import { DeployRoom } from '../../../src/rooms/room-types/deploy.js';
import { PluginBayRoom } from '../../../src/rooms/room-types/plugin-bay.js';
import { DataExchangeRoom } from '../../../src/rooms/room-types/data-exchange.js';
import { ProviderHubRoom } from '../../../src/rooms/room-types/provider-hub.js';
import { TestingLab } from '../../../src/rooms/room-types/testing-lab.js';

function createMockBus(): Bus & { _emissions: Array<{ event: string; data: unknown }> } {
  const ee = new EventEmitter();
  const emissions: Array<{ event: string; data: unknown }> = [];
  return {
    emit: (event: string | symbol, data?: Record<string, unknown>) => {
      emissions.push({ event: event as string, data });
      ee.emit(event, data);
      return true;
    },
    on: ee.on.bind(ee),
    onNamespace: () => {},
    _emissions: emissions,
  } as unknown as Bus & { _emissions: typeof emissions };
}

// ─── Read-Only Room Guardrails ───

describe('Read-only room onBeforeToolCall guardrails', () => {
  const readOnlyRooms = [
    { name: 'DiscoveryRoom', factory: () => new DiscoveryRoom('room_d') },
    { name: 'ArchitectureRoom', factory: () => new ArchitectureRoom('room_a') },
    { name: 'DeployRoom', factory: () => new DeployRoom('room_dep') },
  ];

  for (const { name, factory } of readOnlyRooms) {
    describe(name, () => {
      it('blocks write_file', () => {
        const room = factory();
        const result = room.onBeforeToolCall('write_file', 'agent_1', { path: 'src/x.ts' });
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error.code).toBe('TOOL_BLOCKED');
        }
      });

      it('blocks patch_file', () => {
        const room = factory();
        const result = room.onBeforeToolCall('patch_file', 'agent_1', { path: 'src/x.ts' });
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error.code).toBe('TOOL_BLOCKED');
        }
      });

      it('allows read_file', () => {
        const room = factory();
        const result = room.onBeforeToolCall('read_file', 'agent_1', { path: 'src/x.ts' });
        expect(result.ok).toBe(true);
      });

      it('allows list_dir', () => {
        const room = factory();
        const result = room.onBeforeToolCall('list_dir', 'agent_1', { path: 'src/' });
        expect(result.ok).toBe(true);
      });

      it('allows web_search', () => {
        const room = factory();
        const result = room.onBeforeToolCall('web_search', 'agent_1', { query: 'test' });
        expect(result.ok).toBe(true);
      });
    });
  }
});

describe('StrategistOffice onBeforeToolCall', () => {
  it('blocks write_file', () => {
    const room = new StrategistOffice('room_s');
    const result = room.onBeforeToolCall('write_file', 'agent_1', { path: 'src/x.ts' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('TOOL_BLOCKED');
  });

  it('blocks bash (no shell execution in strategy)', () => {
    const room = new StrategistOffice('room_s');
    const result = room.onBeforeToolCall('bash', 'agent_1', { command: 'rm -rf /' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('TOOL_BLOCKED');
  });

  it('allows web_search', () => {
    const room = new StrategistOffice('room_s');
    const result = room.onBeforeToolCall('web_search', 'agent_1', { query: 'test' });
    expect(result.ok).toBe(true);
  });

  it('allows record_note', () => {
    const room = new StrategistOffice('room_s');
    const result = room.onBeforeToolCall('record_note', 'agent_1', { note: 'important' });
    expect(result.ok).toBe(true);
  });
});

// ─── Discovery Room onAfterToolCall ───

describe('DiscoveryRoom onAfterToolCall', () => {
  it('emits escalation on web_search failure', () => {
    const room = new DiscoveryRoom('room_d');
    const bus = createMockBus();
    room.setBus(bus);

    room.onAfterToolCall('web_search', 'agent_1', {
      ok: false, error: { code: 'SEARCH_FAILED', message: 'Network error', retryable: true },
    });

    const escalation = bus._emissions.find((e) => e.event === 'room:escalation:suggested');
    expect(escalation).toBeDefined();
  });

  it('does not emit escalation on successful web_search', () => {
    const room = new DiscoveryRoom('room_d');
    const bus = createMockBus();
    room.setBus(bus);

    room.onAfterToolCall('web_search', 'agent_1', { ok: true, data: { results: [] } });

    const escalation = bus._emissions.find((e) => e.event === 'room:escalation:suggested');
    expect(escalation).toBeUndefined();
  });
});

// ─── Review Room Behavioral Logic ───

describe('ReviewRoom behavioral logic', () => {
  describe('CONDITIONAL verdict validation', () => {
    it('rejects CONDITIONAL verdict with empty conditions', () => {
      const room = new ReviewRoom('room_r');
      const result = room.validateExitDocument({
        verdict: 'CONDITIONAL',
        evidence: [{ claim: 'c', proof: 'p', citation: 'ci' }],
        conditions: [],
        riskQuestionnaire: [{ question: 'q', answer: 'a', risk: 'low' }],
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.message).toContain('CONDITIONAL');
    });

    it('accepts CONDITIONAL verdict with conditions', () => {
      const room = new ReviewRoom('room_r');
      const result = room.validateExitDocument({
        verdict: 'CONDITIONAL',
        evidence: [{ claim: 'c', proof: 'p', citation: 'ci' }],
        conditions: ['Fix lint errors before deploy'],
        riskQuestionnaire: [{ question: 'q', answer: 'a', risk: 'low' }],
      });
      expect(result.ok).toBe(true);
    });

    it('accepts GO verdict without conditions', () => {
      const room = new ReviewRoom('room_r');
      const result = room.validateExitDocument({
        verdict: 'GO',
        evidence: [{ claim: 'c', proof: 'p', citation: 'ci' }],
        conditions: [],
        riskQuestionnaire: [{ question: 'q', answer: 'a', risk: 'low' }],
      });
      expect(result.ok).toBe(true);
    });
  });

  describe('routeVerdict', () => {
    it('emits escalation on NO-GO verdict', () => {
      const room = new ReviewRoom('room_r');
      const bus = createMockBus();
      room.setBus(bus);

      room.routeVerdict({ verdict: 'NO-GO' }, 'agent_1');

      const escalation = bus._emissions.find((e) => e.event === 'room:escalation:suggested');
      expect(escalation).toBeDefined();
      expect((escalation!.data as Record<string, unknown>).condition).toBe('onNoGo');
    });

    it('emits gate:conditional on CONDITIONAL verdict', () => {
      const room = new ReviewRoom('room_r');
      const bus = createMockBus();
      room.setBus(bus);

      room.routeVerdict({ verdict: 'CONDITIONAL', conditions: ['Fix X'] }, 'agent_1');

      const conditional = bus._emissions.find((e) => e.event === 'room:gate:conditional');
      expect(conditional).toBeDefined();
      expect((conditional!.data as Record<string, unknown>).conditions).toEqual(['Fix X']);
    });

    it('emits gate:passed on GO verdict', () => {
      const room = new ReviewRoom('room_r');
      const bus = createMockBus();
      room.setBus(bus);

      room.routeVerdict({ verdict: 'GO' }, 'agent_1');

      const passed = bus._emissions.find((e) => e.event === 'room:gate:passed');
      expect(passed).toBeDefined();
    });
  });
});

// ─── War Room Time-Boxing ───

describe('WarRoom time-boxing', () => {
  it('tracks agent entry time on onAgentEnter', () => {
    const room = new WarRoom('room_w');
    const bus = createMockBus();
    room.setBus(bus);

    room.onAgentEnter('agent_1', 'boardroom');

    const duration = room.getAgentDuration('agent_1');
    expect(duration).not.toBeNull();
    expect(duration!).toBeGreaterThanOrEqual(0);
    expect(duration!).toBeLessThan(100); // should be nearly instant
  });

  it('returns null for agent not in room', () => {
    const room = new WarRoom('room_w');
    expect(room.getAgentDuration('agent_nonexistent')).toBeNull();
  });

  it('cleans up entry time on onAgentExit', () => {
    const room = new WarRoom('room_w');
    const bus = createMockBus();
    room.setBus(bus);

    room.onAgentEnter('agent_1', 'boardroom');
    expect(room.getAgentDuration('agent_1')).not.toBeNull();

    room.onAgentExit('agent_1');
    expect(room.getAgentDuration('agent_1')).toBeNull();
  });

  it('emits agent:status-changed events via super', () => {
    const room = new WarRoom('room_w');
    const bus = createMockBus();
    room.setBus(bus);

    room.onAgentEnter('agent_1', 'boardroom');
    const entered = bus._emissions.find((e) => e.event === 'agent:status-changed');
    expect(entered).toBeDefined();
    expect((entered!.data as Record<string, unknown>).status).toBe('active');
  });
});

// ─── Plugin Bay Destructive Operation Warning ───

describe('PluginBayRoom onBeforeToolCall', () => {
  it('emits warning on uninstall_plugin', () => {
    const room = new PluginBayRoom('room_p');
    const bus = createMockBus();
    room.setBus(bus);

    const result = room.onBeforeToolCall('uninstall_plugin', 'agent_1', { name: 'my-plugin' });

    // Does not block
    expect(result.ok).toBe(true);

    // But emits warning
    const warning = bus._emissions.find((e) => e.event === 'room:warning');
    expect(warning).toBeDefined();
    expect((warning!.data as Record<string, unknown>).warning).toContain('my-plugin');
  });

  it('does not emit warning on install_plugin', () => {
    const room = new PluginBayRoom('room_p');
    const bus = createMockBus();
    room.setBus(bus);

    room.onBeforeToolCall('install_plugin', 'agent_1', { name: 'new-plugin' });

    const warning = bus._emissions.find((e) => e.event === 'room:warning');
    expect(warning).toBeUndefined();
  });
});

// ─── Data Exchange Schema Validation Tracking ───

describe('DataExchangeRoom behavioral logic', () => {
  it('emits warning when exporting without prior schema validation', () => {
    const room = new DataExchangeRoom('room_de');
    const bus = createMockBus();
    room.setBus(bus);

    room.onBeforeToolCall('export_data', 'agent_1', { target: 'api' });

    const warning = bus._emissions.find((e) => e.event === 'room:warning');
    expect(warning).toBeDefined();
    expect((warning!.data as Record<string, unknown>).warning).toContain('schema validation');
  });

  it('does not warn about export after successful schema validation', () => {
    const room = new DataExchangeRoom('room_de');
    const bus = createMockBus();
    room.setBus(bus);

    // Run a successful schema validation
    room.onAfterToolCall('validate_schema', 'agent_1', ok({ valid: true }));

    // Clear emissions
    bus._emissions.length = 0;

    // Now export — should not warn
    room.onBeforeToolCall('export_data', 'agent_1', { target: 'api' });

    const warning = bus._emissions.find((e) => e.event === 'room:warning');
    expect(warning).toBeUndefined();
  });

  it('emits escalation on schema validation failure', () => {
    const room = new DataExchangeRoom('room_de');
    const bus = createMockBus();
    room.setBus(bus);

    room.onAfterToolCall('validate_schema', 'agent_1', {
      ok: false, error: { code: 'SCHEMA_INVALID', message: 'Missing required field', retryable: false },
    });

    const escalation = bus._emissions.find((e) => e.event === 'room:escalation:suggested');
    expect(escalation).toBeDefined();
  });
});

// ─── Provider Hub Fallback Chain Validation ───

describe('ProviderHubRoom exit document validation', () => {
  it('rejects circular fallback chain (primary in own fallbacks)', () => {
    const room = new ProviderHubRoom('room_ph');
    const result = room.validateExitDocument({
      activeProviders: [{ name: 'anthropic', model: 'claude', status: 'active' }],
      fallbackChains: [{ primary: 'anthropic', fallbacks: ['openai', 'anthropic'], priority: 1 }],
      comparisonResults: [],
      configurationChanges: [],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('anthropic');
      expect(result.error.message).toContain('fallback');
    }
  });

  it('accepts valid fallback chain', () => {
    const room = new ProviderHubRoom('room_ph');
    const result = room.validateExitDocument({
      activeProviders: [{ name: 'anthropic', model: 'claude', status: 'active' }],
      fallbackChains: [{ primary: 'anthropic', fallbacks: ['openai', 'mistral'], priority: 1 }],
      comparisonResults: [],
      configurationChanges: [],
    });
    expect(result.ok).toBe(true);
  });

  it('accepts empty fallback chains', () => {
    const room = new ProviderHubRoom('room_ph');
    const result = room.validateExitDocument({
      activeProviders: [{ name: 'anthropic', model: 'claude', status: 'active' }],
      fallbackChains: [],
      comparisonResults: [],
      configurationChanges: [],
    });
    expect(result.ok).toBe(true);
  });
});

// ─── Testing Lab Behavioral Logic ───

describe('TestingLab behavioral logic', () => {
  it('has no write tools in contract (structural enforcement)', () => {
    expect(TestingLab.contract.tools).not.toContain('write_file');
    expect(TestingLab.contract.tools).not.toContain('patch_file');
  });

  it('emits escalation on qa_run_tests failure', () => {
    const room = new TestingLab('room_tl');
    const bus = createMockBus();
    room.setBus(bus);

    room.onAfterToolCall('qa_run_tests', 'agent_1', {
      ok: false, error: { code: 'TEST_FAILED', message: '3 tests failed', retryable: false },
    });

    const escalation = bus._emissions.find((e) => e.event === 'room:escalation:suggested');
    expect(escalation).toBeDefined();
    expect((escalation!.data as Record<string, unknown>).targetRoom).toBe('code-lab');
  });

  it('does not emit escalation on read_file (non-qa tool)', () => {
    const room = new TestingLab('room_tl');
    const bus = createMockBus();
    room.setBus(bus);

    room.onAfterToolCall('read_file', 'agent_1', {
      ok: false, error: { code: 'READ_FAILED', message: 'File not found', retryable: false },
    });

    const escalation = bus._emissions.find((e) => e.event === 'room:escalation:suggested');
    expect(escalation).toBeUndefined();
  });

  it('validates testsRun + testsPassed + testsFailed sum', () => {
    const room = new TestingLab('room_tl');
    const result = room.validateExitDocument({
      testsRun: 10,
      testsPassed: 8,
      testsFailed: 3, // 8 + 3 = 11, not 10
      coverage: { lines: 80, branches: 70 },
      lintErrors: 0,
      recommendations: ['Add more tests'],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('testsPassed');
  });
});
