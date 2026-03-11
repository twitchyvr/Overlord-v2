/**
 * Overlord v2 — Engine Singleton
 *
 * Central registry managing all components and dispatching events.
 * Stripped of v1 legacy panel compat — v2 starts clean.
 */

import { h, setContent, setTrustedContent, $, $$, debounce, throttle, escapeHtml, uid, formatTime, clamp } from './helpers.js';

export const OverlordUI = {
  _components: new Map(),
  _eventBus: new Map(),
  _store: null,

  // BroadcastChannel for pop-out sync
  _channel: typeof BroadcastChannel !== 'undefined'
    ? new BroadcastChannel('overlord-v2-sync')
    : null,
  _isPopout: typeof location !== 'undefined'
    ? new URLSearchParams(location.search).get('popout')
    : null,

  /** Bootstrap the engine with the store */
  init(store) {
    this._store = store;
    this._setupBroadcastChannel();
    console.log('[OverlordUI] v2 Engine initialized');
    return this;
  },

  /** Get the store */
  getStore() {
    return this._store;
  },

  // ── Component Registry ──

  registerComponent(id, instance) {
    if (this._components.has(id)) {
      console.warn(`[OverlordUI] Component "${id}" already registered, replacing`);
      this._components.get(id).destroy();
    }
    this._components.set(id, instance);
    return instance;
  },

  mountComponent(id) {
    const comp = this._components.get(id);
    if (!comp) { console.warn(`[OverlordUI] Cannot mount unknown component "${id}"`); return; }
    if (comp._mounted) return comp;
    comp._mounted = true;
    try { comp.mount(); } catch (e) { console.error(`[OverlordUI] Error mounting "${id}":`, e); }
    return comp;
  },

  unmountComponent(id) {
    const comp = this._components.get(id);
    if (comp && comp._mounted) {
      try { comp.unmount(); } catch (e) { console.warn(`[OverlordUI] Error unmounting "${id}":`, e); }
    }
  },

  destroyComponent(id) {
    const comp = this._components.get(id);
    if (comp) {
      try { comp.destroy(); } catch (e) { console.warn(`[OverlordUI] Error destroying "${id}":`, e); }
      this._components.delete(id);
    }
  },

  getComponent(id) {
    return this._components.get(id);
  },

  mountAll() {
    this._components.forEach((comp, id) => {
      if (!comp._mounted) this.mountComponent(id);
    });
  },

  // ── Event Bus ──

  subscribe(event, fn) {
    if (!this._eventBus.has(event)) this._eventBus.set(event, new Set());
    this._eventBus.get(event).add(fn);
    return () => {
      const set = this._eventBus.get(event);
      if (set) { set.delete(fn); if (set.size === 0) this._eventBus.delete(event); }
    };
  },

  dispatch(event, data) {
    const listeners = this._eventBus.get(event);
    if (listeners) {
      listeners.forEach(fn => {
        try { fn(data); } catch (e) { console.warn(`[OverlordUI] listener error in "${event}":`, e); }
      });
    }
  },

  // ── Event Delegation ──

  on(root, eventType, selector, handler) {
    const listener = (e) => {
      const target = e.target.closest(selector);
      if (target && root.contains(target)) {
        handler(e, target);
      }
    };
    root.addEventListener(eventType, listener, { passive: eventType === 'scroll' });
    return () => root.removeEventListener(eventType, listener);
  },

  // ── BroadcastChannel ──

  broadcast(msg) {
    if (this._channel) {
      try { this._channel.postMessage(msg); }
      catch (e) { console.warn('[OverlordUI] BroadcastChannel error:', e); }
    }
  },

  _setupBroadcastChannel() {
    if (!this._channel) return;
    this._channel.onmessage = (e) => {
      const data = e.data;
      if (!data || !data.type) return;
      switch (data.type) {
        case 'theme_changed':
          document.documentElement.dataset.theme = data.theme;
          break;
        case 'state_sync':
          if (this._isPopout && this._store && data.key) {
            this._store.set(data.key, data.value, { silent: false, broadcast: false });
          }
          break;
      }
      this.dispatch('broadcast:' + data.type, data);
    };
  },

  // ── Re-exported helpers for convenience ──
  h, setContent, setTrustedContent, $, $$,
  debounce, throttle, escapeHtml, uid, formatTime, clamp,
};

export { h } from './helpers.js';
