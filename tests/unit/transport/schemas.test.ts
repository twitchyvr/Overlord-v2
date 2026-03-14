/**
 * Transport Schemas Tests
 *
 * Tests Zod validation schemas for all socket event payloads
 * and the validate() helper function.
 *
 * Schema categories tested:
 * - validate() helper (ack callback, error formatting, null on failure)
 * - Building schemas (create, get, list, applyBlueprint)
 * - Floor schemas (list, get)
 * - Room schemas (create, get, enter, exit)
 * - Agent schemas (register, get, list)
 * - Chat schemas (message with tokens, defaults)
 * - Empty payload schema (strict mode)
 * - Phase schemas (status, gate, signoff, advance, resolve, stale)
 * - RAID schemas (search, list, add, update, edit)
 * - Task schemas (create, update, list, get)
 * - TODO schemas (create, toggle, list, delete)
 * - Exit document schemas (submit, get, list)
 * - Field length limits (MAX_ID, MAX_NAME, MAX_DESCRIPTION, MAX_TEXT)
 */

import { describe, it, expect, vi } from 'vitest';
import {
  validate,
  BuildingCreateSchema,
  BuildingGetSchema,
  BuildingListSchema,
  BuildingApplyBlueprintSchema,
  BuildingHealthScoreSchema,
  FloorListSchema,
  FloorGetSchema,
  RoomCreateSchema,
  RoomGetSchema,
  RoomEnterSchema,
  RoomExitSchema,
  AgentRegisterSchema,
  AgentGetSchema,
  AgentListSchema,
  ChatMessageSchema,
  EmptyPayloadSchema,
  PhaseStatusSchema,
  PhaseGateSchema,
  PhaseGatesSchema,
  PhaseCanAdvanceSchema,
  PhasePendingGatesSchema,
  PhaseResolveConditionsSchema,
  PhaseStaleGatesSchema,
  PhaseGateCreateSchema,
  PhaseGateSignoffSchema,
  PhaseAdvanceSchema,
  RaidSearchSchema,
  RaidListSchema,
  RaidAddSchema,
  RaidUpdateSchema,
  RaidEditSchema,
  TaskCreateSchema,
  TaskUpdateSchema,
  TaskListSchema,
  TaskGetSchema,
  TodoCreateSchema,
  TodoToggleSchema,
  TodoListSchema,
  TodoDeleteSchema,
  ExitDocSubmitSchema,
  ExitDocGetSchema,
  ExitDocListSchema,
  SearchGlobalSchema,
  QualityConfigGetSchema,
  QualityConfigSetSchema,
} from '../../../src/transport/schemas.js';

// ═══════════════════════════════════════════════════════════
// validate() helper
// ═══════════════════════════════════════════════════════════

describe('validate()', () => {
  it('returns parsed data on valid input', () => {
    const result = validate(BuildingGetSchema, { buildingId: 'bld_1' }, 'building:get');
    expect(result).toEqual({ buildingId: 'bld_1' });
  });

  it('returns null on invalid input', () => {
    const result = validate(BuildingGetSchema, {}, 'building:get');
    expect(result).toBeNull();
  });

  it('calls ack with structured error on validation failure', () => {
    const ack = vi.fn();
    validate(BuildingGetSchema, {}, 'building:get', ack);

    expect(ack).toHaveBeenCalledTimes(1);
    const call = ack.mock.calls[0][0];
    expect(call.ok).toBe(false);
    expect(call.error.code).toBe('VALIDATION_ERROR');
    expect(call.error.message).toContain('Invalid payload for "building:get"');
    expect(call.error.retryable).toBe(false);
  });

  it('handles missing ack gracefully (no error thrown)', () => {
    // No ack callback — should return null without crashing
    const result = validate(BuildingGetSchema, {}, 'building:get');
    expect(result).toBeNull();
  });

  it('formats multi-issue error messages with semicolons', () => {
    const ack = vi.fn();
    // RaidAddSchema requires buildingId, type, and summary
    validate(RaidAddSchema, {}, 'raid:add', ack);

    const message = ack.mock.calls[0][0].error.message;
    // Multiple missing fields — should be joined by '; '
    expect(message).toContain(';');
    expect(message).toContain('buildingId');
  });

  it('includes field path in error messages', () => {
    const ack = vi.fn();
    validate(BuildingGetSchema, { buildingId: '' }, 'building:get', ack);

    const message = ack.mock.calls[0][0].error.message;
    expect(message).toContain('buildingId');
  });

  it('applies schema defaults and returns enriched data', () => {
    const result = validate(ChatMessageSchema, {}, 'chat:message');
    expect(result).toEqual({
      text: '',
      tokens: [],
      attachments: [],
      buildingId: '',
      roomId: '',
      agentId: '',
      threadId: '',
    });
  });
});

