/**
 * Deploy Room
 *
 * Operations Floor — Git operations, CI/CD triggers, verification.
 * Requires Release Lounge sign-off before entry.
 *
 * Active behavior:
 * - validateExitDocumentValues: rejects empty rollbackPlan, validates healthCheck
 * - onAfterToolCall: detects deployment failures and suggests war-room escalation
 */

import { BaseRoom } from './base-room.js';
import { ok, err } from '../../core/contracts.js';
import type { Result, RoomContract } from '../../core/contracts.js';

export class DeployRoom extends BaseRoom {
  static override contract: RoomContract = {
    roomType: 'deploy',
    floor: 'operations',
    tables: {
      focus: { chairs: 1, description: 'Single deployment operator' },
    },
    tools: [
      'read_file',
      'list_dir',
      'bash',
      'github',
      'qa_run_tests',
      'session_note',
    ],
    fileScope: 'read-only',
    exitRequired: {
      type: 'deployment-report',
      fields: ['environment', 'version', 'deployedAt', 'healthCheck', 'rollbackPlan'],
    },
    escalation: {
      onFailure: 'war-room',
      onRollback: 'war-room',
    },
    provider: 'configurable',
  };

  override getRules(): string[] {
    return [
      'You are in the Deploy Room. Execute the deployment plan.',
      'Verify Release Lounge sign-off before proceeding.',
      'Run health checks after deployment.',
      'Document rollback plan in exit document.',
      'If deployment fails, escalate to War Room immediately.',
    ];
  }

  override getOutputFormat(): Record<string, unknown> {
    return {
      environment: 'string',
      version: 'string',
      deployedAt: 'string',
      healthCheck: { status: 'string', endpoints: ['string'] },
      rollbackPlan: 'string',
    };
  }

  override validateExitDocumentValues(document: Record<string, unknown>): Result {
    const environment = document.environment as string;
    const version = document.version as string;
    const rollbackPlan = document.rollbackPlan as string;
    const healthCheck = document.healthCheck as Record<string, unknown> | undefined;

    if (typeof environment !== 'string' || environment.trim().length === 0) {
      return err('EXIT_DOC_INVALID', 'environment must be a non-empty string');
    }
    if (typeof version !== 'string' || version.trim().length === 0) {
      return err('EXIT_DOC_INVALID', 'version must be a non-empty string');
    }
    if (typeof rollbackPlan !== 'string' || rollbackPlan.trim().length === 0) {
      return err('EXIT_DOC_INVALID', 'rollbackPlan must be a non-empty string');
    }
    if (!healthCheck || typeof healthCheck !== 'object') {
      return err('EXIT_DOC_INVALID', 'healthCheck must be an object with status and endpoints');
    }

    return ok(document);
  }

  /**
   * Block direct file write operations — Deploy is read-only.
   * Only bash and github tools can make changes (via CI/CD, not direct file edits).
   */
  override onBeforeToolCall(toolName: string, _agentId: string, _input: Record<string, unknown>): Result {
    const WRITE_TOOLS = ['write_file', 'patch_file'];
    if (WRITE_TOOLS.includes(toolName)) {
      return err('TOOL_BLOCKED', `${toolName} is not allowed in the Deploy Room — use CI/CD tools for deployment`);
    }
    return ok(null);
  }

  /**
   * After tool call: detect deployment failures and suggest war-room escalation.
   */
  override onAfterToolCall(toolName: string, agentId: string, result: Result): void {
    if ((toolName === 'bash' || toolName === 'github') && !result.ok) {
      this.bus?.emit('room:escalation:suggested', {
        roomId: this.id,
        roomType: this.type,
        agentId,
        condition: 'onFailure',
        targetRoom: this.escalation.onFailure || 'war-room',
        reason: `Deployment operation failed: ${result.error.message}`,
      });
    }
  }
}
