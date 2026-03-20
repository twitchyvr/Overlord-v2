/**
 * Overlord v2 — E2E Test Template: Feature
 *
 * USE THIS TEMPLATE when testing a new feature or epic.
 * Copy this file to tests/e2e/<feature-name>.spec.ts and customize.
 *
 * Pattern:
 *   - beforeEach: connect, create building, navigate to relevant view
 *   - Tests progress from basic visibility → interaction → state changes → persistence
 *   - Each test is independent and can run in isolation
 *
 * Naming convention: <feature-name>.spec.ts
 * Example: room-lifecycle.spec.ts, pipeline-status.spec.ts
 */

import { test, expect } from '@playwright/test';
import {
  gotoAppAndConnect,
  navigateToView,
  createBuildingDirect,
  selectBuilding,
  // Import additional helpers as needed:
  // createAgentDirect, createTaskDirect, createFloorDirect,
  // createRoomDirect, createTodoDirect,
  // openAgentDetailDrawer, openTaskDetailDrawer,
  // closeDrawer, waitForToast, expectSuccessToast,
  // expandFloor, clickAddFloor, clickAddRoomOnFloor,
} from './helpers/overlord.js';

// ────────────────────────────────────────────────────────────────
// Feature: [FEATURE NAME]
// Issue: #NNN
// ────────────────────────────────────────────────────────────────

