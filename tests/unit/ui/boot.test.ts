// @vitest-environment jsdom
/**
 * Tests for public/ui/boot.js
 *
 * Covers: bootOverlord bootstrap — store creation, engine init, socket bridge,
 *         view mounting, router init, connection lifecycle,
 *         phase bar reactivity, no-socket fallback, _updatePhaseBar helper.
 *
 * Strategy: vi.mock() all imports so boot.js runs in isolation. We capture
 *           the callbacks registered via engine.subscribe / store.subscribe
 *           so we can invoke them manually and assert side-effects.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Mock return values we control per-test ───────────────────────
const mockStore = {
  set: vi.fn(),
  subscribe: vi.fn(),
};
const mockEngine = {
  subscribe: vi.fn(),
};
const mockApi = { emit: vi.fn() };
const mockRoomViewInstance = { mount: vi.fn() };

// ── vi.mock declarations (hoisted before imports) ────────────────

vi.mock('../../../public/ui/engine/store.js', () => ({
  createV2Store: vi.fn(() => mockStore),
}));

vi.mock('../../../public/ui/engine/engine.js', () => ({
  OverlordUI: {
    init: vi.fn(() => mockEngine),
    subscribe: vi.fn(() => () => {}),
    dispatch: vi.fn(),
    getStore: vi.fn(() => mockStore),
    registerComponent: vi.fn(),
    mountComponent: vi.fn(),
    getComponent: vi.fn(),
  },
}));

vi.mock('../../../public/ui/engine/socket-bridge.js', () => ({
  initSocketBridge: vi.fn(() => mockApi),
}));

vi.mock('../../../public/ui/engine/helpers.js', () => ({
  h: vi.fn((...args: any[]) => {
    const el = document.createElement(args[0]);
    if (args[1] && typeof args[1] === 'object') {
      if (args[1].class) el.className = args[1].class;
    }
    // Append text children
    for (let i = 2; i < args.length; i++) {
      const child = args[i];
      if (child instanceof Node) el.appendChild(child);
      else if (typeof child === 'string') el.appendChild(document.createTextNode(child));
    }
    return el;
  }),
  setContent: vi.fn((el: HTMLElement) => {
    el.textContent = '';
  }),
  debounce: vi.fn((fn: any) => fn),
  escapeHtml: vi.fn((s: string) => s),
}));

vi.mock('../../../public/ui/engine/router.js', () => ({
  initRouter: vi.fn(),
  navigateTo: vi.fn(),
  getInitialRoute: vi.fn((isNew: boolean) => isNew ? 'strategist' : 'dashboard'),
  initBuildingView: vi.fn(),
}));

vi.mock('../../../public/ui/components/toast.js', () => ({
  Toast: {
    info: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../../../public/ui/views/room-view.js', () => ({
  RoomView: vi.fn().mockImplementation(() => mockRoomViewInstance),
}));

const mockGlobalSearchInstance = { mount: vi.fn() };
vi.mock('../../../public/ui/components/global-search.js', () => ({
  GlobalSearch: vi.fn().mockImplementation(() => mockGlobalSearchInstance),
}));

const mockProjectSwitcherInstance = { mount: vi.fn() };
vi.mock('../../../public/ui/components/project-switcher.js', () => ({
  ProjectSwitcher: vi.fn().mockImplementation(() => mockProjectSwitcherInstance),
}));

vi.mock('../../../public/ui/engine/logger.js', () => ({
  createLogger: vi.fn((tag: string) => ({
    debug: (...args: any[]) => console.debug(`[${tag}]`, ...args),
    info: (...args: any[]) => console.info(`[${tag}]`, ...args),
    warn: (...args: any[]) => console.warn(`[${tag}]`, ...args),
    error: (...args: any[]) => console.error(`[${tag}]`, ...args),
  })),
  setLogLevel: vi.fn(),
}));

// ── Deferred imports (grabbed after mocks are in place) ──────────

let createV2Store: any;
let OverlordUI: any;
let initSocketBridge: any;
let initRouter: any;
let navigateTo: any;
let getInitialRoute: any;
let initBuildingView: any;
let Toast: any;
let RoomView: any;
let hFn: any;
let setContent: any;

// ── Helpers to capture callbacks registered during boot ──────────

/** Extracts the callback registered for a given event from a mock's calls */
function getSubscribeCallback(mock: any, event: string): ((...args: unknown[]) => unknown) | undefined {
  const call = mock.mock.calls.find((c: any[]) => c[0] === event);
  return call ? call[1] : undefined;
}

