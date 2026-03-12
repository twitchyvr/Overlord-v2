/**
 * Cross-Room Citation Tracker
 *
 * Tracks references between rooms — when an agent in one room cites
 * a message, RAID entry, exit document, or room from another room.
 * Enables bidirectional navigation: "what cited this?" and "what does this cite?"
 *
 * Storage: SQLite `citations` table with foreign keys to rooms.
 * All operations use the Result<T> envelope pattern.
 */

import { getDb } from '../storage/db.js';
import { logger } from '../core/logger.js';
import { ok, err } from '../core/contracts.js';
import type { Result } from '../core/contracts.js';

const log = logger.child({ module: 'citation-tracker' });

// ─── Types ───

export type CitationTargetType = 'message' | 'raid' | 'exit-doc' | 'room';

export interface Citation {
  id: string;
  sourceRoomId: string;
  sourceMessageId: string | null;
  targetRoomId: string;
  targetEntryId: string | null;
  targetType: CitationTargetType;
  createdBy: string;
  createdAt: string;
}

export interface ResolvedCitation extends Citation {
  sourceRoomName: string | null;
  targetRoomName: string | null;
  targetContent: Record<string, unknown> | null;
}

interface CitationRow {
  id: string;
  source_room_id: string;
  source_message_id: string | null;
  target_room_id: string;
  target_entry_id: string | null;
  target_type: string;
  created_by: string;
  created_at: string;
}

interface AddCitationParams {
  sourceRoomId: string;
  sourceMessageId?: string;
  targetRoomId: string;
  targetEntryId?: string;
  targetType: CitationTargetType;
  createdBy: string;
}

// ─── Helpers ───

const VALID_TARGET_TYPES: CitationTargetType[] = ['message', 'raid', 'exit-doc', 'room'];

