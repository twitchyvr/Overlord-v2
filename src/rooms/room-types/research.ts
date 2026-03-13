import { BaseRoom } from './base-room.js';
import { ok, err } from '../../core/contracts.js';
import type { Result, RoomContract } from '../../core/contracts.js';

export class ResearchRoom extends BaseRoom {
  static override contract: RoomContract = {
    roomType: 'research',
    floor: 'collaboration',
    tables: {
      collab: { chairs: 4, description: 'Researchers + SMEs gather and analyze information' },
    },
    tools: ['read_file', 'list_dir', 'web_search', 'fetch_webpage', 'record_note', 'recall_notes', 'session_note'],
    fileScope: 'read-only',
    exitRequired: {
      type: 'research-report',
      fields: ['findings', 'sources', 'recommendations', 'gaps'],
    },
    escalation: { onComplete: 'architecture' },
    provider: 'configurable',
  };

  override getRules(): string[] {
    return [
      'You are in the Research Room. Gather information and produce a research report.',
      'NO code changes. Research, analyze, and document findings.',
      'Cite all sources — every finding must have a traceable origin.',
      'Identify knowledge gaps and flag areas needing further investigation.',
      'Produce actionable recommendations based on evidence.',
      'PLAIN LANGUAGE: Present findings in business language the user understands.',
    ];
  }

  override getOutputFormat(): Record<string, unknown> {
    return {
      findings: [{ topic: 'string', summary: 'string', evidence: 'string' }],
      sources: [{ title: 'string', url: 'string', reliability: 'string' }],
      recommendations: ['string'],
      gaps: ['string'],
    };
  }

  override onBeforeToolCall(toolName: string, _agentId: string, _input: Record<string, unknown>): Result {
    if (['write_file', 'patch_file'].includes(toolName)) {
      return err('TOOL_BLOCKED', `${toolName} is not allowed in the Research Room — no code changes permitted`);
    }
    return ok(null);
  }

  override onAfterToolCall(toolName: string, agentId: string, result: Result): void {
    if ((toolName === 'web_search' || toolName === 'fetch_webpage') && !result.ok) {
      this.bus?.emit('room:escalation:suggested', {
        roomId: this.id, roomType: this.type, agentId,
        condition: 'onComplete', targetRoom: this.escalation.onComplete || 'architecture',
        reason: `Research tool ${toolName} failed: ${result.error.message}`,
      });
    }
  }

  override validateExitDocumentValues(document: Record<string, unknown>): Result {
    const findings = document.findings as unknown[];
    const sources = document.sources as unknown[];
    if (!Array.isArray(findings) || findings.length === 0) return err('EXIT_DOC_INVALID', 'findings must be a non-empty array');
    if (!Array.isArray(sources) || sources.length === 0) return err('EXIT_DOC_INVALID', 'sources must be a non-empty array');
    return ok(document);
  }
}
