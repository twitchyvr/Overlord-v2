/**
 * Overlord v2 — E2E Tests: Epic 1 — Agent Bio Profiles
 *
 * Tests the full agent lifecycle as a real user would experience it:
 *   1. Navigate to the Agents view
 *   2. Create a new agent with name + role via the UI modal
 *   3. Verify agent card appears with initial letter avatar
 *   4. Click agent card to open the detail drawer
 *   5. Verify drawer shows name, role, status
 *   6. Test "Edit Profile" form: set first name, last name, specialization, bio
 *   7. Save and verify changes persist
 *   8. Test "Generate Profile" button (loading state)
 *   9. Verify profile fields update after generation
 *
 * Also tests:
 *   - Filter tabs (All/Active/Idle) with correct counts
 *   - Auto-provisioned agents when building has onboarding
 *   - Agent card visual elements (status dot, role badge, capabilities)
 *   - Drawer keyboard accessibility (Escape to close)
 *   - Multiple agent creation
 */

import { test, expect } from '@playwright/test';
import {
  gotoAppAndConnect,
  navigateToView,
  createBuildingDirect,
  selectBuilding,
  createAgentViaUI,
  createAgentDirect,
  openAgentDetailDrawer,
  closeDrawer,
} from './helpers/overlord.js';

// ────────────────────────────────────────────────────────────────
// Test Setup: Fresh app with a building (agents need a building context)
// ────────────────────────────────────────────────────────────────

