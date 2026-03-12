// @vitest-environment jsdom
/**
 * Tests for public/ui/boot.js
 *
 * Covers: bootOverlord bootstrap — store creation, engine init, socket bridge,
 *         panel construction, view mounting, router init, connection lifecycle,
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
}));

vi.mock('../../../public/ui/engine/router.js', () => ({
  initRouter: vi.fn(),
  navigateTo: vi.fn(),
  getInitialRoute: vi.fn((isNew: boolean) => isNew ? 'strategist' : 'dashboard'),
  initBuildingView: vi.fn(),
}));

vi.mock('../../../public/ui/components/panel.js', () => ({
  initPanelSystem: vi.fn(),
  PanelComponent: vi.fn(),
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

vi.mock('../../../public/ui/panels/phase-panel.js', () => ({
  PhasePanel: vi.fn(),
}));

vi.mock('../../../public/ui/panels/agents-panel.js', () => ({
  AgentsPanel: vi.fn(),
}));

vi.mock('../../../public/ui/panels/raid-panel.js', () => ({
  RaidPanel: vi.fn(),
}));

vi.mock('../../../public/ui/panels/activity-panel.js', () => ({
  ActivityPanel: vi.fn(),
}));

vi.mock('../../../public/ui/panels/projects-panel.js', () => ({
  ProjectsPanel: vi.fn(),
}));

vi.mock('../../../public/ui/panels/tools-panel.js', () => ({
  ToolsPanel: vi.fn(),
}));

vi.mock('../../../public/ui/panels/logs-panel.js', () => ({
  LogsPanel: vi.fn(),
}));

vi.mock('../../../public/ui/panels/team-panel.js', () => ({
  TeamPanel: vi.fn(),
}));

vi.mock('../../../public/ui/panels/tasks-panel.js', () => ({
  TasksPanel: vi.fn(),
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
let initPanelSystem: any;
let Toast: any;
let RoomView: any;
let PhasePanel: any;
let AgentsPanel: any;
let RaidPanel: any;
let ActivityPanel: any;
let ProjectsPanel: any;
let ToolsPanel: any;
let LogsPanel: any;
let TeamPanel: any;
let TasksPanel: any;
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

function setupDOM(opts: { withSocket?: boolean; withPanelEls?: boolean; withLoadingEl?: boolean; withThemeToggle?: boolean } = {}) {
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

  const rightPanel = document.createElement('div');
  rightPanel.id = 'right-panel';
  document.body.appendChild(rightPanel);

  if (opts.withPanelEls) {
    for (const id of ['panel-phase', 'panel-agents', 'panel-tasks', 'panel-raid', 'panel-activity', 'panel-projects', 'panel-tools', 'panel-logs', 'panel-team']) {
      const el = document.createElement('div');
      el.id = id;
      document.body.appendChild(el);
    }
  }

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

  const panelMod = await import('../../../public/ui/components/panel.js');
  initPanelSystem = (panelMod as any).initPanelSystem;

  const toastMod = await import('../../../public/ui/components/toast.js');
  Toast = (toastMod as any).Toast;

  const rvMod = await import('../../../public/ui/views/room-view.js');
  RoomView = (rvMod as any).RoomView;

  const ppMod = await import('../../../public/ui/panels/phase-panel.js');
  PhasePanel = (ppMod as any).PhasePanel;

  const apMod = await import('../../../public/ui/panels/agents-panel.js');
  AgentsPanel = (apMod as any).AgentsPanel;

  const rpMod = await import('../../../public/ui/panels/raid-panel.js');
  RaidPanel = (rpMod as any).RaidPanel;

  const acMod = await import('../../../public/ui/panels/activity-panel.js');
  ActivityPanel = (acMod as any).ActivityPanel;

  const prjMod = await import('../../../public/ui/panels/projects-panel.js');
  ProjectsPanel = (prjMod as any).ProjectsPanel;

  const tlMod = await import('../../../public/ui/panels/tools-panel.js');
  ToolsPanel = (tlMod as any).ToolsPanel;

  const lgMod = await import('../../../public/ui/panels/logs-panel.js');
  LogsPanel = (lgMod as any).LogsPanel;

  const tmMod = await import('../../../public/ui/panels/team-panel.js');
  TeamPanel = (tmMod as any).TeamPanel;

  const tkMod = await import('../../../public/ui/panels/tasks-panel.js');
  TasksPanel = (tkMod as any).TasksPanel;

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
    setupDOM({ withSocket: true, withPanelEls: true });
    await importBoot();
    expect(createV2Store).toHaveBeenCalledTimes(1);
  });

  it('calls OverlordUI.init() with the created store', async () => {
    setupDOM({ withSocket: true, withPanelEls: true });
    await importBoot();
    expect(OverlordUI.init).toHaveBeenCalledTimes(1);
    expect(OverlordUI.init).toHaveBeenCalledWith(mockStore);
  });

  it('init returns the engine singleton', async () => {
    setupDOM({ withSocket: true, withPanelEls: true });
    await importBoot();
    expect(OverlordUI.init).toHaveReturnedWith(mockEngine);
  });

  it('queries DOM for center-panel, building-panel, right-panel', async () => {
    const spy = vi.spyOn(document, 'getElementById');
    setupDOM({ withSocket: true, withPanelEls: true });
    await importBoot();
    const ids = spy.mock.calls.map((c: any[]) => c[0]);
    expect(ids).toContain('center-panel');
    expect(ids).toContain('building-panel');
    expect(ids).toContain('right-panel');
    spy.mockRestore();
  });

  it('logs boot complete message to console', async () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
    setupDOM({ withSocket: true, withPanelEls: true });
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
    setupDOM({ withSocket: true, withPanelEls: true });
    await importBoot();
    expect((globalThis as any).io).toHaveBeenCalledTimes(1);
  });

  it('calls initSocketBridge with socket, store, and engine', async () => {
    const mockSocket = setupDOM({ withSocket: true, withPanelEls: true });
    await importBoot();
    expect(initSocketBridge).toHaveBeenCalledTimes(1);
    expect(initSocketBridge).toHaveBeenCalledWith(mockSocket, mockStore, mockEngine);
  });

  it('calls initRouter with centerPanel and buildingPanel elements', async () => {
    setupDOM({ withSocket: true, withPanelEls: true });
    await importBoot();
    expect(initRouter).toHaveBeenCalledTimes(1);
    const arg = initRouter.mock.calls[0][0];
    expect(arg.centerPanel).toBeInstanceOf(HTMLElement);
    expect(arg.centerPanel.id).toBe('center-panel');
    expect(arg.buildingPanel).toBeInstanceOf(HTMLElement);
    expect(arg.buildingPanel.id).toBe('building-panel');
  });

  it('calls initPanelSystem after constructing panels', async () => {
    setupDOM({ withSocket: true, withPanelEls: true });
    await importBoot();
    expect(initPanelSystem).toHaveBeenCalledTimes(1);
  });

  it('calls initBuildingView to mount the building sidebar', async () => {
    setupDOM({ withSocket: true, withPanelEls: true });
    await importBoot();
    expect(initBuildingView).toHaveBeenCalledTimes(1);
  });

  it('creates a RoomView and calls mount()', async () => {
    setupDOM({ withSocket: true, withPanelEls: true });
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
//  3. PANEL CONSTRUCTION
// ═══════════════════════════════════════════════════════════════════

describe('boot.js — panel construction', () => {
  it('constructs PhasePanel when #panel-phase exists', async () => {
    setupDOM({ withSocket: true, withPanelEls: true });
    await importBoot();
    expect(PhasePanel).toHaveBeenCalledTimes(1);
    const arg = PhasePanel.mock.calls[0][0];
    expect(arg.id).toBe('panel-phase');
  });

  it('constructs AgentsPanel when #panel-agents exists', async () => {
    setupDOM({ withSocket: true, withPanelEls: true });
    await importBoot();
    expect(AgentsPanel).toHaveBeenCalledTimes(1);
    const arg = AgentsPanel.mock.calls[0][0];
    expect(arg.id).toBe('panel-agents');
  });

  it('constructs RaidPanel when #panel-raid exists', async () => {
    setupDOM({ withSocket: true, withPanelEls: true });
    await importBoot();
    expect(RaidPanel).toHaveBeenCalledTimes(1);
    const arg = RaidPanel.mock.calls[0][0];
    expect(arg.id).toBe('panel-raid');
  });

  it('constructs ActivityPanel when #panel-activity exists', async () => {
    setupDOM({ withSocket: true, withPanelEls: true });
    await importBoot();
    expect(ActivityPanel).toHaveBeenCalledTimes(1);
    const arg = ActivityPanel.mock.calls[0][0];
    expect(arg.id).toBe('panel-activity');
  });

  it('constructs ProjectsPanel when #panel-projects exists', async () => {
    setupDOM({ withSocket: true, withPanelEls: true });
    await importBoot();
    expect(ProjectsPanel).toHaveBeenCalledTimes(1);
    const arg = ProjectsPanel.mock.calls[0][0];
    expect(arg.id).toBe('panel-projects');
  });

  it('constructs ToolsPanel when #panel-tools exists', async () => {
    setupDOM({ withSocket: true, withPanelEls: true });
    await importBoot();
    expect(ToolsPanel).toHaveBeenCalledTimes(1);
    const arg = ToolsPanel.mock.calls[0][0];
    expect(arg.id).toBe('panel-tools');
  });

  it('constructs LogsPanel when #panel-logs exists', async () => {
    setupDOM({ withSocket: true, withPanelEls: true });
    await importBoot();
    expect(LogsPanel).toHaveBeenCalledTimes(1);
    const arg = LogsPanel.mock.calls[0][0];
    expect(arg.id).toBe('panel-logs');
  });

  it('constructs TeamPanel when #panel-team exists', async () => {
    setupDOM({ withSocket: true, withPanelEls: true });
    await importBoot();
    expect(TeamPanel).toHaveBeenCalledTimes(1);
    const arg = TeamPanel.mock.calls[0][0];
    expect(arg.id).toBe('panel-team');
  });

  it('skips panel construction when panel elements are missing from DOM', async () => {
    setupDOM({ withSocket: true, withPanelEls: false });
    await importBoot();
    expect(PhasePanel).not.toHaveBeenCalled();
    expect(AgentsPanel).not.toHaveBeenCalled();
    expect(RaidPanel).not.toHaveBeenCalled();
    expect(ActivityPanel).not.toHaveBeenCalled();
    expect(ProjectsPanel).not.toHaveBeenCalled();
    expect(ToolsPanel).not.toHaveBeenCalled();
    expect(LogsPanel).not.toHaveBeenCalled();
    expect(TeamPanel).not.toHaveBeenCalled();
    expect(TasksPanel).not.toHaveBeenCalled();
  });

  it('still calls initPanelSystem even when no panel elements exist', async () => {
    setupDOM({ withSocket: true, withPanelEls: false });
    await importBoot();
    expect(initPanelSystem).toHaveBeenCalledTimes(1);
  });
});

// ═══════════════════════════════════════════════════════════════════
//  4. system:status EVENT HANDLER
// ═══════════════════════════════════════════════════════════════════

describe('boot.js — system:status handler', () => {
  it('subscribes to system:status via engine.subscribe', async () => {
    setupDOM({ withSocket: true, withPanelEls: true });
    await importBoot();
    const events = mockEngine.subscribe.mock.calls.map((c: any[]) => c[0]);
    expect(events).toContain('system:status');
  });

  it('removes #loading-state element when system:status fires', async () => {
    setupDOM({ withSocket: true, withPanelEls: true, withLoadingEl: true });
    await importBoot();
    expect(document.getElementById('loading-state')).toBeTruthy();

    const cb = getSubscribeCallback(mockEngine.subscribe, 'system:status');
    cb!({ buildings: [], isNewUser: false });
    expect(document.getElementById('loading-state')).toBeNull();
  });

  it('does not throw when #loading-state is missing', async () => {
    setupDOM({ withSocket: true, withPanelEls: true, withLoadingEl: false });
    await importBoot();
    const cb = getSubscribeCallback(mockEngine.subscribe, 'system:status');
    expect(() => cb!({ buildings: [], isNewUser: false })).not.toThrow();
  });

  it('sets building.list in store when data.buildings is present', async () => {
    setupDOM({ withSocket: true, withPanelEls: true });
    await importBoot();
    mockStore.set.mockClear();

    const cb = getSubscribeCallback(mockEngine.subscribe, 'system:status');
    const buildings = [{ id: 'b1', name: 'HQ' }];
    cb!({ buildings, isNewUser: false });
    expect(mockStore.set).toHaveBeenCalledWith('building.list', buildings);
  });

  it('does not set building.list when data.buildings is undefined', async () => {
    setupDOM({ withSocket: true, withPanelEls: true });
    await importBoot();
    mockStore.set.mockClear();

    const cb = getSubscribeCallback(mockEngine.subscribe, 'system:status');
    cb!({ isNewUser: true });
    expect(mockStore.set).not.toHaveBeenCalledWith('building.list', expect.anything());
  });

  it('navigates to strategist for new users', async () => {
    setupDOM({ withSocket: true, withPanelEls: true });
    await importBoot();

    const cb = getSubscribeCallback(mockEngine.subscribe, 'system:status');
    cb!({ isNewUser: true, buildings: [] });
    expect(getInitialRoute).toHaveBeenCalledWith(true);
    expect(navigateTo).toHaveBeenCalledWith('strategist');
  });

  it('navigates to dashboard for returning users with buildings', async () => {
    setupDOM({ withSocket: true, withPanelEls: true });
    await importBoot();

    const cb = getSubscribeCallback(mockEngine.subscribe, 'system:status');
    cb!({ isNewUser: false, buildings: [{ id: 'b1' }] });
    expect(getInitialRoute).toHaveBeenCalledWith(false);
    expect(navigateTo).toHaveBeenCalledWith('dashboard');
  });

  it('navigates to strategist when buildings array is empty', async () => {
    setupDOM({ withSocket: true, withPanelEls: true });
    await importBoot();

    const cb = getSubscribeCallback(mockEngine.subscribe, 'system:status');
    cb!({ isNewUser: false, buildings: [] });
    // !data.buildings?.length is true when array is empty
    expect(getInitialRoute).toHaveBeenCalledWith(true);
    expect(navigateTo).toHaveBeenCalledWith('strategist');
  });
});

// ═══════════════════════════════════════════════════════════════════
//  5. CONNECTION LIFECYCLE HANDLERS
// ═══════════════════════════════════════════════════════════════════

describe('boot.js — connection lifecycle', () => {
  it('subscribes to connection:lost via engine.subscribe', async () => {
    setupDOM({ withSocket: true, withPanelEls: true });
    await importBoot();
    const events = mockEngine.subscribe.mock.calls.map((c: any[]) => c[0]);
    expect(events).toContain('connection:lost');
  });

  it('shows warning toast on connection:lost', async () => {
    setupDOM({ withSocket: true, withPanelEls: true });
    await importBoot();

    const cb = getSubscribeCallback(mockEngine.subscribe, 'connection:lost');
    cb!();
    expect(Toast.warning).toHaveBeenCalledWith('Connection lost. Reconnecting...');
  });

  it('subscribes to ui.connected via store.subscribe', async () => {
    setupDOM({ withSocket: true, withPanelEls: true });
    await importBoot();
    const keys = mockStore.subscribe.mock.calls.map((c: any[]) => c[0]);
    expect(keys).toContain('ui.connected');
  });

  it('shows success toast when ui.connected becomes true', async () => {
    setupDOM({ withSocket: true, withPanelEls: true });
    await importBoot();

    const cb = getSubscribeCallback(mockStore.subscribe, 'ui.connected');
    cb!(true);
    expect(Toast.success).toHaveBeenCalledWith('Connected to Overlord');
  });

  it('does not show success toast when ui.connected is false', async () => {
    setupDOM({ withSocket: true, withPanelEls: true });
    await importBoot();

    const cb = getSubscribeCallback(mockStore.subscribe, 'ui.connected');
    cb!(false);
    expect(Toast.success).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════
//  6. PHASE BAR REACTIVITY
// ═══════════════════════════════════════════════════════════════════

describe('boot.js — phase bar reactivity', () => {
  it('subscribes to building.activePhase via store.subscribe', async () => {
    setupDOM({ withSocket: true, withPanelEls: true });
    await importBoot();
    const keys = mockStore.subscribe.mock.calls.map((c: any[]) => c[0]);
    expect(keys).toContain('building.activePhase');
  });

  it('_updatePhaseBar marks steps before active as completed', async () => {
    setupDOM({ withSocket: true, withPanelEls: true });

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

  it('_updatePhaseBar clears previous classes before applying new ones', async () => {
    setupDOM({ withSocket: true, withPanelEls: true });

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
    setupDOM({ withSocket: true, withPanelEls: true });

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
    setupDOM({ withSocket: true, withPanelEls: true });

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
    setupDOM({ withSocket: true, withPanelEls: true });

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
    setupDOM({ withSocket: true, withPanelEls: true });

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
    setupDOM({ withSocket: true, withPanelEls: true });
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

  it('does not construct any panels when io is undefined', async () => {
    setupDOM({ withSocket: false, withPanelEls: true });
    await importBoot();
    expect(PhasePanel).not.toHaveBeenCalled();
    expect(AgentsPanel).not.toHaveBeenCalled();
    expect(RaidPanel).not.toHaveBeenCalled();
    expect(ActivityPanel).not.toHaveBeenCalled();
    expect(ProjectsPanel).not.toHaveBeenCalled();
    expect(ToolsPanel).not.toHaveBeenCalled();
    expect(LogsPanel).not.toHaveBeenCalled();
    expect(TeamPanel).not.toHaveBeenCalled();
    expect(TasksPanel).not.toHaveBeenCalled();
  });

  it('does not call initPanelSystem when io is undefined', async () => {
    setupDOM({ withSocket: false });
    await importBoot();
    expect(initPanelSystem).not.toHaveBeenCalled();
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
    setupDOM({ withSocket: true, withPanelEls: true });
    await importBoot();
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('restores saved theme from localStorage', async () => {
    localStorage.setItem('overlord-theme', 'light');
    setupDOM({ withSocket: true, withPanelEls: true });
    await importBoot();
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('toggle button switches dark to light on click', async () => {
    setupDOM({ withSocket: true, withPanelEls: true, withThemeToggle: true });
    await importBoot();

    const btn = document.getElementById('theme-toggle')!;
    btn.click();

    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(localStorage.getItem('overlord-theme')).toBe('light');
  });

  it('toggle button switches light to dark on click', async () => {
    localStorage.setItem('overlord-theme', 'light');
    setupDOM({ withSocket: true, withPanelEls: true, withThemeToggle: true });
    await importBoot();

    const btn = document.getElementById('theme-toggle')!;
    btn.click();

    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(localStorage.getItem('overlord-theme')).toBe('dark');
  });

  it('toggle button adds theme-light class when switching to light', async () => {
    setupDOM({ withSocket: true, withPanelEls: true, withThemeToggle: true });
    await importBoot();

    const btn = document.getElementById('theme-toggle')!;
    btn.click();

    expect(btn.classList.contains('theme-light')).toBe(true);
  });

  it('toggle button removes theme-light class when switching to dark', async () => {
    localStorage.setItem('overlord-theme', 'light');
    setupDOM({ withSocket: true, withPanelEls: true, withThemeToggle: true });
    await importBoot();

    const btn = document.getElementById('theme-toggle')!;
    expect(btn.classList.contains('theme-light')).toBe(true);

    btn.click();
    expect(btn.classList.contains('theme-light')).toBe(false);
  });

  it('sets correct title on toggle button for dark theme', async () => {
    setupDOM({ withSocket: true, withPanelEls: true, withThemeToggle: true });
    await importBoot();

    const btn = document.getElementById('theme-toggle')!;
    expect(btn.title).toBe('Switch to light theme');
  });

  it('sets correct title on toggle button for light theme', async () => {
    localStorage.setItem('overlord-theme', 'light');
    setupDOM({ withSocket: true, withPanelEls: true, withThemeToggle: true });
    await importBoot();

    const btn = document.getElementById('theme-toggle')!;
    expect(btn.title).toBe('Switch to dark theme');
  });

  it('exports theme functions on window._overlordTheme', async () => {
    setupDOM({ withSocket: true, withPanelEls: true });
    await importBoot();

    const themeExport = (window as any)._overlordTheme;
    expect(themeExport).toBeDefined();
    expect(typeof themeExport.initTheme).toBe('function');
    expect(typeof themeExport.applyTheme).toBe('function');
    expect(themeExport.THEME_KEY).toBe('overlord-theme');
  });

  it('does not crash when theme-toggle button is missing', async () => {
    setupDOM({ withSocket: true, withPanelEls: true, withThemeToggle: false });
    await expect(importBoot()).resolves.not.toThrow();
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('persists theme across toggle cycles', async () => {
    setupDOM({ withSocket: true, withPanelEls: true, withThemeToggle: true });
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
