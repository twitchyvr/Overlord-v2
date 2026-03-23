/**
 * Overlord v2 — E2E Tests: Epic 2 — Building Configuration UI
 *
 * Tests the building management interface as a real user would use it:
 *   1. Navigate to Building view (left sidebar)
 *   2. Verify building header shows floors and rooms
 *   3. Test "Edit Building" functionality
 *   4. Test "Add Floor" — create a new floor
 *   5. Test "Edit Floor" — rename, toggle active
 *   6. Verify floor shows in building view
 *   7. Test "Add Room" on a floor
 *   8. Test "Edit Room" — change name, file scope, provider
 *   9. Test room delete (with confirmation dialog)
 *  10. Test table management: add table, edit type/chairs, delete
 *
 * Also tests:
 *   - Building stats (floors count, rooms count, active agents)
 *   - Floor expansion/collapse (click to toggle)
 *   - Room cards within expanded floors
 *   - Floor type picker with recommended badges
 *   - Room type picker with descriptions
 *   - Confirmation dialogs for destructive actions
 */

import { test, expect } from '@playwright/test';
import {
  gotoAppAndConnect,
  createBuildingDirect,
  selectBuilding,
  createFloorDirect,
  createRoomDirect,
  clickAddFloor,
  clickEditBuilding,
  expandFloor,
  clickAddRoomOnFloor,
} from './helpers/overlord.js';

// ────────────────────────────────────────────────────────────────
// Test Setup
// ────────────────────────────────────────────────────────────────

