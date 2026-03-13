// @vitest-environment jsdom
/**
 * Script Editor View — Unit Tests
 *
 * Tests the Script Editor IDE view: layout rendering, toolbar buttons,
 * textarea for code editing, console panel, API reference sidebar,
 * keyboard shortcut setup, and lifecycle cleanup.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Mock modules (hoisted before imports) ──────────────────

vi.mock('../../../public/ui/engine/engine.js', () => ({
  OverlordUI: {
    subscribe: vi.fn(() => () => {}),
    dispatch: vi.fn(),
    getStore: vi.fn(() => null),
  },
}));

vi.mock('../../../public/ui/engine/helpers.js', () => ({
  h: vi.fn((...args: any[]) => {
    const el = document.createElement(args[0]);
    if (args[1] && typeof args[1] === 'object') {
      for (const [key, val] of Object.entries(args[1])) {
        if (key === 'class') el.className = val as string;
        else if (key === 'hidden') el.setAttribute('hidden', '');
        else el.setAttribute(key, String(val));
      }
    }
    // Append children (text or elements)
    for (let i = 2; i < args.length; i++) {
      const child = args[i];
      if (child instanceof Node) el.appendChild(child);
      else if (typeof child === 'string') el.appendChild(document.createTextNode(child));
    }
    return el;
  }),
  $: vi.fn((sel: string, root?: HTMLElement) => (root || document).querySelector(sel)),
  $$: vi.fn((sel: string, root?: HTMLElement) => Array.from((root || document).querySelectorAll(sel))),
}));

vi.mock('../../../public/ui/engine/component.js', () => {
  class MockComponent {
    el: HTMLElement;
    opts: Record<string, unknown>;
    _subs: (() => void)[];
    _listeners: (() => void)[];
    _mounted: boolean;

    constructor(el: HTMLElement, opts: Record<string, unknown> = {}) {
      this.el = el;
      this.opts = opts;
      this._subs = [];
      this._listeners = [];
      this._mounted = false;
    }

    mount() { this._mounted = true; }
    render() {}
    unmount() { this._mounted = false; }
    destroy() {
      this.unmount();
      this._subs.forEach(fn => fn());
      this._subs = [];
      this._listeners.forEach(fn => fn());
      this._listeners = [];
    }
  }
  return { Component: MockComponent };
});

// ── Deferred import ────────────────────────────────────────

let ScriptEditorView: any;

// ── Mock socket / globals ──────────────────────────────────

type Callback = (...args: unknown[]) => unknown;
let mockSocket: {
  emit: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  off: ReturnType<typeof vi.fn>;
};

function setupGlobals() {
  mockSocket = {
    emit: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
  };
  (globalThis as any).window = globalThis;
  (window as any).overlordSocket = { socket: mockSocket };
  (window as any).OverlordUI = {
    subscribe: vi.fn(() => () => {}),
    dispatch: vi.fn(),
    getStore: () => null,
  };
}

function teardownGlobals() {
  delete (window as any).overlordSocket;
}

// ── Setup / Teardown ───────────────────────────────────────

beforeEach(async () => {
  vi.resetModules();
  setupGlobals();
  const mod = await import('../../../public/ui/views/script-editor-view.js');
  ScriptEditorView = (mod as any).ScriptEditorView;
});

afterEach(() => {
  teardownGlobals();
});

// ── Tests ──────────────────────────────────────────────────

describe('ScriptEditorView', () => {
  function createView(opts: Record<string, unknown> = {}) {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const view = new ScriptEditorView(container, opts);
    return { view, container };
  }

  // 1. Mounts without error
  it('mounts without error', () => {
    const { view } = createView();
    expect(() => view.mount()).not.toThrow();
  });

  // 2. Has back button, validate button, save button
  it('has back button, validate button, and save button after mount', () => {
    const { view, container } = createView();
    view.mount();

    const backBtn = container.querySelector('.script-editor-back-btn');
    expect(backBtn).not.toBeNull();
    expect(backBtn!.textContent).toContain('Back');

    const validateBtn = container.querySelector('.script-editor-validate-btn');
    expect(validateBtn).not.toBeNull();
    expect(validateBtn!.textContent).toContain('Validate');

    const saveBtn = container.querySelector('.script-editor-save-btn');
    expect(saveBtn).not.toBeNull();
    expect(saveBtn!.textContent).toContain('Save');
  });

  // 3. Has textarea for code editing
  it('has textarea for code editing', () => {
    const { view, container } = createView();
    view.mount();

    const textarea = container.querySelector('.script-editor-textarea');
    expect(textarea).not.toBeNull();
    expect(textarea!.tagName).toBe('TEXTAREA');
    expect(textarea!.getAttribute('spellcheck')).toBe('false');
  });

  // 4. Has console panel
  it('has console panel', () => {
    const { view, container } = createView();
    view.mount();

    const consolePanel = container.querySelector('.script-editor-console');
    expect(consolePanel).not.toBeNull();

    const consoleHeader = container.querySelector('.script-editor-console-header');
    expect(consoleHeader).not.toBeNull();
    expect(consoleHeader!.textContent).toContain('Console');

    const consoleBody = container.querySelector('.script-editor-console-body');
    expect(consoleBody).not.toBeNull();
  });

  // 5. Has API reference sidebar
  it('has API reference sidebar', () => {
    const { view, container } = createView();
    view.mount();

    const sidebar = container.querySelector('.script-editor-sidebar');
    expect(sidebar).not.toBeNull();

    const sidebarHeader = container.querySelector('.script-editor-sidebar-header');
    expect(sidebarHeader).not.toBeNull();
    expect(sidebarHeader!.textContent).toContain('API Reference');

    const sidebarContent = container.querySelector('.script-editor-sidebar-content');
    expect(sidebarContent).not.toBeNull();
    // API reference sections should be rendered
    const sections = sidebarContent!.querySelectorAll('.api-ref-section');
    expect(sections.length).toBeGreaterThan(0);
  });

  // 6. Keyboard shortcut setup (document listener added)
  it('sets up keyboard shortcut listener on document during mount', () => {
    const addSpy = vi.spyOn(document, 'addEventListener');
    const { view } = createView();
    view.mount();

    const keydownCalls = addSpy.mock.calls.filter(
      (c: any[]) => c[0] === 'keydown',
    );
    expect(keydownCalls.length).toBeGreaterThanOrEqual(1);
    // Verify the handler was stored on the instance
    expect(view._keyHandler).toBeDefined();
    expect(typeof view._keyHandler).toBe('function');

    addSpy.mockRestore();
  });

  // 7. Unmount cleans up event listeners
  it('unmount removes document keydown listener', () => {
    const removeSpy = vi.spyOn(document, 'removeEventListener');
    const { view } = createView();
    view.mount();
    expect(view._keyHandler).toBeDefined();

    view.unmount();

    const keydownRemovals = removeSpy.mock.calls.filter(
      (c: any[]) => c[0] === 'keydown' && c[1] === view._keyHandler,
    );
    expect(keydownRemovals.length).toBe(1);

    removeSpy.mockRestore();
  });

  // 8. Destroy cleans up properly
  it('destroy calls unmount and cleans up', () => {
    const removeSpy = vi.spyOn(document, 'removeEventListener');
    const { view } = createView({ pluginId: 'test-script' });
    view.mount();

    const handler = view._keyHandler;
    expect(handler).toBeDefined();

    view.destroy();

    // Keydown listener should have been removed via unmount
    const keydownRemovals = removeSpy.mock.calls.filter(
      (c: any[]) => c[0] === 'keydown' && c[1] === handler,
    );
    expect(keydownRemovals.length).toBeGreaterThanOrEqual(1);

    // Subscriptions and listeners arrays should be empty after destroy
    expect(view._subs).toEqual([]);
    expect(view._listeners).toEqual([]);

    removeSpy.mockRestore();
  });
});
