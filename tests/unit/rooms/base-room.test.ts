import { describe, it, expect } from 'vitest';
import { BaseRoom } from '../../../src/rooms/room-types/base-room.js';
import { TestingLab } from '../../../src/rooms/room-types/testing-lab.js';
import { CodeLab } from '../../../src/rooms/room-types/code-lab.js';

describe('BaseRoom', () => {
  it('returns allowed tools list', () => {
    const room = new BaseRoom('room_1');
    expect(room.getAllowedTools()).toEqual([]);
  });

  it('checks tool availability', () => {
    const room = new BaseRoom('room_1');
    expect(room.hasTool('write_file')).toBe(false);
  });

  it('validates exit document with no required fields', () => {
    const room = new BaseRoom('room_1');
    const result = room.validateExitDocument({ anything: true });
    expect(result.ok).toBe(true);
  });
});

describe('TestingLab', () => {
  it('does NOT include write_file in tools (structural enforcement)', () => {
    const lab = new TestingLab('lab_1');
    expect(lab.hasTool('write_file')).toBe(false);
    expect(lab.hasTool('patch_file')).toBe(false);
  });

  it('includes QA tools', () => {
    const lab = new TestingLab('lab_1');
    expect(lab.hasTool('qa_run_tests')).toBe(true);
    expect(lab.hasTool('qa_check_lint')).toBe(true);
    expect(lab.hasTool('read_file')).toBe(true);
  });

  it('has read-only file scope', () => {
    const lab = new TestingLab('lab_1');
    expect(lab.fileScope).toBe('read-only');
  });

  it('requires test report exit document', () => {
    const lab = new TestingLab('lab_1');
    expect(lab.exitRequired.type).toBe('test-report');
    expect(lab.exitRequired.fields).toContain('testsRun');
    expect(lab.exitRequired.fields).toContain('testsPassed');
  });

  it('validates incomplete exit document', () => {
    const lab = new TestingLab('lab_1');
    const result = lab.validateExitDocument({ testsRun: 10 }); // missing other fields
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('EXIT_DOC_INCOMPLETE');
  });

  it('validates complete exit document', () => {
    const lab = new TestingLab('lab_1');
    const result = lab.validateExitDocument({
      testsRun: 10,
      testsPassed: 8,
      testsFailed: 2,
      coverage: { lines: 85, branches: 70 },
      lintErrors: 0,
      recommendations: ['Fix failing tests'],
    });
    expect(result.ok).toBe(true);
  });
});

describe('CodeLab', () => {
  it('includes write_file in tools', () => {
    const lab = new CodeLab('codelab_1');
    expect(lab.hasTool('write_file')).toBe(true);
    expect(lab.hasTool('patch_file')).toBe(true);
    expect(lab.hasTool('bash')).toBe(true);
  });

  it('has assigned file scope', () => {
    const lab = new CodeLab('codelab_1');
    expect(lab.fileScope).toBe('assigned');
  });

  it('testing-lab and code-lab have different write access', () => {
    const testLab = new TestingLab('test_1');
    const codeLab = new CodeLab('code_1');

    // The core v2 invariant: testing lab CANNOT write, code lab CAN
    expect(testLab.hasTool('write_file')).toBe(false);
    expect(codeLab.hasTool('write_file')).toBe(true);
  });
});
