/**
 * Reference Resolver — #reference Processing
 *
 * Resolves #references from chat tokens. Supports two formats:
 *   #room-name   — look up a room by name/type
 *   #raid-123    — look up a specific RAID entry by ID
 */

import { logger } from '../core/logger.js';
import { searchRaid } from '../rooms/raid-log.js';
import type { ParsedToken, CommandContext, ReferenceResult } from './contracts.js';
import type { RoomManagerAPI, RoomRow } from '../core/contracts.js';

const log = logger.child({ module: 'reference-resolver' });

let roomAPI: RoomManagerAPI | null = null;

/**
 * Initialize the reference resolver with the room manager.
 */
export function initReferenceResolver(rooms: RoomManagerAPI): void {
  roomAPI = rooms;
  log.info('Reference resolver initialized');
}

/**
 * Resolve a single #reference token.
 *
 * Parses the reference to determine if it targets a room or a RAID entry,
 * then looks up the content and returns the resolved result.
 */
export async function resolveReference(token: ParsedToken, ctx: CommandContext): Promise<ReferenceResult> {
  try {
    // Strip leading '#' from the ID if present
    const refId = token.id.startsWith('#') ? token.id.slice(1) : token.id;

    // Check if this is a RAID reference (starts with 'raid' prefix)
    if (refId.startsWith('raid_') || refId.startsWith('raid-')) {
      return resolveRaidReference(refId, ctx);
    }

    // Otherwise treat as a room reference
    return resolveRoomReference(refId, ctx);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error({ error, tokenId: token.id }, 'Failed to resolve reference');
    return {
      target: token.id,
      resolved: false,
      content: { error: message },
    };
  }
}

/**
 * Look up a RAID entry by ID.
 */
function resolveRaidReference(refId: string, ctx: CommandContext): ReferenceResult {
  try {
    // Normalize the ID: accept both 'raid-123' and 'raid_123' formats
    const normalizedId = refId.replace(/^raid-/, 'raid_');

    if (!ctx.buildingId) {
      log.warn({ refId }, 'Cannot resolve RAID reference without buildingId');
      return { target: refId, resolved: false, content: { error: 'No building context for RAID lookup' } };
    }

    // Search RAID entries and find the matching one
    const result = searchRaid({ buildingId: ctx.buildingId });
    if (!result.ok) {
      return { target: refId, resolved: false, content: { error: 'RAID search failed' } };
    }

    const entries = result.data as Array<{
      id: string; type: string; summary: string; phase: string;
      status: string; rationale: string | null;
    }>;

    const entry = entries.find(e => e.id === normalizedId);
    if (!entry) {
      log.warn({ refId: normalizedId, buildingId: ctx.buildingId }, 'RAID entry not found');
      return { target: refId, resolved: false, content: { error: `RAID entry ${refId} not found` } };
    }

    log.info({ raidId: entry.id, type: entry.type }, 'RAID reference resolved');
    return {
      target: refId,
      resolved: true,
      content: {
        id: entry.id,
        type: entry.type,
        summary: entry.summary,
        phase: entry.phase,
        status: entry.status,
        rationale: entry.rationale,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error({ error, refId }, 'Failed to resolve RAID reference');
    return { target: refId, resolved: false, content: { error: message } };
  }
}

/**
 * Look up a room by name or type.
 */
function resolveRoomReference(refId: string, _ctx: CommandContext): ReferenceResult {
  try {
    if (!roomAPI) {
      log.error('Reference resolver not initialized — missing room manager');
      return { target: refId, resolved: false, content: { error: 'Room system not available' } };
    }

    const allRooms = roomAPI.listRooms();
    const searchTerm = refId.toLowerCase();

    // Match by name or type (case-insensitive)
    const room = allRooms.find((r: RoomRow) =>
      r.name.toLowerCase() === searchTerm ||
      r.type.toLowerCase() === searchTerm ||
      r.name.toLowerCase().replace(/\s+/g, '-') === searchTerm
    );

    if (!room) {
      log.warn({ refId, searchTerm }, 'Room reference not found');
      return { target: refId, resolved: false, content: { error: `Room "${refId}" not found` } };
    }

    log.info({ roomId: room.id, roomName: room.name }, 'Room reference resolved');
    return {
      target: refId,
      resolved: true,
      content: {
        id: room.id,
        name: room.name,
        type: room.type,
        status: room.status,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error({ error, refId }, 'Failed to resolve room reference');
    return { target: refId, resolved: false, content: { error: message } };
  }
}
