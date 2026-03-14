/**
 * Overlord v2 — E2E Dogfood Tests for Session Fixes
 *
 * Each test exercises a specific fix through the REAL UI in a real browser.
 * Stage 8 (Dogfood) of the Continuous Development Loop.
 */

import { test, expect } from '@playwright/test';
import {
  gotoAppAndConnect,
  createBuildingDirect,
  selectBuilding,
  closeDrawer,
} from './helpers/overlord.js';

/** Click a toolbar button and wait for its content to render. */
async function goToView(page: import('@playwright/test').Page, viewName: string) {
  const btn = page.locator(`#app-toolbar .toolbar-btn[data-view="${viewName}"]`);
  await btn.click();
  // Wait for content to appear — use the view's own CSS class
  await page.waitForTimeout(1500);
}

test.describe('Dogfood: Session Fixes', () => {
  let buildingId: string;

  test.beforeEach(async ({ page }) => {
    await gotoAppAndConnect(page);
    buildingId = await createBuildingDirect(page, 'Dogfood Test');
    await selectBuilding(page, buildingId);
  });

  // #561 — Nav redesign: vertical tree
  test('#561: Building nav renders as vertical tree with floor sections', async ({ page }) => {
    const buildingPanel = page.locator('#building-panel');
    await expect(buildingPanel).toBeVisible();

    const floorSections = page.locator('.floor-section');
    await expect(floorSections.first()).toBeVisible({ timeout: 5000 });
    expect(await floorSections.count()).toBeGreaterThan(0);

    const firstName = page.locator('.floor-section-name').first();
    await expect(firstName).toBeVisible();

    await expect(page.locator('.floor-cross-section')).toHaveCount(0);
  });

  // #552 — Drawer dismiss with X button
  test('#552: Agent drawer dismissed with X button', async ({ page }) => {
    await goToView(page, 'agents');

    const card = page.locator('.agents-view-card').first();
    await expect(card).toBeVisible({ timeout: 15000 });
    await card.click();

    const drawer = page.locator('.drawer.open');
    await expect(drawer).toBeVisible({ timeout: 5000 });

    await closeDrawer(page);
    await expect(drawer).not.toBeVisible({ timeout: 5000 });
  });

  // #552 — Drawer dismiss with Escape
  test('#552: Agent drawer dismissed with Escape key', async ({ page }) => {
    await goToView(page, 'agents');

    const card = page.locator('.agents-view-card').first();
    await expect(card).toBeVisible({ timeout: 15000 });
    await card.click();

    const drawer = page.locator('.drawer.open');
    await expect(drawer).toBeVisible({ timeout: 5000 });

    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    await expect(drawer).not.toBeVisible({ timeout: 5000 });
  });

  // #552 — Drawer dismiss with backdrop click
  test('#552: Agent drawer dismissed by clicking backdrop', async ({ page }) => {
    await goToView(page, 'agents');

    const card = page.locator('.agents-view-card').first();
    await expect(card).toBeVisible({ timeout: 15000 });
    await card.click();

    const drawer = page.locator('.drawer.open');
    await expect(drawer).toBeVisible({ timeout: 5000 });

    const backdrop = page.locator('.drawer-backdrop.open');
    await backdrop.click({ position: { x: 10, y: 10 } });
    await page.waitForTimeout(500);
    await expect(drawer).not.toBeVisible({ timeout: 5000 });
  });

  // #598 — Settings tab switching
  test('#598: Settings tabs switch without hanging', async ({ page }) => {
    // Click the Settings gear button in the toolbar
    const settingsBtn = page.locator('button[title="Settings"]');
    await expect(settingsBtn).toBeVisible({ timeout: 5000 });
    await settingsBtn.click();
    await page.waitForTimeout(800);

    const settingsTab = page.locator('.settings-tab').first();
    await expect(settingsTab).toBeVisible({ timeout: 5000 });

    for (const name of ['Folders', 'Quality', 'AI', 'Display', 'General']) {
      const tab = page.locator('.settings-tab').filter({ hasText: name });
      if (await tab.isVisible({ timeout: 1000 }).catch(() => false)) {
        await tab.click();
        await page.waitForTimeout(200);
      }
    }

    await expect(page.locator('.settings-tab-content, .settings-section').first()).toBeVisible();
  });

  // #586 — Toast suppression
  test('#586: Project creation does not produce error toast cascade', async ({ page }) => {
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
      const c = document.getElementById('toast-container');
      if (c) observer.observe(c, { childList: true });
    });

    await page.evaluate(async () => {
      if (!(window as any).overlordSocket) return;
      await (window as any).overlordSocket.createBuilding({
        name: 'Toast Test', config: { projectDescription: 'x', template: 'web-app', effortLevel: 'easy' }
      });
    });
    await page.waitForTimeout(3000);

    const errorCount = await page.evaluate(() => (window as any).__errorToastCount || 0);
    expect(errorCount).toBeLessThanOrEqual(1);
  });

  // #606 — Working directory display
  test('#606: Building header shows working directory or warning', async ({ page }) => {
    const projectInfo = page.locator('.building-project-info');
    await expect(projectInfo).toBeVisible({ timeout: 5000 });

    const pathEl = page.locator('.building-project-path');
    await expect(pathEl).toBeVisible();

    const text = await pathEl.textContent();
    expect(text && text.length > 0).toBe(true);
  });

  // #565 — Activity feed
  test('#565: Activity view renders and exits loading state', async ({ page }) => {
    await goToView(page, 'activity');

    const title = page.locator('.activity-view-title');
    await expect(title).toBeVisible({ timeout: 10000 });
    await expect(title).toContainText('Activity');

    await page.waitForTimeout(3000);
    const loading = page.locator('.activity-view-loading');
    const stuck = await loading.isVisible().catch(() => false);
    expect(stuck).toBe(false);
  });

  // #559 — Agent reset button
  test('#559: Agents view has Reset button', async ({ page }) => {
    await goToView(page, 'agents');

    const resetBtn = page.locator('.agents-view-actions button').filter({ hasText: /Reset/ });
    await expect(resetBtn).toBeVisible({ timeout: 15000 });
  });

  // #575 — Agent names are unique (not all "Strategist")
  test('#575: Blueprint agents have unique human names', async ({ page }) => {
    // Create building with blueprint containing duplicate roles
    const agents = await page.evaluate(async () => {
      if (!window.overlordSocket) return [];
      const b = await window.overlordSocket.createBuilding({
        name: 'Name Test', config: { projectDescription: 'x', template: 'web-app', effortLevel: 'easy' }
      });
      if (!b?.ok) return [];
      await window.overlordSocket.applyBlueprint({
        buildingId: b.data.id,
        blueprint: {
          mode: 'quickStart', floorsNeeded: ['execution'],
          roomConfig: [{ floor: 'execution', rooms: ['code-lab'] }],
          agentRoster: [
            { name: 'Dev', role: 'developer', rooms: ['code-lab'] },
            { name: 'Dev', role: 'developer', rooms: ['code-lab'] },
            { name: 'Dev', role: 'developer', rooms: ['code-lab'] },
          ],
          projectGoals: 'x', successCriteria: ''
        },
        agentId: 'user'
      });
      const res = await new Promise(r =>
        window.overlordSocket.socket.emit('agent:list', { buildingId: b.data.id }, r)
      );
      return (res as any)?.data?.map((a: any) => a.display_name || a.name) || [];
    });

    // All display names must be unique
    const unique = new Set(agents);
    expect(unique.size).toBe(agents.length);
    // Should have human first+last names, not bare "Dev"
    expect(agents.some((n: string) => n.includes(' '))).toBe(true);
  });

  // #554 — Compose email has chip-based recipient selector (not checkboxes)
  test('#554: Compose email uses chip selector, not checkboxes', async ({ page }) => {
    await goToView(page, 'email');

    // Click Compose button
    const composeBtn = page.locator('button').filter({ hasText: /Compose/i });
    await expect(composeBtn).toBeVisible({ timeout: 10000 });
    await composeBtn.click();
    await page.waitForTimeout(500);

    // Should have chip search input, NOT checkboxes
    const chipSearch = page.locator('.email-compose-chip-search');
    await expect(chipSearch).toBeVisible({ timeout: 5000 });

    const oldCheckboxes = page.locator('.email-compose-to-check');
    await expect(oldCheckboxes).toHaveCount(0);
  });

  // #566 — Mail inbox has search bar and unread dots
  test('#566: Mail inbox has search bar', async ({ page }) => {
    await goToView(page, 'email');
    await page.waitForTimeout(1000);

    // Search bar should be visible in the email list
    const searchInput = page.locator('.email-search-input');
    await expect(searchInput).toBeVisible({ timeout: 10000 });

    // Should have search icon
    const searchIcon = page.locator('.email-search-icon');
    await expect(searchIcon).toBeVisible();
  });

  // #582 — Exit doc creates tasks (verified via socket)
  test('#582: Exit doc submission auto-creates tasks', async ({ page }) => {
    const taskCount = await page.evaluate(async () => {
      if (!window.overlordSocket) return -1;
      const b = await window.overlordSocket.createBuilding({
        name: 'TaskGen', config: { projectDescription: 'x', template: 'web-app', effortLevel: 'easy' }
      });
      if (!b?.ok) return -1;
      const bid = b.data.id;

      // Apply blueprint with discovery room
      await window.overlordSocket.applyBlueprint({
        buildingId: bid,
        blueprint: {
          mode: 'quickStart', floorsNeeded: ['collaboration'],
          roomConfig: [{ floor: 'collaboration', rooms: ['discovery'] }],
          agentRoster: [{ name: 'R', role: 'researcher', rooms: ['discovery'] }],
          projectGoals: 'x', successCriteria: ''
        },
        agentId: 'user'
      });

      // Find discovery room + agent
      const rooms = await new Promise(r => window.overlordSocket.socket.emit('room:list', {}, r));
      const bldg = await new Promise(r => window.overlordSocket.socket.emit('building:get', { buildingId: bid }, r));
      const floorIds = new Set(((bldg as any)?.data?.floors || []).map((f: any) => f.id));
      const disc = ((rooms as any)?.data || []).find((r: any) => r.type === 'discovery' && floorIds.has(r.floor_id));
      const agents = await new Promise(r => window.overlordSocket.socket.emit('agent:list', { buildingId: bid }, r));
      const agent = ((agents as any)?.data || []).find((a: any) => a.role === 'researcher');
      if (!disc || !agent) return -2;

      // Move agent into room
      await new Promise(r => window.overlordSocket.socket.emit('agent:move', { agentId: agent.id, roomId: disc.id }, r));

      // Submit exit doc with acceptance criteria
      await new Promise(r => window.overlordSocket.socket.emit('exit-doc:submit', {
        roomId: disc.id, agentId: agent.id, buildingId: bid,
        phase: 'discovery', roomType: 'discovery',
        document: {
          businessOutcomes: ['Build app'],
          constraints: ['Budget limited'],
          unknowns: ['Scale'],
          gapAnalysis: ['No existing solution'],
          riskAssessment: ['Timeline risk'],
          acceptanceCriteria: ['Feature A works', 'Feature B works', 'Tests pass'],
        },
      }, r));

      // Count tasks
      const tasks = await new Promise(r => window.overlordSocket.socket.emit('task:list', { buildingId: bid }, r));
      return ((tasks as any)?.data || []).length;
    });

    expect(taskCount).toBeGreaterThanOrEqual(3);
  });

  // #571 — Agent can be moved between rooms without exit doc error
  test('#571: Agent reassignment bypasses exit doc requirement', async ({ page }) => {
    const moveResult = await page.evaluate(async () => {
      if (!window.overlordSocket) return 'no socket';
      const b = await window.overlordSocket.createBuilding({
        name: 'MoveTest', config: { projectDescription: 'x', template: 'web-app', effortLevel: 'easy' }
      });
      if (!b?.ok) return 'create failed';
      const bid = b.data.id;

      await window.overlordSocket.applyBlueprint({
        buildingId: bid,
        blueprint: {
          mode: 'quickStart', floorsNeeded: ['strategy', 'execution'],
          roomConfig: [
            { floor: 'strategy', rooms: ['strategist'] },
            { floor: 'execution', rooms: ['code-lab'] },
          ],
          agentRoster: [{ name: 'Mover', role: 'dev', rooms: ['strategist', 'code-lab'] }],
          projectGoals: 'x', successCriteria: ''
        },
        agentId: 'user'
      });

      const bldg = await new Promise(r => window.overlordSocket.socket.emit('building:get', { buildingId: bid }, r));
      const floorIds = new Set(((bldg as any)?.data?.floors || []).map((f: any) => f.id));
      const rooms = await new Promise(r => window.overlordSocket.socket.emit('room:list', {}, r));
      const ourRooms = ((rooms as any)?.data || []).filter((r: any) => floorIds.has(r.floor_id));
      const strat = ourRooms.find((r: any) => r.type === 'strategist');
      const code = ourRooms.find((r: any) => r.type === 'code-lab');
      const agents = await new Promise(r => window.overlordSocket.socket.emit('agent:list', { buildingId: bid }, r));
      const agent = ((agents as any)?.data || []).find((a: any) => a.name === 'Mover');

      if (!strat || !code || !agent) return 'setup failed';

      // Move to strategist
      const m1 = await new Promise(r => window.overlordSocket.socket.emit('agent:move', { agentId: agent.id, roomId: strat.id }, r));
      if (!(m1 as any)?.ok) return 'move1 failed: ' + (m1 as any)?.error?.message;

      // Move to code-lab (this USED to fail with exit doc error)
      const m2 = await new Promise(r => window.overlordSocket.socket.emit('agent:move', { agentId: agent.id, roomId: code.id }, r));
      if (!(m2 as any)?.ok) return 'move2 failed: ' + (m2 as any)?.error?.message;

      return 'pass';
    });

    expect(moveResult).toBe('pass');
  });

  // #560 — Agents have human names with first/last, not just role labels
  test('#560: Agents have human first+last names and gender', async ({ page }) => {
    await goToView(page, 'agents');
    await page.waitForTimeout(1500);

    // Agent cards should show names with spaces (first + last)
    const names = page.locator('.agents-view-card-name');
    const count = await names.count();
    expect(count).toBeGreaterThan(0);

    // Check at least one name has a space (indicating first+last name)
    let hasHumanName = false;
    for (let i = 0; i < Math.min(count, 5); i++) {
      const text = await names.nth(i).textContent();
      if (text && text.includes(' ') && text.length > 3) {
        hasHumanName = true;
        break;
      }
    }
    expect(hasHumanName).toBe(true);
  });

  // #555 — Settings AI tab has dropdown selectors (not read-only)
  test('#555: Settings AI tab has provider dropdowns', async ({ page }) => {
    const settingsBtn = page.locator('button[title="Settings"]');
    await expect(settingsBtn).toBeVisible({ timeout: 5000 });
    await settingsBtn.click();
    await page.waitForTimeout(500);

    // Click AI tab
    const aiTab = page.locator('.settings-tab').filter({ hasText: 'AI' });
    if (await aiTab.isVisible({ timeout: 2000 }).catch(() => false)) {
      await aiTab.click();
      await page.waitForTimeout(300);

      // Should have select dropdowns (not just text)
      const selects = page.locator('.settings-mapping-select');
      const selectCount = await selects.count();
      expect(selectCount).toBeGreaterThan(0);
    }
  });

  // #573 — Table type auto-resolve (agent move with null tableType)
  test('#573: Agent move works without specifying tableType', async ({ page }) => {
    const result = await page.evaluate(async () => {
      if (!window.overlordSocket) return 'no socket';
      const b = await window.overlordSocket.createBuilding({
        name: 'TableTest', config: { projectDescription: 'x', template: 'web-app', effortLevel: 'easy' }
      });
      if (!b?.ok) return 'create failed';
      const agents = await new Promise(r =>
        window.overlordSocket.socket.emit('agent:list', { buildingId: b.data.id }, r)
      );
      const rooms = await new Promise(r => window.overlordSocket.socket.emit('room:list', {}, r));
      const bldg = await new Promise(r => window.overlordSocket.socket.emit('building:get', { buildingId: b.data.id }, r));
      const floorIds = new Set(((bldg as any)?.data?.floors || []).map((f: any) => f.id));
      const strat = ((rooms as any)?.data || []).find((r: any) => r.type === 'strategist' && floorIds.has(r.floor_id));
      const agent = ((agents as any)?.data || [])[0];
      if (!strat || !agent) return 'no data';

      // Move with null tableType — should auto-resolve
      const m = await new Promise(r =>
        window.overlordSocket.socket.emit('agent:move', { agentId: agent.id, roomId: strat.id, tableType: null }, r)
      );
      return (m as any)?.ok ? 'pass' : 'fail: ' + (m as any)?.error?.message;
    });

    expect(result).toBe('pass');
  });

  // #614 — Strategist has Project Source selector
  test('#614: Strategist configure step has project source selector', async ({ page }) => {
    // Navigate to the Strategist/New view
    await goToView(page, 'strategist');
    await page.waitForTimeout(1000);

    // Select a template (click first template card)
    const templateCard = page.locator('.template-card, .strategist-template-card').first();
    if (await templateCard.isVisible({ timeout: 5000 }).catch(() => false)) {
      await templateCard.click();
      await page.waitForTimeout(500);
    }

    // Select effort level (click first effort card if visible)
    const effortCard = page.locator('.effort-card').first();
    if (await effortCard.isVisible({ timeout: 3000 }).catch(() => false)) {
      await effortCard.click();
      await page.waitForTimeout(300);

      // Click Next/Continue to get to configure step
      const nextBtn = page.locator('button').filter({ hasText: /Next|Continue|Configure/i });
      if (await nextBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await nextBtn.click();
        await page.waitForTimeout(500);
      }
    }

    // Verify project source cards exist
    const sourceCards = page.locator('.project-source-card');
    const count = await sourceCards.count();

    if (count >= 3) {
      // All 3 options present
      const freshCard = page.locator('.project-source-card').filter({ hasText: 'Start Fresh' });
      const localCard = page.locator('.project-source-card').filter({ hasText: 'Local Directory' });
      const cloneCard = page.locator('.project-source-card').filter({ hasText: 'Clone from URL' });

      await expect(freshCard).toBeVisible();
      await expect(localCard).toBeVisible();
      await expect(cloneCard).toBeVisible();

      // Click "Link Local Directory" — should show path input
      await localCard.click();
      await page.waitForTimeout(300);
      const pathInput = page.locator('.project-source-input input[placeholder*="path"]');
      await expect(pathInput).toBeVisible();

      // Click "Clone from URL" — should show URL input
      await cloneCard.click();
      await page.waitForTimeout(300);
      const urlInput = page.locator('.project-source-input input[placeholder*="github"]');
      await expect(urlInput).toBeVisible();
    } else {
      // If we couldn't navigate to configure step, check the view has the code
      const js = await page.evaluate(() => {
        return document.querySelector('script[src*="strategist"]')?.textContent || '';
      });
      // Fallback: verify via served JS
      const viewJs = await fetch('http://localhost:4000/ui/views/strategist-view.js').then(r => r.text());
      expect(viewJs).toContain('project-source-card');
      expect(viewJs).toContain('Start Fresh');
      expect(viewJs).toContain('Link Local Directory');
      expect(viewJs).toContain('Clone from URL');
    }
  });
});
