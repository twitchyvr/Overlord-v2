/**
 * Security Badge System
 *
 * Agent-level access control via structured badges.
 * Badges add granularity on top of room-scoped access:
 *
 *   - rooms:      Which room types the agent can enter
 *   - clearance:  standard / elevated / admin — controls tool access within rooms
 *   - canExport:  Whether the agent can export or print confidential data
 *
 * Backward-compatible: agents without badges fall back to their roomAccess array
 * with "standard" clearance. The badge column in the DB stores JSON.
 *
 * Architecture ref: Section 9 — "Room-scoped tool access replaces the 4-tier
 * approval system. Security badging adds agent-level granularity."
 */

import { logger } from '../core/logger.js';
import { ok, err, safeJsonParse } from '../core/contracts.js';
import type { Result } from '../core/contracts.js';

const log = logger.child({ module: 'security-badge' });

// ─── Types ───

export type ClearanceLevel = 'standard' | 'elevated' | 'admin';

export interface SecurityBadge {
  /** Room types this agent can enter. Use ['*'] for wildcard access. */
  rooms: string[];
  /** Access level — controls which tools are available within rooms */
  clearance: ClearanceLevel;
  /** Whether the agent can export or print confidential data */
  canExport: boolean;
}

// ─── Constants ───

export const CLEARANCE_LEVELS: readonly ClearanceLevel[] = ['standard', 'elevated', 'admin'] as const;

/** Clearance hierarchy — higher index = more access */
const CLEARANCE_RANK: Record<ClearanceLevel, number> = {
  standard: 0,
  elevated: 1,
  admin: 2,
};

/** Default badge for agents without an explicit badge */
export const DEFAULT_BADGE: SecurityBadge = {
  rooms: [],
  clearance: 'standard',
  canExport: false,
};

// ─── Badge Parsing ───

/**
 * Parse a badge from its stored database representation.
 * The badge column stores JSON (structured badge) or null (no badge).
 * Returns null if no badge is set — callers should fall back to roomAccess.
 */
export function parseBadge(raw: string | null | undefined): SecurityBadge | null {
  if (!raw) return null;

  const parsed = safeJsonParse<Record<string, unknown> | null>(raw, null);
  if (!parsed || typeof parsed !== 'object') {
    log.warn({ raw: raw.slice(0, 100) }, 'Invalid badge format — ignoring');
    return null;
  }

  // Validate and normalize
  const rooms = Array.isArray(parsed.rooms)
    ? (parsed.rooms as unknown[]).filter((r): r is string => typeof r === 'string')
    : [];

  const clearance = typeof parsed.clearance === 'string' && CLEARANCE_LEVELS.includes(parsed.clearance as ClearanceLevel)
    ? (parsed.clearance as ClearanceLevel)
    : 'standard';

  const canExport = typeof parsed.canExport === 'boolean' ? parsed.canExport : false;

  return { rooms, clearance, canExport };
}

/**
 * Serialize a badge for database storage.
 */
export function serializeBadge(badge: SecurityBadge): string {
  return JSON.stringify(badge);
}

// ─── Validation ───

/**
 * Validate a badge object structure.
 * Returns ok if valid, err with details if not.
 */
export function validateBadge(badge: unknown): Result<SecurityBadge> {
  if (!badge || typeof badge !== 'object') {
    return err('BADGE_INVALID', 'Badge must be an object');
  }

  const b = badge as Record<string, unknown>;

  // rooms
  if (!Array.isArray(b.rooms)) {
    return err('BADGE_INVALID', '"rooms" must be an array of room type strings');
  }
  for (const room of b.rooms) {
    if (typeof room !== 'string' || room.trim().length === 0) {
      return err('BADGE_INVALID', `Invalid room entry: "${room}". Must be a non-empty string.`);
    }
  }

  // clearance
  if (!b.clearance || typeof b.clearance !== 'string') {
    return err('BADGE_INVALID', '"clearance" is required and must be a string');
  }
  if (!CLEARANCE_LEVELS.includes(b.clearance as ClearanceLevel)) {
    return err('BADGE_INVALID', `Invalid clearance level: "${b.clearance}". Must be one of: ${CLEARANCE_LEVELS.join(', ')}`);
  }

  // canExport
  if (typeof b.canExport !== 'boolean') {
    return err('BADGE_INVALID', '"canExport" must be a boolean');
  }

  return ok({
    rooms: b.rooms as string[],
    clearance: b.clearance as ClearanceLevel,
    canExport: b.canExport,
  });
}

