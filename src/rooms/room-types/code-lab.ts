/**
 * Code Lab Room
 *
 * Execution Floor — Full implementation workspace.
 * Focus Desk (1 agent, 1 file scope), Collab Table (multi-agent),
 * or Boardroom (large integration tasks).
 */

import { BaseRoom } from './base-room.js';

export class CodeLab extends BaseRoom {
  static contract = {
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
    ],
    fileScope: 'assigned', // Can only access files assigned to this task
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

  getRules() {
    return [
      'You are in the Code Lab. Implement the assigned task.',
      'Only modify files within your assigned scope.',
      'Write tests for any new functionality.',
      'If you encounter scope creep, escalate to Discovery Room.',
      'Your exit document must list all modified files and tests added.',
    ];
  }

  getOutputFormat() {
    return {
      filesModified: ['string'],
      testsAdded: ['string'],
      changesDescription: 'string',
      riskAssessment: 'string',
    };
  }
}
