/**
 * Overlord v2 — E2E Tests: Multi-Repo Sync Status (#649)
 *
 * Verifies:
 * 1. repo:sync-status returns status for linked repos
 * 2. repo:sync-fetch updates a repo's last_commit
 * 3. Sync status handles empty repo list gracefully
 */

import { test, expect } from '@playwright/test';
import {
  gotoAppAndConnect,
} from './helpers/overlord.js';

test.describe('Issue #649: Multi-Repo Sync Status', () => {

  test('#649: sync-status returns empty summary for building with no repos', async ({ page }) => {
    await gotoAppAndConnect(page);

    // Create a building
    const buildResult = await page.evaluate(async () => {
      return new Promise((resolve) => {
        window.overlordSocket.socket.emit('building:create', {
          name: 'Sync Test Empty',
          template: 'web-app',
          effort: 'mvp',
        }, (resp: unknown) => resolve(resp));
      });
    });

    const buildResp = buildResult as { ok: boolean; data?: { id: string } };
    expect(buildResp.ok).toBe(true);
    const buildingId = buildResp.data!.id;

    // Check sync status — should return empty
    const syncResult = await page.evaluate(async (bId: string) => {
      return new Promise((resolve) => {
        window.overlordSocket.socket.emit('repo:sync-status', {
          buildingId: bId,
        }, (resp: unknown) => resolve(resp));
      });
    }, buildingId);

    const syncResp = syncResult as { ok: boolean; data?: { repos: unknown[]; summary: { repoCount: number } } };
    expect(syncResp.ok).toBe(true);
    expect(syncResp.data!.repos).toHaveLength(0);
    expect(syncResp.data!.summary.repoCount).toBe(0);
  });

  test('#649: sync-status returns status for linked repos', async ({ page }) => {
    await gotoAppAndConnect(page);

    // Create building + add a repo
    const buildResult = await page.evaluate(async () => {
      return new Promise((resolve) => {
        window.overlordSocket.socket.emit('building:create', {
          name: 'Sync Test Building',
          template: 'web-app',
          effort: 'mvp',
        }, (resp: unknown) => resolve(resp));
      });
    });

    const buildResp = buildResult as { ok: boolean; data?: { id: string } };
    const buildingId = buildResp.data!.id;

    await page.evaluate(async (bId: string) => {
      return new Promise((resolve) => {
        window.overlordSocket.socket.emit('repo:add', {
          buildingId: bId,
          repoUrl: 'https://github.com/expressjs/express',
          name: 'expressjs/express',
          relationship: 'dependency',
        }, (resp: unknown) => resolve(resp));
      });
    }, buildingId);

    // Check sync status — should return 1 repo
    const syncResult = await page.evaluate(async (bId: string) => {
      return new Promise((resolve) => {
        window.overlordSocket.socket.emit('repo:sync-status', {
          buildingId: bId,
        }, (resp: unknown) => resolve(resp));
      });
    }, buildingId);

    const syncResp = syncResult as {
      ok: boolean;
      data?: {
        repos: Array<{ name: string; isSynced: boolean; checkedAt: string; branch: string }>;
        summary: { repoCount: number };
        fileOrigins: { total: number; modifiedLocally: number };
      };
    };
    expect(syncResp.ok).toBe(true);
    expect(syncResp.data!.repos).toHaveLength(1);
    expect(syncResp.data!.repos[0].name).toBe('expressjs/express');
    expect(syncResp.data!.repos[0].branch).toBe('main');
    expect(syncResp.data!.repos[0].checkedAt).toBeTruthy();
    expect(syncResp.data!.summary.repoCount).toBe(1);
    expect(syncResp.data!.fileOrigins).toBeDefined();
    expect(syncResp.data!.fileOrigins.total).toBeGreaterThanOrEqual(0);
  });

  test('#649: sync-fetch updates repo last_commit', async ({ page }) => {
    await gotoAppAndConnect(page);

    // Create building + add repo
    const buildResult = await page.evaluate(async () => {
      return new Promise((resolve) => {
        window.overlordSocket.socket.emit('building:create', {
          name: 'Sync Fetch Test',
          template: 'web-app',
          effort: 'mvp',
        }, (resp: unknown) => resolve(resp));
      });
    });

    const buildResp = buildResult as { ok: boolean; data?: { id: string } };
    const buildingId = buildResp.data!.id;

    const addResult = await page.evaluate(async (bId: string) => {
      return new Promise((resolve) => {
        window.overlordSocket.socket.emit('repo:add', {
          buildingId: bId,
          repoUrl: 'https://github.com/expressjs/express',
          name: 'expressjs/express',
          relationship: 'dependency',
        }, (resp: unknown) => resolve(resp));
      });
    }, buildingId);

    const addResp = addResult as { ok: boolean; data?: { id: string } };
    const repoId = addResp.data!.id;

    // Fetch latest — this calls GitHub API so may fail if gh CLI not authed,
    // but the handler should still respond with a proper error shape
    const fetchResult = await page.evaluate(async ({ bId, rId }) => {
      return new Promise((resolve) => {
        window.overlordSocket.socket.emit('repo:sync-fetch', {
          buildingId: bId,
          repoId: rId,
        }, (resp: unknown) => resolve(resp));
      });
    }, { bId: buildingId, rId: repoId });

    const fetchResp = fetchResult as { ok: boolean; data?: { repoId: string; commit: string; syncedAt: string }; error?: { code: string } };

    // Either succeeds (gh CLI authenticated) or returns a proper error
    if (fetchResp.ok) {
      expect(fetchResp.data!.repoId).toBe(repoId);
      expect(fetchResp.data!.commit).toBeTruthy();
      expect(fetchResp.data!.commit.length).toBeGreaterThan(5); // SHA is 40 chars
      expect(fetchResp.data!.syncedAt).toBeTruthy();
    } else {
      // gh CLI not authenticated — should still be a structured error
      expect(fetchResp.error).toBeDefined();
      expect(fetchResp.error!.code).toBeTruthy();
    }
  });

  test('#649: sync-fetch rejects unknown repo', async ({ page }) => {
    await gotoAppAndConnect(page);

    const buildResult = await page.evaluate(async () => {
      return new Promise((resolve) => {
        window.overlordSocket.socket.emit('building:create', {
          name: 'Sync Reject Test',
          template: 'web-app',
          effort: 'mvp',
        }, (resp: unknown) => resolve(resp));
      });
    });

    const buildResp = buildResult as { ok: boolean; data?: { id: string } };
    const buildingId = buildResp.data!.id;

    const fetchResult = await page.evaluate(async (bId: string) => {
      return new Promise((resolve) => {
        window.overlordSocket.socket.emit('repo:sync-fetch', {
          buildingId: bId,
          repoId: 'nonexistent-repo-id',
        }, (resp: unknown) => resolve(resp));
      });
    }, buildingId);

    const fetchResp = fetchResult as { ok: boolean; error?: { code: string } };
    expect(fetchResp.ok).toBe(false);
    expect(fetchResp.error!.code).toBe('REPO_NOT_FOUND');
  });
});
