/**
 * Code Lab Room
 *
 * Execution Floor — Full implementation workspace.
 * Focus Desk (1 agent, 1 file scope), Collab Table (multi-agent),
 * or Boardroom (large integration tasks).
 *
 * Active behavior:
 * - validateExitDocumentValues: rejects empty filesModified/changesDescription
 * - onBeforeToolCall: enforces assigned file scope on write operations
 */

import { BaseRoom } from './base-room.js';
import { ok, err } from '../../core/contracts.js';
import type { Result, RoomContract } from '../../core/contracts.js';

export class CodeLab extends BaseRoom {
  static override contract: RoomContract = {
    roomType: 'code-lab',
    floor: 'execution',
    tables: {
      focus: { chairs: 1, description: 'One agent, one file scope' },
      collab: { chairs: 4, description: 'Multi-agent, multi-file scope' },
      boardroom: { chairs: 8, description: 'Large integration tasks' },
    },
    tools: [
      'read_file',
      'write_file',
      'copy_file',
      'patch_file',
      'list_dir',
      'bash',
      'web_search',
      'fetch_webpage',
      'e2e_test',
      'screenshot',
      'analyze_screenshot',
      'session_note',
      'game_engine',
      'dev_server',
      'workspace_sandbox',
      'create_task',
      'update_task',
      'create_raid_entry',
      'github_issues', // #756 — read/comment on issues during implementation
    ],
    fileScope: 'assigned',
    exitRequired: {
      type: 'implementation-report',
      fields: ['filesModified', 'testsAdded', 'changesDescription', 'riskAssessment'],
    },
    escalation: {
      onError: 'war-room',
      onScopeChange: 'discovery',
    },
    provider: 'configurable',
  };

  override getRules(): string[] {
    return [
      'You are in the Code Lab. Implement ONLY the task described in the LATEST user message.',
      'FOCUS: Do exactly what the current message asks. Do not work on tasks from prior messages or conversation history.',
      'Only modify files within your assigned scope. Do NOT touch other files unless the task explicitly requires it.',
      'Write tests for any new functionality.',
      'If you encounter scope creep, escalate to Discovery Room.',
      'Your exit document must list all modified files and tests added.',
      'ALWAYS use tools to accomplish tasks. Do not just describe what to do — DO IT.',
      'When asked to write code, use write_file to create/update files. When asked to fix a bug, read_file first then write_file with the fix.',
      'When asked to run commands (npm install, cargo build, etc.), use the bash tool.',
      'After writing code, ALWAYS run a verification command: npm test, cargo check, python -m py_compile, etc.',
      'If a user reports an error, read the file, fix the issue, write the fixed file, then verify the fix.',
      'QUALITY PIPELINE: After writing code, run these checks in order:',
      '1. Syntax check: verify the file parses (node --check, cargo check, python -c "import ast; ast.parse(open(f).read())")',
      '2. Lint: run eslint, clippy, or pylint on modified files',
      '3. Test: run the project test suite (npm test, cargo test, pytest)',
      '4. If any check fails, fix the issue and re-run',
      'Track the project version in package.json/Cargo.toml using semver. Bump patch for fixes, minor for features.',
    ];
  }

  override getOutputFormat(): Record<string, unknown> {
    return {
      filesModified: ['string'],
      testsAdded: ['string'],
      changesDescription: 'string',
      riskAssessment: 'string',
    };
  }

  /**
   * Value validation for implementation reports.
   * - filesModified must be a non-empty array of strings
   * - testsAdded must be an array (can be empty if changes are test-only)
   * - changesDescription must be a non-empty string
   * - riskAssessment must be a non-empty string
   */
  override validateExitDocumentValues(document: Record<string, unknown>): Result {
    const filesModified = document.filesModified as unknown[];
    const testsAdded = document.testsAdded;
    const changesDescription = document.changesDescription as string;
    const riskAssessment = document.riskAssessment as string;

    if (!Array.isArray(filesModified) || filesModified.length === 0) {
      return err('EXIT_DOC_INVALID', 'filesModified must be a non-empty array');
    }
    if (!Array.isArray(testsAdded)) {
      return err('EXIT_DOC_INVALID', 'testsAdded must be an array');
    }
    if (typeof changesDescription !== 'string' || changesDescription.trim().length === 0) {
      return err('EXIT_DOC_INVALID', 'changesDescription must be a non-empty string');
    }
    if (typeof riskAssessment !== 'string' || riskAssessment.trim().length === 0) {
      return err('EXIT_DOC_INVALID', 'riskAssessment must be a non-empty string');
    }

    return ok(document);
  }

  /**
   * Track assigned file paths for scope enforcement.
   * Set via setAssignedFiles() when agent enters with a task assignment.
   */
  private assignedFiles: Set<string> = new Set();

  /**
   * Set the assigned file scope for the current task.
   * Called by the orchestrator when placing an agent with a task.
   */
  setAssignedFiles(files: string[]): void {
    this.assignedFiles = new Set(files);
  }

  /**
   * Before tool call: enforce assigned file scope on write operations.
   * If assignedFiles is populated, write_file/patch_file are restricted to those paths.
   * If no assignment is set, writes are allowed (trust the agent's judgment).
   */
  override onBeforeToolCall(toolName: string, _agentId: string, input: Record<string, unknown>): Result {
    const WRITE_TOOLS = ['write_file', 'patch_file'];
    if (!WRITE_TOOLS.includes(toolName)) return ok(null);

    // If no file scope is assigned, allow all writes
    if (this.assignedFiles.size === 0) return ok(null);

    const targetPath = (input.path || input.file_path || '') as string;
    if (!targetPath) return ok(null);

    // Check if the target path is within any assigned file/directory
    const isAllowed = Array.from(this.assignedFiles).some((assigned) => {
      // Exact match
      if (targetPath === assigned) return true;
      // Target is under an assigned directory (normalize trailing slash)
      const dir = assigned.endsWith('/') ? assigned : assigned + '/';
      return targetPath.startsWith(dir);
    });

    if (!isAllowed) {
      return err(
        'TOOL_BLOCKED',
        `${toolName} blocked: "${targetPath}" is outside assigned file scope. Allowed: ${Array.from(this.assignedFiles).join(', ')}`,
      );
    }

    return ok(null);
  }

  /**
   * After tool call: detect write failures and suggest escalation.
   */
  override onAfterToolCall(toolName: string, agentId: string, result: Result): void {
    if ((toolName === 'write_file' || toolName === 'patch_file') && !result.ok) {
      this.bus?.emit('room:escalation:suggested', {
        roomId: this.id,
        roomType: this.type,
        agentId,
        condition: 'onError',
        targetRoom: this.escalation.onError || 'war-room',
        reason: `Write operation failed: ${result.error.message}`,
      });
    }
  }
}
