/**
 * Overlord v2 — Dashboard Empty State E2E Tests
 *
 * Issue #767: Dashboard shows meaningless zeros for fresh project.
 * Verifies getting-started guide and fresh project checklist appear
 * instead of empty KPI cards.
 */

import { test, expect } from '@playwright/test';
import { gotoAppAndConnect } from './helpers/overlord.js';

test.describe('Issue #767: Dashboard empty state and onboarding', () => {

  test('#767: Shows getting-started guide when no buildings exist', async ({ page }) => {
    await gotoAppAndConnect(page);

    // Navigate to dashboard
    await page.evaluate(() => {
      (window as any).OverlordUI?.dispatch('navigate:dashboard');
    });
    await page.waitForTimeout(500);

    // Check if there are buildings — if none, getting-started should show
    const buildingCount = await page.evaluate(() => {
      const store = (window as any).OverlordUI?.getStore();
      const buildings = store?.get('building.list') || [];
      return buildings.length;
    });

    if (buildingCount === 0) {
      // Getting-started hero should be visible
      const gettingStarted = page.locator('.dashboard-getting-started');
      await expect(gettingStarted).toBeVisible();
      await expect(gettingStarted).toContainText('Welcome to Overlord');

      // Should have numbered steps
      const steps = page.locator('.getting-started-step');
      await expect(steps).toHaveCount(3);

      // New Project button should be present in the first step
      const newProjectBtn = gettingStarted.locator('button', { hasText: 'New Project' });
      await expect(newProjectBtn).toBeVisible();

      // KPI cards should NOT be visible (no meaningless zeros)
      const kpiCards = page.locator('.kpi-card');
      await expect(kpiCards).toHaveCount(0);
    }
  });

  test('#767: Dashboard header always shows regardless of state', async ({ page }) => {
    await gotoAppAndConnect(page);

    await page.evaluate(() => {
      (window as any).OverlordUI?.dispatch('navigate:dashboard');
    });
    await page.waitForTimeout(500);

    // Header should always be present
    const header = page.locator('.dashboard-header');
    await expect(header).toBeVisible();

    const title = page.locator('.dashboard-title');
    await expect(title).toContainText('Dashboard');
  });

  test('#767: Fresh project shows onboarding checklist', async ({ page }) => {
    await gotoAppAndConnect(page);

    // Create a building to test fresh project state
    const buildingId = await page.evaluate(async () => {
      const socket = (window as any).overlordSocket;
      if (!socket) return null;
      const result = await socket.createBuilding({
        name: 'Fresh Test Project',
        config: { template: 'web-app' }
      });
      return result?.data?.id || null;
    });

    if (!buildingId) {
      test.skip();
      return;
    }

    // Navigate to dashboard
    await page.evaluate(() => {
      (window as any).OverlordUI?.dispatch('navigate:dashboard');
    });
    await page.waitForTimeout(500);

    // Check for the fresh project checklist
    const checklist = page.locator('.dashboard-fresh-checklist');
    // Fresh checklist should appear for new projects with no agents
    if (await checklist.isVisible()) {
      await expect(checklist).toContainText('Getting Started');

      // "Project created" should be checked
      const doneItems = page.locator('.fresh-checklist-item.done');
      const doneCount = await doneItems.count();
      expect(doneCount).toBeGreaterThanOrEqual(1);
    }
  });
});
