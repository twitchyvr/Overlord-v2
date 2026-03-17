/**
 * Budget Tracker Tests (#680)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { initStorage, getDb } from '../../../src/storage/db.js';
import {
  getAgentBudget,
  setAgentBudget,
  recordUsage,
  getUsageInPeriod,
  checkBudget,
  getBuildingBudgets,
} from '../../../src/agents/budget-tracker.js';
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

// Helper: create test agent
function createTestAgent(id: string, name: string, buildingId: string) {
  const db = getDb();
  db.prepare(
    `INSERT OR REPLACE INTO agents (id, name, role, building_id, config) VALUES (?, ?, 'developer', ?, '{}')`,
  ).run(id, name, buildingId);
}

// Helper: create test building
function createTestBuilding(id: string, name: string) {
  const db = getDb();
  db.prepare(
    `INSERT OR REPLACE INTO buildings (id, name, active_phase) VALUES (?, ?, 'strategy')`,
  ).run(id, name);
}

describe('Budget Tracker', () => {
  const BUILDING_ID = 'bld_test_budget';
  const AGENT_ID = 'agent_budget_test_1';

  beforeEach(async () => {
    testDir = join(tmpdir(), `overlord-budget-test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
    mkdirSync(testDir, { recursive: true });
    const cfg = createMockConfig(join(testDir, 'test.db'));
    await initStorage(cfg);
    createTestBuilding(BUILDING_ID, 'Budget Test Building');
    createTestAgent(AGENT_ID, 'Budget Agent', BUILDING_ID);
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('returns default budget when none is set', () => {
    const budget = getAgentBudget(AGENT_ID);
    expect(budget.limit).toBe(0); // unlimited
    expect(budget.period).toBe('monthly');
    expect(budget.alertAt).toEqual([75, 90, 100]);
  });

  it('sets and retrieves a budget', () => {
    setAgentBudget(AGENT_ID, { limit: 50000, period: 'weekly' });
    const budget = getAgentBudget(AGENT_ID);
    expect(budget.limit).toBe(50000);
    expect(budget.period).toBe('weekly');
  });

  it('records token usage', () => {
    recordUsage(AGENT_ID, 1000, 500);
    const used = getUsageInPeriod(AGENT_ID, 'none');
    expect(used).toBe(1500);
  });

  it('accumulates usage across multiple calls', () => {
    recordUsage(AGENT_ID, 1000, 500);
    recordUsage(AGENT_ID, 2000, 1000);
    const used = getUsageInPeriod(AGENT_ID, 'none');
    expect(used).toBe(4500); // (1000+500) + (2000+1000)
  });

  it('checkBudget reports unlimited when no limit set', () => {
    recordUsage(AGENT_ID, 5000, 3000);
    const status = checkBudget(AGENT_ID);
    expect(status.limit).toBe(0);
    expect(status.isOverBudget).toBe(false);
    expect(status.percentUsed).toBe(0);
  });

  it('checkBudget detects over-budget', () => {
    setAgentBudget(AGENT_ID, { limit: 1000, period: 'none' });
    recordUsage(AGENT_ID, 800, 400);
    const status = checkBudget(AGENT_ID);
    expect(status.isOverBudget).toBe(true);
    expect(status.percentUsed).toBe(120);
    expect(status.used).toBe(1200);
    expect(status.remaining).toBe(0);
  });

  it('checkBudget shows healthy usage', () => {
    setAgentBudget(AGENT_ID, { limit: 10000, period: 'none' });
    recordUsage(AGENT_ID, 2000, 1000);
    const status = checkBudget(AGENT_ID);
    expect(status.isOverBudget).toBe(false);
    expect(status.percentUsed).toBe(30);
    expect(status.remaining).toBe(7000);
  });

  it('getBuildingBudgets returns all agents', () => {
    createTestAgent('agent_budget_test_2', 'Agent Two', BUILDING_ID);
    const budgets = getBuildingBudgets(BUILDING_ID);
    expect(budgets.length).toBeGreaterThanOrEqual(2);
    expect(budgets.some(b => b.agentId === AGENT_ID)).toBe(true);
    expect(budgets.some(b => b.agentId === 'agent_budget_test_2')).toBe(true);
  });

  it('tracks period-specific usage for monthly budgets', () => {
    setAgentBudget(AGENT_ID, { limit: 100000, period: 'monthly' });
    recordUsage(AGENT_ID, 5000, 2000);

    // Period usage should match
    const periodUsed = getUsageInPeriod(AGENT_ID);
    expect(periodUsed).toBe(7000);

    // All-time should also match
    const allTimeUsed = getUsageInPeriod(AGENT_ID, 'none');
    expect(allTimeUsed).toBe(7000);
  });
});