// ── Setup & teardown ─────────────────────────────────────────────

/**
 * Because boot.js executes side-effects at module scope (not inside an
 * exported function), we use `await import(...)` with `vi.resetModules()`
 * to get a fresh execution each test.
 */

function setupDOM(opts: { withSocket?: boolean; withLoadingEl?: boolean; withThemeToggle?: boolean; withConnectionIndicator?: boolean } = {}) {
  // Clear body
  while (document.body.firstChild) {
    document.body.removeChild(document.body.firstChild);
  }

  // Create layout elements that boot.js queries
  const centerPanel = document.createElement('div');
  centerPanel.id = 'center-panel';
  document.body.appendChild(centerPanel);

  const buildingPanel = document.createElement('div');
  buildingPanel.id = 'building-panel';
  document.body.appendChild(buildingPanel);

  if (opts.withLoadingEl) {
    const loading = document.createElement('div');
    loading.id = 'loading-state';
    document.body.appendChild(loading);
  }

  if (opts.withThemeToggle) {
    const btn = document.createElement('button');
    btn.id = 'theme-toggle';
    document.body.appendChild(btn);
  }

  if (opts.withConnectionIndicator) {
    const conn = document.createElement('span');
    conn.id = 'toolbar-connection';
    document.body.appendChild(conn);
  }

  // Socket.IO global
  if (opts.withSocket) {
    const mockSocket = {
      on: vi.fn(),
      emit: vi.fn(),
      id: 'test-socket-id',
    };
    (globalThis as any).io = vi.fn(() => mockSocket);
    return mockSocket;
  } else {
    delete (globalThis as any).io;
    return null;
  }
}

beforeEach(async () => {
  vi.resetModules();

  // Reset all mock fn states
  mockStore.set.mockClear();
  mockStore.subscribe.mockClear();
  mockEngine.subscribe.mockClear();
  mockRoomViewInstance.mount.mockClear();

  // Re-import mocked modules
  const storeMod = await import('../../../public/ui/engine/store.js');
  createV2Store = (storeMod as any).createV2Store;

  const engineMod = await import('../../../public/ui/engine/engine.js');
  OverlordUI = (engineMod as any).OverlordUI;

  const sbMod = await import('../../../public/ui/engine/socket-bridge.js');
  initSocketBridge = (sbMod as any).initSocketBridge;

  const routerMod = await import('../../../public/ui/engine/router.js');
  initRouter = (routerMod as any).initRouter;
  navigateTo = (routerMod as any).navigateTo;
  getInitialRoute = (routerMod as any).getInitialRoute;
  initBuildingView = (routerMod as any).initBuildingView;

  const toastMod = await import('../../../public/ui/components/toast.js');
  Toast = (toastMod as any).Toast;

  const rvMod = await import('../../../public/ui/views/room-view.js');
  RoomView = (rvMod as any).RoomView;

  const helpersMod = await import('../../../public/ui/engine/helpers.js');
  hFn = (helpersMod as any).h;
  setContent = (helpersMod as any).setContent;

  // Clear mock call counts that accumulated during import
  vi.clearAllMocks();
});

afterEach(() => {
  while (document.body.firstChild) {
    document.body.removeChild(document.body.firstChild);
  }
  delete (globalThis as any).io;
});

// ════════════════════════════════════════════════════════════════════
//  HELPER: Import boot.js (triggers module-scope side-effects)
// ════════════════════════════════════════════════════════════════════

async function importBoot() {
  return import('../../../public/ui/boot.js');
}

// ═══════════════════════════════════════════════════════════════════
//  1. CORE INITIALIZATION
// ═══════════════════════════════════════════════════════════════════

