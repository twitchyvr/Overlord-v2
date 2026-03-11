/**
 * Building Architect Tests
 *
 * Verifies the Building Architect contract — Strategy Floor (Advanced mode).
 * Custom building layout with floor definitions, room assignments,
 * agent definitions, tool overrides, and phase configuration.
 */

import { describe, it, expect } from 'vitest';
import { BuildingArchitect } from '../../../src/rooms/room-types/building-architect.js';

describe('BuildingArchitect', () => {
  describe('contract', () => {
    const contract = BuildingArchitect.contract;

    it('has correct room type and floor', () => {
      expect(contract.roomType).toBe('building-architect');
      expect(contract.floor).toBe('strategy');
    });

    it('has workshop table with 3 chairs — architect + user + advisor', () => {
      expect(Object.keys(contract.tables)).toHaveLength(1);
      expect(contract.tables.workshop).toBeDefined();
      expect(contract.tables.workshop.chairs).toBe(3);
    });

    it('has read-only file scope', () => {
      expect(contract.fileScope).toBe('read-only');
    });

    it('has 5 tools including read_file for code inspection', () => {
      expect(contract.tools).toContain('web_search');
      expect(contract.tools).toContain('record_note');
      expect(contract.tools).toContain('recall_notes');
      expect(contract.tools).toContain('list_dir');
      expect(contract.tools).toContain('read_file');
      expect(contract.tools).toHaveLength(5);
      expect(contract.tools).not.toContain('write_file');
      expect(contract.tools).not.toContain('bash');
    });

    it('requires custom-building-plan exit template with 5 fields', () => {
      expect(contract.exitRequired.type).toBe('custom-building-plan');
      expect(contract.exitRequired.fields).toHaveLength(5);
      expect(contract.exitRequired.fields).toEqual([
        'floors',
        'roomAssignments',
        'agentDefinitions',
        'toolOverrides',
        'phaseConfig',
      ]);
    });

    it('escalates to discovery on completion', () => {
      expect(contract.escalation).toEqual({ onComplete: 'discovery' });
    });
  });

  describe('instance behavior', () => {
    it('creates instance with correct type', () => {
      const room = new BuildingArchitect('room_1');
      expect(room.type).toBe('building-architect');
    });

    it('getAllowedTools returns 5 tools', () => {
      const room = new BuildingArchitect('room_1');
      expect(room.getAllowedTools()).toHaveLength(5);
    });

    it('getRules guides custom building layout design', () => {
      const room = new BuildingArchitect('room_1');
      const rules = room.getRules();
      expect(rules.some((r) => r.includes('Building Architect'))).toBe(true);
      expect(rules.some((r) => r.includes('floor'))).toBe(true);
      expect(rules.some((r) => r.includes('room'))).toBe(true);
      expect(rules.some((r) => r.includes('agent'))).toBe(true);
    });

    it('getOutputFormat returns custom plan shape', () => {
      const room = new BuildingArchitect('room_1');
      const format = room.getOutputFormat() as Record<string, unknown>;
      expect(format).toHaveProperty('floors');
      expect(format).toHaveProperty('roomAssignments');
      expect(format).toHaveProperty('agentDefinitions');
      expect(format).toHaveProperty('toolOverrides');
      expect(format).toHaveProperty('phaseConfig');
    });
  });

  describe('exit document validation', () => {
    const validDoc = {
      floors: [
        { type: 'strategy', name: 'Strategy Floor' },
        { type: 'execution', name: 'Build Floor' },
      ],
      roomAssignments: [
        { floor: 'execution', roomType: 'code-lab', roomName: 'Main Code Lab' },
      ],
      agentDefinitions: [
        { name: 'Lead Dev', role: 'developer' },
      ],
      toolOverrides: [],
      phaseConfig: ['strategy', 'execution', 'review'],
    };

    it('accepts valid custom building plan', () => {
      const room = new BuildingArchitect('room_1');
      const result = room.validateExitDocument(validDoc);
      expect(result.ok).toBe(true);
    });

    it('rejects empty floors array', () => {
      const room = new BuildingArchitect('room_1');
      const result = room.validateExitDocument({ ...validDoc, floors: [] });
      expect(result.ok).toBe(false);
      expect(result.error.message).toContain('floors');
    });

    it('rejects floor without type field', () => {
      const room = new BuildingArchitect('room_1');
      const result = room.validateExitDocument({
        ...validDoc,
        floors: [{ name: 'No Type Floor' }],
      });
      expect(result.ok).toBe(false);
      expect(result.error.message).toContain('floors[0]');
    });

    it('rejects floor without name field', () => {
      const room = new BuildingArchitect('room_1');
      const result = room.validateExitDocument({
        ...validDoc,
        floors: [{ type: 'custom' }],
      });
      expect(result.ok).toBe(false);
      expect(result.error.message).toContain('floors[0]');
    });

    it('rejects empty roomAssignments array', () => {
      const room = new BuildingArchitect('room_1');
      const result = room.validateExitDocument({ ...validDoc, roomAssignments: [] });
      expect(result.ok).toBe(false);
      expect(result.error.message).toContain('roomAssignments');
    });

    it('rejects room assignment without floor field', () => {
      const room = new BuildingArchitect('room_1');
      const result = room.validateExitDocument({
        ...validDoc,
        roomAssignments: [{ roomType: 'code-lab', roomName: 'Lab' }],
      });
      expect(result.ok).toBe(false);
      expect(result.error.message).toContain('roomAssignments[0]');
    });

    it('rejects empty agentDefinitions array', () => {
      const room = new BuildingArchitect('room_1');
      const result = room.validateExitDocument({ ...validDoc, agentDefinitions: [] });
      expect(result.ok).toBe(false);
      expect(result.error.message).toContain('agentDefinitions');
    });

    it('rejects agent without name field', () => {
      const room = new BuildingArchitect('room_1');
      const result = room.validateExitDocument({
        ...validDoc,
        agentDefinitions: [{ role: 'developer' }],
      });
      expect(result.ok).toBe(false);
      expect(result.error.message).toContain('agentDefinitions[0]');
    });

    it('rejects empty phaseConfig array', () => {
      const room = new BuildingArchitect('room_1');
      const result = room.validateExitDocument({ ...validDoc, phaseConfig: [] });
      expect(result.ok).toBe(false);
      expect(result.error.message).toContain('phaseConfig');
    });

    it('rejects document missing required fields (base validation)', () => {
      const room = new BuildingArchitect('room_1');
      const result = room.validateExitDocument({ floors: [{ type: 'a', name: 'A' }] });
      expect(result.ok).toBe(false);
      expect(result.error.code).toBe('EXIT_DOC_INCOMPLETE');
    });
  });

  describe('validateExitDocumentValues — extended validation', () => {
    const validDoc = {
      floors: [{ type: 'execution', name: 'Build Floor' }],
      roomAssignments: [{ floor: 'execution', roomType: 'code-lab', roomName: 'Main Lab' }],
      agentDefinitions: [{ name: 'Dev', role: 'developer' }],
      toolOverrides: [],
      phaseConfig: ['discovery', 'execution'],
    };

    it('rejects roomAssignment without roomType field', () => {
      const room = new BuildingArchitect('room_test');
      const result = room.validateExitDocumentValues({
        ...validDoc,
        roomAssignments: [{ floor: 'execution', roomName: 'Main Lab' }],
      });
      expect(result.ok).toBe(false);
      expect(result.error.message).toContain('roomAssignments[0]');
    });

    it('rejects roomAssignment without roomName field', () => {
      const room = new BuildingArchitect('room_test');
      const result = room.validateExitDocumentValues({
        ...validDoc,
        roomAssignments: [{ floor: 'execution', roomType: 'code-lab' }],
      });
      expect(result.ok).toBe(false);
      expect(result.error.message).toContain('roomAssignments[0]');
    });

    it('rejects agent without role field', () => {
      const room = new BuildingArchitect('room_test');
      const result = room.validateExitDocumentValues({
        ...validDoc,
        agentDefinitions: [{ name: 'Dev' }],
      });
      expect(result.ok).toBe(false);
      expect(result.error.message).toContain('agentDefinitions[0]');
    });

    it('rejects toolOverrides that is not an array', () => {
      const room = new BuildingArchitect('room_test');
      const result = room.validateExitDocumentValues({
        ...validDoc,
        toolOverrides: 'not-an-array',
      });
      expect(result.ok).toBe(false);
      expect(result.error.message).toContain('toolOverrides');
    });

    it('rejects toolOverrides entry missing roomName', () => {
      const room = new BuildingArchitect('room_test');
      const result = room.validateExitDocumentValues({
        ...validDoc,
        toolOverrides: [{ add: [], remove: [] }],
      });
      expect(result.ok).toBe(false);
      expect(result.error.message).toContain('toolOverrides[0]');
    });

    it('rejects toolOverrides entry missing add array', () => {
      const room = new BuildingArchitect('room_test');
      const result = room.validateExitDocumentValues({
        ...validDoc,
        toolOverrides: [{ roomName: 'code-lab', remove: [] }],
      });
      expect(result.ok).toBe(false);
      expect(result.error.message).toContain('toolOverrides[0]');
    });

    it('rejects toolOverrides entry missing remove array', () => {
      const room = new BuildingArchitect('room_test');
      const result = room.validateExitDocumentValues({
        ...validDoc,
        toolOverrides: [{ roomName: 'code-lab', add: [] }],
      });
      expect(result.ok).toBe(false);
      expect(result.error.message).toContain('toolOverrides[0]');
    });

    it('accepts toolOverrides as empty array (valid — overrides are optional)', () => {
      const room = new BuildingArchitect('room_test');
      const result = room.validateExitDocumentValues(validDoc);
      expect(result.ok).toBe(true);
    });

    it('rejects phaseConfig with empty string entry', () => {
      const room = new BuildingArchitect('room_test');
      const result = room.validateExitDocumentValues({
        ...validDoc,
        phaseConfig: ['discovery', ''],
      });
      expect(result.ok).toBe(false);
      expect(result.error.message).toContain('phaseConfig[1]');
    });

    it('rejects phaseConfig with non-string entry', () => {
      const room = new BuildingArchitect('room_test');
      const result = room.validateExitDocumentValues({
        ...validDoc,
        phaseConfig: [42],
      });
      expect(result.ok).toBe(false);
      expect(result.error.message).toContain('phaseConfig[0]');
    });
  });
});