function rowToCitation(row: CitationRow): Citation {
  return {
    id: row.id,
    sourceRoomId: row.source_room_id,
    sourceMessageId: row.source_message_id,
    targetRoomId: row.target_room_id,
    targetEntryId: row.target_entry_id,
    targetType: row.target_type as CitationTargetType,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

// ─── Public API ───

/**
 * Add a citation linking a source room/message to a target room/entry.
 */
export function addCitation({
  sourceRoomId,
  sourceMessageId,
  targetRoomId,
  targetEntryId,
  targetType,
  createdBy,
}: AddCitationParams): Result<Citation> {
  if (!VALID_TARGET_TYPES.includes(targetType)) {
    return err('INVALID_TARGET_TYPE', `targetType must be one of: ${VALID_TARGET_TYPES.join(', ')}`);
  }

  if (!sourceRoomId || !targetRoomId) {
    return err('MISSING_ROOM_ID', 'Both sourceRoomId and targetRoomId are required');
  }

  if (!createdBy) {
    return err('MISSING_CREATED_BY', 'createdBy (agent ID) is required');
  }

  const db = getDb();

  // Verify source room exists
  const sourceRoom = db.prepare('SELECT id FROM rooms WHERE id = ?').get(sourceRoomId);
  if (!sourceRoom) {
    return err('ROOM_NOT_FOUND', `Source room ${sourceRoomId} does not exist`);
  }

  // Verify target room exists
  const targetRoom = db.prepare('SELECT id FROM rooms WHERE id = ?').get(targetRoomId);
  if (!targetRoom) {
    return err('ROOM_NOT_FOUND', `Target room ${targetRoomId} does not exist`);
  }

  const id = `cit_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  db.prepare(`
    INSERT INTO citations (id, source_room_id, source_message_id, target_room_id, target_entry_id, target_type, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    sourceRoomId,
    sourceMessageId || null,
    targetRoomId,
    targetEntryId || null,
    targetType,
    createdBy,
  );

  const citation: Citation = {
    id,
    sourceRoomId,
    sourceMessageId: sourceMessageId || null,
    targetRoomId,
    targetEntryId: targetEntryId || null,
    targetType,
    createdBy,
    createdAt: new Date().toISOString(),
  };

  log.info(
    { id, sourceRoomId, targetRoomId, targetType, createdBy },
    'Citation added',
  );

  return ok(citation);
}

/**
 * Get all citations from or to a given room.
 * Returns citations where the room is either the source or the target.
 */
export function getCitations(roomId: string): Result<Citation[]> {
  if (!roomId) {
    return err('MISSING_ROOM_ID', 'roomId is required');
  }

  const db = getDb();
  const rows = db.prepare(`
    SELECT * FROM citations
    WHERE source_room_id = ? OR target_room_id = ?
    ORDER BY created_at DESC
  `).all(roomId, roomId) as CitationRow[];

  return ok(rows.map(rowToCitation));
}

/**
 * Get backlinks — citations that point TO a specific room or entry.
 * Reverse lookup: "who cited this room/entry?"
 */
export function getBacklinks(roomId: string, entryId?: string): Result<Citation[]> {
  if (!roomId) {
    return err('MISSING_ROOM_ID', 'roomId is required');
  }

  const db = getDb();
  let sql = 'SELECT * FROM citations WHERE target_room_id = ?';
  const params: string[] = [roomId];

  if (entryId) {
    sql += ' AND target_entry_id = ?';
    params.push(entryId);
  }

  sql += ' ORDER BY created_at DESC';

  const rows = db.prepare(sql).all(...params) as CitationRow[];
  return ok(rows.map(rowToCitation));
}

/**
 * Resolve a citation — fetch the citation record plus the cited content.
 * Looks up room names and, where possible, the target content itself.
 */
export function resolveCitation(citationId: string): Result<ResolvedCitation> {
  if (!citationId) {
    return err('MISSING_CITATION_ID', 'citationId is required');
  }

  const db = getDb();
  const row = db.prepare('SELECT * FROM citations WHERE id = ?').get(citationId) as CitationRow | undefined;

  if (!row) {
    return err('CITATION_NOT_FOUND', `Citation ${citationId} does not exist`);
  }

  const citation = rowToCitation(row);

  // Look up room names
  const sourceRoom = db.prepare('SELECT name FROM rooms WHERE id = ?').get(citation.sourceRoomId) as { name: string } | undefined;
  const targetRoom = db.prepare('SELECT name FROM rooms WHERE id = ?').get(citation.targetRoomId) as { name: string } | undefined;

  // Attempt to resolve target content based on type
  let targetContent: Record<string, unknown> | null = null;

  if (citation.targetEntryId) {
    switch (citation.targetType) {
      case 'message': {
        const msg = db.prepare('SELECT * FROM messages WHERE id = ?').get(citation.targetEntryId) as Record<string, unknown> | undefined;
        if (msg) targetContent = msg;
        break;
      }
      case 'raid': {
        const raid = db.prepare('SELECT * FROM raid_entries WHERE id = ?').get(citation.targetEntryId) as Record<string, unknown> | undefined;
        if (raid) targetContent = raid;
        break;
      }
      case 'exit-doc': {
        const exitDoc = db.prepare('SELECT * FROM exit_documents WHERE id = ?').get(citation.targetEntryId) as Record<string, unknown> | undefined;
        if (exitDoc) targetContent = exitDoc;
        break;
      }
      case 'room': {
        const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(citation.targetEntryId) as Record<string, unknown> | undefined;
        if (room) targetContent = room;
        break;
      }
    }
  } else if (citation.targetType === 'room') {
    // If no entry ID but type is 'room', resolve the target room itself
    const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(citation.targetRoomId) as Record<string, unknown> | undefined;
    if (room) targetContent = room;
  }

  const resolved: ResolvedCitation = {
    ...citation,
    sourceRoomName: sourceRoom?.name || null,
    targetRoomName: targetRoom?.name || null,
    targetContent,
  };

  log.debug({ citationId, targetType: citation.targetType }, 'Citation resolved');
  return ok(resolved);
}

/**
 * Get all outgoing citations from a room (citations this room created).
 */
export function getOutgoingCitations(roomId: string): Result<Citation[]> {
  if (!roomId) {
    return err('MISSING_ROOM_ID', 'roomId is required');
  }

  const db = getDb();
  const rows = db.prepare(`
    SELECT * FROM citations
    WHERE source_room_id = ?
    ORDER BY created_at DESC
  `).all(roomId) as CitationRow[];

  return ok(rows.map(rowToCitation));
}

/**
 * Delete a citation by ID.
 */
export function deleteCitation(citationId: string): Result<{ id: string }> {
  if (!citationId) {
    return err('MISSING_CITATION_ID', 'citationId is required');
  }

  const db = getDb();
  const existing = db.prepare('SELECT id FROM citations WHERE id = ?').get(citationId);
  if (!existing) {
    return err('CITATION_NOT_FOUND', `Citation ${citationId} does not exist`);
  }

  db.prepare('DELETE FROM citations WHERE id = ?').run(citationId);
  log.info({ citationId }, 'Citation deleted');
  return ok({ id: citationId });
}
