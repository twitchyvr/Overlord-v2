/**
 * Architecture Room
 *
 * Collaboration Floor — Phase 2.
 * Break requirements into milestones, tasks, dependency graph, tech decisions.
 * Read-only — no code changes, receives Discovery exit doc as input.
 */

import { BaseRoom } from './base-room.js';

export class ArchitectureRoom extends BaseRoom {
  static contract = {
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
    provider: 'smart',
  };

  getRules() {
    return [
      'You are in the Architecture Room. Design the implementation plan.',
      'NO code changes. Break requirements into milestones and tasks.',
      'Define dependency graph between tasks.',
      'Make and document tech decisions with rationale.',
      'Assign files to tasks for scoped execution.',
    ];
  }

  getOutputFormat() {
    return {
      milestones: [{ name: 'string', criteria: ['string'], dependencies: ['string'] }],
      taskBreakdown: [{ id: 'string', title: 'string', scope: { files: ['string'] }, assignee: 'string' }],
      dependencyGraph: 'object',
      techDecisions: [{ decision: 'string', reasoning: 'string', alternatives: ['string'] }],
      fileAssignments: 'object',
    };
  }
}
