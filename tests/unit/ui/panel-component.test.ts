// @vitest-environment jsdom
/**
 * Tests for public/ui/components/panel.js
 *
 * Covers: PanelComponent class (construction, registry, collapse/expand,
 *         show/hide, isCollapsed/isVisible getters, destroy cleanup),
 *         and utility functions (togglePanelVisibility, showAllPanels,
 *         hideAllPanels).
 */

import { describe, it, expect, beforeEach } from 'vitest';

const storePath = '../../../public/ui/engine/store.js';
const enginePath = '../../../public/ui/engine/engine.js';
const panelPath = '../../../public/ui/components/panel.js';

let Store: any;
let OverlordUI: any;
let PanelComponent: any;
let getPanels: any;
let togglePanelVisibility: any;
let showAllPanels: any;
let hideAllPanels: any;

function createPanelEl(id: string): HTMLElement {
  const el = document.createElement('div');
  el.id = id;
  el.className = 'panel';
  const header = document.createElement('div');
  header.className = 'panel-header';
  const body = document.createElement('div');
  body.className = 'panel-body';
  el.appendChild(header);
  el.appendChild(body);
  return el;
}

beforeEach(async () => {
  document.body.textContent = '';

  const storeMod = await import(storePath);
  const engineMod = await import(enginePath);
  const panelMod = await import(panelPath);

  Store = storeMod.Store;
  OverlordUI = engineMod.OverlordUI;
  PanelComponent = panelMod.PanelComponent;
  getPanels = panelMod.getPanels;
  togglePanelVisibility = panelMod.togglePanelVisibility;
  showAllPanels = panelMod.showAllPanels;
  hideAllPanels = panelMod.hideAllPanels;

  const store = new Store();
  store.set('panels.states', {}, { silent: true });
  store.set('panels.visibility', {}, { silent: true });
  store.set('panels.heights', {}, { silent: true });
  OverlordUI.init(store);

  // Clear the panel registry between tests
  getPanels().clear();
});

// ─── Constructor ─────────────────────────────────────────────

describe('PanelComponent — constructor', () => {
  it('self-registers in the PANELS registry', () => {
    const el = createPanelEl('panel-test');
    const panel = new PanelComponent(el, { id: 'panel-test', label: 'Test', icon: 'T' });

    expect(getPanels().has('panel-test')).toBe(true);
    expect(getPanels().get('panel-test')).toBe(panel);
  });

  it('uses el.id if opts.id is not provided', () => {
    const el = createPanelEl('panel-fallback');
    const panel = new PanelComponent(el, { label: 'Fallback', icon: 'F' });

    expect(panel.id).toBe('panel-fallback');
    expect(getPanels().has('panel-fallback')).toBe(true);
  });

  it('stores header and content references', () => {
    const el = createPanelEl('panel-refs');
    const panel = new PanelComponent(el, { id: 'panel-refs', label: 'Refs', icon: 'R' });

    expect(panel._headerEl).toBe(el.querySelector('.panel-header'));
    expect(panel._contentEl).toBe(el.querySelector('.panel-body'));
  });

  it('initializes state flags to defaults', () => {
    const el = createPanelEl('panel-defaults');
    const panel = new PanelComponent(el, { id: 'panel-defaults', label: 'Defaults', icon: 'D' });

    expect(panel._collapsed).toBe(false);
    expect(panel._visible).toBe(true);
    expect(panel._poppedOut).toBe(false);
  });

  it('merges opts with defaults', () => {
    const el = createPanelEl('panel-opts');
    const panel = new PanelComponent(el, {
      id: 'panel-opts',
      label: 'Opts',
      icon: 'O',
      defaultVisible: false,
      popOutEnabled: false,
    });

    expect(panel.opts.defaultVisible).toBe(false);
    expect(panel.opts.popOutEnabled).toBe(false);
    expect(panel.opts.maximizeEnabled).toBe(true); // default
  });
});

// ─── mount() ─────────────────────────────────────────────────

describe('PanelComponent — mount()', () => {
  it('sets _mounted to true', () => {
    const el = createPanelEl('panel-mount');
    document.body.appendChild(el);
    const panel = new PanelComponent(el, { id: 'panel-mount', label: 'Mount', icon: 'M' });

    expect(panel._mounted).toBe(false);
    panel.mount();
    expect(panel._mounted).toBe(true);
  });

  it('sets up collapse behavior on header click', () => {
    const el = createPanelEl('panel-collapse-setup');
    document.body.appendChild(el);
    const panel = new PanelComponent(el, { id: 'panel-collapse-setup', label: 'C', icon: 'C' });
    panel.mount();

    const header = el.querySelector('.panel-header') as HTMLElement;
    expect(panel.isCollapsed).toBe(false);

    header.click();
    expect(panel.isCollapsed).toBe(true);

    header.click();
    expect(panel.isCollapsed).toBe(false);
  });

  it('sets up ARIA accessibility attributes on header', () => {
    const el = createPanelEl('panel-aria');
    document.body.appendChild(el);
    const panel = new PanelComponent(el, { id: 'panel-aria', label: 'ARIA', icon: 'A' });
    panel.mount();

    const header = el.querySelector('.panel-header') as HTMLElement;
    expect(header.getAttribute('tabindex')).toBe('0');
    expect(header.getAttribute('role')).toBe('button');
    expect(header.getAttribute('aria-expanded')).toBe('true');
  });
});