describe('boot.js — core initialization', () => {
  it('calls createV2Store() to create the store', async () => {
    setupDOM({ withSocket: true });
    await importBoot();
    expect(createV2Store).toHaveBeenCalledTimes(1);
  });

  it('calls OverlordUI.init() with the created store', async () => {
    setupDOM({ withSocket: true });
    await importBoot();
    expect(OverlordUI.init).toHaveBeenCalledTimes(1);
    expect(OverlordUI.init).toHaveBeenCalledWith(mockStore);
  });

  it('init returns the engine singleton', async () => {
    setupDOM({ withSocket: true });
    await importBoot();
    expect(OverlordUI.init).toHaveReturnedWith(mockEngine);
  });

  it('queries DOM for center-panel and building-panel', async () => {
    const spy = vi.spyOn(document, 'getElementById');
    setupDOM({ withSocket: true });
    await importBoot();
    const ids = spy.mock.calls.map((c: any[]) => c[0]);
    expect(ids).toContain('center-panel');
    expect(ids).toContain('building-panel');
    spy.mockRestore();
  });

  it('logs boot complete message to console', async () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
    setupDOM({ withSocket: true });
    await importBoot();
    const bootCall = spy.mock.calls.find((c: any[]) => c[0] === '[Overlord]' && c[1] === 'Boot complete');
    expect(bootCall).toBeTruthy();
    spy.mockRestore();
  });
});

// ═══════════════════════════════════════════════════════════════════
//  2. SOCKET.IO CONNECTION PATH (io is defined)
// ═══════════════════════════════════════════════════════════════════

describe('boot.js — socket connected path', () => {
  it('calls io() to create the socket connection', async () => {
    setupDOM({ withSocket: true });
    await importBoot();
    expect((globalThis as any).io).toHaveBeenCalledTimes(1);
  });

  it('calls initSocketBridge with socket, store, and engine', async () => {
    const mockSocket = setupDOM({ withSocket: true });
    await importBoot();
    expect(initSocketBridge).toHaveBeenCalledTimes(1);
    expect(initSocketBridge).toHaveBeenCalledWith(mockSocket, mockStore, mockEngine);
  });

  it('calls initRouter with centerPanel and buildingPanel elements', async () => {
    setupDOM({ withSocket: true });
    await importBoot();
    expect(initRouter).toHaveBeenCalledTimes(1);
    const arg = initRouter.mock.calls[0][0];
    expect(arg.centerPanel).toBeInstanceOf(HTMLElement);
    expect(arg.centerPanel.id).toBe('center-panel');
    expect(arg.buildingPanel).toBeInstanceOf(HTMLElement);
    expect(arg.buildingPanel.id).toBe('building-panel');
  });

  it('calls initBuildingView to mount the building sidebar', async () => {
    setupDOM({ withSocket: true });
    await importBoot();
    expect(initBuildingView).toHaveBeenCalledTimes(1);
  });

  it('creates a RoomView and calls mount()', async () => {
    setupDOM({ withSocket: true });
    await importBoot();
    expect(RoomView).toHaveBeenCalledTimes(1);
    // The constructor receives a div element
    const ctorArg = RoomView.mock.calls[0][0];
    expect(ctorArg).toBeInstanceOf(HTMLElement);
    expect(ctorArg.tagName).toBe('DIV');
    expect(mockRoomViewInstance.mount).toHaveBeenCalledTimes(1);
  });
});

// ═══════════════════════════════════════════════════════════════════
//  4. system:status EVENT HANDLER
// ═══════════════════════════════════════════════════════════════════

