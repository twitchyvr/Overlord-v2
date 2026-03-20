/**
 * Overlord v2 — E2E Test Template: Performance
 *
 * USE THIS TEMPLATE when testing UI performance and responsiveness.
 * Ensures the app remains fast under load and during rapid interactions.
 *
 * Pattern:
 *   - Measure time-to-interactive for views
 *   - Test rapid user interactions don't cause hangs
 *   - Verify large data sets render within acceptable time
 *   - Check for memory leaks during repeated operations
 *
 * Naming convention: performance-<area>.spec.ts
 * Example: performance-agents-view.spec.ts, performance-data-load.spec.ts
 */

import { test, expect } from '@playwright/test';
import {
  gotoAppAndConnect,
  navigateToView,
  createBuildingDirect,
  selectBuilding,
  createAgentDirect,
  createTaskDirect,
} from './helpers/overlord.js';

// ────────────────────────────────────────────────────────────────
// Performance: [AREA NAME]
// ────────────────────────────────────────────────────────────────

test.describe('Performance: [Area Name]', () => {
  let buildingId: string;

  test.beforeEach(async ({ page }) => {
    await gotoAppAndConnect(page);
    buildingId = await createBuildingDirect(page, 'Perf Test Building');
    await selectBuilding(page, buildingId);
  });

  // ═══════════════════════════════════════════════════════════
  // Section 1: Time-to-Interactive
  // ═══════════════════════════════════════════════════════════

  test('view renders within acceptable time (< 3s)', async ({ page }) => {
    const start = Date.now();

    await navigateToView(page, 'agents');

    const view = page.locator('.view-container.view-agents');
    await expect(view).toBeVisible({ timeout: 3000 });

    const elapsed = Date.now() - start;
    console.log(`View render time: ${elapsed}ms`);
    expect(elapsed).toBeLessThan(3000);
  });

  test('app boots and connects within 10 seconds', async ({ page }) => {
    const start = Date.now();

    await page.goto('http://localhost:4000', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#toolbar-connection.connected', { timeout: 10_000 });
    await page.waitForSelector('#loading-state', { state: 'detached', timeout: 10_000 });

    const elapsed = Date.now() - start;
    console.log(`App boot time: ${elapsed}ms`);
    expect(elapsed).toBeLessThan(10_000);
  });

  // ═══════════════════════════════════════════════════════════
  // Section 2: Large Data Sets
  // ═══════════════════════════════════════════════════════════

  test('handles 20 agents without performance degradation', async ({ page }) => {
    // Create 20 agents
    const createPromises = [];
    for (let i = 0; i < 20; i++) {
      createPromises.push(createAgentDirect(page, `Perf Agent ${i}`, 'developer'));
    }

    // Navigate to agents view
    await navigateToView(page, 'agents');

    const start = Date.now();

    // Wait for all cards to render
    await navigateToView(page, 'dashboard');
    await navigateToView(page, 'agents');

    const cards = page.locator('.agents-view-card');
    await expect(cards.first()).toBeVisible({ timeout: 10_000 });

    const count = await cards.count();
    const elapsed = Date.now() - start;

    console.log(`Rendered ${count} agent cards in ${elapsed}ms`);
    expect(count).toBeGreaterThanOrEqual(20);
    expect(elapsed).toBeLessThan(5000);
  });

  test('handles 50 tasks without performance degradation', async ({ page }) => {
    // Create 50 tasks
    for (let i = 0; i < 50; i++) {
      await createTaskDirect(page, buildingId, `Perf Task ${i}`, '', 'normal');
    }

    const start = Date.now();

    await navigateToView(page, 'tasks');

    const cards = page.locator('.card-task, .task-card-grid .card');
    await expect(cards.first()).toBeVisible({ timeout: 15_000 });

    const count = await cards.count();
    const elapsed = Date.now() - start;

    console.log(`Rendered ${count} task cards in ${elapsed}ms`);
    expect(count).toBeGreaterThanOrEqual(50);
    expect(elapsed).toBeLessThan(10_000);
  });

  // ═══════════════════════════════════════════════════════════
  // Section 3: Rapid Interactions
  // ═══════════════════════════════════════════════════════════

  test('rapid tab switching does not hang the UI', async ({ page }) => {
    // Create some data first
    await createAgentDirect(page, 'Tab Test Agent', 'developer');
    await createTaskDirect(page, buildingId, 'Tab Test Task', '', 'normal');

    // Rapidly switch between views
    const views: Array<'dashboard' | 'agents' | 'tasks' | 'activity'> = [
      'dashboard', 'agents', 'tasks', 'activity',
      'dashboard', 'agents', 'tasks', 'activity',
      'dashboard', 'agents',
    ];

    const start = Date.now();

    for (const view of views) {
      await navigateToView(page, view);
      await page.waitForTimeout(100); // Minimal settle time
    }

    const elapsed = Date.now() - start;
    console.log(`10 view switches in ${elapsed}ms`);

    // Should complete without hanging — UI should still be responsive
    const lastView = page.locator('.view-container.view-agents');
    await expect(lastView).toBeVisible({ timeout: 5000 });

    // Total time should be reasonable (< 15s for 10 switches)
    expect(elapsed).toBeLessThan(15_000);
  });

  test('rapid modal open/close does not leak handlers', async ({ page }) => {
    await navigateToView(page, 'agents');

    // Rapidly open and close the create agent modal
    for (let i = 0; i < 5; i++) {
      const createBtn = page.locator('.agents-view .btn-primary').filter({ hasText: /create agent/i });
      await createBtn.click();

      await page.waitForSelector('.agent-create-form', { timeout: 5000 });
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
    }

    // UI should still be responsive after 5 cycles
    const createBtn = page.locator('.agents-view .btn-primary').filter({ hasText: /create agent/i });
    await expect(createBtn).toBeVisible();
    await expect(createBtn).toBeEnabled();
  });

  // ═══════════════════════════════════════════════════════════
  // Section 4: Network Performance
  // ═══════════════════════════════════════════════════════════

  test('socket operations complete within 2 seconds', async ({ page }) => {
    const start = Date.now();

    // Create entity via socket
    const result = await page.evaluate(async (bid: string) => {
      if (!window.overlordSocket) throw new Error('Socket not connected');
      const res = await window.overlordSocket.createTask({
        buildingId: bid,
        title: 'Perf Socket Task',
        priority: 'normal',
      });
      return res;
    }, buildingId);

    const elapsed = Date.now() - start;
    console.log(`Socket create operation: ${elapsed}ms`);

    expect(result?.ok).toBe(true);
    expect(elapsed).toBeLessThan(2000);
  });
});
