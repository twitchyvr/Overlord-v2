import { describe, it, expect } from 'vitest';
import { ok, err, safeJsonParse, RoomContractSchema, AgentIdentitySchema, RaidEntrySchema } from '../../../src/core/contracts.js';

describe('Result helpers', () => {
  it('ok() creates a success result', () => {
    const result = ok({ id: '123' });
    expect(result.ok).toBe(true);
    expect(result.data).toEqual({ id: '123' });
    expect(result.error).toBeUndefined();
  });

  it('err() creates an error result', () => {
    const result = err('NOT_FOUND', 'Room not found');
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('NOT_FOUND');
    expect(result.error?.message).toBe('Room not found');
    expect(result.error?.retryable).toBe(false);
  });

  it('err() supports retryable flag', () => {
    const result = err('TIMEOUT', 'Request timed out', { retryable: true });
    expect(result.error?.retryable).toBe(true);
  });
});

describe('Schema validation', () => {
  it('validates a room contract', () => {
    const contract = {
      roomType: 'testing-lab',
      floor: 'execution',
      tables: { focus: { chairs: 1, description: 'Solo' } },
      tools: ['read_file', 'qa_run_tests'],
      exitRequired: { type: 'test-report', fields: ['testsRun', 'testsPassed'] },
    };

    const result = RoomContractSchema.safeParse(contract);
    expect(result.success).toBe(true);
  });

  it('validates an agent identity', () => {
    const agent = {
      id: 'agent_001',
      name: 'testing-engineer',
      role: 'QA Lead',
      capabilities: ['testing', 'qa'],
      roomAccess: ['testing-lab', 'review'],
    };

    const result = AgentIdentitySchema.safeParse(agent);
    expect(result.success).toBe(true);
  });

  it('validates a RAID entry', () => {
    const entry = {
      id: 'raid_001',
      type: 'decision',
      phase: 'architecture',
      roomId: 'arch-room-1',
      summary: 'Use SQLite for MVP',
      decidedBy: 'architect-agent',
      timestamp: '2026-03-10T20:00:00.000Z',
    };

    const result = RaidEntrySchema.safeParse(entry);
    expect(result.success).toBe(true);
  });

  it('rejects invalid RAID entry type', () => {
    const entry = {
      id: 'raid_002',
      type: 'invalid',
      phase: 'architecture',
      roomId: 'room-1',
      summary: 'Test',
      decidedBy: 'agent',
      timestamp: '2026-03-10T20:00:00.000Z',
    };

    const result = RaidEntrySchema.safeParse(entry);
    expect(result.success).toBe(false);
  });
});

describe('safeJsonParse()', () => {
  it('parses valid JSON', () => {
    expect(safeJsonParse('{"a":1}', {})).toEqual({ a: 1 });
  });

  it('parses valid JSON array', () => {
    expect(safeJsonParse('["a","b"]', [])).toEqual(['a', 'b']);
  });

  it('returns fallback for malformed JSON', () => {
    expect(safeJsonParse('{bad json', {})).toEqual({});
  });

  it('returns fallback for null', () => {
    expect(safeJsonParse(null, [])).toEqual([]);
  });

  it('returns fallback for undefined', () => {
    expect(safeJsonParse(undefined, {})).toEqual({});
  });

  it('returns fallback for empty string', () => {
    expect(safeJsonParse('', { default: true })).toEqual({ default: true });
  });

  it('preserves type safety with generic', () => {
    const result = safeJsonParse<string[]>('["x","y"]', []);
    expect(result).toEqual(['x', 'y']);
    expect(Array.isArray(result)).toBe(true);
  });
});