// ─── collapse / expand ───────────────────────────────────────

describe('PanelComponent — collapse/expand', () => {
  it('collapse() adds "collapsed" class', () => {
    const el = createPanelEl('panel-col');
    const panel = new PanelComponent(el, { id: 'panel-col', label: 'Col', icon: 'C' });

    panel.collapse();
    expect(el.classList.contains('collapsed')).toBe(true);
    expect(panel._collapsed).toBe(true);
  });

  it('expand() removes "collapsed" class', () => {
    const el = createPanelEl('panel-exp');
    const panel = new PanelComponent(el, { id: 'panel-exp', label: 'Exp', icon: 'E' });

    panel.collapse();
    expect(el.classList.contains('collapsed')).toBe(true);

    panel.expand();
    expect(el.classList.contains('collapsed')).toBe(false);
    expect(panel._collapsed).toBe(false);
  });

  it('toggleCollapse() toggles between collapsed/expanded', () => {
    const el = createPanelEl('panel-toggle-col');
    const panel = new PanelComponent(el, { id: 'panel-toggle-col', label: 'TC', icon: 'T' });

    panel.toggleCollapse();
    expect(panel.isCollapsed).toBe(true);

    panel.toggleCollapse();
    expect(panel.isCollapsed).toBe(false);
  });

  it('updates data-state attribute on collapse/expand', () => {
    const el = createPanelEl('panel-state-attr');
    const panel = new PanelComponent(el, { id: 'panel-state-attr', label: 'DS', icon: 'D' });

    panel.collapse();
    expect(el.getAttribute('data-state')).toBe('closed');

    panel.expand();
    expect(el.getAttribute('data-state')).toBe('open');
  });
});

// ─── isCollapsed getter ──────────────────────────────────────

describe('PanelComponent — isCollapsed getter', () => {
  it('returns false initially', () => {
    const el = createPanelEl('panel-is-col');
    const panel = new PanelComponent(el, { id: 'panel-is-col', label: 'IC', icon: 'I' });
    expect(panel.isCollapsed).toBe(false);
  });

  it('returns true after collapse()', () => {
    const el = createPanelEl('panel-is-col-2');
    const panel = new PanelComponent(el, { id: 'panel-is-col-2', label: 'IC2', icon: 'I' });
    panel.collapse();
    expect(panel.isCollapsed).toBe(true);
  });

  it('returns false after expand()', () => {
    const el = createPanelEl('panel-is-col-3');
    const panel = new PanelComponent(el, { id: 'panel-is-col-3', label: 'IC3', icon: 'I' });
    panel.collapse();
    panel.expand();
    expect(panel.isCollapsed).toBe(false);
  });
});

// ─── show / hide ─────────────────────────────────────────────

describe('PanelComponent — show/hide', () => {
  it('show() removes "panel-hidden" class', () => {
    const el = createPanelEl('panel-show');
    const panel = new PanelComponent(el, { id: 'panel-show', label: 'Show', icon: 'S' });

    panel.hide();
    expect(el.classList.contains('panel-hidden')).toBe(true);

    panel.show();
    expect(el.classList.contains('panel-hidden')).toBe(false);
  });

  it('hide() adds "panel-hidden" class', () => {
    const el = createPanelEl('panel-hide');
    const panel = new PanelComponent(el, { id: 'panel-hide', label: 'Hide', icon: 'H' });

    panel.hide();
    expect(el.classList.contains('panel-hidden')).toBe(true);
    expect(panel._visible).toBe(false);
  });

  it('show() sets _visible to true', () => {
    const el = createPanelEl('panel-show-flag');
    const panel = new PanelComponent(el, { id: 'panel-show-flag', label: 'SF', icon: 'S' });

    panel.hide();
    expect(panel._visible).toBe(false);

    panel.show();
    expect(panel._visible).toBe(true);
  });
});

// ─── isVisible getter ────────────────────────────────────────

describe('PanelComponent — isVisible getter', () => {
  it('returns true initially', () => {
    const el = createPanelEl('panel-is-vis');
    const panel = new PanelComponent(el, { id: 'panel-is-vis', label: 'IV', icon: 'I' });
    expect(panel.isVisible).toBe(true);
  });

  it('returns false after hide()', () => {
    const el = createPanelEl('panel-is-vis-2');
    const panel = new PanelComponent(el, { id: 'panel-is-vis-2', label: 'IV2', icon: 'I' });
    panel.hide();
    expect(panel.isVisible).toBe(false);
  });

  it('returns true after show()', () => {
    const el = createPanelEl('panel-is-vis-3');
    const panel = new PanelComponent(el, { id: 'panel-is-vis-3', label: 'IV3', icon: 'I' });
    panel.hide();
    panel.show();
    expect(panel.isVisible).toBe(true);
  });
});

// ─── destroy() ───────────────────────────────────────────────

