/**
 * Strategist Office Tests
 *
 * Verifies the Strategist Office contract — Strategy Floor, Phase Zero.
 * Consultative setup of the entire building.
 * Minimal tools — research only, no file writing.
 */

import { describe, it, expect } from 'vitest';
import { StrategistOffice } from '../../../src/rooms/room-types/strategist.js';

describe('StrategistOffice', () => {
  describe('contract', () => {
    const contract = StrategistOffice.contract;

    it('has correct room type and floor', () => {
      expect(contract.roomType).toBe('strategist');
      expect(contract.floor).toBe('strategy');
    });

    it('has consultation table with 2 chairs — strategist + user', () => {
      expect(Object.keys(contract.tables)).toHaveLength(1);
      expect(contract.tables.consultation.chairs).toBe(2);
      expect(contract.tables.consultation.description).toContain('Strategist');
      expect(contract.tables.consultation.description).toContain('User');
    });

    it('has read-only file scope', () => {
      expect(contract.fileScope).toBe('read-only');
    });

    it('has minimal tool set — research only, no file writing or execution', () => {
      expect(contract.tools).toContain('web_search');
      expect(contract.tools).toContain('record_note');
      expect(contract.tools).toContain('recall_notes');
      expect(contract.tools).toContain('list_dir');
      expect(contract.tools).toHaveLength(4);
      expect(contract.tools).not.toContain('read_file');
      expect(contract.tools).not.toContain('write_file');
      expect(contract.tools).not.toContain('bash');
    });

    it('requires building-blueprint exit template with 6 fields', () => {
      expect(contract.exitRequired.type).toBe('building-blueprint');
      expect(contract.exitRequired.fields).toHaveLength(6);
      expect(contract.exitRequired.fields).toEqual([
        'projectGoals',
        'successCriteria',
        'floorsNeeded',
        'roomConfig',
        'agentRoster',
        'estimatedPhases',
      ]);
    });

    it('has empty escalation — strategist is the entry point', () => {
      expect(contract.escalation).toEqual({});
    });
  });

  describe('modes', () => {
    it('offers quickStart and advanced modes', () => {
      const room = new StrategistOffice('room_1');
      expect(room.modes).toBeDefined();
      expect(room.modes.quickStart).toBeDefined();
      expect(room.modes.advanced).toBeDefined();
      expect(room.modes.quickStart).toContain('template');
      expect(room.modes.advanced).toContain('custom');
    });
  });

  describe('instance behavior', () => {
    it('creates instance with correct type', () => {
      const room = new StrategistOffice('room_1');
      expect(room.type).toBe('strategist');
    });

    it('getAllowedTools returns 4 minimal tools', () => {
      const room = new StrategistOffice('room_1');
      expect(room.getAllowedTools()).toHaveLength(4);
    });

    it('hasTool returns false for everything except research tools', () => {
      const room = new StrategistOffice('room_1');
      expect(room.hasTool('web_search')).toBe(true);
      expect(room.hasTool('record_note')).toBe(true);
      expect(room.hasTool('recall_notes')).toBe(true);
      expect(room.hasTool('list_dir')).toBe(true);
      expect(room.hasTool('read_file')).toBe(false);
      expect(room.hasTool('write_file')).toBe(false);
      expect(room.hasTool('bash')).toBe(false);
    });

    it('getRules guides project setup consultation', () => {
      const room = new StrategistOffice('room_1');
      const rules = room.getRules();
      expect(rules.some((r) => r.includes('Strategist'))).toBe(true);
      expect(rules.some((r) => r.includes('consultative'))).toBe(true);
      expect(rules.some((r) => r.includes('Quick Start'))).toBe(true);
      expect(rules.some((r) => r.includes('Advanced'))).toBe(true);
    });

    it('getOutputFormat returns building blueprint shape', () => {
      const room = new StrategistOffice('room_1');
      const format = room.getOutputFormat() as Record<string, unknown>;
      expect(format).toHaveProperty('projectGoals');
      expect(format).toHaveProperty('successCriteria');
      expect(format).toHaveProperty('floorsNeeded');
      expect(format).toHaveProperty('roomConfig');
      expect(format).toHaveProperty('agentRoster');
      expect(format).toHaveProperty('estimatedPhases');
    });

    it('buildContextInjection includes minimal tools and read-only scope', () => {
      const room = new StrategistOffice('room_1');
      const ctx = room.buildContextInjection();
      expect(ctx.roomType).toBe('strategist');
      expect(ctx.fileScope).toBe('read-only');
      expect((ctx.tools as string[])).toHaveLength(4);
    });

    it('validates complete exit document (building blueprint)', () => {
      const room = new StrategistOffice('room_1');
      const result = room.validateExitDocument({
        projectGoals: ['Build a task manager'],
        successCriteria: ['Users can create tasks'],
        floorsNeeded: ['collaboration', 'execution'],
        roomConfig: [{ floor: 'execution', rooms: ['code-lab', 'testing-lab'] }],
        agentRoster: [{ name: 'Coder', role: 'developer', rooms: ['code-lab'] }],
        estimatedPhases: ['strategy', 'discovery', 'architecture', 'execution', 'review'],
      });
      expect(result.ok).toBe(true);
    });

    it('rejects exit document missing fields', () => {
      const room = new StrategistOffice('room_1');
      const result = room.validateExitDocument({
        projectGoals: ['Build something'],
      });
      expect(result.ok).toBe(false);
    });
  });
});
