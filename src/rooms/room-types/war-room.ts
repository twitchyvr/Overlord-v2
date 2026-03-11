/**
 * War Room
 *
 * Collaboration Floor — Incident response.
 * All-hands troubleshooting. Elevated access. Time-boxed.
 *
 * Active behavior:
 * - validateExitDocumentValues: rejects empty rootCause/resolution/preventionPlan
 * - No escalation (war room IS the top escalation target)
 */

import { BaseRoom } from './base-room.js';
import { ok, err } from '../../core/contracts.js';
import type { Result, RoomContract } from '../../core/contracts.js';

export class WarRoom extends BaseRoom {
  static override contract: RoomContract = {
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
    fileScope: 'full',
    exitRequired: {
      type: 'incident-report',
      fields: ['incidentSummary', 'rootCause', 'resolution', 'preventionPlan', 'timeToResolve'],
    },
    escalation: {},
    provider: 'configurable',
  };

  override getRules(): string[] {
    return [
      'You are in the War Room. This is incident response.',
      'Focus on resolving the incident, not long-term fixes.',
      'Document root cause as you investigate.',
      'Time-boxed: escalate to user if not resolved quickly.',
      'Exit document must include prevention plan.',
    ];
  }

  override getOutputFormat(): Record<string, unknown> {
    return {
      incidentSummary: 'string',
      rootCause: 'string',
      resolution: 'string',
      preventionPlan: ['string'],
      timeToResolve: 'string',
    };
  }

  override validateExitDocumentValues(document: Record<string, unknown>): Result {
    const rootCause = document.rootCause as string;
    const resolution = document.resolution as string;
    const preventionPlan = document.preventionPlan as unknown[];

    if (typeof rootCause !== 'string' || rootCause.trim().length === 0) {
      return err('EXIT_DOC_INVALID', 'rootCause must be a non-empty string');
    }
    if (typeof resolution !== 'string' || resolution.trim().length === 0) {
      return err('EXIT_DOC_INVALID', 'resolution must be a non-empty string');
    }
    if (!Array.isArray(preventionPlan) || preventionPlan.length === 0) {
      return err('EXIT_DOC_INVALID', 'preventionPlan must be a non-empty array');
    }

    return ok(document);
  }
}