describe('boot.js — system:status handler', () => {
  it('subscribes to system:status via engine.subscribe', async () => {
    setupDOM({ withSocket: true });
    await importBoot();
    const events = mockEngine.subscribe.mock.calls.map((c: any[]) => c[0]);
    expect(events).toContain('system:status');
  });

  it('removes #loading-state element when system:status fires', async () => {
    setupDOM({ withSocket: true, withLoadingEl: true });
    await importBoot();
    expect(document.getElementById('loading-state')).toBeTruthy();

    const cb = getSubscribeCallback(mockEngine.subscribe, 'system:status');
    cb!({ buildings: [], isNewUser: false });
    expect(document.getElementById('loading-state')).toBeNull();
  });

  it('does not throw when #loading-state is missing', async () => {
    setupDOM({ withSocket: true, withLoadingEl: false });
    await importBoot();
    const cb = getSubscribeCallback(mockEngine.subscribe, 'system:status');
    expect(() => cb!({ buildings: [], isNewUser: false })).not.toThrow();
  });

  it('sets building.list in store when data.buildings is present', async () => {
    setupDOM({ withSocket: true });
    await importBoot();
    mockStore.set.mockClear();

    const cb = getSubscribeCallback(mockEngine.subscribe, 'system:status');
    const buildings = [{ id: 'b1', name: 'HQ' }];
    cb!({ buildings, isNewUser: false });
    expect(mockStore.set).toHaveBeenCalledWith('building.list', buildings);
  });

  it('does not set building.list when data.buildings is undefined', async () => {
    setupDOM({ withSocket: true });
    await importBoot();
    mockStore.set.mockClear();

    const cb = getSubscribeCallback(mockEngine.subscribe, 'system:status');
    cb!({ isNewUser: true });
    expect(mockStore.set).not.toHaveBeenCalledWith('building.list', expect.anything());
  });

  it('navigates to strategist for new users on first connection', async () => {
    setupDOM({ withSocket: true });
    await importBoot();

    const cb = getSubscribeCallback(mockEngine.subscribe, 'system:status');
    cb!({ isNewUser: true, buildings: [] });
    expect(getInitialRoute).toHaveBeenCalledWith(true);
    expect(navigateTo).toHaveBeenCalledWith('strategist');
  });

  it('navigates to dashboard for returning users on first connection', async () => {
    setupDOM({ withSocket: true });
    await importBoot();

    const cb = getSubscribeCallback(mockEngine.subscribe, 'system:status');
    cb!({ isNewUser: false, buildings: [{ id: 'b1' }] });
    expect(getInitialRoute).toHaveBeenCalledWith(false);
    expect(navigateTo).toHaveBeenCalledWith('dashboard');
  });

  it('navigates to strategist when buildings array is empty on first connection', async () => {
    setupDOM({ withSocket: true });
    await importBoot();

    const cb = getSubscribeCallback(mockEngine.subscribe, 'system:status');
    cb!({ isNewUser: false, buildings: [] });
    // !data.buildings?.length is true when array is empty
    expect(getInitialRoute).toHaveBeenCalledWith(true);
    expect(navigateTo).toHaveBeenCalledWith('strategist');
  });

  it('does NOT navigate on subsequent system:status events (reconnection)', async () => {
    setupDOM({ withSocket: true });
    await importBoot();

    const cb = getSubscribeCallback(mockEngine.subscribe, 'system:status');

    // First call — should navigate
    cb!({ isNewUser: false, buildings: [{ id: 'b1' }] });
    expect(navigateTo).toHaveBeenCalledTimes(1);
    expect(navigateTo).toHaveBeenCalledWith('dashboard');

    navigateTo.mockClear();

    // Second call (simulating reconnect) — should NOT navigate
    cb!({ isNewUser: false, buildings: [{ id: 'b1' }] });
    expect(navigateTo).not.toHaveBeenCalled();
  });

  it('still updates building.list on reconnect even without navigating', async () => {
    setupDOM({ withSocket: true });
    await importBoot();

    const cb = getSubscribeCallback(mockEngine.subscribe, 'system:status');

    // First call
    cb!({ isNewUser: false, buildings: [{ id: 'b1' }] });
    mockStore.set.mockClear();

    // Second call (reconnect) — data should still be updated
    const updatedBuildings = [{ id: 'b1' }, { id: 'b2' }];
    cb!({ isNewUser: false, buildings: updatedBuildings });
    expect(mockStore.set).toHaveBeenCalledWith('building.list', updatedBuildings);
  });
});

// ═══════════════════════════════════════════════════════════════════
//  5. CONNECTION LIFECYCLE HANDLERS
// ═══════════════════════════════════════════════════════════════════

