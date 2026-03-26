/**
 * Review Room Tests
 *
 * Verifies the Review Room contract — Governance Floor.
 * Go/no-go decisions with risk questionnaire and citations.
 * Includes gate protocol with signoff requirements.
 */

import { describe, it, expect } from 'vitest';
import { ReviewRoom } from '../../../src/rooms/room-types/review.js';

describe('ReviewRoom', () => {
  describe('contract', () => {
    const contract = ReviewRoom.contract;

    it('has correct room type and floor', () => {
      expect(contract.roomType).toBe('review');
      expect(contract.floor).toBe('governance');
    });

    it('has review table with 3 chairs', () => {
      expect(Object.keys(contract.tables)).toHaveLength(1);
      expect(contract.tables.review.chairs).toBe(3);
      expect(contract.tables.review.description).toContain('PM');
      expect(contract.tables.review.description).toContain('Architect');
    });

    it('has read-only file scope', () => {
      expect(contract.fileScope).toBe('read-only');
    });

    it('provides review tools — read, search, QA but NO write', () => {
      expect(contract.tools).toContain('read_file');
      expect(contract.tools).toContain('list_dir');
      expect(contract.tools).toContain('web_search');
      expect(contract.tools).toContain('recall_notes');
      expect(contract.tools).toContain('qa_run_tests');
      expect(contract.tools).toContain('qa_check_lint');
      expect(contract.tools).toContain('session_note');
      expect(contract.tools).not.toContain('write_file');
      expect(contract.tools).not.toContain('patch_file');
      expect(contract.tools).not.toContain('bash');
    });

    it('requires gate-review exit template with 4 fields', () => {
      expect(contract.exitRequired.type).toBe('gate-review');
      expect(contract.exitRequired.fields).toHaveLength(4);
      expect(contract.exitRequired.fields).toEqual([
        'verdict',
        'evidence',
        'conditions',
        'riskQuestionnaire',
      ]);
    });

    it('escalates to code-lab on NO-GO and war-room on critical', () => {
      expect(contract.escalation).toEqual({
        onNoGo: 'code-lab',
        onCritical: 'war-room',
      });
    });
  });

  describe('gate protocol', () => {
    it('has gate protocol requiring exit doc, RAID entry, and signoff', () => {
      const room = new ReviewRoom('room_1');
      expect(room.gateProtocol).toBeDefined();
      expect(room.gateProtocol.requiresExitDoc).toBe(true);
      expect(room.gateProtocol.requiresRaidEntry).toBe(true);
      expect(room.gateProtocol.requiresSignoff).toBe(true);
    });

    it('requires signoff from architect and user roles', () => {
      const room = new ReviewRoom('room_1');
      expect(room.gateProtocol.signoffRoles).toEqual(['architect', 'user']);
    });
  });

  describe('instance behavior', () => {
    it('creates instance with correct type', () => {
      const room = new ReviewRoom('room_1');
      expect(room.type).toBe('review');
    });

    it('getAllowedTools returns 11 review tools', () => {
      const room = new ReviewRoom('room_1');
      expect(room.getAllowedTools()).toHaveLength(11);
    });

    it('getRules emphasizes evidence-based review', () => {
      const room = new ReviewRoom('room_1');
      const rules = room.getRules();
      expect(rules.some((r) => r.includes('Review Room'))).toBe(true);
      expect(rules.some((r) => r.includes('go/no-go'))).toBe(true);
      expect(rules.some((r) => r.includes('evidence'))).toBe(true);
      expect(rules.some((r) => r.includes('risk questionnaire'))).toBe(true);
    });

    it('getOutputFormat returns verdict-based shape', () => {
      const room = new ReviewRoom('room_1');
      const format = room.getOutputFormat() as Record<string, unknown>;
      expect(format).toHaveProperty('verdict');
      expect(format).toHaveProperty('evidence');
      expect(format).toHaveProperty('conditions');
      expect(format).toHaveProperty('riskQuestionnaire');
    });

    it('validates complete exit document', () => {
      const room = new ReviewRoom('room_1');
      const result = room.validateExitDocument({
        verdict: 'GO',
        evidence: [{ claim: 'Tests pass', proof: '312/312', citation: 'CI run #45' }],
        conditions: [],
        riskQuestionnaire: [{ question: 'Data loss?', answer: 'No', risk: 'low' }],
      });
      expect(result.ok).toBe(true);
    });

    it('rejects exit document missing verdict', () => {
      const room = new ReviewRoom('room_1');
      const result = room.validateExitDocument({ evidence: [] });
      expect(result.ok).toBe(false);
    });
  });
});
