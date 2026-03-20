/**
 * Overlord v2 — Security Events View (#880)
 *
 * Real-time feed of security hook events (blocked, warned, allowed).
 * Shows events from the Lua security hook system (#873) with filtering,
 * color coding, and stats summary.
 *
 * Data flows:
 *   - store `security.events` — array of security event objects
 *   - store `security.stats` — aggregate {total, blocked, warned, allowed}
 *   - engine event `security:event-logged` — live events pushed in real-time
 *   - socket `security:events` — fetch historical events
 *   - socket `security:stats` — fetch aggregate stats
 */

import { Component } from '../engine/component.js';
import { OverlordUI } from '../engine/engine.js';
import { h, formatTime } from '../engine/helpers.js';

/* ── Constants ─────────────────────────────────────────────── */

const MAX_EVENTS = 200;

const ACTION_CONFIG = {
  block:  { icon: '\u{1F6D1}', label: 'Blocked', cssClass: 'security-action--block',  color: 'var(--accent-red, #ef4444)' },
  warn:   { icon: '\u26A0\uFE0F', label: 'Warning', cssClass: 'security-action--warn',   color: 'var(--accent-amber, #f59e0b)' },
  allow:  { icon: '\u2705',   label: 'Allowed', cssClass: 'security-action--allow',  color: 'var(--accent-green, #22c55e)' },
};

const FILTER_ALL = 'all';

/* ── SecurityView ──────────────────────────────────────────── */

export class SecurityView extends Component {

  constructor(el) {
    super(el);

    /** @type {Array} Security events list. */
    this._events = [];

    /** @type {object} Aggregate stats. */
    this._stats = { total: 0, blocked: 0, warned: 0, allowed: 0 };

    /** @type {string} Active filter: 'all' | 'block' | 'warn' | 'allow'. */
    this._filter = FILTER_ALL;

    /** @type {HTMLElement|null} Event list container. */
    this._listEl = null;

    /** @type {HTMLElement|null} Stats bar container. */
    this._statsEl = null;

    /** @type {HTMLElement|null} Count badge. */
    this._countEl = null;

    /** @type {number} Visible items cap for load-more. */
    this._visibleCount = 50;

    /** @type {boolean} Loading state. */
    this._loading = true;
  }

  /* ── Lifecycle ─────────────────────────────────────────── */

  mount() {
    this._mounted = true;
    const store = OverlordUI.getStore();
    if (!store) return;

    // Seed from store
    this._events = (store.get('security.events') || []).slice(0, MAX_EVENTS);
    const storedStats = store.get('security.stats');
    if (storedStats) this._stats = storedStats;
    if (this._events.length > 0 || storedStats) this._loading = false;

    // Subscribe to store updates
    this.subscribe(store, 'security.events', (events) => {
      this._events = (events || []).slice(0, MAX_EVENTS);
      this._loading = false;
      this._render();
    });

    this.subscribe(store, 'security.stats', (stats) => {
      if (stats) {
        this._stats = stats;
        this._updateStatsBar();
      }
    });

    // Live events via engine bus
    this._listeners.push(
      OverlordUI.subscribe('security:event-logged', (data) => {
        this._addEvent(data);
      })
    );

    // Fetch from server — if no socket available, clear loading state
    if (window.overlordSocket?.fetchSecurityStats) {
      window.overlordSocket.fetchSecurityStats();
    }
    if (window.overlordSocket?.fetchSecurityEvents) {
      window.overlordSocket.fetchSecurityEvents({ limit: 100 });
    }
    if (!window.overlordSocket?.fetchSecurityStats) {
      this._loading = false;
    }

    this._render();
  }

  destroy() {
    this._listEl = null;
    this._statsEl = null;
    this._countEl = null;
    super.destroy();
  }

  /* ── Full render ───────────────────────────────────────── */

