/**
 * Overlord v2 — E2E Tests: Navigation Phase 2 — Visual Identity (#630)
 *
 * Verifies:
 * 1. Floor type icons render (emoji, not dots)
 * 2. Expanded floor name takes floor color
 * 3. Expanded header has tinted background
 * 4. Active room has strong visual indicator
 */

import { test, expect } from '@playwright/test';
import {
  gotoAppAndConnect,
  createBuildingDirect,
  selectBuilding,
} from './helpers/overlord.js';

test.describe('Issue #630: Navigation Phase 2 — Visual Identity', () => {
  let buildingId: string;

  test.beforeEach(async ({ page }) => {
    await gotoAppAndConnect(page);
    buildingId = await createBuildingDirect(page, 'Visual Identity Test');
    await selectBuilding(page, buildingId);
  });

  test('#630: Floor type icons render instead of color dots', async ({ page }) => {
    const icons = page.locator('.floor-type-icon');
    await expect(icons.first()).toBeVisible({ timeout: 5000 });

    const count = await icons.count();
    expect(count).toBeGreaterThanOrEqual(3);

    // Icons should contain emoji text, not be empty
    const text = await icons.first().textContent();
    expect(text).toBeTruthy();
    expect(text!.length).toBeGreaterThan(0);
  });

  test('#630: No old color dots remain in floor headers', async ({ page }) => {
    // The old .floor-color-dot should not appear in floor headers
    const dots = page.locator('.floor-section-header .floor-color-dot');
    await expect(dots).toHaveCount(0);
  });

  test('#630: Expanded floor name takes floor type color', async ({ page }) => {
    const firstFloor = page.locator('.floor-section').first();
    const header = firstFloor.locator('.floor-section-header');
    const name = firstFloor.locator('.floor-section-name');

    // Expand
    await header.click();
    await page.waitForTimeout(400);

    // The name element inside an expanded floor should have a color
    // different from the default --text-primary (#e2e8f0)
    const color = await name.evaluate(el => getComputedStyle(el).color);
    // Default text-primary is rgb(226, 232, 240) — expanded should be different
    // (e.g., Strategy purple rgb(168, 85, 247))
    expect(color).not.toBe('rgb(226, 232, 240)');
  });

  test('#630: Expanded header has tinted background', async ({ page }) => {
    const firstFloor = page.locator('.floor-section').first();
    const header = firstFloor.locator('.floor-section-header');

    // Expand
    await header.click();
    await page.waitForTimeout(400);

    // Background should not be transparent/empty
    const bg = await header.evaluate(el => getComputedStyle(el).backgroundColor);
    expect(bg).not.toBe('rgba(0, 0, 0, 0)');
    expect(bg).not.toBe('transparent');
  });

  test('#630: Count pill gets tinted when floor is expanded', async ({ page }) => {
    const firstFloor = page.locator('.floor-section').first();
    const header = firstFloor.locator('.floor-section-header');
    const count = firstFloor.locator('.floor-section-count');

    // Before expand — pill should have transparent background
    const bgBefore = await count.evaluate(el => getComputedStyle(el).backgroundColor);

    // Expand
    await header.click();
    await page.waitForTimeout(400);

    // After expand — pill should have a colored background
    const bgAfter = await count.evaluate(el => getComputedStyle(el).backgroundColor);
    expect(bgAfter).not.toBe(bgBefore);
  });

  test('#630: Clicking a room highlights it as active', async ({ page }) => {
    const firstFloor = page.locator('.floor-section').first();
    const header = firstFloor.locator('.floor-section-header');

    // Expand floor
    await header.click();
    await page.waitForTimeout(400);

    // Click the first room item
    const roomItem = page.locator('.room-item').first();
    if (await roomItem.isVisible()) {
      await roomItem.click();
      await page.waitForTimeout(500);

      // Room should have active class
      await expect(roomItem).toHaveClass(/room-item-active/);
    }
  });
});
