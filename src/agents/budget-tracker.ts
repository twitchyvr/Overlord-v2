/**
 * Agent Budget Tracker (#680)
 *
 * Tracks per-agent token usage and enforces budget limits.
 * Inspired by Paperclip's budget management.
 *
 * Budget config stored in agent.config JSON:
 *   { budget: { limit: 100000, period: 'monthly', alertAt: [75, 90, 100] } }
 *
 * Usage stored in agent_stats table with metrics:
 *   'tokens_input', 'tokens_output', 'tokens_total', 'api_calls'
 *
 * Layer: Agents (depends on Storage, Core)
 */

import { logger } from '../core/logger.js';
import { getDb } from '../storage/db.js';
import type { Bus } from '../core/bus.js';

const log = logger.child({ module: 'budget-tracker' });

// ── Types ──

export interface BudgetConfig {
  /** Max tokens allowed in the period (0 = unlimited) */
  limit: number;
  /** Reset period: 'daily' | 'weekly' | 'monthly' | 'none' */
  period: 'daily' | 'weekly' | 'monthly' | 'none';
  /** Alert threshold percentages (e.g. [75, 90, 100]) */
  alertAt: number[];
}

export interface BudgetStatus {
  agentId: string;
  agentName: string;
  limit: number;
  period: string;
  used: number;
  remaining: number;
  percentUsed: number;
  isOverBudget: boolean;
  periodStart: string;
}

const DEFAULT_BUDGET: BudgetConfig = {
  limit: 0, // unlimited
  period: 'monthly',
  alertAt: [75, 90, 100],
};

// ── Budget CRUD ──

/** Get an agent's budget config from their config JSON */
export function getAgentBudget(agentId: string): BudgetConfig {
  const db = getDb();
  const row = db.prepare('SELECT config FROM agents WHERE id = ?').get(agentId) as { config: string } | undefined;
  if (!row) return { ...DEFAULT_BUDGET };
  try {
    const config = JSON.parse(row.config || '{}');
    return { ...DEFAULT_BUDGET, ...config.budget };
  } catch {
    return { ...DEFAULT_BUDGET };
  }
}

/** Set an agent's budget config */
export function setAgentBudget(agentId: string, budget: Partial<BudgetConfig>): void {
  const db = getDb();
  const row = db.prepare('SELECT config FROM agents WHERE id = ?').get(agentId) as { config: string } | undefined;
  if (!row) return;

  let config: Record<string, unknown>;
  try {
    config = JSON.parse(row.config || '{}');
  } catch {
    config = {};
  }

  config.budget = { ...DEFAULT_BUDGET, ...(config.budget as BudgetConfig || {}), ...budget };
  db.prepare('UPDATE agents SET config = ?, updated_at = datetime(\'now\') WHERE id = ?')
    .run(JSON.stringify(config), agentId);
}

// ── Usage Tracking ──

/** Get the start of the current budget period */
function getPeriodStart(period: string): string {
  const now = new Date();
  switch (period) {
    case 'daily':
      return new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    case 'weekly': {
      const day = now.getDay();
      const diff = now.getDate() - day + (day === 0 ? -6 : 1); // Monday start
      return new Date(now.getFullYear(), now.getMonth(), diff).toISOString();
    }
    case 'monthly':
      return new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    default:
      return '1970-01-01T00:00:00.000Z'; // 'none' = all-time
  }
}

