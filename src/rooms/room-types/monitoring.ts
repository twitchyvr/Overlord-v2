import { BaseRoom } from './base-room.js';
import { ok, err } from '../../core/contracts.js';
import type { Result, RoomContract } from '../../core/contracts.js';

export class MonitoringRoom extends BaseRoom {
  static override contract: RoomContract = {
    roomType: 'monitoring',
    floor: 'operations',
    tables: {
      focus: { chairs: 1, description: 'Solo monitoring configuration' },
      collab: { chairs: 3, description: 'SRE + DevOps collaboration' },
    },
    tools: ['read_file', 'write_file', 'patch_file', 'list_dir', 'bash', 'web_search', 'session_note'],
    fileScope: 'assigned',
    exitRequired: {
      type: 'monitoring-report',
      fields: ['metricsConfigured', 'alertsCreated', 'dashboardsSetup', 'recommendations'],
    },
    escalation: { onFailure: 'code-lab' },
    provider: 'configurable',
  };

  override getRules(): string[] {
    return [
      'You are in the Monitoring Room. Set up observability for the system.',
      'Configure health checks for all critical services and endpoints.',
      'Define alerting thresholds with clear escalation paths.',
      'Set up performance dashboards with actionable metrics.',
      'Every metric must have a purpose — no vanity metrics.',
      'Document all alerting rules and their expected response procedures.',
    ];
  }

  override getOutputFormat(): Record<string, unknown> {
    return {
      metricsConfigured: [{ name: 'string', type: 'string', threshold: 'string' }],
      alertsCreated: [{ name: 'string', condition: 'string', severity: 'string' }],
      dashboardsSetup: [{ name: 'string', panels: ['string'] }],
      recommendations: ['string'],
    };
  }

  override validateExitDocumentValues(document: Record<string, unknown>): Result {
    const metricsConfigured = document.metricsConfigured as unknown[];
    if (!Array.isArray(metricsConfigured) || metricsConfigured.length === 0) return err('EXIT_DOC_INVALID', 'metricsConfigured must be a non-empty array');
    return ok(document);
  }

  override onAfterToolCall(toolName: string, agentId: string, result: Result): void {
    if ((toolName === 'bash' || toolName === 'write_file' || toolName === 'patch_file') && !result.ok) {
      this.bus?.emit('room:escalation:suggested', {
        roomId: this.id, roomType: this.type, agentId,
        condition: 'onFailure', targetRoom: this.escalation.onFailure || 'code-lab',
        reason: `Monitoring configuration failed: ${result.error.message}`,
      });
    }
  }
}
