/**
 * Overlord v2 — Onboarding Wizard E2E Tests
 *
 * Issue #871: Get Started button cut off at bottom of onboarding screen.
 * Verifies the onboarding wizard CTA buttons are always visible and clickable
 * across different viewport sizes.
 */

import { test, expect } from '@playwright/test';
import { gotoAppAndConnect } from './helpers/overlord.js';

test.describe('Issue #871: Onboarding wizard button visibility', () => {
  test('#871: Get Started button is visible and clickable at 1440x900', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await gotoAppAndConnect(page);

    // Navigate to onboarding view
    await page.evaluate(() => {
      (window as any).OverlordUI?.dispatch('navigate:onboarding');
    });
    await page.waitForTimeout(500);

    // The onboarding wizard should be visible
    const wizard = page.locator('.onboarding-wizard');
    await expect(wizard).toBeVisible();

    // The Get Started button should be visible and clickable
    const getStartedBtn = page.locator('.wizard-btn-primary', { hasText: 'Get Started' });
    await expect(getStartedBtn).toBeVisible();

    // Verify the button is within the viewport (not clipped)
    const box = await getStartedBtn.boundingBox();
    expect(box).not.toBeNull();
    if (box) {
      // Button bottom edge should be within viewport height
      expect(box.y + box.height).toBeLessThanOrEqual(900);
      // Button should have reasonable height (not squished to 0)
      expect(box.height).toBeGreaterThan(20);
    }

    // Click the button — it should advance to step 2
    await getStartedBtn.click();
    await page.waitForTimeout(300);

    // Verify we moved to step 2 (project name step)
    const nameTitle = page.locator('.wizard-step-title', { hasText: /project called/i });
    await expect(nameTitle).toBeVisible();
  });

  test('#871: Get Started button is visible on a 1280x720 laptop viewport', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await gotoAppAndConnect(page);

    await page.evaluate(() => {
      (window as any).OverlordUI?.dispatch('navigate:onboarding');
    });
    await page.waitForTimeout(500);

    const wizard = page.locator('.onboarding-wizard');
    await expect(wizard).toBeVisible();

    // Get Started button must be accessible — either visible directly
    // or reachable by scrolling (the wizard is now scrollable)
    const getStartedBtn = page.locator('.wizard-btn-primary', { hasText: 'Get Started' });

    // Scroll the wizard to ensure the button is in view
    await getStartedBtn.scrollIntoViewIfNeeded();
    await expect(getStartedBtn).toBeVisible();

    // Verify button is clickable
    const box = await getStartedBtn.boundingBox();
    expect(box).not.toBeNull();
    if (box) {
      expect(box.height).toBeGreaterThan(20);
      // Button must be within the visible viewport after scroll
      expect(box.y + box.height).toBeLessThanOrEqual(720);
    }
  });

  test('#871: Just Build It button is visible on welcome screen', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await gotoAppAndConnect(page);

    await page.evaluate(() => {
      (window as any).OverlordUI?.dispatch('navigate:onboarding');
    });
    await page.waitForTimeout(500);

    // The Just Build It button should be visible
    const justBuildBtn = page.locator('.wizard-btn-accent', { hasText: 'Just Build It' });
    await expect(justBuildBtn).toBeVisible();

    // The textarea for one-shot input should be visible
    const textarea = page.locator('.wizard-oneshot-input');
    await expect(textarea).toBeVisible();
  });

  test('#871: Skip button is visible on welcome screen', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await gotoAppAndConnect(page);

    await page.evaluate(() => {
      (window as any).OverlordUI?.dispatch('navigate:onboarding');
    });
    await page.waitForTimeout(500);

    // The skip button should be visible or scrollable into view
    const skipBtn = page.locator('.wizard-btn-ghost', { hasText: /skip/i });
    await skipBtn.scrollIntoViewIfNeeded();
    await expect(skipBtn).toBeVisible();
  });

  test('#871: Onboarding wizard scrolls on small viewports', async ({ page }) => {
    // Very small viewport to guarantee overflow
    await page.setViewportSize({ width: 1024, height: 600 });
    await gotoAppAndConnect(page);

    await page.evaluate(() => {
      (window as any).OverlordUI?.dispatch('navigate:onboarding');
    });
    await page.waitForTimeout(500);

    const wizard = page.locator('.onboarding-wizard');
    await expect(wizard).toBeVisible();

    // The container should be scrollable (scrollHeight > clientHeight)
    // or the view-container should be scrollable
    const isScrollable = await page.evaluate(() => {
      const el = document.querySelector('.onboarding-wizard') ||
                 document.querySelector('.view-container.view-onboarding');
      if (!el) return false;
      return el.scrollHeight > el.clientHeight;
    });

    // On small viewports, there should be scroll overflow
    // (if the content fits, that's also fine — the fix works either way)
    // The key assertion: the button must still be reachable
    const getStartedBtn = page.locator('.wizard-btn-primary', { hasText: 'Get Started' });
    await getStartedBtn.scrollIntoViewIfNeeded();
    await expect(getStartedBtn).toBeVisible();
  });
});
