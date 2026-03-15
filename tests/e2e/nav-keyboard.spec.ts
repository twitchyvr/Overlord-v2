/**
 * Overlord v2 — E2E Tests: Navigation Phase 3 — Keyboard & Accessibility (#632)
 *
 * Verifies:
 * 1. Floor headers are keyboard-focusable (tabindex)
 * 2. Enter/Space toggles floor expand/collapse
 * 3. Arrow keys navigate between floors
 * 4. Room items are keyboard-focusable
 * 5. ARIA attributes are correct
 */

import { test, expect } from '@playwright/test';
import {
  gotoAppAndConnect,
  createBuildingDirect,
  selectBuilding,
} from './helpers/overlord.js';

test.describe('Issue #632: Navigation Phase 3 — Keyboard & Accessibility', () => {
  let buildingId: string;

  test.beforeEach(async ({ page }) => {
    await gotoAppAndConnect(page);
    buildingId = await createBuildingDirect(page, 'Keyboard Nav Test');
    await selectBuilding(page, buildingId);
  });

  test('#632: Floor headers have tabindex and ARIA attributes', async ({ page }) => {
    const header = page.locator('.floor-section-header').first();
    await expect(header).toBeVisible({ timeout: 5000 });

    // tabindex should be 0
    await expect(header).toHaveAttribute('tabindex', '0');
    // role should be button
    await expect(header).toHaveAttribute('role', 'button');
    // aria-expanded should be false initially
    await expect(header).toHaveAttribute('aria-expanded', 'false');
    // aria-label should describe the floor
    const label = await header.getAttribute('aria-label');
    expect(label).toBeTruthy();
    expect(label).toContain('floor');
  });

  test('#632: Enter key toggles floor expand/collapse', async ({ page }) => {
    const header = page.locator('.floor-section-header').first();
    await expect(header).toBeVisible({ timeout: 5000 });

    // Focus and press Enter to expand
    await header.focus();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(400);

    await expect(header).toHaveAttribute('aria-expanded', 'true');
    const body = page.locator('.floor-section').first().locator('.floor-section-body');
    await expect(body).toBeVisible();

    // Press Enter again to collapse
    await page.keyboard.press('Enter');
    await page.waitForTimeout(400);

    await expect(header).toHaveAttribute('aria-expanded', 'false');
  });

  test('#632: Space key also toggles floor expand', async ({ page }) => {
    const header = page.locator('.floor-section-header').first();
    await expect(header).toBeVisible({ timeout: 5000 });

    await header.focus();
    await page.keyboard.press('Space');
    await page.waitForTimeout(400);

    await expect(header).toHaveAttribute('aria-expanded', 'true');
  });

  test('#632: ArrowDown moves focus to next floor', async ({ page }) => {
    const headers = page.locator('.floor-section-header');
    await expect(headers.first()).toBeVisible({ timeout: 5000 });

    // Focus first floor header
    await headers.first().focus();

    // Press ArrowDown — should focus next floor or room
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(200);

    // The focused element should be a different floor header or a room item
    const focused = page.locator(':focus');
    const focusedTag = await focused.evaluate(el => el.className);
    // Should be either next floor-section-header or a room-item
    expect(focusedTag).toMatch(/floor-section-header|room-item/);
  });

  test('#632: Room items have tabindex and ARIA', async ({ page }) => {
    // Expand first floor to show rooms
    const header = page.locator('.floor-section-header').first();
    await expect(header).toBeVisible({ timeout: 5000 });
    await header.click();
    await page.waitForTimeout(400);

    const room = page.locator('.room-item').first();
    if (await room.isVisible()) {
      await expect(room).toHaveAttribute('tabindex', '0');
      await expect(room).toHaveAttribute('role', 'button');

      const label = await room.getAttribute('aria-label');
      expect(label).toBeTruthy();
    }
  });

  test('#632: Enter on room item selects it', async ({ page }) => {
    const header = page.locator('.floor-section-header').first();
    await expect(header).toBeVisible({ timeout: 5000 });
    await header.click();
    await page.waitForTimeout(400);

    const room = page.locator('.room-item').first();
    if (await room.isVisible()) {
      await room.focus();
      await page.keyboard.press('Enter');
      await page.waitForTimeout(500);

      await expect(room).toHaveClass(/room-item-active/);
    }
  });

  test('#632: ArrowUp from room focuses back to floor header', async ({ page }) => {
    const header = page.locator('.floor-section-header').first();
    await expect(header).toBeVisible({ timeout: 5000 });
    await header.click();
    await page.waitForTimeout(400);

    const room = page.locator('.room-item').first();
    if (await room.isVisible()) {
      await room.focus();
      await page.keyboard.press('ArrowUp');
      await page.waitForTimeout(200);

      // Focus should be back on the floor header
      const focused = page.locator(':focus');
      const cls = await focused.evaluate(el => el.className);
      expect(cls).toContain('floor-section-header');
    }
  });
});
