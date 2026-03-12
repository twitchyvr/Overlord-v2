/**
 * Reference Resolver Tests
 *
 * Tests initReferenceResolver and resolveReference with mocked room manager
 * and RAID search. Covers RAID references, room references, error handling.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

let initReferenceResolver: typeof import('../../../src/commands/reference-resolver.js').initReferenceResolver;
let resolveReference: typeof import('../../../src/commands/reference-resolver.js').resolveReference;

// Suppress logger output
vi.mock('../../../src/core/logger.js', () => ({
  logger: {
    child: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  },
}));

// Mock the RAID search function
const mockSearchRaid = vi.fn();
vi.mock('../../../src/rooms/raid-log.js', () => ({
  searchRaid: (...args: unknown[]) => mockSearchRaid(...args),
}));

/** Helper: create a ParsedToken for #reference */
function makeToken(overrides: Partial<{ id: string; label: string }> = {}) {
  return {
    type: 'reference' as const,
    char: '#',
    id: overrides.id ?? 'design-room',
    label: overrides.label ?? 'Design Room',
  };
}

/** Helper: create a minimal CommandContext */
function makeCtx(overrides: Partial<{
  buildingId: string;
  roomId: string;
  socketId: string;
  bus: { emit: ReturnType<typeof vi.fn> };
}> = {}) {
  return {
    command: '',
    args: [],
    rawText: '#design-room',
    socketId: overrides.socketId ?? 'sock-1',
    buildingId: overrides.buildingId,
    roomId: overrides.roomId,
    tokens: [],
    bus: overrides.bus ?? { emit: vi.fn() },
  };
}

/** Helper: create a mock RoomRow */
function makeRoom(overrides: Partial<{
  id: string; name: string; type: string; status: string; floor_id: string;
}> = {}) {
  return {
    id: overrides.id ?? 'room-1',
    floor_id: overrides.floor_id ?? 'floor-1',
    type: overrides.type ?? 'design',
    name: overrides.name ?? 'Design Room',
    allowed_tools: '[]',
    file_scope: 'assigned',
    exit_template: '{}',
    escalation: '{}',
    provider: 'configurable',
    config: '{}',
    status: overrides.status ?? 'active',
    created_at: '2025-01-01T00:00:00Z',
  };
}

/** Helper: create a mock RoomManagerAPI */
function makeRoomAPI(rooms: ReturnType<typeof makeRoom>[] = []) {
  return {
    createRoom: vi.fn(),
    enterRoom: vi.fn(),
    exitRoom: vi.fn(),
    getRoom: vi.fn(),
    listRooms: vi.fn(() => rooms),
    registerRoomType: vi.fn(),
  };
}

