/**
 * Documentation Library (#811, #814)
 *
 * Indexes project documentation for agent access. Agents can search
 * and retrieve documents without scanning the filesystem linearly.
 *
 * #814 additions: FTS5 ranked search, TOC extraction, AI-generated
 * summaries, library manifests, smart context injection helpers.
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
  const rows = db.prepare(sql).all(...params) as Array<Record<string, unknown>>;

  // Enrich with file counts (#865)
  const countSql = 'SELECT library_id, COUNT(*) as file_count FROM doc_entries GROUP BY library_id';
  const counts = db.prepare(countSql).all() as Array<{ library_id: string; file_count: number }>;
  const countMap = new Map(counts.map(r => [r.library_id, r.file_count]));
  for (const row of rows) {
    row.file_count = countMap.get(row.id as string) || 0;
  }

  return ok(rows);
}

export function deleteLibrary(libraryId: string): Result {
  const db = getDb();
  // FTS5 content-sync: delete from FTS before doc_entries
  const ftsDelete = db.prepare("INSERT INTO doc_entries_fts(doc_entries_fts, rowid, title, summary, tags, file_path) VALUES('delete', ?, ?, ?, ?, ?)");
  const entryRows = db.prepare('SELECT rowid, title, summary, tags, file_path FROM doc_entries WHERE library_id = ?').all(libraryId) as Array<{ rowid: number; title: string; summary: string; tags: string; file_path: string }>;
  for (const row of entryRows) {
    try { ftsDelete.run(row.rowid, row.title || '', row.summary || '', row.tags || '', row.file_path); } catch { /* FTS sync best-effort */ }
  }
  db.prepare('DELETE FROM doc_toc WHERE entry_id IN (SELECT id FROM doc_entries WHERE library_id = ?)').run(libraryId);
  db.prepare('DELETE FROM doc_entries WHERE library_id = ?').run(libraryId);
  db.prepare('DELETE FROM doc_libraries WHERE id = ?').run(libraryId);
  return ok({ deleted: true });
}

// ── TOC Extraction (#814) ──

export interface TocEntry {
  level: number;
  title: string;
  lineNumber: number;
}

