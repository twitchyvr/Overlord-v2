/**
 * Overlord v2 — E2E Dogfood Tests for Session Fixes
 *
 * Each test exercises a specific fix through the REAL UI in a real browser.
 * Stage 8 (Dogfood) of the Continuous Development Loop.
 */

import { test, expect } from '@playwright/test';
import {
  gotoAppAndConnect,
  createBuildingDirect,
  selectBuilding,
  closeDrawer,
} from './helpers/overlord.js';

/** Click a toolbar button and wait for its content to render. */
async function goToView(page: import('@playwright/test').Page, viewName: string) {
  const btn = page.locator(`#app-toolbar .toolbar-btn[data-view="${viewName}"]`);
  await btn.click();
  // Wait for content to appear — use the view's own CSS class
  await page.waitForTimeout(1500);
}

test.describe('Dogfood: Session Fixes', () => {
  let buildingId: string;

  test.beforeEach(async ({ page }) => {
    await gotoAppAndConnect(page);
    buildingId = await createBuildingDirect(page, 'Dogfood Test');
    await selectBuilding(page, buildingId);
  });

  // #561 — Nav redesign: vertical tree
  test('#561: Building nav renders as vertical tree with floor sections', async ({ page }) => {
    const buildingPanel = page.locator('#building-panel');
    await expect(buildingPanel).toBeVisible();

    const floorSections = page.locator('.floor-section');
    await expect(floorSections.first()).toBeVisible({ timeout: 5000 });
    expect(await floorSections.count()).toBeGreaterThan(0);

    const firstName = page.locator('.floor-section-name').first();
    await expect(firstName).toBeVisible();

    await expect(page.locator('.floor-cross-section')).toHaveCount(0);
  });

  // #552 — Drawer dismiss with X button
  test('#552: Agent drawer dismissed with X button', async ({ page }) => {
    await goToView(page, 'agents');

    const card = page.locator('.agents-view-card').first();
    await expect(card).toBeVisible({ timeout: 15000 });
    await card.click();

    const drawer = page.locator('.drawer.open');
    await expect(drawer).toBeVisible({ timeout: 5000 });

    await closeDrawer(page);
    await expect(drawer).not.toBeVisible({ timeout: 5000 });
  });

  // #552 — Drawer dismiss with Escape
  test('#552: Agent drawer dismissed with Escape key', async ({ page }) => {
    await goToView(page, 'agents');

    const card = page.locator('.agents-view-card').first();
    await expect(card).toBeVisible({ timeout: 15000 });
    await card.click();

    const drawer = page.locator('.drawer.open');
    await expect(drawer).toBeVisible({ timeout: 5000 });

    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    await expect(drawer).not.toBeVisible({ timeout: 5000 });
  });

  // #552 — Drawer dismiss with backdrop click
  test('#552: Agent drawer dismissed by clicking backdrop', async ({ page }) => {
    await goToView(page, 'agents');

    const card = page.locator('.agents-view-card').first();
    await expect(card).toBeVisible({ timeout: 15000 });
    await card.click();

    const drawer = page.locator('.drawer.open');
    await expect(drawer).toBeVisible({ timeout: 5000 });

    const backdrop = page.locator('.drawer-backdrop.open');
    await backdrop.click({ position: { x: 10, y: 10 } });
    await page.waitForTimeout(500);
    await expect(drawer).not.toBeVisible({ timeout: 5000 });
  });

  // #598 — Settings tab switching
  test('#598: Settings tabs switch without hanging', async ({ page }) => {
    // Click the Settings gear button in the toolbar
    const settingsBtn = page.locator('button[title="Settings"]');
    await expect(settingsBtn).toBeVisible({ timeout: 5000 });
    await settingsBtn.click();
    await page.waitForTimeout(800);

    const settingsTab = page.locator('.settings-tab').first();
    await expect(settingsTab).toBeVisible({ timeout: 5000 });

    for (const name of ['Folders', 'Quality', 'AI', 'Display', 'General']) {
      const tab = page.locator('.settings-tab').filter({ hasText: name });
      if (await tab.isVisible({ timeout: 1000 }).catch(() => false)) {
        await tab.click();
        await page.waitForTimeout(200);
      }
    }

    await expect(page.locator('.settings-tab-content, .settings-section').first()).toBeVisible();
  });

  // #586 — Toast suppression
  test('#586: Project creation does not produce error toast cascade', async ({ page }) => {
    await page.evaluate(async () => {
      (window as any).__errorToastCount = 0;
      const observer = new MutationObserver((mutations) => {
        for (const m of mutations) {
          for (const node of m.addedNodes) {
            if (node instanceof HTMLElement && node.classList?.contains('toast-error')) {
              (window as any).__errorToastCount++;
            }
          }
        }
      });
      const c = document.getElementById('toast-container');
      if (c) observer.observe(c, { childList: true });
    });

    await page.evaluate(async () => {
      if (!(window as any).overlordSocket) return;
      await (window as any).overlordSocket.createBuilding({
        name: 'Toast Test', config: { projectDescription: 'x', template: 'web-app', effortLevel: 'easy' }
      });
    });
    await page.waitForTimeout(3000);

    const errorCount = await page.evaluate(() => (window as any).__errorToastCount || 0);
    expect(errorCount).toBeLessThanOrEqual(1);
  });

  // #606 — Working directory display
  test('#606: Building header shows working directory or warning', async ({ page }) => {
    const projectInfo = page.locator('.building-project-info');
    await expect(projectInfo).toBeVisible({ timeout: 5000 });

    const pathEl = page.locator('.building-project-path');
    await expect(pathEl).toBeVisible();

    const text = await pathEl.textContent();
    expect(text && text.length > 0).toBe(true);
  });

  // #565 — Activity feed
  test('#565: Activity view renders and exits loading state', async ({ page }) => {
    await goToView(page, 'activity');

    const title = page.locator('.activity-view-title');
    await expect(title).toBeVisible({ timeout: 10000 });
    await expect(title).toContainText('Activity');

    await page.waitForTimeout(3000);
    const loading = page.locator('.activity-view-loading');
    const stuck = await loading.isVisible().catch(() => false);
    expect(stuck).toBe(false);
  });

  // #559 — Agent reset button
  test('#559: Agents view has Reset button', async ({ page }) => {
    await goToView(page, 'agents');

    const resetBtn = page.locator('.agents-view-actions button').filter({ hasText: /Reset/ });
    await expect(resetBtn).toBeVisible({ timeout: 15000 });
  });
});
