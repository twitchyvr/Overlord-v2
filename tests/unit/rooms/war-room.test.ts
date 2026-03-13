/**
 * War Room Tests
 *
 * Verifies the War Room contract — Collaboration Floor.
 * Incident response. Elevated access. All-hands troubleshooting.
 * Full file scope, 8-chair boardroom, no escalation (IS the top target).
 */

import { describe, it, expect } from 'vitest';
import { WarRoom } from '../../../src/rooms/room-types/war-room.js';

describe('WarRoom', () => {
  describe('contract', () => {
    const contract = WarRoom.contract;

    it('has correct room type and floor', () => {
      expect(contract.roomType).toBe('war-room');
      expect(contract.floor).toBe('collaboration');
    });

    it('has boardroom table with 8 chairs — all-hands', () => {
      expect(Object.keys(contract.tables)).toHaveLength(1);
      expect(contract.tables.boardroom).toBeDefined();
      expect(contract.tables.boardroom.chairs).toBe(8);
    });

    it('has full file scope — elevated access', () => {
      expect(contract.fileScope).toBe('full');
    });

    it('provides full tool set including write and patch', () => {
      expect(contract.tools).toContain('read_file');
      expect(contract.tools).toContain('write_file');
      expect(contract.tools).toContain('patch_file');
      expect(contract.tools).toContain('list_dir');
      expect(contract.tools).toContain('bash');
      expect(contract.tools).toContain('web_search');
      expect(contract.tools).toContain('github');
      expect(contract.tools).toContain('qa_run_tests');
      expect(contract.tools).toContain('qa_check_lint');
      expect(contract.tools).toContain('session_note');
    });

    it('requires incident-report exit template with 5 fields', () => {
      expect(contract.exitRequired.type).toBe('incident-report');
      expect(contract.exitRequired.fields).toHaveLength(5);
      expect(contract.exitRequired.fields).toEqual([
        'incidentSummary',
        'rootCause',
        'resolution',
        'preventionPlan',
        'timeToResolve',
      ]);
    });

    it('has NO escalation — war room IS the top escalation target', () => {
      expect(contract.escalation).toEqual({});
    });
  });

  describe('instance behavior', () => {
    it('creates instance with correct type', () => {
      const room = new WarRoom('room_1');
      expect(room.type).toBe('war-room');
    });

    it('getAllowedTools returns full set of 11 tools', () => {
      const room = new WarRoom('room_1');
      expect(room.getAllowedTools()).toHaveLength(11);
    });

    it('getRules emphasizes incident response and root cause', () => {
      const room = new WarRoom('room_1');
      const rules = room.getRules();
      expect(rules.some((r) => r.includes('War Room'))).toBe(true);
      expect(rules.some((r) => r.includes('incident'))).toBe(true);
      expect(rules.some((r) => r.includes('root cause'))).toBe(true);
      expect(rules.some((r) => r.includes('prevention plan'))).toBe(true);
    });

    it('getOutputFormat returns incident report shape', () => {
      const room = new WarRoom('room_1');
      const format = room.getOutputFormat() as Record<string, unknown>;
      expect(format).toHaveProperty('incidentSummary');
      expect(format).toHaveProperty('rootCause');
      expect(format).toHaveProperty('resolution');
      expect(format).toHaveProperty('preventionPlan');
      expect(format).toHaveProperty('timeToResolve');
    });
  });

  describe('exit document validation', () => {
    it('accepts complete incident report', () => {
      const room = new WarRoom('room_1');
      const result = room.validateExitDocument({
        incidentSummary: 'Production API returned 500 errors for /users endpoint',
        rootCause: 'Database connection pool exhausted due to unclosed transactions',
        resolution: 'Added connection pool monitoring and automatic transaction cleanup',
        preventionPlan: ['Add connection pool metrics to dashboard', 'Set max transaction timeout to 30s'],
        timeToResolve: '45 minutes',
      });
      expect(result.ok).toBe(true);
    });

    it('rejects empty rootCause', () => {
      const room = new WarRoom('room_1');
      const result = room.validateExitDocument({
        incidentSummary: 'Something broke',
        rootCause: '',
        resolution: 'Fixed it',
        preventionPlan: ['Monitor'],
        timeToResolve: '10m',
      });
      expect(result.ok).toBe(false);
      expect(result.error.message).toContain('rootCause');
    });

    it('rejects empty resolution', () => {
      const room = new WarRoom('room_1');
      const result = room.validateExitDocument({
        incidentSummary: 'Something broke',
        rootCause: 'Bad config',
        resolution: '   ',
        preventionPlan: ['Monitor'],
        timeToResolve: '10m',
      });
      expect(result.ok).toBe(false);
      expect(result.error.message).toContain('resolution');
    });

    it('rejects empty preventionPlan array', () => {
      const room = new WarRoom('room_1');
      const result = room.validateExitDocument({
        incidentSummary: 'Something broke',
        rootCause: 'Bad config',
        resolution: 'Fixed config',
        preventionPlan: [],
        timeToResolve: '10m',
      });
      expect(result.ok).toBe(false);
      expect(result.error.message).toContain('preventionPlan');
    });

    it('rejects non-array preventionPlan', () => {
      const room = new WarRoom('room_1');
      const result = room.validateExitDocument({
        incidentSummary: 'Something broke',
        rootCause: 'Bad config',
        resolution: 'Fixed config',
        preventionPlan: 'just one thing',
        timeToResolve: '10m',
      });
      expect(result.ok).toBe(false);
      expect(result.error.message).toContain('preventionPlan');
    });

    it('rejects document missing required fields (base validation)', () => {
      const room = new WarRoom('room_1');
      const result = room.validateExitDocument({
        incidentSummary: 'Something broke',
        rootCause: 'Bad config',
      });
      expect(result.ok).toBe(false);
      expect(result.error.code).toBe('EXIT_DOC_INCOMPLETE');
    });
  });
});