/** Record token usage for an agent */
export function recordUsage(
  agentId: string,
  inputTokens: number,
  outputTokens: number,
): void {
  const db = getDb();
  const totalTokens = inputTokens + outputTokens;
  const id = `stat_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  // Upsert all-time stats
  const upsertSql = `
    INSERT INTO agent_stats (id, agent_id, metric, value, period, recorded_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(agent_id, metric, period) DO UPDATE SET
      value = value + excluded.value,
      recorded_at = datetime('now')
  `;

  db.prepare(upsertSql).run(`${id}_ti`, agentId, 'tokens_input', inputTokens, 'all-time');
  db.prepare(upsertSql).run(`${id}_to`, agentId, 'tokens_output', outputTokens, 'all-time');
  db.prepare(upsertSql).run(`${id}_tt`, agentId, 'tokens_total', totalTokens, 'all-time');
  db.prepare(upsertSql).run(`${id}_ac`, agentId, 'api_calls', 1, 'all-time');

  // Also track per-period stats (for budget enforcement)
  const budget = getAgentBudget(agentId);
  if (budget.period !== 'none') {
    const periodKey = getCurrentPeriodKey(budget.period);
    db.prepare(upsertSql).run(`${id}_pti`, agentId, 'tokens_input', inputTokens, periodKey);
    db.prepare(upsertSql).run(`${id}_pto`, agentId, 'tokens_output', outputTokens, periodKey);
    db.prepare(upsertSql).run(`${id}_ptt`, agentId, 'tokens_total', totalTokens, periodKey);
    db.prepare(upsertSql).run(`${id}_pac`, agentId, 'api_calls', 1, periodKey);
  }

  log.debug({ agentId, inputTokens, outputTokens, totalTokens }, 'Recorded token usage');
}

/** Get the current period key (e.g. "monthly:2026-03") */
function getCurrentPeriodKey(period: string): string {
  const now = new Date();
  switch (period) {
    case 'daily':
      return `daily:${now.toISOString().slice(0, 10)}`;
    case 'weekly': {
      const day = now.getDay();
      const monday = new Date(now);
      monday.setDate(now.getDate() - day + (day === 0 ? -6 : 1));
      return `weekly:${monday.toISOString().slice(0, 10)}`;
    }
    case 'monthly':
      return `monthly:${now.toISOString().slice(0, 7)}`;
    default:
      return 'all-time';
  }
}

/** Get tokens used in the current budget period */
export function getUsageInPeriod(agentId: string, period?: string): number {
  const budget = getAgentBudget(agentId);
  const effectivePeriod = period || budget.period;

  if (effectivePeriod === 'none') {
    // All-time usage
    return getStatValue(agentId, 'tokens_total', 'all-time');
  }

  const periodKey = getCurrentPeriodKey(effectivePeriod);
  return getStatValue(agentId, 'tokens_total', periodKey);
}

/** Get a single stat value */
function getStatValue(agentId: string, metric: string, period: string): number {
  const db = getDb();
  const row = db.prepare(
    'SELECT value FROM agent_stats WHERE agent_id = ? AND metric = ? AND period = ?',
  ).get(agentId, metric, period) as { value: number } | undefined;
  return row?.value || 0;
}

// ── Budget Check ──

/** Check if an agent is within budget. Returns status with details. */
export function checkBudget(agentId: string): BudgetStatus {
  const budget = getAgentBudget(agentId);
  const db = getDb();
  const agentRow = db.prepare('SELECT name, display_name FROM agents WHERE id = ?').get(agentId) as { name: string; display_name: string | null } | undefined;
  const agentName = agentRow?.display_name || agentRow?.name || agentId;

  const used = getUsageInPeriod(agentId);
  const limit = budget.limit;
  const remaining = limit > 0 ? Math.max(0, limit - used) : Infinity;
  const percentUsed = limit > 0 ? Math.round((used / limit) * 100) : 0;
  const isOverBudget = limit > 0 && used >= limit;

  return {
    agentId,
    agentName,
    limit,
    period: budget.period,
    used,
    remaining: remaining === Infinity ? -1 : remaining,
    percentUsed,
    isOverBudget,
    periodStart: getPeriodStart(budget.period),
  };
}

/** Get budget status for all agents in a building */
export function getBuildingBudgets(buildingId: string): BudgetStatus[] {
  const db = getDb();
  const agents = db.prepare(
    'SELECT id FROM agents WHERE building_id = ? AND id != \'__user__\'',
  ).all(buildingId) as Array<{ id: string }>;

  return agents.map(a => checkBudget(a.id));
}

// ── Bus Integration ──

/** Initialize budget tracking on the event bus */
export function initBudgetTracker(bus: Bus): void {
  // Track token usage after every chat response
  bus.on('chat:response', (data) => {
    const agentId = data.agentId as string;
    const tokens = data.tokens as { input: number; output: number } | undefined;
    if (!agentId || !tokens || agentId === '__user__') return;

    recordUsage(agentId, tokens.input, tokens.output);

    // Check budget thresholds and emit alerts
    const budget = getAgentBudget(agentId);
    if (budget.limit > 0) {
      const status = checkBudget(agentId);
      for (const threshold of budget.alertAt) {
        if (status.percentUsed >= threshold) {
          bus.emit('budget:alert', {
            agentId,
            agentName: status.agentName,
            threshold,
            percentUsed: status.percentUsed,
            used: status.used,
            limit: status.limit,
            period: status.period,
            isOverBudget: status.isOverBudget,
          });
        }
      }
    }
  });

  log.info('Budget tracker initialized — tracking per-agent token usage');
}
