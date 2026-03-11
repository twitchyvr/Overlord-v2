/**
 * Discovery Room Tests
 *
 * Verifies the Discovery Room contract — Collaboration Floor, Phase 1.
 * Read-only room for defining outcomes, constraints, unknowns.
 */

import { describe, it, expect } from 'vitest';
import { DiscoveryRoom } from '../../../src/rooms/room-types/discovery.js';

describe('DiscoveryRoom', () => {
  describe('contract', () => {
    const contract = DiscoveryRoom.contract;

    it('has correct room type and floor', () => {
      expect(contract.roomType).toBe('discovery');
      expect(contract.floor).toBe('collaboration');
    });

    it('has collab table with 4 chairs', () => {
      expect(contract.tables).toHaveProperty('collab');
      expect(contract.tables.collab.chairs).toBe(4);
      expect(contract.tables.collab.description).toContain('PM');
    });

    it('has read-only file scope', () => {
      expect(contract.fileScope).toBe('read-only');
    });

    it('provides research tools but NO write tools', () => {
      expect(contract.tools).toContain('read_file');
      expect(contract.tools).toContain('list_dir');
      expect(contract.tools).toContain('web_search');
      expect(contract.tools).toContain('fetch_webpage');
      expect(contract.tools).toContain('record_note');
      expect(contract.tools).toContain('recall_notes');
      // Structural enforcement: write tools MUST NOT exist
      expect(contract.tools).not.toContain('write_file');
      expect(contract.tools).not.toContain('patch_file');
      expect(contract.tools).not.toContain('bash');
    });

    it('requires requirements-document exit template with 6 fields', () => {
      expect(contract.exitRequired.type).toBe('requirements-document');
      expect(contract.exitRequired.fields).toHaveLength(6);
      expect(contract.exitRequired.fields).toEqual([
        'businessOutcomes',
        'constraints',
        'unknowns',
        'gapAnalysis',
        'riskAssessment',
        'acceptanceCriteria',
      ]);
    });

    it('escalates to architecture on completion', () => {
      expect(contract.escalation).toEqual({ onComplete: 'architecture' });
    });

    it('uses configurable provider', () => {
      expect(contract.provider).toBe('configurable');
    });
  });

  describe('instance behavior', () => {
    it('creates instance with correct type', () => {
      const room = new DiscoveryRoom('room_1');
      expect(room.type).toBe('discovery');
      expect(room.id).toBe('room_1');
    });

    it('getAllowedTools returns all 6 research tools', () => {
      const room = new DiscoveryRoom('room_1');
      const tools = room.getAllowedTools();
      expect(tools).toHaveLength(6);
      expect(tools).toContain('web_search');
      expect(tools).toContain('recall_notes');
    });

    it('hasTool returns true for allowed tools and false for write tools', () => {
      const room = new DiscoveryRoom('room_1');
      expect(room.hasTool('read_file')).toBe(true);
      expect(room.hasTool('web_search')).toBe(true);
      expect(room.hasTool('write_file')).toBe(false);
      expect(room.hasTool('patch_file')).toBe(false);
      expect(room.hasTool('bash')).toBe(false);
    });

    it('getRules returns discovery-specific rules', () => {
      const room = new DiscoveryRoom('room_1');
      const rules = room.getRules();
      expect(rules.length).toBeGreaterThan(0);
      expect(rules.some((r) => r.includes('Discovery Room'))).toBe(true);
      expect(rules.some((r) => r.includes('NO code changes'))).toBe(true);
    });

    it('getOutputFormat returns structured requirements shape', () => {
      const room = new DiscoveryRoom('room_1');
      const format = room.getOutputFormat() as Record<string, unknown>;
      expect(format).toHaveProperty('businessOutcomes');
      expect(format).toHaveProperty('constraints');
      expect(format).toHaveProperty('unknowns');
      expect(format).toHaveProperty('gapAnalysis');
      expect(format).toHaveProperty('riskAssessment');
      expect(format).toHaveProperty('acceptanceCriteria');
    });

    it('buildContextInjection includes all room metadata', () => {
      const room = new DiscoveryRoom('room_1');
      const ctx = room.buildContextInjection();
      expect(ctx.roomType).toBe('discovery');
      expect(ctx.fileScope).toBe('read-only');
      expect(ctx.tools).toHaveLength(6);
      expect(ctx.rules).toEqual(room.getRules());
      expect(ctx.exitTemplate).toEqual(DiscoveryRoom.contract.exitRequired);
      expect(ctx.outputFormat).toEqual(room.getOutputFormat());
    });

    it('validates complete exit document', () => {
      const room = new DiscoveryRoom('room_1');
      const result = room.validateExitDocument({
        businessOutcomes: ['Fast builds'],
        constraints: ['Budget'],
        unknowns: ['Team size'],
        gapAnalysis: { current: 'slow', target: 'fast', gaps: ['CI'] },
        riskAssessment: [{ risk: 'Delay', analysis: 'Likely', citation: 'History' }],
        acceptanceCriteria: ['Build < 5min'],
      });
      expect(result.ok).toBe(true);
    });

    it('rejects exit document with missing fields', () => {
      const room = new DiscoveryRoom('room_1');
      const result = room.validateExitDocument({
        businessOutcomes: ['Fast builds'],
        // missing: constraints, unknowns, gapAnalysis, riskAssessment, acceptanceCriteria
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('EXIT_DOC_INCOMPLETE');
        expect(result.error.message).toContain('constraints');
      }
    });
  });
});
