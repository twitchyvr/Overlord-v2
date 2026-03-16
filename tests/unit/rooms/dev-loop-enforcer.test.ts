/**
 * Dev Loop Enforcer Tests (#652)
 *
 * Verifies the automatic pipeline progression:
 *   Code Lab exit doc → Review stage
 *   Review GO verdict → Testing Lab stage
 *   Review NO-GO verdict → Code Lab (loop back)
 *   Testing Lab pass → Dogfood stage
 *   Testing Lab fail → Code Lab (loop back)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'eventemitter3';
import { initDevLoopEnforcer } from '../../../src/rooms/dev-loop-enforcer.js';

// Mock storage
vi.mock('../../../src/storage/db.js', () => ({
  getDb: () => ({
    prepare: () => ({
      get: () => null, // No rooms found by default
    }),
  }),
}));

function createMockBus() {
  const ee = new EventEmitter();
  const emitSpy = vi.fn((...args: unknown[]) => {
    ee.emit(args[0] as string, args[1]);
    return true;
  });
  return {
    emit: emitSpy,
    on: ee.on.bind(ee),
    onNamespace: () => {},
    _emitSpy: emitSpy,
  } as unknown as import('../../../src/core/bus.js').Bus & { _emitSpy: ReturnType<typeof vi.fn> };
}

describe('Dev Loop Enforcer', () => {
  let bus: ReturnType<typeof createMockBus>;

  beforeEach(() => {
    vi.clearAllMocks();
    bus = createMockBus();
    initDevLoopEnforcer(bus);
  });

  describe('Code Lab → Review', () => {
    it('emits stage-transition when code-lab submits exit doc', () => {
      bus.emit('exit-doc:submitted', {
        roomType: 'code-lab',
        buildingId: 'bld_1',
        agentId: 'agent_1',
        id: 'doc_1',
      });

      const transitions = bus._emitSpy.mock.calls.filter(
        (c: unknown[]) => c[0] === 'dev-loop:stage-transition',
      );
      expect(transitions.length).toBe(1);
      expect(transitions[0][1].from).toBe('code-lab');
      expect(transitions[0][1].to).toBe('review');
      expect(transitions[0][1].buildingId).toBe('bld_1');
    });

    it('does NOT trigger for non-code-lab exit docs', () => {
      bus.emit('exit-doc:submitted', {
        roomType: 'strategist',
        buildingId: 'bld_1',
        agentId: 'agent_1',
        id: 'doc_1',
      });

      const transitions = bus._emitSpy.mock.calls.filter(
        (c: unknown[]) => c[0] === 'dev-loop:stage-transition',
      );
      expect(transitions.length).toBe(0);
    });
  });

  describe('Review → Testing Lab', () => {
    it('emits stage-transition on GO verdict', () => {
      bus.emit('phase:gate:signed-off', {
        verdict: 'GO',
        buildingId: 'bld_1',
        gateId: 'gate_1',
      });

      const transitions = bus._emitSpy.mock.calls.filter(
        (c: unknown[]) => c[0] === 'dev-loop:stage-transition',
      );
      expect(transitions.length).toBe(1);
      expect(transitions[0][1].from).toBe('review');
      expect(transitions[0][1].to).toBe('testing-lab');
      expect(transitions[0][1].verdict).toBe('GO');
    });

    it('emits stage-transition on CONDITIONAL verdict', () => {
      bus.emit('phase:gate:signed-off', {
        verdict: 'CONDITIONAL',
        buildingId: 'bld_1',
        gateId: 'gate_1',
      });

      const transitions = bus._emitSpy.mock.calls.filter(
        (c: unknown[]) => c[0] === 'dev-loop:stage-transition',
      );
      expect(transitions.length).toBe(1);
      expect(transitions[0][1].to).toBe('testing-lab');
    });

    it('routes back to code-lab on NO-GO verdict', () => {
      bus.emit('phase:gate:signed-off', {
        verdict: 'NO-GO',
        buildingId: 'bld_1',
        gateId: 'gate_1',
      });

      const transitions = bus._emitSpy.mock.calls.filter(
        (c: unknown[]) => c[0] === 'dev-loop:stage-transition',
      );
      expect(transitions.length).toBe(1);
      expect(transitions[0][1].from).toBe('review');
      expect(transitions[0][1].to).toBe('code-lab');
      expect(transitions[0][1].verdict).toBe('NO-GO');
    });
  });

  describe('Testing Lab → Dogfood', () => {
    it('emits dogfood transition when all tests pass', () => {
      bus.emit('exit-doc:submitted', {
        roomType: 'testing-lab',
        buildingId: 'bld_1',
        id: 'doc_1',
        document: { testsPassed: 42, testsFailed: 0, testsRun: 42 },
      });

      const transitions = bus._emitSpy.mock.calls.filter(
        (c: unknown[]) => c[0] === 'dev-loop:stage-transition',
      );
      expect(transitions.length).toBe(1);
      expect(transitions[0][1].from).toBe('testing-lab');
      expect(transitions[0][1].to).toBe('dogfood');
      expect(transitions[0][1].testsPassed).toBe(42);
      expect(transitions[0][1].testsFailed).toBe(0);
    });

    it('routes back to code-lab when tests fail', () => {
      bus.emit('exit-doc:submitted', {
        roomType: 'testing-lab',
        buildingId: 'bld_1',
        id: 'doc_1',
        document: { testsPassed: 40, testsFailed: 2, testsRun: 42 },
      });

      const transitions = bus._emitSpy.mock.calls.filter(
        (c: unknown[]) => c[0] === 'dev-loop:stage-transition',
      );
      expect(transitions.length).toBe(1);
      expect(transitions[0][1].from).toBe('testing-lab');
      expect(transitions[0][1].to).toBe('code-lab');
      expect(transitions[0][1].testsFailed).toBe(2);
    });
  });
});