// ═══════════════════════════════════════════════════════════
// Building Schemas
// ═══════════════════════════════════════════════════════════

describe('Building Schemas', () => {
  describe('BuildingCreateSchema', () => {
    it('accepts valid input with required name', () => {
      const result = BuildingCreateSchema.safeParse({ name: 'My Building' });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.name).toBe('My Building');
    });

    it('rejects missing name', () => {
      const result = BuildingCreateSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it('rejects empty name', () => {
      const result = BuildingCreateSchema.safeParse({ name: '' });
      expect(result.success).toBe(false);
    });

    it('accepts optional projectId and description', () => {
      const result = BuildingCreateSchema.safeParse({
        name: 'Test',
        projectId: 'proj_1',
        description: 'A test building',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.projectId).toBe('proj_1');
        expect(result.data.description).toBe('A test building');
      }
    });

    it('allows passthrough of extra fields', () => {
      const result = BuildingCreateSchema.safeParse({
        name: 'Test',
        customField: 'allowed',
      });
      expect(result.success).toBe(true);
    });

    it('rejects name exceeding MAX_NAME (500 chars)', () => {
      const result = BuildingCreateSchema.safeParse({ name: 'x'.repeat(501) });
      expect(result.success).toBe(false);
    });

    it('accepts valid effortLevel "easy"', () => {
      const result = BuildingCreateSchema.safeParse({ name: 'Test', effortLevel: 'easy' });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.effortLevel).toBe('easy');
    });

    it('accepts valid effortLevel "medium"', () => {
      const result = BuildingCreateSchema.safeParse({ name: 'Test', effortLevel: 'medium' });
      expect(result.success).toBe(true);
    });

    it('accepts valid effortLevel "advanced"', () => {
      const result = BuildingCreateSchema.safeParse({ name: 'Test', effortLevel: 'advanced' });
      expect(result.success).toBe(true);
    });

    it('accepts omitted effortLevel (optional)', () => {
      const result = BuildingCreateSchema.safeParse({ name: 'Test' });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.effortLevel).toBeUndefined();
    });

    it('rejects invalid effortLevel value', () => {
      const result = BuildingCreateSchema.safeParse({ name: 'Test', effortLevel: 'extreme' });
      expect(result.success).toBe(false);
    });
  });

  describe('BuildingGetSchema', () => {
    it('accepts valid buildingId', () => {
      const result = BuildingGetSchema.safeParse({ buildingId: 'bld_1' });
      expect(result.success).toBe(true);
    });

    it('rejects missing buildingId', () => {
      const result = BuildingGetSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it('rejects empty buildingId', () => {
      const result = BuildingGetSchema.safeParse({ buildingId: '' });
      expect(result.success).toBe(false);
    });

    it('rejects buildingId exceeding MAX_ID (100 chars)', () => {
      const result = BuildingGetSchema.safeParse({ buildingId: 'x'.repeat(101) });
      expect(result.success).toBe(false);
    });
  });

  describe('BuildingListSchema', () => {
    it('accepts empty object', () => {
      const result = BuildingListSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it('accepts undefined (defaults to {})', () => {
      const result = BuildingListSchema.safeParse(undefined);
      expect(result.success).toBe(true);
      if (result.success) expect(result.data).toEqual({});
    });

    it('accepts optional projectId', () => {
      const result = BuildingListSchema.safeParse({ projectId: 'proj_1' });
      expect(result.success).toBe(true);
    });
  });

  describe('BuildingApplyBlueprintSchema', () => {
    it('accepts valid input', () => {
      const result = BuildingApplyBlueprintSchema.safeParse({
        buildingId: 'bld_1',
        blueprint: { floors: [] },
        agentId: 'agent_1',
      });
      expect(result.success).toBe(true);
    });

    it('rejects missing required fields', () => {
      const result = BuildingApplyBlueprintSchema.safeParse({});
      expect(result.success).toBe(false);
    });
  });

  describe('BuildingHealthScoreSchema', () => {
    it('accepts valid buildingId', () => {
      const result = BuildingHealthScoreSchema.safeParse({ buildingId: 'bld_123' });
      expect(result.success).toBe(true);
    });

    it('rejects empty payload', () => {
      const result = BuildingHealthScoreSchema.safeParse({});
      expect(result.success).toBe(false);
    });
  });
});

// ═══════════════════════════════════════════════════════════
// Floor Schemas
// ═══════════════════════════════════════════════════════════

describe('Floor Schemas', () => {
  it('FloorListSchema accepts buildingId', () => {
    const result = FloorListSchema.safeParse({ buildingId: 'bld_1' });
    expect(result.success).toBe(true);
  });

  it('FloorListSchema rejects empty object', () => {
    const result = FloorListSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('FloorGetSchema accepts floorId', () => {
    const result = FloorGetSchema.safeParse({ floorId: 'floor_1' });
    expect(result.success).toBe(true);
  });

  it('FloorGetSchema rejects missing floorId', () => {
    const result = FloorGetSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════
// Room Schemas
// ═══════════════════════════════════════════════════════════

describe('Room Schemas', () => {
  describe('RoomCreateSchema', () => {
    it('accepts required type and floorId', () => {
      const result = RoomCreateSchema.safeParse({ type: 'code-lab', floorId: 'floor_1' });
      expect(result.success).toBe(true);
    });

    it('accepts optional name', () => {
      const result = RoomCreateSchema.safeParse({ type: 'code-lab', floorId: 'floor_1', name: 'My Room' });
      expect(result.success).toBe(true);
    });

    it('rejects missing type', () => {
      const result = RoomCreateSchema.safeParse({ floorId: 'floor_1' });
      expect(result.success).toBe(false);
    });

    it('allows passthrough', () => {
      const result = RoomCreateSchema.safeParse({ type: 'code-lab', floorId: 'floor_1', extra: true });
      expect(result.success).toBe(true);
    });
  });

  describe('RoomEnterSchema', () => {
    it('accepts roomId and agentId', () => {
      const result = RoomEnterSchema.safeParse({ roomId: 'room_1', agentId: 'agent_1' });
      expect(result.success).toBe(true);
    });

    it('rejects missing agentId', () => {
      const result = RoomEnterSchema.safeParse({ roomId: 'room_1' });
      expect(result.success).toBe(false);
    });
  });

  describe('RoomExitSchema', () => {
    it('accepts roomId and agentId', () => {
      const result = RoomExitSchema.safeParse({ roomId: 'room_1', agentId: 'agent_1' });
      expect(result.success).toBe(true);
    });

    it('rejects missing roomId', () => {
      const result = RoomExitSchema.safeParse({ agentId: 'agent_1' });
      expect(result.success).toBe(false);
    });
  });

  it('RoomGetSchema accepts roomId', () => {
    const result = RoomGetSchema.safeParse({ roomId: 'room_1' });
    expect(result.success).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════
// Agent Schemas
// ═══════════════════════════════════════════════════════════

describe('Agent Schemas', () => {
  describe('AgentRegisterSchema', () => {
    it('accepts required name', () => {
      const result = AgentRegisterSchema.safeParse({ name: 'Claude' });
      expect(result.success).toBe(true);
    });

    it('accepts optional role', () => {
      const result = AgentRegisterSchema.safeParse({ name: 'Claude', role: 'architect' });
      expect(result.success).toBe(true);
    });

    it('rejects missing name', () => {
      const result = AgentRegisterSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it('allows passthrough of extra fields', () => {
      const result = AgentRegisterSchema.safeParse({ name: 'Claude', model: 'opus' });
      expect(result.success).toBe(true);
    });
  });

  it('AgentGetSchema accepts agentId', () => {
    const result = AgentGetSchema.safeParse({ agentId: 'agent_1' });
    expect(result.success).toBe(true);
  });

  it('AgentListSchema accepts empty/undefined', () => {
    expect(AgentListSchema.safeParse(undefined).success).toBe(true);
    expect(AgentListSchema.safeParse({}).success).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════
// Chat Schema
// ═══════════════════════════════════════════════════════════

describe('ChatMessageSchema', () => {
  it('accepts empty object with defaults', () => {
    const result = ChatMessageSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.text).toBe('');
      expect(result.data.tokens).toEqual([]);
    }
  });

  it('accepts full message with tokens', () => {
    const result = ChatMessageSchema.safeParse({
      text: 'Hello @agent',
      tokens: [{ id: 'agent_1', type: 'mention', char: '@', value: 'agent' }],
      buildingId: 'bld_1',
      roomId: 'room_1',
      agentId: 'agent_1',
    });
    expect(result.success).toBe(true);
  });

  it('rejects text exceeding MAX_TEXT (50000 chars)', () => {
    const result = ChatMessageSchema.safeParse({ text: 'x'.repeat(50_001) });
    expect(result.success).toBe(false);
  });

  it('rejects tokens array exceeding MAX_ARRAY_ITEMS (500)', () => {
    const tokens = Array.from({ length: 501 }, (_, i) => ({ id: `t_${i}` }));
    const result = ChatMessageSchema.safeParse({ tokens });
    expect(result.success).toBe(false);
  });

  it('allows passthrough of extra fields', () => {
    const result = ChatMessageSchema.safeParse({ text: 'hi', extra: true });
    expect(result.success).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════
// EmptyPayloadSchema (strict mode)
// ═══════════════════════════════════════════════════════════

describe('EmptyPayloadSchema', () => {
  it('accepts empty object', () => {
    const result = EmptyPayloadSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('accepts undefined (defaults to {})', () => {
    const result = EmptyPayloadSchema.safeParse(undefined);
    expect(result.success).toBe(true);
  });

  it('rejects unexpected fields (strict mode)', () => {
    const result = EmptyPayloadSchema.safeParse({ unexpected: true });
    expect(result.success).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════
// Phase Schemas
// ═══════════════════════════════════════════════════════════

describe('Phase Schemas', () => {
  describe('PhaseStatusSchema', () => {
    it('accepts optional buildingId', () => {
      const result = PhaseStatusSchema.safeParse({ buildingId: 'bld_1' });
      expect(result.success).toBe(true);
    });

    it('accepts empty object', () => {
      const result = PhaseStatusSchema.safeParse({});
      expect(result.success).toBe(true);
    });
  });

  describe('PhaseGateSchema', () => {
    it('accepts buildingId and phase', () => {
      const result = PhaseGateSchema.safeParse({ buildingId: 'bld_1', phase: 'strategy' });
      expect(result.success).toBe(true);
    });

    it('accepts empty object', () => {
      const result = PhaseGateSchema.safeParse({});
      expect(result.success).toBe(true);
    });
  });

  describe('PhaseGateCreateSchema', () => {
    it('accepts buildingId and phase with optional criteria', () => {
      const result = PhaseGateCreateSchema.safeParse({
        buildingId: 'bld_1',
        phase: 'strategy',
        criteria: ['Exit doc ready', 'Tests passing', 'RAID log complete'],
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.criteria).toEqual(['Exit doc ready', 'Tests passing', 'RAID log complete']);
      }
    });

    it('defaults criteria to empty array when not provided', () => {
      const result = PhaseGateCreateSchema.safeParse({
        buildingId: 'bld_1',
        phase: 'strategy',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.criteria).toEqual([]);
      }
    });
  });

  describe('PhaseGateSignoffSchema', () => {
    it('accepts valid GO signoff', () => {
      const result = PhaseGateSignoffSchema.safeParse({
        gateId: 'gate_1',
        reviewer: 'admin',
        verdict: 'GO',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.conditions).toEqual([]);
        expect(result.data.nextPhaseInput).toEqual({});
      }
    });

    it('accepts CONDITIONAL with conditions', () => {
      const result = PhaseGateSignoffSchema.safeParse({
        gateId: 'gate_1',
        reviewer: 'admin',
        verdict: 'CONDITIONAL',
        conditions: ['fix tests', 'update docs'],
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.conditions).toEqual(['fix tests', 'update docs']);
      }
    });

    it('accepts NO-GO verdict', () => {
      const result = PhaseGateSignoffSchema.safeParse({
        gateId: 'gate_1',
        reviewer: 'admin',
        verdict: 'NO-GO',
      });
      expect(result.success).toBe(true);
    });

    it('rejects invalid verdict', () => {
      const result = PhaseGateSignoffSchema.safeParse({
        gateId: 'gate_1',
        reviewer: 'admin',
        verdict: 'MAYBE',
      });
      expect(result.success).toBe(false);
    });

    it('rejects missing required fields', () => {
      const result = PhaseGateSignoffSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it('accepts criteria array with met status and evidence URLs', () => {
      const result = PhaseGateSignoffSchema.safeParse({
        gateId: 'gate_1',
        reviewer: 'admin',
        verdict: 'GO',
        criteria: [
          { label: 'Exit doc reviewed', met: true, evidenceUrl: 'https://example.com/doc' },
          { label: 'Tests passing', met: true },
          { label: 'RAID complete', met: false },
        ],
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.criteria).toHaveLength(3);
        expect(result.data.criteria![0].evidenceUrl).toBe('https://example.com/doc');
        expect(result.data.criteria![2].met).toBe(false);
      }
    });

    it('accepts signoff without criteria (optional field)', () => {
      const result = PhaseGateSignoffSchema.safeParse({
        gateId: 'gate_1',
        reviewer: 'admin',
        verdict: 'GO',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.criteria).toBeUndefined();
      }
    });
  });

  describe('PhaseAdvanceSchema', () => {
    it('accepts required buildingId', () => {
      const result = PhaseAdvanceSchema.safeParse({ buildingId: 'bld_1' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.nextPhaseInput).toEqual({});
      }
    });

    it('rejects missing buildingId', () => {
      const result = PhaseAdvanceSchema.safeParse({});
      expect(result.success).toBe(false);
    });
  });

  describe('PhaseResolveConditionsSchema', () => {
    it('accepts gateId with defaults', () => {
      const result = PhaseResolveConditionsSchema.safeParse({ gateId: 'gate_1' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.resolvedConditions).toEqual([]);
        expect(result.data.resolver).toBe('system');
      }
    });

    it('accepts explicit resolvedConditions and resolver', () => {
      const result = PhaseResolveConditionsSchema.safeParse({
        gateId: 'gate_1',
        resolvedConditions: ['fix tests'],
        resolver: 'admin',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.resolvedConditions).toEqual(['fix tests']);
        expect(result.data.resolver).toBe('admin');
      }
    });
  });

  describe('PhaseStaleGatesSchema', () => {
    it('accepts optional thresholdMs', () => {
      const result = PhaseStaleGatesSchema.safeParse({ thresholdMs: 60000 });
      expect(result.success).toBe(true);
    });

    it('accepts undefined (defaults to {})', () => {
      const result = PhaseStaleGatesSchema.safeParse(undefined);
      expect(result.success).toBe(true);
    });

    it('rejects non-positive thresholdMs', () => {
      const result = PhaseStaleGatesSchema.safeParse({ thresholdMs: 0 });
      expect(result.success).toBe(false);
    });

    it('rejects negative thresholdMs', () => {
      const result = PhaseStaleGatesSchema.safeParse({ thresholdMs: -1000 });
      expect(result.success).toBe(false);
    });
  });

  it('PhaseGatesSchema requires buildingId', () => {
    expect(PhaseGatesSchema.safeParse({}).success).toBe(false);
    expect(PhaseGatesSchema.safeParse({ buildingId: 'bld_1' }).success).toBe(true);
  });

  it('PhaseCanAdvanceSchema requires buildingId', () => {
    expect(PhaseCanAdvanceSchema.safeParse({}).success).toBe(false);
    expect(PhaseCanAdvanceSchema.safeParse({ buildingId: 'bld_1' }).success).toBe(true);
  });

  it('PhasePendingGatesSchema accepts optional buildingId', () => {
    expect(PhasePendingGatesSchema.safeParse(undefined).success).toBe(true);
    expect(PhasePendingGatesSchema.safeParse({ buildingId: 'bld_1' }).success).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════
// RAID Schemas
// ═══════════════════════════════════════════════════════════

describe('RAID Schemas', () => {
  describe('RaidAddSchema', () => {
    it('accepts valid input', () => {
      const result = RaidAddSchema.safeParse({
        buildingId: 'bld_1',
        type: 'risk',
        phase: 'discovery',
        summary: 'API rate limits may cause failures',
      });
      expect(result.success).toBe(true);
    });

    it('rejects missing required fields', () => {
      const result = RaidAddSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it('rejects empty summary', () => {
      const result = RaidAddSchema.safeParse({
        buildingId: 'bld_1',
        type: 'risk',
        phase: 'discovery',
        summary: '',
      });
      expect(result.success).toBe(false);
    });

    it('rejects summary exceeding MAX_DESCRIPTION (10000 chars)', () => {
      const result = RaidAddSchema.safeParse({
        buildingId: 'bld_1',
        type: 'risk',
        phase: 'discovery',
        summary: 'x'.repeat(10_001),
      });
      expect(result.success).toBe(false);
    });

    it('allows passthrough of extra fields', () => {
      const result = RaidAddSchema.safeParse({
        buildingId: 'bld_1',
        type: 'risk',
        phase: 'discovery',
        summary: 'Test',
        priority: 'high',
      });
      expect(result.success).toBe(true);
    });
  });

  describe('RaidUpdateSchema', () => {
    it('accepts id and status', () => {
      const result = RaidUpdateSchema.safeParse({ id: 'raid_1', status: 'closed' });
      expect(result.success).toBe(true);
    });

    it('rejects missing id', () => {
      const result = RaidUpdateSchema.safeParse({ status: 'resolved' });
      expect(result.success).toBe(false);
    });
  });

  describe('RaidEditSchema', () => {
    it('accepts id with optional fields', () => {
      const result = RaidEditSchema.safeParse({
        id: 'raid_1',
        summary: 'Updated summary',
        rationale: 'Because reasons',
        decidedBy: 'admin',
        affectedAreas: ['auth', 'billing'],
      });
      expect(result.success).toBe(true);
    });

    it('requires only id', () => {
      const result = RaidEditSchema.safeParse({ id: 'raid_1' });
      expect(result.success).toBe(true);
    });

    it('rejects affectedAreas exceeding MAX_ARRAY_ITEMS', () => {
      const result = RaidEditSchema.safeParse({
        id: 'raid_1',
        affectedAreas: Array.from({ length: 501 }, (_, i) => `area_${i}`),
      });
      expect(result.success).toBe(false);
    });
  });

  it('RaidSearchSchema accepts buildingId with optional filters', () => {
    expect(RaidSearchSchema.safeParse({}).success).toBe(false);
    expect(RaidSearchSchema.safeParse({ buildingId: 'bld_1' }).success).toBe(true);
    expect(RaidSearchSchema.safeParse({ buildingId: 'bld_1', type: 'risk', status: 'open' }).success).toBe(true);
  });

  it('RaidListSchema requires buildingId', () => {
    expect(RaidListSchema.safeParse({}).success).toBe(false);
    expect(RaidListSchema.safeParse({ buildingId: 'bld_1' }).success).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════
// Task Schemas
// ═══════════════════════════════════════════════════════════

describe('Task Schemas', () => {
  describe('TaskCreateSchema', () => {
    it('accepts required fields with defaults', () => {
      const result = TaskCreateSchema.safeParse({
        buildingId: 'bld_1',
        title: 'Implement auth',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.status).toBe('pending');
        expect(result.data.priority).toBe('normal');
      }
    });

    it('accepts all optional fields', () => {
      const result = TaskCreateSchema.safeParse({
        buildingId: 'bld_1',
        title: 'Implement auth',
        description: 'Add OAuth2 support',
        status: 'in-progress',
        parentId: 'task_0',
        milestoneId: 'ms_1',
        assigneeId: 'agent_1',
        roomId: 'room_1',
        phase: 'execution',
        priority: 'high',
      });
      expect(result.success).toBe(true);
    });

    it('rejects missing buildingId', () => {
      const result = TaskCreateSchema.safeParse({ title: 'Test' });
      expect(result.success).toBe(false);
    });

    it('rejects missing title', () => {
      const result = TaskCreateSchema.safeParse({ buildingId: 'bld_1' });
      expect(result.success).toBe(false);
    });
  });

  describe('TaskUpdateSchema', () => {
    it('requires only id', () => {
      const result = TaskUpdateSchema.safeParse({ id: 'task_1' });
      expect(result.success).toBe(true);
    });

    it('accepts partial updates', () => {
      const result = TaskUpdateSchema.safeParse({ id: 'task_1', status: 'done', priority: 'low' });
      expect(result.success).toBe(true);
    });

    it('rejects missing id', () => {
      const result = TaskUpdateSchema.safeParse({ status: 'done' });
      expect(result.success).toBe(false);
    });
  });

  describe('TaskListSchema', () => {
    it('requires buildingId', () => {
      expect(TaskListSchema.safeParse({}).success).toBe(false);
      expect(TaskListSchema.safeParse({ buildingId: 'bld_1' }).success).toBe(true);
    });

    it('accepts optional filters', () => {
      const result = TaskListSchema.safeParse({
        buildingId: 'bld_1',
        status: 'pending',
        phase: 'execution',
        assigneeId: 'agent_1',
      });
      expect(result.success).toBe(true);
    });
  });

  it('TaskGetSchema requires id', () => {
    expect(TaskGetSchema.safeParse({}).success).toBe(false);
    expect(TaskGetSchema.safeParse({ id: 'task_1' }).success).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════
// TODO Schemas
// ═══════════════════════════════════════════════════════════

describe('TODO Schemas', () => {
  describe('TodoCreateSchema', () => {
    it('accepts required fields', () => {
      const result = TodoCreateSchema.safeParse({
        taskId: 'task_1',
        description: 'Write unit tests',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.status).toBe('pending');
      }
    });

    it('rejects empty description', () => {
      const result = TodoCreateSchema.safeParse({
        taskId: 'task_1',
        description: '',
      });
      expect(result.success).toBe(false);
    });

    it('accepts optional fields', () => {
      const result = TodoCreateSchema.safeParse({
        taskId: 'task_1',
        description: 'Write tests',
        agentId: 'agent_1',
        roomId: 'room_1',
        status: 'in-progress',
        exitDocRef: 'doc_1',
      });
      expect(result.success).toBe(true);
    });
  });

  it('TodoToggleSchema requires id', () => {
    expect(TodoToggleSchema.safeParse({}).success).toBe(false);
    expect(TodoToggleSchema.safeParse({ id: 'todo_1' }).success).toBe(true);
  });

  it('TodoListSchema requires taskId', () => {
    expect(TodoListSchema.safeParse({}).success).toBe(false);
    expect(TodoListSchema.safeParse({ taskId: 'task_1' }).success).toBe(true);
  });

  it('TodoDeleteSchema requires id', () => {
    expect(TodoDeleteSchema.safeParse({}).success).toBe(false);
    expect(TodoDeleteSchema.safeParse({ id: 'todo_1' }).success).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════
// Exit Document Schemas
// ═══════════════════════════════════════════════════════════

describe('Exit Document Schemas', () => {
  describe('ExitDocSubmitSchema', () => {
    it('accepts required roomId and agentId', () => {
      const result = ExitDocSubmitSchema.safeParse({
        roomId: 'room_1',
        agentId: 'agent_1',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.document).toEqual({});
      }
    });

    it('accepts full submission with document', () => {
      const result = ExitDocSubmitSchema.safeParse({
        roomId: 'room_1',
        agentId: 'agent_1',
        document: { summary: 'All tests pass' },
        buildingId: 'bld_1',
        phase: 'review',
        roomType: 'testing-lab',
      });
      expect(result.success).toBe(true);
    });

    it('rejects missing roomId', () => {
      const result = ExitDocSubmitSchema.safeParse({ agentId: 'agent_1' });
      expect(result.success).toBe(false);
    });
  });

  it('ExitDocGetSchema requires roomId', () => {
    expect(ExitDocGetSchema.safeParse({}).success).toBe(false);
    expect(ExitDocGetSchema.safeParse({ roomId: 'room_1' }).success).toBe(true);
  });

  it('ExitDocListSchema requires buildingId', () => {
    expect(ExitDocListSchema.safeParse({}).success).toBe(false);
    expect(ExitDocListSchema.safeParse({ buildingId: 'bld_1' }).success).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════
// Field Length Limits (edge cases)
// ═══════════════════════════════════════════════════════════

describe('Field Length Limits', () => {
  it('MAX_ID (100): accepts 100-char ID', () => {
    const result = BuildingGetSchema.safeParse({ buildingId: 'x'.repeat(100) });
    expect(result.success).toBe(true);
  });

  it('MAX_ID (100): rejects 101-char ID', () => {
    const result = BuildingGetSchema.safeParse({ buildingId: 'x'.repeat(101) });
    expect(result.success).toBe(false);
  });

  it('MAX_NAME (500): accepts 500-char name', () => {
    const result = BuildingCreateSchema.safeParse({ name: 'x'.repeat(500) });
    expect(result.success).toBe(true);
  });

  it('MAX_NAME (500): rejects 501-char name', () => {
    const result = BuildingCreateSchema.safeParse({ name: 'x'.repeat(501) });
    expect(result.success).toBe(false);
  });

  it('MAX_DESCRIPTION (10000): accepts 10000-char description', () => {
    const result = RaidAddSchema.safeParse({
      buildingId: 'bld_1',
      type: 'risk',
      phase: 'discovery',
      summary: 'x'.repeat(10_000),
    });
    expect(result.success).toBe(true);
  });

  it('MAX_DESCRIPTION (10000): rejects 10001-char description', () => {
    const result = RaidAddSchema.safeParse({
      buildingId: 'bld_1',
      type: 'risk',
      phase: 'discovery',
      summary: 'x'.repeat(10_001),
    });
    expect(result.success).toBe(false);
  });

  it('MAX_TEXT (50000): accepts 50000-char text', () => {
    const result = ChatMessageSchema.safeParse({ text: 'x'.repeat(50_000) });
    expect(result.success).toBe(true);
  });

  it('MAX_TEXT (50000): rejects 50001-char text', () => {
    const result = ChatMessageSchema.safeParse({ text: 'x'.repeat(50_001) });
    expect(result.success).toBe(false);
  });

  it('MAX_ARRAY_ITEMS (500): accepts 500-item array', () => {
    const result = PhaseResolveConditionsSchema.safeParse({
      gateId: 'gate_1',
      resolvedConditions: Array.from({ length: 500 }, (_, i) => `cond_${i}`),
    });
    expect(result.success).toBe(true);
  });

  it('MAX_ARRAY_ITEMS (500): rejects 501-item array', () => {
    const result = PhaseResolveConditionsSchema.safeParse({
      gateId: 'gate_1',
      resolvedConditions: Array.from({ length: 501 }, (_, i) => `cond_${i}`),
    });
    expect(result.success).toBe(false);
  });
});

// ─── Global Search Schema ───

describe('SearchGlobalSchema', () => {
  it('accepts valid search payload', () => {
    const result = SearchGlobalSchema.safeParse({
      buildingId: 'b1',
      query: 'API endpoints',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.filters).toEqual([]);
      expect(result.data.limit).toBe(10);
    }
  });

  it('accepts payload with filters and limit', () => {
    const result = SearchGlobalSchema.safeParse({
      buildingId: 'b1',
      query: 'test',
      filters: ['task', 'agent'],
      limit: 20,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.filters).toEqual(['task', 'agent']);
      expect(result.data.limit).toBe(20);
    }
  });

  it('rejects empty query', () => {
    const result = SearchGlobalSchema.safeParse({
      buildingId: 'b1',
      query: '',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing buildingId', () => {
    const result = SearchGlobalSchema.safeParse({
      query: 'test',
    });
    expect(result.success).toBe(false);
  });

  it('rejects limit over 50', () => {
    const result = SearchGlobalSchema.safeParse({
      buildingId: 'b1',
      query: 'test',
      limit: 100,
    });
    expect(result.success).toBe(false);
  });
});


// Quality Config Schemas

describe('QualityConfigGetSchema', () => {
  it('accepts empty object', () => {
    const result = QualityConfigGetSchema.safeParse({});
    expect(result.success).toBe(true);
  });
});

describe('QualityConfigSetSchema', () => {
  it('accepts valid boolean config update', () => {
    const result = QualityConfigSetSchema.safeParse({ key: 'autoLint', value: false });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.key).toBe('autoLint');
      expect(result.data.value).toBe(false);
    }
  });

  it('accepts valid numeric config update', () => {
    const result = QualityConfigSetSchema.safeParse({ key: 'minCoverage', value: 80 });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.value).toBe(80);
    }
  });

  it('rejects invalid key', () => {
    const result = QualityConfigSetSchema.safeParse({ key: 'invalidKey', value: true });
    expect(result.success).toBe(false);
  });

  it('rejects missing value', () => {
    const result = QualityConfigSetSchema.safeParse({ key: 'autoLint' });
    expect(result.success).toBe(false);
  });

  it('rejects string value', () => {
    const result = QualityConfigSetSchema.safeParse({ key: 'autoLint', value: 'yes' });
    expect(result.success).toBe(false);
  });

  it('accepts all valid keys', () => {
    const validKeys = ['autoLint', 'autoTypecheck', 'autoTest', 'autoSecurityScan', 'minCoverage'];
    for (const key of validKeys) {
      const value = key === 'minCoverage' ? 50 : true;
      const result = QualityConfigSetSchema.safeParse({ key, value });
      expect(result.success).toBe(true);
    }
  });
});
