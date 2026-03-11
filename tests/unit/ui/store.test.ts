// @vitest-environment jsdom
/**
 * Tests for public/ui/engine/store.js
 *
 * Covers: Store class (get/set/peek/update/delete/has, subscriptions,
 *         batch updates, persistence, snapshot/restore), createV2Store()
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const storePath = '../../../public/ui/engine/store.js';

let Store: any;
let createV2Store: any;

beforeEach(async () => {
  localStorage.clear();
  const mod = await import(storePath);
  Store = mod.Store;
  createV2Store = mod.createV2Store;
});

// ─── Core API ───────────────────────────────────────────────

describe('Store — core API', () => {
  it('set/get stores and retrieves values', () => {
    const store = new Store();
    store.set('foo', 42);
    expect(store.get('foo')).toBe(42);
  });

  it('supports dot-notation keys', () => {
    const store = new Store();
    store.set('a.b.c', 'deep');
    expect(store.get('a.b.c')).toBe('deep');
  });

  it('creates intermediate objects for dot-notation', () => {
    const store = new Store();
    store.set('x.y.z', 1);
    expect(store.get('x.y')).toEqual({ z: 1 });
  });

  it('get returns deep clone for objects', () => {
    const store = new Store();
    store.set('obj', { a: 1 });
    const val = store.get('obj');
    val.a = 999;
    expect(store.get('obj').a).toBe(1); // unmodified
  });

  it('get returns fallback when key is undefined', () => {
    const store = new Store();
    expect(store.get('missing', 'default')).toBe('default');
  });

  it('peek returns reference (no clone)', () => {
    const store = new Store();
    const obj = { a: 1 };
    store.set('ref', obj);
    const val = store.peek('ref');
    val.a = 999;
    expect(store.peek('ref').a).toBe(999); // mutated
  });

  it('peek returns fallback when key is undefined', () => {
    const store = new Store();
    expect(store.peek('missing', 'fb')).toBe('fb');
  });

  it('update applies a function to current value', () => {
    const store = new Store();
    store.set('count', 5);
    store.update('count', (val: number) => val + 1);
    expect(store.get('count')).toBe(6);
  });

  it('delete removes a key', () => {
    const store = new Store();
    store.set('a.b', 1);
    store.delete('a.b');
    expect(store.get('a.b')).toBeUndefined();
  });

  it('has returns true for existing keys', () => {
    const store = new Store();
    store.set('x', 1);
    expect(store.has('x')).toBe(true);
    expect(store.has('y')).toBe(false);
  });

  it('has returns false for undefined values', () => {
    const store = new Store();
    store.set('x', undefined);
    expect(store.has('x')).toBe(false);
  });
});

// ─── Subscriptions ──────────────────────────────────────────

describe('Store — subscriptions', () => {
  it('fires listener on set', () => {
    const store = new Store();
    const fn = vi.fn();
    store.subscribe('key', fn);
    store.set('key', 'val');
    expect(fn).toHaveBeenCalledWith('val', 'key');
  });

  it('unsubscribe stops notifications', () => {
    const store = new Store();
    const fn = vi.fn();
    const unsub = store.subscribe('key', fn);
    unsub();
    store.set('key', 'val');
    expect(fn).not.toHaveBeenCalled();
  });

  it('wildcard (*) listener fires on any key', () => {
    const store = new Store();
    const fn = vi.fn();
    store.subscribe('*', fn);
    store.set('foo', 1);
    store.set('bar', 2);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('parent key listener fires when child is set', () => {
    const store = new Store();
    const fn = vi.fn();
    store.subscribe('building', fn);
    store.set('building.data', { name: 'test' });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('silent: true suppresses notification', () => {
    const store = new Store();
    const fn = vi.fn();
    store.subscribe('key', fn);
    store.set('key', 'val', { silent: true });
    expect(fn).not.toHaveBeenCalled();
  });

  it('multiple subscribers on same key all fire', () => {
    const store = new Store();
    const fn1 = vi.fn();
    const fn2 = vi.fn();
    store.subscribe('k', fn1);
    store.subscribe('k', fn2);
    store.set('k', 'v');
    expect(fn1).toHaveBeenCalledTimes(1);
    expect(fn2).toHaveBeenCalledTimes(1);
  });
});

// ─── Batch ──────────────────────────────────────────────────

describe('Store — batch updates', () => {
  it('defers notifications until batch completes', () => {
    const store = new Store();
    const fn = vi.fn();
    store.subscribe('a', fn);

    store.batch(() => {
      store.set('a', 1);
      store.set('a', 2);
      store.set('a', 3);
    });

    // Should only fire once after batch, with final value
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(3, 'a');
  });

  it('notifies all changed keys after batch', () => {
    const store = new Store();
    const fnA = vi.fn();
    const fnB = vi.fn();
    store.subscribe('a', fnA);
    store.subscribe('b', fnB);

    store.batch(() => {
      store.set('a', 1);
      store.set('b', 2);
    });

    expect(fnA).toHaveBeenCalledTimes(1);
    expect(fnB).toHaveBeenCalledTimes(1);
  });
});

// ─── Persistence ────────────────────────────────────────────

describe('Store — persistence', () => {
  it('persist saves values to localStorage', () => {
    const store = new Store();
    store.persist('theme', 'test_theme', 'dark');
    store.set('theme', 'light');
    expect(localStorage.getItem('test_theme')).toBe('light');
  });

  it('persist hydrates from localStorage on registration', () => {
    localStorage.setItem('test_val', '"saved"');
    const store = new Store();
    store.persist('myKey', 'test_val', 'default');
    expect(store.get('myKey')).toBe('saved');
  });

  it('persist uses fallback when nothing saved', () => {
    const store = new Store();
    store.persist('fresh', 'test_fresh', 'fallback');
    expect(store.get('fresh')).toBe('fallback');
  });

  it('persist handles JSON objects', () => {
    const store = new Store();
    store.persist('obj', 'test_obj', {});
    store.set('obj', { a: 1, b: [2, 3] });
    expect(JSON.parse(localStorage.getItem('test_obj')!)).toEqual({ a: 1, b: [2, 3] });
  });
});

// ─── Snapshot / Restore ─────────────────────────────────────

describe('Store — snapshot/restore', () => {
  it('snapshot returns deep clone of data', () => {
    const store = new Store();
    store.set('a', 1);
    store.set('b.c', 2);
    const snap = store.snapshot();
    expect(snap.a).toBe(1);
    expect(snap.b.c).toBe(2);
    snap.a = 999;
    expect(store.get('a')).toBe(1); // unmodified
  });

  it('restore replaces all data and notifies listeners', () => {
    const store = new Store();
    const fn = vi.fn();
    store.subscribe('x', fn);
    store.restore({ x: 42, y: { z: 'hello' } });
    expect(store.get('x')).toBe(42);
    expect(store.get('y.z')).toBe('hello');
    expect(fn).toHaveBeenCalledWith(42, 'x');
  });
});

// ─── createV2Store() ────────────────────────────────────────

describe('createV2Store()', () => {
  it('returns a Store instance', () => {
    const store = createV2Store();
    expect(store).toBeInstanceOf(Store);
  });

  it('sets default theme to dark', () => {
    const store = createV2Store();
    expect(store.get('ui.theme')).toBe('dark');
  });

  it('initializes building.list as empty array', () => {
    const store = createV2Store();
    expect(store.get('building.list')).toEqual([]);
  });

  it('initializes ui.connected as false', () => {
    const store = createV2Store();
    expect(store.get('ui.connected')).toBe(false);
  });

  it('initializes building.activePhase as strategy', () => {
    const store = createV2Store();
    expect(store.get('building.activePhase')).toBe('strategy');
  });

  it('initializes all expected state keys', () => {
    const store = createV2Store();
    const expectedKeys = [
      'ui.theme', 'ui.connected', 'ui.processing', 'ui.streaming', 'ui.layoutMode',
      'building.list', 'building.active', 'building.data', 'building.activePhase',
      'building.agentPositions', 'rooms.list', 'rooms.active', 'agents.list',
      'agents.active', 'raid.entries', 'raid.searchResults', 'phase.gates',
      'phase.canAdvance', 'chat.messages', 'activity.items', 'system.health'
    ];
    for (const key of expectedKeys) {
      expect(store.has(key) || store.get(key) !== undefined || store.peek(key) !== undefined).toBe(true);
    }
  });
});
