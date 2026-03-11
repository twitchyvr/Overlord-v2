/**
 * Agent Router Tests
 */

import { describe, it, expect } from 'vitest';
import { routeMessage, routeMention, resolveReference } from '../../../src/agents/agent-router.js';

describe('Agent Router', () => {
  describe('routeMessage', () => {
    const phases: [string, string][] = [
      ['strategy', 'strategist'],
      ['discovery', 'discovery'],
      ['architecture', 'architecture'],
      ['execution', 'code-lab'],
      ['review', 'review'],
      ['deploy', 'deploy'],
    ];

    for (const [phase, expectedRoom] of phases) {
      it(`routes ${phase} phase to ${expectedRoom} room`, () => {
        const result = routeMessage({
          buildingId: 'b1',
          message: 'test',
          currentPhase: phase,
          rooms: {},
          agents: {},
        });
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect((result.data as Record<string, unknown>).roomType).toBe(expectedRoom);
        }
      });
    }

    it('defaults to code-lab for unknown phase', () => {
      const result = routeMessage({
        buildingId: 'b1',
        message: 'test',
        currentPhase: 'unknown',
        rooms: {},
        agents: {},
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect((result.data as Record<string, unknown>).roomType).toBe('code-lab');
      }
    });
  });

  describe('routeMention', () => {
    it('returns agent name and room', () => {
      const result = routeMention({ agentName: 'developer', roomId: 'room_1' });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect((result.data as Record<string, unknown>).agentName).toBe('developer');
        expect((result.data as Record<string, unknown>).roomId).toBe('room_1');
      }
    });
  });

  describe('resolveReference', () => {
    it('parses #room-name reference', () => {
      const result = resolveReference('#discovery');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect((result.data as Record<string, unknown>).target).toBe('discovery');
        expect((result.data as Record<string, unknown>).messageId).toBeNull();
      }
    });

    it('parses #room-name:messageId reference', () => {
      const result = resolveReference('#code-lab:msg_123');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect((result.data as Record<string, unknown>).target).toBe('code-lab');
        expect((result.data as Record<string, unknown>).messageId).toBe('msg_123');
      }
    });

    it('parses #raid:entryId reference', () => {
      const result = resolveReference('#raid:entry_456');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect((result.data as Record<string, unknown>).target).toBe('raid');
        expect((result.data as Record<string, unknown>).messageId).toBe('entry_456');
      }
    });
  });
});
