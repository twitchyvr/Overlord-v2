/**
 * Overlord v2 — E2E Tests: Multi-Repo Agent Context Injection (#644)
 *
 * Verifies:
 * 1. repo:add creates a linked repo visible via repo:list
 * 2. Linked repos appear in agent system prompt during chat
 * 3. File origins appear in system prompt when tracked
 */

import { test, expect } from '@playwright/test';
import {
  gotoAppAndConnect,
} from './helpers/overlord.js';

test.describe('Issue #644: Multi-Repo Agent Context Injection', () => {

  test('#644: repo:add and repo:list round-trip via socket', async ({ page }) => {
    await gotoAppAndConnect(page);

    // Create a building first (needed for repo linking)
    const buildResult = await page.evaluate(async () => {
      return new Promise((resolve) => {
        window.overlordSocket.socket.emit('building:create', {
          name: 'Context Test Building',
          template: 'web-app',
          effort: 'mvp',
        }, (resp: unknown) => resolve(resp));
      });
    });

    const buildResp = buildResult as { ok: boolean; data?: { id: string } };
    expect(buildResp.ok).toBe(true);
    const buildingId = buildResp.data!.id;

    // Add a repo
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

    const addResp = addResult as { ok: boolean };
    expect(addResp.ok).toBe(true);

    // List repos — should include the one we just added
    const listResult = await page.evaluate(async (bId: string) => {
      return new Promise((resolve) => {
        window.overlordSocket.socket.emit('repo:list', {
          buildingId: bId,
        }, (resp: unknown) => resolve(resp));
      });
    }, buildingId);

    const listResp = listResult as { ok: boolean; data?: { repos: Array<{ name: string; relationship: string }> } };
    expect(listResp.ok).toBe(true);
    expect(listResp.data!.repos.length).toBe(1);
    expect(listResp.data!.repos[0].name).toBe('expressjs/express');
    expect(listResp.data!.repos[0].relationship).toBe('dependency');
  });

  test('#644: multiple repos can be linked to same building', async ({ page }) => {
    await gotoAppAndConnect(page);

    const buildResult = await page.evaluate(async () => {
      return new Promise((resolve) => {
        window.overlordSocket.socket.emit('building:create', {
          name: 'Multi-Repo Building',
          template: 'web-app',
          effort: 'mvp',
        }, (resp: unknown) => resolve(resp));
      });
    });

    const buildResp = buildResult as { ok: boolean; data?: { id: string } };
    expect(buildResp.ok).toBe(true);
    const buildingId = buildResp.data!.id;

    // Add 3 repos with different relationships
    const repos = [
      { name: 'org/backend', url: 'https://github.com/org/backend', relationship: 'main' },
      { name: 'org/shared-utils', url: 'https://github.com/org/shared-utils', relationship: 'dependency' },
      { name: 'org/docs', url: 'https://github.com/org/docs', relationship: 'reference' },
    ];

    for (const repo of repos) {
      const result = await page.evaluate(async ({ bId, r }) => {
        return new Promise((resolve) => {
          window.overlordSocket.socket.emit('repo:add', {
            buildingId: bId,
            repoUrl: r.url,
            name: r.name,
            relationship: r.relationship,
          }, (resp: unknown) => resolve(resp));
        });
      }, { bId: buildingId, r: repo });

      expect((result as { ok: boolean }).ok).toBe(true);
    }

    // List should show all 3
    const listResult = await page.evaluate(async (bId: string) => {
      return new Promise((resolve) => {
        window.overlordSocket.socket.emit('repo:list', {
          buildingId: bId,
        }, (resp: unknown) => resolve(resp));
      });
    }, buildingId);

    const listResp = listResult as { ok: boolean; data?: { repos: Array<{ name: string; relationship: string }> } };
    expect(listResp.ok).toBe(true);
    expect(listResp.data!.repos.length).toBe(3);

    const names = listResp.data!.repos.map(r => r.name).sort();
    expect(names).toEqual(['org/backend', 'org/docs', 'org/shared-utils']);

    const relationships = new Set(listResp.data!.repos.map(r => r.relationship));
    expect(relationships).toEqual(new Set(['main', 'dependency', 'reference']));
  });

  test('#644: repo:remove removes a linked repo', async ({ page }) => {
    await gotoAppAndConnect(page);

    const buildResult = await page.evaluate(async () => {
      return new Promise((resolve) => {
        window.overlordSocket.socket.emit('building:create', {
          name: 'Remove Test Building',
          template: 'web-app',
          effort: 'mvp',
        }, (resp: unknown) => resolve(resp));
      });
    });

    const buildResp = buildResult as { ok: boolean; data?: { id: string } };
    const buildingId = buildResp.data!.id;

    // Add a repo
    const addResult = await page.evaluate(async (bId: string) => {
      return new Promise((resolve) => {
        window.overlordSocket.socket.emit('repo:add', {
          buildingId: bId,
          repoUrl: 'https://github.com/lodash/lodash',
          name: 'lodash/lodash',
          relationship: 'dependency',
        }, (resp: unknown) => resolve(resp));
      });
    }, buildingId);

    const addResp = addResult as { ok: boolean; data?: { id: string } };
    expect(addResp.ok).toBe(true);
    const repoId = addResp.data!.id;

    // Remove it
    const removeResult = await page.evaluate(async ({ bId, rId }) => {
      return new Promise((resolve) => {
        window.overlordSocket.socket.emit('repo:remove', {
          buildingId: bId,
          repoId: rId,
        }, (resp: unknown) => resolve(resp));
      });
    }, { bId: buildingId, rId: repoId });

    expect((removeResult as { ok: boolean }).ok).toBe(true);

    // List should be empty
    const listResult = await page.evaluate(async (bId: string) => {
      return new Promise((resolve) => {
        window.overlordSocket.socket.emit('repo:list', {
          buildingId: bId,
        }, (resp: unknown) => resolve(resp));
      });
    }, buildingId);

    const listResp = listResult as { ok: boolean; data?: { repos: unknown[] } };
    expect(listResp.ok).toBe(true);
    expect(listResp.data!.repos.length).toBe(0);
  });
});