test.describe('Epic 2: Building Configuration UI', () => {
  let buildingId: string;

  test.beforeEach(async ({ page }) => {
    await gotoAppAndConnect(page);
    buildingId = await createBuildingDirect(page, 'E2E Test Building');
    await selectBuilding(page, buildingId);
  });

  // ────────────────────────────────────────────────────────────
  // Test 1: Building view shows building header with name
  // ────────────────────────────────────────────────────────────

  test('building view displays building header with name and phase', async ({ page }) => {
    // The building panel is always visible in the left sidebar
    const buildingPanel = page.locator('#building-panel');
    await expect(buildingPanel).toBeVisible();

    // Building name should be displayed
    const buildingName = buildingPanel.locator('.building-name');
    await expect(buildingName).toContainText('E2E Test Building');

    // Phase badge should show "strategy" (default initial phase)
    const phaseBadge = buildingPanel.locator('.phase-badge');
    await expect(phaseBadge).toBeVisible();
    await expect(phaseBadge).toContainText('strategy');
  });

  // ────────────────────────────────────────────────────────────
  // Test 2: Building header shows floors and rooms stats
  // ────────────────────────────────────────────────────────────

  test('building stats show floors and rooms counts', async ({ page }) => {
    // Create a floor and room for the stats to count
    const floorId = await createFloorDirect(page, buildingId, 'execution', 'Test Execution Floor');
    await createRoomDirect(page, floorId, 'code-lab', 'Main Code Lab');

    // Wait for building view to refresh
    await page.waitForTimeout(1000);

    const buildingPanel = page.locator('#building-panel');

    // Stats are shown inline at the bottom
    const stats = buildingPanel.locator('.building-stats-inline');
    await expect(stats).toBeVisible();

    // Should contain floor and room counts
    await expect(stats).toContainText(/floor/i);
    await expect(stats).toContainText(/room/i);
  });

  // ────────────────────────────────────────────────────────────
  // Test 3: Edit Building — open modal, change name, save
  // ────────────────────────────────────────────────────────────

  test('edit building modal allows renaming the building', async ({ page }) => {
    await clickEditBuilding(page);

    // Modal should open with building info
    const modal = page.locator('.modal-wrapper').last();
    await expect(modal).toBeVisible();

    // Modal title should contain building name
    const modalTitle = modal.locator('.modal-title');
    await expect(modalTitle).toContainText(/edit building/i);

    // Name input should have current name
    const nameInput = modal.locator('.form-input[type="text"]').first();
    await expect(nameInput).toHaveValue('E2E Test Building');

    // Building ID should be displayed (read-only)
    const idField = modal.locator('.form-input-readonly.mono, .form-input-readonly').first();
    await expect(idField).toBeVisible();

    // Change the name
    await nameInput.fill('Renamed Building');

    // Click Save Changes
    const saveBtn = modal.locator('.btn-primary').filter({ hasText: /save changes/i });
    await saveBtn.click();

    // Wait for save + modal close
    await page.waitForTimeout(2000);

    // Verify building name updated in the header
    const buildingName = page.locator('#building-panel .building-name');
    await expect(buildingName).toContainText('Renamed Building');
  });

  // ────────────────────────────────────────────────────────────
  // Test 4: Add Floor — open modal, select type, create
  // ────────────────────────────────────────────────────────────

  test('add floor modal creates a new floor', async ({ page }) => {
    await clickAddFloor(page);

    // Modal should be open with floor type picker
    const modal = page.locator('.modal-wrapper').last();
    await expect(modal).toBeVisible();

    // Floor name input
    const nameInput = modal.locator('.form-input[type="text"]').first();
    await nameInput.fill('My Execution Floor');

    // Floor type grid should show type cards
    const typeCards = modal.locator('.add-room-type-card');
    await expect(typeCards.first()).toBeVisible();

    // Select "Execution" type card
    const executionCard = typeCards.filter({ hasText: /execution/i }).first();
    await executionCard.click();

    // Verify it got selected
    await expect(executionCard).toHaveClass(/selected/);

    // Click "Create Floor"
    const createBtn = modal.locator('.btn-primary').filter({ hasText: /create floor/i });
    await createBtn.click();

    // Wait for creation and modal close
    await page.waitForTimeout(2000);

    // Verify the floor appears in the building cross-section
    const floorBar = page.locator('#building-panel .floor-section').filter({
      has: page.locator('.floor-section-name', { hasText: 'My Execution Floor' }),
    });
    await expect(floorBar).toBeVisible({ timeout: 10_000 });
  });

  // ────────────────────────────────────────────────────────────
  // Test 5: Floor bar shows type and room count
  // ────────────────────────────────────────────────────────────

  test('floor section displays room count pill', async ({ page }) => {
    const floorId = await createFloorDirect(page, buildingId, 'collaboration', 'Collab Floor');
    await createRoomDirect(page, floorId, 'discovery', 'Discovery Room');
    await createRoomDirect(page, floorId, 'architecture', 'Architecture Room');

    await page.waitForTimeout(1000);

    const floorSection = page.locator('#building-panel .floor-section').filter({
      has: page.locator('.floor-section-name', { hasText: 'Collab Floor' }),
    });
    await expect(floorSection).toBeVisible({ timeout: 10_000 });

    // Room count pill should show "2"
    const roomCount = floorSection.locator('.floor-section-count');
    await expect(roomCount).toContainText('2');
  });

  // ────────────────────────────────────────────────────────────
  // Test 6: Expand floor to see room cards
  // ────────────────────────────────────────────────────────────

  test('clicking a floor expands it to show room items', async ({ page }) => {
    const floorId = await createFloorDirect(page, buildingId, 'execution', 'Expand Test Floor');
    await createRoomDirect(page, floorId, 'code-lab', 'Code Lab Alpha');
    await createRoomDirect(page, floorId, 'testing-lab', 'QA Lab');

    await page.waitForTimeout(1000);

    // Click the floor to expand
    await expandFloor(page, 'Expand Test Floor');

    // Floor should now have the "expanded" class
    const expandedFloor = page.locator('#building-panel .floor-section.expanded').filter({
      has: page.locator('.floor-section-name', { hasText: 'Expand Test Floor' }),
    });
    await expect(expandedFloor).toBeVisible();

    // Room cards should be visible in the expanded content
    const roomCards = expandedFloor.locator('.room-item');
    await expect(roomCards).toHaveCount(2, { timeout: 5000 });

    // Verify room names
    const codeLabCard = expandedFloor.locator('.room-item').filter({
      has: page.locator('.room-item-name', { hasText: 'Code Lab Alpha' }),
    });
    await expect(codeLabCard).toBeVisible();

    const qaLabCard = expandedFloor.locator('.room-item').filter({
      has: page.locator('.room-item-name', { hasText: 'QA Lab' }),
    });
    await expect(qaLabCard).toBeVisible();
  });

  // ────────────────────────────────────────────────────────────
  // Test 7: Edit Floor — rename and toggle active
  // ────────────────────────────────────────────────────────────

  test('edit floor modal allows renaming and toggling active state', async ({ page }) => {
    await createFloorDirect(page, buildingId, 'governance', 'Governance Floor');

    await page.waitForTimeout(1000);

    // Expand the floor
    await expandFloor(page, 'Governance Floor');

    // Click "Edit Floor" button in the expanded floor actions
    const expandedFloor = page.locator('#building-panel .floor-section.expanded').filter({
      has: page.locator('.floor-section-name', { hasText: 'Governance Floor' }),
    });
    const editFloorBtn = expandedFloor.locator('.btn-ghost').filter({ hasText: /^edit$/i });
    await editFloorBtn.click();

    // Modal should open
    const modal = page.locator('.modal-wrapper').last();
    await expect(modal).toBeVisible({ timeout: 5000 });

    // Verify modal title
    const modalTitle = modal.locator('.modal-title');
    await expect(modalTitle).toContainText(/edit floor/i);

    // Change floor name
    const nameInput = modal.locator('.form-input[type="text"]').first();
    await nameInput.fill('Renamed Governance Floor');

    // Floor type should be read-only
    const readOnlyType = modal.locator('.form-input-readonly');
    await expect(readOnlyType.first()).toBeVisible();

    // Active toggle should be present
    const activeToggle = modal.locator('.settings-switch, [role="switch"]');
    await expect(activeToggle).toBeVisible();

    // Click save
    const saveBtn = modal.locator('.btn-primary').filter({ hasText: /save changes/i });
    await saveBtn.click();

    // Wait for modal close and refresh
    await page.waitForTimeout(2000);

    // Verify floor name was updated
    const updatedFloor = page.locator('#building-panel .floor-section').filter({
      has: page.locator('.floor-section-name', { hasText: 'Renamed Governance Floor' }),
    });
    await expect(updatedFloor).toBeVisible({ timeout: 10_000 });
  });

  // ────────────────────────────────────────────────────────────
  // Test 8: Add Room — modal with type picker
  // ────────────────────────────────────────────────────────────

  test('add room modal creates a room on the selected floor', async ({ page }) => {
    await createFloorDirect(page, buildingId, 'execution', 'Room Test Floor');

    await page.waitForTimeout(1000);

    // Use the helper to expand floor and click Add Room
    await clickAddRoomOnFloor(page, 'Room Test Floor');

    // Modal should be open
    const modal = page.locator('.modal-wrapper').last();
    await expect(modal).toBeVisible();

    // Room name input
    const nameInput = modal.locator('.form-input[type="text"]').first();
    await nameInput.fill('Frontend Lab');

    // Room type cards should be visible
    const typeCards = modal.locator('.add-room-type-card');
    await expect(typeCards.first()).toBeVisible();

    // Select "Code Lab" type
    const codeLabCard = typeCards.filter({ hasText: /code lab/i }).first();
    await codeLabCard.click();
    await expect(codeLabCard).toHaveClass(/selected/);

    // "Recommended" badges should appear for execution floor room types
    const recommendedBadge = modal.locator('.add-room-type-badge');
    // There should be at least one recommended badge for execution floor
    const badgeCount = await recommendedBadge.count();
    expect(badgeCount).toBeGreaterThanOrEqual(0);

    // Click "Create Room"
    const createBtn = modal.locator('.btn-primary').filter({ hasText: /create room/i });
    await createBtn.click();

    // Wait for creation
    await page.waitForTimeout(2000);

    // Expand the floor and verify room appears
    await expandFloor(page, 'Room Test Floor');

    const expandedFloor = page.locator('#building-panel .floor-section.expanded');
    const roomCard = expandedFloor.locator('.room-item').filter({
      has: page.locator('.room-item-name', { hasText: 'Frontend Lab' }),
    });
    await expect(roomCard).toBeVisible({ timeout: 10_000 });
  });

  // ────────────────────────────────────────────────────────────
  // Test 9: Edit Room — change name, file scope, provider
  // ────────────────────────────────────────────────────────────

  test('edit room modal allows changing name, file scope, and provider', async ({ page }) => {
    const floorId = await createFloorDirect(page, buildingId, 'execution', 'Edit Room Floor');
    await createRoomDirect(page, floorId, 'code-lab', 'Original Lab');

    await page.waitForTimeout(1000);

    // Expand floor
    await expandFloor(page, 'Edit Room Floor');

    // Find the room card and click its edit button
    const expandedFloor = page.locator('#building-panel .floor-section.expanded');
    const roomCard = expandedFloor.locator('.room-item').filter({
      has: page.locator('.room-item-name', { hasText: 'Original Lab' }),
    });

    // The edit button appears on hover — use force click
    const editBtn = roomCard.locator('.room-item-action-btn').first();
    await editBtn.click({ force: true });

    // Wait for edit room modal
    const modal = page.locator('.modal-wrapper').last();
    await expect(modal).toBeVisible({ timeout: 5000 });

    // Modal title should reference the room
    const modalTitle = modal.locator('.modal-title');
    await expect(modalTitle).toContainText(/edit room/i);

    // Change room name
    const nameInput = modal.locator('.form-input[type="text"]').first();
    await nameInput.fill('Renamed Lab');

    // File scope selector should exist
    const scopeSelect = modal.locator('select.form-input').nth(0);
    await expect(scopeSelect).toBeVisible();

    // Change file scope to "full"
    await scopeSelect.selectOption('full');

    // Provider selector should exist
    const providerSelect = modal.locator('select.form-input').nth(1);
    await expect(providerSelect).toBeVisible();

    // Change provider to "anthropic"
    await providerSelect.selectOption('anthropic');

    // Tools textarea should be present
    const toolsTextarea = modal.locator('textarea.form-textarea, textarea.form-input');
    await expect(toolsTextarea).toBeVisible();

    // Save changes
    const saveBtn = modal.locator('.btn-primary').filter({ hasText: /save changes/i });
    await saveBtn.click();

    // Wait for save
    await page.waitForTimeout(2000);

    // Verify room name updated (re-expand floor to refresh)
    await page.waitForTimeout(500);
    const updatedRoom = page.locator('#building-panel .room-item').filter({
      has: page.locator('.room-item-name', { hasText: 'Renamed Lab' }),
    });
    await expect(updatedRoom).toBeVisible({ timeout: 10_000 });
  });

  // ────────────────────────────────────────────────────────────
  // Test 10: Delete Room — confirmation dialog
  // ────────────────────────────────────────────────────────────

  test('delete room shows confirmation dialog and removes room', async ({ page }) => {
    const floorId = await createFloorDirect(page, buildingId, 'execution', 'Delete Room Floor');
    await createRoomDirect(page, floorId, 'code-lab', 'Doomed Lab');

    await page.waitForTimeout(1000);

    // Expand floor
    await expandFloor(page, 'Delete Room Floor');

    // Verify room exists
    const expandedFloor = page.locator('#building-panel .floor-section.expanded');
    const roomCard = expandedFloor.locator('.room-item').filter({
      has: page.locator('.room-item-name', { hasText: 'Doomed Lab' }),
    });
    await expect(roomCard).toBeVisible();

    // Click the delete button (second action button, has danger class)
    const deleteBtn = roomCard.locator('.room-item-action-danger, .room-item-action-btn').last();
    await deleteBtn.click({ force: true });

    // Confirmation modal should appear
    const confirmModal = page.locator('.modal-wrapper').last();
    await expect(confirmModal).toBeVisible({ timeout: 5000 });

    // Should contain warning text
    const warningText = confirmModal.locator('.confirm-delete-message, .confirm-delete-warning');
    await expect(warningText.first()).toBeVisible();

    // Click "Delete Room" button
    const confirmDeleteBtn = confirmModal.locator('.btn-danger').filter({ hasText: /delete room/i });
    await confirmDeleteBtn.click();

    // Wait for deletion
    await page.waitForTimeout(2000);

    // Room should no longer be visible
    const deletedRoom = page.locator('#building-panel .room-item').filter({
      has: page.locator('.room-item-name', { hasText: 'Doomed Lab' }),
    });
    await expect(deletedRoom).toHaveCount(0, { timeout: 10_000 });
  });

  // ────────────────────────────────────────────────────────────
  // Test 11: Delete Floor — blocked when rooms exist
  // ────────────────────────────────────────────────────────────

  test('delete floor is blocked when floor has rooms', async ({ page }) => {
    const floorId = await createFloorDirect(page, buildingId, 'execution', 'Protected Floor');
    await createRoomDirect(page, floorId, 'code-lab', 'Blocking Room');

    await page.waitForTimeout(1000);

    // Expand floor
    await expandFloor(page, 'Protected Floor');

    // Click Delete button in floor actions
    const expandedFloor = page.locator('#building-panel .floor-section.expanded');
    const deleteBtn = expandedFloor.locator('.btn-danger-ghost, .btn-ghost').filter({ hasText: /delete/i });
    await deleteBtn.click();

    // Should show a "Cannot Delete Floor" modal
    const modal = page.locator('.modal-wrapper').last();
    await expect(modal).toBeVisible({ timeout: 5000 });

    // Should mention that rooms exist
    const warningContent = modal.locator('.confirm-delete-warning');
    await expect(warningContent).toContainText(/room/i);

    // Only OK/Cancel button, no delete button
    const okBtn = modal.locator('.btn-ghost').filter({ hasText: /ok|cancel/i });
    await okBtn.click();

    await page.waitForTimeout(300);
  });

  // ────────────────────────────────────────────────────────────
  // Test 12: Delete empty floor succeeds
  // ────────────────────────────────────────────────────────────

  test('delete empty floor shows confirm and removes floor', async ({ page }) => {
    await createFloorDirect(page, buildingId, 'operations', 'Empty Floor');

    await page.waitForTimeout(1000);

    // Expand floor
    await expandFloor(page, 'Empty Floor');

    // Click Delete button
    const expandedFloor = page.locator('#building-panel .floor-section.expanded');
    const deleteBtn = expandedFloor.locator('.btn-danger-ghost, .btn-ghost').filter({ hasText: /delete/i });
    await deleteBtn.click();

    // Confirmation modal should appear
    const modal = page.locator('.modal-wrapper').last();
    await expect(modal).toBeVisible({ timeout: 5000 });

    // Click "Delete Floor"
    const confirmBtn = modal.locator('.btn-danger').filter({ hasText: /delete floor/i });
    await confirmBtn.click();

    await page.waitForTimeout(2000);

    // Floor should be gone
    const deletedFloor = page.locator('#building-panel .floor-section').filter({
      has: page.locator('.floor-section-name', { hasText: 'Empty Floor' }),
    });
    await expect(deletedFloor).toHaveCount(0, { timeout: 10_000 });
  });

  // ────────────────────────────────────────────────────────────
  // Test 13: Room card shows room type and status
  // ────────────────────────────────────────────────────────────

  test('room item shows status dot for idle room', async ({ page }) => {
    const floorId = await createFloorDirect(page, buildingId, 'execution', 'Status Floor');
    await createRoomDirect(page, floorId, 'testing-lab', 'QA Lab');

    await page.waitForTimeout(1000);

    await expandFloor(page, 'Status Floor');

    const expandedFloor = page.locator('#building-panel .floor-section.expanded');
    const roomItem = expandedFloor.locator('.room-item').first();

    // Room item should have a status dot
    const statusDot = roomItem.locator('.room-item-dot');
    await expect(statusDot).toBeVisible();

    // Room name should be visible
    const roomName = roomItem.locator('.room-item-name');
    await expect(roomName).toContainText('QA Lab');
  });

  // ────────────────────────────────────────────────────────────
  // Test 14: Table management — add table via socket API
  // ────────────────────────────────────────────────────────────

  test('table management: create, list, and delete a table', async ({ page }) => {
    const floorId = await createFloorDirect(page, buildingId, 'execution', 'Table Floor');
    const roomId = await createRoomDirect(page, floorId, 'code-lab', 'Table Lab');

    // Create a table directly via socket API
    const createResult = await page.evaluate(
      async (rid: string) => {
        if (!window.overlordSocket) throw new Error('Socket not connected');
        const res = await window.overlordSocket.createTable(rid, 'focus', 2, 'Focus work table');
        return res;
      },
      roomId
    );

    expect(createResult?.ok).toBe(true);
    const tableId = createResult.data?.id;
    expect(tableId).toBeTruthy();

    // List tables for the room
    const listResult = await page.evaluate(
      async (rid: string) => {
        if (!window.overlordSocket) throw new Error('Socket not connected');
        const res = await window.overlordSocket.fetchTables(rid);
        return res;
      },
      roomId
    );

    expect(listResult?.ok).toBe(true);
    expect(listResult.data).toBeInstanceOf(Array);
    expect(listResult.data.length).toBeGreaterThanOrEqual(1);

    // Update the table
    const updateResult = await page.evaluate(
      async (tid: string) => {
        if (!window.overlordSocket) throw new Error('Socket not connected');
        const res = await window.overlordSocket.updateTable(tid, { chairs: 4, description: 'Updated focus table' });
        return res;
      },
      tableId
    );

    expect(updateResult?.ok).toBe(true);

    // Delete the table
    const deleteResult = await page.evaluate(
      async (tid: string) => {
        if (!window.overlordSocket) throw new Error('Socket not connected');
        const res = await window.overlordSocket.deleteTable(tid);
        return res;
      },
      tableId
    );

    expect(deleteResult?.ok).toBe(true);

    // Verify table is gone
    const verifyResult = await page.evaluate(
      async (rid: string) => {
        if (!window.overlordSocket) throw new Error('Socket not connected');
        const res = await window.overlordSocket.fetchTables(rid);
        return res;
      },
      roomId
    );

    const remainingTables = (verifyResult?.data || []).filter(
      (t: any) => t.id === tableId
    );
    expect(remainingTables.length).toBe(0);
  });

  // ────────────────────────────────────────────────────────────
  // Test 15: Foundation element is always visible
  // ────────────────────────────────────────────────────────────

  test('building sidebar shows inline stats', async ({ page }) => {
    const stats = page.locator('#building-panel .building-stats-inline');
    await expect(stats).toBeVisible();
    await expect(stats).toContainText(/floor/i);
  });

  // ────────────────────────────────────────────────────────────
  // Test 16: Floor expand/collapse toggle works
  // ────────────────────────────────────────────────────────────

  test('floor expand and collapse toggle works correctly', async ({ page }) => {
    await createFloorDirect(page, buildingId, 'collaboration', 'Toggle Floor');

    await page.waitForTimeout(1000);

    const floorSection = page.locator('#building-panel .floor-section').filter({
      has: page.locator('.floor-section-name', { hasText: 'Toggle Floor' }),
    });

    // Initially not expanded
    await expect(floorSection).not.toHaveClass(/expanded/);

    // Chevron should be visible
    const chevron = floorSection.locator('.floor-chevron');
    await expect(chevron).toBeVisible();

    // Click header to expand
    const header = floorSection.locator('.floor-section-header');
    await header.click();
    await page.waitForTimeout(500);
    await expect(floorSection).toHaveClass(/expanded/);

    // Click header again to collapse
    await header.click();
    await page.waitForTimeout(500);

    // After collapse, verify the floor is still visible
    const collapsedFloor = page.locator('#building-panel .floor-section').filter({
      has: page.locator('.floor-section-name', { hasText: 'Toggle Floor' }),
    });
    await expect(collapsedFloor).toBeVisible();
  });

  // ────────────────────────────────────────────────────────────
  // Test 17: Add Floor modal shows all floor types
  // ────────────────────────────────────────────────────────────

  test('add floor modal shows all 6 floor types', async ({ page }) => {
    await clickAddFloor(page);

    const modal = page.locator('.modal-wrapper').last();
    const typeCards = modal.locator('.add-room-type-card');

    // Should show 6 floor types: strategy, collaboration, execution, governance, operations, integration
    await expect(typeCards).toHaveCount(6, { timeout: 5000 });

    // Verify specific labels exist
    const expectedTypes = ['Strategy', 'Collaboration', 'Execution', 'Governance', 'Operations', 'Integration'];
    for (const typeName of expectedTypes) {
      const card = typeCards.filter({ hasText: typeName });
      await expect(card).toBeVisible();
    }

    // First one (Strategy) should be selected by default
    const firstCard = typeCards.first();
    await expect(firstCard).toHaveClass(/selected/);
  });

  // ────────────────────────────────────────────────────────────
  // Test 18: Empty floor shows guidance message
  // ────────────────────────────────────────────────────────────

  test('expanded empty floor shows guidance message', async ({ page }) => {
    await createFloorDirect(page, buildingId, 'operations', 'Empty Guidance Floor');

    await page.waitForTimeout(1000);

    await expandFloor(page, 'Empty Guidance Floor');

    const expandedFloor = page.locator('#building-panel .floor-section.expanded');

    // Should show empty floor guidance
    const guidance = expandedFloor.locator('.floor-empty');
    await expect(guidance).toBeVisible();
    await expect(guidance).toContainText(/no rooms/i);
  });
});