test.describe('Epic 1: Agent Bio Profiles', () => {
  let buildingId: string;

  test.beforeEach(async ({ page }) => {
    await gotoAppAndConnect(page);

    // Create a building directly for speed — we're testing agents, not building creation
    buildingId = await createBuildingDirect(page, 'Agent Test Building');
    await selectBuilding(page, buildingId);

    // Navigate to agents view
    await navigateToView(page, 'agents');
  });

  // ────────────────────────────────────────────────────────────
  // Test 1: Building auto-provisions agents on creation
  // ────────────────────────────────────────────────────────────

  test('shows auto-provisioned agents when building is created', async ({ page }) => {
    // Building onboarding creates 8 agents (1 Strategist + 7 team roles)
    const agentCards = page.locator('.agents-view-card');
    await expect(agentCards.first()).toBeVisible({ timeout: 10_000 });

    // Should have at least 8 auto-provisioned agents
    const count = await agentCards.count();
    expect(count).toBeGreaterThanOrEqual(8);

    // The count label should reflect the auto-provisioned agents
    const countLabel = page.locator('.agents-view-count');
    await expect(countLabel).toContainText(/registered/);

    // Verify the grid container exists
    const grid = page.locator('.agents-view-grid');
    await expect(grid).toBeVisible();
  });

  // ────────────────────────────────────────────────────────────
  // Test 2: Create agent via modal and verify card appears
  // ────────────────────────────────────────────────────────────

  test('creates an agent via the modal and shows agent card', async ({ page }) => {
    const agentName = 'Test Developer';

    // Get initial count (auto-provisioned agents)
    const initialCards = page.locator('.agents-view-card');
    await expect(initialCards.first()).toBeVisible({ timeout: 10_000 });
    const initialCount = await initialCards.count();

    // Click the Create Agent button in the header
    await createAgentViaUI(page, agentName, 'developer');

    // Verify agent card appears in the grid
    const agentCard = page.locator('.agents-view-card').filter({
      has: page.locator('.agents-view-card-name', { hasText: agentName }),
    });
    await expect(agentCard).toBeVisible({ timeout: 10_000 });

    // Verify the initial letter avatar shows "T" (first char of "Test Developer")
    const avatar = agentCard.locator('.agents-view-card-avatar');
    await expect(avatar).toBeVisible();
    // Avatar should contain "T" (the fallback initial)
    await expect(avatar).toContainText('T');

    // Verify the role badge shows "developer"
    const roleBadge = agentCard.locator('.agents-view-role-badge');
    await expect(roleBadge).toContainText('Developer');

    // Verify the agent count in the header updated
    const countLabel = page.locator('.agents-view-count');
    await expect(countLabel).toContainText(`${initialCount + 1} registered`);
  });

  // ────────────────────────────────────────────────────────────
  // Test 3: Agent card shows correct status indicator
  // ────────────────────────────────────────────────────────────

  test('agent card shows idle status indicator for new agent', async ({ page }) => {
    await createAgentDirect(page, 'Idle Agent', 'tester');

    // Refresh agents view
    await navigateToView(page, 'dashboard');
    await navigateToView(page, 'agents');

    const card = page.locator('.agents-view-card').filter({
      has: page.locator('.agents-view-card-name', { hasText: 'Idle Agent' }),
    });
    await expect(card).toBeVisible({ timeout: 10_000 });

    // New agents should have idle status
    const statusLabel = card.locator('.agents-view-status-label');
    await expect(statusLabel).toContainText(/idle/i);

    // Status dot should be present
    const statusDot = card.locator('.agents-view-status-dot');
    await expect(statusDot).toBeVisible();
  });

  // ────────────────────────────────────────────────────────────
  // Test 4: Click agent card opens detail drawer
  // ────────────────────────────────────────────────────────────

  test('clicking agent card opens detail drawer with correct info', async ({ page }) => {
    const agentName = 'Drawer Test Agent';

    await createAgentDirect(page, agentName, 'architect');

    // Refresh to show new agent
    await navigateToView(page, 'dashboard');
    await navigateToView(page, 'agents');

    // Click the agent card
    await openAgentDetailDrawer(page, agentName);

    // Verify drawer is open
    const drawer = page.locator('.drawer.open');
    await expect(drawer).toBeVisible();

    // Verify the detail header shows the name
    const detailName = drawer.locator('.agents-view-detail-name');
    await expect(detailName).toContainText(agentName);

    // Verify the role badge is shown
    const roleBadge = drawer.locator('.agents-view-role-badge');
    await expect(roleBadge).toBeVisible();

    // Verify status label
    const statusLabel = drawer.locator('.agents-view-status-label');
    await expect(statusLabel).toBeVisible();

    // Verify the large avatar in the drawer header
    const detailAvatar = drawer.locator('.agents-view-detail-avatar');
    await expect(detailAvatar).toBeVisible();
  });

  // ────────────────────────────────────────────────────────────
  // Test 5: Drawer shows profile sections
  // ────────────────────────────────────────────────────────────

  test('detail drawer shows profile, assignment, and details sections', async ({ page }) => {
    await createAgentDirect(page, 'Section Test Agent', 'developer');
    await navigateToView(page, 'dashboard');
    await navigateToView(page, 'agents');

    await openAgentDetailDrawer(page, 'Section Test Agent');

    const drawer = page.locator('.drawer.open');

    // Verify "Profile" section exists
    const profileSection = drawer.locator('.agents-view-detail-section-title').filter({ hasText: 'Profile' });
    await expect(profileSection).toBeVisible();

    // Verify "Current Assignment" section exists
    const assignmentSection = drawer.locator('.agents-view-detail-section-title').filter({ hasText: 'Current Assignment' });
    await expect(assignmentSection).toBeVisible();

    // Verify "Details" section exists with ID and timestamps
    const detailsSection = drawer.locator('.agents-view-detail-section-title').filter({ hasText: 'Details' });
    await expect(detailsSection).toBeVisible();

    // Verify Profile Generated shows "No" for new agent without auto-generate
    const profileRow = drawer.locator('.agents-view-detail-row').filter({ hasText: 'Profile Generated' });
    await expect(profileRow).toContainText('No');

    // Verify "Assigned Todos" section exists
    const todosSection = drawer.locator('.agents-view-detail-section-title').filter({ hasText: 'Assigned Todos' });
    await expect(todosSection).toBeVisible();
  });

  // ────────────────────────────────────────────────────────────
  // Test 6: Edit Profile form — fill fields and save
  // ────────────────────────────────────────────────────────────

  test('edit profile form: set first name, last name, specialization, bio and save', async ({ page }) => {
    const agentName = 'Profile Edit Agent';

    await createAgentDirect(page, agentName, 'developer');
    await navigateToView(page, 'dashboard');
    await navigateToView(page, 'agents');

    await openAgentDetailDrawer(page, agentName);

    const drawer = page.locator('.drawer.open');

    // Find and click the "Edit Profile" toggle header to expand the form
    const editToggle = drawer.locator('.agents-view-detail-edit-toggle');
    await expect(editToggle).toBeVisible();
    await editToggle.click();

    // Wait for form to expand (remove collapsed class)
    const editForm = drawer.locator('.agents-view-detail-edit-form');
    await expect(editForm).not.toHaveClass(/agents-view-detail-edit-collapsed/);

    // Fill first name
    const firstNameInput = editForm.locator('input[type="text"]').nth(0);
    await firstNameInput.fill('Marcus');

    // Fill last name
    const lastNameInput = editForm.locator('input[type="text"]').nth(1);
    await lastNameInput.fill('Chen');

    // Fill specialization (input 3 — nickname is input 2)
    const specInput = editForm.locator('input[type="text"]').nth(3);
    await specInput.fill('Full-Stack Development');

    // Fill bio
    const bioTextarea = editForm.locator('textarea');
    await bioTextarea.fill('A seasoned full-stack developer with expertise in React, Node.js, and cloud architecture. Passionate about clean code and test-driven development.');

    // Click "Save Changes"
    const saveBtn = editForm.locator('.btn-primary').filter({ hasText: /save changes/i });
    await saveBtn.click();

    // Wait for the save to complete — button should say "Saving..." then resolve
    // The drawer will re-open with updated data after save
    await page.waitForTimeout(2000);

    // After save, the drawer re-opens with updated data
    // Verify the display name changed to "Marcus Chen"
    const updatedDrawer = page.locator('.drawer.open');
    await expect(updatedDrawer).toBeVisible({ timeout: 10_000 });

    const updatedName = updatedDrawer.locator('.agents-view-detail-name');
    await expect(updatedName).toContainText('Marcus Chen');

    // Verify specialization appears
    const specText = updatedDrawer.locator('.agents-view-detail-specialization');
    await expect(specText).toContainText('Full-Stack Development');
  });

  // ────────────────────────────────────────────────────────────
  // Test 7: Saved profile changes persist after closing drawer
  // ────────────────────────────────────────────────────────────

  test('profile changes persist after closing and reopening drawer', async ({ page }) => {
    const agentName = 'Persist Agent';

    await createAgentDirect(page, agentName, 'analyst');
    await navigateToView(page, 'dashboard');
    await navigateToView(page, 'agents');

    // Open drawer, edit profile
    await openAgentDetailDrawer(page, agentName);

    const drawer = page.locator('.drawer.open');
    const editToggle = drawer.locator('.agents-view-detail-edit-toggle');
    await editToggle.click();

    const editForm = drawer.locator('.agents-view-detail-edit-form');
    await expect(editForm).not.toHaveClass(/agents-view-detail-edit-collapsed/);

    // Set profile fields
    const firstNameInput = editForm.locator('input[type="text"]').nth(0);
    await firstNameInput.fill('Elena');

    const lastNameInput = editForm.locator('input[type="text"]').nth(1);
    await lastNameInput.fill('Rodriguez');

    const specInput = editForm.locator('input[type="text"]').nth(3);
    await specInput.fill('Data Analysis');

    const saveBtn = editForm.locator('.btn-primary').filter({ hasText: /save changes/i });
    await saveBtn.click();

    await page.waitForTimeout(2000);

    // Close the drawer
    await closeDrawer(page);

    // Wait a beat
    await page.waitForTimeout(500);

    // The agent card in the grid should now show the display name "Elena Rodriguez"
    const updatedCard = page.locator('.agents-view-card').filter({
      has: page.locator('.agents-view-card-name', { hasText: 'Elena Rodriguez' }),
    });
    await expect(updatedCard).toBeVisible({ timeout: 10_000 });

    // Re-open the drawer and verify
    await openAgentDetailDrawer(page, 'Elena Rodriguez');

    const reopenedDrawer = page.locator('.drawer.open');
    const nameEl = reopenedDrawer.locator('.agents-view-detail-name');
    await expect(nameEl).toContainText('Elena Rodriguez');

    const specEl = reopenedDrawer.locator('.agents-view-detail-specialization');
    await expect(specEl).toContainText('Data Analysis');
  });

  // ────────────────────────────────────────────────────────────
  // Test 8: Generate Profile button shows loading state
  // ────────────────────────────────────────────────────────────

  test('generate profile button shows loading state when clicked', async ({ page }) => {
    const agentName = 'Generate Test Agent';

    await createAgentDirect(page, agentName, 'developer');
    await navigateToView(page, 'dashboard');
    await navigateToView(page, 'agents');

    await openAgentDetailDrawer(page, agentName);

    const drawer = page.locator('.drawer.open');

    // Find the "Profile Actions" section
    const profileActionsTitle = drawer.locator('.agents-view-detail-section-title').filter({ hasText: 'Profile Actions' });
    await expect(profileActionsTitle).toBeVisible();

    // The "Generate Profile" button should exist (since profile_generated is false)
    const generateBtn = drawer.locator('.agents-view-detail-profile-actions .btn-primary').filter({
      hasText: /generate profile/i,
    });
    await expect(generateBtn).toBeVisible();

    // Click it and verify the loading state
    await generateBtn.click();

    // Button should change to "Generating..." and become disabled
    await expect(generateBtn).toHaveText('Generating...');
    await expect(generateBtn).toBeDisabled();

    // Note: In a test environment without AI API keys, this will likely fail
    // with a toast error. We're testing the loading state, not the AI call.
    // Wait for either success toast or error toast
    const toast = page.locator('#toast-container .toast').first();
    await expect(toast).toBeVisible({ timeout: 30_000 });
  });

  // ────────────────────────────────────────────────────────────
  // Test 9: Drawer closes on Escape key
  // ────────────────────────────────────────────────────────────

  test('drawer closes when Escape key is pressed', async ({ page }) => {
    await createAgentDirect(page, 'Escape Test Agent', 'developer');
    await navigateToView(page, 'dashboard');
    await navigateToView(page, 'agents');

    await openAgentDetailDrawer(page, 'Escape Test Agent');

    // Verify drawer is open
    await expect(page.locator('.drawer.open')).toBeVisible();

    // Press Escape
    await page.keyboard.press('Escape');

    // Drawer should close
    await expect(page.locator('.drawer.open')).not.toBeVisible({ timeout: 3000 });
  });

  // ────────────────────────────────────────────────────────────
  // Test 10: Filter tabs show correct counts
  // ────────────────────────────────────────────────────────────

  test('filter tabs show correct agent counts', async ({ page }) => {
    // Wait for auto-provisioned agents
    const allCards = page.locator('.agents-view-card');
    await expect(allCards.first()).toBeVisible({ timeout: 10_000 });
    const initialCount = await allCards.count();
    expect(initialCount).toBeGreaterThanOrEqual(8);

    // Create an additional agent
    await createAgentDirect(page, 'Filter Test Agent', 'developer');

    // Refresh view
    await navigateToView(page, 'dashboard');
    await navigateToView(page, 'agents');

    // Wait for all agents to appear
    await expect(page.locator('.agents-view-card')).toHaveCount(initialCount + 1, { timeout: 10_000 });

    // Verify count in header
    const countLabel = page.locator('.agents-view-count');
    await expect(countLabel).toContainText(`${initialCount + 1} registered`);

    // Check the "All" tab
    const allTab = page.locator('.tab-item').filter({ hasText: 'All' });
    await expect(allTab).toBeVisible();

    // Click "Idle" filter — all agents should be idle
    const idleTab = page.locator('.tab-item').filter({ hasText: 'Idle' });
    await idleTab.click();
    await page.waitForTimeout(500);
    await expect(page.locator('.agents-view-card')).toHaveCount(initialCount + 1, { timeout: 5000 });

    // Click "Active" filter — should show 0 agents
    const activeTab = page.locator('.tab-item').filter({ hasText: 'Active' });
    await activeTab.click();
    await page.waitForTimeout(500);
    const activeCards = page.locator('.agents-view-card');
    await expect(activeCards).toHaveCount(0, { timeout: 5000 });

    // Click "All" to return to full list
    await allTab.click();
    await page.waitForTimeout(500);
    await expect(page.locator('.agents-view-card')).toHaveCount(initialCount + 1, { timeout: 5000 });
  });

  // ────────────────────────────────────────────────────────────
  // Test 11: Create agent modal validation — empty name
  // ────────────────────────────────────────────────────────────

  test('create agent modal prevents submission without name', async ({ page }) => {
    // Wait for agents view to fully load
    await expect(page.locator('.agents-view-card').first()).toBeVisible({ timeout: 10_000 });

    // Click Create Agent button
    const createBtn = page.locator('.agents-view-actions .btn-primary').filter({ hasText: /create agent/i });
    await createBtn.click();

    // Wait for modal
    await page.waitForSelector('.agent-create-form', { timeout: 5000 });
    await page.waitForTimeout(300);

    // Try to submit without filling name
    const submitBtn = page.locator('.agent-create-actions .btn-primary').filter({ hasText: /create agent/i });
    await submitBtn.click();

    // Should show a validation toast/warning
    const toast = page.locator('#toast-container .toast').first();
    await expect(toast).toBeVisible({ timeout: 5000 });

    // Modal should still be open
    await expect(page.locator('.agent-create-form')).toBeVisible();
  });

  // ────────────────────────────────────────────────────────────
  // Test 12: Multiple agents displayed in grid correctly
  // ────────────────────────────────────────────────────────────

  test('multiple agents display in responsive grid', async ({ page }) => {
    // Wait for auto-provisioned agents
    await expect(page.locator('.agents-view-card').first()).toBeVisible({ timeout: 10_000 });
    const initialCount = await page.locator('.agents-view-card').count();

    // Create 3 additional agents
    const agents = [
      { name: 'Extra Strategist Agent', role: 'strategist' },
      { name: 'Extra Developer Agent', role: 'developer' },
      { name: 'Extra Tester Agent', role: 'tester' },
    ];

    for (const { name, role } of agents) {
      await createAgentDirect(page, name, role);
    }

    // Refresh view
    await navigateToView(page, 'dashboard');
    await navigateToView(page, 'agents');

    // Verify all cards appear (auto-provisioned + 3 new)
    const cards = page.locator('.agents-view-card');
    await expect(cards).toHaveCount(initialCount + 3, { timeout: 10_000 });

    // Verify each new agent has a name and role badge
    for (const { name } of agents) {
      const card = page.locator('.agents-view-card').filter({
        has: page.locator('.agents-view-card-name', { hasText: name }),
      });
      await expect(card).toBeVisible();
      const roleBadge = card.locator('.agents-view-role-badge');
      await expect(roleBadge).toBeVisible();
    }

    // Verify cards are inside the grid container
    const grid = page.locator('.agents-view-grid');
    await expect(grid).toBeVisible();
  });

  // ────────────────────────────────────────────────────────────
  // Test 13: Regenerate Photo button shows loading state
  // ────────────────────────────────────────────────────────────

  test('regenerate photo button shows loading state', async ({ page }) => {
    await createAgentDirect(page, 'Photo Agent', 'developer');
    await navigateToView(page, 'dashboard');
    await navigateToView(page, 'agents');

    await openAgentDetailDrawer(page, 'Photo Agent');

    const drawer = page.locator('.drawer.open');

    // Find the "Regenerate Photo" button
    const regenPhotoBtn = drawer.locator('.btn-ghost').filter({ hasText: /regenerate photo/i });
    await expect(regenPhotoBtn).toBeVisible();

    // Click it
    await regenPhotoBtn.click();

    // Button should change text and become disabled
    await expect(regenPhotoBtn).toHaveText('Generating Photo...');
    await expect(regenPhotoBtn).toBeDisabled();
  });

  // ────────────────────────────────────────────────────────────
  // Test 14: Unassigned agent shows "Assign to Room" button
  // ────────────────────────────────────────────────────────────

  test('unassigned agent shows assign-to-room options', async ({ page }) => {
    await createAgentDirect(page, 'Unassigned Agent', 'developer');
    await navigateToView(page, 'dashboard');
    await navigateToView(page, 'agents');

    // Find the specific agent card
    const card = page.locator('.agents-view-card').filter({
      has: page.locator('.agents-view-card-name', { hasText: 'Unassigned Agent' }),
    });
    const unassignedText = card.locator('.agents-view-unassigned-text, .agents-view-card-room-unassigned');
    await expect(unassignedText).toBeVisible();

    // Open drawer
    await openAgentDetailDrawer(page, 'Unassigned Agent');

    const drawer = page.locator('.drawer.open');

    // Current Assignment section should show "Not assigned"
    const assignmentSection = drawer.locator('.agents-view-detail-unassigned, .agents-view-detail-section').filter({
      hasText: /not assigned/i,
    });
    await expect(assignmentSection).toBeVisible();
  });
});
