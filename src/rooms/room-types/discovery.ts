/**
 * Discovery Room
 *
 * Collaboration Floor — Phase 1.
 * Define outcomes, constraints, unknowns.
 * Produces requirements doc, gap analysis, risk assessment.
 * Read-only — no code changes allowed.
 */

import { BaseRoom } from './base-room.js';
import type { RoomContract } from '../../core/contracts.js';

export class DiscoveryRoom extends BaseRoom {
  static override contract: RoomContract = {
    roomType: 'discovery',
    floor: 'collaboration',
    tables: {
      collab: { chairs: 4, description: 'PM + SMEs + User define requirements' },
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
      type: 'requirements-document',
      fields: [
        'businessOutcomes',
        'constraints',
        'unknowns',
        'gapAnalysis',
        'riskAssessment',
        'acceptanceCriteria',
      ],
    },
    escalation: {
      onComplete: 'architecture',
    },
    provider: 'configurable', // Complex reasoning — Claude or equivalent
  };

  override getRules(): string[] {
    return [
      'You are in the Discovery Room. Define what needs to be built.',
      'NO code changes. Research, analyze, document.',
      'Identify business outcomes, constraints, and unknowns.',
      'Produce a gap analysis between current and target state.',
      'All risks must include independent analysis and citations.',
    ];
  }

  override getOutputFormat(): Record<string, unknown> {
    return {
      businessOutcomes: ['string'],
      constraints: ['string'],
      unknowns: ['string'],
      gapAnalysis: { current: 'string', target: 'string', gaps: ['string'] },
      riskAssessment: [{ risk: 'string', analysis: 'string', citation: 'string' }],
      acceptanceCriteria: ['string'],
    };
  }
}