describe('boot.js — connection lifecycle', () => {
  it('subscribes to connection:lost via engine.subscribe', async () => {
    setupDOM({ withSocket: true });
    await importBoot();
    const events = mockEngine.subscribe.mock.calls.map((c: any[]) => c[0]);
    expect(events).toContain('connection:lost');
  });

  it('shows warning toast on connection:lost', async () => {
    setupDOM({ withSocket: true });
    await importBoot();

    const cb = getSubscribeCallback(mockEngine.subscribe, 'connection:lost');
    cb!();
    expect(Toast.warning).toHaveBeenCalledWith('Connection lost. Reconnecting...');
  });

  it('subscribes to ui.connected via store.subscribe', async () => {
    setupDOM({ withSocket: true });
    await importBoot();
    const keys = mockStore.subscribe.mock.calls.map((c: any[]) => c[0]);
    expect(keys).toContain('ui.connected');
  });

  it('shows success toast when ui.connected becomes true', async () => {
    setupDOM({ withSocket: true });
    await importBoot();

    const cb = getSubscribeCallback(mockStore.subscribe, 'ui.connected');
    cb!(true);
    expect(Toast.success).toHaveBeenCalledWith('Connected to Overlord');
  });

  it('does not show success toast when ui.connected is false', async () => {
    setupDOM({ withSocket: true });
    await importBoot();

    const cb = getSubscribeCallback(mockStore.subscribe, 'ui.connected');
    cb!(false);
    expect(Toast.success).not.toHaveBeenCalled();
  });

  it('updates connection indicator aria-label on state change', async () => {
    setupDOM({ withSocket: true, withConnectionIndicator: true });
    await importBoot();

    const cb = getSubscribeCallback(mockStore.subscribe, 'ui.connectionState');
    const connEl = document.getElementById('toolbar-connection')!;

    cb!('connected');
    expect(connEl.getAttribute('aria-label')).toBe('Connection status: Connected');

    cb!('disconnected');
    expect(connEl.getAttribute('aria-label')).toBe('Connection status: Disconnected');

    cb!('reconnecting');
    expect(connEl.getAttribute('aria-label')).toBe('Connection status: Reconnecting...');

    cb!('failed');
    expect(connEl.getAttribute('aria-label')).toBe('Connection status: Connection failed');
  });

  it('updates connection indicator title on state change', async () => {
    setupDOM({ withSocket: true, withConnectionIndicator: true });
    await importBoot();

    const cb = getSubscribeCallback(mockStore.subscribe, 'ui.connectionState');
    const connEl = document.getElementById('toolbar-connection')!;

    cb!('disconnected');
    expect(connEl.title).toBe('Disconnected');
  });
});

// ═══════════════════════════════════════════════════════════════════
//  6. PHASE BAR REACTIVITY
// ═══════════════════════════════════════════════════════════════════

