/**
 * Merge Queue Tool Tests (#944)
 *
 * Tests for the sequential merge strategy: enqueue, dequeue, process lifecycle,
 * drift detection, status queries, and priority ordering.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { executeMergeQueue } from '../../../src/tools/providers/merge-queue.js';
import { getToolConcurrencyMode, getDefaultResourceDescriptors } from '../../../src/tools/tool-resource-map.js';

// ── Mocks ──

vi.mock('../../../src/tools/providers/shell.js', () => ({ executeShell: vi.fn() }));
vi.mock('../../../src/storage/db.js', () => ({ getDb: vi.fn() }));
vi.mock('../../../src/core/logger.js', () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
}));

import { executeShell } from '../../../src/tools/providers/shell.js';
import { getDb } from '../../../src/storage/db.js';

const mockShell = vi.mocked(executeShell);
const mockGetDb = vi.mocked(getDb);

// ── Test Helpers ──

function shellOk(stdout = ''): { stdout: string; stderr: string; exitCode: number; timedOut: boolean } {
  return { stdout, stderr: '', exitCode: 0, timedOut: false };
}

function shellFail(stderr = 'error'): { stdout: string; stderr: string; exitCode: number; timedOut: boolean } {
  return { stdout: '', stderr, exitCode: 1, timedOut: false };
}

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE IF NOT EXISTS merge_queue (
      id TEXT PRIMARY KEY,
      building_id TEXT NOT NULL,
      branch TEXT NOT NULL,
      worktree_path TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      priority TEXT NOT NULL DEFAULT 'feature' CHECK(priority IN ('hotfix','feature','refactor','auto')),
      status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','rebasing','testing','merging','merged','failed','cancelled')),
      position INTEGER NOT NULL DEFAULT 0,
      main_drift TEXT DEFAULT '{}',
      failure_reason TEXT,
      enqueued_at TEXT DEFAULT (datetime('now')),
      started_at TEXT,
      completed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_mq_building ON merge_queue(building_id);
    CREATE INDEX IF NOT EXISTS idx_mq_status ON merge_queue(status);
  `);
  return db;
}

let testDb: Database.Database;

beforeEach(() => {
  vi.clearAllMocks();
  testDb = createTestDb();
  mockGetDb.mockReturnValue(testDb as unknown as ReturnType<typeof getDb>);
});

afterEach(() => {
  testDb.close();
});

// ── Test Suite ──

describe('Merge Queue (#944)', () => {
  // ── Enqueue ──

  describe('enqueue', () => {
    it('inserts a new entry into the queue', async () => {
      const result = await executeMergeQueue({
        action: 'enqueue',
        buildingId: 'b1',
        branch: 'feat/test',
        worktreePath: '/tmp/wt-1',
        agentId: 'agent-1',
        priority: 'feature',
      });

      expect(result.data).toBeDefined();
      const entry = result.data as any;
      expect(entry.branch).toBe('feat/test');
      expect(entry.agentId).toBe('agent-1');
      expect(entry.priority).toBe('feature');
      expect(entry.status).toBe('queued');
      expect(entry.position).toBe(0);
    });

    it('assigns incrementing positions for same building', async () => {
      await executeMergeQueue({
        action: 'enqueue', buildingId: 'b1', branch: 'feat/a',
        worktreePath: '/tmp/wt-a', agentId: 'a1', priority: 'feature',
      });
      const result = await executeMergeQueue({
        action: 'enqueue', buildingId: 'b1', branch: 'feat/b',
        worktreePath: '/tmp/wt-b', agentId: 'a2', priority: 'feature',
      });

      const entry = result.data as any;
      expect(entry.position).toBe(1);
    });

    it('rejects branch names with shell metacharacters', async () => {
      const result = await executeMergeQueue({
        action: 'enqueue', buildingId: 'b1', branch: 'feat/test; rm -rf /',
        worktreePath: '/tmp/wt', agentId: 'a1',
      });

      expect(result.error).toBeDefined();
      expect(result.error!.code).toBe('MERGE_QUEUE_ERROR');
    });

    it('defaults to feature priority when invalid priority given', async () => {
      const result = await executeMergeQueue({
        action: 'enqueue', buildingId: 'b1', branch: 'feat/x',
        worktreePath: '/tmp/wt', agentId: 'a1', priority: 'bogus',
      });

      const entry = result.data as any;
      expect(entry.priority).toBe('feature');
    });

    it('errors when required params missing', async () => {
      const result = await executeMergeQueue({
        action: 'enqueue', buildingId: 'b1',
      });

      expect(result.error).toBeDefined();
      expect(result.error!.code).toBe('MISSING_PARAM');
    });
  });

  // ── Dequeue ──

  describe('dequeue', () => {
    it('cancels a queued entry', async () => {
      const enqueued = await executeMergeQueue({
        action: 'enqueue', buildingId: 'b1', branch: 'feat/x',
        worktreePath: '/tmp/wt', agentId: 'a1',
      });
      const entryId = (enqueued.data as any).id;

      const result = await executeMergeQueue({
        action: 'dequeue', buildingId: 'b1', entryId,
      });

      expect(result.data).toEqual({ cancelled: true });

      // Verify DB state
      const row = testDb.prepare('SELECT status FROM merge_queue WHERE id = ?').get(entryId) as any;
      expect(row.status).toBe('cancelled');
    });

    it('errors for non-existent entry', async () => {
      const result = await executeMergeQueue({
        action: 'dequeue', buildingId: 'b1', entryId: 'non-existent',
      });

      expect(result.error).toBeDefined();
      expect(result.error!.code).toBe('NOT_FOUND');
    });
  });

  // ── Queue Ordering ──

  describe('queue ordering', () => {
    it('orders hotfix before feature within same building', async () => {
      // Enqueue feature first, then hotfix
      await executeMergeQueue({
        action: 'enqueue', buildingId: 'b1', branch: 'feat/slow',
        worktreePath: '/tmp/wt-1', agentId: 'a1', priority: 'feature',
      });
      await executeMergeQueue({
        action: 'enqueue', buildingId: 'b1', branch: 'hotfix/urgent',
        worktreePath: '/tmp/wt-2', agentId: 'a2', priority: 'hotfix',
      });

      // Status should show hotfix first
      const status = await executeMergeQueue({
        action: 'status', buildingId: 'b1',
      });

      const snapshot = status.data as any;
      expect(snapshot.entries).toHaveLength(2);
      expect(snapshot.entries[0].priority).toBe('hotfix');
      expect(snapshot.entries[1].priority).toBe('feature');
    });

    it('maintains FIFO within same priority', async () => {
      await executeMergeQueue({
        action: 'enqueue', buildingId: 'b1', branch: 'feat/first',
        worktreePath: '/tmp/wt-1', agentId: 'a1', priority: 'feature',
      });
      await executeMergeQueue({
        action: 'enqueue', buildingId: 'b1', branch: 'feat/second',
        worktreePath: '/tmp/wt-2', agentId: 'a2', priority: 'feature',
      });

      const status = await executeMergeQueue({
        action: 'status', buildingId: 'b1',
      });

      const snapshot = status.data as any;
      expect(snapshot.entries[0].branch).toBe('feat/first');
      expect(snapshot.entries[1].branch).toBe('feat/second');
    });
  });

  // ── Process Lifecycle ──

  describe('process', () => {
    async function enqueueTestEntry(branch = 'feat/test', priority = 'feature') {
      const result = await executeMergeQueue({
        action: 'enqueue', buildingId: 'b1', branch,
        worktreePath: '/tmp/wt-test', agentId: 'a1', priority,
      });
      return (result.data as any).id;
    }

    it('happy path: queued → rebasing → testing → merging → merged', async () => {
      await enqueueTestEntry();

      // Mock shell calls: fetch, rev-list (drift), diff (overlap), rebase, test, checkout+merge, push
      mockShell
        .mockResolvedValueOnce(shellOk())                         // git fetch origin main
        .mockResolvedValueOnce(shellOk('2'))                      // git rev-list --count (drift)
        .mockResolvedValueOnce(shellOk(''))                       // git diff --name-only (overlap)
        .mockResolvedValueOnce(shellOk('Rebased'))                // git rebase origin/main
        .mockResolvedValueOnce(shellOk('Tests passed'))           // npm test
        .mockResolvedValueOnce(shellOk('Merged'))                 // git checkout main && git merge
        .mockResolvedValueOnce(shellOk('Pushed'));                // git push origin main

      const result = await executeMergeQueue({
        action: 'process', buildingId: 'b1', projectDir: '/tmp/project',
      });

      expect(result.data).toBeDefined();
      const entry = result.data as any;
      expect(entry.status).toBe('merged');
      expect(entry.completedAt).toBeTruthy();
    });

    it('fails on rebase conflict', async () => {
      await enqueueTestEntry();

      mockShell
        .mockResolvedValueOnce(shellOk())                         // git fetch
        .mockResolvedValueOnce(shellOk('0'))                      // drift count
        .mockResolvedValueOnce(shellOk(''))                       // drift overlap
        .mockResolvedValueOnce(shellFail('CONFLICT (content)'))   // git rebase (fails)
        .mockResolvedValueOnce(shellOk());                        // git rebase --abort

      const result = await executeMergeQueue({
        action: 'process', buildingId: 'b1', projectDir: '/tmp/project',
      });

      expect(result.error).toBeDefined();
      expect(result.error!.code).toBe('REBASE_CONFLICT');

      // Verify DB state
      const row = testDb.prepare('SELECT status, failure_reason FROM merge_queue WHERE status = ?').get('failed') as any;
      expect(row.failure_reason).toBe('REBASE_CONFLICT');
    });

    it('fails on test failure', async () => {
      await enqueueTestEntry();

      mockShell
        .mockResolvedValueOnce(shellOk())                         // git fetch
        .mockResolvedValueOnce(shellOk('1'))                      // drift count
        .mockResolvedValueOnce(shellOk(''))                       // drift overlap
        .mockResolvedValueOnce(shellOk('OK'))                     // git rebase
        .mockResolvedValueOnce(shellFail('FAIL: 3 tests'));       // npm test (fails)

      const result = await executeMergeQueue({
        action: 'process', buildingId: 'b1', projectDir: '/tmp/project',
      });

      expect(result.error).toBeDefined();
      expect(result.error!.code).toBe('TEST_FAILURE');
    });

    it('fails on fetch failure', async () => {
      await enqueueTestEntry();

      mockShell.mockResolvedValueOnce(shellFail('Could not resolve host'));

      const result = await executeMergeQueue({
        action: 'process', buildingId: 'b1', projectDir: '/tmp/project',
      });

      expect(result.error).toBeDefined();
      expect(result.error!.code).toBe('FETCH_FAILED');
    });

    it('returns error when queue is empty', async () => {
      const result = await executeMergeQueue({
        action: 'process', buildingId: 'b1', projectDir: '/tmp/project',
      });

      expect(result.error).toBeDefined();
      expect(result.error!.code).toBe('QUEUE_EMPTY');
    });

    it('processes hotfix before feature', async () => {
      // Enqueue feature first, then hotfix
      await enqueueTestEntry('feat/slow', 'feature');
      await enqueueTestEntry('hotfix/critical', 'hotfix');

      // Mock shell for full process flow (hotfix should be processed)
      mockShell
        .mockResolvedValueOnce(shellOk())       // fetch
        .mockResolvedValueOnce(shellOk('0'))     // drift count
        .mockResolvedValueOnce(shellOk(''))      // drift overlap
        .mockResolvedValueOnce(shellOk())        // rebase
        .mockResolvedValueOnce(shellOk())        // test
        .mockResolvedValueOnce(shellOk())        // merge
        .mockResolvedValueOnce(shellOk());       // push

      const result = await executeMergeQueue({
        action: 'process', buildingId: 'b1', projectDir: '/tmp/project',
      });

      expect(result.data).toBeDefined();
      // The processed entry should be the hotfix, not the feature
      expect((result.data as any).branch).toBe('hotfix/critical');
    });
  });

  // ── Drift Detection ──

  describe('drift', () => {
    it('classifies low drift', async () => {
      mockShell
        .mockResolvedValueOnce(shellOk())     // git fetch origin main
        .mockResolvedValueOnce(shellOk('3'))   // commits behind
        .mockResolvedValueOnce(shellOk(''));    // no overlapping files

      const result = await executeMergeQueue({
        action: 'drift', buildingId: 'b1',
        projectDir: '/tmp/project', branch: 'feat/test',
      });

      expect(result.data).toBeDefined();
      const drift = result.data as any;
      expect(drift.driftLevel).toBe('low');
      expect(drift.commitsBehind).toBe(3);
    });

    it('classifies medium drift', async () => {
      mockShell
        .mockResolvedValueOnce(shellOk())
        .mockResolvedValueOnce(shellOk('12'))
        .mockResolvedValueOnce(shellOk('src/a.ts\nsrc/b.ts\nsrc/c.ts'));

      const result = await executeMergeQueue({
        action: 'drift', buildingId: 'b1',
        projectDir: '/tmp/project', branch: 'feat/test',
      });

      const drift = result.data as any;
      expect(drift.driftLevel).toBe('medium');
      expect(drift.commitsBehind).toBe(12);
      expect(drift.overlappingFiles).toHaveLength(3);
    });

    it('classifies high drift', async () => {
      // 25 commits behind with many overlapping files
      const files = Array.from({ length: 15 }, (_, i) => `src/file${i}.ts`).join('\n');
      mockShell
        .mockResolvedValueOnce(shellOk())
        .mockResolvedValueOnce(shellOk('25'))
        .mockResolvedValueOnce(shellOk(files));

      const result = await executeMergeQueue({
        action: 'drift', buildingId: 'b1',
        projectDir: '/tmp/project', branch: 'feat/test',
      });

      const drift = result.data as any;
      expect(drift.driftLevel).toBe('high');
      expect(drift.commitsBehind).toBe(25);
      expect(drift.overlappingFiles).toHaveLength(15);
    });

    it('rejects branches with shell metacharacters', async () => {
      const result = await executeMergeQueue({
        action: 'drift', buildingId: 'b1',
        projectDir: '/tmp/project', branch: 'feat/$(whoami)',
      });

      expect(result.error).toBeDefined();
    });
  });

  // ── Status ──

  describe('status', () => {
    it('returns empty snapshot for building with no entries', async () => {
      const result = await executeMergeQueue({
        action: 'status', buildingId: 'empty-building',
      });

      const snapshot = result.data as any;
      expect(snapshot.entries).toHaveLength(0);
      expect(snapshot.currentlyMerging).toBeNull();
      expect(snapshot.buildingId).toBe('empty-building');
    });

    it('excludes merged and cancelled entries', async () => {
      // Insert entries with different statuses directly
      testDb.prepare(`INSERT INTO merge_queue (id, building_id, branch, worktree_path, agent_id, priority, status, position)
        VALUES ('q1', 'b1', 'feat/a', '/wt/a', 'a1', 'feature', 'queued', 0)`).run();
      testDb.prepare(`INSERT INTO merge_queue (id, building_id, branch, worktree_path, agent_id, priority, status, position)
        VALUES ('m1', 'b1', 'feat/b', '/wt/b', 'a2', 'feature', 'merged', 1)`).run();
      testDb.prepare(`INSERT INTO merge_queue (id, building_id, branch, worktree_path, agent_id, priority, status, position)
        VALUES ('c1', 'b1', 'feat/c', '/wt/c', 'a3', 'feature', 'cancelled', 2)`).run();

      const result = await executeMergeQueue({
        action: 'status', buildingId: 'b1',
      });

      const snapshot = result.data as any;
      expect(snapshot.entries).toHaveLength(1);
      expect(snapshot.entries[0].id).toBe('q1');
    });

    it('identifies currently merging entry', async () => {
      testDb.prepare(`INSERT INTO merge_queue (id, building_id, branch, worktree_path, agent_id, priority, status, position)
        VALUES ('r1', 'b1', 'feat/x', '/wt/x', 'a1', 'feature', 'rebasing', 0)`).run();
      testDb.prepare(`INSERT INTO merge_queue (id, building_id, branch, worktree_path, agent_id, priority, status, position)
        VALUES ('q1', 'b1', 'feat/y', '/wt/y', 'a2', 'feature', 'queued', 1)`).run();

      const result = await executeMergeQueue({
        action: 'status', buildingId: 'b1',
      });

      const snapshot = result.data as any;
      expect(snapshot.currentlyMerging).toBe('r1');
    });
  });

  // ── Invalid Action ──

  describe('invalid action', () => {
    it('returns error for unknown action', async () => {
      const result = await executeMergeQueue({
        action: 'bogus', buildingId: 'b1',
      });

      expect(result.error).toBeDefined();
      expect(result.error!.code).toBe('INVALID_ACTION');
    });
  });

  // ── Resource Map Integration ──

  describe('resource map integration', () => {
    it('merge_queue has git:static resource descriptor', () => {
      const descriptors = getDefaultResourceDescriptors('merge_queue');
      expect(descriptors).toBeDefined();
      expect(descriptors).toEqual([{ type: 'git', mode: 'static' }]);
    });

    it('merge_queue is serialized (inferred from resource descriptors)', () => {
      const mode = getToolConcurrencyMode('merge_queue');
      expect(mode).toBe('serialized');
    });
  });
});
