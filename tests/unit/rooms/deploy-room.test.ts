/**
 * Deploy Room Tests
 *
 * Verifies the Deploy Room contract — Operations Floor.
 * Git operations, CI/CD triggers, verification.
 * Read-only file scope, single operator.
 */

import { describe, it, expect } from 'vitest';
import { DeployRoom } from '../../../src/rooms/room-types/deploy.js';

describe('DeployRoom', () => {
  describe('contract', () => {
    const contract = DeployRoom.contract;

    it('has correct room type and floor', () => {
      expect(contract.roomType).toBe('deploy');
      expect(contract.floor).toBe('operations');
    });

    it('has focus table with 1 chair — single deployment operator', () => {
      expect(Object.keys(contract.tables)).toHaveLength(1);
      expect(contract.tables.focus.chairs).toBe(1);
    });

    it('has read-only file scope', () => {
      expect(contract.fileScope).toBe('read-only');
    });

    it('provides deployment tools but NO write tools', () => {
      expect(contract.tools).toContain('read_file');
      expect(contract.tools).toContain('list_dir');
      expect(contract.tools).toContain('bash');
      expect(contract.tools).toContain('github');
      expect(contract.tools).toContain('qa_run_tests');
      expect(contract.tools).not.toContain('write_file');
      expect(contract.tools).not.toContain('patch_file');
    });

    it('requires deployment-report exit template with 5 fields', () => {
      expect(contract.exitRequired.type).toBe('deployment-report');
      expect(contract.exitRequired.fields).toHaveLength(5);
      expect(contract.exitRequired.fields).toEqual([
        'environment',
        'version',
        'deployedAt',
        'healthCheck',
        'rollbackPlan',
      ]);
    });

    it('escalates to war-room on failure and rollback', () => {
      expect(contract.escalation).toEqual({
        onFailure: 'war-room',
        onRollback: 'war-room',
      });
    });
  });

  describe('instance behavior', () => {
    it('creates instance with correct type', () => {
      const room = new DeployRoom('room_1');
      expect(room.type).toBe('deploy');
    });

    it('getAllowedTools returns 5 deployment tools', () => {
      const room = new DeployRoom('room_1');
      expect(room.getAllowedTools()).toHaveLength(5);
    });

    it('getRules emphasizes health checks and rollback plan', () => {
      const room = new DeployRoom('room_1');
      const rules = room.getRules();
      expect(rules.some((r) => r.includes('Deploy Room'))).toBe(true);
      expect(rules.some((r) => r.includes('health checks'))).toBe(true);
      expect(rules.some((r) => r.includes('rollback plan'))).toBe(true);
    });

    it('getOutputFormat returns deployment report shape', () => {
      const room = new DeployRoom('room_1');
      const format = room.getOutputFormat() as Record<string, unknown>;
      expect(format).toHaveProperty('environment');
      expect(format).toHaveProperty('version');
      expect(format).toHaveProperty('deployedAt');
      expect(format).toHaveProperty('healthCheck');
      expect(format).toHaveProperty('rollbackPlan');
    });

    it('validates complete exit document', () => {
      const room = new DeployRoom('room_1');
      const result = room.validateExitDocument({
        environment: 'production',
        version: '1.2.0',
        deployedAt: new Date().toISOString(),
        healthCheck: { status: 'healthy', endpoints: ['/api/health'] },
        rollbackPlan: 'Revert to v1.1.0 tag',
      });
      expect(result.ok).toBe(true);
    });

    it('rejects exit document missing rollback plan', () => {
      const room = new DeployRoom('room_1');
      const result = room.validateExitDocument({
        environment: 'staging',
        version: '1.0.0',
      });
      expect(result.ok).toBe(false);
    });
  });
});
