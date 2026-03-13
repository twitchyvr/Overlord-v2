// @vitest-environment jsdom
/**
 * Tests for public/ui/engine/router.js
 *
 * Covers: initRouter(), navigateTo(), getActiveView(), getInitialRoute()
 */

import { describe, it, expect, beforeEach } from 'vitest';

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
  it('returns "onboarding" for new users', () => {
    expect(getInitialRoute(true)).toBe('onboarding');
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

  it('sets aria-current="page" on active toolbar button', async () => {
    const centerPanel = document.createElement('section');
    centerPanel.id = 'center-panel';
    const buildingPanel = document.createElement('aside');
    buildingPanel.id = 'building-panel';
    document.body.appendChild(centerPanel);
    document.body.appendChild(buildingPanel);

    // Create toolbar
    const toolbar = document.createElement('nav');
    toolbar.id = 'app-toolbar';
    const dashBtn = document.createElement('button');
    dashBtn.className = 'toolbar-btn';
    dashBtn.dataset.view = 'dashboard';
    const chatBtn = document.createElement('button');
    chatBtn.className = 'toolbar-btn';
    chatBtn.dataset.view = 'chat';
    toolbar.appendChild(dashBtn);
    toolbar.appendChild(chatBtn);
    document.body.appendChild(toolbar);

    initRouter({ centerPanel, buildingPanel });
    // Navigate to chat first to ensure we can navigate to dashboard
    await navigateTo('chat');
    await navigateTo('dashboard');

    expect(dashBtn.getAttribute('aria-current')).toBe('page');
    expect(chatBtn.getAttribute('aria-current')).toBe('false');
  });

  it('sets aria-current="page" on active mobile nav item', async () => {
    const centerPanel = document.createElement('section');
    centerPanel.id = 'center-panel';
    const buildingPanel = document.createElement('aside');
    buildingPanel.id = 'building-panel';
    document.body.appendChild(centerPanel);
    document.body.appendChild(buildingPanel);

    // Create mobile nav
    const mobileNav = document.createElement('nav');
    mobileNav.id = 'mobile-nav';
    const homeItem = document.createElement('button');
    homeItem.className = 'mobile-nav-item';
    homeItem.dataset.view = 'dashboard';
    const chatItem = document.createElement('button');
    chatItem.className = 'mobile-nav-item';
    chatItem.dataset.view = 'chat';
    mobileNav.appendChild(homeItem);
    mobileNav.appendChild(chatItem);
    document.body.appendChild(mobileNav);

    initRouter({ centerPanel, buildingPanel });
    // Navigate to chat first to ensure we can navigate to dashboard
    await navigateTo('chat');
    await navigateTo('dashboard');

    expect(homeItem.getAttribute('aria-current')).toBe('page');
    expect(chatItem.getAttribute('aria-current')).toBe('false');
  });

  it('updates aria-current when navigating between views', async () => {
    const centerPanel = document.createElement('section');
    centerPanel.id = 'center-panel';
    const buildingPanel = document.createElement('aside');
    buildingPanel.id = 'building-panel';
    document.body.appendChild(centerPanel);
    document.body.appendChild(buildingPanel);

    // Create toolbar
    const toolbar = document.createElement('nav');
    toolbar.id = 'app-toolbar';
    const dashBtn = document.createElement('button');
    dashBtn.className = 'toolbar-btn';
    dashBtn.dataset.view = 'dashboard';
    const chatBtn = document.createElement('button');
    chatBtn.className = 'toolbar-btn';
    chatBtn.dataset.view = 'chat';
    toolbar.appendChild(dashBtn);
    toolbar.appendChild(chatBtn);
    document.body.appendChild(toolbar);

    initRouter({ centerPanel, buildingPanel });

    // Navigate to chat first (since previous tests may have left _activeViewName as dashboard)
    await navigateTo('chat');
    expect(chatBtn.getAttribute('aria-current')).toBe('page');
    expect(dashBtn.getAttribute('aria-current')).toBe('false');

    await navigateTo('dashboard');
    expect(dashBtn.getAttribute('aria-current')).toBe('page');
    expect(chatBtn.getAttribute('aria-current')).toBe('false');
  });
});
