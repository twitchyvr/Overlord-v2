/**
 * War Room Tests
 *
 * Verifies the War Room contract — Collaboration Floor.
 * Incident response with elevated access. Full file scope.
 * Has ALL tools including write, bash, github — max capability.
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
      expect(contract.tables.boardroom.chairs).toBe(8);
      expect(contract.tables.boardroom.description).toContain('incident');
    });

    it('has FULL file scope — elevated access during incidents', () => {
      expect(contract.fileScope).toBe('full');
    });

    it('has the most comprehensive tool set of any room', () => {
      const tools = contract.tools;
      expect(tools).toContain('read_file');
      expect(tools).toContain('write_file');
      expect(tools).toContain('patch_file');
      expect(tools).toContain('list_dir');
      expect(tools).toContain('bash');
      expect(tools).toContain('web_search');
      expect(tools).toContain('fetch_webpage');
      expect(tools).toContain('qa_run_tests');
      expect(tools).toContain('qa_check_lint');
      expect(tools).toContain('github');
      expect(tools).toHaveLength(10);
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

    it('has empty escalation — war room is the top escalation target', () => {
      expect(contract.escalation).toEqual({});
    });
  });

  describe('instance behavior', () => {
    it('creates instance with correct type', () => {
      const room = new WarRoom('room_1');
      expect(room.type).toBe('war-room');
    });

    it('getAllowedTools returns all 10 tools', () => {
      const room = new WarRoom('room_1');
      expect(room.getAllowedTools()).toHaveLength(10);
    });

    it('hasTool returns true for write tools — elevated access', () => {
      const room = new WarRoom('room_1');
      expect(room.hasTool('write_file')).toBe(true);
      expect(room.hasTool('patch_file')).toBe(true);
      expect(room.hasTool('bash')).toBe(true);
      expect(room.hasTool('github')).toBe(true);
    });

    it('getRules emphasizes incident focus and time-boxing', () => {
      const room = new WarRoom('room_1');
      const rules = room.getRules();
      expect(rules.some((r) => r.includes('War Room'))).toBe(true);
      expect(rules.some((r) => r.includes('incident response'))).toBe(true);
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

    it('buildContextInjection includes full file scope', () => {
      const room = new WarRoom('room_1');
      const ctx = room.buildContextInjection();
      expect(ctx.roomType).toBe('war-room');
      expect(ctx.fileScope).toBe('full');
      expect((ctx.tools as string[])).toContain('write_file');
      expect((ctx.tools as string[])).toContain('github');
    });

    it('validates complete exit document', () => {
      const room = new WarRoom('room_1');
      const result = room.validateExitDocument({
        incidentSummary: 'Database connection pool exhausted',
        rootCause: 'Missing connection timeout in config',
        resolution: 'Added 30s timeout to pool config',
        preventionPlan: ['Add connection pool monitoring', 'Set up alerts'],
        timeToResolve: '45 minutes',
      });
      expect(result.ok).toBe(true);
    });

    it('rejects exit document missing root cause', () => {
      const room = new WarRoom('room_1');
      const result = room.validateExitDocument({
        incidentSummary: 'Something broke',
        resolution: 'Fixed it',
      });
      expect(result.ok).toBe(false);
    });
  });
});
