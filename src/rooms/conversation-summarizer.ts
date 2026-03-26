/**
 * Conversation Summarizer (#1268)
 *
 * Auto-generates summaries after multi-message agent discussions at tables.
 * Detects silence (no new messages for SILENCE_THRESHOLD), then summarizes
 * the conversation and stores it as a session note + activity event.
 *
 * Layer: Rooms (depends on AI, Storage, Core)
 */

import { getDb } from '../storage/db.js';
import { logger } from '../core/logger.js';
import { bus } from '../core/bus.js';
import { writeNote } from '../tools/providers/session-notes.js';

const log = logger.child({ module: 'conversation-summarizer' });

const SILENCE_THRESHOLD_MS = 2 * 60 * 1000; // 2 minutes of silence triggers summary
const MIN_MESSAGES_FOR_SUMMARY = 3; // Don't summarize trivial exchanges
const MAX_TRANSCRIPT_MESSAGES = 50; // Cap transcript length

// Track active table discussions
const activeDiscussions = new Map<string, {
  lastMessageAt: number;
  messageCount: number;
  timer: ReturnType<typeof setTimeout> | null;
}>();

/**
 * Called when a new message arrives at a table.
 * Resets the silence timer and tracks the discussion.
 */
export function onTableMessage(tableId: string, _buildingId: string): void {
  const existing = activeDiscussions.get(tableId) || { lastMessageAt: 0, messageCount: 0, timer: null };

  // Clear any pending summary timer
  if (existing.timer) clearTimeout(existing.timer);

  existing.lastMessageAt = Date.now();
  existing.messageCount++;

  // Set new silence timer — when it fires, generate summary
  existing.timer = setTimeout(() => {
    if (existing.messageCount >= MIN_MESSAGES_FOR_SUMMARY) {
      generateSummary(tableId).catch(err => {
        log.error({ tableId, err: err instanceof Error ? err.message : String(err) }, 'Failed to generate conversation summary');
      });
    }
    activeDiscussions.delete(tableId);
  }, SILENCE_THRESHOLD_MS);

  activeDiscussions.set(tableId, existing);
}

/**
 * Generate a conversation summary for a table discussion.
 */
async function generateSummary(tableId: string): Promise<void> {
  const db = getDb();

  // Get table info
  const table = db.prepare(
    'SELECT t.id, t.type, t.name, r.name as room_name, r.type as room_type, f.building_id FROM tables_v2 t JOIN rooms r ON t.room_id = r.id JOIN floors f ON r.floor_id = f.id WHERE t.id = ?'
  ).get(tableId) as { id: string; type: string; name: string | null; room_name: string; room_type: string; building_id: string } | undefined;

  if (!table) {
    log.warn({ tableId }, 'Table not found for summary generation');
    return;
  }

  // Get recent messages for this table
  const messages = db.prepare(`
    SELECT m.content, m.sender_id, m.sender_name, m.role, m.created_at,
           COALESCE(a.display_name, a.name) as agent_name
    FROM messages m
    LEFT JOIN agents a ON m.sender_id = a.id
    WHERE m.table_id = ?
    AND m.role != 'system'
    ORDER BY m.created_at DESC
    LIMIT ?
  `).all(tableId, MAX_TRANSCRIPT_MESSAGES) as Array<{
    content: string; sender_id: string; sender_name: string | null;
    role: string; created_at: string; agent_name: string | null;
  }>;

  if (messages.length < MIN_MESSAGES_FOR_SUMMARY) {
    log.debug({ tableId, count: messages.length }, 'Too few messages for summary');
    return;
  }

  // Build participant list
  const participants = new Set<string>();
  for (const msg of messages) {
    const name = msg.agent_name || msg.sender_name || msg.sender_id;
    if (name && name !== '__user__') participants.add(name);
  }

  // Build transcript (oldest first)
  const transcript = messages.reverse().map(m => {
    const name = m.agent_name || m.sender_name || 'User';
    const content = (m.content || '').slice(0, 200);
    return `${name}: ${content}`;
  }).join('\n');

  // Generate summary locally (no API call — template-based for reliability)
  const participantList = Array.from(participants);
  const msgCount = messages.length;
  const timeRange = messages.length >= 2
    ? `${new Date(messages[0].created_at).toLocaleTimeString()} – ${new Date(messages[messages.length - 1].created_at).toLocaleTimeString()}`
    : '';

  const summary = [
    `**Table Discussion Summary** — ${table.room_name || table.room_type}`,
    `**Participants:** ${participantList.join(', ') || 'Unknown'}`,
    `**Messages:** ${msgCount} messages${timeRange ? ` (${timeRange})` : ''}`,
    '',
    `**Context:** ${participantList.length} agent${participantList.length !== 1 ? 's' : ''} discussed at the ${table.type || 'table'} table in ${table.room_name || table.room_type}.`,
  ].join('\n');

  // Store as session note for the first participant
  const firstAgent = messages.find(m => m.sender_id && m.sender_id !== '__user__')?.sender_id;
  if (firstAgent) {
    const noteKey = `table-summary-${tableId}-${Date.now()}`;
    writeNote(firstAgent, noteKey, summary, table.building_id);
  }

  // Emit activity event
  bus.emit('table:summary-generated', {
    tableId,
    buildingId: table.building_id,
    roomName: table.room_name,
    participants: participantList,
    messageCount: msgCount,
    summary,
  });

  // Log to activity
  const activityId = `act_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  db.prepare(`
    INSERT INTO agent_activity_log (id, agent_id, event_type, event_data, building_id, room_id, created_at)
    VALUES (?, ?, 'table:summary', ?, ?, NULL, datetime('now'))
  `).run(activityId, firstAgent || '__system__', JSON.stringify({
    tableId,
    participants: participantList,
    messageCount: msgCount,
  }), table.building_id);

  log.info({ tableId, participants: participantList, msgCount }, 'Conversation summary generated');
}

/**
 * Clean up all timers (call on server shutdown).
 */
export function stopAllSummaryTimers(): void {
  for (const [, disc] of activeDiscussions) {
    if (disc.timer) clearTimeout(disc.timer);
  }
  activeDiscussions.clear();
}
