/**
 * War Room
 *
 * Collaboration Floor — Incident response.
 * All-hands troubleshooting. Elevated access. Time-boxed.
 */

import { BaseRoom } from './base-room.js';

export class WarRoom extends BaseRoom {
  static contract = {
    roomType: 'war-room',
    floor: 'collaboration',
    tables: {
      boardroom: { chairs: 8, description: 'All-hands incident response' },
    },
    tools: [
      'read_file',
      'write_file',
      'patch_file',
      'list_dir',
      'bash',
      'web_search',
      'fetch_webpage',
      'qa_run_tests',
      'qa_check_lint',
      'github',
    ],
    fileScope: 'full', // Elevated access during incidents
    exitRequired: {
      type: 'incident-report',
      fields: ['incidentSummary', 'rootCause', 'resolution', 'preventionPlan', 'timeToResolve'],
    },
    escalation: {},
    provider: 'smart',
  };

  getRules() {
    return [
      'You are in the War Room. This is incident response.',
      'Focus on resolving the incident, not long-term fixes.',
      'Document root cause as you investigate.',
      'Time-boxed: escalate to user if not resolved quickly.',
      'Exit document must include prevention plan.',
    ];
  }

  getOutputFormat() {
    return {
      incidentSummary: 'string',
      rootCause: 'string',
      resolution: 'string',
      preventionPlan: ['string'],
      timeToResolve: 'string',
    };
  }
}
