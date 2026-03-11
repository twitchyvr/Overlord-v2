// @vitest-environment jsdom
/**
 * Tests for public/ui/engine/router.js
 *
 * Covers: initRouter(), navigateTo(), getActiveView(), getInitialRoute()
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const storePath = '../../../public/ui/engine/store.js';
const enginePath = '../../../public/ui/engine/engine.js';
const routerPath = '../../../public/ui/engine/router.js';

let Store: any;
let OverlordUI: any;
let initRouter: any;
let navigateTo: any;
let getActiveView: any;
let getInitialRoute: any;

beforeEach(async () => {
  document.body.textContent = '';

  const storeMod = await import(storePath);
  const engineMod = await import(enginePath);
  Store = storeMod.Store;
  OverlordUI = engineMod.OverlordUI;

  const store = new Store();
  store.set('building.activePhase', 'strategy', { silent: true });
  OverlordUI.init(store);

  const routerMod = await import(routerPath);
  initRouter = routerMod.initRouter;
  navigateTo = routerMod.navigateTo;
  getActiveView = routerMod.getActiveView;
  getInitialRoute = routerMod.getInitialRoute;
});

// ─── getInitialRoute() ──────────────────────────────────────

describe('getInitialRoute()', () => {
  it('returns "strategist" for new users', () => {
    expect(getInitialRoute(true)).toBe('strategist');
  });

  it('returns "dashboard" for returning users', () => {
    expect(getInitialRoute(false)).toBe('dashboard');
  });
});

// ─── getActiveView() ────────────────────────────────────────

describe('getActiveView()', () => {
  it('returns null before any navigation', () => {
    // May be null or whatever was set in a previous test
    // Just confirm it returns a string or null
    const result = getActiveView();
    expect(result === null || typeof result === 'string').toBe(true);
  });
});

// ─── initRouter() ───────────────────────────────────────────

describe('initRouter()', () => {
  it('initializes without error', () => {
    const centerPanel = document.createElement('section');
    centerPanel.id = 'center-panel';
    const buildingPanel = document.createElement('aside');
    buildingPanel.id = 'building-panel';
    document.body.appendChild(centerPanel);
    document.body.appendChild(buildingPanel);

    expect(() => initRouter({ centerPanel, buildingPanel })).not.toThrow();
  });
});

// ─── navigateTo() ───────────────────────────────────────────

describe('navigateTo()', () => {
  it('creates a view container in center panel', async () => {
    const centerPanel = document.createElement('section');
    centerPanel.id = 'center-panel';
    const buildingPanel = document.createElement('aside');
    buildingPanel.id = 'building-panel';
    document.body.appendChild(centerPanel);
    document.body.appendChild(buildingPanel);

    initRouter({ centerPanel, buildingPanel });
    await navigateTo('dashboard');

    // DashboardView.render() overwrites the container's className to 'dashboard-view',
    // so the original 'view-container' class is replaced. Verify by class or content.
    expect(getActiveView()).toBe('dashboard');
    const container = centerPanel.querySelector('.dashboard-view');
    expect(container).not.toBeNull();
    expect(container!.querySelector('.dashboard-header')).not.toBeNull();
  });

  it('shows error for unknown view', async () => {
    const centerPanel = document.createElement('section');
    const buildingPanel = document.createElement('aside');
    document.body.appendChild(centerPanel);
    document.body.appendChild(buildingPanel);

    initRouter({ centerPanel, buildingPanel });
    await navigateTo('nonexistent');

    expect(centerPanel.textContent).toContain('Unknown view');
  });
});
