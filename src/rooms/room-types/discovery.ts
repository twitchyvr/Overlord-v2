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
      'session_note',
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
      'PLAIN LANGUAGE: Translate all findings into business language the user understands. Present requirements as what the user will experience, not the technology. Example: "Customers can place orders online" not "REST API with cart endpoints".',
      'When effortLevel is "easy", make all technical decisions autonomously. Only ask the user about business-logic questions: "Will customers need accounts?" not "Which auth provider?".',
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

  /**
   * Block write operations — Discovery is read-only research.
   */
  override onBeforeToolCall(toolName: string, _agentId: string, _input: Record<string, unknown>): Result {
    const WRITE_TOOLS = ['write_file', 'patch_file'];
    if (WRITE_TOOLS.includes(toolName)) {
      return err('TOOL_BLOCKED', `${toolName} is not allowed in the Discovery Room — no code changes permitted`);
    }
    return ok(null);
  }

  /**
   * After tool call: detect research tool failures.
   */
  override onAfterToolCall(toolName: string, agentId: string, result: Result): void {
    if ((toolName === 'web_search' || toolName === 'fetch_webpage') && !result.ok) {
      this.bus?.emit('room:escalation:suggested', {
        roomId: this.id,
        roomType: this.type,
        agentId,
        condition: 'onComplete',
        targetRoom: this.escalation.onComplete || 'architecture',
        reason: `Research tool ${toolName} failed: ${result.error.message}`,
      });
    }
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
