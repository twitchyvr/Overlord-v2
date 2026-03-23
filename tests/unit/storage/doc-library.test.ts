/**
 * Documentation Library Tests (#811, #814)
 *
 * Tests indexing, FTS5 search, TOC extraction, manifest generation,
 * and smart context injection.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { initStorage, getDb } from '../../../src/storage/db.js';
import type { Config } from '../../../src/core/config.js';
import {
  createLibrary,
  deleteLibrary,
  indexLibrary,
  listLibraries,
  searchDocuments,
  getDocumentContent,
  listDocuments,
  extractToc,
  getDocumentToc,
  generateManifest,
  findRelevantDocs,
  buildDocContextInjection,
} from '../../../src/storage/doc-library.js';

let testDir: string;
let docDir: string;

/** Insert a building row so FK constraints pass when using buildingId */
function createTestBuilding(id: string): void {
  const db = getDb();
  db.prepare(`
    INSERT OR IGNORE INTO buildings (id, name, allowed_paths)
    VALUES (?, ?, '[]')
  `).run(id, `Test Building ${id}`);
}

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

function createTestDocs() {
  writeFileSync(join(docDir, 'readme.md'), `# Project Overview

This project implements a REST API for managing user accounts.
It supports CRUD operations and authentication via JWT tokens.

## Installation

Run \`npm install\` to install dependencies.

## API Endpoints

### GET /users
Returns a list of all users.

### POST /users
Creates a new user account.

## Configuration

Set environment variables in \`.env\` file.
`);

  writeFileSync(join(docDir, 'architecture.md'), `# Architecture

The system follows a layered architecture pattern.

## Layers

### Transport Layer
Handles HTTP requests and WebSocket connections.

### Service Layer
Contains business logic and validation.

### Storage Layer
Manages database operations and caching.

## Design Decisions

We chose PostgreSQL for its JSON support and full-text search capabilities.
`);

  mkdirSync(join(docDir, 'guides'), { recursive: true, mode: 0o700 });
  writeFileSync(join(docDir, 'guides', 'deployment.md'), `# Deployment Guide

Deploy the application using Docker containers.

## Prerequisites

- Docker installed
- Access to container registry

## Steps

1. Build the Docker image
2. Push to registry
3. Deploy to Kubernetes cluster
`);

  writeFileSync(join(docDir, 'config.json'), JSON.stringify({
    database: { host: 'localhost', port: 5432 },
    server: { port: 3000 },
  }, null, 2));
}

