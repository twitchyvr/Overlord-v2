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
      'patch_file',
      'list_dir',
      'bash',
      'web_search',
      'fetch_webpage',
      'session_note',
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
      'You are in the Code Lab. Implement the assigned task.',
      'Only modify files within your assigned scope.',
      'Write tests for any new functionality.',
      'If you encounter scope creep, escalate to Discovery Room.',
      'Your exit document must list all modified files and tests added.',
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