  _render() {
    this.el.textContent = '';
    this.el.className = 'security-view';

    // #918 — No building selected guard
    const store = OverlordUI.getStore();
    if (!store?.get('building.active')) {
      this.el.appendChild(h('div', { class: 'view-empty-state' },
        h('div', { class: 'view-empty-icon' }, '\uD83D\uDEE1'),
        h('h2', { class: 'view-empty-title' }, 'No Building Selected'),
        h('p', { class: 'view-empty-text' }, 'Select a project from the Dashboard to view security events.')
      ));
      return;
    }

    // ── Header ──
    const header = h('div', { class: 'security-view-header' },
      h('div', { class: 'security-view-title-row' },
        h('h2', { class: 'security-view-title' }, 'Security Events'),
        this._countEl = h('span', { class: 'security-view-count' },
          this._formatCount())
      )
    );
    this.el.appendChild(header);

    // ── Stats summary bar ──
    this._statsEl = h('div', { class: 'security-stats-bar' });
    this._buildStatsBar();
    this.el.appendChild(this._statsEl);

    // ── Filter pills ──
    const pillsContainer = h('div', { class: 'security-filter-pills' });
    const pillDefs = [
      { id: 'all',   label: 'All' },
      { id: 'block', label: 'Blocked' },
      { id: 'warn',  label: 'Warnings' },
      { id: 'allow', label: 'Allowed' },
    ];
    for (const def of pillDefs) {
      const pill = h('button', {
        class: `security-filter-pill ${this._filter === def.id ? 'active' : ''}`,
        dataset: { filterId: def.id },
      }, def.label);
      pill.addEventListener('click', () => {
        this._filter = def.id;
        this._visibleCount = 50;
        this._render();
      });
      pillsContainer.appendChild(pill);
    }
    this.el.appendChild(pillsContainer);

    // ── Event list ──
    this._listEl = h('div', { class: 'security-event-list' });
    this.el.appendChild(this._listEl);
    this._renderEventList();

    // ── Load more ──
    const filtered = this._getFiltered();
    if (filtered.length > this._visibleCount) {
      const remaining = filtered.length - this._visibleCount;
      const btn = h('button', { class: 'security-load-more' },
        `Load more (${remaining} remaining)`);
      btn.addEventListener('click', () => {
        this._visibleCount += 50;
        this._render();
      });
      this.el.appendChild(btn);
    }
  }

  /* ── Stats bar ─────────────────────────────────────────── */

  _buildStatsBar() {
    if (!this._statsEl) return;
    this._statsEl.textContent = '';

    const stats = [
      { label: 'Total',   value: this._stats.total,   color: 'var(--text-secondary)' },
      { label: 'Blocked', value: this._stats.blocked,  color: ACTION_CONFIG.block.color },
      { label: 'Warned',  value: this._stats.warned,   color: ACTION_CONFIG.warn.color },
      { label: 'Allowed', value: this._stats.allowed,  color: ACTION_CONFIG.allow.color },
    ];

    for (const s of stats) {
      this._statsEl.appendChild(
        h('div', { class: 'security-stat-card' },
          h('div', { class: 'security-stat-value', style: `color: ${s.color}` }, String(s.value)),
          h('div', { class: 'security-stat-label' }, s.label)
        )
      );
    }
  }

  _updateStatsBar() {
    this._buildStatsBar();
    if (this._countEl) {
      this._countEl.textContent = this._formatCount();
    }
  }

  /* ── Event list rendering ──────────────────────────────── */

  _renderEventList() {
    if (!this._listEl) return;
    this._listEl.textContent = '';

    const filtered = this._getFiltered();

    if (filtered.length === 0) {
      if (this._loading) {
        this._listEl.appendChild(
          h('div', { class: 'loading-state' },
            h('div', { class: 'loading-spinner' }),
            h('p', { class: 'loading-text' }, 'Loading security events...')
          )
        );
      } else {
        this._listEl.appendChild(
          h('div', { class: 'security-empty' },
            h('div', { class: 'security-empty-icon' }, '\u{1F6E1}\uFE0F'),
            h('h3', { class: 'security-empty-title' }, 'No Security Events'),
            h('p', { class: 'security-empty-text' },
              this._filter !== FILTER_ALL
                ? `No ${this._filter} events recorded. Try switching to "All".`
                : 'Security hooks are active but no events have been recorded yet. Events will appear here when Lua security plugins block, warn, or allow tool executions.')
          )
        );
      }
      return;
    }

    // Newest first
    const visible = filtered.slice(0, this._visibleCount);
    const frag = document.createDocumentFragment();
    for (const evt of visible) {
      frag.appendChild(this._buildEventRow(evt));
    }
    this._listEl.appendChild(frag);
  }

