/**
 * Review Room
 *
 * Governance Floor — Go/no-go decisions.
 * Risk questionnaire with independent analysis.
 * Produces gate review exit document with citations.
 *
 * Active behavior:
 * - validateExitDocumentValues: verdict must be GO/NO-GO/CONDITIONAL, evidence required
 * - gateProtocol: enforces exit doc, RAID entry, and signoff requirements
 */

import { BaseRoom } from './base-room.js';
import { ok, err } from '../../core/contracts.js';
import type { Result, RoomContract } from '../../core/contracts.js';

const VALID_VERDICTS = ['GO', 'NO-GO', 'CONDITIONAL'];

export class ReviewRoom extends BaseRoom {
  static override contract: RoomContract = {
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
      'session_note',
      'update_task',
      'create_raid_entry',
      'github_issues', // #756 — read/close issues, review PRs
      'github',        // #756 — PR review, merge decisions
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
    provider: 'configurable',
  };

  gateProtocol = {
    requiresExitDoc: true,
    requiresRaidEntry: true,
    requiresSignoff: true,
    signoffRoles: ['architect', 'user'],
  };

  override getRules(): string[] {
    return [
      'You are in the Review Room. Make a go/no-go decision.',
      'Review ALL evidence — do not rubber-stamp.',
      'Cite specific code (file:line) in your assessment.',
      'Fill the risk questionnaire with independent analysis.',
      'Your verdict must be GO, NO-GO, or CONDITIONAL.',
    ];
  }

  override getOutputFormat(): Record<string, unknown> {
    return {
      verdict: 'GO | NO-GO | CONDITIONAL',
      evidence: [{ claim: 'string', proof: 'string', citation: 'string' }],
      conditions: ['string'],
      riskQuestionnaire: [{ question: 'string', answer: 'string', risk: 'low | medium | high' }],
    };
  }

  override validateExitDocumentValues(document: Record<string, unknown>): Result {
    const verdict = document.verdict as string;
    const evidence = document.evidence as unknown[];
    const riskQuestionnaire = document.riskQuestionnaire as unknown[];

    if (typeof verdict !== 'string' || !VALID_VERDICTS.includes(verdict)) {
      return err('EXIT_DOC_INVALID', `verdict must be one of: ${VALID_VERDICTS.join(', ')}`);
    }
    if (!Array.isArray(evidence) || evidence.length === 0) {
      return err('EXIT_DOC_INVALID', 'evidence must be a non-empty array with citations');
    }
    if (!Array.isArray(riskQuestionnaire) || riskQuestionnaire.length === 0) {
      return err('EXIT_DOC_INVALID', 'riskQuestionnaire must be a non-empty array');
    }

    // CONDITIONAL verdicts must have non-empty conditions
    if (verdict === 'CONDITIONAL') {
      const conditions = document.conditions as unknown[];
      if (!Array.isArray(conditions) || conditions.length === 0) {
        return err('EXIT_DOC_INVALID', 'CONDITIONAL verdict requires a non-empty conditions array');
      }
    }

    return ok(document);
  }

  /**
   * After exit document is validated, route based on verdict.
   * NO-GO → code-lab, CONDITIONAL → emit conditions for tracking.
   */
  routeVerdict(document: Record<string, unknown>, agentId: string): void {
    const verdict = document.verdict as string;

    if (verdict === 'NO-GO') {
      this.bus?.emit('room:escalation:suggested', {
        roomId: this.id,
        roomType: this.type,
        agentId,
        condition: 'onNoGo',
        targetRoom: this.escalation.onNoGo || 'code-lab',
        reason: 'Gate review verdict: NO-GO',
      });
    }

    if (verdict === 'CONDITIONAL') {
      this.bus?.emit('room:gate:conditional', {
        roomId: this.id,
        roomType: this.type,
        agentId,
        conditions: document.conditions,
      });
    }

    if (verdict === 'GO') {
      this.bus?.emit('room:gate:passed', {
        roomId: this.id,
        roomType: this.type,
        agentId,
      });
    }
  }

  /**
   * After tool call: if QA tools show failures, suggest escalation.
   */
  override onAfterToolCall(toolName: string, agentId: string, result: Result): void {
    if ((toolName === 'qa_run_tests' || toolName === 'qa_check_lint') && !result.ok) {
      this.bus?.emit('room:escalation:suggested', {
        roomId: this.id,
        roomType: this.type,
        agentId,
        condition: 'onNoGo',
        targetRoom: this.escalation.onNoGo || 'code-lab',
        reason: `QA check failed during review: ${result.error.message}`,
      });
    }
  }
}
