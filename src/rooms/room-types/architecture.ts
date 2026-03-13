/**
 * Architecture Room
 *
 * Collaboration Floor — Phase 2.
 * Break requirements into milestones, tasks, dependency graph, tech decisions.
 * Read-only — no code changes, receives Discovery exit doc as input.
 *
 * Active behavior:
 * - validateExitDocumentValues: rejects empty milestones/tasks/decisions
 */

import { BaseRoom } from './base-room.js';
import { ok, err } from '../../core/contracts.js';
import type { Result, RoomContract } from '../../core/contracts.js';

export class ArchitectureRoom extends BaseRoom {
  static override contract: RoomContract = {
    roomType: 'architecture',
    floor: 'collaboration',
    tables: {
      collab: { chairs: 4, description: 'Architect + PM define structure' },
    },
    tools: [
      'read_file',
      'list_dir',
      'web_search',
      'fetch_webpage',
      'record_note',
      'recall_notes',
      'session_note',
    ],
    fileScope: 'read-only',
    exitRequired: {
      type: 'architecture-document',
      fields: [
        'milestones',
        'taskBreakdown',
        'dependencyGraph',
        'techDecisions',
        'fileAssignments',
      ],
    },
    escalation: {
      onComplete: 'code-lab',
      onScopeChange: 'discovery',
    },
    provider: 'configurable',
  };

  override getRules(): string[] {
    return [
      'You are in the Architecture Room. Design the implementation plan.',
      'NO code changes. Break requirements into milestones and tasks.',
      'Define dependency graph between tasks.',
      'Make and document tech decisions with rationale.',
      'Assign files to tasks for scoped execution.',
    ];
  }

  override getOutputFormat(): Record<string, unknown> {
    return {
      milestones: [{ name: 'string', criteria: ['string'], dependencies: ['string'] }],
      taskBreakdown: [{ id: 'string', title: 'string', scope: { files: ['string'] }, assignee: 'string' }],
      dependencyGraph: 'object',
      techDecisions: [{ decision: 'string', reasoning: 'string', alternatives: ['string'] }],
      fileAssignments: 'object',
    };
  }

  /**
   * Block write operations — Architecture is read-only planning.
   */
  override onBeforeToolCall(toolName: string, _agentId: string, _input: Record<string, unknown>): Result {
    const WRITE_TOOLS = ['write_file', 'patch_file'];
    if (WRITE_TOOLS.includes(toolName)) {
      return err('TOOL_BLOCKED', `${toolName} is not allowed in the Architecture Room — no code changes permitted`);
    }
    return ok(null);
  }

  override validateExitDocumentValues(document: Record<string, unknown>): Result {
    const milestones = document.milestones as unknown[];
    const taskBreakdown = document.taskBreakdown as unknown[];
    const techDecisions = document.techDecisions as unknown[];

    if (!Array.isArray(milestones) || milestones.length === 0) {
      return err('EXIT_DOC_INVALID', 'milestones must be a non-empty array');
    }
    if (!Array.isArray(taskBreakdown) || taskBreakdown.length === 0) {
      return err('EXIT_DOC_INVALID', 'taskBreakdown must be a non-empty array');
    }
    if (!Array.isArray(techDecisions) || techDecisions.length === 0) {
      return err('EXIT_DOC_INVALID', 'techDecisions must be a non-empty array');
    }

    return ok(document);
  }
}
