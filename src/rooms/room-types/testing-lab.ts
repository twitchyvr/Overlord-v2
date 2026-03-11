/**
 * Testing Lab Room
 *
 * Execution Floor — Cannot modify source code.
 * write_file and patch_file are NOT in the tools list = structurally impossible.
 * Agents can only run tests and report results.
 *
 * This is the simplest room to build first — clear constraints, obvious validation.
 */

import { BaseRoom } from './base-room.js';
import type { RoomContract } from '../../core/contracts.js';

export class TestingLab extends BaseRoom {
  static override contract: RoomContract = {
    roomType: 'testing-lab',
    floor: 'execution',
    tables: {
      focus: { chairs: 1, description: 'Single test suite runner' },
      collab: { chairs: 3, description: 'Parallel test suites' },
    },
    // NOTE: write_file, patch_file NOT in tools list = structurally impossible to modify source
    tools: [
      'read_file',
      'list_dir',
      'bash',
      'qa_run_tests',
      'qa_check_lint',
      'qa_check_types',
      'qa_check_coverage',
      'qa_audit_deps',
    ],
    fileScope: 'read-only',
    exitRequired: {
      type: 'test-report',
      fields: [
        'testsRun',
        'testsPassed',
        'testsFailed',
        'coverage',
        'lintErrors',
        'recommendations',
      ],
    },
    escalation: {
      onFailure: 'code-lab',
      onCritical: 'war-room',
    },
    provider: 'configurable', // Repetitive test runs — use cost-effective model
  };

  override getRules(): string[] {
    return [
      'You are in the Testing Lab. You CANNOT modify source code.',
      'Run tests, analyze results, and report findings.',
      'If tests fail, document failures with file paths and line numbers.',
      'Do NOT attempt to fix code — escalate to Code Lab.',
      'Your exit document must include concrete evidence.',
    ];
  }

  override getOutputFormat(): Record<string, unknown> {
    return {
      testsRun: 'number',
      testsPassed: 'number',
      testsFailed: 'number',
      failures: [{ test: 'string', expected: 'string', actual: 'string', file: 'string' }],
      coverage: { lines: 'number', branches: 'number' },
      lintErrors: 'number',
      recommendations: ['string'],
    };
  }
}
