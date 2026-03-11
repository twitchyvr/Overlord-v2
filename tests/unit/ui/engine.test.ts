// @vitest-environment jsdom
/**
 * Tests for public/ui/engine/engine.js
 *
 * Covers: OverlordUI singleton — init(), getStore(), component registry,
 *         event bus (subscribe/dispatch), event delegation (on()),
 *         BroadcastChannel (broadcast, _setupBroadcastChannel),
 *         re-exported helpers
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const storePath = '../../../public/ui/engine/store.js';
const enginePath = '../../../public/ui/engine/engine.js';

/** Minimal mock component for registry tests */
class MockComp {
  _mounted = false;
  mountCalled = 0;
  unmountCalled = 0;
  destroyCalled = 0;
  mount() { this._mounted = true; this.mountCalled++; }
  unmount() { this._mounted = false; this.unmountCalled++; }
  destroy() { this._mounted = false; this.destroyCalled++; }
}

let OverlordUI: any;
let Store: any;

beforeEach(async () => {
  // Fresh imports each test to avoid cross-test pollution
  const engineMod = await import(enginePath);
  OverlordUI = engineMod.OverlordUI;

  const storeMod = await import(storePath);
  Store = storeMod.Store;

  // Reset singleton state between tests
  OverlordUI._store = null;
  OverlordUI._components.clear();
  OverlordUI._eventBus.clear();
});

// ─── init() ──────────────────────────────────────────────────

