/**
 * Security Badge System Tests
 *
 * Tests badge parsing, validation, access checks, clearance levels,
 * tool filtering, and export permissions.
 */

import { describe, it, expect } from 'vitest';
import {
  parseBadge,
  serializeBadge,
  validateBadge,
  checkRoomAccess,
  checkClearance,
  filterToolsByClearance,
  checkExportPermission,
  getEffectiveClearance,
  createBadge,
  DEFAULT_BADGE,
  CLEARANCE_LEVELS,
} from '../../../src/agents/security-badge.js';
import type { SecurityBadge, ClearanceLevel } from '../../../src/agents/security-badge.js';

// ─── parseBadge ───

describe('parseBadge', () => {
  it('returns null for null input', () => {
    expect(parseBadge(null)).toBeNull();
  });

  it('returns null for undefined input', () => {
    expect(parseBadge(undefined)).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(parseBadge('')).toBeNull();
  });

  it('returns null for invalid JSON', () => {
    expect(parseBadge('not json')).toBeNull();
  });

  it('returns null for non-object JSON', () => {
    expect(parseBadge('"just a string"')).toBeNull();
  });

  it('parses a valid badge', () => {
    const raw = JSON.stringify({
      rooms: ['testing-lab', 'review'],
      clearance: 'elevated',
      canExport: true,
    });
    const badge = parseBadge(raw);
    expect(badge).toEqual({
      rooms: ['testing-lab', 'review'],
      clearance: 'elevated',
      canExport: true,
    });
  });

  it('defaults clearance to standard if missing', () => {
    const raw = JSON.stringify({ rooms: ['code-lab'], canExport: false });
    const badge = parseBadge(raw);
    expect(badge!.clearance).toBe('standard');
  });

  it('defaults clearance to standard if invalid', () => {
    const raw = JSON.stringify({ rooms: [], clearance: 'supreme', canExport: false });
    const badge = parseBadge(raw);
    expect(badge!.clearance).toBe('standard');
  });

  it('defaults canExport to false if missing', () => {
    const raw = JSON.stringify({ rooms: ['code-lab'], clearance: 'standard' });
    const badge = parseBadge(raw);
    expect(badge!.canExport).toBe(false);
  });

  it('defaults rooms to empty array if missing', () => {
    const raw = JSON.stringify({ clearance: 'admin', canExport: true });
    const badge = parseBadge(raw);
    expect(badge!.rooms).toEqual([]);
  });

  it('filters out non-string room entries', () => {
    const raw = JSON.stringify({ rooms: ['code-lab', 42, null, 'review'], clearance: 'standard', canExport: false });
    const badge = parseBadge(raw);
    expect(badge!.rooms).toEqual(['code-lab', 'review']);
  });
});

// ─── serializeBadge ───

describe('serializeBadge', () => {
  it('serializes a badge to JSON string', () => {
    const badge: SecurityBadge = { rooms: ['testing-lab'], clearance: 'standard', canExport: false };
    const json = serializeBadge(badge);
    expect(JSON.parse(json)).toEqual(badge);
  });

  it('round-trips through parse', () => {
    const original: SecurityBadge = { rooms: ['code-lab', 'review'], clearance: 'elevated', canExport: true };
    const parsed = parseBadge(serializeBadge(original));
    expect(parsed).toEqual(original);
  });
});

// ─── validateBadge ───

