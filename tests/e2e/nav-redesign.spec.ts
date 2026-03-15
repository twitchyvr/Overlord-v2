/**
 * Overlord v2 — E2E Tests: Navigation Redesign Phase 1 (#628)
 *
 * Verifies:
 * 1. Floor sections have colored left borders per type
 * 2. Floors have clear visual separation (not squished)
 * 3. Expand/collapse works with targeted DOM update
 * 4. Rapid clicking doesn't break the UI (race condition fix)
 * 5. Room items render inside expanded floors
 */

import { test, expect } from '@playwright/test';
import {
  gotoAppAndConnect,
  createBuildingDirect,
  selectBuilding,
} from './helpers/overlord.js';

test.describe('Issue #628: Navigation Phase 1 — Spacing & Structure', () => {
  let buildingId: string;

  test.beforeEach(async ({ page }) => {
    await gotoAppAndConnect(page);
    buildingId = await createBuildingDirect(page, 'Nav Test Building');
    await selectBuilding(page, buildingId);
  });

  test('#628: Floor sections render with colored left borders', async ({ page }) => {
    const floorSections = page.locator('.floor-section');
    await expect(floorSections.first()).toBeVisible({ timeout: 5000 });

    // Each floor section should have a --floor-section-color CSS variable set
    const count = await floorSections.count();
    expect(count).toBeGreaterThan(0);

    // Check that the first floor has a style attribute with --floor-section-color
    const style = await floorSections.first().getAttribute('style');
    expect(style).toContain('--floor-section-color');
  });

  test('#628: Floors have clear visual separation (gap between them)', async ({ page }) => {
    const tree = page.locator('.building-tree');
    await expect(tree).toBeVisible({ timeout: 5000 });

    // There should be multiple floor sections
    const floors = page.locator('.floor-section');
    const count = await floors.count();
    expect(count).toBeGreaterThanOrEqual(3);

    // Floor sections should not be stacked pixel-tight
    // Check that the building-tree has a gap style applied
    const gap = await tree.evaluate(el => getComputedStyle(el).gap);
    // gap should be 8px (var(--sp-2) = 0.5rem = 8px)
    expect(parseInt(gap)).toBeGreaterThanOrEqual(6);
  });

  test('#628: Clicking floor header expands it to show rooms', async ({ page }) => {
    const firstFloor = page.locator('.floor-section').first();
    await expect(firstFloor).toBeVisible({ timeout: 5000 });

    // Floor should start collapsed (no .expanded class)
    // Click the header to expand
    const header = firstFloor.locator('.floor-section-header');
    await header.click();
    await page.waitForTimeout(400); // wait for animation

    // Floor should now be expanded
    await expect(firstFloor).toHaveClass(/expanded/);

    // Should have a floor-section-body
    const body = firstFloor.locator('.floor-section-body');
    await expect(body).toBeVisible();
  });

  test('#628: Clicking expanded floor collapses it', async ({ page }) => {
    const firstFloor = page.locator('.floor-section').first();
    const header = firstFloor.locator('.floor-section-header');

    // Expand
    await header.click();
    await page.waitForTimeout(400);
    await expect(firstFloor).toHaveClass(/expanded/);

    // Collapse
    await header.click();
    await page.waitForTimeout(400);

    // Should no longer be expanded
    await expect(firstFloor).not.toHaveClass(/expanded/);

    // Body should be removed after collapse animation
    const body = firstFloor.locator('.floor-section-body');
    await expect(body).toHaveCount(0);
  });

  test('#628: Rapid clicking does not create duplicate floor bodies', async ({ page }) => {
    const firstFloor = page.locator('.floor-section').first();
    const header = firstFloor.locator('.floor-section-header');

    // Rapidly click 4 times (expand, collapse, expand, collapse)
    await header.click();
    await page.waitForTimeout(50);
    await header.click();
    await page.waitForTimeout(50);
    await header.click();
    await page.waitForTimeout(50);
    await header.click();
    await page.waitForTimeout(500); // wait for animations to settle

    // Should have at most 1 floor-section-body (not 2+)
    const bodies = firstFloor.locator('.floor-section-body');
    const bodyCount = await bodies.count();
    expect(bodyCount).toBeLessThanOrEqual(1);
  });

  test('#628: Chevron rotates on expand', async ({ page }) => {
    const firstFloor = page.locator('.floor-section').first();
    const chevron = firstFloor.locator('.floor-chevron');
    await expect(chevron).toBeVisible({ timeout: 5000 });

    // Click to expand
    const header = firstFloor.locator('.floor-section-header');
    await header.click();
    await page.waitForTimeout(400);

    // The expanded floor's chevron should have a rotation transform via CSS
    // (CSS rule: .floor-section.expanded > .floor-section-header .floor-chevron { transform: rotate(90deg) })
    const transform = await chevron.evaluate(el => getComputedStyle(el).transform);
    // rotate(90deg) produces a matrix transform, not 'none'
    expect(transform).not.toBe('none');
  });

  test('#628: All 6 default floor types are rendered', async ({ page }) => {
    const floors = page.locator('.floor-section');
    await expect(floors.first()).toBeVisible({ timeout: 5000 });

    const count = await floors.count();
    // Default building creates 6 floors: strategy, collaboration, execution, governance, operations, integration
    expect(count).toBe(6);

    // Verify floor types via data-type attribute
    const types = await floors.evaluateAll(els => els.map(el => el.getAttribute('data-type')));
    expect(types).toContain('strategy');
    expect(types).toContain('collaboration');
    expect(types).toContain('execution');
  });
});
