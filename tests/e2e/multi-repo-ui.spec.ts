/**
 * Overlord v2 — E2E Tests: Multi-Repo UI Picker (#640)
 *
 * Verifies:
 * 1. Repo picker renders in strategist configure step
 * 2. Adding a repo appears in the pending list
 * 3. Invalid URLs show validation error
 * 4. Duplicate URLs are rejected
 * 5. Remove button removes from pending list
 * 6. Linked repos appear in settings panel Folders tab
 */

import { test, expect } from '@playwright/test';
import {
  gotoAppAndConnect,
  createBuildingDirect,
  selectBuilding,
  navigateToView,
} from './helpers/overlord.js';

test.describe('Issue #640: Multi-Repo UI Picker', () => {

  test('#640: repo picker renders in configure step', async ({ page }) => {
    await gotoAppAndConnect(page);
    await navigateToView(page, 'strategist');

    // Click a template card to get to effort step
    const templateCard = page.locator('.template-card').first();
    await templateCard.click();
    await page.waitForTimeout(500);

    // Select effort level (click any option to advance)
    const effortCard = page.locator('.effort-card').first();
    if (await effortCard.isVisible()) {
      await effortCard.click();
      await page.waitForTimeout(500);
    }

    // Should be on configure step — look for repo picker
    const repoLabel = page.locator('.form-label').filter({ hasText: 'Component Repositories' });
    await expect(repoLabel).toBeVisible({ timeout: 5000 });

    // Should have the add row with URL input
    const repoUrlInput = page.locator('.repo-url-input');
    await expect(repoUrlInput).toBeVisible();

    // Should have relationship select
    const relSelect = page.locator('.repo-rel-select');
    await expect(relSelect).toBeVisible();
  });

  test('#640: adding a repo shows it in pending list', async ({ page }) => {
    await gotoAppAndConnect(page);
    await navigateToView(page, 'strategist');

    // Navigate to configure step
    const templateCard = page.locator('.template-card').first();
    await templateCard.click();
    await page.waitForTimeout(500);
    const effortCard = page.locator('.effort-card').first();
    if (await effortCard.isVisible()) {
      await effortCard.click();
      await page.waitForTimeout(500);
    }

    // Type a repo URL
    const repoUrlInput = page.locator('.repo-url-input');
    await repoUrlInput.fill('https://github.com/example/my-lib');

    // Select relationship
    const relSelect = page.locator('.repo-rel-select');
    await relSelect.selectOption('dependency');

    // Click Add
    const addBtn = page.locator('.repo-add-row .btn').filter({ hasText: 'Add' });
    await addBtn.click();

    // Repo should appear in the list
    const repoItem = page.locator('.repo-list-item');
    await expect(repoItem).toBeVisible({ timeout: 3000 });

    // Check name and badge
    const repoName = repoItem.locator('.repo-list-name');
    await expect(repoName).toHaveText('example/my-lib');

    const repoBadge = repoItem.locator('.repo-list-badge');
    await expect(repoBadge).toHaveText('dependency');

    // Input should be cleared
    await expect(repoUrlInput).toHaveValue('');
  });

  test('#640: invalid URL shows validation error', async ({ page }) => {
    await gotoAppAndConnect(page);
    await navigateToView(page, 'strategist');

    // Navigate to configure step
    const templateCard = page.locator('.template-card').first();
    await templateCard.click();
    await page.waitForTimeout(500);
    const effortCard = page.locator('.effort-card').first();
    if (await effortCard.isVisible()) {
      await effortCard.click();
      await page.waitForTimeout(500);
    }

    // Type an invalid URL
    const repoUrlInput = page.locator('.repo-url-input');
    await repoUrlInput.fill('not-a-valid-url');

    // Click Add
    const addBtn = page.locator('.repo-add-row .btn').filter({ hasText: 'Add' });
    await addBtn.click();

    // Should show error
    const errorSpan = page.locator('.repo-error');
    await expect(errorSpan).toBeVisible({ timeout: 2000 });
    await expect(errorSpan).toHaveText('Enter a valid URL');

    // Input should have error class
    await expect(repoUrlInput).toHaveClass(/input-error/);

    // No repo should be in the list
    const repoItem = page.locator('.repo-list-item');
    await expect(repoItem).not.toBeVisible();
  });

  test('#640: duplicate URL is rejected', async ({ page }) => {
    await gotoAppAndConnect(page);
    await navigateToView(page, 'strategist');

    // Navigate to configure step
    const templateCard = page.locator('.template-card').first();
    await templateCard.click();
    await page.waitForTimeout(500);
    const effortCard = page.locator('.effort-card').first();
    if (await effortCard.isVisible()) {
      await effortCard.click();
      await page.waitForTimeout(500);
    }

    const repoUrlInput = page.locator('.repo-url-input');
    const addBtn = page.locator('.repo-add-row .btn').filter({ hasText: 'Add' });

    // Add first repo
    await repoUrlInput.fill('https://github.com/example/dup-test');
    await addBtn.click();
    await expect(page.locator('.repo-list-item')).toHaveCount(1);

    // Try to add same URL again
    await repoUrlInput.fill('https://github.com/example/dup-test');
    await addBtn.click();

    // Should show duplicate error
    const errorSpan = page.locator('.repo-error');
    await expect(errorSpan).toBeVisible({ timeout: 2000 });
    await expect(errorSpan).toHaveText('Repo already added');

    // Still only 1 item
    await expect(page.locator('.repo-list-item')).toHaveCount(1);
  });

  test('#640: remove button removes repo from list', async ({ page }) => {
    await gotoAppAndConnect(page);
    await navigateToView(page, 'strategist');

    // Navigate to configure step
    const templateCard = page.locator('.template-card').first();
    await templateCard.click();
    await page.waitForTimeout(500);
    const effortCard = page.locator('.effort-card').first();
    if (await effortCard.isVisible()) {
      await effortCard.click();
      await page.waitForTimeout(500);
    }

    const repoUrlInput = page.locator('.repo-url-input');
    const addBtn = page.locator('.repo-add-row .btn').filter({ hasText: 'Add' });

    // Add two repos
    await repoUrlInput.fill('https://github.com/example/repo-a');
    await addBtn.click();
    await repoUrlInput.fill('https://github.com/example/repo-b');
    await addBtn.click();
    await expect(page.locator('.repo-list-item')).toHaveCount(2);

    // Remove first one
    const removeBtn = page.locator('.repo-remove-btn').first();
    await removeBtn.click();

    // Should have 1 item left
    await expect(page.locator('.repo-list-item')).toHaveCount(1);

    // The remaining one should be repo-b
    const remaining = page.locator('.repo-list-name');
    await expect(remaining).toHaveText('example/repo-b');
  });

  test('#640: linked repos appear in settings Folders tab', async ({ page }) => {
    await gotoAppAndConnect(page);
    const buildingId = await createBuildingDirect(page, 'Repo Settings Test');
    await selectBuilding(page, buildingId);

    // Add a repo directly via socket
    await page.evaluate(async (bid: string) => {
      return new Promise((resolve) => {
        window.overlordSocket.socket.emit('repo:add', {
          buildingId: bid,
          repoUrl: 'https://github.com/settings-test/my-repo',
          name: 'settings-test/my-repo',
          relationship: 'dependency',
          branch: 'main',
        }, (resp: any) => resolve(resp));
      });
    }, buildingId);

    // Open settings and go to Folders tab
    const settingsBtn = page.locator('[data-action="open-settings"], .toolbar-btn[data-view="settings"]').first();
    await settingsBtn.click();
    await page.waitForTimeout(500);

    const foldersTab = page.locator('.settings-tab').filter({ hasText: /folders/i });
    if (await foldersTab.isVisible()) {
      await foldersTab.click();
      await page.waitForTimeout(500);
    }

    // Look for linked repos section
    const repoSection = page.locator('h4').filter({ hasText: 'Linked Repositories' });
    await expect(repoSection).toBeVisible({ timeout: 5000 });

    // Should show our repo
    const repoItem = page.locator('.settings-repo-list .repo-list-item');
    await expect(repoItem).toBeVisible({ timeout: 5000 });

    const repoName = repoItem.locator('.repo-list-name');
    await expect(repoName).toHaveText('settings-test/my-repo');

    const repoBadge = repoItem.locator('.repo-list-badge');
    await expect(repoBadge).toHaveText('dependency');
  });
});
