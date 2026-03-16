/**
 * Overlord v2 — E2E Tests: Multi-Repo Data Model (#638)
 *
 * Verifies:
 * 1. repo:add creates a linked repo
 * 2. repo:list returns repos for a building
 * 3. repo:update modifies repo properties
 * 4. repo:remove deletes a repo and its file origins
 * 5. Zod validation rejects invalid payloads
 */

import { test, expect } from '@playwright/test';
import {
  gotoAppAndConnect,
  createBuildingDirect,
  selectBuilding,
} from './helpers/overlord.js';

test.describe('Issue #638: Multi-Repo Data Model', () => {
  let buildingId: string;

  test.beforeEach(async ({ page }) => {
    await gotoAppAndConnect(page);
    buildingId = await createBuildingDirect(page, 'Multi-Repo Test');
    await selectBuilding(page, buildingId);
  });

  test('#638: repo:add creates a linked repository', async ({ page }) => {
    const result = await page.evaluate(async (bid: string) => {
      return new Promise((resolve) => {
        window.overlordSocket.socket.emit('repo:add', {
          buildingId: bid,
          repoUrl: 'https://github.com/example/test-repo',
          name: 'test-repo',
          relationship: 'reference',
          branch: 'main',
        }, (resp: any) => resolve(resp));
      });
    }, buildingId);

    const resp = result as { ok: boolean; data?: { id: string; name: string; relationship: string } };
    expect(resp.ok).toBe(true);
    expect(resp.data?.name).toBe('test-repo');
    expect(resp.data?.relationship).toBe('reference');
    expect(resp.data?.id).toBeTruthy();
  });

  test('#638: repo:list returns repos for a building', async ({ page }) => {
    // Add two repos
    await page.evaluate(async (bid: string) => {
      return new Promise((resolve) => {
        window.overlordSocket.socket.emit('repo:add', {
          buildingId: bid,
          repoUrl: 'https://github.com/example/repo-a',
          name: 'repo-a',
          relationship: 'dependency',
        }, resolve);
      });
    }, buildingId);

    await page.evaluate(async (bid: string) => {
      return new Promise((resolve) => {
        window.overlordSocket.socket.emit('repo:add', {
          buildingId: bid,
          repoUrl: 'https://github.com/example/repo-b',
          name: 'repo-b',
          relationship: 'fork',
        }, resolve);
      });
    }, buildingId);

    // List repos
    const result = await page.evaluate(async (bid: string) => {
      return new Promise((resolve) => {
        window.overlordSocket.socket.emit('repo:list', { buildingId: bid }, (resp: any) => resolve(resp));
      });
    }, buildingId);

    const resp = result as { ok: boolean; data?: { repos: any[] } };
    expect(resp.ok).toBe(true);
    expect(resp.data?.repos.length).toBe(2);
  });

  test('#638: repo:remove deletes a repo', async ({ page }) => {
    // Add a repo
    const addResult = await page.evaluate(async (bid: string) => {
      return new Promise((resolve) => {
        window.overlordSocket.socket.emit('repo:add', {
          buildingId: bid,
          repoUrl: 'https://github.com/example/to-remove',
          name: 'to-remove',
          relationship: 'reference',
        }, (resp: any) => resolve(resp));
      });
    }, buildingId);

    const repoId = (addResult as any).data.id;

    // Remove it
    const removeResult = await page.evaluate(async ({ bid, rid }: { bid: string; rid: string }) => {
      return new Promise((resolve) => {
        window.overlordSocket.socket.emit('repo:remove', { buildingId: bid, repoId: rid }, (resp: any) => resolve(resp));
      });
    }, { bid: buildingId, rid: repoId });

    expect((removeResult as any).ok).toBe(true);

    // Verify it's gone
    const listResult = await page.evaluate(async (bid: string) => {
      return new Promise((resolve) => {
        window.overlordSocket.socket.emit('repo:list', { buildingId: bid }, (resp: any) => resolve(resp));
      });
    }, buildingId);

    expect((listResult as any).data.repos.length).toBe(0);
  });

  test('#638: repo:add rejects invalid URL', async ({ page }) => {
    const result = await page.evaluate(async (bid: string) => {
      return new Promise((resolve) => {
        window.overlordSocket.socket.emit('repo:add', {
          buildingId: bid,
          repoUrl: 'not-a-url',
          name: 'bad-repo',
          relationship: 'reference',
        }, (resp: any) => resolve(resp));
      });
    }, buildingId);

    const resp = result as { ok: boolean; error?: { code: string } };
    expect(resp.ok).toBe(false);
  });

  test('#638: repo:update modifies relationship', async ({ page }) => {
    // Add repo
    const addResult = await page.evaluate(async (bid: string) => {
      return new Promise((resolve) => {
        window.overlordSocket.socket.emit('repo:add', {
          buildingId: bid,
          repoUrl: 'https://github.com/example/updatable',
          name: 'updatable',
          relationship: 'reference',
        }, (resp: any) => resolve(resp));
      });
    }, buildingId);

    const repoId = (addResult as any).data.id;

    // Update to fork
    const updateResult = await page.evaluate(async (rid: string) => {
      return new Promise((resolve) => {
        window.overlordSocket.socket.emit('repo:update', {
          repoId: rid,
          relationship: 'fork',
        }, (resp: any) => resolve(resp));
      });
    }, repoId);

    expect((updateResult as any).ok).toBe(true);

    // Verify update
    const listResult = await page.evaluate(async (bid: string) => {
      return new Promise((resolve) => {
        window.overlordSocket.socket.emit('repo:list', { buildingId: bid }, (resp: any) => resolve(resp));
      });
    }, buildingId);

    const repos = (listResult as any).data.repos;
    const updated = repos.find((r: any) => r.id === repoId);
    expect(updated.relationship).toBe('fork');
  });
});
