/**
 * Overlord v2 — Screenshot Capture Script
 *
 * Uses Playwright to capture screenshots of every major view.
 * Requires the dev server running at http://localhost:4000.
 *
 * Usage: node scripts/take-screenshots.cjs
 */

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const BASE_URL = 'http://localhost:4000';
const SCREENSHOT_DIR = path.join(__dirname, '..', 'docs', 'screenshots');
const VIEWPORT = { width: 1440, height: 900 };

async function main() {
  // Ensure output directory exists
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: VIEWPORT });
  const page = await context.newPage();

  console.log('Navigating to Overlord UI...');
  await page.goto(BASE_URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);

  // ── Step 1: Select the "Pulse Dashboard" building ──
  console.log('Selecting "Pulse Dashboard" building...');

  // Find building card with "Pulse Dashboard" text and click its Open button
  // Cards have class: card card-building card-glass/card-solid
  const pulseDashboardCard = page.locator('.card-building').filter({ hasText: 'Pulse Dashboard' }).first();
  let cardFound = (await pulseDashboardCard.count()) > 0;

  if (cardFound) {
    const openBtn = pulseDashboardCard.locator('.card-action-btn', { hasText: 'Open' }).first();
    if ((await openBtn.count()) > 0) {
      await openBtn.click();
      console.log('  Clicked "Open" on Pulse Dashboard card');
    } else {
      await pulseDashboardCard.click();
      console.log('  Clicked Pulse Dashboard card directly');
    }
    await page.waitForTimeout(3000);
  } else {
    // Fallback: try the "Gardenly" building, or any building
    console.log('  "Pulse Dashboard" not found. Trying any available building...');
    const anyCard = page.locator('.card-building').first();
    if ((await anyCard.count()) > 0) {
      const openBtn = anyCard.locator('.card-action-btn', { hasText: 'Open' }).first();
      if ((await openBtn.count()) > 0) {
        await openBtn.click();
      } else {
        await anyCard.click();
      }
      await page.waitForTimeout(3000);
    }
  }

  // ── Step 2: Capture Dashboard (scroll to top first) ──
  console.log('1/10 Capturing Dashboard...');
  // Click dashboard tab to ensure we're on dashboard view
  await page.locator('button[data-view="dashboard"]').first().click();
  await page.waitForTimeout(2000);
  // Scroll center panel to top
  await page.evaluate(() => {
    const cp = document.getElementById('center-panel');
    if (cp) cp.scrollTop = 0;
  });
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'dashboard.png'), fullPage: false });

  // ── Helper: navigate to a view by clicking toolbar button ──
  async function navigateAndCapture(viewName, filename, extraWait = 1500) {
    console.log(`Capturing ${viewName}...`);
    const btn = page.locator(`button[data-view="${viewName}"]`).first();
    const exists = await btn.count();
    if (exists > 0) {
      await btn.click();
      await page.waitForTimeout(extraWait);
      await page.screenshot({ path: path.join(SCREENSHOT_DIR, filename), fullPage: false });
    } else {
      console.log(`  WARNING: No button found for view "${viewName}"`);
    }
  }

  // ── Step 3: Chat view ──
  await navigateAndCapture('chat', 'chat.png', 2000);

  // ── Step 4: Agents view ──
  await navigateAndCapture('agents', 'agents.png', 2000);

  // ── Step 5: Tasks view ──
  await navigateAndCapture('tasks', 'tasks.png', 2000);

  // ── Step 6: Activity view ──
  await navigateAndCapture('activity', 'activity.png', 2000);

  // ── Step 7: Email/Mail view ──
  console.log('Capturing Mail view...');
  const mailBtn = page.locator('button[data-view="email"]').first();
  if ((await mailBtn.count()) > 0) {
    await mailBtn.click();
    await page.waitForTimeout(2000);

    // Click the first non-header email row to show split-pane preview
    const emailRow = page.locator('.email-row:not(.email-row--header)').first();
    if ((await emailRow.count()) > 0) {
      await emailRow.click();
      await page.waitForTimeout(1500);
    }
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'mail.png'), fullPage: false });
  }

  // ── Step 8: RAID Log view ──
  await navigateAndCapture('raid-log', 'raid-log.png', 2000);

  // ── Step 9: Phase Gates view ──
  await navigateAndCapture('phase', 'phases.png', 2000);

  // ── Step 10: Milestones view ──
  await navigateAndCapture('milestones', 'milestones.png', 2000);

  // ── Step 11: Scripts view ──
  await navigateAndCapture('scripts', 'scripts.png', 2000);

  await browser.close();

  // List captured files
  const files = fs.readdirSync(SCREENSHOT_DIR).filter(f => f.endsWith('.png'));
  console.log(`\nDone! Captured ${files.length} screenshots:`);
  files.forEach(f => console.log(`  docs/screenshots/${f}`));
}

main().catch(err => {
  console.error('Screenshot capture failed:', err);
  process.exit(1);
});
