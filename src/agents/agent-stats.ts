/**
 * Agent Stats & Activity Service
 *
 * Records agent lifecycle events (room joins, task completions, status changes)
 * and provides aggregated statistics. All data persists in SQLite via the
 * agent_activity_log and agent_stats tables.
 *
 * Layer: Agents (depends on Storage, Core)
 */

import { logger } from '../core/logger.js';
import { ok, err } from '../core/contracts.js';
import type { Result } from '../core/contracts.js';
import { getDb } from '../storage/db.js';

const log = logger.child({ module: 'agents:stats' });

// ─── Types ───

export interface ActivityLogEntry {
  id: string;
  agent_id: string;
  event_type: string;
  event_data: Record<string, unknown>;
  building_id: string | null;
  room_id: string | null;
  created_at: string;
}

export interface AgentStatsRow {
  id: string;
  agent_id: string;
  metric: string;
  value: number;
  period: string;
  recorded_at: string;
}

export interface AgentStatsSummary {
  agentId: string;
  tasksCompleted: number;
  tasksAssigned: number;
  messagesCount: number;
  roomJoins: number;
  sessionsCount: number;
  totalActiveTimeMs: number;
  lastActiveAt: string | null;
  recentActivity: ActivityLogEntry[];
}

// ─── Activity Log ───

/**
 * Record an agent activity event.
 */
export function recordActivity(
  agentId: string,
  eventType: string,
  eventData: Record<string, unknown> = {},
  buildingId?: string | null,
  roomId?: string | null,
): Result {
  const db = getDb();
  const id = `activity_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  try {
    db.prepare(`
      INSERT INTO agent_activity_log (id, agent_id, event_type, event_data, building_id, room_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      id,
      agentId,
      eventType,
      JSON.stringify(eventData),
      buildingId ?? null,
      roomId ?? null,
    );

    log.debug({ agentId, eventType }, 'Agent activity recorded');
    return ok({ id });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    log.error({ agentId, eventType, error: message }, 'Failed to record activity');
    return err('ACTIVITY_RECORD_FAILED', message);
  }
}

/**
 * Get activity log for an agent, newest first.
 */
export function getActivityLog(
  agentId: string,
  opts: { limit?: number; offset?: number; eventType?: string } = {},
): ActivityLogEntry[] {
  const db = getDb();
  const limit = opts.limit ?? 50;
  const offset = opts.offset ?? 0;

  let sql = 'SELECT * FROM agent_activity_log WHERE agent_id = ?';
  const params: unknown[] = [agentId];

  if (opts.eventType) {
    sql += ' AND event_type = ?';
    params.push(opts.eventType);
  }

  sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const rows = db.prepare(sql).all(...params) as Array<{
    id: string;
    agent_id: string;
    event_type: string;
    event_data: string;
    building_id: string | null;
    room_id: string | null;
    created_at: string;
  }>;

  return rows.map((row) => ({
    ...row,
    event_data: safeJsonParse(row.event_data),
  }));
}

/**
 * Get activity history for a building — all agents, sorted by time.
 * Used by the Activity view to load historical events on mount (#565).
 */
export function getBuildingActivityLog(
  buildingId: string,
  opts: { limit?: number; offset?: number; eventType?: string } = {},
): ActivityLogEntry[] {
  const db = getDb();
  const limit = opts.limit ?? 100;
  const offset = opts.offset ?? 0;

  let sql = 'SELECT * FROM agent_activity_log WHERE building_id = ?';
  const params: unknown[] = [buildingId];

  if (opts.eventType) {
    sql += ' AND event_type = ?';
    params.push(opts.eventType);
  }

  sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const rows = db.prepare(sql).all(...params) as Array<{
    id: string;
    agent_id: string;
    event_type: string;
    event_data: string;
    building_id: string | null;
    room_id: string | null;
    created_at: string;
  }>;

  return rows.map((row) => ({
    ...row,
    event_data: safeJsonParse(row.event_data),
  }));
}

// ─── Stats Aggregation ───

/**
 * Increment a stat counter for an agent (all-time period).
 */
export function incrementStat(agentId: string, metric: string, amount = 1): Result {
  const db = getDb();
  const id = `stat_${agentId}_${metric}_all-time`;

  try {
    // Atomic upsert: insert or increment on conflict
    db.prepare(`
      INSERT INTO agent_stats (id, agent_id, metric, value, period, recorded_at)
      VALUES (?, ?, ?, ?, 'all-time', datetime('now'))
      ON CONFLICT(agent_id, metric, period)
      DO UPDATE SET value = value + ?, recorded_at = datetime('now')
    `).run(id, agentId, metric, amount, amount);

    // Read back the current value
    const row = db.prepare(
      'SELECT value FROM agent_stats WHERE agent_id = ? AND metric = ? AND period = ?',
    ).get(agentId, metric, 'all-time') as { value: number } | undefined;

    return ok({ metric, value: row?.value ?? amount });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    log.error({ agentId, metric, error: message }, 'Failed to increment stat');
    return err('STAT_INCREMENT_FAILED', message);
  }
}

/**
 * Set a stat value (overwrites, not increments).
 */