/** Extract table of contents from markdown headings */
export function extractToc(content: string): TocEntry[] {
  const toc: TocEntry[] = [];
  const lines = content.split('\n');
  let inCodeBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim().startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) continue;

    const match = line.match(/^(#{1,6})\s+(.+)$/);
    if (match) {
      toc.push({
        level: match[1].length,
        title: match[2].trim().replace(/\s*#+\s*$/, ''), // Remove trailing hashes
        lineNumber: i + 1,
      });
    }
  }
  return toc;
}

/** Store TOC entries in the database */
function _storeToc(entryId: string, toc: TocEntry[]): void {
  const db = getDb();
  db.prepare('DELETE FROM doc_toc WHERE entry_id = ?').run(entryId);

  if (toc.length === 0) return;
  const insert = db.prepare('INSERT INTO doc_toc (entry_id, level, title, line_number) VALUES (?, ?, ?, ?)');
  for (const entry of toc) {
    insert.run(entryId, entry.level, entry.title, entry.lineNumber);
  }
}

/** Get TOC for a document */
export function getDocumentToc(entryId: string): Result {
  const db = getDb();
  const toc = db.prepare(
    'SELECT level, title, line_number as lineNumber FROM doc_toc WHERE entry_id = ? ORDER BY line_number',
  ).all(entryId);
  return ok(toc);
}

// ── FTS5 Sync (#814) ──

/** Sync a doc entry to the FTS5 index */
function _syncFts(
  entryId: string, title: string, summary: string, tags: string, filePath: string,
  oldValues?: { title: string; summary: string; tags: string; filePath: string },
): void {
  const db = getDb();
  try {
    const row = db.prepare('SELECT rowid FROM doc_entries WHERE id = ?').get(entryId) as { rowid: number } | undefined;
    if (!row) return;

    if (oldValues) {
      // FTS5 content-sync delete requires the OLD values that are currently in the index
      db.prepare("INSERT INTO doc_entries_fts(doc_entries_fts, rowid, title, summary, tags, file_path) VALUES('delete', ?, ?, ?, ?, ?)").run(
        row.rowid, oldValues.title || '', oldValues.summary || '', oldValues.tags || '', oldValues.filePath,
      );
    }
    db.prepare('INSERT INTO doc_entries_fts(rowid, title, summary, tags, file_path) VALUES(?, ?, ?, ?, ?)').run(
      row.rowid, title, summary, tags, filePath,
    );
  } catch (e) {
    log.warn({ entryId, err: e instanceof Error ? e.message : String(e) }, 'FTS5 sync failed');
  }
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
      const tagsJson = JSON.stringify(tags);
      const id = existing?.id || `doc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

      if (existing) {
        // Fetch old values BEFORE update for FTS5 content-sync delete
        const oldRow = db.prepare('SELECT title, summary, tags, file_path FROM doc_entries WHERE id = ?').get(id) as {
          title: string; summary: string; tags: string; file_path: string;
        } | undefined;
        db.prepare(`
          UPDATE doc_entries SET title = ?, summary = ?, format = ?, content_hash = ?,
            word_count = ?, tags = ?, indexed_at = datetime('now'), updated_at = datetime('now')
          WHERE id = ?
        `).run(title, summary, format, hash, wordCount, tagsJson, id);
        _syncFts(id, title, summary, tagsJson, relPath, oldRow ? {
          title: oldRow.title, summary: oldRow.summary, tags: oldRow.tags, filePath: oldRow.file_path,
        } : undefined);
      } else {
        db.prepare(`
          INSERT INTO doc_entries (id, library_id, file_path, title, summary, format, content_hash, word_count, tags, indexed_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        `).run(id, libraryId, relPath, title, summary, format, hash, wordCount, tagsJson);
        _syncFts(id, title, summary, tagsJson, relPath);
      }

      // Extract and store TOC for markdown files (#814)
      if (format === 'markdown') {
        const toc = extractToc(content);
        _storeToc(id, toc);
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

/** Search documents using FTS5 ranked search (#814) */
export function searchDocuments(params: {
  query: string;
  buildingId?: string;
  libraryId?: string;
  limit?: number;
}): Result {
  if (!params.query || !params.query.trim()) return ok([]);

  const db = getDb();
  const limit = params.limit || 20;

  // Try FTS5 first for ranked results
  try {
    let ftsSQL = `
      SELECT e.*, l.name AS library_name, l.doc_root_path,
             rank AS relevance_score
      FROM doc_entries_fts fts
      JOIN doc_entries e ON e.rowid = fts.rowid
      JOIN doc_libraries l ON l.id = e.library_id
      WHERE doc_entries_fts MATCH ?
    `;
    const queryParams: unknown[] = [params.query];

    if (params.libraryId) {
      ftsSQL += ' AND e.library_id = ?';
      queryParams.push(params.libraryId);
    } else if (params.buildingId) {
      ftsSQL += ' AND (l.building_id = ? OR l.building_id IS NULL)';
      queryParams.push(params.buildingId);
    }

    ftsSQL += ' ORDER BY rank LIMIT ?';
    queryParams.push(limit);

    const results = db.prepare(ftsSQL).all(...queryParams);
    return ok(results);
  } catch {
    // Fall back to LIKE search if FTS5 query syntax is invalid
    return _fallbackSearch(params, limit);
  }
}

/** Fallback LIKE search when FTS5 query fails */
function _fallbackSearch(params: { query: string; buildingId?: string; libraryId?: string }, limit: number): Result {
  const db = getDb();
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

    // Include TOC if available (#814)
    const toc = db.prepare(
      'SELECT level, title, line_number as lineNumber FROM doc_toc WHERE entry_id = ? ORDER BY line_number',
    ).all(entryId) as TocEntry[];

    return ok({
      ...entry,
      content,
      tags: JSON.parse(entry.tags || '[]'),
      toc,
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

// ── Library Manifest (#814) ──

export interface LibraryManifest {
  libraryId: string;
  name: string;
  description: string | null;
  documentCount: number;
  totalWords: number;
  lastIndexed: string | null;
  topTopics: string[];
  documents: ManifestDocument[];
}

export interface ManifestDocument {
  id: string;
  path: string;
  title: string;
  summary: string;
  format: string;
  wordCount: number;
  tags: string[];
  toc: TocEntry[];
}

/** Generate a library manifest for agent consumption (#814) */
export function generateManifest(libraryId: string): Result<LibraryManifest> {
  const db = getDb();
  const lib = db.prepare('SELECT * FROM doc_libraries WHERE id = ?').get(libraryId) as {
    id: string; name: string; description: string | null;
  } | undefined;

  if (!lib) return err('LIBRARY_NOT_FOUND', 'Library does not exist');

  const docs = db.prepare(`
    SELECT id, file_path, title, summary, format, word_count, tags, indexed_at
    FROM doc_entries WHERE library_id = ? ORDER BY file_path
  `).all(libraryId) as Array<{
    id: string; file_path: string; title: string; summary: string;
    format: string; word_count: number; tags: string; indexed_at: string;
  }>;

  // Aggregate topic tags
  const tagCounts = new Map<string, number>();
  let totalWords = 0;
  let lastIndexed: string | null = null;

  const manifestDocs: ManifestDocument[] = docs.map(doc => {
    totalWords += doc.word_count;
    if (!lastIndexed || doc.indexed_at > lastIndexed) lastIndexed = doc.indexed_at;

    const tags = JSON.parse(doc.tags || '[]') as string[];
    for (const tag of tags) {
      tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
    }

    const toc = db.prepare(
      'SELECT level, title, line_number as lineNumber FROM doc_toc WHERE entry_id = ? ORDER BY line_number',
    ).all(doc.id) as TocEntry[];

    return {
      id: doc.id,
      path: doc.file_path,
      title: doc.title,
      summary: doc.summary,
      format: doc.format,
      wordCount: doc.word_count,
      tags,
      toc,
    };
  });

  // Top topics sorted by frequency
  const topTopics = [...tagCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([tag]) => tag);

  const manifest: LibraryManifest = {
    libraryId: lib.id,
    name: lib.name,
    description: lib.description,
    documentCount: docs.length,
    totalWords,
    lastIndexed,
    topTopics,
    documents: manifestDocs,
  };

  return ok(manifest);
}

// ── Smart Context Injection (#814) ──

export interface RelevantDoc {
  id: string;
  title: string;
  summary: string;
  path: string;
  relevanceScore: number;
  tags: string[];
}

/**
 * Find documents relevant to a task description.
 * Uses FTS5 ranked search with fallback to keyword matching.
 */
export function findRelevantDocs(params: {
  taskDescription: string;
  buildingId?: string;
  limit?: number;
}): Result<RelevantDoc[]> {
  const db = getDb();
  const limit = params.limit || 5;

  // Extract keywords from task description for FTS5 query
  const keywords = _extractKeywords(params.taskDescription);
  if (keywords.length === 0) return ok([]);

  // Build FTS5 query: OR-join keywords for broad matching
  const ftsQuery = keywords.join(' OR ');

  try {
    let sql = `
      SELECT e.id, e.title, e.summary, e.file_path AS path, e.tags,
             rank AS relevanceScore
      FROM doc_entries_fts fts
      JOIN doc_entries e ON e.rowid = fts.rowid
      JOIN doc_libraries l ON l.id = e.library_id
      WHERE doc_entries_fts MATCH ?
    `;
    const queryParams: unknown[] = [ftsQuery];

    if (params.buildingId) {
      sql += ' AND (l.building_id = ? OR l.building_id IS NULL)';
      queryParams.push(params.buildingId);
    }

    sql += ' ORDER BY rank LIMIT ?';
    queryParams.push(limit);

    const results = db.prepare(sql).all(...queryParams) as Array<{
      id: string; title: string; summary: string; path: string; tags: string; relevanceScore: number;
    }>;

    return ok(results.map(r => ({
      ...r,
      tags: JSON.parse(r.tags || '[]'),
    })));
  } catch {
    // FTS5 not available or query malformed
    return ok([]);
  }
}

/** Extract meaningful keywords from a task description */
function _extractKeywords(text: string): string[] {
  const stopWords = new Set([
    'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
    'should', 'may', 'might', 'shall', 'can', 'to', 'of', 'in', 'for',
    'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during',
    'before', 'after', 'above', 'below', 'between', 'and', 'but', 'or',
    'not', 'no', 'nor', 'so', 'yet', 'both', 'either', 'neither', 'each',
    'every', 'all', 'any', 'few', 'more', 'most', 'other', 'some', 'such',
    'than', 'too', 'very', 'just', 'about', 'up', 'out', 'if', 'then',
    'that', 'this', 'these', 'those', 'what', 'which', 'who', 'whom',
    'how', 'when', 'where', 'why', 'it', 'its', 'my', 'your', 'his',
    'her', 'their', 'our', 'me', 'him', 'them', 'us', 'i', 'you', 'he',
    'she', 'we', 'they',
  ]);

  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s_-]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !stopWords.has(w))
    .slice(0, 10); // Max 10 keywords
}

/**
 * Build smart context injection text for agent system prompts (#814).
 * Returns a markdown section with library overviews and relevant doc suggestions.
 */
export function buildDocContextInjection(params: {
  buildingId: string;
  taskDescription?: string;
}): string {
  const db = getDb();
  const sections: string[] = [];

  try {
    const libs = db.prepare(
      'SELECT id, name, description FROM doc_libraries WHERE building_id = ? OR building_id IS NULL',
    ).all(params.buildingId) as Array<{ id: string; name: string; description: string | null }>;

    if (libs.length === 0) return '';

    sections.push('## Documentation Libraries');
    sections.push('You have access to project documentation. Use `search_library` to find information and `get_document` to read full documents.');
    sections.push('');

    // Level 1: Library overviews (always injected)
    for (const lib of libs) {
      const stats = db.prepare(`
        SELECT COUNT(*) as cnt, SUM(word_count) as words
        FROM doc_entries WHERE library_id = ?
      `).get(lib.id) as { cnt: number; words: number | null };

      const topTags = db.prepare(`
        SELECT tags FROM doc_entries WHERE library_id = ? AND tags != '[]' LIMIT 20
      `).all(lib.id) as Array<{ tags: string }>;

      // Aggregate top topics
      const tagCounts = new Map<string, number>();
      for (const row of topTags) {
        for (const tag of JSON.parse(row.tags || '[]') as string[]) {
          tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
        }
      }
      const topics = [...tagCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([t]) => t)
        .join(', ');

      sections.push(`- **${lib.name}** (${stats.cnt} docs) — ${lib.description || topics || 'Project documentation'}`);
    }

    // Level 2: Relevant docs (injected when task matches)
    if (params.taskDescription) {
      const relevantResult = findRelevantDocs({
        taskDescription: params.taskDescription,
        buildingId: params.buildingId,
        limit: 5,
      });

      if (relevantResult.ok && relevantResult.data.length > 0) {
        sections.push('');
        sections.push('### Relevant to Current Task');
        sections.push('Based on the current task, these documents may be helpful:');
        for (const doc of relevantResult.data) {
          sections.push(`- **${doc.title}** (\`${doc.path}\`) — ${doc.summary || 'No summary'}`);
          sections.push(`  Use \`get_document("${doc.id}")\` to read the full content.`);
        }
      }
    }

    sections.push('');
    sections.push('When you need to understand project architecture, API specs, or implementation details, search the library first before reading raw source files.');
  } catch (e) {
    log.warn({ err: e instanceof Error ? e.message : String(e) }, 'Failed to build doc context injection');
  }

  return sections.join('\n');
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
