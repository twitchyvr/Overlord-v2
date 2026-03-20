/**
 * Overlord v2 — E2E Test Template: Modal / Form
 *
 * USE THIS TEMPLATE when testing a specific modal dialog or form interaction.
 * Copy this file to tests/e2e/<feature>-modal.spec.ts and customize.
 *
 * Pattern:
 *   - Focus on a single modal's lifecycle: open, interact, validate, submit, close
 *   - Test all input types (text, select, textarea, checkbox, toggle)
 *   - Test validation rules (required fields, format, min/max)
 *   - Test cancel/dismiss behavior
 *   - Verify data persists after successful submit
 *
 * Naming convention: <entity>-modal.spec.ts
 * Example: create-agent-modal.spec.ts, edit-room-modal.spec.ts
 */

import { test, expect } from '@playwright/test';
import {
  gotoAppAndConnect,
  navigateToView,
  createBuildingDirect,
  selectBuilding,
  waitForModal,
  closeModal,
  // Import additional helpers as needed
} from './helpers/overlord.js';

// ────────────────────────────────────────────────────────────────
// Modal: [MODAL NAME]
// ────────────────────────────────────────────────────────────────

test.describe('[Modal Name] Modal', () => {
  let buildingId: string;

  test.beforeEach(async ({ page }) => {
    await gotoAppAndConnect(page);
    buildingId = await createBuildingDirect(page, 'Modal Test Building');
    await selectBuilding(page, buildingId);
    // Navigate to the view where the modal is triggered
    // await navigateToView(page, '<view>');
  });

  // ═══════════════════════════════════════════════════════════
  // Section 1: Modal Lifecycle
  // ═══════════════════════════════════════════════════════════

  test('modal opens when trigger button is clicked', async ({ page }) => {
    // Click the trigger button
    // const triggerBtn = page.locator('.btn-primary').filter({ hasText: /create/i });
    // await triggerBtn.click();

    // Modal should be visible
    // const modal = await waitForModal(page);
    // await expect(modal).toBeVisible();

    // Modal title should be correct
    // const title = modal.locator('.modal-header-title, .modal-title');
    // await expect(title).toContainText('Expected Title');
  });

  test('modal closes via X button', async ({ page }) => {
    // Open modal
    // ...

    // Click X button
    // await closeModal(page);

    // Modal should be gone
    // await expect(page.locator('.modal-wrapper')).not.toBeVisible({ timeout: 3000 });
  });

  test('modal closes via Escape key', async ({ page }) => {
    // Open modal
    // ...

    // Press Escape
    // await page.keyboard.press('Escape');
    // await page.waitForTimeout(400);

    // Modal should be gone
    // await expect(page.locator('.modal-wrapper')).not.toBeVisible({ timeout: 3000 });
  });

  test('modal closes via backdrop click', async ({ page }) => {
    // Open modal
    // ...

    // Click outside the modal content
    // const backdrop = page.locator('.modal-backdrop');
    // await backdrop.click({ position: { x: 10, y: 10 } });
    // await page.waitForTimeout(400);

    // Modal should be gone
    // await expect(page.locator('.modal-wrapper')).not.toBeVisible({ timeout: 3000 });
  });

  // ═══════════════════════════════════════════════════════════
  // Section 2: Form Fields
  // ═══════════════════════════════════════════════════════════

  test('all form fields render correctly', async ({ page }) => {
    // Open modal
    // ...

    // const modal = page.locator('.modal-wrapper').last();

    // Text input
    // const nameInput = modal.locator('.form-input[type="text"]').first();
    // await expect(nameInput).toBeVisible();
    // await expect(nameInput).toHaveAttribute('placeholder', 'Expected placeholder');

    // Dropdown select
    // const selectEl = modal.locator('select.form-input').first();
    // await expect(selectEl).toBeVisible();

    // Textarea
    // const textarea = modal.locator('textarea.form-textarea');
    // await expect(textarea).toBeVisible();

    // Checkbox
    // const checkbox = modal.locator('input[type="checkbox"]');
    // await expect(checkbox).toBeVisible();

    // Toggle/switch
    // const toggle = modal.locator('.settings-switch, [role="switch"]');
    // await expect(toggle).toBeVisible();
  });

  test('form fields have correct default values', async ({ page }) => {
    // Open modal
    // ...

    // const modal = page.locator('.modal-wrapper').last();

    // Verify defaults
    // const nameInput = modal.locator('.form-input').first();
    // await expect(nameInput).toHaveValue('');  // or specific default

    // const selectEl = modal.locator('select.form-input').first();
    // await expect(selectEl).toHaveValue('default-option');
  });

  // ═══════════════════════════════════════════════════════════
  // Section 3: Validation
  // ═══════════════════════════════════════════════════════════

  test('submit blocked when required fields are empty', async ({ page }) => {
    // Open modal
    // ...

    // const modal = page.locator('.modal-wrapper').last();

    // Click submit without filling anything
    // const submitBtn = modal.locator('.btn-primary').filter({ hasText: /create|save/i });
    // await submitBtn.click();

    // Verify validation error
    // const error = modal.locator('.form-error');
    // await expect(error).toBeVisible();

    // Modal should still be open
    // await expect(modal).toBeVisible();
  });

  test('validation clears after fixing input', async ({ page }) => {
    // Open modal and trigger validation error
    // ...

    // Fix the field
    // const input = modal.locator('.form-input').first();
    // await input.fill('Valid value');

    // Error should clear
    // const error = modal.locator('.form-error');
    // await expect(error).not.toBeVisible({ timeout: 2000 });
  });

  // ═══════════════════════════════════════════════════════════
  // Section 4: Successful Submission
  // ═══════════════════════════════════════════════════════════

  test('submitting valid form creates item and closes modal', async ({ page }) => {
    // Open modal
    // ...

    // const modal = page.locator('.modal-wrapper').last();

    // Fill all required fields
    // const nameInput = modal.locator('.form-input[type="text"]').first();
    // await nameInput.fill('New Item Name');

    // Submit
    // const submitBtn = modal.locator('.btn-primary').filter({ hasText: /create|save/i });
    // await submitBtn.click();

    // Modal should close
    // await expect(modal).not.toBeVisible({ timeout: 10_000 });

    // Success toast should appear
    // const toast = page.locator('#toast-container .toast-success');
    // await expect(toast).toBeVisible({ timeout: 5000 });

    // Item should appear in the list
    // const newItem = page.locator('.item-card').filter({ hasText: 'New Item Name' });
    // await expect(newItem).toBeVisible({ timeout: 10_000 });
  });

  // ═══════════════════════════════════════════════════════════
  // Section 5: Edit Mode (pre-populated modal)
  // ═══════════════════════════════════════════════════════════

  test('edit modal pre-populates with existing data', async ({ page }) => {
    // Setup: create item first
    // ...

    // Open edit modal (click edit button on item)
    // ...

    // const modal = page.locator('.modal-wrapper').last();

    // Verify pre-populated values
    // const nameInput = modal.locator('.form-input[type="text"]').first();
    // await expect(nameInput).toHaveValue('Existing Item Name');
  });

  test('edit modal saves changes correctly', async ({ page }) => {
    // Setup: create item, open edit modal
    // ...

    // Modify field
    // const nameInput = modal.locator('.form-input').first();
    // await nameInput.fill('Updated Name');

    // Save
    // const saveBtn = modal.locator('.btn-primary').filter({ hasText: /save/i });
    // await saveBtn.click();
    // await page.waitForTimeout(2000);

    // Verify updated value in the UI
    // const updated = page.locator('.item-card').filter({ hasText: 'Updated Name' });
    // await expect(updated).toBeVisible({ timeout: 10_000 });
  });

  // ═══════════════════════════════════════════════════════════
  // Section 6: Type Picker Grid (for room/floor creation)
  // ═══════════════════════════════════════════════════════════

  test('type picker grid shows all available types', async ({ page }) => {
    // Open creation modal
    // ...

    // const modal = page.locator('.modal-wrapper').last();

    // Type cards should be visible
    // const typeCards = modal.locator('.add-room-type-card');
    // await expect(typeCards).toHaveCount(expectedCount);

    // Verify specific types exist
    // const expectedTypes = ['Type A', 'Type B', 'Type C'];
    // for (const type of expectedTypes) {
    //   await expect(typeCards.filter({ hasText: type })).toBeVisible();
    // }
  });

  test('type picker highlights selected type', async ({ page }) => {
    // Open modal
    // ...

    // Click a type card
    // const card = modal.locator('.add-room-type-card').nth(1);
    // await card.click();

    // Should have "selected" class
    // await expect(card).toHaveClass(/selected/);

    // Previously selected should lose "selected" class
    // const firstCard = modal.locator('.add-room-type-card').first();
    // await expect(firstCard).not.toHaveClass(/selected/);
  });
});
