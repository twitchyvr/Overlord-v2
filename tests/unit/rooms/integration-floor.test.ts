/**
 * Integration Floor Room Type Tests
 *
 * Verifies all 3 Integration Floor room types:
 * - DataExchangeRoom — external data ingestion, transformation, export
 * - ProviderHubRoom — multi-provider AI orchestration and fallback
 * - PluginBayRoom — plugin lifecycle management
 *
 * Each room type is tested for:
 * - Contract correctness (type, floor, tables, tools, exit template, escalation)
 * - Instance behavior (constructor, allowed tools, rules, output format, context)
 * - Exit document validation (valid passes, invalid fails with correct errors)
 * - onAfterToolCall escalation suggestions
 */

import { describe, it, expect, vi } from 'vitest';
import { DataExchangeRoom } from '../../../src/rooms/room-types/data-exchange.js';
import { ProviderHubRoom } from '../../../src/rooms/room-types/provider-hub.js';
import { PluginBayRoom } from '../../../src/rooms/room-types/plugin-bay.js';
import { err } from '../../../src/core/contracts.js';
import type { Bus } from '../../../src/core/bus.js';

// ─── Helper: create a mock Bus for testing event emission ───

function createMockBus(): Bus {
  return {
    emit: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    onNamespace: vi.fn(),
    offNamespace: vi.fn(),
  } as unknown as Bus;
}

// ═══════════════════════════════════════════════════════════
// DataExchangeRoom
// ═══════════════════════════════════════════════════════════

