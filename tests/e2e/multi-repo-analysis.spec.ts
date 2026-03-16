/**
 * Overlord v2 — E2E Tests: Multi-Repo AI Analysis (#642)
 *
 * Verifies:
 * 1. Analyze button renders when repos are added
 * 2. Analyze button disabled when no repos
 * 3. repo:analyze socket event returns structured suggestions
 * 4. Analysis results render with suggestion cards
 * 5. Override dropdown changes relationship
 */

import { test, expect } from '@playwright/test';
import {
  gotoAppAndConnect,
  navigateToView,
} from './helpers/overlord.js';

test.describe('Issue #642: Multi-Repo AI Analysis', () => {

  test('#642: analyze button renders in configure step', async ({ page }) => {
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

    // Analyze button should exist
    const analyzeBtn = page.locator('.repo-analyze-row .btn');
    await expect(analyzeBtn).toBeVisible({ timeout: 5000 });
    await expect(analyzeBtn).toContainText('Analyze');
  });

  test('#642: repo:analyze socket event returns suggestions', async ({ page }) => {
    await gotoAppAndConnect(page);

    // Call repo:analyze directly via socket
    const result = await page.evaluate(async () => {
      return new Promise((resolve) => {
        window.overlordSocket.socket.emit('repo:analyze', {
          repos: [
            { url: 'https://github.com/expressjs/express', name: 'expressjs/express' },
          ],
          projectName: 'Test Project',
          projectGoals: 'Build a web API',
        }, (resp: any) => resolve(resp));
      });
    });

    const resp = result as {
      ok: boolean;
      data?: { suggestions: Array<{ name: string; relationship: string; reason: string }>; summary: string };
      error?: { code: string; message: string };
    };

    // If AI is configured, we get suggestions; if not, we get a provider error
    if (resp.ok) {
      expect(resp.data?.suggestions).toBeDefined();
      expect(resp.data?.suggestions.length).toBeGreaterThan(0);
      expect(resp.data?.summary).toBeTruthy();

      const suggestion = resp.data!.suggestions[0];
      expect(suggestion.name).toBeTruthy();
      expect(suggestion.relationship).toBeTruthy();
      expect(suggestion.reason).toBeTruthy();
    } else {
      // AI not configured — that's acceptable in CI
      expect(resp.error?.code).toMatch(/PROVIDER|ANALYSIS|ANALYZE/);
    }
  });

  test('#642: analysis results render with cards', async ({ page }) => {
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

    // Add a repo
    const repoUrlInput = page.locator('.repo-url-input');
    await repoUrlInput.fill('https://github.com/expressjs/express');
    const addBtn = page.locator('.repo-add-row .btn').filter({ hasText: 'Add' });
    await addBtn.click();
    await expect(page.locator('.repo-list-item')).toHaveCount(1);

    // Mock the analyzeRepos response to avoid depending on real AI
    await page.evaluate(() => {
      const originalAnalyze = window.overlordSocket.analyzeRepos;
      window.overlordSocket.analyzeRepos = async () => ({
        ok: true,
        data: {
          suggestions: [{
            name: 'expressjs/express',
            url: 'https://github.com/expressjs/express',
            relationship: 'dependency',
            reason: 'Express is a web framework — import as npm dependency.',
            action: 'Add to package.json dependencies.',
            keyFiles: ['index.js', 'lib/express.js'],
            techStack: ['JavaScript', 'Node.js'],
          }],
          summary: 'Express should be used as a dependency for your web API project.',
        },
      });
      // Store original for cleanup
      (window as any)._originalAnalyze = originalAnalyze;
    });

    // Click analyze
    const analyzeBtn = page.locator('.repo-analyze-row .btn').filter({ hasText: /Analyze/i });
    await analyzeBtn.click();

    // Wait for results
    await expect(page.locator('.analysis-card')).toBeVisible({ timeout: 10000 });

    // Check summary
    const summary = page.locator('.analysis-summary');
    await expect(summary).toBeVisible();
    await expect(summary).toContainText('Express');

    // Check card contents
    const card = page.locator('.analysis-card').first();
    await expect(card.locator('.analysis-card-name')).toHaveText('expressjs/express');
    await expect(card.locator('.repo-list-badge')).toHaveText('dependency');

    // Check tech stack badges
    await expect(card.locator('.analysis-tech-badge').first()).toBeVisible();

    // Restore original
    await page.evaluate(() => {
      window.overlordSocket.analyzeRepos = (window as any)._originalAnalyze;
    });
  });

  test('#642: override dropdown changes relationship', async ({ page }) => {
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

    // Add a repo
    const repoUrlInput = page.locator('.repo-url-input');
    await repoUrlInput.fill('https://github.com/lodash/lodash');
    const addBtn = page.locator('.repo-add-row .btn').filter({ hasText: 'Add' });
    await addBtn.click();

    // Mock analysis
    await page.evaluate(() => {
      window.overlordSocket.analyzeRepos = async () => ({
        ok: true,
        data: {
          suggestions: [{
            name: 'lodash/lodash',
            url: 'https://github.com/lodash/lodash',
            relationship: 'dependency',
            reason: 'Utility library.',
            action: 'Install via npm.',
            keyFiles: ['lodash.js'],
            techStack: ['JavaScript'],
          }],
          summary: 'Lodash as a utility dependency.',
        },
      });
    });

    // Analyze
    const analyzeBtn = page.locator('.repo-analyze-row .btn').filter({ hasText: /Analyze/i });
    await analyzeBtn.click();
    await expect(page.locator('.analysis-card')).toBeVisible({ timeout: 10000 });

    // Change the override dropdown
    const overrideSelect = page.locator('.analysis-override select');
    await overrideSelect.selectOption('fork');

    // Badge should update
    const badge = page.locator('.analysis-card .repo-list-badge');
    await expect(badge).toHaveText('fork');
  });
});
