/**
 * Architecture Room Tests
 *
 * Verifies the Architecture Room contract — Collaboration Floor, Phase 2.
 * Read-only room for milestones, task breakdown, dependency graph.
 */

import { describe, it, expect } from 'vitest';
import { ArchitectureRoom } from '../../../src/rooms/room-types/architecture.js';

describe('ArchitectureRoom', () => {
  describe('contract', () => {
    const contract = ArchitectureRoom.contract;

    it('has correct room type and floor', () => {
      expect(contract.roomType).toBe('architecture');
      expect(contract.floor).toBe('collaboration');
    });

    it('has collab table with 4 chairs', () => {
      expect(contract.tables).toHaveProperty('collab');
      expect(contract.tables.collab.chairs).toBe(4);
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
      expect(contract.tools).not.toContain('write_file');
      expect(contract.tools).not.toContain('patch_file');
      expect(contract.tools).not.toContain('bash');
    });

    it('requires architecture-document exit template with 5 fields', () => {
      expect(contract.exitRequired.type).toBe('architecture-document');
      expect(contract.exitRequired.fields).toHaveLength(5);
      expect(contract.exitRequired.fields).toEqual([
        'milestones',
        'taskBreakdown',
        'dependencyGraph',
        'techDecisions',
        'fileAssignments',
      ]);
    });

    it('escalates to code-lab on completion and discovery on scope change', () => {
      expect(contract.escalation).toEqual({
        onComplete: 'code-lab',
        onScopeChange: 'discovery',
      });
    });

    it('uses configurable provider', () => {
      expect(contract.provider).toBe('configurable');
    });
  });

  describe('instance behavior', () => {
    it('creates instance with correct type', () => {
      const room = new ArchitectureRoom('room_1');
      expect(room.type).toBe('architecture');
    });

    it('getAllowedTools returns all 6 research tools', () => {
      const room = new ArchitectureRoom('room_1');
      expect(room.getAllowedTools()).toHaveLength(6);
    });

    it('hasTool returns false for write tools', () => {
      const room = new ArchitectureRoom('room_1');
      expect(room.hasTool('write_file')).toBe(false);
      expect(room.hasTool('bash')).toBe(false);
    });

    it('getRules returns architecture-specific rules', () => {
      const room = new ArchitectureRoom('room_1');
      const rules = room.getRules();
      expect(rules.some((r) => r.includes('Architecture Room'))).toBe(true);
      expect(rules.some((r) => r.includes('NO code changes'))).toBe(true);
      expect(rules.some((r) => r.includes('dependency graph'))).toBe(true);
    });

    it('getOutputFormat returns structured architecture shape', () => {
      const room = new ArchitectureRoom('room_1');
      const format = room.getOutputFormat() as Record<string, unknown>;
      expect(format).toHaveProperty('milestones');
      expect(format).toHaveProperty('taskBreakdown');
      expect(format).toHaveProperty('dependencyGraph');
      expect(format).toHaveProperty('techDecisions');
      expect(format).toHaveProperty('fileAssignments');
    });

    it('buildContextInjection includes all room metadata', () => {
      const room = new ArchitectureRoom('room_1');
      const ctx = room.buildContextInjection();
      expect(ctx.roomType).toBe('architecture');
      expect(ctx.fileScope).toBe('read-only');
      expect((ctx.tools as string[]).length).toBe(6);
    });

    it('validates complete exit document', () => {
      const room = new ArchitectureRoom('room_1');
      const result = room.validateExitDocument({
        milestones: [{ name: 'M1', criteria: ['done'], dependencies: [] }],
        taskBreakdown: [{ id: 't1', title: 'Task 1', scope: { files: ['a.ts'] }, assignee: 'coder' }],
        dependencyGraph: { t1: [] },
        techDecisions: [{ decision: 'Use TS', reasoning: 'Type safety', alternatives: ['JS'] }],
        fileAssignments: { 'a.ts': 't1' },
      });
      expect(result.ok).toBe(true);
    });

    it('rejects exit document with missing fields', () => {
      const room = new ArchitectureRoom('room_1');
      const result = room.validateExitDocument({ milestones: [] });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('EXIT_DOC_INCOMPLETE');
      }
    });
  });
});