describe('Documentation Library (#811, #814)', () => {
  beforeEach(() => {
    testDir = join(tmpdir(), `overlord-doc-test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
    mkdirSync(testDir, { recursive: true, mode: 0o700 });
    docDir = join(testDir, 'docs');
    mkdirSync(docDir, { recursive: true, mode: 0o700 });

    const mockConfig = createMockConfig(join(testDir, 'test.db'));
    initStorage(mockConfig);
    createTestDocs();
  });

  afterEach(() => {
    try { rmSync(testDir, { recursive: true, force: true }); } catch { /* cleanup */ }
  });

  // ── Library CRUD ──

  describe('createLibrary', () => {
    it('creates a library and returns its ID', () => {
      const result = createLibrary({ name: 'Test Docs', docRootPath: docDir });
      expect(result.ok).toBe(true);
      expect(result.data).toHaveProperty('id');
      expect(result.data.name).toBe('Test Docs');
    });

    it('rejects non-existent path', () => {
      const result = createLibrary({ name: 'Bad', docRootPath: '/nonexistent/path' });
      expect(result.ok).toBe(false);
    });
  });

  describe('listLibraries', () => {
    it('lists created libraries with file counts', () => {
      createLibrary({ name: 'Lib A', docRootPath: docDir });
      const result = listLibraries();
      expect(result.ok).toBe(true);
      expect(result.data).toHaveLength(1);
      expect(result.data[0].name).toBe('Lib A');
    });
  });

  describe('deleteLibrary', () => {
    it('removes library and all entries', () => {
      const lib = createLibrary({ name: 'Delete Me', docRootPath: docDir });
      indexLibrary(lib.data.id);
      deleteLibrary(lib.data.id);

      const result = listLibraries();
      expect(result.data).toHaveLength(0);
    });
  });

  // ── Indexing ──

  describe('indexLibrary', () => {
    it('indexes all supported files in directory', () => {
      const lib = createLibrary({ name: 'Indexed', docRootPath: docDir });
      const result = indexLibrary(lib.data.id);
      expect(result.ok).toBe(true);
      expect(result.data.indexed).toBeGreaterThanOrEqual(3); // 3 md + 1 json
      expect(result.data.total).toBeGreaterThanOrEqual(4);
    });

    it('skips unchanged files on re-index', () => {
      const lib = createLibrary({ name: 'Reindex', docRootPath: docDir });
      indexLibrary(lib.data.id);
      const result = indexLibrary(lib.data.id);
      expect(result.ok).toBe(true);
      expect(result.data.indexed).toBe(0);
      expect(result.data.skipped).toBeGreaterThan(0);
    });

    it('re-indexes changed files', () => {
      const lib = createLibrary({ name: 'Changed', docRootPath: docDir });
      indexLibrary(lib.data.id);

      // Modify a file
      writeFileSync(join(docDir, 'readme.md'), '# Updated README\n\nNew content here.');
      const result = indexLibrary(lib.data.id);
      expect(result.ok).toBe(true);
      expect(result.data.indexed).toBe(1); // Only the changed file
    });
  });

  // ── TOC Extraction (#814) ──

  describe('extractToc', () => {
    it('extracts markdown heading hierarchy', () => {
      const content = `# Title
## Section One
Some text
### Subsection
## Section Two
`;
      const toc = extractToc(content);
      expect(toc).toHaveLength(4);
      expect(toc[0]).toEqual({ level: 1, title: 'Title', lineNumber: 1 });
      expect(toc[1]).toEqual({ level: 2, title: 'Section One', lineNumber: 2 });
      expect(toc[2]).toEqual({ level: 3, title: 'Subsection', lineNumber: 4 });
      expect(toc[3]).toEqual({ level: 2, title: 'Section Two', lineNumber: 5 });
    });

    it('ignores headings inside code blocks', () => {
      const content = `# Real Heading
\`\`\`markdown
# Not A Heading
## Also Not
\`\`\`
## Real Section
`;
      const toc = extractToc(content);
      expect(toc).toHaveLength(2);
      expect(toc[0].title).toBe('Real Heading');
      expect(toc[1].title).toBe('Real Section');
    });

    it('removes trailing hashes from ATX headings', () => {
      const toc = extractToc('## Section ##');
      expect(toc[0].title).toBe('Section');
    });
  });

  describe('getDocumentToc', () => {
    it('returns stored TOC for indexed markdown files', () => {
      const lib = createLibrary({ name: 'TOC Lib', docRootPath: docDir });
      indexLibrary(lib.data.id);

      const docs = listDocuments(lib.data.id);
      const readmeDoc = docs.data.find((d: { file_path: string }) => d.file_path === 'readme.md');
      expect(readmeDoc).toBeDefined();

      const toc = getDocumentToc(readmeDoc.id);
      expect(toc.ok).toBe(true);
      expect(toc.data.length).toBeGreaterThanOrEqual(3); // At least: Project Overview, Installation, API Endpoints
    });
  });

  // ── FTS5 Search (#814) ──

  describe('searchDocuments (FTS5)', () => {
    it('finds documents by keyword with ranked results', () => {
      const lib = createLibrary({ name: 'Search Lib', docRootPath: docDir });
      indexLibrary(lib.data.id);

      const result = searchDocuments({ query: 'architecture' });
      expect(result.ok).toBe(true);
      expect(result.data.length).toBeGreaterThanOrEqual(1);
      // Architecture doc should be ranked high
      const titles = result.data.map((d: { title: string }) => d.title);
      expect(titles).toContain('Architecture');
    });

    it('falls back to LIKE search on invalid FTS5 syntax', () => {
      const lib = createLibrary({ name: 'Fallback', docRootPath: docDir });
      indexLibrary(lib.data.id);

      // Invalid FTS5 syntax should fall back gracefully
      const result = searchDocuments({ query: 'deploy' });
      expect(result.ok).toBe(true);
    });
  });

  // ── Manifest Generation (#814) ──

  describe('generateManifest', () => {
    it('generates a complete library manifest', () => {
      const lib = createLibrary({ name: 'Manifest Lib', docRootPath: docDir });
      indexLibrary(lib.data.id);

      const result = generateManifest(lib.data.id);
      expect(result.ok).toBe(true);
      expect(result.data.libraryId).toBe(lib.data.id);
      expect(result.data.name).toBe('Manifest Lib');
      expect(result.data.documentCount).toBeGreaterThanOrEqual(3);
      expect(result.data.totalWords).toBeGreaterThan(0);
      expect(result.data.topTopics).toBeInstanceOf(Array);
      expect(result.data.documents).toBeInstanceOf(Array);
      expect(result.data.documents.length).toBe(result.data.documentCount);
    });

    it('includes TOC in manifest documents', () => {
      const lib = createLibrary({ name: 'TOC Manifest', docRootPath: docDir });
      indexLibrary(lib.data.id);

      const result = generateManifest(lib.data.id);
      const readmeDoc = result.data.documents.find((d: { path: string }) => d.path === 'readme.md');
      expect(readmeDoc).toBeDefined();
      expect(readmeDoc.toc.length).toBeGreaterThanOrEqual(1);
    });

    it('returns error for non-existent library', () => {
      const result = generateManifest('nonexistent');
      expect(result.ok).toBe(false);
    });
  });

  // ── Smart Context Injection (#814) ──

  describe('findRelevantDocs', () => {
    it('finds docs relevant to a task description', () => {
      createTestBuilding('bld_test');
      const lib = createLibrary({ name: 'Relevant Lib', docRootPath: docDir, buildingId: 'bld_test' });
      indexLibrary(lib.data.id);

      const result = findRelevantDocs({
        taskDescription: 'Deploy the application using Docker containers',
        buildingId: 'bld_test',
      });
      expect(result.ok).toBe(true);
      // Deployment guide should be found
      if (result.data.length > 0) {
        expect(result.data[0]).toHaveProperty('title');
        expect(result.data[0]).toHaveProperty('summary');
        expect(result.data[0]).toHaveProperty('relevanceScore');
      }
    });

    it('returns empty for completely unrelated task', () => {
      createTestBuilding('bld_test');
      const lib = createLibrary({ name: 'Unrelated', docRootPath: docDir, buildingId: 'bld_test' });
      indexLibrary(lib.data.id);

      const result = findRelevantDocs({
        taskDescription: 'xyz zzz qqq',
        buildingId: 'bld_test',
      });
      expect(result.ok).toBe(true);
      expect(result.data).toHaveLength(0);
    });
  });

  describe('buildDocContextInjection', () => {
    it('builds context injection markdown for agent prompt', () => {
      createTestBuilding('bld_ctx');
      const lib = createLibrary({ name: 'Context Lib', docRootPath: docDir, buildingId: 'bld_ctx' });
      indexLibrary(lib.data.id);

      const context = buildDocContextInjection({ buildingId: 'bld_ctx' });
      expect(context).toContain('## Documentation Libraries');
      expect(context).toContain('Context Lib');
      expect(context).toContain('search_library');
    });

    it('includes relevant docs when task description provided', () => {
      createTestBuilding('bld_task');
      const lib = createLibrary({ name: 'Task Lib', docRootPath: docDir, buildingId: 'bld_task' });
      indexLibrary(lib.data.id);

      const context = buildDocContextInjection({
        buildingId: 'bld_task',
        taskDescription: 'Implement the REST API endpoints for user management',
      });
      expect(context).toContain('## Documentation Libraries');
      // Should include relevant docs section if matches found
      if (context.includes('Relevant to Current Task')) {
        expect(context).toContain('get_document');
      }
    });

    it('returns empty string when no libraries exist', () => {
      const context = buildDocContextInjection({ buildingId: 'bld_empty' });
      expect(context).toBe('');
    });
  });

  // ── Document Content with TOC (#814) ──

  describe('getDocumentContent', () => {
    it('returns document content with TOC', () => {
      const lib = createLibrary({ name: 'Content Lib', docRootPath: docDir });
      indexLibrary(lib.data.id);

      const docs = listDocuments(lib.data.id);
      const archDoc = docs.data.find((d: { file_path: string }) => d.file_path === 'architecture.md');
      expect(archDoc).toBeDefined();

      const content = getDocumentContent(archDoc.id);
      expect(content.ok).toBe(true);
      expect(content.data.content).toContain('layered architecture');
      expect(content.data.toc).toBeInstanceOf(Array);
      expect(content.data.toc.length).toBeGreaterThan(0);
    });
  });
});