describe('PanelComponent — destroy()', () => {
  it('removes panel from the PANELS registry', () => {
    const el = createPanelEl('panel-destroy');
    document.body.appendChild(el);
    const panel = new PanelComponent(el, { id: 'panel-destroy', label: 'Destroy', icon: 'D' });

    expect(getPanels().has('panel-destroy')).toBe(true);
    panel.destroy();
    expect(getPanels().has('panel-destroy')).toBe(false);
  });

  it('calls parent destroy (cleans up subs and listeners)', () => {
    const el = createPanelEl('panel-destroy-2');
    document.body.appendChild(el);
    const panel = new PanelComponent(el, { id: 'panel-destroy-2', label: 'D2', icon: 'D' });
    panel.mount();

    // After mount, there should be listeners registered
    expect(panel._listeners.length).toBeGreaterThan(0);

    panel.destroy();
    expect(panel._listeners).toEqual([]);
    expect(panel._subs).toEqual([]);
  });

  it('sets _mounted to false', () => {
    const el = createPanelEl('panel-destroy-3');
    document.body.appendChild(el);
    const panel = new PanelComponent(el, { id: 'panel-destroy-3', label: 'D3', icon: 'D' });
    panel.mount();
    expect(panel._mounted).toBe(true);

    panel.destroy();
    expect(panel._mounted).toBe(false);
  });
});

// ─── Utility: togglePanelVisibility ──────────────────────────

describe('togglePanelVisibility()', () => {
  it('toggles a visible panel to hidden', () => {
    const el = createPanelEl('panel-toggle-vis');
    document.body.appendChild(el);
    const panel = new PanelComponent(el, {
      id: 'panel-toggle-vis',
      label: 'TV',
      icon: 'T',
      defaultVisible: true,
    });
    panel.mount();

    // Initially visible (defaultVisible: true)
    togglePanelVisibility('panel-toggle-vis');

    const store = OverlordUI.getStore();
    const vis = store.peek('panels.visibility', {});
    expect(vis['panel-toggle-vis']).toBe(false);
  });

  it('toggles a hidden panel to visible', () => {
    const el = createPanelEl('panel-toggle-vis-2');
    document.body.appendChild(el);
    const panel = new PanelComponent(el, {
      id: 'panel-toggle-vis-2',
      label: 'TV2',
      icon: 'T',
      defaultVisible: false,
    });
    panel.mount();

    const store = OverlordUI.getStore();
    // Set initial state as hidden
    store.set('panels.visibility', { 'panel-toggle-vis-2': false });

    togglePanelVisibility('panel-toggle-vis-2');

    const vis = store.peek('panels.visibility', {});
    expect(vis['panel-toggle-vis-2']).toBe(true);
  });

  it('does nothing for non-existent panel IDs', () => {
    expect(() => togglePanelVisibility('nonexistent-panel')).not.toThrow();
  });
});

// ─── Utility: showAllPanels / hideAllPanels ──────────────────

describe('showAllPanels() / hideAllPanels()', () => {
  it('showAllPanels() sets all panels to visible in store', () => {
    const el1 = createPanelEl('panel-sa-1');
    const el2 = createPanelEl('panel-sa-2');
    document.body.appendChild(el1);
    document.body.appendChild(el2);

    new PanelComponent(el1, { id: 'panel-sa-1', label: 'SA1', icon: '1' });
    new PanelComponent(el2, { id: 'panel-sa-2', label: 'SA2', icon: '2' });

    showAllPanels();

    const store = OverlordUI.getStore();
    const vis = store.peek('panels.visibility', {});
    expect(vis['panel-sa-1']).toBe(true);
    expect(vis['panel-sa-2']).toBe(true);
  });

  it('hideAllPanels() sets all panels to hidden in store', () => {
    const el1 = createPanelEl('panel-ha-1');
    const el2 = createPanelEl('panel-ha-2');
    document.body.appendChild(el1);
    document.body.appendChild(el2);

    new PanelComponent(el1, { id: 'panel-ha-1', label: 'HA1', icon: '1' });
    new PanelComponent(el2, { id: 'panel-ha-2', label: 'HA2', icon: '2' });

    hideAllPanels();

    const store = OverlordUI.getStore();
    const vis = store.peek('panels.visibility', {});
    expect(vis['panel-ha-1']).toBe(false);
    expect(vis['panel-ha-2']).toBe(false);
  });

  it('showAllPanels() after hideAllPanels() restores visibility', () => {
    const el1 = createPanelEl('panel-restore-1');
    const el2 = createPanelEl('panel-restore-2');
    document.body.appendChild(el1);
    document.body.appendChild(el2);

    const p1 = new PanelComponent(el1, { id: 'panel-restore-1', label: 'R1', icon: '1' });
    const p2 = new PanelComponent(el2, { id: 'panel-restore-2', label: 'R2', icon: '2' });
    p1.mount();
    p2.mount();

    hideAllPanels();
    expect(p1.isVisible).toBe(false);
    expect(p2.isVisible).toBe(false);

    showAllPanels();
    expect(p1.isVisible).toBe(true);
    expect(p2.isVisible).toBe(true);
  });
});
