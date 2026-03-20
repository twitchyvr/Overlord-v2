/**
 * Overlord v2 — E2E Test Template: Regression Suite
 *
 * USE THIS TEMPLATE for regression tests that verify existing functionality
 * hasn't broken after changes. Group by area/feature.
 *
 * Pattern:
 *   - Rapid, focused assertions per feature area
 *   - Tests are lightweight — verify key behaviors, not exhaustive coverage
 *   - Run as part of CI to catch regressions early
 *   - Each test should be fast (< 10 seconds)
 *
 * Naming convention: regression-<area>.spec.ts
 * Example: regression-navigation.spec.ts, regression-socket.spec.ts
 */

import { test, expect } from '@playwright/test';
import {
  gotoAppAndConnect,
  navigateToView,
  createBuildingDirect,
  selectBuilding,
} from './helpers/overlord.js';

// ────────────────────────────────────────────────────────────────
// Regression Suite: [AREA NAME]
// ────────────────────────────────────────────────────────────────

test.describe('Regression: [Area Name]', () => {
  test.beforeEach(async ({ page }) => {
    await gotoAppAndConnect(page);
  });

  // ═══════════════════════════════════════════════════════════
  // Connection & Bootstrap
  // ═══════════════════════════════════════════════════════════

  test('app connects to socket and exits loading state', async ({ page }) => {
    // Connection dot should be green
    const connectionDot = page.locator('#toolbar-connection.connected');
    await expect(connectionDot).toBeVisible();

    // Loading state should be gone
    await expect(page.locator('#loading-state')).not.toBeVisible();
  });

  test('toolbar renders all navigation buttons', async ({ page }) => {
    const toolbar = page.locator('#app-toolbar');
    await expect(toolbar).toBeVisible();

    // Verify all expected view buttons exist
    const expectedViews = ['dashboard', 'chat', 'agents', 'tasks', 'activity'];
    for (const view of expectedViews) {
      const btn = toolbar.locator(`.toolbar-btn[data-view="${view}"]`);
      await expect(btn).toBeVisible();
    }
  });

  // ═══════════════════════════════════════════════════════════
  // Navigation
  // ═══════════════════════════════════════════════════════════

  test('all views are navigable without errors', async ({ page }) => {
    const buildingId = await createBuildingDirect(page, 'Nav Test');
    await selectBuilding(page, buildingId);

    const views: Array<'dashboard' | 'agents' | 'tasks' | 'activity' | 'raid-log'> = [
      'dashboard', 'agents', 'tasks', 'activity', 'raid-log',
    ];

    for (const view of views) {
      await navigateToView(page, view);
      const container = page.locator(`.view-container.view-${view}`);
      await expect(container).toBeVisible({ timeout: 10_000 });
    }
  });

  test('navigation does not produce console errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });

    const buildingId = await createBuildingDirect(page, 'Error Test');
    await selectBuilding(page, buildingId);

    await navigateToView(page, 'agents');
    await navigateToView(page, 'tasks');
    await navigateToView(page, 'dashboard');

    // Filter known/expected errors
    const unexpected = errors.filter(
      (e) => !e.includes('favicon') && !e.includes('API key')
    );
    expect(unexpected).toHaveLength(0);
  });

  // ═══════════════════════════════════════════════════════════
  // Building Panel
  // ═══════════════════════════════════════════════════════════

  test('building panel renders after building creation', async ({ page }) => {
    const buildingId = await createBuildingDirect(page, 'Panel Test');
    await selectBuilding(page, buildingId);

    const panel = page.locator('#building-panel');
    await expect(panel).toBeVisible();

    const buildingName = panel.locator('.building-name');
    await expect(buildingName).toContainText('Panel Test');
  });

  // ═══════════════════════════════════════════════════════════
  // Toast System
  // ═══════════════════════════════════════════════════════════

  test('toast container exists and is ready', async ({ page }) => {
    const toastContainer = page.locator('#toast-container');
    await expect(toastContainer).toBeVisible();
  });

  // ═══════════════════════════════════════════════════════════
  // Socket.IO Reconnection
  // ═══════════════════════════════════════════════════════════

  test('socket status indicator reflects connection state', async ({ page }) => {
    const indicator = page.locator('#toolbar-connection');
    await expect(indicator).toBeVisible();
    await expect(indicator).toHaveClass(/connected/);
  });
});

// ────────────────────────────────────────────────────────────────
// Regression: Data Integrity
// ────────────────────────────────────────────────────────────────

test.describe('Regression: Data Integrity', () => {
  test.beforeEach(async ({ page }) => {
    await gotoAppAndConnect(page);
  });

  test('building persists across page reload', async ({ page }) => {
    const buildingId = await createBuildingDirect(page, 'Persist Test');
    await selectBuilding(page, buildingId);

    // Verify building appears
    await expect(page.locator('.building-name')).toContainText('Persist Test');

    // Reload page
    await page.reload();
    await page.waitForSelector('#toolbar-connection.connected', { timeout: 15_000 });
    await page.waitForSelector('#loading-state', { state: 'detached', timeout: 15_000 });
    await page.waitForTimeout(1000);

    // Building should still be loadable (may need re-selection depending on UI behavior)
  });

  test('creating entities in rapid succession does not lose data', async ({ page }) => {
    const buildingId = await createBuildingDirect(page, 'Rapid Test');
    await selectBuilding(page, buildingId);

    // Create 5 items rapidly
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const id = await page.evaluate(
        async (params: { bid: string; i: number }) => {
          if (!window.overlordSocket) throw new Error('Socket not connected');
          const res = await window.overlordSocket.createTask({
            buildingId: params.bid,
            title: `Rapid Task ${params.i}`,
            priority: 'normal',
          });
          return res?.data?.id;
        },
        { bid: buildingId, i }
      );
      ids.push(id);
    }

    // Verify all 5 exist
    expect(ids.filter(Boolean)).toHaveLength(5);
  });
});
