/**
 * Strategist Office Tests
 *
 * Verifies the Strategist Office contract — Strategy Floor, Phase Zero.
 * Consultative setup of the entire building.
 * Minimal tools — research only, no file writing.
 */

import { describe, it, expect } from 'vitest';
import { StrategistOffice, QUICK_START_TEMPLATES } from '../../../src/rooms/room-types/strategist.js';

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
      expect(contract.tools).toContain('session_note');
      expect(contract.tools).toContain('list_dir');
      expect(contract.tools).toHaveLength(5);
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

    it('escalates to discovery on completion — Phase Zero → Discovery transition', () => {
      expect(contract.escalation).toEqual({ onComplete: 'discovery' });
    });
  });

  describe('modes', () => {
    it('offers quickStart and advanced modes', () => {
      const room = new StrategistOffice('room_1');
      expect(room.modes).toBeDefined();
      expect(room.modes.quickStart).toBeDefined();
      expect(room.modes.advanced).toBeDefined();
    });
  });

  describe('Quick Start templates', () => {
    it('provides at least 4 predefined templates', () => {
      const templates = StrategistOffice.getTemplates();
      expect(templates.length).toBeGreaterThanOrEqual(4);
    });

    it('each template has required fields', () => {
      for (const template of QUICK_START_TEMPLATES) {
        expect(template.id).toBeTruthy();
        expect(template.name).toBeTruthy();
        expect(template.description).toBeTruthy();
        expect(template.floorsNeeded.length).toBeGreaterThan(0);
        expect(template.roomConfig.length).toBeGreaterThan(0);
        expect(template.agentRoster.length).toBeGreaterThan(0);
        expect(template.estimatedPhases.length).toBeGreaterThan(0);
      }
    });

    it('getTemplate returns specific template by ID', () => {
      const webApp = StrategistOffice.getTemplate('web-app');
      expect(webApp).toBeDefined();
      expect(webApp!.name).toBe('Web Application');
    });

    it('getTemplate returns undefined for unknown ID', () => {
      expect(StrategistOffice.getTemplate('nonexistent')).toBeUndefined();
    });

    it('buildBlueprintFromTemplate merges user goals with template', () => {
      const blueprint = StrategistOffice.buildBlueprintFromTemplate('web-app', {
        projectGoals: ['Build a todo app'],
        successCriteria: ['Users can manage tasks'],
      });
      expect(blueprint).not.toBeNull();
      expect(blueprint!.projectGoals).toEqual(['Build a todo app']);
      expect(blueprint!.successCriteria).toEqual(['Users can manage tasks']);
      expect(blueprint!.floorsNeeded).toBeDefined();
      expect(blueprint!.roomConfig).toBeDefined();
      expect(blueprint!.agentRoster).toBeDefined();
      expect(blueprint!.templateId).toBe('web-app');
      expect(blueprint!.mode).toBe('quickStart');
    });

    it('buildBlueprintFromTemplate returns null for unknown template', () => {
      expect(StrategistOffice.buildBlueprintFromTemplate('bad', {
        projectGoals: ['x'],
        successCriteria: ['y'],
      })).toBeNull();
    });

    it('all templates include the strategy floor', () => {
      for (const template of QUICK_START_TEMPLATES) {
        expect(template.floorsNeeded).toContain('strategy');
      }
    });
  });

  describe('instance behavior', () => {
    it('creates instance with correct type', () => {
      const room = new StrategistOffice('room_1');
      expect(room.type).toBe('strategist');
    });

    it('getAllowedTools returns 5 minimal tools', () => {
      const room = new StrategistOffice('room_1');
      expect(room.getAllowedTools()).toHaveLength(5);
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
      expect((ctx.tools as string[])).toHaveLength(5);
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

  describe('validateExitDocumentValues', () => {
    const validDoc = {
      projectGoals: ['Build a web app'],
      successCriteria: ['100% test coverage'],
      floorsNeeded: ['strategy', 'execution'],
      roomConfig: [{ floor: 'execution', rooms: ['code-lab'] }],
      agentRoster: [{ name: 'Dev', role: 'developer', rooms: ['code-lab'] }],
      estimatedPhases: ['discovery', 'execution'],
    };

    it('rejects exit doc with empty projectGoals array', () => {
      const room = new StrategistOffice('room_test');
      const result = room.validateExitDocumentValues({ ...validDoc, projectGoals: [] });
      expect(result.ok).toBe(false);
      expect(result.error.message).toContain('projectGoals');
    });

    it('rejects exit doc with non-string projectGoals entries', () => {
      const room = new StrategistOffice('room_test');
      const result = room.validateExitDocumentValues({ ...validDoc, projectGoals: [42] });
      expect(result.ok).toBe(false);
      expect(result.error.message).toContain('projectGoal');
    });

    it('rejects exit doc with empty successCriteria array', () => {
      const room = new StrategistOffice('room_test');
      const result = room.validateExitDocumentValues({ ...validDoc, successCriteria: [] });
      expect(result.ok).toBe(false);
      expect(result.error.message).toContain('successCriteria');
    });

    it('rejects exit doc with empty floorsNeeded array', () => {
      const room = new StrategistOffice('room_test');
      const result = room.validateExitDocumentValues({ ...validDoc, floorsNeeded: [] });
      expect(result.ok).toBe(false);
      expect(result.error.message).toContain('floorsNeeded');
    });

    it('rejects exit doc with empty roomConfig array', () => {
      const room = new StrategistOffice('room_test');
      const result = room.validateExitDocumentValues({ ...validDoc, roomConfig: [] });
      expect(result.ok).toBe(false);
      expect(result.error.message).toContain('roomConfig');
    });

    it('rejects exit doc with roomConfig entry missing floor field', () => {
      const room = new StrategistOffice('room_test');
      const result = room.validateExitDocumentValues({
        ...validDoc,
        roomConfig: [{ rooms: ['code-lab'] }],
      });
      expect(result.ok).toBe(false);
      expect(result.error.message).toContain('roomConfig[0]');
    });

    it('rejects exit doc with empty agentRoster array', () => {
      const room = new StrategistOffice('room_test');
      const result = room.validateExitDocumentValues({ ...validDoc, agentRoster: [] });
      expect(result.ok).toBe(false);
      expect(result.error.message).toContain('agentRoster');
    });

    it('rejects exit doc with agentRoster entry missing name/role/rooms', () => {
      const room = new StrategistOffice('room_test');
      const result = room.validateExitDocumentValues({
        ...validDoc,
        agentRoster: [{ name: 'Dev' }],
      });
      expect(result.ok).toBe(false);
      expect(result.error.message).toContain('agentRoster[0]');
    });

    it('rejects exit doc with empty estimatedPhases array', () => {
      const room = new StrategistOffice('room_test');
      const result = room.validateExitDocumentValues({ ...validDoc, estimatedPhases: [] });
      expect(result.ok).toBe(false);
      expect(result.error.message).toContain('estimatedPhases');
    });

    it('rejects exit doc with non-string estimatedPhases entries', () => {
      const room = new StrategistOffice('room_test');
      const result = room.validateExitDocumentValues({ ...validDoc, estimatedPhases: [123] });
      expect(result.ok).toBe(false);
      expect(result.error.message).toContain('estimatedPhases');
    });

    it('accepts exit doc with all valid fields (happy path value validation)', () => {
      const room = new StrategistOffice('room_test');
      const result = room.validateExitDocumentValues(validDoc);
      expect(result.ok).toBe(true);
    });
  });
});
