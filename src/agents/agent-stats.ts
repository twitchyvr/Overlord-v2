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

/**
 * Get activity log entries for a specific room.
 */
export function getRoomActivityLog(
  roomId: string,
  opts: { limit?: number; offset?: number; eventType?: string } = {},
): ActivityLogEntry[] {
  const db = getDb();
  const limit = opts.limit ?? 100;
  const offset = opts.offset ?? 0;

  let sql = 'SELECT * FROM agent_activity_log WHERE room_id = ?';
  const params: unknown[] = [roomId];

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
 * Get activity log entries for a specific floor (aggregate of all rooms on that floor).
 */
export function getFloorActivityLog(
  floorId: string,
  opts: { limit?: number; offset?: number; eventType?: string } = {},
): ActivityLogEntry[] {
  const db = getDb();
  const limit = opts.limit ?? 100;
  const offset = opts.offset ?? 0;

  let sql = `
    SELECT a.* FROM agent_activity_log a
    JOIN rooms r ON a.room_id = r.id
    WHERE r.floor_id = ?
  `;
  const params: unknown[] = [floorId];

  if (opts.eventType) {
    sql += ' AND a.event_type = ?';
    params.push(opts.eventType);
  }

  sql += ' ORDER BY a.created_at DESC LIMIT ? OFFSET ?';
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

// ─── Telemetry Rates (#804) ───

export interface TelemetryRates {
  executionRate: number;      // conversation loop completions per hour
  toolUseRate: number;        // tool calls per hour
  agentChatRate: number;      // chat messages per hour
  aiRequestRate: number;      // AI API calls per hour
  totalTokens: number;        // total tokens consumed (all time)
  totalTokensLastHour: number;
  totalToolCalls: number;     // all time
  totalMessages: number;      // all time
  totalSessions: number;      // all time
  activeAgents: number;
  idleAgents: number;
  topTools: Array<{ name: string; count: number }>;
  topAgents: Array<{ name: string; id: string; events: number }>;
  recentActivity: ActivityLogEntry[];
}

/**
 * Get telemetry rates from the database. Supports project-level (buildingId)
 * and global-level (no buildingId) queries.
 */
export function getTelemetryRates(buildingId?: string): TelemetryRates {
  const db = getDb();
  const oneHourAgo = new Date(Date.now() - 3600000).toISOString();
  const whereBuilding = buildingId ? ' AND building_id = ?' : '';
  const buildingParams = buildingId ? [buildingId] : [];

  // Rates: count events in last hour
  const hourCounts = db.prepare(`
    SELECT event_type, COUNT(*) as cnt
    FROM agent_activity_log
    WHERE created_at >= ?${whereBuilding}
    GROUP BY event_type
  `).all(oneHourAgo, ...buildingParams) as Array<{ event_type: string; cnt: number }>;

  const hourMap = new Map(hourCounts.map(r => [r.event_type, r.cnt]));

  const executionRate = (hourMap.get('session_end') || 0) + (hourMap.get('agent:activity') || 0);
  const toolUseRate = (hourMap.get('tool_executed') || 0) + (hourMap.get('tool:executed') || 0) + (hourMap.get('tool:executing') || 0);
  const agentChatRate = (hourMap.get('message_sent') || 0) + (hourMap.get('chat:message') || 0);
  const aiRequestRate = (hourMap.get('ai:request') || 0) + (hourMap.get('ai_request') || 0);

  // Token totals from agent_stats
  const tokenQuery = buildingId
    ? `SELECT COALESCE(SUM(s.value), 0) as total FROM agent_stats s JOIN agents a ON s.agent_id = a.id WHERE s.metric = 'tokens_used' AND a.building_id = ?`
    : `SELECT COALESCE(SUM(value), 0) as total FROM agent_stats WHERE metric = 'tokens_used'`;
  const tokenResult = db.prepare(tokenQuery).get(...buildingParams) as { total: number };
  const totalTokens = tokenResult?.total || 0;

  // Tokens in last hour (from activity log event_data)
  const tokenHourResult = db.prepare(`
    SELECT COUNT(*) as cnt FROM agent_activity_log
    WHERE (event_type = 'ai:request' OR event_type = 'ai_request')
    AND created_at >= ?${whereBuilding}
  `).get(oneHourAgo, ...buildingParams) as { cnt: number };
  const totalTokensLastHour = tokenHourResult?.cnt || 0;

  // All-time totals
  const totalsQuery = buildingId
    ? `SELECT event_type, COUNT(*) as cnt FROM agent_activity_log WHERE building_id = ? GROUP BY event_type`
    : `SELECT event_type, COUNT(*) as cnt FROM agent_activity_log GROUP BY event_type`;
  const totals = db.prepare(totalsQuery).all(...buildingParams) as Array<{ event_type: string; cnt: number }>;
  const totalMap = new Map(totals.map(r => [r.event_type, r.cnt]));

  const totalToolCalls = (totalMap.get('tool_executed') || 0) + (totalMap.get('tool:executed') || 0) + (totalMap.get('tool:executing') || 0);
  const totalMessages = (totalMap.get('message_sent') || 0) + (totalMap.get('chat:message') || 0);
  const totalSessions = (totalMap.get('session_end') || 0) + (totalMap.get('session_start') || 0);

  // Agent status counts
  const agentStatusQuery = buildingId
    ? `SELECT status, COUNT(*) as cnt FROM agents WHERE building_id = ? GROUP BY status`
    : `SELECT status, COUNT(*) as cnt FROM agents GROUP BY status`;
  const agentStatuses = db.prepare(agentStatusQuery).all(...buildingParams) as Array<{ status: string; cnt: number }>;
  const statusMap = new Map(agentStatuses.map(r => [r.status, r.cnt]));

  // Top tools (all time, top 8)
  const topToolsQuery = db.prepare(`
    SELECT json_extract(event_data, '$.toolName') as name, COUNT(*) as cnt
    FROM agent_activity_log
    WHERE (event_type = 'tool:executed' OR event_type = 'tool_executed')
    ${buildingId ? 'AND building_id = ?' : ''}
    AND json_extract(event_data, '$.toolName') IS NOT NULL
    GROUP BY name ORDER BY cnt DESC LIMIT 8
  `).all(...buildingParams) as Array<{ name: string; cnt: number }>;

  // Top agents by activity (last 24h)
  const twentyFourHoursAgo = new Date(Date.now() - 86400000).toISOString();
  const topAgentsQuery = db.prepare(`
    SELECT a.agent_id as id, ag.display_name as name, COUNT(*) as events
    FROM agent_activity_log a
    LEFT JOIN agents ag ON a.agent_id = ag.id
    WHERE a.created_at >= ?${whereBuilding.replace('building_id', 'a.building_id')}
    GROUP BY a.agent_id ORDER BY events DESC LIMIT 5
  `).all(twentyFourHoursAgo, ...buildingParams) as Array<{ id: string; name: string; events: number }>;

  // Recent activity (last 20 entries)
  const recentQuery = buildingId
    ? `SELECT * FROM agent_activity_log WHERE building_id = ? ORDER BY created_at DESC LIMIT 20`
    : `SELECT * FROM agent_activity_log ORDER BY created_at DESC LIMIT 20`;
  const recentRows = db.prepare(recentQuery).all(...buildingParams) as Array<{
    id: string; agent_id: string; event_type: string; event_data: string;
    building_id: string | null; room_id: string | null; created_at: string;
  }>;

  return {
    executionRate,
    toolUseRate,
    agentChatRate,
    aiRequestRate,
    totalTokens,
    totalTokensLastHour,
    totalToolCalls,
    totalMessages,
    totalSessions,
    activeAgents: statusMap.get('active') || 0,
    idleAgents: statusMap.get('idle') || 0,
    topTools: topToolsQuery.map(t => ({ name: t.name, count: t.cnt })),
    topAgents: topAgentsQuery.map(a => ({ name: a.name || 'Agent', id: a.id, events: a.events })),
    recentActivity: recentRows.map(row => ({ ...row, event_data: safeJsonParse(row.event_data) })),
  };
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
