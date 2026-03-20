/**
 * Overlord v2 — E2E Test Template: Bug Fix
 *
 * USE THIS TEMPLATE when writing a test for a bug fix.
 * Copy this file to tests/e2e/dogfood-fixes.spec.ts (append to existing)
 * or create a new file: tests/e2e/fix-<issue-number>.spec.ts
 *
 * Pattern:
 *   - Each test reproduces the exact steps that caused the bug
 *   - Verify the fix works (positive case)
 *   - Verify edge cases don't regress (negative cases)
 *   - Reference the GitHub Issue number in the test name
 *
 * Naming convention: fix-<issue>.spec.ts or append to dogfood-fixes.spec.ts
 * Example: fix-598.spec.ts
 */

import { test, expect } from '@playwright/test';
import {
  gotoAppAndConnect,
  navigateToView,
  createBuildingDirect,
  selectBuilding,
  // Import additional helpers as needed
} from './helpers/overlord.js';

// ────────────────────────────────────────────────────────────────
// Bug Fix Tests — Session: [DATE or Sprint]
// ────────────────────────────────────────────────────────────────

test.describe('Bug Fixes: [Session/Sprint Name]', () => {
  let buildingId: string;

  test.beforeEach(async ({ page }) => {
    await gotoAppAndConnect(page);
    buildingId = await createBuildingDirect(page, 'Bug Fix Test');
    await selectBuilding(page, buildingId);
  });

  // ────────────────────────────────────────────────────────────
  // #NNN — [Brief bug description]
  // ────────────────────────────────────────────────────────────

  test('#NNN: [describe expected behavior after fix]', async ({ page }) => {
    // Step 1: Reproduce the preconditions that trigger the bug
    // (navigate to the view, create the entities, set the state)

    // Step 2: Perform the action that previously caused the bug
    // ...

    // Step 3: Assert the bug is fixed — the correct behavior now occurs
    // ...

    // Step 4: Assert no side effects (error toasts, console errors, etc.)
    // const errorToasts = page.locator('#toast-container .toast-error');
    // await expect(errorToasts).toHaveCount(0);
  });

  // ────────────────────────────────────────────────────────────
  // #NNN — [Edge case / regression check]
  // ────────────────────────────────────────────────────────────

  test('#NNN: [edge case] still works after fix', async ({ page }) => {
    // Verify that the fix didn't break related functionality
    // Test a different path through the same code
    // ...
  });
});

// ────────────────────────────────────────────────────────────────
// Pattern: Error Toast Monitoring
// Use this pattern to detect unexpected error cascades during any action.
// ────────────────────────────────────────────────────────────────

test.describe('Bug Fix: Error Cascade Prevention', () => {
  test.beforeEach(async ({ page }) => {
    await gotoAppAndConnect(page);
  });

  test('#NNN: action does not produce error toast cascade', async ({ page }) => {
    // Install error toast counter before the action
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
      const container = document.getElementById('toast-container');
      if (container) observer.observe(container, { childList: true });
    });

    // Perform the action that previously caused error cascades
    // ...

    // Wait for any async side effects
    await page.waitForTimeout(3000);

    // Verify: zero or at most 1 error toast (not a cascade)
    const errorCount = await page.evaluate(() => (window as any).__errorToastCount || 0);
    expect(errorCount).toBeLessThanOrEqual(1);
  });
});

// ────────────────────────────────────────────────────────────────
// Pattern: Console Error Monitoring
// Use this to detect JavaScript errors during specific actions.
// ────────────────────────────────────────────────────────────────

test.describe('Bug Fix: Console Error Prevention', () => {
  test.beforeEach(async ({ page }) => {
    await gotoAppAndConnect(page);
  });

  test('#NNN: action does not throw console errors', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    // Perform the action
    // ...

    await page.waitForTimeout(2000);

    // Filter out known/expected errors (e.g., missing API keys)
    const unexpectedErrors = consoleErrors.filter(
      (e) => !e.includes('API key') && !e.includes('favicon')
    );

    expect(unexpectedErrors).toHaveLength(0);
  });
});