describe('OverlordUI.init()', () => {
  it('stores the store reference', () => {
    const store = new Store();
    OverlordUI.init(store);
    expect(OverlordUI._store).toBe(store);
  });

  it('returns the OverlordUI singleton for chaining', () => {
    const store = new Store();
    const result = OverlordUI.init(store);
    expect(result).toBe(OverlordUI);
  });

  it('wires BroadcastChannel to store._channel when both exist', () => {
    const store = new Store();
    expect(store._channel).toBeNull();
    OverlordUI.init(store);
    if (OverlordUI._channel) {
      expect(store._channel).toBe(OverlordUI._channel);
    }
  });

  it('does not crash if store is null', () => {
    expect(() => OverlordUI.init(null)).not.toThrow();
    expect(OverlordUI._store).toBeNull();
  });

  it('calls _setupBroadcastChannel', () => {
    const spy = vi.spyOn(OverlordUI, '_setupBroadcastChannel');
    const store = new Store();
    OverlordUI.init(store);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});

// ─── getStore() ──────────────────────────────────────────────

describe('OverlordUI.getStore()', () => {
  it('returns null before init', () => {
    expect(OverlordUI.getStore()).toBeNull();
  });

  it('returns the initialized store', () => {
    const store = new Store();
    OverlordUI.init(store);
    expect(OverlordUI.getStore()).toBe(store);
  });
});

// ─── Component Registry ─────────────────────────────────────

describe('OverlordUI — component registry', () => {
  it('registerComponent stores and getComponent retrieves', () => {
    const comp = new MockComp();
    OverlordUI.registerComponent('test', comp);
    expect(OverlordUI.getComponent('test')).toBe(comp);
  });

  it('registerComponent returns the instance', () => {
    const comp = new MockComp();
    const result = OverlordUI.registerComponent('test', comp);
    expect(result).toBe(comp);
  });

  it('registerComponent replaces existing and calls destroy on old', () => {
    const old = new MockComp();
    const next = new MockComp();
    OverlordUI.registerComponent('x', old);
    OverlordUI.registerComponent('x', next);
    expect(old.destroyCalled).toBe(1);
    expect(OverlordUI.getComponent('x')).toBe(next);
  });

  it('getComponent returns undefined for unknown id', () => {
    expect(OverlordUI.getComponent('nope')).toBeUndefined();
  });

  it('destroyComponent calls destroy and removes from registry', () => {
    const comp = new MockComp();
    OverlordUI.registerComponent('d', comp);
    OverlordUI.destroyComponent('d');
    expect(comp.destroyCalled).toBe(1);
    expect(OverlordUI.getComponent('d')).toBeUndefined();
  });

  it('destroyComponent is a no-op for unknown id', () => {
    expect(() => OverlordUI.destroyComponent('unknown')).not.toThrow();
  });

  it('destroyComponent catches errors from destroy()', () => {
    const comp = {
      _mounted: false,
      mount() {},
      unmount() {},
      destroy() { throw new Error('destroy failed'); },
    };
    OverlordUI.registerComponent('err', comp);
    expect(() => OverlordUI.destroyComponent('err')).not.toThrow();
    // Still removed from registry despite error
    expect(OverlordUI.getComponent('err')).toBeUndefined();
  });
});

// ─── mountComponent ──────────────────────────────────────────

describe('OverlordUI.mountComponent()', () => {
  it('sets _mounted and calls mount()', () => {
    const comp = new MockComp();
    OverlordUI.registerComponent('m', comp);
    OverlordUI.mountComponent('m');
    expect(comp._mounted).toBe(true);
    expect(comp.mountCalled).toBe(1);
  });

  it('returns the component after mounting', () => {
    const comp = new MockComp();
    OverlordUI.registerComponent('m', comp);
    const result = OverlordUI.mountComponent('m');
    expect(result).toBe(comp);
  });

  it('does not remount an already mounted component', () => {
    const comp = new MockComp();
    OverlordUI.registerComponent('m', comp);
    OverlordUI.mountComponent('m');
    OverlordUI.mountComponent('m');
    expect(comp.mountCalled).toBe(1);
  });

  it('returns the component when already mounted (no-op)', () => {
    const comp = new MockComp();
    OverlordUI.registerComponent('m', comp);
    OverlordUI.mountComponent('m');
    const result = OverlordUI.mountComponent('m');
    expect(result).toBe(comp);
  });

  it('warns and returns undefined for unknown id', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = OverlordUI.mountComponent('missing');
    expect(result).toBeUndefined();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('catches mount() errors without crashing', () => {
    const comp = {
      _mounted: false,
      mount() { throw new Error('mount boom'); },
      unmount() {},
      destroy() {},
    };
    OverlordUI.registerComponent('err', comp);
    expect(() => OverlordUI.mountComponent('err')).not.toThrow();
    // _mounted is set to true BEFORE mount() is called (by engine code)
    expect(comp._mounted).toBe(true);
  });
});

// ─── unmountComponent ────────────────────────────────────────

describe('OverlordUI.unmountComponent()', () => {
  it('calls unmount() on a mounted component', () => {
    const comp = new MockComp();
    OverlordUI.registerComponent('u', comp);
    OverlordUI.mountComponent('u');
    OverlordUI.unmountComponent('u');
    expect(comp.unmountCalled).toBe(1);
  });

  it('does nothing if component is not mounted', () => {
    const comp = new MockComp();
    OverlordUI.registerComponent('u', comp);
    OverlordUI.unmountComponent('u');
    expect(comp.unmountCalled).toBe(0);
  });

  it('does nothing for unknown id', () => {
    expect(() => OverlordUI.unmountComponent('ghost')).not.toThrow();
  });

  it('catches unmount() errors without crashing', () => {
    const comp = {
      _mounted: true,
      mount() {},
      unmount() { throw new Error('unmount boom'); },
      destroy() {},
    };
    OverlordUI.registerComponent('err', comp);
    // Manually set _mounted since we skip mountComponent
    comp._mounted = true;
    expect(() => OverlordUI.unmountComponent('err')).not.toThrow();
  });
});

// ─── mountAll ────────────────────────────────────────────────

describe('OverlordUI.mountAll()', () => {
  it('mounts all registered components', () => {
    const a = new MockComp();
    const b = new MockComp();
    const c = new MockComp();
    OverlordUI.registerComponent('a', a);
    OverlordUI.registerComponent('b', b);
    OverlordUI.registerComponent('c', c);
    OverlordUI.mountAll();
    expect(a._mounted).toBe(true);
    expect(b._mounted).toBe(true);
    expect(c._mounted).toBe(true);
  });

  it('skips already-mounted components', () => {
    const a = new MockComp();
    const b = new MockComp();
    OverlordUI.registerComponent('a', a);
    OverlordUI.registerComponent('b', b);
    OverlordUI.mountComponent('a'); // pre-mount
    OverlordUI.mountAll();
    expect(a.mountCalled).toBe(1); // not 2
    expect(b.mountCalled).toBe(1);
  });

  it('does nothing when no components registered', () => {
    expect(() => OverlordUI.mountAll()).not.toThrow();
  });
});

// ─── Event Bus: subscribe / dispatch ─────────────────────────

describe('OverlordUI — event bus', () => {
  it('subscribe + dispatch delivers data to listener', () => {
    const fn = vi.fn();
    OverlordUI.subscribe('test:event', fn);
    OverlordUI.dispatch('test:event', { value: 42 });
    expect(fn).toHaveBeenCalledWith({ value: 42 });
  });

  it('multiple listeners on same event all fire', () => {
    const fn1 = vi.fn();
    const fn2 = vi.fn();
    OverlordUI.subscribe('evt', fn1);
    OverlordUI.subscribe('evt', fn2);
    OverlordUI.dispatch('evt', 'data');
    expect(fn1).toHaveBeenCalledWith('data');
    expect(fn2).toHaveBeenCalledWith('data');
  });

  it('unsubscribe stops delivery', () => {
    const fn = vi.fn();
    const unsub = OverlordUI.subscribe('evt', fn);
    unsub();
    OverlordUI.dispatch('evt', 'data');
    expect(fn).not.toHaveBeenCalled();
  });

  it('unsubscribe cleans up empty event Set', () => {
    const fn = vi.fn();
    const unsub = OverlordUI.subscribe('cleanup-test', fn);
    unsub();
    expect(OverlordUI._eventBus.has('cleanup-test')).toBe(false);
  });

  it('dispatch is a no-op for events with no listeners', () => {
    expect(() => OverlordUI.dispatch('nobody-listening', {})).not.toThrow();
  });

  it('dispatch with listener error does not break other listeners', () => {
    const fn1 = vi.fn(() => { throw new Error('boom'); });
    const fn2 = vi.fn();
    OverlordUI.subscribe('err-event', fn1);
    OverlordUI.subscribe('err-event', fn2);

    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    OverlordUI.dispatch('err-event', 'payload');

    expect(fn1).toHaveBeenCalledWith('payload');
    expect(fn2).toHaveBeenCalledWith('payload');
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('subscribe returns a function', () => {
    const unsub = OverlordUI.subscribe('evt', () => {});
    expect(typeof unsub).toBe('function');
  });

  it('dispatch passes undefined when no data given', () => {
    const fn = vi.fn();
    OverlordUI.subscribe('evt', fn);
    OverlordUI.dispatch('evt');
    expect(fn).toHaveBeenCalledWith(undefined);
  });
});

// ─── Event Delegation: on() ─────────────────────────────────

describe('OverlordUI.on() — event delegation', () => {
  it('fires handler when target matches selector', () => {
    const root = document.createElement('div');
    const btn = document.createElement('button');
    btn.className = 'action';
    root.appendChild(btn);
    document.body.appendChild(root);

    const handler = vi.fn();
    OverlordUI.on(root, 'click', '.action', handler);

    btn.click();
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][1]).toBe(btn); // second arg is the matched target

    root.remove();
  });

  it('does not fire handler when target does not match selector', () => {
    const root = document.createElement('div');
    const span = document.createElement('span');
    span.className = 'other';
    root.appendChild(span);
    document.body.appendChild(root);

    const handler = vi.fn();
    OverlordUI.on(root, 'click', '.action', handler);

    span.click();
    expect(handler).not.toHaveBeenCalled();

    root.remove();
  });

  it('fires handler when a child of the matching element is clicked', () => {
    const root = document.createElement('div');
    const btn = document.createElement('button');
    btn.className = 'action';
    const icon = document.createElement('span');
    icon.textContent = 'X';
    btn.appendChild(icon);
    root.appendChild(btn);
    document.body.appendChild(root);

    const handler = vi.fn();
    OverlordUI.on(root, 'click', '.action', handler);

    icon.click(); // click the child, should bubble to .action via closest()
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][1]).toBe(btn);

    root.remove();
  });

  it('does not fire if matching element is outside root', () => {
    const root = document.createElement('div');
    const outside = document.createElement('button');
    outside.className = 'action';
    document.body.appendChild(root);
    document.body.appendChild(outside);

    const handler = vi.fn();
    OverlordUI.on(root, 'click', '.action', handler);

    outside.click();
    expect(handler).not.toHaveBeenCalled();

    root.remove();
    outside.remove();
  });

  it('returns a cleanup function that removes the listener', () => {
    const root = document.createElement('div');
    const btn = document.createElement('button');
    btn.className = 'action';
    root.appendChild(btn);
    document.body.appendChild(root);

    const handler = vi.fn();
    const cleanup = OverlordUI.on(root, 'click', '.action', handler);

    cleanup();
    btn.click();
    expect(handler).not.toHaveBeenCalled();

    root.remove();
  });

  it('handles multiple delegated events on same root', () => {
    const root = document.createElement('div');
    const btnA = document.createElement('button');
    btnA.className = 'a';
    const btnB = document.createElement('button');
    btnB.className = 'b';
    root.appendChild(btnA);
    root.appendChild(btnB);
    document.body.appendChild(root);

    const handlerA = vi.fn();
    const handlerB = vi.fn();
    OverlordUI.on(root, 'click', '.a', handlerA);
    OverlordUI.on(root, 'click', '.b', handlerB);

    btnA.click();
    expect(handlerA).toHaveBeenCalledTimes(1);
    expect(handlerB).not.toHaveBeenCalled();

    btnB.click();
    expect(handlerB).toHaveBeenCalledTimes(1);

    root.remove();
  });
});

// ─── BroadcastChannel ────────────────────────────────────────

describe('OverlordUI — BroadcastChannel', () => {
  it('broadcast() sends via _channel.postMessage', () => {
    // Save original and mock
    const original = OverlordUI._channel;
    const mockChannel = { postMessage: vi.fn(), onmessage: null };
    OverlordUI._channel = mockChannel;

    OverlordUI.broadcast({ type: 'theme_changed', theme: 'light' });
    expect(mockChannel.postMessage).toHaveBeenCalledWith({
      type: 'theme_changed',
      theme: 'light',
    });

    OverlordUI._channel = original;
  });

  it('broadcast() is a no-op when _channel is null', () => {
    const original = OverlordUI._channel;
    OverlordUI._channel = null;
    expect(() => OverlordUI.broadcast({ type: 'test' })).not.toThrow();
    OverlordUI._channel = original;
  });

  it('broadcast() catches postMessage errors', () => {
    const original = OverlordUI._channel;
    const mockChannel = {
      postMessage: vi.fn(() => { throw new Error('channel error'); }),
      onmessage: null,
    };
    OverlordUI._channel = mockChannel;

    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() => OverlordUI.broadcast({ type: 'test' })).not.toThrow();
    spy.mockRestore();

    OverlordUI._channel = original;
  });

  it('_setupBroadcastChannel sets onmessage handler', () => {
    const original = OverlordUI._channel;
    const mockChannel = { postMessage: vi.fn(), onmessage: null };
    OverlordUI._channel = mockChannel;

    OverlordUI._setupBroadcastChannel();
    expect(typeof mockChannel.onmessage).toBe('function');

    OverlordUI._channel = original;
  });

  it('_setupBroadcastChannel is a no-op when _channel is null', () => {
    const original = OverlordUI._channel;
    OverlordUI._channel = null;
    expect(() => OverlordUI._setupBroadcastChannel()).not.toThrow();
    OverlordUI._channel = original;
  });

  it('onmessage handler dispatches broadcast:<type> events', () => {
    const original = OverlordUI._channel;
    const mockChannel = { postMessage: vi.fn(), onmessage: null as any };
    OverlordUI._channel = mockChannel;
    OverlordUI._setupBroadcastChannel();

    const fn = vi.fn();
    OverlordUI.subscribe('broadcast:theme_changed', fn);

    // Simulate incoming message
    mockChannel.onmessage({ data: { type: 'theme_changed', theme: 'light' } });

    expect(fn).toHaveBeenCalledWith({ type: 'theme_changed', theme: 'light' });

    OverlordUI._channel = original;
  });

  it('onmessage handler applies theme_changed to documentElement', () => {
    const original = OverlordUI._channel;
    const mockChannel = { postMessage: vi.fn(), onmessage: null as any };
    OverlordUI._channel = mockChannel;
    OverlordUI._setupBroadcastChannel();

    mockChannel.onmessage({ data: { type: 'theme_changed', theme: 'ocean' } });

    expect(document.documentElement.dataset.theme).toBe('ocean');

    OverlordUI._channel = original;
  });

  it('onmessage handler syncs state for popout windows', () => {
    const original = OverlordUI._channel;
    const originalPopout = OverlordUI._isPopout;
    const mockChannel = { postMessage: vi.fn(), onmessage: null as any };
    OverlordUI._channel = mockChannel;
    OverlordUI._isPopout = 'true'; // simulate popout window

    const store = new Store();
    OverlordUI.init(store);

    mockChannel.onmessage({
      data: { type: 'state_sync', key: 'ui.theme', value: 'light' },
    });

    expect(store.get('ui.theme')).toBe('light');

    OverlordUI._channel = original;
    OverlordUI._isPopout = originalPopout;
  });

  it('onmessage handler ignores messages without type', () => {
    const original = OverlordUI._channel;
    const mockChannel = { postMessage: vi.fn(), onmessage: null as any };
    OverlordUI._channel = mockChannel;
    OverlordUI._setupBroadcastChannel();

    const fn = vi.fn();
    OverlordUI.subscribe('broadcast:undefined', fn);

    // No type property
    mockChannel.onmessage({ data: {} });
    mockChannel.onmessage({ data: null });

    expect(fn).not.toHaveBeenCalled();

    OverlordUI._channel = original;
  });
});