describe('DataExchangeRoom', () => {
  describe('contract', () => {
    const contract = DataExchangeRoom.contract;

    it('has correct room type', () => {
      expect(contract.roomType).toBe('data-exchange');
    });

    it('belongs to integration floor', () => {
      expect(contract.floor).toBe('integration');
    });

    it('has three tables: ingestion, transformation, export', () => {
      const tableNames = Object.keys(contract.tables);
      expect(tableNames).toHaveLength(3);
      expect(tableNames).toContain('ingestion');
      expect(tableNames).toContain('transformation');
      expect(tableNames).toContain('export');
    });

    it('ingestion table has 2 chairs', () => {
      expect(contract.tables.ingestion.chairs).toBe(2);
    });

    it('transformation table has 4 chairs', () => {
      expect(contract.tables.transformation.chairs).toBe(4);
    });

    it('export table has 2 chairs', () => {
      expect(contract.tables.export.chairs).toBe(2);
    });

    it('has correct tools: fetch_url, transform_data, export_data, validate_schema', () => {
      expect(contract.tools).toHaveLength(4);
      expect(contract.tools).toContain('fetch_url');
      expect(contract.tools).toContain('transform_data');
      expect(contract.tools).toContain('export_data');
      expect(contract.tools).toContain('validate_schema');
    });

    it('has assigned file scope', () => {
      expect(contract.fileScope).toBe('assigned');
    });

    it('requires data-flow-summary exit template with 4 fields', () => {
      expect(contract.exitRequired.type).toBe('data-flow-summary');
      expect(contract.exitRequired.fields).toHaveLength(4);
      expect(contract.exitRequired.fields).toEqual([
        'sources',
        'transformationsApplied',
        'outputs',
        'validationResults',
      ]);
    });

    it('escalates to war-room on error and discovery on scope change', () => {
      expect(contract.escalation).toEqual({
        onError: 'war-room',
        onScopeChange: 'discovery',
      });
    });

    it('uses configurable provider', () => {
      expect(contract.provider).toBe('configurable');
    });
  });

  describe('instance behavior', () => {
    it('creates instance with correct type', () => {
      const room = new DataExchangeRoom('room_de_1');
      expect(room.type).toBe('data-exchange');
      expect(room.id).toBe('room_de_1');
    });

    it('getAllowedTools returns all 4 data exchange tools', () => {
      const room = new DataExchangeRoom('room_de_1');
      const tools = room.getAllowedTools();
      expect(tools).toHaveLength(4);
      expect(tools).toContain('fetch_url');
      expect(tools).toContain('transform_data');
      expect(tools).toContain('export_data');
      expect(tools).toContain('validate_schema');
    });

    it('hasTool returns true for data exchange tools', () => {
      const room = new DataExchangeRoom('room_de_1');
      expect(room.hasTool('fetch_url')).toBe(true);
      expect(room.hasTool('transform_data')).toBe(true);
      expect(room.hasTool('export_data')).toBe(true);
      expect(room.hasTool('validate_schema')).toBe(true);
    });

    it('hasTool returns false for tools not in the room', () => {
      const room = new DataExchangeRoom('room_de_1');
      expect(room.hasTool('write_file')).toBe(false);
      expect(room.hasTool('bash')).toBe(false);
      expect(room.hasTool('install_plugin')).toBe(false);
    });

    it('getRules returns data-exchange-specific rules', () => {
      const room = new DataExchangeRoom('room_de_1');
      const rules = room.getRules();
      expect(rules.length).toBeGreaterThan(0);
      expect(rules.some((r) => r.includes('Data Exchange'))).toBe(true);
      expect(rules.some((r) => r.includes('schema'))).toBe(true);
    });

    it('getOutputFormat returns data flow summary shape', () => {
      const room = new DataExchangeRoom('room_de_1');
      const format = room.getOutputFormat() as Record<string, unknown>;
      expect(format).toHaveProperty('sources');
      expect(format).toHaveProperty('transformationsApplied');
      expect(format).toHaveProperty('outputs');
      expect(format).toHaveProperty('validationResults');
    });

    it('buildContextInjection includes all room metadata', () => {
      const room = new DataExchangeRoom('room_de_1');
      const ctx = room.buildContextInjection();
      expect(ctx.roomType).toBe('data-exchange');
      expect(ctx.fileScope).toBe('assigned');
      expect((ctx.tools as string[])).toHaveLength(4);
      expect(ctx.rules).toEqual(room.getRules());
      expect(ctx.exitTemplate).toEqual(DataExchangeRoom.contract.exitRequired);
      expect(ctx.outputFormat).toEqual(room.getOutputFormat());
      expect(ctx.escalation).toEqual({ onError: 'war-room', onScopeChange: 'discovery' });
    });
  });

  describe('exit document validation', () => {
    it('accepts a complete, valid exit document', () => {
      const room = new DataExchangeRoom('room_de_1');
      const result = room.validateExitDocument({
        sources: [{ name: 'api-v1', type: 'REST', recordCount: 500 }],
        transformationsApplied: [{ step: 'normalize', description: 'Flatten nested objects', recordsAffected: 500 }],
        outputs: [{ target: 'warehouse', format: 'parquet', recordCount: 500 }],
        validationResults: { passed: 498, failed: 2, errors: ['Invalid date format in 2 records'] },
      });
      expect(result.ok).toBe(true);
    });

    it('accepts exit document with empty transformationsApplied (pass-through)', () => {
      const room = new DataExchangeRoom('room_de_1');
      const result = room.validateExitDocument({
        sources: [{ name: 'csv-import', type: 'file', recordCount: 100 }],
        transformationsApplied: [],
        outputs: [{ target: 'db', format: 'json', recordCount: 100 }],
        validationResults: { passed: 100, failed: 0, errors: [] },
      });
      expect(result.ok).toBe(true);
    });

    it('rejects exit document missing required fields (base validation)', () => {
      const room = new DataExchangeRoom('room_de_1');
      const result = room.validateExitDocument({
        sources: [{ name: 'api', type: 'REST', recordCount: 10 }],
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('EXIT_DOC_INCOMPLETE');
        expect(result.error.message).toContain('transformationsApplied');
      }
    });

    it('rejects empty sources array', () => {
      const room = new DataExchangeRoom('room_de_1');
      const result = room.validateExitDocument({
        sources: [],
        transformationsApplied: [],
        outputs: [{ target: 'db', format: 'json', recordCount: 10 }],
        validationResults: { passed: 10, failed: 0, errors: [] },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('EXIT_DOC_INVALID');
        expect(result.error.message).toContain('sources');
      }
    });

    it('rejects non-array sources', () => {
      const room = new DataExchangeRoom('room_de_1');
      const result = room.validateExitDocument({
        sources: 'not-an-array',
        transformationsApplied: [],
        outputs: [{ target: 'db', format: 'json', recordCount: 10 }],
        validationResults: { passed: 10, failed: 0, errors: [] },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('sources');
      }
    });

    it('rejects non-array transformationsApplied', () => {
      const room = new DataExchangeRoom('room_de_1');
      const result = room.validateExitDocument({
        sources: [{ name: 'api', type: 'REST', recordCount: 10 }],
        transformationsApplied: 'not-an-array',
        outputs: [{ target: 'db', format: 'json', recordCount: 10 }],
        validationResults: { passed: 10, failed: 0, errors: [] },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('transformationsApplied');
      }
    });

    it('rejects empty outputs array', () => {
      const room = new DataExchangeRoom('room_de_1');
      const result = room.validateExitDocument({
        sources: [{ name: 'api', type: 'REST', recordCount: 10 }],
        transformationsApplied: [],
        outputs: [],
        validationResults: { passed: 10, failed: 0, errors: [] },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('outputs');
      }
    });

    it('rejects non-object validationResults', () => {
      const room = new DataExchangeRoom('room_de_1');
      const result = room.validateExitDocument({
        sources: [{ name: 'api', type: 'REST', recordCount: 10 }],
        transformationsApplied: [],
        outputs: [{ target: 'db', format: 'json', recordCount: 10 }],
        validationResults: 'not-an-object',
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('validationResults');
      }
    });

    it('rejects validationResults without numeric passed/failed', () => {
      const room = new DataExchangeRoom('room_de_1');
      const result = room.validateExitDocument({
        sources: [{ name: 'api', type: 'REST', recordCount: 10 }],
        transformationsApplied: [],
        outputs: [{ target: 'db', format: 'json', recordCount: 10 }],
        validationResults: { passed: 'all', failed: 'none', errors: [] },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('passed');
        expect(result.error.message).toContain('failed');
      }
    });
  });

  describe('onAfterToolCall — escalation suggestions', () => {
    it('emits escalation when validate_schema fails', () => {
      const room = new DataExchangeRoom('room_de_1');
      const mockBus = createMockBus();
      room.setBus(mockBus);

      const failResult = err('VALIDATION_FAILED', 'Schema mismatch on field "email"');
      room.onAfterToolCall('validate_schema', 'agent_1', failResult);

      expect(mockBus.emit).toHaveBeenCalledWith('room:escalation:suggested', expect.objectContaining({
        roomId: 'room_de_1',
        roomType: 'data-exchange',
        agentId: 'agent_1',
        condition: 'onError',
        targetRoom: 'war-room',
        reason: expect.stringContaining('Schema validation failed'),
      }));
    });

    it('emits escalation when fetch_url fails', () => {
      const room = new DataExchangeRoom('room_de_1');
      const mockBus = createMockBus();
      room.setBus(mockBus);

      const failResult = err('FETCH_FAILED', 'Connection timeout');
      room.onAfterToolCall('fetch_url', 'agent_2', failResult);

      expect(mockBus.emit).toHaveBeenCalledWith('room:escalation:suggested', expect.objectContaining({
        roomId: 'room_de_1',
        roomType: 'data-exchange',
        agentId: 'agent_2',
        condition: 'onError',
        targetRoom: 'war-room',
        reason: expect.stringContaining('Data fetch failed'),
      }));
    });

    it('does NOT emit escalation for successful tool calls', () => {
      const room = new DataExchangeRoom('room_de_1');
      const mockBus = createMockBus();
      room.setBus(mockBus);

      const okResult = { ok: true as const, data: { valid: true } };
      room.onAfterToolCall('validate_schema', 'agent_1', okResult);

      expect(mockBus.emit).not.toHaveBeenCalled();
    });

    it('does NOT emit escalation for unrelated tool failures', () => {
      const room = new DataExchangeRoom('room_de_1');
      const mockBus = createMockBus();
      room.setBus(mockBus);

      const failResult = err('EXPORT_FAILED', 'Disk full');
      room.onAfterToolCall('export_data', 'agent_1', failResult);

      expect(mockBus.emit).not.toHaveBeenCalled();
    });
  });
});

// ═══════════════════════════════════════════════════════════
// ProviderHubRoom
// ═══════════════════════════════════════════════════════════

describe('ProviderHubRoom', () => {
  describe('contract', () => {
    const contract = ProviderHubRoom.contract;

    it('has correct room type', () => {
      expect(contract.roomType).toBe('provider-hub');
    });

    it('belongs to integration floor', () => {
      expect(contract.floor).toBe('integration');
    });

    it('has three tables: orchestration, comparison, configuration', () => {
      const tableNames = Object.keys(contract.tables);
      expect(tableNames).toHaveLength(3);
      expect(tableNames).toContain('orchestration');
      expect(tableNames).toContain('comparison');
      expect(tableNames).toContain('configuration');
    });

    it('orchestration table has 2 chairs', () => {
      expect(contract.tables.orchestration.chairs).toBe(2);
    });

    it('comparison table has 4 chairs', () => {
      expect(contract.tables.comparison.chairs).toBe(4);
    });

    it('configuration table has 2 chairs', () => {
      expect(contract.tables.configuration.chairs).toBe(2);
    });

    it('has correct tools: switch_provider, compare_models, configure_fallback, test_provider', () => {
      expect(contract.tools).toHaveLength(4);
      expect(contract.tools).toContain('switch_provider');
      expect(contract.tools).toContain('compare_models');
      expect(contract.tools).toContain('configure_fallback');
      expect(contract.tools).toContain('test_provider');
    });

    it('has assigned file scope', () => {
      expect(contract.fileScope).toBe('assigned');
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
      expect(contract.escalation).toEqual({
        onError: 'war-room',
        onScopeChange: 'discovery',
      });
    });

    it('uses configurable provider', () => {
      expect(contract.provider).toBe('configurable');
    });
  });

  describe('instance behavior', () => {
    it('creates instance with correct type', () => {
      const room = new ProviderHubRoom('room_ph_1');
      expect(room.type).toBe('provider-hub');
      expect(room.id).toBe('room_ph_1');
    });

    it('getAllowedTools returns all 4 provider hub tools', () => {
      const room = new ProviderHubRoom('room_ph_1');
      const tools = room.getAllowedTools();
      expect(tools).toHaveLength(4);
      expect(tools).toContain('switch_provider');
      expect(tools).toContain('compare_models');
      expect(tools).toContain('configure_fallback');
      expect(tools).toContain('test_provider');
    });

    it('hasTool returns true for provider hub tools', () => {
      const room = new ProviderHubRoom('room_ph_1');
      expect(room.hasTool('switch_provider')).toBe(true);
      expect(room.hasTool('compare_models')).toBe(true);
      expect(room.hasTool('configure_fallback')).toBe(true);
      expect(room.hasTool('test_provider')).toBe(true);
    });

    it('hasTool returns false for tools not in the room', () => {
      const room = new ProviderHubRoom('room_ph_1');
      expect(room.hasTool('write_file')).toBe(false);
      expect(room.hasTool('fetch_url')).toBe(false);
      expect(room.hasTool('install_plugin')).toBe(false);
    });

    it('getRules returns provider-hub-specific rules', () => {
      const room = new ProviderHubRoom('room_ph_1');
      const rules = room.getRules();
      expect(rules.length).toBeGreaterThan(0);
      expect(rules.some((r) => r.includes('Provider Hub'))).toBe(true);
      expect(rules.some((r) => r.includes('fallback'))).toBe(true);
    });

    it('getOutputFormat returns provider configuration summary shape', () => {
      const room = new ProviderHubRoom('room_ph_1');
      const format = room.getOutputFormat() as Record<string, unknown>;
      expect(format).toHaveProperty('activeProviders');
      expect(format).toHaveProperty('fallbackChains');
      expect(format).toHaveProperty('comparisonResults');
      expect(format).toHaveProperty('configurationChanges');
    });

    it('buildContextInjection includes all room metadata', () => {
      const room = new ProviderHubRoom('room_ph_1');
      const ctx = room.buildContextInjection();
      expect(ctx.roomType).toBe('provider-hub');
      expect(ctx.fileScope).toBe('assigned');
      expect((ctx.tools as string[])).toHaveLength(4);
      expect(ctx.rules).toEqual(room.getRules());
      expect(ctx.exitTemplate).toEqual(ProviderHubRoom.contract.exitRequired);
      expect(ctx.outputFormat).toEqual(room.getOutputFormat());
      expect(ctx.escalation).toEqual({ onError: 'war-room', onScopeChange: 'discovery' });
    });
  });

  describe('exit document validation', () => {
    it('accepts a complete, valid exit document', () => {
      const room = new ProviderHubRoom('room_ph_1');
      const result = room.validateExitDocument({
        activeProviders: [{ name: 'anthropic', model: 'claude-opus-4-20250514', status: 'active' }],
        fallbackChains: [{ primary: 'anthropic', fallbacks: ['openai'], priority: 1 }],
        comparisonResults: [{ model: 'claude-opus-4-20250514', latency: 1200, quality: 'excellent', cost: '$0.015/1k' }],
        configurationChanges: [{ provider: 'anthropic', setting: 'max_tokens', oldValue: '4096', newValue: '8192' }],
      });
      expect(result.ok).toBe(true);
    });

    it('accepts exit document with empty fallbackChains (single-provider)', () => {
      const room = new ProviderHubRoom('room_ph_1');
      const result = room.validateExitDocument({
        activeProviders: [{ name: 'anthropic', model: 'claude-opus-4-20250514', status: 'active' }],
        fallbackChains: [],
        comparisonResults: [],
        configurationChanges: [],
      });
      expect(result.ok).toBe(true);
    });

    it('rejects exit document missing required fields (base validation)', () => {
      const room = new ProviderHubRoom('room_ph_1');
      const result = room.validateExitDocument({
        activeProviders: [{ name: 'openai', model: 'gpt-4', status: 'active' }],
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('EXIT_DOC_INCOMPLETE');
        expect(result.error.message).toContain('fallbackChains');
      }
    });

    it('rejects empty activeProviders array', () => {
      const room = new ProviderHubRoom('room_ph_1');
      const result = room.validateExitDocument({
        activeProviders: [],
        fallbackChains: [],
        comparisonResults: [],
        configurationChanges: [],
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('EXIT_DOC_INVALID');
        expect(result.error.message).toContain('activeProviders');
      }
    });

    it('rejects non-array activeProviders', () => {
      const room = new ProviderHubRoom('room_ph_1');
      const result = room.validateExitDocument({
        activeProviders: 'anthropic',
        fallbackChains: [],
        comparisonResults: [],
        configurationChanges: [],
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('activeProviders');
      }
    });

    it('rejects non-array fallbackChains', () => {
      const room = new ProviderHubRoom('room_ph_1');
      const result = room.validateExitDocument({
        activeProviders: [{ name: 'anthropic', model: 'claude-opus-4-20250514', status: 'active' }],
        fallbackChains: 'not-an-array',
        comparisonResults: [],
        configurationChanges: [],
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('fallbackChains');
      }
    });

    it('rejects non-array comparisonResults', () => {
      const room = new ProviderHubRoom('room_ph_1');
      const result = room.validateExitDocument({
        activeProviders: [{ name: 'anthropic', model: 'claude-opus-4-20250514', status: 'active' }],
        fallbackChains: [],
        comparisonResults: 'not-an-array',
        configurationChanges: [],
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('comparisonResults');
      }
    });

    it('rejects non-array configurationChanges', () => {
      const room = new ProviderHubRoom('room_ph_1');
      const result = room.validateExitDocument({
        activeProviders: [{ name: 'anthropic', model: 'claude-opus-4-20250514', status: 'active' }],
        fallbackChains: [],
        comparisonResults: [],
        configurationChanges: { change: 'one' },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('configurationChanges');
      }
    });
  });

  describe('onAfterToolCall — escalation suggestions', () => {
    it('emits escalation when test_provider fails', () => {
      const room = new ProviderHubRoom('room_ph_1');
      const mockBus = createMockBus();
      room.setBus(mockBus);

      const failResult = err('PROVIDER_ERROR', 'Connection refused to OpenAI endpoint');
      room.onAfterToolCall('test_provider', 'agent_1', failResult);

      expect(mockBus.emit).toHaveBeenCalledWith('room:escalation:suggested', expect.objectContaining({
        roomId: 'room_ph_1',
        roomType: 'provider-hub',
        agentId: 'agent_1',
        condition: 'onError',
        targetRoom: 'war-room',
        reason: expect.stringContaining('Provider test failed'),
      }));
    });

    it('emits escalation when switch_provider fails', () => {
      const room = new ProviderHubRoom('room_ph_1');
      const mockBus = createMockBus();
      room.setBus(mockBus);

      const failResult = err('SWITCH_FAILED', 'Invalid API key for target provider');
      room.onAfterToolCall('switch_provider', 'agent_2', failResult);

      expect(mockBus.emit).toHaveBeenCalledWith('room:escalation:suggested', expect.objectContaining({
        roomId: 'room_ph_1',
        roomType: 'provider-hub',
        agentId: 'agent_2',
        condition: 'onError',
        targetRoom: 'war-room',
        reason: expect.stringContaining('Provider switch failed'),
      }));
    });

    it('does NOT emit escalation for successful tool calls', () => {
      const room = new ProviderHubRoom('room_ph_1');
      const mockBus = createMockBus();
      room.setBus(mockBus);

      const okResult = { ok: true as const, data: { connected: true } };
      room.onAfterToolCall('test_provider', 'agent_1', okResult);

      expect(mockBus.emit).not.toHaveBeenCalled();
    });

    it('does NOT emit escalation for unrelated tool failures', () => {
      const room = new ProviderHubRoom('room_ph_1');
      const mockBus = createMockBus();
      room.setBus(mockBus);

      const failResult = err('COMPARE_FAILED', 'Benchmark timeout');
      room.onAfterToolCall('compare_models', 'agent_1', failResult);

      expect(mockBus.emit).not.toHaveBeenCalled();
    });
  });
});

// ═══════════════════════════════════════════════════════════
// PluginBayRoom
// ═══════════════════════════════════════════════════════════

describe('PluginBayRoom', () => {
  describe('contract', () => {
    const contract = PluginBayRoom.contract;

    it('has correct room type', () => {
      expect(contract.roomType).toBe('plugin-bay');
    });

    it('belongs to integration floor', () => {
      expect(contract.floor).toBe('integration');
    });

    it('has three tables: management, testing, configuration', () => {
      const tableNames = Object.keys(contract.tables);
      expect(tableNames).toHaveLength(3);
      expect(tableNames).toContain('management');
      expect(tableNames).toContain('testing');
      expect(tableNames).toContain('configuration');
    });

    it('management table has 2 chairs', () => {
      expect(contract.tables.management.chairs).toBe(2);
    });

    it('testing table has 4 chairs', () => {
      expect(contract.tables.testing.chairs).toBe(4);
    });

    it('configuration table has 2 chairs', () => {
      expect(contract.tables.configuration.chairs).toBe(2);
    });

    it('has correct tools: install_plugin, uninstall_plugin, configure_plugin, test_plugin, list_plugins', () => {
      expect(contract.tools).toHaveLength(5);
      expect(contract.tools).toContain('install_plugin');
      expect(contract.tools).toContain('uninstall_plugin');
      expect(contract.tools).toContain('configure_plugin');
      expect(contract.tools).toContain('test_plugin');
      expect(contract.tools).toContain('list_plugins');
    });

    it('has assigned file scope', () => {
      expect(contract.fileScope).toBe('assigned');
    });

    it('requires plugin-inventory exit template with 4 fields', () => {
      expect(contract.exitRequired.type).toBe('plugin-inventory');
      expect(contract.exitRequired.fields).toHaveLength(4);
      expect(contract.exitRequired.fields).toEqual([
        'installedPlugins',
        'configuredPlugins',
        'testResults',
        'removedPlugins',
      ]);
    });

    it('escalates to war-room on error and discovery on scope change', () => {
      expect(contract.escalation).toEqual({
        onError: 'war-room',
        onScopeChange: 'discovery',
      });
    });

    it('uses configurable provider', () => {
      expect(contract.provider).toBe('configurable');
    });
  });

  describe('instance behavior', () => {
    it('creates instance with correct type', () => {
      const room = new PluginBayRoom('room_pb_1');
      expect(room.type).toBe('plugin-bay');
      expect(room.id).toBe('room_pb_1');
    });

    it('getAllowedTools returns all 5 plugin bay tools', () => {
      const room = new PluginBayRoom('room_pb_1');
      const tools = room.getAllowedTools();
      expect(tools).toHaveLength(5);
      expect(tools).toContain('install_plugin');
      expect(tools).toContain('uninstall_plugin');
      expect(tools).toContain('configure_plugin');
      expect(tools).toContain('test_plugin');
      expect(tools).toContain('list_plugins');
    });

    it('hasTool returns true for plugin bay tools', () => {
      const room = new PluginBayRoom('room_pb_1');
      expect(room.hasTool('install_plugin')).toBe(true);
      expect(room.hasTool('uninstall_plugin')).toBe(true);
      expect(room.hasTool('configure_plugin')).toBe(true);
      expect(room.hasTool('test_plugin')).toBe(true);
      expect(room.hasTool('list_plugins')).toBe(true);
    });

    it('hasTool returns false for tools not in the room', () => {
      const room = new PluginBayRoom('room_pb_1');
      expect(room.hasTool('write_file')).toBe(false);
      expect(room.hasTool('fetch_url')).toBe(false);
      expect(room.hasTool('switch_provider')).toBe(false);
    });

    it('getRules returns plugin-bay-specific rules', () => {
      const room = new PluginBayRoom('room_pb_1');
      const rules = room.getRules();
      expect(rules.length).toBeGreaterThan(0);
      expect(rules.some((r) => r.includes('Plugin Bay'))).toBe(true);
      expect(rules.some((r) => r.includes('plugin'))).toBe(true);
    });

    it('getOutputFormat returns plugin inventory shape', () => {
      const room = new PluginBayRoom('room_pb_1');
      const format = room.getOutputFormat() as Record<string, unknown>;
      expect(format).toHaveProperty('installedPlugins');
      expect(format).toHaveProperty('configuredPlugins');
      expect(format).toHaveProperty('testResults');
      expect(format).toHaveProperty('removedPlugins');
    });

    it('buildContextInjection includes all room metadata', () => {
      const room = new PluginBayRoom('room_pb_1');
      const ctx = room.buildContextInjection();
      expect(ctx.roomType).toBe('plugin-bay');
      expect(ctx.fileScope).toBe('assigned');
      expect((ctx.tools as string[])).toHaveLength(5);
      expect(ctx.rules).toEqual(room.getRules());
      expect(ctx.exitTemplate).toEqual(PluginBayRoom.contract.exitRequired);
      expect(ctx.outputFormat).toEqual(room.getOutputFormat());
      expect(ctx.escalation).toEqual({ onError: 'war-room', onScopeChange: 'discovery' });
    });
  });

  describe('exit document validation', () => {
    it('accepts a complete, valid exit document with all action types', () => {
      const room = new PluginBayRoom('room_pb_1');
      const result = room.validateExitDocument({
        installedPlugins: [{ name: 'slack-bridge', version: '2.1.0', status: 'active' }],
        configuredPlugins: [{ name: 'slack-bridge', settings: { channel: '#ops' } }],
        testResults: [{ plugin: 'slack-bridge', passed: true, details: 'All 12 assertions passed' }],
        removedPlugins: [{ name: 'old-notifier', reason: 'Replaced by slack-bridge' }],
      });
      expect(result.ok).toBe(true);
    });

    it('accepts exit document with only installations (no removals)', () => {
      const room = new PluginBayRoom('room_pb_1');
      const result = room.validateExitDocument({
        installedPlugins: [{ name: 'new-plugin', version: '1.0.0', status: 'active' }],
        configuredPlugins: [],
        testResults: [],
        removedPlugins: [],
      });
      expect(result.ok).toBe(true);
    });

    it('accepts exit document with only removals (no installations)', () => {
      const room = new PluginBayRoom('room_pb_1');
      const result = room.validateExitDocument({
        installedPlugins: [],
        configuredPlugins: [],
        testResults: [],
        removedPlugins: [{ name: 'deprecated-plugin', reason: 'No longer maintained' }],
      });
      expect(result.ok).toBe(true);
    });

    it('rejects exit document missing required fields (base validation)', () => {
      const room = new PluginBayRoom('room_pb_1');
      const result = room.validateExitDocument({
        installedPlugins: [{ name: 'x', version: '1.0', status: 'ok' }],
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('EXIT_DOC_INCOMPLETE');
        expect(result.error.message).toContain('configuredPlugins');
      }
    });

    it('rejects non-array installedPlugins', () => {
      const room = new PluginBayRoom('room_pb_1');
      const result = room.validateExitDocument({
        installedPlugins: 'not-an-array',
        configuredPlugins: [],
        testResults: [],
        removedPlugins: [],
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('installedPlugins');
      }
    });

    it('rejects non-array configuredPlugins', () => {
      const room = new PluginBayRoom('room_pb_1');
      const result = room.validateExitDocument({
        installedPlugins: [{ name: 'x', version: '1.0', status: 'ok' }],
        configuredPlugins: 'not-an-array',
        testResults: [],
        removedPlugins: [],
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('configuredPlugins');
      }
    });

    it('rejects non-array testResults', () => {
      const room = new PluginBayRoom('room_pb_1');
      const result = room.validateExitDocument({
        installedPlugins: [],
        configuredPlugins: [],
        testResults: { passed: true },
        removedPlugins: [{ name: 'x', reason: 'y' }],
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('testResults');
      }
    });

    it('rejects non-array removedPlugins', () => {
      const room = new PluginBayRoom('room_pb_1');
      const result = room.validateExitDocument({
        installedPlugins: [{ name: 'x', version: '1.0', status: 'ok' }],
        configuredPlugins: [],
        testResults: [],
        removedPlugins: 'not-an-array',
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('removedPlugins');
      }
    });

    it('rejects exit document where all arrays are empty (no actions performed)', () => {
      const room = new PluginBayRoom('room_pb_1');
      const result = room.validateExitDocument({
        installedPlugins: [],
        configuredPlugins: [],
        testResults: [],
        removedPlugins: [],
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('EXIT_DOC_INVALID');
        expect(result.error.message).toContain('At least one plugin action');
      }
    });
  });

  describe('onAfterToolCall — escalation suggestions', () => {
    it('emits escalation when install_plugin fails', () => {
      const room = new PluginBayRoom('room_pb_1');
      const mockBus = createMockBus();
      room.setBus(mockBus);

      const failResult = err('INSTALL_FAILED', 'Incompatible plugin version');
      room.onAfterToolCall('install_plugin', 'agent_1', failResult);

      expect(mockBus.emit).toHaveBeenCalledWith('room:escalation:suggested', expect.objectContaining({
        roomId: 'room_pb_1',
        roomType: 'plugin-bay',
        agentId: 'agent_1',
        condition: 'onError',
        targetRoom: 'war-room',
        reason: expect.stringContaining('Plugin installation failed'),
      }));
    });

    it('emits escalation when test_plugin fails', () => {
      const room = new PluginBayRoom('room_pb_1');
      const mockBus = createMockBus();
      room.setBus(mockBus);

      const failResult = err('TEST_FAILED', 'Plugin crashed during health check');
      room.onAfterToolCall('test_plugin', 'agent_2', failResult);

      expect(mockBus.emit).toHaveBeenCalledWith('room:escalation:suggested', expect.objectContaining({
        roomId: 'room_pb_1',
        roomType: 'plugin-bay',
        agentId: 'agent_2',
        condition: 'onError',
        targetRoom: 'war-room',
        reason: expect.stringContaining('Plugin test failed'),
      }));
    });

    it('does NOT emit escalation for successful tool calls', () => {
      const room = new PluginBayRoom('room_pb_1');
      const mockBus = createMockBus();
      room.setBus(mockBus);

      const okResult = { ok: true as const, data: { installed: true } };
      room.onAfterToolCall('install_plugin', 'agent_1', okResult);

      expect(mockBus.emit).not.toHaveBeenCalled();
    });

    it('does NOT emit escalation for unrelated tool failures', () => {
      const room = new PluginBayRoom('room_pb_1');
      const mockBus = createMockBus();
      room.setBus(mockBus);

      const failResult = err('UNINSTALL_FAILED', 'Plugin locked');
      room.onAfterToolCall('uninstall_plugin', 'agent_1', failResult);

      expect(mockBus.emit).not.toHaveBeenCalled();
    });

    it('does NOT emit escalation for configure_plugin failures', () => {
      const room = new PluginBayRoom('room_pb_1');
      const mockBus = createMockBus();
      room.setBus(mockBus);

      const failResult = err('CONFIG_FAILED', 'Invalid setting');
      room.onAfterToolCall('configure_plugin', 'agent_1', failResult);

      expect(mockBus.emit).not.toHaveBeenCalled();
    });
  });
});
