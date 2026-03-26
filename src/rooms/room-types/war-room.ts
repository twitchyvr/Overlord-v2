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
  /**
   * Track when each agent entered the war room for time-box awareness.
   */
  private entryTimes: Map<string, number> = new Map();
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
      'github_issues', // #756 — full GitHub access for incident response
      'session_note',
    ],
    fileScope: 'full',
    exitRequired: {
      type: 'incident-report',
      fields: ['incidentSummary', 'rootCause', 'resolution', 'preventionPlan', 'timeToResolve'],
    },
    escalation: {},
    provider: 'configurable',
  };

  /**
   * Track agent entry time for time-boxing.
   */
  override onAgentEnter(agentId: string, tableType: string): Result {
    this.entryTimes.set(agentId, Date.now());
    return super.onAgentEnter(agentId, tableType);
  }

  /**
   * Clean up entry time tracking on exit.
   */
  override onAgentExit(agentId: string): Result {
    this.entryTimes.delete(agentId);
    return super.onAgentExit(agentId);
  }

  /**
   * Get how long an agent has been in the war room (ms).
   * Returns null if agent is not in the room.
   */
  getAgentDuration(agentId: string): number | null {
    const entry = this.entryTimes.get(agentId);
    if (entry === undefined) return null;
    return Date.now() - entry;
  }

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