// ─── Re-exported helpers ─────────────────────────────────────

describe('OverlordUI — re-exported helpers', () => {
  it('h is a function', () => {
    expect(typeof OverlordUI.h).toBe('function');
  });

  it('setContent is a function', () => {
    expect(typeof OverlordUI.setContent).toBe('function');
  });

  it('setTrustedContent is a function', () => {
    expect(typeof OverlordUI.setTrustedContent).toBe('function');
  });

  it('$ is a function', () => {
    expect(typeof OverlordUI.$).toBe('function');
  });

  it('$$ is a function', () => {
    expect(typeof OverlordUI.$$).toBe('function');
  });

  it('debounce is a function', () => {
    expect(typeof OverlordUI.debounce).toBe('function');
  });

  it('throttle is a function', () => {
    expect(typeof OverlordUI.throttle).toBe('function');
  });

  it('escapeHtml is a function', () => {
    expect(typeof OverlordUI.escapeHtml).toBe('function');
  });

  it('uid is a function', () => {
    expect(typeof OverlordUI.uid).toBe('function');
  });

  it('formatTime is a function', () => {
    expect(typeof OverlordUI.formatTime).toBe('function');
  });

  it('clamp is a function', () => {
    expect(typeof OverlordUI.clamp).toBe('function');
  });

  it('h creates DOM elements', () => {
    const el = OverlordUI.h('div', { class: 'test' }, 'hello');
    expect(el.tagName).toBe('DIV');
    expect(el.className).toBe('test');
    expect(el.textContent).toBe('hello');
  });
});