describe('boot.js — phase bar reactivity', () => {
  it('subscribes to building.activePhase via store.subscribe', async () => {
    setupDOM({ withSocket: true });
    await importBoot();
    const keys = mockStore.subscribe.mock.calls.map((c: any[]) => c[0]);
    expect(keys).toContain('building.activePhase');
  });

  it('_updatePhaseBar marks steps before active as completed', async () => {
    setupDOM({ withSocket: true });

    // Create phase steps in the DOM
    const phases = ['strategy', 'discovery', 'architecture', 'execution', 'review', 'deploy'];
    phases.forEach(phase => {
      const step = document.createElement('div');
      step.className = 'phase-step';
      step.dataset.phase = phase;
      document.body.appendChild(step);
    });

    await importBoot();

    // Trigger phase change to 'architecture' (index 2)
    const cb = getSubscribeCallback(mockStore.subscribe, 'building.activePhase');
    cb!('architecture');

    const steps = document.querySelectorAll('.phase-step');
    // strategy (0) and discovery (1) should be 'completed'
    expect(steps[0].classList.contains('completed')).toBe(true);
    expect(steps[1].classList.contains('completed')).toBe(true);
    // architecture (2) should be 'current'
    expect(steps[2].classList.contains('current')).toBe(true);
    // execution (3), review (4), deploy (5) should have neither
    expect(steps[3].classList.contains('completed')).toBe(false);
    expect(steps[3].classList.contains('current')).toBe(false);
    expect(steps[4].classList.contains('completed')).toBe(false);
    expect(steps[5].classList.contains('completed')).toBe(false);
  });

  it('_updatePhaseBar sets aria-current="step" on active phase', async () => {
    setupDOM({ withSocket: true });

    const phases = ['strategy', 'discovery', 'architecture', 'execution', 'review', 'deploy'];
    phases.forEach(phase => {
      const step = document.createElement('div');
      step.className = 'phase-step';
      step.dataset.phase = phase;
      document.body.appendChild(step);
    });

    await importBoot();

    const cb = getSubscribeCallback(mockStore.subscribe, 'building.activePhase');
    cb!('execution');

    const steps = document.querySelectorAll('.phase-step');
    // execution (3) should have aria-current="step"
    expect(steps[3].getAttribute('aria-current')).toBe('step');
    // Others should have aria-current="false"
    expect(steps[0].getAttribute('aria-current')).toBe('false');
    expect(steps[1].getAttribute('aria-current')).toBe('false');
    expect(steps[2].getAttribute('aria-current')).toBe('false');
    expect(steps[4].getAttribute('aria-current')).toBe('false');
    expect(steps[5].getAttribute('aria-current')).toBe('false');
  });

  it('_updatePhaseBar sets aria-label with phase status', async () => {
    setupDOM({ withSocket: true });

    const phases = ['strategy', 'discovery', 'architecture', 'execution', 'review', 'deploy'];
    phases.forEach(phase => {
      const step = document.createElement('div');
      step.className = 'phase-step';
      step.dataset.phase = phase;
      document.body.appendChild(step);
    });

    await importBoot();

    const cb = getSubscribeCallback(mockStore.subscribe, 'building.activePhase');
    cb!('architecture');

    const steps = document.querySelectorAll('.phase-step');
    expect(steps[0].getAttribute('aria-label')).toContain('completed');
    expect(steps[1].getAttribute('aria-label')).toContain('completed');
    expect(steps[2].getAttribute('aria-label')).toContain('current');
    expect(steps[3].getAttribute('aria-label')).toContain('pending');
    expect(steps[4].getAttribute('aria-label')).toContain('pending');
    expect(steps[5].getAttribute('aria-label')).toContain('pending');
  });

  it('_updatePhaseBar clears previous classes before applying new ones', async () => {
    setupDOM({ withSocket: true });

    const phases = ['strategy', 'discovery', 'architecture', 'execution', 'review', 'deploy'];
    phases.forEach(phase => {
      const step = document.createElement('div');
      step.className = 'phase-step';
      step.dataset.phase = phase;
      document.body.appendChild(step);
    });

    await importBoot();

    const cb = getSubscribeCallback(mockStore.subscribe, 'building.activePhase');

    // First set to execution
    cb!('execution');
    // Then set to discovery — earlier steps should lose 'completed'
    cb!('discovery');

    const steps = document.querySelectorAll('.phase-step');
    // strategy (0) should be completed
    expect(steps[0].classList.contains('completed')).toBe(true);
    // discovery (1) should be current
    expect(steps[1].classList.contains('current')).toBe(true);
    // architecture (2) should no longer be completed
    expect(steps[2].classList.contains('completed')).toBe(false);
    expect(steps[2].classList.contains('current')).toBe(false);
    // execution (3) should no longer be current
    expect(steps[3].classList.contains('current')).toBe(false);
  });

  it('_updatePhaseBar handles first phase (strategy) with no completed steps', async () => {
    setupDOM({ withSocket: true });

    const phases = ['strategy', 'discovery', 'architecture', 'execution', 'review', 'deploy'];
    phases.forEach(phase => {
      const step = document.createElement('div');
      step.className = 'phase-step';
      step.dataset.phase = phase;
      document.body.appendChild(step);
    });

    await importBoot();

    const cb = getSubscribeCallback(mockStore.subscribe, 'building.activePhase');
    cb!('strategy');

    const steps = document.querySelectorAll('.phase-step');
    expect(steps[0].classList.contains('current')).toBe(true);
    expect(steps[0].classList.contains('completed')).toBe(false);
    // No steps should be completed
    steps.forEach(step => {
      expect(step.classList.contains('completed')).toBe(false);
    });
  });

  it('_updatePhaseBar handles last phase (deploy) with all prior completed', async () => {
    setupDOM({ withSocket: true });

    const phases = ['strategy', 'discovery', 'architecture', 'execution', 'review', 'deploy'];
    phases.forEach(phase => {
      const step = document.createElement('div');
      step.className = 'phase-step';
      step.dataset.phase = phase;
      document.body.appendChild(step);
    });

    await importBoot();

    const cb = getSubscribeCallback(mockStore.subscribe, 'building.activePhase');
    cb!('deploy');

    const steps = document.querySelectorAll('.phase-step');
    for (let i = 0; i < 5; i++) {
      expect(steps[i].classList.contains('completed')).toBe(true);
    }
    expect(steps[5].classList.contains('current')).toBe(true);
    expect(steps[5].classList.contains('completed')).toBe(false);
  });

  it('_updatePhaseBar handles unknown phase gracefully (no step gets current)', async () => {
    setupDOM({ withSocket: true });

    const phases = ['strategy', 'discovery', 'architecture', 'execution', 'review', 'deploy'];
    phases.forEach(phase => {
      const step = document.createElement('div');
      step.className = 'phase-step';
      step.dataset.phase = phase;
      document.body.appendChild(step);
    });

    await importBoot();

    const cb = getSubscribeCallback(mockStore.subscribe, 'building.activePhase');
    cb!('unknown-phase');

    const steps = document.querySelectorAll('.phase-step');
    steps.forEach(step => {
      expect(step.classList.contains('current')).toBe(false);
      expect(step.classList.contains('completed')).toBe(false);
    });
  });

  it('_updatePhaseBar is called with strategy on initial boot', async () => {
    setupDOM({ withSocket: true });

    const phases = ['strategy', 'discovery', 'architecture', 'execution', 'review', 'deploy'];
    phases.forEach(phase => {
      const step = document.createElement('div');
      step.className = 'phase-step';
      step.dataset.phase = phase;
      document.body.appendChild(step);
    });

    await importBoot();

    // The module calls _updatePhaseBar('strategy') at the bottom
    const steps = document.querySelectorAll('.phase-step');
    expect(steps[0].classList.contains('current')).toBe(true);
  });

  it('_updatePhaseBar does not throw when no .phase-step elements exist', async () => {
    setupDOM({ withSocket: true });
    // No phase-step elements in DOM
    await expect(importBoot()).resolves.not.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════
//  7. NO SOCKET.IO FALLBACK
// ═══════════════════════════════════════════════════════════════════

describe('boot.js — no socket.io fallback', () => {
  it('does not call initSocketBridge when io is undefined', async () => {
    setupDOM({ withSocket: false });
    await importBoot();
    expect(initSocketBridge).not.toHaveBeenCalled();
  });

  it('does not call initRouter when io is undefined', async () => {
    setupDOM({ withSocket: false });
    await importBoot();
    expect(initRouter).not.toHaveBeenCalled();
  });

  it('does not call initBuildingView when io is undefined', async () => {
    setupDOM({ withSocket: false });
    await importBoot();
    expect(initBuildingView).not.toHaveBeenCalled();
  });

  it('does not create RoomView when io is undefined', async () => {
    setupDOM({ withSocket: false });
    await importBoot();
    expect(RoomView).not.toHaveBeenCalled();
  });

  it('renders error message into center-panel when io is undefined', async () => {
    setupDOM({ withSocket: false });
    await importBoot();
    expect(setContent).toHaveBeenCalled();
    expect(hFn).toHaveBeenCalled();
    // Check that h was called to create the error UI
    const hCalls = hFn.mock.calls;
    const outerCall = hCalls.find((c: any[]) => c[0] === 'div' && c[1]?.class === 'empty-state');
    expect(outerCall).toBeTruthy();
  });

  it('does not render error when center-panel is missing from DOM', async () => {
    // Set up DOM without center-panel
    while (document.body.firstChild) {
      document.body.removeChild(document.body.firstChild);
    }
    delete (globalThis as any).io;
    await importBoot();
    // setContent should not be called because centerPanel is null
    expect(setContent).not.toHaveBeenCalled();
  });

  it('still calls createV2Store and OverlordUI.init even without socket', async () => {
    setupDOM({ withSocket: false });
    await importBoot();
    expect(createV2Store).toHaveBeenCalledTimes(1);
    expect(OverlordUI.init).toHaveBeenCalledTimes(1);
  });

  it('still logs boot complete even without socket', async () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
    setupDOM({ withSocket: false });
    await importBoot();
    const bootCall = spy.mock.calls.find((c: any[]) => c[0] === '[Overlord]' && c[1] === 'Boot complete');
    expect(bootCall).toBeTruthy();
    spy.mockRestore();
  });
});

// ═══════════════════════════════════════════════════════════════════
//  8. THEME MANAGEMENT
// ═══════════════════════════════════════════════════════════════════

describe('boot.js — theme management', () => {
  afterEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
  });

  it('sets data-theme to dark by default when no saved preference', async () => {
    setupDOM({ withSocket: true });
    await importBoot();
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('restores saved theme from localStorage', async () => {
    localStorage.setItem('overlord-theme', 'light');
    setupDOM({ withSocket: true });
    await importBoot();
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('toggle button switches dark to light on click', async () => {
    setupDOM({ withSocket: true, withThemeToggle: true });
    await importBoot();

    const btn = document.getElementById('theme-toggle')!;
    btn.click();

    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(localStorage.getItem('overlord-theme')).toBe('light');
  });

  it('toggle button switches light to dark on click', async () => {
    localStorage.setItem('overlord-theme', 'light');
    setupDOM({ withSocket: true, withThemeToggle: true });
    await importBoot();

    const btn = document.getElementById('theme-toggle')!;
    btn.click();

    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(localStorage.getItem('overlord-theme')).toBe('dark');
  });

  it('toggle button adds theme-light class when switching to light', async () => {
    setupDOM({ withSocket: true, withThemeToggle: true });
    await importBoot();

    const btn = document.getElementById('theme-toggle')!;
    btn.click();

    expect(btn.classList.contains('theme-light')).toBe(true);
  });

  it('toggle button removes theme-light class when switching to dark', async () => {
    localStorage.setItem('overlord-theme', 'light');
    setupDOM({ withSocket: true, withThemeToggle: true });
    await importBoot();

    const btn = document.getElementById('theme-toggle')!;
    expect(btn.classList.contains('theme-light')).toBe(true);

    btn.click();
    expect(btn.classList.contains('theme-light')).toBe(false);
  });

  it('sets correct title on toggle button for dark theme', async () => {
    setupDOM({ withSocket: true, withThemeToggle: true });
    await importBoot();

    const btn = document.getElementById('theme-toggle')!;
    expect(btn.title).toBe('Switch to light theme');
  });

  it('sets correct title on toggle button for light theme', async () => {
    localStorage.setItem('overlord-theme', 'light');
    setupDOM({ withSocket: true, withThemeToggle: true });
    await importBoot();

    const btn = document.getElementById('theme-toggle')!;
    expect(btn.title).toBe('Switch to dark theme');
  });

  it('exports theme functions on window._overlordTheme', async () => {
    setupDOM({ withSocket: true });
    await importBoot();

    const themeExport = (window as any)._overlordTheme;
    expect(themeExport).toBeDefined();
    expect(typeof themeExport.initTheme).toBe('function');
    expect(typeof themeExport.applyTheme).toBe('function');
    expect(themeExport.THEME_KEY).toBe('overlord-theme');
  });

  it('does not crash when theme-toggle button is missing', async () => {
    setupDOM({ withSocket: true, withThemeToggle: false });
    await expect(importBoot()).resolves.not.toThrow();
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('persists theme across toggle cycles', async () => {
    setupDOM({ withSocket: true, withThemeToggle: true });
    await importBoot();

    const btn = document.getElementById('theme-toggle')!;

    // dark -> light
    btn.click();
    expect(localStorage.getItem('overlord-theme')).toBe('light');

    // light -> dark
    btn.click();
    expect(localStorage.getItem('overlord-theme')).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });
});
