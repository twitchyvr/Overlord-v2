/**
 * Review Room
 *
 * Governance Floor — Go/no-go decisions.
 * Risk questionnaire with independent analysis.
 * Produces gate review exit document with citations.
 */

import { BaseRoom } from './base-room.js';

export class ReviewRoom extends BaseRoom {
  static contract = {
    roomType: 'review',
    floor: 'governance',
    tables: {
      review: { chairs: 3, description: 'PM + Architect + Reviewer' },
    },
    tools: [
      'read_file',
      'list_dir',
      'web_search',
      'recall_notes',
      'qa_run_tests',
      'qa_check_lint',
    ],
    fileScope: 'read-only',
    exitRequired: {
      type: 'gate-review',
      fields: ['verdict', 'evidence', 'conditions', 'riskQuestionnaire'],
    },
    escalation: {
      onNoGo: 'code-lab',
      onCritical: 'war-room',
    },
    provider: 'smart',
  };

  gateProtocol = {
    requiresExitDoc: true,
    requiresRaidEntry: true,
    requiresSignoff: true,
    signoffRoles: ['architect', 'user'],
  };

  getRules() {
    return [
      'You are in the Review Room. Make a go/no-go decision.',
      'Review ALL evidence — do not rubber-stamp.',
      'Cite specific code (file:line) in your assessment.',
      'Fill the risk questionnaire with independent analysis.',
      'Your verdict must be GO, NO-GO, or CONDITIONAL.',
    ];
  }

  getOutputFormat() {
    return {
      verdict: 'GO | NO-GO | CONDITIONAL',
      evidence: [{ claim: 'string', proof: 'string', citation: 'string' }],
      conditions: ['string'],
      riskQuestionnaire: [{ question: 'string', answer: 'string', risk: 'low | medium | high' }],
    };
  }
}
