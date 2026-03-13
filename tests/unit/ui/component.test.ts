// @vitest-environment jsdom
/**
 * Tests for public/ui/engine/component.js
 *
 * Covers: Component base class lifecycle (mount/unmount/destroy),
 *         store subscription management, scoped selectors ($, $$),
 *         event delegation (on)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const componentPath = '../../../public/ui/engine/component.js';
const storePath = '../../../public/ui/engine/store.js';

let Component: any;
let Store: any;

beforeEach(async () => {
  const compMod = await import(componentPath);
  const storeMod = await import(storePath);
  Component = compMod.Component;
  Store = storeMod.Store;
});

// ─── Constructor ────────────────────────────────────────────

describe('Component — constructor', () => {
  it('stores el and opts', () => {
    const el = document.createElement('div');
    const opts = { foo: 'bar' };
    const comp = new Component(el, opts);
    expect(comp.el).toBe(el);
    expect(comp.opts).toEqual(opts);
  });

  it('initializes with _mounted = false', () => {
    const comp = new Component(document.createElement('div'));
    expect(comp._mounted).toBe(false);
  });

  it('initializes empty _subs and _listeners arrays', () => {
    const comp = new Component(document.createElement('div'));
    expect(comp._subs).toEqual([]);
    expect(comp._listeners).toEqual([]);
  });
});

// ─── Lifecycle ──────────────────────────────────────────────

describe('Component — lifecycle', () => {
  it('mount() is callable (no-op by default)', () => {
    const comp = new Component(document.createElement('div'));
    expect(() => comp.mount()).not.toThrow();
  });

  it('render() is callable (no-op by default)', () => {
    const comp = new Component(document.createElement('div'));
    expect(() => comp.render()).not.toThrow();
  });

  it('unmount() sets _mounted to false', () => {
    const comp = new Component(document.createElement('div'));
    comp._mounted = true;
    comp.unmount();
    expect(comp._mounted).toBe(false);
  });

  it('destroy() calls unmount and cleans up subscriptions', () => {
    const comp = new Component(document.createElement('div'));
    const unsub = vi.fn();
    comp._subs.push(unsub);
    comp.destroy();
    expect(unsub).toHaveBeenCalledTimes(1);
    expect(comp._subs).toEqual([]);
  });

  it('destroy() cleans up event listeners', () => {
    const comp = new Component(document.createElement('div'));
    const cleanup = vi.fn();
    comp._listeners.push(cleanup);
    comp.destroy();
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(comp._listeners).toEqual([]);
  });

  it('destroy() removes el from DOM', () => {
    const parent = document.createElement('div');
    const el = document.createElement('div');
    parent.appendChild(el);
    const comp = new Component(el);
    comp.destroy();
    expect(parent.children.length).toBe(0);
  });
});

// ─── Store subscription ─────────────────────────────────────

describe('Component — subscribe()', () => {
  it('subscribes to store key changes', () => {
    const store = new Store();
    const comp = new Component(document.createElement('div'));
    const fn = vi.fn();
    comp.subscribe(store, 'test.key', fn);
    store.set('test.key', 'value');
    expect(fn).toHaveBeenCalledWith('value', 'test.key');
  });

  it('tracks subscription for cleanup on destroy', () => {
    const store = new Store();
    const comp = new Component(document.createElement('div'));
    const fn = vi.fn();
    comp.subscribe(store, 'test.key', fn);
    expect(comp._subs.length).toBe(1);
    comp.destroy();
    // Should not fire after destroy
    store.set('test.key', 'after');
    expect(fn).not.toHaveBeenCalled();
  });
});

// ─── Scoped selectors ───────────────────────────────────────

describe('Component — $() and $$()', () => {
  it('$ finds element within component root', () => {
    const el = document.createElement('div');
    const child = document.createElement('span');
    child.className = 'target';
    el.appendChild(child);

    const comp = new Component(el);
    expect(comp.$('.target')).toBe(child);
  });

  it('$ returns null when no match', () => {
    const comp = new Component(document.createElement('div'));
    expect(comp.$('.missing')).toBeNull();
  });

  it('$$ returns array of matching elements', () => {
    const el = document.createElement('div');
    for (let i = 0; i < 3; i++) {
      const item = document.createElement('div');
      item.className = 'item';
      el.appendChild(item);
    }

    const comp = new Component(el);
    const result = comp.$$('.item');
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(3);
  });
});

// ─── Event delegation ───────────────────────────────────────

describe('Component — on() event delegation', () => {
  it('delegates click events to matching children', () => {
    const el = document.createElement('div');
    const btn = document.createElement('button');
    btn.className = 'action';
    el.appendChild(btn);
    document.body.appendChild(el);

    const comp = new Component(el);
    const handler = vi.fn();
    comp.on('click', '.action', handler);

    btn.click();
    expect(handler).toHaveBeenCalledTimes(1);

    document.body.removeChild(el);
  });

  it('does not fire for non-matching elements', () => {
    const el = document.createElement('div');
    const span = document.createElement('span');
    span.className = 'other';
    el.appendChild(span);
    document.body.appendChild(el);

    const comp = new Component(el);
    const handler = vi.fn();
    comp.on('click', '.action', handler);

    span.click();
    expect(handler).not.toHaveBeenCalled();

    document.body.removeChild(el);
  });

  it('returns cleanup function', () => {
    const el = document.createElement('div');
    const btn = document.createElement('button');
    btn.className = 'btn';
    el.appendChild(btn);
    document.body.appendChild(el);

    const comp = new Component(el);
    const handler = vi.fn();
    const cleanup = comp.on('click', '.btn', handler);

    btn.click();
    expect(handler).toHaveBeenCalledTimes(1);

    cleanup();
    btn.click();
    expect(handler).toHaveBeenCalledTimes(1); // no additional call

    document.body.removeChild(el);
  });

  it('cleans up on destroy', () => {
    const el = document.createElement('div');
    const btn = document.createElement('button');
    btn.className = 'btn';
    el.appendChild(btn);
    document.body.appendChild(el);

    const comp = new Component(el);
    const handler = vi.fn();
    comp.on('click', '.btn', handler);

    comp.destroy();
    // el is removed from DOM by destroy, but handler should be cleaned up
    expect(comp._listeners).toEqual([]);

    document.body.textContent = '';
  });
});
