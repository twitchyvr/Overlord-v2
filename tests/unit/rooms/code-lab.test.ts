/**
 * Code Lab Room Tests
 *
 * Verifies the Code Lab contract — Execution Floor.
 * Full implementation workspace with focus/collab/boardroom tables.
 * Has write tools, assigned file scope.
 */

import { describe, it, expect } from 'vitest';
import { CodeLab } from '../../../src/rooms/room-types/code-lab.js';

describe('CodeLab', () => {
  describe('contract', () => {
    const contract = CodeLab.contract;

    it('has correct room type and floor', () => {
      expect(contract.roomType).toBe('code-lab');
      expect(contract.floor).toBe('execution');
    });

    it('has three table types with correct capacities', () => {
      expect(Object.keys(contract.tables)).toHaveLength(3);
      expect(contract.tables.focus.chairs).toBe(1);
      expect(contract.tables.collab.chairs).toBe(4);
      expect(contract.tables.boardroom.chairs).toBe(8);
    });

    it('has assigned file scope', () => {
      expect(contract.fileScope).toBe('assigned');
    });

    it('provides full implementation tools including write and bash', () => {
      expect(contract.tools).toContain('read_file');
      expect(contract.tools).toContain('write_file');
      expect(contract.tools).toContain('patch_file');
      expect(contract.tools).toContain('list_dir');
      expect(contract.tools).toContain('bash');
      expect(contract.tools).toContain('web_search');
      expect(contract.tools).toContain('fetch_webpage');
      expect(contract.tools).toContain('session_note');
    });

    it('does NOT have QA tools — those belong in TestingLab', () => {
      expect(contract.tools).not.toContain('qa_run_tests');
      expect(contract.tools).not.toContain('qa_check_lint');
      expect(contract.tools).not.toContain('qa_check_types');
      expect(contract.tools).not.toContain('qa_check_coverage');
      expect(contract.tools).not.toContain('qa_audit_deps');
    });

    it('requires implementation-report exit template with 4 fields', () => {
      expect(contract.exitRequired.type).toBe('implementation-report');
      expect(contract.exitRequired.fields).toHaveLength(4);
      expect(contract.exitRequired.fields).toEqual([
        'filesModified',
        'testsAdded',
        'changesDescription',
        'riskAssessment',
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
      const room = new CodeLab('room_1');
      expect(room.type).toBe('code-lab');
    });

    it('getAllowedTools returns all implementation tools', () => {
      const room = new CodeLab('room_1');
      const tools = room.getAllowedTools();
      expect(tools).toHaveLength(12); // includes copy_file (#595)
    });

    it('hasTool returns true for write tools', () => {
      const room = new CodeLab('room_1');
      expect(room.hasTool('write_file')).toBe(true);
      expect(room.hasTool('patch_file')).toBe(true);
      expect(room.hasTool('bash')).toBe(true);
    });

    it('hasTool returns false for QA-only tools', () => {
      const room = new CodeLab('room_1');
      expect(room.hasTool('qa_run_tests')).toBe(false);
      expect(room.hasTool('qa_check_lint')).toBe(false);
    });

    it('getRules returns code-lab-specific rules', () => {
      const room = new CodeLab('room_1');
      const rules = room.getRules();
      expect(rules.some((r) => r.includes('Code Lab'))).toBe(true);
      expect(rules.some((r) => r.includes('assigned scope'))).toBe(true);
      expect(rules.some((r) => r.includes('tests'))).toBe(true);
    });

    it('getOutputFormat returns implementation report shape', () => {
      const room = new CodeLab('room_1');
      const format = room.getOutputFormat() as Record<string, unknown>;
      expect(format).toHaveProperty('filesModified');
      expect(format).toHaveProperty('testsAdded');
      expect(format).toHaveProperty('changesDescription');
      expect(format).toHaveProperty('riskAssessment');
    });

    it('buildContextInjection includes room metadata with assigned scope', () => {
      const room = new CodeLab('room_1');
      const ctx = room.buildContextInjection();
      expect(ctx.roomType).toBe('code-lab');
      expect(ctx.fileScope).toBe('assigned');
      expect((ctx.tools as string[])).toContain('write_file');
    });

    it('validates complete exit document', () => {
      const room = new CodeLab('room_1');
      const result = room.validateExitDocument({
        filesModified: ['src/a.ts'],
        testsAdded: ['tests/a.test.ts'],
        changesDescription: 'Added feature A',
        riskAssessment: 'Low risk',
      });
      expect(result.ok).toBe(true);
    });

    it('rejects exit document missing fields', () => {
      const room = new CodeLab('room_1');
      const result = room.validateExitDocument({ filesModified: ['a.ts'] });
      expect(result.ok).toBe(false);
    });
  });
});
