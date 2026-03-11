/**
 * Deploy Room
 *
 * Operations Floor — Git operations, CI/CD triggers, verification.
 * Requires Release Lounge sign-off before entry.
 */

import { BaseRoom } from './base-room.js';

export class DeployRoom extends BaseRoom {
  static contract = {
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

  getRules() {
    return [
      'You are in the Deploy Room. Execute the deployment plan.',
      'Verify Release Lounge sign-off before proceeding.',
      'Run health checks after deployment.',
      'Document rollback plan in exit document.',
      'If deployment fails, escalate to War Room immediately.',
    ];
  }

  getOutputFormat() {
    return {
      environment: 'string',
      version: 'string',
      deployedAt: 'string',
      healthCheck: { status: 'string', endpoints: ['string'] },
      rollbackPlan: 'string',
    };
  }
}
