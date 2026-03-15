/**
 * Overlord v2 — E2E Tests: Navigation Phase 4 — Responsive Sidebar (#634)
 *
 * Verifies:
 * 1. Collapse toggle button exists and works
 * 2. Collapsed sidebar shows only icons
 * 3. Clicking floor icon in collapsed mode expands sidebar + floor
 * 4. Sidebar width changes on collapse/expand
 */

import { test, expect } from '@playwright/test';
import {
  gotoAppAndConnect,
  createBuildingDirect,
  selectBuilding,
} from './helpers/overlord.js';

test.describe('Issue #634: Navigation Phase 4 — Responsive Sidebar', () => {
  let buildingId: string;

  test.beforeEach(async ({ page }) => {
    await gotoAppAndConnect(page);
    buildingId = await createBuildingDirect(page, 'Responsive Sidebar Test');
    await selectBuilding(page, buildingId);
  });

  test('#634: Collapse toggle button is visible', async ({ page }) => {
    const toggle = page.locator('.sidebar-collapse-toggle');
    await expect(toggle).toBeVisible({ timeout: 5000 });
    await expect(toggle).toHaveAttribute('aria-label', 'Collapse sidebar');
  });

  test('#634: Clicking toggle collapses sidebar to icon-only', async ({ page }) => {
    const panel = page.locator('#building-panel');
    const toggle = page.locator('.sidebar-collapse-toggle');
    await expect(toggle).toBeVisible({ timeout: 5000 });

    // Get initial width
    const widthBefore = await panel.evaluate(el => el.getBoundingClientRect().width);
    expect(widthBefore).toBeGreaterThan(200);

    // Collapse
    await toggle.click();
    await page.waitForTimeout(500);

    // Panel should have collapsed class
    await expect(panel).toHaveClass(/collapsed/);

    // Width should be narrow (~52px)
    const widthAfter = await panel.evaluate(el => el.getBoundingClientRect().width);
    expect(widthAfter).toBeLessThan(80);
  });

  test('#634: Collapsed sidebar hides header and stats', async ({ page }) => {
    const toggle = page.locator('.sidebar-collapse-toggle');
    await expect(toggle).toBeVisible({ timeout: 5000 });
    await toggle.click();
    await page.waitForTimeout(500);

    // Header and stats inside the building panel should be hidden
    const panel = page.locator('#building-panel');
    const header = panel.locator('.building-header');
    const stats = panel.locator('.building-stats');
    await expect(header).not.toBeVisible();
    await expect(stats).not.toBeVisible();
  });

  test('#634: Collapsed sidebar shows floor type icons', async ({ page }) => {
    const toggle = page.locator('.sidebar-collapse-toggle');
    await expect(toggle).toBeVisible({ timeout: 5000 });
    await toggle.click();
    await page.waitForTimeout(500);

    // Floor type icons should still be visible
    const icons = page.locator('.floor-type-icon');
    const count = await icons.count();
    expect(count).toBeGreaterThanOrEqual(3);

    // At least one should be visible
    await expect(icons.first()).toBeVisible();
  });

  test('#634: Clicking floor icon in collapsed mode expands sidebar and floor', async ({ page }) => {
    const toggle = page.locator('.sidebar-collapse-toggle');
    await expect(toggle).toBeVisible({ timeout: 5000 });

    // Collapse
    await toggle.click();
    await page.waitForTimeout(500);

    // Click first floor header (icon)
    const floorHeader = page.locator('.floor-section-header').first();
    await floorHeader.click();
    await page.waitForTimeout(500);

    // Sidebar should no longer be collapsed
    const panel = page.locator('#building-panel');
    await expect(panel).not.toHaveClass(/collapsed/);

    // The clicked floor should be expanded
    const firstFloor = page.locator('.floor-section').first();
    await expect(firstFloor).toHaveClass(/expanded/);
  });

  test('#634: Toggle button changes label when collapsed', async ({ page }) => {
    const toggle = page.locator('.sidebar-collapse-toggle');
    await expect(toggle).toBeVisible({ timeout: 5000 });

    // Before collapse
    await expect(toggle).toHaveAttribute('aria-label', 'Collapse sidebar');

    // Collapse
    await toggle.click();
    await page.waitForTimeout(500);

    // After collapse — label should change
    const newToggle = page.locator('.sidebar-collapse-toggle');
    await expect(newToggle).toHaveAttribute('aria-label', 'Expand sidebar');
  });
});