  _buildEventRow(evt) {
    const action = evt.action || 'allow';
    const cfg = ACTION_CONFIG[action] || ACTION_CONFIG.allow;
    const ts = evt.timestamp || evt.ts;

    const row = h('div', { class: `security-event-row ${cfg.cssClass}` });

    // Action badge
    row.appendChild(
      h('div', { class: 'security-event-action' },
        h('span', { class: 'security-event-action-icon' }, cfg.icon),
        h('span', { class: 'security-event-action-label' }, cfg.label)
      )
    );

    // Content
    const content = h('div', { class: 'security-event-content' });

    // Tool name + message
    const summaryParts = [];
    if (evt.toolName) summaryParts.push(evt.toolName);
    if (evt.message) summaryParts.push(evt.message);
    const summary = summaryParts.length > 0
      ? summaryParts.join(' — ')
      : `${action} event`;

    content.appendChild(
      h('div', { class: 'security-event-summary' }, summary)
    );

    // Meta: agent, plugin, time
    const meta = h('div', { class: 'security-event-meta' });
    if (evt.agentId) {
      meta.appendChild(h('span', { class: 'security-event-meta-item' }, `Agent: ${evt.agentId}`));
    }
    if (evt.pluginId) {
      meta.appendChild(h('span', { class: 'security-event-meta-item' }, `Plugin: ${evt.pluginId}`));
    }
    if (ts) {
      meta.appendChild(h('span', { class: 'security-event-time' }, this._relativeTime(ts)));
    }
    content.appendChild(meta);

    // Suggestion (for blocked events)
    if (evt.suggestion) {
      content.appendChild(
        h('div', { class: 'security-event-suggestion' },
          h('span', { class: 'security-event-suggestion-label' }, 'Suggestion: '),
          evt.suggestion
        )
      );
    }

    row.appendChild(content);
    return row;
  }

  /* ── Live event ingestion ──────────────────────────────── */

  _addEvent(data) {
    if (!data) return;

    // Deduplicate by timestamp
    if (this._events.length > 0 && this._events[0].timestamp === data.timestamp) return;

    // Prepend (newest first)
    this._events.unshift(data);
    if (this._events.length > MAX_EVENTS) {
      this._events = this._events.slice(0, MAX_EVENTS);
    }

    // Update stats locally
    const action = data.action || 'allow';
    this._stats.total++;
    if (action === 'block') this._stats.blocked++;
    if (action === 'warn') this._stats.warned++;
    if (action === 'allow') this._stats.allowed++;

    this._updateStatsBar();

    // Check filter and prepend to list
    if (this._filter === FILTER_ALL || this._filter === action) {
      if (this._listEl) {
        // Remove empty state if present
        const empty = this._listEl.querySelector('.security-empty');
        if (empty) empty.remove();
        const loading = this._listEl.querySelector('.loading-state');
        if (loading) loading.remove();

        const newRow = this._buildEventRow(data);
        if (this._listEl.firstChild) {
          this._listEl.insertBefore(newRow, this._listEl.firstChild);
        } else {
          this._listEl.appendChild(newRow);
        }

        // Trim excess
        while (this._listEl.children.length > this._visibleCount) {
          this._listEl.removeChild(this._listEl.lastChild);
        }
      }
    }
  }

  /* ── Filtering ─────────────────────────────────────────── */

  _getFiltered() {
    if (this._filter === FILTER_ALL) return this._events;
    return this._events.filter(e => e.action === this._filter);
  }

  /* ── Helpers ───────────────────────────────────────────── */

  _formatCount() {
    const total = this._stats.total;
    return `${total} event${total !== 1 ? 's' : ''}`;
  }

  _relativeTime(timestamp) {
    if (!timestamp) return '';
    const d = typeof timestamp === 'number' ? new Date(timestamp) : new Date(timestamp);
    if (isNaN(d.getTime())) return '';
    const now = Date.now();
    const diffSec = Math.floor((now - d.getTime()) / 1000);
    if (diffSec < 60) return 'Just now';
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin} min ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr} hour${diffHr > 1 ? 's' : ''} ago`;
    const diffDay = Math.floor(diffHr / 24);
    if (diffDay < 7) return `${diffDay} day${diffDay > 1 ? 's' : ''} ago`;
    return formatTime(timestamp);
  }
}
