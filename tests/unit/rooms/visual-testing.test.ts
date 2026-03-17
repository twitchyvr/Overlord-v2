/**
 * Visual Testing & UAT Tests (#681)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { initStorage, getDb } from '../../../src/storage/db.js';
import {
  createVisualTest,
  reviewVisualTest,
  listVisualTests,
  getUATSummary,
  checkUATGate,
} from '../../../src/rooms/visual-testing.js';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdirSync, existsSync, rmSync } from 'fs';
import type { Config } from '../../../src/core/config.js';

let testDir: string;

function createMockConfig(dbPath: string): Config {
  return {
    get: vi.fn((key: string) => {
      if (key === 'DB_PATH') return dbPath;
      return undefined;
    }),
    validate: vi.fn(),
    getAll: vi.fn(),
  } as unknown as Config;
}

describe('Visual Testing & UAT', () => {
  const BUILDING_ID = 'bld_vt_test';

  beforeEach(async () => {
    testDir = join(tmpdir(), `overlord-vt-test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
    mkdirSync(testDir, { recursive: true });
    const cfg = createMockConfig(join(testDir, 'test.db'));
    await initStorage(cfg);
    getDb().prepare(`INSERT INTO buildings (id, name) VALUES (?, 'VT Test')`).run(BUILDING_ID);
  });

  afterEach(() => {
    if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
  });

  it('creates a visual test', () => {
    const result = createVisualTest({ buildingId: BUILDING_ID, title: 'Homepage render' });
    expect(result.ok).toBe(true);
    expect(result.data.id).toMatch(/^vt_/);
    expect(result.data.status).toBe('pending');
  });

  it('lists visual tests for building', () => {
    createVisualTest({ buildingId: BUILDING_ID, title: 'Test 1' });
    createVisualTest({ buildingId: BUILDING_ID, title: 'Test 2' });
    const result = listVisualTests(BUILDING_ID);
    expect(result.ok).toBe(true);
    expect(result.data.length).toBe(2);
  });

  it('reviews a visual test — approve', () => {
    const created = createVisualTest({ buildingId: BUILDING_ID, title: 'Review test' });
    const result = reviewVisualTest(created.data.id, {
      status: 'passed',
      reviewedBy: 'matt',
      notes: 'Looks good',
    });
    expect(result.ok).toBe(true);
    expect(result.data.status).toBe('passed');
  });

  it('reviews a visual test — reject', () => {
    const created = createVisualTest({ buildingId: BUILDING_ID, title: 'Broken test' });
    const result = reviewVisualTest(created.data.id, {
      status: 'failed',
      reviewedBy: 'matt',
      notes: 'Button misaligned',
    });
    expect(result.ok).toBe(true);
    expect(result.data.status).toBe('failed');
  });

  it('filters by status', () => {
    const t1 = createVisualTest({ buildingId: BUILDING_ID, title: 'Pass' });
    createVisualTest({ buildingId: BUILDING_ID, title: 'Pending' });
    reviewVisualTest(t1.data.id, { status: 'passed', reviewedBy: 'matt' });

    const passed = listVisualTests(BUILDING_ID, { status: 'passed' });
    expect(passed.data.length).toBe(1);

    const pending = listVisualTests(BUILDING_ID, { status: 'pending' });
    expect(pending.data.length).toBe(1);
  });

  it('UAT summary counts by status', () => {
    const t1 = createVisualTest({ buildingId: BUILDING_ID, title: 'A' });
    const t2 = createVisualTest({ buildingId: BUILDING_ID, title: 'B' });
    createVisualTest({ buildingId: BUILDING_ID, title: 'C' });

    reviewVisualTest(t1.data.id, { status: 'passed', reviewedBy: 'matt' });
    reviewVisualTest(t2.data.id, { status: 'failed', reviewedBy: 'matt' });

    const result = getUATSummary(BUILDING_ID);
    expect(result.ok).toBe(true);
    expect(result.data.passed).toBe(1);
    expect(result.data.failed).toBe(1);
    expect(result.data.pending).toBe(1);
    expect(result.data.total).toBe(3);
    expect(result.data.gateStatus).toBe('blocked');
  });

  it('UAT gate blocks with pending tests', () => {
    createVisualTest({ buildingId: BUILDING_ID, title: 'Pending' });
    const result = checkUATGate(BUILDING_ID);
    expect(result.ok).toBe(true);
    expect(result.data.passes).toBe(false);
  });

  it('UAT gate passes when all tests approved', () => {
    const t1 = createVisualTest({ buildingId: BUILDING_ID, title: 'A' });
    const t2 = createVisualTest({ buildingId: BUILDING_ID, title: 'B' });
    reviewVisualTest(t1.data.id, { status: 'passed', reviewedBy: 'matt' });
    reviewVisualTest(t2.data.id, { status: 'passed', reviewedBy: 'matt' });

    const result = checkUATGate(BUILDING_ID);
    expect(result.ok).toBe(true);
    expect(result.data.passes).toBe(true);
  });

  it('UAT gate passes with no tests (vacuous truth)', () => {
    const result = checkUATGate(BUILDING_ID);
    expect(result.ok).toBe(true);
    expect(result.data.passes).toBe(true);
  });
});