describe('validateBadge', () => {
  it('validates a correct badge', () => {
    const result = validateBadge({ rooms: ['code-lab'], clearance: 'standard', canExport: false });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.rooms).toEqual(['code-lab']);
    }
  });

  it('rejects null', () => {
    const result = validateBadge(null);
    expect(result.ok).toBe(false);
  });

  it('rejects non-object', () => {
    const result = validateBadge('string');
    expect(result.ok).toBe(false);
  });

  it('rejects missing rooms array', () => {
    const result = validateBadge({ clearance: 'standard', canExport: false });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('rooms');
  });

  it('rejects non-array rooms', () => {
    const result = validateBadge({ rooms: 'not-array', clearance: 'standard', canExport: false });
    expect(result.ok).toBe(false);
  });

  it('rejects empty string in rooms', () => {
    const result = validateBadge({ rooms: ['code-lab', ''], clearance: 'standard', canExport: false });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('non-empty');
  });

  it('rejects non-string in rooms', () => {
    const result = validateBadge({ rooms: [42], clearance: 'standard', canExport: false });
    expect(result.ok).toBe(false);
  });

  it('rejects missing clearance', () => {
    const result = validateBadge({ rooms: [], canExport: false });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('clearance');
  });

  it('rejects invalid clearance level', () => {
    const result = validateBadge({ rooms: [], clearance: 'supreme', canExport: false });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('supreme');
  });

  it('rejects missing canExport', () => {
    const result = validateBadge({ rooms: [], clearance: 'standard' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('canExport');
  });

  it('rejects non-boolean canExport', () => {
    const result = validateBadge({ rooms: [], clearance: 'standard', canExport: 'yes' });
    expect(result.ok).toBe(false);
  });

  it('accepts all three clearance levels', () => {
    for (const level of CLEARANCE_LEVELS) {
      const result = validateBadge({ rooms: [], clearance: level, canExport: false });
      expect(result.ok).toBe(true);
    }
  });

  it('accepts wildcard rooms', () => {
    const result = validateBadge({ rooms: ['*'], clearance: 'admin', canExport: true });
    expect(result.ok).toBe(true);
  });
});

// ─── checkRoomAccess ───

describe('checkRoomAccess', () => {
  const agentId = 'agent_test';

  it('grants access when badge includes room type', () => {
    const badge: SecurityBadge = { rooms: ['code-lab', 'review'], clearance: 'standard', canExport: false };
    const result = checkRoomAccess(agentId, 'code-lab', badge, []);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.granted).toBe(true);
      expect(result.data.source).toBe('badge');
    }
  });

  it('grants access via wildcard badge', () => {
    const badge: SecurityBadge = { rooms: ['*'], clearance: 'admin', canExport: true };
    const result = checkRoomAccess(agentId, 'anything', badge, []);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.source).toBe('wildcard');
    }
  });

  it('denies access when badge does not include room type', () => {
    const badge: SecurityBadge = { rooms: ['testing-lab'], clearance: 'standard', canExport: false };
    const result = checkRoomAccess(agentId, 'code-lab', badge, ['code-lab']);
    // Badge takes priority over roomAccess — denies even if roomAccess allows
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('ACCESS_DENIED');
      expect(result.error.message).toContain('code-lab');
    }
  });

  it('falls back to roomAccess when no badge', () => {
    const result = checkRoomAccess(agentId, 'code-lab', null, ['code-lab', 'review']);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.source).toBe('room_access');
    }
  });

  it('falls back to roomAccess wildcard when no badge', () => {
    const result = checkRoomAccess(agentId, 'anything', null, ['*']);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.source).toBe('room_access');
    }
  });

  it('denies access when no badge and roomAccess does not include type', () => {
    const result = checkRoomAccess(agentId, 'code-lab', null, ['review']);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('ACCESS_DENIED');
    }
  });

  it('denies access when both badge and roomAccess are empty', () => {
    const badge: SecurityBadge = { rooms: [], clearance: 'standard', canExport: false };
    const result = checkRoomAccess(agentId, 'code-lab', badge, []);
    expect(result.ok).toBe(false);
  });

  it('includes badge rooms in denial message', () => {
    const badge: SecurityBadge = { rooms: ['testing-lab', 'review'], clearance: 'standard', canExport: false };
    const result = checkRoomAccess(agentId, 'code-lab', badge, []);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('testing-lab, review');
    }
  });
});

// ─── checkClearance ───

describe('checkClearance', () => {
  it('standard meets standard requirement', () => {
    expect(checkClearance('standard', 'standard')).toBe(true);
  });

  it('standard does not meet elevated requirement', () => {
    expect(checkClearance('standard', 'elevated')).toBe(false);
  });

  it('standard does not meet admin requirement', () => {
    expect(checkClearance('standard', 'admin')).toBe(false);
  });

  it('elevated meets standard requirement', () => {
    expect(checkClearance('elevated', 'standard')).toBe(true);
  });

  it('elevated meets elevated requirement', () => {
    expect(checkClearance('elevated', 'elevated')).toBe(true);
  });

  it('elevated does not meet admin requirement', () => {
    expect(checkClearance('elevated', 'admin')).toBe(false);
  });

  it('admin meets all requirements', () => {
    expect(checkClearance('admin', 'standard')).toBe(true);
    expect(checkClearance('admin', 'elevated')).toBe(true);
    expect(checkClearance('admin', 'admin')).toBe(true);
  });
});