// ─── Access Checks ───

/**
 * Check if an agent's badge grants access to a specific room type.
 *
 * Resolution order:
 * 1. If agent has a structured badge → check badge.rooms (or wildcard '*')
 * 2. If no badge → fall back to roomAccess array (backward compat)
 *
 * Returns ok with access details, or err with denial reason.
 */
export function checkRoomAccess(
  agentId: string,
  roomType: string,
  badge: SecurityBadge | null,
  roomAccess: string[],
): Result<{ granted: boolean; source: 'badge' | 'room_access' | 'wildcard' }> {
  // Badge-based access (takes priority)
  if (badge) {
    if (badge.rooms.includes('*')) {
      return ok({ granted: true, source: 'wildcard' });
    }
    if (badge.rooms.includes(roomType)) {
      return ok({ granted: true, source: 'badge' });
    }
    return err(
      'ACCESS_DENIED',
      `Agent ${agentId} badge does not include room type "${roomType}". Allowed rooms: ${badge.rooms.join(', ') || '(none)'}`,
      { context: { agentId, roomType, badgeRooms: badge.rooms } },
    );
  }

  // Fallback: roomAccess array (backward compatibility)
  // Empty roomAccess = unrestricted (agent can go anywhere) — #690
  if (roomAccess.length === 0 || roomAccess.includes('*') || roomAccess.includes(roomType)) {
    return ok({ granted: true, source: 'room_access' });
  }

  return err(
    'ACCESS_DENIED',
    `Agent ${agentId} does not have access to "${roomType}" rooms. Allowed: ${roomAccess.join(', ')}`,
    { context: { agentId, roomType, roomAccess } },
  );
}

/**
 * Check if an agent's clearance level meets a minimum requirement.
 */
export function checkClearance(
  agentClearance: ClearanceLevel,
  requiredClearance: ClearanceLevel,
): boolean {
  return CLEARANCE_RANK[agentClearance] >= CLEARANCE_RANK[requiredClearance];
}

/**
 * Filter a list of tools based on the agent's clearance level.
 * Tools can have an optional `requiredClearance` in their metadata.
 *
 * - standard: only tools with no clearance requirement or 'standard'
 * - elevated: standard + elevated-only tools
 * - admin: all tools, no restrictions
 */
export function filterToolsByClearance(
  tools: string[],
  clearance: ClearanceLevel,
  toolClearanceMap: Record<string, ClearanceLevel>,
): string[] {
  if (clearance === 'admin') return tools;

  return tools.filter((toolName) => {
    const required = toolClearanceMap[toolName] || 'standard';
    return checkClearance(clearance, required);
  });
}

/**
 * Check if the agent is allowed to export data.
 * Returns true if:
 * - Agent has no badge (backward compat: export allowed by default)
 * - Agent has a badge with canExport: true
 */
export function checkExportPermission(badge: SecurityBadge | null): boolean {
  if (!badge) return true; // No badge = legacy agent, allow export
  return badge.canExport;
}

/**
 * Get the effective clearance level for an agent.
 * If no badge, returns 'standard'.
 */
export function getEffectiveClearance(badge: SecurityBadge | null): ClearanceLevel {
  return badge?.clearance ?? 'standard';
}

/**
 * Create a new badge with the given parameters.
 * Validates and returns a properly structured SecurityBadge.
 */
export function createBadge(
  rooms: string[],
  clearance: ClearanceLevel = 'standard',
  canExport: boolean = false,
): Result<SecurityBadge> {
  const badge: SecurityBadge = { rooms, clearance, canExport };
  const validation = validateBadge(badge);
  if (!validation.ok) return validation;
  return ok(badge);
}
