/**
 * Provider Hub Room Tests
 *
 * Verifies the Provider Hub room contract — Integration Floor.
 * Multi-provider AI orchestration, model comparison, fallback configuration.
 */

import { describe, it, expect } from 'vitest';
import { EventEmitter } from 'eventemitter3';
import type { Bus } from '../../../src/core/bus.js';
import { ok, err } from '../../../src/core/contracts.js';
import { ProviderHubRoom } from '../../../src/rooms/room-types/provider-hub.js';

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

describe('ProviderHubRoom', () => {
  describe('contract', () => {
    const contract = ProviderHubRoom.contract;

    it('has correct room type and floor', () => {
      expect(contract.roomType).toBe('provider-hub');
      expect(contract.floor).toBe('integration');
    });

    it('has 3 tables: orchestration, comparison, configuration', () => {
      expect(Object.keys(contract.tables)).toHaveLength(3);
      expect(contract.tables.orchestration).toBeDefined();
      expect(contract.tables.orchestration.chairs).toBe(2);
      expect(contract.tables.comparison).toBeDefined();
      expect(contract.tables.comparison.chairs).toBe(4);
      expect(contract.tables.configuration).toBeDefined();
      expect(contract.tables.configuration.chairs).toBe(2);
    });

    it('has assigned file scope', () => {
      expect(contract.fileScope).toBe('assigned');
    });

    it('provides 4 provider hub tools', () => {
      expect(contract.tools).toHaveLength(4);
      expect(contract.tools).toContain('switch_provider');
      expect(contract.tools).toContain('compare_models');
      expect(contract.tools).toContain('configure_fallback');
      expect(contract.tools).toContain('test_provider');
    });

    it('requires provider-configuration-summary exit template with 4 fields', () => {
      expect(contract.exitRequired.type).toBe('provider-configuration-summary');
      expect(contract.exitRequired.fields).toHaveLength(4);
      expect(contract.exitRequired.fields).toEqual([
        'activeProviders',
        'fallbackChains',
        'comparisonResults',
        'configurationChanges',
      ]);
    });

    it('escalates to war-room on error and discovery on scope change', () => {
      expect(contract.escalation.onError).toBe('war-room');
      expect(contract.escalation.onScopeChange).toBe('discovery');
    });

    it('has configurable provider', () => {
      expect(contract.provider).toBe('configurable');
    });
  });

  describe('instance behavior', () => {
    it('creates instance with correct type', () => {
      const room = new ProviderHubRoom('room_1');
      expect(room.type).toBe('provider-hub');
    });

    it('getAllowedTools returns 4 tools', () => {
      const room = new ProviderHubRoom('room_1');
      expect(room.getAllowedTools()).toHaveLength(4);
    });

    it('getRules mentions Provider Hub and fallback', () => {
      const room = new ProviderHubRoom('room_1');
      const rules = room.getRules();
      expect(rules.some((r) => r.includes('Provider Hub'))).toBe(true);
      expect(rules.some((r) => r.includes('fallback'))).toBe(true);
    });

    it('getOutputFormat returns provider config shape', () => {
      const room = new ProviderHubRoom('room_1');
      const format = room.getOutputFormat() as Record<string, unknown>;
      expect(format).toHaveProperty('activeProviders');
      expect(format).toHaveProperty('fallbackChains');
      expect(format).toHaveProperty('comparisonResults');
      expect(format).toHaveProperty('configurationChanges');
    });
  });

  describe('exit document validation', () => {
    it('accepts complete provider configuration summary', () => {
      const room = new ProviderHubRoom('room_1');
      const result = room.validateExitDocument({
        activeProviders: [{ name: 'anthropic', model: 'claude-3', status: 'active' }],
        fallbackChains: [{ primary: 'anthropic', fallbacks: ['openai'], priority: 1 }],
        comparisonResults: [{ model: 'claude-3', latency: 200, quality: 'high', cost: '$0.01' }],
        configurationChanges: [{ provider: 'anthropic', setting: 'model', oldValue: 'claude-2', newValue: 'claude-3' }],
      });
      expect(result.ok).toBe(true);
    });

    it('accepts empty fallbackChains (single provider)', () => {
      const room = new ProviderHubRoom('room_1');
      const result = room.validateExitDocument({
        activeProviders: [{ name: 'anthropic', model: 'claude-3', status: 'active' }],
        fallbackChains: [],
        comparisonResults: [],
        configurationChanges: [],
      });
      expect(result.ok).toBe(true);
    });

    it('rejects empty activeProviders', () => {
      const room = new ProviderHubRoom('room_1');
      const result = room.validateExitDocument({
        activeProviders: [],
        fallbackChains: [],
        comparisonResults: [],
        configurationChanges: [],
      });
      expect(result.ok).toBe(false);
      expect(result.error.message).toContain('activeProviders');
    });

    it('rejects non-array activeProviders', () => {
      const room = new ProviderHubRoom('room_1');
      const result = room.validateExitDocument({
        activeProviders: 'not an array',
        fallbackChains: [],
        comparisonResults: [],
        configurationChanges: [],
      });
      expect(result.ok).toBe(false);
      expect(result.error.message).toContain('activeProviders');
    });

    it('rejects non-array fallbackChains', () => {
      const room = new ProviderHubRoom('room_1');
      const result = room.validateExitDocument({
        activeProviders: [{ name: 'a' }],
        fallbackChains: 'not an array',
        comparisonResults: [],
        configurationChanges: [],
      });
      expect(result.ok).toBe(false);
      expect(result.error.message).toContain('fallbackChains');
    });

    it('rejects non-array comparisonResults', () => {
      const room = new ProviderHubRoom('room_1');
      const result = room.validateExitDocument({
        activeProviders: [{ name: 'a' }],
        fallbackChains: [],
        comparisonResults: 'not an array',
        configurationChanges: [],
      });
      expect(result.ok).toBe(false);
      expect(result.error.message).toContain('comparisonResults');
    });

    it('rejects non-array configurationChanges', () => {
      const room = new ProviderHubRoom('room_1');
      const result = room.validateExitDocument({
        activeProviders: [{ name: 'a' }],
        fallbackChains: [],
        comparisonResults: [],
        configurationChanges: 'not an array',
      });
      expect(result.ok).toBe(false);
      expect(result.error.message).toContain('configurationChanges');
    });

    it('rejects fallback chain with circular reference', () => {
      const room = new ProviderHubRoom('room_1');
      const result = room.validateExitDocument({
        activeProviders: [{ name: 'anthropic' }],
        fallbackChains: [{ primary: 'anthropic', fallbacks: ['openai', 'anthropic'], priority: 1 }],
        comparisonResults: [],
        configurationChanges: [],
      });
      expect(result.ok).toBe(false);
      expect(result.error.message).toContain('cannot be in its own fallback list');
    });

    it('accepts fallback chain without circular reference', () => {
      const room = new ProviderHubRoom('room_1');
      const result = room.validateExitDocument({
        activeProviders: [{ name: 'anthropic' }],
        fallbackChains: [{ primary: 'anthropic', fallbacks: ['openai', 'ollama'], priority: 1 }],
        comparisonResults: [],
        configurationChanges: [],
      });
      expect(result.ok).toBe(true);
    });

    it('rejects document missing required fields (base validation)', () => {
      const room = new ProviderHubRoom('room_1');
      const result = room.validateExitDocument({
        activeProviders: [{ name: 'a' }],
        fallbackChains: [],
      });
      expect(result.ok).toBe(false);
      expect(result.error.code).toBe('EXIT_DOC_INCOMPLETE');
    });
  });

  describe('onAfterToolCall — escalation suggestions', () => {
    it('emits escalation on test_provider failure', () => {
      const bus = createMockBus();
      const room = new ProviderHubRoom('room_1');
      room.setBus(bus);

      room.onAfterToolCall('test_provider', 'agent_1', err('PROVIDER_FAILED', 'Connection refused'));

      const esc = bus._emissions.find((e) => e.event === 'room:escalation:suggested');
      expect(esc).toBeDefined();
      expect((esc!.data as Record<string, unknown>).condition).toBe('onError');
      expect((esc!.data as Record<string, unknown>).targetRoom).toBe('war-room');
      expect((esc!.data as Record<string, unknown>).reason).toContain('Provider test failed');
    });

    it('emits escalation on switch_provider failure', () => {
      const bus = createMockBus();
      const room = new ProviderHubRoom('room_1');
      room.setBus(bus);

      room.onAfterToolCall('switch_provider', 'agent_1', err('SWITCH_FAILED', 'Provider not found'));

      const esc = bus._emissions.find((e) => e.event === 'room:escalation:suggested');
      expect(esc).toBeDefined();
      expect((esc!.data as Record<string, unknown>).reason).toContain('Provider switch failed');
    });

    it('does not emit escalation on successful test_provider', () => {
      const bus = createMockBus();
      const room = new ProviderHubRoom('room_1');
      room.setBus(bus);

      room.onAfterToolCall('test_provider', 'agent_1', ok({ status: 'connected' }));

      const esc = bus._emissions.find((e) => e.event === 'room:escalation:suggested');
      expect(esc).toBeUndefined();
    });

    it('does not emit escalation for other tool failures', () => {
      const bus = createMockBus();
      const room = new ProviderHubRoom('room_1');
      room.setBus(bus);

      room.onAfterToolCall('compare_models', 'agent_1', err('COMPARE_FAILED', 'Error'));

      const esc = bus._emissions.find((e) => e.event === 'room:escalation:suggested');
      expect(esc).toBeUndefined();
    });
  });
});