export function setStat(agentId: string, metric: string, value: number): Result {
  const db = getDb();
  const id = `stat_${agentId}_${metric}_all-time`;

  try {
    // Atomic upsert: insert or overwrite on conflict
    db.prepare(`
      INSERT INTO agent_stats (id, agent_id, metric, value, period, recorded_at)
      VALUES (?, ?, ?, ?, 'all-time', datetime('now'))
      ON CONFLICT(agent_id, metric, period)
      DO UPDATE SET value = ?, recorded_at = datetime('now')
    `).run(id, agentId, metric, value, value);

    return ok({ metric, value });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return err('STAT_SET_FAILED', message);
  }
}

/**
 * Get all stats for an agent.
 */
export function getStats(agentId: string): Record<string, number> {
  const db = getDb();
  const rows = db.prepare(
    'SELECT metric, value FROM agent_stats WHERE agent_id = ? AND period = ?',
  ).all(agentId, 'all-time') as Array<{ metric: string; value: number }>;

  const stats: Record<string, number> = {};
  for (const row of rows) {
    stats[row.metric] = row.value;
  }
  return stats;
}

/**
 * Build a complete stats summary for an agent.
 */
export function getStatsSummary(agentId: string): AgentStatsSummary {
  const stats = getStats(agentId);
  const recentActivity = getActivityLog(agentId, { limit: 20 });

  // Derive last active from most recent activity entry
  const lastActiveAt = recentActivity.length > 0 ? recentActivity[0].created_at : null;

  return {
    agentId,
    tasksCompleted: stats['tasks_completed'] ?? 0,
    tasksAssigned: stats['tasks_assigned'] ?? 0,
    messagesCount: stats['messages_sent'] ?? 0,
    roomJoins: stats['room_joins'] ?? 0,
    sessionsCount: stats['sessions_count'] ?? 0,
    totalActiveTimeMs: stats['active_time_ms'] ?? 0,
    lastActiveAt,
    recentActivity,
  };
}

/**
 * Get leaderboard: agents ranked by a metric.
 */
export function getLeaderboard(
  metric: string,
  opts: { limit?: number; buildingId?: string } = {},
): Array<{ agentId: string; agentName: string; value: number }> {
  const db = getDb();
  const limit = opts.limit ?? 10;

  let sql = `
    SELECT s.agent_id, a.name AS agent_name, s.value
    FROM agent_stats s
    JOIN agents a ON a.id = s.agent_id
    WHERE s.metric = ? AND s.period = 'all-time'
  `;
  const params: unknown[] = [metric];

  if (opts.buildingId) {
    sql += ' AND a.building_id = ?';
    params.push(opts.buildingId);
  }

  sql += ' ORDER BY s.value DESC LIMIT ?';
  params.push(limit);

  return (db.prepare(sql).all(...params) as Array<{
    agent_id: string;
    agent_name: string;
    value: number;
  }>).map((row) => ({
    agentId: row.agent_id,
    agentName: row.agent_name,
    value: row.value,
  }));
}

// ─── Lifecycle Hooks ───

/**
 * Hook: agent joined a room.
 */
export function onRoomJoin(agentId: string, roomId: string, roomType: string, buildingId?: string): void {
  recordActivity(agentId, 'room_join', { roomType }, buildingId, roomId);
  incrementStat(agentId, 'room_joins');
}

/**
 * Hook: agent left a room.
 */
export function onRoomLeave(agentId: string, roomId: string, roomType: string, buildingId?: string): void {
  recordActivity(agentId, 'room_leave', { roomType }, buildingId, roomId);
}

/**
 * Hook: agent status changed.
 */
export function onStatusChange(agentId: string, oldStatus: string, newStatus: string): void {
  recordActivity(agentId, 'status_change', { from: oldStatus, to: newStatus });
}

/**
 * Hook: agent completed a task.
 */
export function onTaskComplete(agentId: string, taskId: string, taskTitle: string, buildingId?: string): void {
  recordActivity(agentId, 'task_complete', { taskId, taskTitle }, buildingId);
  incrementStat(agentId, 'tasks_completed');
}

/**
 * Hook: agent was assigned a task.
 */
export function onTaskAssign(agentId: string, taskId: string, taskTitle: string, buildingId?: string): void {
  recordActivity(agentId, 'task_assign', { taskId, taskTitle }, buildingId);
  incrementStat(agentId, 'tasks_assigned');
}

/**
 * Hook: agent sent a message.
 */
export function onMessageSent(agentId: string, _roomId: string, _buildingId?: string): void {
  incrementStat(agentId, 'messages_sent');
}

/**
 * Hook: agent started a session.
 */
export function onSessionStart(agentId: string, roomId: string, buildingId?: string): void {
  recordActivity(agentId, 'session_start', {}, buildingId, roomId);
  incrementStat(agentId, 'sessions_count');
}

/**
 * Hook: agent session ended.
 */
export function onSessionEnd(agentId: string, roomId: string, durationMs: number, buildingId?: string): void {
  recordActivity(agentId, 'session_end', { durationMs }, buildingId, roomId);
  incrementStat(agentId, 'active_time_ms', durationMs);
}

// ─── Helpers ───

function safeJsonParse(str: string): Record<string, unknown> {
  try {
    return JSON.parse(str) as Record<string, unknown>;
  } catch {
    return {};
  }
}
