/**
 * Testing Lab Room Tests
 *
 * Verifies the Testing Lab contract — Execution Floor.
 * CANNOT modify source code. write_file and patch_file are structurally absent.
 * This is the cornerstone of v2's structural enforcement model.
 */

import { describe, it, expect } from 'vitest';
import { TestingLab } from '../../../src/rooms/room-types/testing-lab.js';

describe('TestingLab', () => {
  describe('contract', () => {
    const contract = TestingLab.contract;

    it('has correct room type and floor', () => {
      expect(contract.roomType).toBe('testing-lab');
      expect(contract.floor).toBe('execution');
    });

    it('has focus (1 chair) and collab (3 chairs) tables', () => {
      expect(Object.keys(contract.tables)).toHaveLength(2);
      expect(contract.tables.focus.chairs).toBe(1);
      expect(contract.tables.collab.chairs).toBe(3);
    });

    it('has read-only file scope', () => {
      expect(contract.fileScope).toBe('read-only');
    });

    it('provides QA tools for testing', () => {
      expect(contract.tools).toContain('read_file');
      expect(contract.tools).toContain('list_dir');
      expect(contract.tools).toContain('bash');
      expect(contract.tools).toContain('qa_run_tests');
      expect(contract.tools).toContain('qa_check_lint');
      expect(contract.tools).toContain('qa_check_types');
      expect(contract.tools).toContain('qa_check_coverage');
      expect(contract.tools).toContain('qa_audit_deps');
      expect(contract.tools).toContain('session_note');
    });

    it('STRUCTURALLY CANNOT modify source code — write tools are absent', () => {
      // This is THE core test for v2's innovation
      expect(contract.tools).not.toContain('write_file');
      expect(contract.tools).not.toContain('patch_file');
    });

    it('does NOT have web research tools', () => {
      expect(contract.tools).not.toContain('web_search');
      expect(contract.tools).not.toContain('fetch_webpage');
    });

    it('requires test-report exit template with 6 fields', () => {
      expect(contract.exitRequired.type).toBe('test-report');
      expect(contract.exitRequired.fields).toHaveLength(6);
      expect(contract.exitRequired.fields).toEqual([
        'testsRun',
        'testsPassed',
        'testsFailed',
        'coverage',
        'lintErrors',
        'recommendations',
      ]);
    });

    it('escalates to code-lab on failure and war-room on critical', () => {
      expect(contract.escalation).toEqual({
        onFailure: 'code-lab',
        onCritical: 'war-room',
      });
    });

    it('uses configurable provider', () => {
      expect(contract.provider).toBe('configurable');
    });
  });

  describe('instance behavior', () => {
    it('creates instance with correct type', () => {
      const room = new TestingLab('room_1');
      expect(room.type).toBe('testing-lab');
    });

    it('getAllowedTools returns all 12 QA tools', () => {
      const room = new TestingLab('room_1');
      const tools = room.getAllowedTools();
      expect(tools).toHaveLength(12); // +e2e_test, +screenshot, +analyze_screenshot (#655, #657)
    });

    it('hasTool is true for QA tools and false for write tools', () => {
      const room = new TestingLab('room_1');
      expect(room.hasTool('qa_run_tests')).toBe(true);
      expect(room.hasTool('qa_check_lint')).toBe(true);
      expect(room.hasTool('qa_check_types')).toBe(true);
      expect(room.hasTool('e2e_test')).toBe(true);
      expect(room.hasTool('screenshot')).toBe(true);
      expect(room.hasTool('analyze_screenshot')).toBe(true);
      expect(room.hasTool('write_file')).toBe(false);
      expect(room.hasTool('patch_file')).toBe(false);
    });

    it('getRules emphasizes cannot modify source code', () => {
      const room = new TestingLab('room_1');
      const rules = room.getRules();
      expect(rules.some((r) => r.includes('Testing Lab'))).toBe(true);
      expect(rules.some((r) => r.includes('CANNOT modify source code'))).toBe(true);
      expect(rules.some((r) => r.includes('escalate to Code Lab'))).toBe(true);
    });

    it('getOutputFormat returns test report shape', () => {
      const room = new TestingLab('room_1');
      const format = room.getOutputFormat() as Record<string, unknown>;
      expect(format).toHaveProperty('testsRun');
      expect(format).toHaveProperty('testsPassed');
      expect(format).toHaveProperty('testsFailed');
      expect(format).toHaveProperty('failures');
      expect(format).toHaveProperty('coverage');
      expect(format).toHaveProperty('lintErrors');
      expect(format).toHaveProperty('recommendations');
    });

    it('buildContextInjection includes read-only scope', () => {
      const room = new TestingLab('room_1');
      const ctx = room.buildContextInjection();
      expect(ctx.roomType).toBe('testing-lab');
      expect(ctx.fileScope).toBe('read-only');
      expect((ctx.tools as string[])).not.toContain('write_file');
    });

    it('validates complete exit document', () => {
      const room = new TestingLab('room_1');
      const result = room.validateExitDocument({
        testsRun: 50,
        testsPassed: 48,
        testsFailed: 2,
        coverage: { lines: 85, branches: 72 },
        lintErrors: 0,
        recommendations: ['Fix test X', 'Increase coverage for module Y'],
      });
      expect(result.ok).toBe(true);
    });

    it('rejects exit document missing fields', () => {
      const room = new TestingLab('room_1');
      const result = room.validateExitDocument({ testsRun: 10 });
      expect(result.ok).toBe(false);
    });
  });
});
