/**
 * Discovery Room
 *
 * Collaboration Floor — Phase 1.
 * Define outcomes, constraints, unknowns.
 * Produces requirements doc, gap analysis, risk assessment.
 * Read-only — no code changes allowed.
 *
 * Active behavior:
 * - validateExitDocumentValues: rejects empty outcomes/criteria/risks
 */

import { BaseRoom } from './base-room.js';
import { ok, err } from '../../core/contracts.js';
import type { Result, RoomContract } from '../../core/contracts.js';

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
    provider: 'configurable',
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

  override validateExitDocumentValues(document: Record<string, unknown>): Result {
    const businessOutcomes = document.businessOutcomes as unknown[];
    const acceptanceCriteria = document.acceptanceCriteria as unknown[];
    const riskAssessment = document.riskAssessment as unknown[];

    if (!Array.isArray(businessOutcomes) || businessOutcomes.length === 0) {
      return err('EXIT_DOC_INVALID', 'businessOutcomes must be a non-empty array');
    }
    if (!Array.isArray(acceptanceCriteria) || acceptanceCriteria.length === 0) {
      return err('EXIT_DOC_INVALID', 'acceptanceCriteria must be a non-empty array');
    }
    if (!Array.isArray(riskAssessment) || riskAssessment.length === 0) {
      return err('EXIT_DOC_INVALID', 'riskAssessment must be a non-empty array');
    }

    return ok(document);
  }
}
