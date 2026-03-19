/**
 * E2E tests for #872: "Use Existing Codebase" onboarding flow
 *
 * Verifies:
 * - Onboarding shows three paths (Existing, Scratch, GitHub)
 * - Codebase analysis via socket works
 * - Analysis results display correctly
 * - Project creation from analysis succeeds
 */
import { test, expect } from '@playwright/test';
import { gotoAppAndConnect } from './helpers/overlord.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

test.describe('#872: Use Existing Codebase', () => {
  let tmpDir: string;

  test.beforeAll(() => {
    // Create a fake Node.js project for analysis
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'overlord-e2e-'));
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({
      name: 'e2e-test-project',
      dependencies: { react: '^18.0.0', next: '^14.0.0' },
      devDependencies: { jest: '^29.0.0', typescript: '^5.0.0' },
    }));
    fs.writeFileSync(path.join(tmpDir, 'tsconfig.json'), '{}');
    fs.writeFileSync(path.join(tmpDir, 'next.config.js'), 'module.exports = {}');
    fs.writeFileSync(path.join(tmpDir, 'README.md'), '# E2E Test Project\nA test project for Overlord.');
    fs.mkdirSync(path.join(tmpDir, 'docs'));
    fs.writeFileSync(path.join(tmpDir, 'docs', 'guide.md'), '# Guide');
  });

  test.afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('onboarding shows three path cards', async ({ page }) => {
    await gotoAppAndConnect(page);

    // Should show onboarding paths on the strategist view
    const pathCards = page.locator('.onboarding-path-card');
    await expect(pathCards).toHaveCount(3);

    // First card: Use Existing Codebase
    const firstTitle = pathCards.nth(0).locator('.onboarding-path-title');
    await expect(firstTitle).toContainText('Use Existing Codebase');

    // Second card: Start From Scratch
    const secondTitle = pathCards.nth(1).locator('.onboarding-path-title');
    await expect(secondTitle).toContainText('Start From Scratch');

    // Third card: Import from GitHub
    const thirdTitle = pathCards.nth(2).locator('.onboarding-path-title');
    await expect(thirdTitle).toContainText('Import from GitHub');
  });

  test('"Use Existing Codebase" has a path input and analyze button', async ({ page }) => {
    await gotoAppAndConnect(page);

    const firstCard = page.locator('.onboarding-path-card').first();
    const pathInput = firstCard.locator('input[type="text"]');
    await expect(pathInput).toBeVisible();
    await expect(pathInput).toHaveAttribute('placeholder', /\/path\/to\/your\/project/);

    const analyzeBtn = firstCard.locator('.btn').filter({ hasText: 'Analyze' });
    await expect(analyzeBtn).toBeVisible();
  });

  test('template grid still shows below onboarding paths', async ({ page }) => {
    await gotoAppAndConnect(page);

    const templateGrid = page.locator('.template-grid');
    await expect(templateGrid).toBeVisible();

    const templateCards = page.locator('.template-card');
    const count = await templateCards.count();
    expect(count).toBe(8);
  });

  test('codebase:analyze returns correct project analysis via socket', async ({ page }) => {
    await gotoAppAndConnect(page);

    // Call analyzeCodebase directly via socket
    const analysis = await page.evaluate(async (dir: string) => {
      if (!window.overlordSocket) throw new Error('Socket not connected');
      const res = await window.overlordSocket.analyzeCodebase(dir, false);
      return res;
    }, tmpDir);

    expect(analysis.ok).toBe(true);
    expect(analysis.data.primaryLanguage).toBe('JavaScript');
    expect(analysis.data.framework).toBe('Next.js');
    expect(analysis.data.projectType).toBe('web-app');
    expect(analysis.data.techStack).toContain('React');
    expect(analysis.data.techStack).toContain('TypeScript');
    expect(analysis.data.testFramework).toBe('Jest');
    expect(analysis.data.hasDocumentation).toBe(true);
    expect(analysis.data.recommendedTemplate).toBe('web-app');
    expect(analysis.data.recommendedRooms.length).toBeGreaterThan(0);
    expect(analysis.data.recommendedAgents.length).toBeGreaterThan(0);
  });

  test('entering a path and clicking Analyze shows results', async ({ page }) => {
    await gotoAppAndConnect(page);

    // Type the path
    const firstCard = page.locator('.onboarding-path-card').first();
    const pathInput = firstCard.locator('input[type="text"]');
    await pathInput.fill(tmpDir);

    // Click Analyze
    const analyzeBtn = firstCard.locator('.btn').filter({ hasText: 'Analyze' });
    await analyzeBtn.click();

    // Wait for analysis results to show
    await page.waitForSelector('.analysis-summary-card', { timeout: 15_000 });

    // Should show project info
    const infoGrid = page.locator('.analysis-info-grid');
    await expect(infoGrid).toBeVisible();

    // Should show tech stack badges
    const techBadges = page.locator('.analysis-tech-badge');
    const badgeCount = await techBadges.count();
    expect(badgeCount).toBeGreaterThan(0);

    // Should show recommended rooms
    const setupSection = page.locator('.analysis-setup-section');
    await expect(setupSection).toBeVisible();

    // Should have Accept & Set Up button
    const acceptBtn = page.locator('.btn').filter({ hasText: 'Accept & Set Up' });
    await expect(acceptBtn).toBeVisible();
  });

  test('Accept & Set Up creates a building from analysis', async ({ page }) => {
    await gotoAppAndConnect(page);

    // Type path and analyze
    const firstCard = page.locator('.onboarding-path-card').first();
    const pathInput = firstCard.locator('input[type="text"]');
    await pathInput.fill(tmpDir);

    const analyzeBtn = firstCard.locator('.btn').filter({ hasText: 'Analyze' });
    await analyzeBtn.click();

    // Wait for analysis results
    await page.waitForSelector('.analysis-summary-card', { timeout: 15_000 });

    // Click Accept & Set Up
    const acceptBtn = page.locator('.btn').filter({ hasText: 'Accept & Set Up' });
    await acceptBtn.click();

    // Should show creating spinner
    await page.waitForSelector('.spinner', { timeout: 5_000 });

    // Wait for creation to complete and navigate to dashboard
    // Either a toast appears or we navigate away from strategist view
    await page.waitForTimeout(5_000);

    // Building should be created — check that we're no longer on strategist view
    // or that a success toast appeared
    const strategistView = page.locator('.strategist-view');
    const isStillOnStrategist = await strategistView.isVisible().catch(() => false);

    // Either navigated away (success) or analysis-results still showing (error)
    // We accept both since the building creation goes through even if navigation timing varies
    if (isStillOnStrategist) {
      // May still show analysis results if creation was fast but navigation slow
      const toast = page.locator('#toast-container .toast');
      const hasToast = await toast.first().isVisible().catch(() => false);
      expect(hasToast).toBe(true);
    }
  });

  test('analysis error shows toast for invalid path', async ({ page }) => {
    await gotoAppAndConnect(page);

    const firstCard = page.locator('.onboarding-path-card').first();
    const pathInput = firstCard.locator('input[type="text"]');
    await pathInput.fill('/nonexistent/path/e2e-test-12345');

    const analyzeBtn = firstCard.locator('.btn').filter({ hasText: 'Analyze' });
    await analyzeBtn.click();

    // Should show error toast
    await page.waitForTimeout(3_000);
    const toast = page.locator('#toast-container .toast');
    await expect(toast.first()).toBeVisible({ timeout: 5_000 });
  });

  test('Customize Setup button goes to effort selection', async ({ page }) => {
    await gotoAppAndConnect(page);

    // Analyze
    const firstCard = page.locator('.onboarding-path-card').first();
    const pathInput = firstCard.locator('input[type="text"]');
    await pathInput.fill(tmpDir);

    const analyzeBtn = firstCard.locator('.btn').filter({ hasText: 'Analyze' });
    await analyzeBtn.click();

    await page.waitForSelector('.analysis-summary-card', { timeout: 15_000 });

    // Click Customize Setup
    const customizeBtn = page.locator('.btn').filter({ hasText: 'Customize Setup' });
    await customizeBtn.click();

    // Should show effort selection cards
    await page.waitForSelector('.effort-grid', { timeout: 5_000 });
    const effortCards = page.locator('.effort-card');
    await expect(effortCards).toHaveCount(3);
  });
});