describe('Reference Resolver', () => {
  beforeEach(async () => {
    vi.resetModules();
    mockSearchRaid.mockReset();
    const mod = await import('../../../src/commands/reference-resolver.js');
    initReferenceResolver = mod.initReferenceResolver;
    resolveReference = mod.resolveReference;
  });

  // ─── Room References ───

  describe('room references', () => {
    it('resolves room by exact name (case-insensitive)', async () => {
      const rooms = [makeRoom({ id: 'room-1', name: 'Design Room', type: 'design' })];
      initReferenceResolver(makeRoomAPI(rooms) as never);

      const result = await resolveReference(
        makeToken({ id: 'design-room', label: 'Design Room' }),
        makeCtx() as never,
      );

      expect(result.resolved).toBe(true);
      expect(result.content).toMatchObject({ id: 'room-1', name: 'Design Room' });
    });

    it('resolves room by type (case-insensitive)', async () => {
      const rooms = [makeRoom({ id: 'room-2', name: 'My Design Space', type: 'design' })];
      initReferenceResolver(makeRoomAPI(rooms) as never);

      const result = await resolveReference(
        makeToken({ id: 'design' }),
        makeCtx() as never,
      );

      expect(result.resolved).toBe(true);
      expect(result.content).toMatchObject({ id: 'room-2', type: 'design' });
    });

    it('resolves room by hyphenated name (spaces → hyphens)', async () => {
      const rooms = [makeRoom({ id: 'room-3', name: 'Code Review', type: 'review' })];
      initReferenceResolver(makeRoomAPI(rooms) as never);

      const result = await resolveReference(
        makeToken({ id: 'code-review' }),
        makeCtx() as never,
      );

      expect(result.resolved).toBe(true);
      expect(result.content).toMatchObject({ id: 'room-3', name: 'Code Review' });
    });

    it('returns not-found for unknown room', async () => {
      initReferenceResolver(makeRoomAPI([]) as never);

      const result = await resolveReference(
        makeToken({ id: 'nonexistent' }),
        makeCtx() as never,
      );

      expect(result.resolved).toBe(false);
      expect(result.content).toMatchObject({ error: expect.stringContaining('not found') });
    });

    it('returns error when resolver not initialized', async () => {
      // Don't call initReferenceResolver — roomAPI is null
      const result = await resolveReference(
        makeToken({ id: 'some-room' }),
        makeCtx() as never,
      );

      expect(result.resolved).toBe(false);
      expect(result.content).toMatchObject({ error: expect.stringContaining('not available') });
    });

    it('includes room status in resolved content', async () => {
      const rooms = [makeRoom({ id: 'room-4', name: 'Test Room', type: 'testing', status: 'occupied' })];
      initReferenceResolver(makeRoomAPI(rooms) as never);

      const result = await resolveReference(
        makeToken({ id: 'test room' }),
        makeCtx() as never,
      );

      expect(result.resolved).toBe(true);
      expect(result.content).toMatchObject({ status: 'occupied' });
    });
  });

  // ─── RAID References ───

  describe('RAID references', () => {
    it('resolves RAID entry with raid_ prefix', async () => {
      initReferenceResolver(makeRoomAPI([]) as never);
      mockSearchRaid.mockReturnValue({
        ok: true,
        data: [
          { id: 'raid_001', type: 'risk', summary: 'High latency', phase: 'design', status: 'active', rationale: null },
        ],
      });

      const result = await resolveReference(
        makeToken({ id: 'raid_001' }),
        makeCtx({ buildingId: 'bld-1' }) as never,
      );

      expect(result.resolved).toBe(true);
      expect(result.content).toMatchObject({
        id: 'raid_001',
        type: 'risk',
        summary: 'High latency',
      });
    });

    it('normalizes raid- prefix to raid_', async () => {
      initReferenceResolver(makeRoomAPI([]) as never);
      mockSearchRaid.mockReturnValue({
        ok: true,
        data: [
          { id: 'raid_002', type: 'decision', summary: 'Use Postgres', phase: 'design', status: 'active', rationale: 'Better fit' },
        ],
      });

      const result = await resolveReference(
        makeToken({ id: 'raid-002' }),
        makeCtx({ buildingId: 'bld-1' }) as never,
      );

      expect(result.resolved).toBe(true);
      expect(result.content).toMatchObject({ id: 'raid_002' });
    });

    it('strips leading # from token ID', async () => {
      initReferenceResolver(makeRoomAPI([]) as never);
      mockSearchRaid.mockReturnValue({
        ok: true,
        data: [
          { id: 'raid_003', type: 'assumption', summary: 'Users have SSO', phase: 'design', status: 'active', rationale: null },
        ],
      });

      const result = await resolveReference(
        makeToken({ id: '#raid_003' }),
        makeCtx({ buildingId: 'bld-1' }) as never,
      );

      expect(result.resolved).toBe(true);
      expect(result.content).toMatchObject({ id: 'raid_003' });
    });

    it('returns error when buildingId missing for RAID lookup', async () => {
      initReferenceResolver(makeRoomAPI([]) as never);

      const result = await resolveReference(
        makeToken({ id: 'raid_999' }),
        makeCtx() as never, // no buildingId
      );

      expect(result.resolved).toBe(false);
      expect(result.content).toMatchObject({ error: expect.stringContaining('building context') });
    });

    it('returns not-found when RAID entry ID does not match', async () => {
      initReferenceResolver(makeRoomAPI([]) as never);
      mockSearchRaid.mockReturnValue({
        ok: true,
        data: [
          { id: 'raid_100', type: 'issue', summary: 'Other', phase: 'dev', status: 'active', rationale: null },
        ],
      });

      const result = await resolveReference(
        makeToken({ id: 'raid_999' }),
        makeCtx({ buildingId: 'bld-1' }) as never,
      );

      expect(result.resolved).toBe(false);
      expect(result.content).toMatchObject({ error: expect.stringContaining('not found') });
    });

    it('returns error when searchRaid fails', async () => {
      initReferenceResolver(makeRoomAPI([]) as never);
      mockSearchRaid.mockReturnValue({ ok: false });

      const result = await resolveReference(
        makeToken({ id: 'raid_001' }),
        makeCtx({ buildingId: 'bld-1' }) as never,
      );

      expect(result.resolved).toBe(false);
      expect(result.content).toMatchObject({ error: expect.stringContaining('failed') });
    });

    it('includes all RAID fields in resolved content', async () => {
      initReferenceResolver(makeRoomAPI([]) as never);
      mockSearchRaid.mockReturnValue({
        ok: true,
        data: [{
          id: 'raid_050',
          type: 'decision',
          summary: 'Adopt TypeScript',
          phase: 'foundation',
          status: 'active',
          rationale: 'Type safety improves quality',
        }],
      });

      const result = await resolveReference(
        makeToken({ id: 'raid_050' }),
        makeCtx({ buildingId: 'bld-1' }) as never,
      );

      expect(result.resolved).toBe(true);
      expect(result.content).toMatchObject({
        id: 'raid_050',
        type: 'decision',
        summary: 'Adopt TypeScript',
        phase: 'foundation',
        status: 'active',
        rationale: 'Type safety improves quality',
      });
    });
  });

  // ─── Error handling ───

  describe('error handling', () => {
    it('catches exceptions and returns error result', async () => {
      const api = makeRoomAPI([]);
      api.listRooms.mockImplementation(() => { throw new Error('storage crashed'); });
      initReferenceResolver(api as never);

      const result = await resolveReference(
        makeToken({ id: 'any-room' }),
        makeCtx() as never,
      );

      expect(result.resolved).toBe(false);
      expect(result.content).toMatchObject({ error: expect.stringContaining('storage crashed') });
    });

    it('target field reflects the original token ID', async () => {
      initReferenceResolver(makeRoomAPI([]) as never);

      const result = await resolveReference(
        makeToken({ id: 'my-ref' }),
        makeCtx() as never,
      );

      expect(result.target).toBe('my-ref');
    });
  });
});