test.describe('[Epic/Feature Name]', () => {
  let buildingId: string;

  test.beforeEach(async ({ page }) => {
    await gotoAppAndConnect(page);
    buildingId = await createBuildingDirect(page, 'Feature Test Building');
    await selectBuilding(page, buildingId);

    // Navigate to the view being tested
    // await navigateToView(page, 'dashboard');
  });

  // ────────────────────────────────────────────────────────────
  // Test 1: Feature UI renders correctly
  // ────────────────────────────────────────────────────────────

  test('feature element is visible after navigation', async ({ page }) => {
    // Verify the main feature container renders
    // const featureEl = page.locator('.feature-container');
    // await expect(featureEl).toBeVisible({ timeout: 10_000 });

    // Verify key sub-elements are present
    // const title = featureEl.locator('.feature-title');
    // await expect(title).toContainText('Expected Title');
  });

  // ────────────────────────────────────────────────────────────
  // Test 2: Empty state shows guidance
  // ────────────────────────────────────────────────────────────

  test('shows empty state when no data exists', async ({ page }) => {
    // Verify empty state message is shown
    // const emptyState = page.locator('.empty-state');
    // await expect(emptyState).toBeVisible({ timeout: 5000 });

    // Verify call-to-action button is present
    // const ctaBtn = page.locator('.btn-primary').filter({ hasText: /create/i });
    // await expect(ctaBtn).toBeVisible();
  });

  // ────────────────────────────────────────────────────────────
  // Test 3: Create via UI modal
  // ────────────────────────────────────────────────────────────

  test('creates item via the modal form', async ({ page }) => {
    // Open the creation modal
    // const createBtn = page.locator('.btn-primary').filter({ hasText: /create/i });
    // await createBtn.click();

    // Wait for modal
    // const modal = page.locator('.modal-wrapper').last();
    // await expect(modal).toBeVisible({ timeout: 5000 });

    // Fill form fields
    // const nameInput = modal.locator('.form-input[type="text"]').first();
    // await nameInput.fill('Test Item');

    // Submit
    // const submitBtn = modal.locator('.btn-primary').filter({ hasText: /create/i });
    // await submitBtn.click();

    // Verify item appears
    // await page.waitForTimeout(2000);
    // const itemCard = page.locator('.item-card').filter({ hasText: 'Test Item' });
    // await expect(itemCard).toBeVisible({ timeout: 10_000 });
  });

  // ────────────────────────────────────────────────────────────
  // Test 4: Item interactions (click, hover, toggle)
  // ────────────────────────────────────────────────────────────

  test('clicking item opens detail view', async ({ page }) => {
    // Setup: create item via socket for speed
    // const itemId = await page.evaluate(async () => { ... });

    // Refresh view
    // await navigateToView(page, 'dashboard');
    // await navigateToView(page, '<target-view>');

    // Click the item
    // const card = page.locator('.item-card').first();
    // await card.click();

    // Verify detail view/drawer opens
    // const drawer = page.locator('.drawer.open');
    // await expect(drawer).toBeVisible({ timeout: 5000 });
  });

  // ────────────────────────────────────────────────────────────
  // Test 5: Edit and save changes
  // ────────────────────────────────────────────────────────────

  test('edits item and verifies changes persist', async ({ page }) => {
    // Setup: create item
    // ...

    // Open edit form
    // ...

    // Modify fields
    // const nameInput = modal.locator('.form-input').first();
    // await nameInput.fill('Updated Name');

    // Save
    // const saveBtn = modal.locator('.btn-primary').filter({ hasText: /save/i });
    // await saveBtn.click();
    // await page.waitForTimeout(2000);

    // Verify changes reflected in UI
    // const updated = page.locator('.item-card').filter({ hasText: 'Updated Name' });
    // await expect(updated).toBeVisible({ timeout: 10_000 });
  });

  // ────────────────────────────────────────────────────────────
  // Test 6: Delete with confirmation
  // ────────────────────────────────────────────────────────────

  test('deletes item after confirmation dialog', async ({ page }) => {
    // Setup: create item
    // ...

    // Click delete button
    // const deleteBtn = card.locator('.btn-danger');
    // await deleteBtn.click({ force: true });

    // Confirmation modal should appear
    // const confirmModal = page.locator('.modal-wrapper').last();
    // await expect(confirmModal).toBeVisible({ timeout: 5000 });

    // Confirm deletion
    // const confirmBtn = confirmModal.locator('.btn-danger').filter({ hasText: /delete/i });
    // await confirmBtn.click();
    // await page.waitForTimeout(2000);

    // Verify item is gone
    // await expect(card).toHaveCount(0, { timeout: 10_000 });
  });

  // ────────────────────────────────────────────────────────────
  // Test 7: Form validation
  // ────────────────────────────────────────────────────────────

  test('form validates required fields', async ({ page }) => {
    // Open form without filling required fields
    // ...

    // Try to submit
    // ...

    // Verify validation error appears
    // const errorMsg = page.locator('.form-error');
    // await expect(errorMsg).toBeVisible();

    // Modal should still be open
    // await expect(page.locator('.modal-wrapper')).toBeVisible();
  });

  // ────────────────────────────────────────────────────────────
  // Test 8: Filter/search functionality
  // ────────────────────────────────────────────────────────────

  test('filter tabs correctly filter items', async ({ page }) => {
    // Setup: create multiple items with different states
    // ...

    // Click filter tab
    // const filterTab = page.locator('.tab-item').filter({ hasText: 'Active' });
    // await filterTab.click();
    // await page.waitForTimeout(500);

    // Verify correct items shown
    // const cards = page.locator('.item-card');
    // await expect(cards).toHaveCount(expectedCount, { timeout: 5000 });
  });

  // ────────────────────────────────────────────────────────────
  // Test 9: Keyboard accessibility
  // ────────────────────────────────────────────────────────────

  test('keyboard shortcuts work correctly', async ({ page }) => {
    // Test Escape closes modals/drawers
    // await page.keyboard.press('Escape');
    // await expect(page.locator('.drawer.open')).not.toBeVisible({ timeout: 3000 });

    // Test Enter submits forms
    // await inputField.press('Enter');
  });

  // ────────────────────────────────────────────────────────────
  // Test 10: State persists across navigation
  // ────────────────────────────────────────────────────────────

  test('changes persist after navigating away and back', async ({ page }) => {
    // Setup: create/modify item
    // ...

    // Navigate away
    // await navigateToView(page, 'dashboard');

    // Navigate back
    // await navigateToView(page, '<target-view>');

    // Verify changes still visible
    // const item = page.locator('.item-card').filter({ hasText: 'Modified Item' });
    // await expect(item).toBeVisible({ timeout: 10_000 });
  });
});
