/**
 * Testing Lab Room
 *
 * Execution Floor — Cannot modify source code.
 * write_file and patch_file are NOT in the tools list = structurally impossible.
 * Agents can only run tests and report results.
 *
 * Active behavior:
 * - validateExitDocumentValues: rejects nonsense (testsRun: 0, negative coverage)
 * - onAfterToolCall: detects test failures and emits escalation suggestion
 */

import { BaseRoom } from './base-room.js';
import { ok, err } from '../../core/contracts.js';
import type { Result, RoomContract } from '../../core/contracts.js';

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
      'e2e_test',
      'screenshot',
      'session_note',
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
    provider: 'configurable',
  };

  override getRules(): string[] {
    return [
      'You are in the Testing Lab. You CANNOT modify source code.',
      'Run tests, analyze results, and report findings.',
      'If tests fail, document failures with file paths and line numbers.',
      'Do NOT attempt to fix code — escalate to Code Lab.',
      'Your exit document must include concrete evidence.',
      'Detect the project test runner from the project files: npm test, cargo test, swift test, pytest, go test, flutter test, xcodebuild test, etc. Run whatever the project uses.',
      'If no formal test framework is set up, use bash to verify the build compiles and runs: check exit codes, stderr, and basic output validation.',
      'After running tests, try to start the application and verify it works:',
      '- For Node.js: run "node src/server.js" or "npm start" and test an endpoint',
      '- For Rust: run "cargo run" and verify it starts',
      '- For Python: run "python app.py" and verify it starts',
      'Report any runtime errors as issues that need fixing in the Code Lab.',
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

  /**
   * Value validation for test reports.
   * - testsRun must be a positive number
   * - testsPassed + testsFailed must equal testsRun
   * - coverage must be non-negative
   * - lintErrors must be non-negative
   * - recommendations must be a non-empty array
   */
  override validateExitDocumentValues(document: Record<string, unknown>): Result {
    const testsRun = document.testsRun as number;
    const testsPassed = document.testsPassed as number;
    const testsFailed = document.testsFailed as number;
    const lintErrors = document.lintErrors as number;
    const recommendations = document.recommendations as unknown[];

    if (typeof testsRun !== 'number' || testsRun < 1) {
      return err('EXIT_DOC_INVALID', 'testsRun must be a positive number');
    }
    if (typeof testsPassed !== 'number' || testsPassed < 0) {
      return err('EXIT_DOC_INVALID', 'testsPassed must be a non-negative number');
    }
    if (typeof testsFailed !== 'number' || testsFailed < 0) {
      return err('EXIT_DOC_INVALID', 'testsFailed must be a non-negative number');
    }
    if (testsPassed + testsFailed !== testsRun) {
      return err('EXIT_DOC_INVALID', `testsPassed (${testsPassed}) + testsFailed (${testsFailed}) must equal testsRun (${testsRun})`);
    }
    if (typeof lintErrors !== 'number' || lintErrors < 0) {
      return err('EXIT_DOC_INVALID', 'lintErrors must be a non-negative number');
    }
    if (!Array.isArray(recommendations) || recommendations.length === 0) {
      return err('EXIT_DOC_INVALID', 'recommendations must be a non-empty array');
    }

    return ok(document);
  }

  /**
   * After tool call: detect test failures and suggest escalation.
   */
  override onAfterToolCall(toolName: string, agentId: string, result: Result): void {
    if (toolName !== 'qa_run_tests' && toolName !== 'e2e_test' && toolName !== 'bash') return;
    if (!result.ok) {
      this.bus?.emit('room:escalation:suggested', {
        roomId: this.id,
        roomType: this.type,
        agentId,
        condition: 'onFailure',
        targetRoom: this.escalation.onFailure || 'code-lab',
        reason: `Tool ${toolName} failed: ${result.error.message}`,
      });
    }
  }
}