// ─── filterToolsByClearance ───

describe('filterToolsByClearance', () => {
  const tools = ['read_file', 'write_file', 'shell_exec', 'deploy_prod'];
  const clearanceMap: Record<string, ClearanceLevel> = {
    read_file: 'standard',
    write_file: 'standard',
    shell_exec: 'elevated',
    deploy_prod: 'admin',
  };

  it('standard clearance: only standard tools', () => {
    const result = filterToolsByClearance(tools, 'standard', clearanceMap);
    expect(result).toEqual(['read_file', 'write_file']);
  });

  it('elevated clearance: standard + elevated tools', () => {
    const result = filterToolsByClearance(tools, 'elevated', clearanceMap);
    expect(result).toEqual(['read_file', 'write_file', 'shell_exec']);
  });

  it('admin clearance: all tools', () => {
    const result = filterToolsByClearance(tools, 'admin', clearanceMap);
    expect(result).toEqual(tools);
  });

  it('tools without clearance requirement default to standard', () => {
    const result = filterToolsByClearance(['unknown_tool'], 'standard', {});
    expect(result).toEqual(['unknown_tool']);
  });

  it('returns empty array when no tools match', () => {
    const result = filterToolsByClearance(['deploy_prod'], 'standard', clearanceMap);
    expect(result).toEqual([]);
  });
});

// ─── checkExportPermission ───

describe('checkExportPermission', () => {
  it('allows export when no badge (backward compat)', () => {
    expect(checkExportPermission(null)).toBe(true);
  });

  it('allows export when badge has canExport: true', () => {
    const badge: SecurityBadge = { rooms: [], clearance: 'standard', canExport: true };
    expect(checkExportPermission(badge)).toBe(true);
  });

  it('denies export when badge has canExport: false', () => {
    const badge: SecurityBadge = { rooms: [], clearance: 'admin', canExport: false };
    expect(checkExportPermission(badge)).toBe(false);
  });
});

// ─── getEffectiveClearance ───

describe('getEffectiveClearance', () => {
  it('returns standard when no badge', () => {
    expect(getEffectiveClearance(null)).toBe('standard');
  });

  it('returns badge clearance when present', () => {
    const badge: SecurityBadge = { rooms: [], clearance: 'elevated', canExport: false };
    expect(getEffectiveClearance(badge)).toBe('elevated');
  });

  it('returns admin clearance', () => {
    const badge: SecurityBadge = { rooms: ['*'], clearance: 'admin', canExport: true };
    expect(getEffectiveClearance(badge)).toBe('admin');
  });
});

// ─── createBadge ───

describe('createBadge', () => {
  it('creates a valid badge with defaults', () => {
    const result = createBadge(['code-lab']);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual({
        rooms: ['code-lab'],
        clearance: 'standard',
        canExport: false,
      });
    }
  });

  it('creates a badge with all parameters', () => {
    const result = createBadge(['*'], 'admin', true);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual({
        rooms: ['*'],
        clearance: 'admin',
        canExport: true,
      });
    }
  });

  it('rejects invalid rooms (empty string)', () => {
    const result = createBadge(['']);
    expect(result.ok).toBe(false);
  });
});

// ─── DEFAULT_BADGE ───

describe('DEFAULT_BADGE', () => {
  it('has standard clearance', () => {
    expect(DEFAULT_BADGE.clearance).toBe('standard');
  });

  it('has no room access', () => {
    expect(DEFAULT_BADGE.rooms).toEqual([]);
  });

  it('cannot export', () => {
    expect(DEFAULT_BADGE.canExport).toBe(false);
  });
});

// ─── CLEARANCE_LEVELS ───

describe('CLEARANCE_LEVELS', () => {
  it('has exactly three levels', () => {
    expect(CLEARANCE_LEVELS).toHaveLength(3);
  });

  it('includes standard, elevated, admin', () => {
    expect(CLEARANCE_LEVELS).toContain('standard');
    expect(CLEARANCE_LEVELS).toContain('elevated');
    expect(CLEARANCE_LEVELS).toContain('admin');
  });
});
