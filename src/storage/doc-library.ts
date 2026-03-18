/**
 * Documentation Library (#811)
 *
 * Indexes project documentation for agent access. Agents can search
 * and retrieve documents without scanning the filesystem linearly.
 *
 * Layer: Storage (depends on Core)
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { join, extname, relative } from 'path';
import { createHash } from 'crypto';
import { logger } from '../core/logger.js';
import { ok, err } from '../core/contracts.js';
import type { Result } from '../core/contracts.js';
import { getDb } from './db.js';

const log = logger.child({ module: 'doc-library' });

const SUPPORTED_EXTENSIONS = new Set([
  '.md', '.txt', '.rst', '.adoc',       // Docs
  '.ts', '.js', '.py', '.rs', '.go',    // Code
  '.cpp', '.c', '.h', '.hpp',           // C/C++
  '.json', '.yaml', '.yml', '.toml',    // Config
  '.sh', '.bash', '.zsh',               // Scripts
  '.css', '.html', '.xml', '.svg',      // Web
  '.lua',                                // Scripting
]);

const MAX_FILE_SIZE = 1024 * 1024; // 1MB max per file

// ── Library CRUD ──

export function createLibrary(params: {
  buildingId?: string;
  name: string;
  description?: string;
  docRootPath: string;
}): Result {
  if (!existsSync(params.docRootPath)) {
    return err('PATH_NOT_FOUND', `Directory does not exist: ${params.docRootPath}`);
  }

  const db = getDb();
  const id = `lib_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  db.prepare(`
    INSERT INTO doc_libraries (id, building_id, name, description, doc_root_path)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, params.buildingId || null, params.name, params.description || null, params.docRootPath);

  log.info({ id, name: params.name, path: params.docRootPath }, 'Documentation library created');
  return ok({ id, name: params.name });
}

export function listLibraries(buildingId?: string): Result {
  const db = getDb();
  let sql = 'SELECT * FROM doc_libraries WHERE 1=1';
  const params: unknown[] = [];

  if (buildingId) {
    // Return building-specific + global libraries
    sql += ' AND (building_id = ? OR building_id IS NULL)';
    params.push(buildingId);
  }

  sql += ' ORDER BY name';
  const rows = db.prepare(sql).all(...params);
  return ok(rows);
}

export function deleteLibrary(libraryId: string): Result {
  const db = getDb();
  db.prepare('DELETE FROM doc_entries WHERE library_id = ?').run(libraryId);
  db.prepare('DELETE FROM doc_libraries WHERE id = ?').run(libraryId);
  return ok({ deleted: true });
}

// ── Indexing ──

/** Index all files in a library's root path */
export function indexLibrary(libraryId: string): Result {
  const db = getDb();
  const lib = db.prepare('SELECT * FROM doc_libraries WHERE id = ?').get(libraryId) as {
    id: string; doc_root_path: string; name: string;
  } | undefined;

  if (!lib) return err('LIBRARY_NOT_FOUND', 'Library does not exist');
  if (!existsSync(lib.doc_root_path)) return err('PATH_NOT_FOUND', `Directory missing: ${lib.doc_root_path}`);

  const files = _scanDirectory(lib.doc_root_path);
  let indexed = 0;
  let skipped = 0;

  for (const filePath of files) {
    const relPath = relative(lib.doc_root_path, filePath);
    const ext = extname(filePath).toLowerCase();
    const stat = statSync(filePath);

    if (stat.size > MAX_FILE_SIZE) { skipped++; continue; }
    if (!SUPPORTED_EXTENSIONS.has(ext)) { skipped++; continue; }

    try {
      const content = readFileSync(filePath, 'utf-8');
      const hash = createHash('sha256').update(content).digest('hex');

      // Check if already indexed with same hash
      const existing = db.prepare(
        'SELECT id, content_hash FROM doc_entries WHERE library_id = ? AND file_path = ?',
      ).get(libraryId, relPath) as { id: string; content_hash: string } | undefined;

      if (existing && existing.content_hash === hash) {
        skipped++;
        continue; // Unchanged
      }

      const title = _extractTitle(content, relPath);
      const summary = _extractSummary(content);
      const wordCount = content.split(/\s+/).length;
      const format = _detectFormat(ext);
      const tags = _extractTags(content, relPath);
      const id = existing?.id || `doc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

      if (existing) {
        db.prepare(`
          UPDATE doc_entries SET title = ?, summary = ?, format = ?, content_hash = ?,
            word_count = ?, tags = ?, indexed_at = datetime('now'), updated_at = datetime('now')
          WHERE id = ?
        `).run(title, summary, format, hash, wordCount, JSON.stringify(tags), id);
      } else {
        db.prepare(`
          INSERT INTO doc_entries (id, library_id, file_path, title, summary, format, content_hash, word_count, tags, indexed_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        `).run(id, libraryId, relPath, title, summary, format, hash, wordCount, JSON.stringify(tags));
      }
      indexed++;
    } catch (e) {
      log.warn({ filePath, err: e instanceof Error ? e.message : String(e) }, 'Failed to index file');
      skipped++;
    }
  }

  log.info({ libraryId, name: lib.name, indexed, skipped, total: files.length }, 'Library indexed');
  return ok({ indexed, skipped, total: files.length });
}

// ── Search ──

/** Search documents by text query across accessible libraries */
export function searchDocuments(params: {
  query: string;
  buildingId?: string;
  libraryId?: string;
  limit?: number;
}): Result {
  const db = getDb();
  const limit = params.limit || 20;

  let sql = `
    SELECT e.*, l.name AS library_name, l.doc_root_path
    FROM doc_entries e
    JOIN doc_libraries l ON l.id = e.library_id
    WHERE 1=1
  `;
  const queryParams: unknown[] = [];

  if (params.libraryId) {
    sql += ' AND e.library_id = ?';
    queryParams.push(params.libraryId);
  } else if (params.buildingId) {
    sql += ' AND (l.building_id = ? OR l.building_id IS NULL)';
    queryParams.push(params.buildingId);
  }

  // Simple LIKE search (FTS5 can be added later for performance)
  sql += ' AND (e.title LIKE ? OR e.summary LIKE ? OR e.file_path LIKE ? OR e.tags LIKE ?)';
  const pattern = `%${params.query}%`;
  queryParams.push(pattern, pattern, pattern, pattern);

  sql += ' ORDER BY e.indexed_at DESC LIMIT ?';
  queryParams.push(limit);

  const results = db.prepare(sql).all(...queryParams);
  return ok(results);
}

/** Get a document's full content by reading from disk */
export function getDocumentContent(entryId: string): Result {
  const db = getDb();
  const entry = db.prepare(`
    SELECT e.*, l.doc_root_path FROM doc_entries e
    JOIN doc_libraries l ON l.id = e.library_id
    WHERE e.id = ?
  `).get(entryId) as { file_path: string; doc_root_path: string; title: string; summary: string; tags: string } | undefined;

  if (!entry) return err('DOC_NOT_FOUND', 'Document entry not found');

  const fullPath = join(entry.doc_root_path, entry.file_path);
  if (!existsSync(fullPath)) return err('FILE_MISSING', `File not found: ${fullPath}`);

  try {
    const content = readFileSync(fullPath, 'utf-8');
    return ok({
      ...entry,
      content,
      tags: JSON.parse(entry.tags || '[]'),
    });
  } catch (e) {
    return err('READ_ERROR', `Failed to read file: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** List documents in a library */
export function listDocuments(libraryId: string): Result {
  const db = getDb();
  const docs = db.prepare(
    'SELECT id, file_path, title, summary, format, word_count, tags, indexed_at FROM doc_entries WHERE library_id = ? ORDER BY file_path',
  ).all(libraryId);
  return ok(docs);
}

// ── Helpers ──

function _scanDirectory(dir: string, maxDepth = 5): string[] {
  const files: string[] = [];
  const _scan = (d: string, depth: number) => {
    if (depth > maxDepth) return;
    try {
      for (const entry of readdirSync(d, { withFileTypes: true })) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'build') continue;
        const full = join(d, entry.name);
        if (entry.isDirectory()) _scan(full, depth + 1);
        else if (entry.isFile()) files.push(full);
      }
    } catch { /* permission denied, etc */ }
  };
  _scan(dir, 0);
  return files;
}

function _extractTitle(content: string, filePath: string): string {
  // Try first heading
  const h1 = content.match(/^#\s+(.+)$/m);
  if (h1) return h1[1].trim();
  // Try first line
  const firstLine = content.split('\n')[0]?.trim();
  if (firstLine && firstLine.length > 3 && firstLine.length < 120) return firstLine;
  // Fall back to filename
  return filePath.split('/').pop()?.replace(/\.[^.]+$/, '') || filePath;
}

function _extractSummary(content: string): string {
  // First non-heading paragraph
  const lines = content.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('```') || trimmed.startsWith('---')) continue;
    if (trimmed.length > 20) {
      return trimmed.length > 200 ? trimmed.slice(0, 197) + '...' : trimmed;
    }
  }
  return '';
}

function _detectFormat(ext: string): string {
  const map: Record<string, string> = {
    '.md': 'markdown', '.txt': 'text', '.rst': 'restructured-text',
    '.ts': 'typescript', '.js': 'javascript', '.py': 'python',
    '.rs': 'rust', '.go': 'go', '.cpp': 'cpp', '.c': 'c',
    '.h': 'c-header', '.hpp': 'cpp-header',
    '.json': 'json', '.yaml': 'yaml', '.yml': 'yaml', '.toml': 'toml',
    '.css': 'css', '.html': 'html', '.lua': 'lua',
    '.sh': 'shell', '.bash': 'shell', '.zsh': 'shell',
  };
  return map[ext] || 'text';
}

function _extractTags(content: string, filePath: string): string[] {
  const tags: Set<string> = new Set();
  // From file path
  const parts = filePath.split('/');
  if (parts.length > 1) tags.add(parts[0]); // top directory
  // From extension
  const ext = extname(filePath).slice(1);
  if (ext) tags.add(ext);
  // From content keywords
  const keywords = ['TODO', 'FIXME', 'API', 'README', 'CHANGELOG', 'LICENSE', 'test', 'spec', 'config'];
  for (const kw of keywords) {
    if (content.includes(kw)) tags.add(kw.toLowerCase());
  }
  return [...tags].slice(0, 10);
}
