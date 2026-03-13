import { BaseRoom } from './base-room.js';
import { ok, err } from '../../core/contracts.js';
import type { Result, RoomContract } from '../../core/contracts.js';

export class SecurityReviewRoom extends BaseRoom {
  static override contract: RoomContract = {
    roomType: 'security-review',
    floor: 'governance',
    tables: {
      review: { chairs: 3, description: 'Security auditor + Architect + DevOps' },
    },
    tools: ['read_file', 'list_dir', 'bash', 'web_search', 'fetch_webpage', 'session_note'],
    fileScope: 'read-only',
    exitRequired: {
      type: 'security-report',
      fields: ['vulnerabilities', 'riskLevel', 'recommendations', 'dependencyAudit', 'complianceChecks'],
    },
    escalation: { onCritical: 'war-room', onComplete: 'deploy' },
    provider: 'configurable',
  };

  override getRules(): string[] {
    return [
      'You are in the Security Review Room. Conduct a thorough security audit.',
      'NEVER approve code with known vulnerabilities — security is non-negotiable.',
      'Check OWASP Top 10 vulnerabilities against the codebase.',
      'Scan ALL dependencies for known CVEs and outdated packages.',
      'Report severity levels for every finding: critical, high, medium, low.',
      'NO code changes — document findings and recommendations only.',
    ];
  }

  override getOutputFormat(): Record<string, unknown> {
    return {
      vulnerabilities: [{ id: 'string', severity: 'string', description: 'string', location: 'string' }],
      riskLevel: 'critical | high | medium | low',
      recommendations: [{ priority: 'string', action: 'string', rationale: 'string' }],
      dependencyAudit: { totalDeps: 'number', outdated: 'number', vulnerable: 'number', details: ['string'] },
      complianceChecks: [{ standard: 'string', status: 'pass | fail | partial', notes: 'string' }],
    };
  }

  override onBeforeToolCall(toolName: string, _agentId: string, _input: Record<string, unknown>): Result {
    if (['write_file', 'patch_file'].includes(toolName)) {
      return err('TOOL_BLOCKED', `${toolName} is not allowed in the Security Review Room — no code changes permitted`);
    }
    return ok(null);
  }

  override onAfterToolCall(toolName: string, agentId: string, result: Result): void {
    if ((toolName === 'bash' || toolName === 'web_search') && !result.ok) {
      this.bus?.emit('room:escalation:suggested', {
        roomId: this.id, roomType: this.type, agentId,
        condition: 'onCritical', targetRoom: this.escalation.onCritical || 'war-room',
        reason: `Security scan tool ${toolName} failed: ${result.error.message}`,
      });
    }
  }

  override validateExitDocumentValues(document: Record<string, unknown>): Result {
    const vulnerabilities = document.vulnerabilities;
    const riskLevel = document.riskLevel;
    const recommendations = document.recommendations as unknown[];
    if (!Array.isArray(vulnerabilities)) return err('EXIT_DOC_INVALID', 'vulnerabilities must be an array');
    if (typeof riskLevel !== 'string' || riskLevel.trim().length === 0) return err('EXIT_DOC_INVALID', 'riskLevel must be a non-empty string');
    if (!Array.isArray(recommendations) || recommendations.length === 0) return err('EXIT_DOC_INVALID', 'recommendations must be a non-empty array');
    return ok(document);
  }
}
