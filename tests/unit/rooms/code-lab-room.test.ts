/**
 * Code Lab Room Tests
 *
 * Verifies the Code Lab contract — Execution Floor.
 * Full implementation workspace with assigned file scope enforcement.
 */

import { describe, it, expect } from 'vitest';
import { CodeLab } from '../../../src/rooms/room-types/code-lab.js';
import { EventEmitter } from 'eventemitter3';
import type { Bus } from '../../../src/core/bus.js';

function createMockBus(): Bus {
  const ee = new EventEmitter();
  const emissions: Array<{ event: string; data: unknown }> = [];
  return {
    emit: (event: string | symbol, data?: Record<string, unknown>) => {
      emissions.push({ event: event as string, data });
      ee.emit(event, data);
      return true;
    },
    on: ee.on.bind(ee),
    onNamespace: () => {},
    _emissions: emissions,
  } as unknown as Bus & { _emissions: typeof emissions };
}

describe('CodeLab', () => {
  describe('contract', () => {
    const contract = CodeLab.contract;

    it('has correct room type and floor', () => {
      expect(contract.roomType).toBe('code-lab');
      expect(contract.floor).toBe('execution');
    });

    it('has three table types: focus, collab, boardroom', () => {
      expect(Object.keys(contract.tables)).toHaveLength(3);
      expect(contract.tables.focus.chairs).toBe(1);
      expect(contract.tables.collab.chairs).toBe(4);
      expect(contract.tables.boardroom.chairs).toBe(8);
    });

    it('has assigned file scope', () => {
      expect(contract.fileScope).toBe('assigned');
    });

    it('provides write tools', () => {
      expect(contract.tools).toContain('write_file');
      expect(contract.tools).toContain('patch_file');
      expect(contract.tools).toContain('bash');
      expect(contract.tools).toContain('read_file');
    });

    it('requires implementation-report exit template with 4 fields', () => {
      expect(contract.exitRequired.type).toBe('implementation-report');
      expect(contract.exitRequired.fields).toHaveLength(4);
      expect(contract.exitRequired.fields).toEqual([
        'filesModified', 'testsAdded', 'changesDescription', 'riskAssessment',
      ]);
    });

    it('escalates errors to war-room and scope changes to discovery', () => {
      expect(contract.escalation).toEqual({
        onError: 'war-room',
        onScopeChange: 'discovery',
      });
    });
  });

  describe('onBeforeToolCall — file scope enforcement', () => {
    it('allows all writes when no assigned files are set', () => {
      const room = new CodeLab('room_1');
      const result = room.onBeforeToolCall('write_file', 'agent_1', { path: '/any/path.ts' });
      expect(result.ok).toBe(true);
    });

    it('allows writes to assigned files', () => {
      const room = new CodeLab('room_1');
      room.setAssignedFiles(['src/main.ts', 'src/utils/']);

      const r1 = room.onBeforeToolCall('write_file', 'agent_1', { path: 'src/main.ts' });
      expect(r1.ok).toBe(true);

      const r2 = room.onBeforeToolCall('patch_file', 'agent_1', { path: 'src/utils/helper.ts' });
      expect(r2.ok).toBe(true);
    });

    it('blocks writes to files outside assigned scope', () => {
      const room = new CodeLab('room_1');
      room.setAssignedFiles(['src/main.ts']);

      const result = room.onBeforeToolCall('write_file', 'agent_1', { path: 'src/other.ts' });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('TOOL_BLOCKED');
        expect(result.error.message).toContain('outside assigned file scope');
        expect(result.error.message).toContain('src/main.ts');
      }
    });

    it('allows writes under assigned directory', () => {
      const room = new CodeLab('room_1');
      room.setAssignedFiles(['src/components/']);

      const result = room.onBeforeToolCall('write_file', 'agent_1', { path: 'src/components/button.tsx' });
      expect(result.ok).toBe(true);
    });

    it('blocks writes to sibling directory', () => {
      const room = new CodeLab('room_1');
      room.setAssignedFiles(['src/components/']);

      const result = room.onBeforeToolCall('write_file', 'agent_1', { path: 'src/utils/helper.ts' });
      expect(result.ok).toBe(false);
    });

    it('does not block read operations regardless of scope', () => {
      const room = new CodeLab('room_1');
      room.setAssignedFiles(['src/main.ts']);

      const result = room.onBeforeToolCall('read_file', 'agent_1', { path: 'tests/test.ts' });
      expect(result.ok).toBe(true);
    });

    it('does not block bash regardless of scope', () => {
      const room = new CodeLab('room_1');
      room.setAssignedFiles(['src/main.ts']);

      const result = room.onBeforeToolCall('bash', 'agent_1', { command: 'npm test' });
      expect(result.ok).toBe(true);
    });

    it('handles file_path input key', () => {
      const room = new CodeLab('room_1');
      room.setAssignedFiles(['src/main.ts']);

      const result = room.onBeforeToolCall('write_file', 'agent_1', { file_path: 'src/main.ts' });
      expect(result.ok).toBe(true);
    });
  });

  describe('onAfterToolCall — escalation on write failure', () => {
    it('emits escalation when write_file fails', () => {
      const room = new CodeLab('room_1');
      const bus = createMockBus();
      room.setBus(bus);

      room.onAfterToolCall('write_file', 'agent_1', {
        ok: false, error: { code: 'WRITE_FAILED', message: 'Permission denied', retryable: false },
      });

      const emissions = (bus as unknown as { _emissions: Array<{ event: string }> })._emissions;
      const escalation = emissions.find((e) => e.event === 'room:escalation:suggested');
      expect(escalation).toBeDefined();
    });

    it('does not emit escalation on successful write', () => {
      const room = new CodeLab('room_1');
      const bus = createMockBus();
      room.setBus(bus);

      room.onAfterToolCall('write_file', 'agent_1', { ok: true, data: {} });

      const emissions = (bus as unknown as { _emissions: Array<{ event: string }> })._emissions;
      const escalation = emissions.find((e) => e.event === 'room:escalation:suggested');
      expect(escalation).toBeUndefined();
    });
  });

  describe('exit document validation', () => {
    it('accepts complete implementation report', () => {
      const room = new CodeLab('room_1');
      const result = room.validateExitDocument({
        filesModified: ['src/main.ts'],
        testsAdded: ['tests/main.test.ts'],
        changesDescription: 'Added user auth',
        riskAssessment: 'Low risk — isolated change',
      });
      expect(result.ok).toBe(true);
    });

    it('rejects empty filesModified', () => {
      const room = new CodeLab('room_1');
      const result = room.validateExitDocument({
        filesModified: [],
        testsAdded: [],
        changesDescription: 'something',
        riskAssessment: 'none',
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.message).toContain('filesModified');
    });

    it('rejects empty changesDescription', () => {
      const room = new CodeLab('room_1');
      const result = room.validateExitDocument({
        filesModified: ['a.ts'],
        testsAdded: [],
        changesDescription: '  ',
        riskAssessment: 'none',
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.message).toContain('changesDescription');
    });
  });
});
