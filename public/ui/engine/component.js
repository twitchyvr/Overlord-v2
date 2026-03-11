/**
 * Overlord v2 — Component Base Class
 *
 * Every UI piece extends this. Provides lifecycle hooks,
 * store subscription management, and scoped DOM helpers.
 */

import { $, $$ } from './helpers.js';

export class Component {
  /**
   * @param {HTMLElement} el   — root DOM element
   * @param {object}      opts — component-specific config
   */
  constructor(el, opts = {}) {
    this.el = el;
    this.opts = opts;
    this._subs = [];      // store unsubscribe functions
    this._listeners = []; // delegated event teardown fns
    this._mounted = false;
  }

  /* ── Lifecycle hooks (override in subclasses) ── */

  /** Called when the component enters the DOM. Set up subscriptions here. */
  mount() {
    this._mounted = true;
  }

  /** Called when relevant state changes. */
  render() {}

  /** Called when the component is temporarily removed. */
  unmount() {
    this._mounted = false;
  }

  /** Full teardown — removes subscriptions, listeners, DOM. */
  destroy() {
    this.unmount();
    this._subs.forEach(fn => fn());
    this._subs = [];
    this._listeners.forEach(fn => fn());
    this._listeners = [];
    if (this.el && this.el.parentNode) {
      this.el.parentNode.removeChild(this.el);
    }
  }

  /* ── Helpers ── */

  /** Subscribe to a store key. Auto-unsubscribed on destroy(). */
  subscribe(store, key, fn) {
    const unsub = store.subscribe(key, fn);
    this._subs.push(unsub);
    return unsub;
  }

  /** Scoped querySelector within this component's root element. */
  $(selector) { return $(selector, this.el); }

  /** Scoped querySelectorAll within this component's root element. */
  $$(selector) { return $$(selector, this.el); }

  /** Delegate an event within this component's root. Auto-cleaned on destroy(). */
  on(eventType, selector, handler) {
    const listener = (e) => {
      const target = e.target.closest(selector);
      if (target && this.el.contains(target)) {
        handler(e, target);
      }
    };
    this.el.addEventListener(eventType, listener, { passive: eventType === 'scroll' });
    this._listeners.push(() => this.el.removeEventListener(eventType, listener));
    return () => this.el.removeEventListener(eventType, listener);
  }
}
