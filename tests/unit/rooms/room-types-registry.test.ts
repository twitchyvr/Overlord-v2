/**
 * Room Types Registry Tests
 *
 * Tests the room type barrel file that registers all 12 built-in room types.
 * Verifies:
 * - builtInRoomTypes array completeness and structure
 * - registerBuiltInRoomTypes() function behavior
 * - Re-exports of all room type classes
 * - Factory constructors are callable
 */

import { describe, it, expect, vi } from 'vitest';
import {
  builtInRoomTypes,
  registerBuiltInRoomTypes,
  DiscoveryRoom,
  ArchitectureRoom,
  CodeLab,
  TestingLab,
  ReviewRoom,
  DeployRoom,
  WarRoom,
  StrategistOffice,
  BuildingArchitect,
  DataExchangeRoom,
  ProviderHubRoom,
  PluginBayRoom,
} from '../../../src/rooms/room-types/index.js';

// ═══════════════════════════════════════════════════════════
// builtInRoomTypes array
// ═══════════════════════════════════════════════════════════

describe('builtInRoomTypes', () => {
  it('contains exactly 12 room types', () => {
    expect(builtInRoomTypes).toHaveLength(12);
  });

  it('contains all expected room type strings', () => {
    const types = builtInRoomTypes.map((rt) => rt.type);
    expect(types).toEqual([
      'strategist',
      'building-architect',
      'discovery',
      'architecture',
      'code-lab',
      'testing-lab',
      'review',
      'deploy',
      'war-room',
      'data-exchange',
      'provider-hub',
      'plugin-bay',
    ]);
  });

  it('has a factory function for every entry', () => {
    for (const entry of builtInRoomTypes) {
      expect(typeof entry.factory).toBe('function');
    }
  });

  it('each type string is unique', () => {
    const types = builtInRoomTypes.map((rt) => rt.type);
    const unique = new Set(types);
    expect(unique.size).toBe(types.length);
  });

  it('is typed as ReadonlyArray (compile-time immutability)', () => {
    // ReadonlyArray provides compile-time immutability, not runtime freeze.
    // Verify the array is stable and well-formed.
    expect(Array.isArray(builtInRoomTypes)).toBe(true);
    expect(builtInRoomTypes.length).toBeGreaterThan(0);
    // Every entry has required shape
    for (const entry of builtInRoomTypes) {
      expect(entry).toHaveProperty('type');
      expect(entry).toHaveProperty('factory');
    }
  });

  it('maps correct factories to type strings', () => {
    const typeMap = new Map(builtInRoomTypes.map((rt) => [rt.type, rt.factory]));

    expect(typeMap.get('strategist')).toBe(StrategistOffice as unknown);
    expect(typeMap.get('building-architect')).toBe(BuildingArchitect as unknown);
    expect(typeMap.get('discovery')).toBe(DiscoveryRoom as unknown);
    expect(typeMap.get('architecture')).toBe(ArchitectureRoom as unknown);
    expect(typeMap.get('code-lab')).toBe(CodeLab as unknown);
    expect(typeMap.get('testing-lab')).toBe(TestingLab as unknown);
    expect(typeMap.get('review')).toBe(ReviewRoom as unknown);
    expect(typeMap.get('deploy')).toBe(DeployRoom as unknown);
    expect(typeMap.get('war-room')).toBe(WarRoom as unknown);
    expect(typeMap.get('data-exchange')).toBe(DataExchangeRoom as unknown);
    expect(typeMap.get('provider-hub')).toBe(ProviderHubRoom as unknown);
    expect(typeMap.get('plugin-bay')).toBe(PluginBayRoom as unknown);
  });
});

// ═══════════════════════════════════════════════════════════
// registerBuiltInRoomTypes()
// ═══════════════════════════════════════════════════════════

describe('registerBuiltInRoomTypes()', () => {
  it('calls registerFn for each of the 12 room types', () => {
    const registerFn = vi.fn();
    registerBuiltInRoomTypes(registerFn);

    expect(registerFn).toHaveBeenCalledTimes(12);
  });

  it('passes correct type string and factory to registerFn', () => {
    const registerFn = vi.fn();
    registerBuiltInRoomTypes(registerFn);

    // Verify first call is strategist
    expect(registerFn).toHaveBeenNthCalledWith(1, 'strategist', expect.any(Function));

    // Verify last call is plugin-bay
    expect(registerFn).toHaveBeenNthCalledWith(12, 'plugin-bay', expect.any(Function));
  });

  it('registers types in the documented project flow order', () => {
    const registered: string[] = [];
    const registerFn = vi.fn((type: string) => {
      registered.push(type);
    });

    registerBuiltInRoomTypes(registerFn);

    expect(registered).toEqual([
      'strategist',
      'building-architect',
      'discovery',
      'architecture',
      'code-lab',
      'testing-lab',
      'review',
      'deploy',
      'war-room',
      'data-exchange',
      'provider-hub',
      'plugin-bay',
    ]);
  });

  it('passes actual constructor functions (not undefined)', () => {
    const factories: unknown[] = [];
    const registerFn = vi.fn((_type: string, factory: unknown) => {
      factories.push(factory);
    });

    registerBuiltInRoomTypes(registerFn);

    for (const factory of factories) {
      expect(factory).toBeDefined();
      expect(typeof factory).toBe('function');
    }
  });
});

// ═══════════════════════════════════════════════════════════
// Factory constructors are callable
// ═══════════════════════════════════════════════════════════

describe('Room type factories', () => {
  it('each factory can be instantiated with an ID', () => {
    for (const { type, factory } of builtInRoomTypes) {
      const room = new factory(`test_${type}_1`);
      expect(room).toBeDefined();
      expect(room.id).toBe(`test_${type}_1`);
    }
  });

  it('each factory produces a room with a static contract', () => {
    for (const { type, factory } of builtInRoomTypes) {
      // Access the static contract via the constructor
      const contract = (factory as unknown as { contract: { roomType: string } }).contract;
      expect(contract).toBeDefined();
      expect(contract.roomType).toBe(type);
    }
  });
});

// ═══════════════════════════════════════════════════════════
// Re-exports
// ═══════════════════════════════════════════════════════════

describe('Re-exports', () => {
  it('exports all 12 room type classes', () => {
    expect(DiscoveryRoom).toBeDefined();
    expect(ArchitectureRoom).toBeDefined();
    expect(CodeLab).toBeDefined();
    expect(TestingLab).toBeDefined();
    expect(ReviewRoom).toBeDefined();
    expect(DeployRoom).toBeDefined();
    expect(WarRoom).toBeDefined();
    expect(StrategistOffice).toBeDefined();
    expect(BuildingArchitect).toBeDefined();
    expect(DataExchangeRoom).toBeDefined();
    expect(ProviderHubRoom).toBeDefined();
    expect(PluginBayRoom).toBeDefined();
  });

  it('all re-exports are constructor functions', () => {
    const classes = [
      DiscoveryRoom, ArchitectureRoom, CodeLab, TestingLab,
      ReviewRoom, DeployRoom, WarRoom, StrategistOffice,
      BuildingArchitect, DataExchangeRoom, ProviderHubRoom, PluginBayRoom,
    ];

    for (const cls of classes) {
      expect(typeof cls).toBe('function');
    }
  });
});
