/**
 * Data Exchange Room Tests
 *
 * Verifies the Data Exchange room contract — Integration Floor.
 * External data ingestion, transformation, and export.
 * Schema validation tracking, escalation on failures.
 */

import { describe, it, expect } from 'vitest';
import { EventEmitter } from 'eventemitter3';
import type { Bus } from '../../../src/core/bus.js';
import { ok, err } from '../../../src/core/contracts.js';
import { DataExchangeRoom } from '../../../src/rooms/room-types/data-exchange.js';

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

describe('DataExchangeRoom', () => {
  describe('contract', () => {
    const contract = DataExchangeRoom.contract;

    it('has correct room type and floor', () => {
      expect(contract.roomType).toBe('data-exchange');
      expect(contract.floor).toBe('integration');
    });

    it('has 3 tables: ingestion, transformation, export', () => {
      expect(Object.keys(contract.tables)).toHaveLength(3);
      expect(contract.tables.ingestion).toBeDefined();
      expect(contract.tables.ingestion.chairs).toBe(2);
      expect(contract.tables.transformation).toBeDefined();
      expect(contract.tables.transformation.chairs).toBe(4);
      expect(contract.tables.export).toBeDefined();
      expect(contract.tables.export.chairs).toBe(2);
    });

    it('has assigned file scope', () => {
      expect(contract.fileScope).toBe('assigned');
    });

    it('provides 4 data exchange tools', () => {
      expect(contract.tools).toHaveLength(4);
      expect(contract.tools).toContain('fetch_url');
      expect(contract.tools).toContain('transform_data');
      expect(contract.tools).toContain('export_data');
      expect(contract.tools).toContain('validate_schema');
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
      expect(contract.escalation.onError).toBe('war-room');
      expect(contract.escalation.onScopeChange).toBe('discovery');
    });

    it('has configurable provider', () => {
      expect(contract.provider).toBe('configurable');
    });
  });

  describe('instance behavior', () => {
    it('creates instance with correct type', () => {
      const room = new DataExchangeRoom('room_1');
      expect(room.type).toBe('data-exchange');
    });

    it('getAllowedTools returns 4 tools', () => {
      const room = new DataExchangeRoom('room_1');
      expect(room.getAllowedTools()).toHaveLength(4);
    });

    it('getRules mentions Data Exchange and schema validation', () => {
      const room = new DataExchangeRoom('room_1');
      const rules = room.getRules();
      expect(rules.some((r) => r.includes('Data Exchange'))).toBe(true);
      expect(rules.some((r) => r.includes('schema'))).toBe(true);
    });

    it('getOutputFormat returns data flow shape', () => {
      const room = new DataExchangeRoom('room_1');
      const format = room.getOutputFormat() as Record<string, unknown>;
      expect(format).toHaveProperty('sources');
      expect(format).toHaveProperty('transformationsApplied');
      expect(format).toHaveProperty('outputs');
      expect(format).toHaveProperty('validationResults');
    });
  });

  describe('exit document validation', () => {
    it('accepts complete data flow summary', () => {
      const room = new DataExchangeRoom('room_1');
      const result = room.validateExitDocument({
        sources: [{ name: 'api.example.com', type: 'json', recordCount: 100 }],
        transformationsApplied: [{ step: 'filter', description: 'Remove nulls', recordsAffected: 10 }],
        outputs: [{ target: 'output.json', format: 'json', recordCount: 90 }],
        validationResults: { passed: 90, failed: 0, errors: [] },
      });
      expect(result.ok).toBe(true);
    });

    it('accepts empty transformationsApplied (pass-through)', () => {
      const room = new DataExchangeRoom('room_1');
      const result = room.validateExitDocument({
        sources: [{ name: 'data.csv', type: 'csv', recordCount: 50 }],
        transformationsApplied: [],
        outputs: [{ target: 'data.json', format: 'json', recordCount: 50 }],
        validationResults: { passed: 50, failed: 0, errors: [] },
      });
      expect(result.ok).toBe(true);
    });

    it('rejects empty sources array', () => {
      const room = new DataExchangeRoom('room_1');
      const result = room.validateExitDocument({
        sources: [],
        transformationsApplied: [],
        outputs: [{ target: 'out.json', format: 'json', recordCount: 0 }],
        validationResults: { passed: 0, failed: 0, errors: [] },
      });
      expect(result.ok).toBe(false);
      expect(result.error.message).toContain('sources');
    });

    it('rejects non-array sources', () => {
      const room = new DataExchangeRoom('room_1');
      const result = room.validateExitDocument({
        sources: 'not an array',
        transformationsApplied: [],
        outputs: [{ target: 'out.json' }],
        validationResults: { passed: 0, failed: 0, errors: [] },
      });
      expect(result.ok).toBe(false);
      expect(result.error.message).toContain('sources');
    });

    it('rejects non-array transformationsApplied', () => {
      const room = new DataExchangeRoom('room_1');
      const result = room.validateExitDocument({
        sources: [{ name: 'a' }],
        transformationsApplied: 'not an array',
        outputs: [{ target: 'out.json' }],
        validationResults: { passed: 0, failed: 0, errors: [] },
      });
      expect(result.ok).toBe(false);
      expect(result.error.message).toContain('transformationsApplied');
    });

    it('rejects empty outputs array', () => {
      const room = new DataExchangeRoom('room_1');
      const result = room.validateExitDocument({
        sources: [{ name: 'a' }],
        transformationsApplied: [],
        outputs: [],
        validationResults: { passed: 0, failed: 0, errors: [] },
      });
      expect(result.ok).toBe(false);
      expect(result.error.message).toContain('outputs');
    });

    it('rejects non-object validationResults', () => {
      const room = new DataExchangeRoom('room_1');
      const result = room.validateExitDocument({
        sources: [{ name: 'a' }],
        transformationsApplied: [],
        outputs: [{ target: 'out.json' }],
        validationResults: 'not an object',
      });
      expect(result.ok).toBe(false);
      expect(result.error.message).toContain('validationResults');
    });

    it('rejects validationResults without numeric passed/failed', () => {
      const room = new DataExchangeRoom('room_1');
      const result = room.validateExitDocument({
        sources: [{ name: 'a' }],
        transformationsApplied: [],
        outputs: [{ target: 'out.json' }],
        validationResults: { passed: 'many', failed: 'none' },
      });
      expect(result.ok).toBe(false);
      expect(result.error.message).toContain('numeric');
    });

    it('rejects document missing required fields (base validation)', () => {
      const room = new DataExchangeRoom('room_1');
      const result = room.validateExitDocument({
        sources: [{ name: 'a' }],
      });
      expect(result.ok).toBe(false);
      expect(result.error.code).toBe('EXIT_DOC_INCOMPLETE');
    });
  });

  describe('onBeforeToolCall — schema validation warning', () => {
    it('emits warning when exporting without prior validation', () => {
      const bus = createMockBus();
      const room = new DataExchangeRoom('room_1');
      room.setBus(bus);

      room.onBeforeToolCall('export_data', 'agent_1', { path: 'out.json' });

      const warning = bus._emissions.find((e) => e.event === 'room:warning');
      expect(warning).toBeDefined();
      expect((warning!.data as Record<string, unknown>).warning).toContain('schema validation');
    });

    it('does not emit warning for non-export tools', () => {
      const bus = createMockBus();
      const room = new DataExchangeRoom('room_1');
      room.setBus(bus);

      room.onBeforeToolCall('fetch_url', 'agent_1', { url: 'https://example.com' });

      const warning = bus._emissions.find((e) => e.event === 'room:warning');
      expect(warning).toBeUndefined();
    });

    it('does not emit warning after successful schema validation', () => {
      const bus = createMockBus();
      const room = new DataExchangeRoom('room_1');
      room.setBus(bus);

      // Simulate successful validation
      room.onAfterToolCall('validate_schema', 'agent_1', ok({ valid: true }));

      // Now export should not warn
      room.onBeforeToolCall('export_data', 'agent_1', { path: 'out.json' });

      const warning = bus._emissions.find((e) => e.event === 'room:warning');
      expect(warning).toBeUndefined();
    });

    it('always returns ok (does not block)', () => {
      const room = new DataExchangeRoom('room_1');
      const result = room.onBeforeToolCall('export_data', 'agent_1', { path: 'out.json' });
      expect(result.ok).toBe(true);
    });
  });

  describe('onAfterToolCall — escalation suggestions', () => {
    it('emits escalation on validate_schema failure', () => {
      const bus = createMockBus();
      const room = new DataExchangeRoom('room_1');
      room.setBus(bus);

      room.onAfterToolCall('validate_schema', 'agent_1', err('VALIDATION_FAILED', 'Invalid data format'));

      const esc = bus._emissions.find((e) => e.event === 'room:escalation:suggested');
      expect(esc).toBeDefined();
      expect((esc!.data as Record<string, unknown>).condition).toBe('onError');
      expect((esc!.data as Record<string, unknown>).targetRoom).toBe('war-room');
      expect((esc!.data as Record<string, unknown>).reason).toContain('Schema validation failed');
    });

    it('emits escalation on fetch_url failure', () => {
      const bus = createMockBus();
      const room = new DataExchangeRoom('room_1');
      room.setBus(bus);

      room.onAfterToolCall('fetch_url', 'agent_1', err('FETCH_FAILED', 'Connection refused'));

      const esc = bus._emissions.find((e) => e.event === 'room:escalation:suggested');
      expect(esc).toBeDefined();
      expect((esc!.data as Record<string, unknown>).reason).toContain('Data fetch failed');
    });

    it('does not emit escalation on successful validate_schema', () => {
      const bus = createMockBus();
      const room = new DataExchangeRoom('room_1');
      room.setBus(bus);

      room.onAfterToolCall('validate_schema', 'agent_1', ok({ valid: true }));

      const esc = bus._emissions.find((e) => e.event === 'room:escalation:suggested');
      expect(esc).toBeUndefined();
    });

    it('does not emit escalation on successful fetch_url', () => {
      const bus = createMockBus();
      const room = new DataExchangeRoom('room_1');
      room.setBus(bus);

      room.onAfterToolCall('fetch_url', 'agent_1', ok({ data: {} }));

      const esc = bus._emissions.find((e) => e.event === 'room:escalation:suggested');
      expect(esc).toBeUndefined();
    });

    it('does not emit escalation for other tool failures', () => {
      const bus = createMockBus();
      const room = new DataExchangeRoom('room_1');
      room.setBus(bus);

      room.onAfterToolCall('transform_data', 'agent_1', err('TRANSFORM_FAILED', 'Bad data'));

      const esc = bus._emissions.find((e) => e.event === 'room:escalation:suggested');
      expect(esc).toBeUndefined();
    });
  });
});
