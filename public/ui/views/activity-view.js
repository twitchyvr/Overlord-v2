/**
 * Overlord v2 — Activity View
 *
 * Full-page activity feed replacing the cramped activity-panel sidebar.
 * Displays a timeline of tool executions, phase transitions, agent events,
 * RAID entries, task updates, and system notifications.
 *
 * Data flows:
 *   - store `activity.items` — bulk array of historical events
 *   - engine event `activity:new` — live events pushed in real-time
 *
 * Activity event shape:
 *   { event, agentId, agentName, roomId, toolName, phase, status,
 *     tier, duration, details, ts, timestamp }
 *
 * Store keys:
 *   activity.items — array of activity event objects
 */

import { Component } from '../engine/component.js';
import { OverlordUI } from '../engine/engine.js';
import { h, formatTime } from '../engine/helpers.js';
import { Tabs } from '../components/tabs.js';
import { Drawer } from '../components/drawer.js';
import { EntityLink, resolveAgent, resolveRoom } from '../engine/entity-nav.js';


/* ── Constants ─────────────────────────────────────────────── */

const MAX_ITEMS = 200;

const ACTIVITY_ICONS = {
  'tool:executed':            '\u{1F527}',
  'phase:advanced':           '\u{1F6A7}',
  'phase:gate:signed-off':    '\u{1F3C6}',
  'room:agent:entered':       '\u{1F6AA}',
  'room:agent:exited':        '\u{1F6B6}',
  'raid:entry:added':         '\u26A0',
  'exit-doc:submitted':       '\u{1F4C4}',
  'scope-change':             '\u{1F504}',
  'phase-zero:complete':      '\u{1F3C1}',
  'task:created':             '\u{1F4CB}',
  'task:updated':             '\u{1F4DD}',
  'agent:status-changed':     '\u{1F504}',
  'agent:mentioned':          '\u{1F4AC}',
  'error':                    '\u274C',
  'system':                   '\u2139'
};

/** Filter definitions — maps filter id to a predicate on event type. */
const FILTER_PREDICATES = {
  all: () => true,
  tools: (event) => event.startsWith('tool:') || event === 'tool:executed',
  phases: (event) =>
    event.startsWith('phase:') ||
    event.startsWith('phase-zero:') ||
    event === 'exit-doc:submitted' ||
    event === 'scope-change' ||
    event.includes('gate'),
  agents: (event) =>
    event.startsWith('room:agent:') ||
    event.includes('agent') ||
    event === 'room:agent:entered' ||
    event === 'room:agent:exited'
};


/* ── ActivityView ──────────────────────────────────────────── */

export class ActivityView extends Component {

  /**
   * @param {HTMLElement} el — root container element
   */
  constructor(el) {
    super(el);

    /** @type {Array} Cached activity items. */
    this._items = [];

    /** @type {string} Active filter tab id. */
    this._filter = 'all';

    /** @type {Tabs|null} Filter tab component instance. */
    this._tabs = null;

    /** @type {HTMLElement|null} Timeline container for efficient updates. */
    this._timelineEl = null;

    /** @type {HTMLElement|null} Item count badge in the header. */
    this._countEl = null;

    /** @type {boolean} True until first data arrives from the store. */
    this._loading = true;
  }

  /* ── Lifecycle ─────────────────────────────────────────── */

  mount() {
    this._mounted = true;
    const store = OverlordUI.getStore();
    if (!store) return;

    // Seed from existing store data
    this._items = (store.get('activity.items') || []).slice(-MAX_ITEMS);
    if (this._items.length > 0) this._loading = false;

    // Subscribe to bulk store updates
    this.subscribe(store, 'activity.items', (items) => {
      this._items = (items || []).slice(-MAX_ITEMS);
      this._loading = false;
      this._render();
    });

    // Subscribe to live engine events for real-time items
    this._listeners.push(
      OverlordUI.subscribe('activity:new', (data) => {
        this._addItem(data);
      })
    );

    this._render();
  }

  destroy() {
    this._tabs = null;
    this._timelineEl = null;
    this._countEl = null;
    super.destroy();
  }

  /* ── Full render ───────────────────────────────────────── */

  _render() {
    this.el.textContent = '';
    this.el.className = 'activity-view';

    // ── Header row ──
    const header = h('div', { class: 'activity-view-header' },
      h('div', { class: 'activity-view-title-row' },
        h('h2', { class: 'activity-view-title' }, 'Activity Feed'),
        this._countEl = h('span', { class: 'activity-view-count' },
          `${this._items.length} event${this._items.length !== 1 ? 's' : ''}`)
      )
    );
    this.el.appendChild(header);

    // ── Filter tabs ──
    const tabWrapper = h('div', { class: 'activity-view-tabs' });
    const tabContainer = h('div');
    tabWrapper.appendChild(tabContainer);

    this._tabs = new Tabs(tabContainer, {
      items: [
        { id: 'all',    label: 'All',    badge: String(this._items.length) },
        { id: 'tools',  label: 'Tools',  badge: String(this._countByFilter('tools')) },
        { id: 'phases', label: 'Phases', badge: String(this._countByFilter('phases')) },
        { id: 'agents', label: 'Agents', badge: String(this._countByFilter('agents')) }
      ],
      activeId: this._filter,
      style: 'pills',
      onChange: (id) => {
        this._filter = id;
        this._renderTimeline(this._getFilteredItems());
        this._updateTabBadges();
      }
    });
    this._tabs.mount();
    this.el.appendChild(tabWrapper);

    // ── Timeline container ──
    this._timelineEl = h('div', { class: 'activity-view-timeline' });
    this.el.appendChild(this._timelineEl);

    // ── Delegated click handler for timeline items ──
    this.on('click', '.activity-view-item', (e, target) => {
      const agentId = target.dataset.agentId;
      const roomId = target.dataset.roomId;
      if (agentId || roomId) {
        this._openDetailDrawer(agentId, roomId, target);
      }
    });

    // Render the actual timeline items
    this._renderTimeline(this._getFilteredItems());
  }

  /* ── Timeline rendering ────────────────────────────────── */

  /**
   * Render the list of activity items into the timeline container.
   * @param {Array} filtered — pre-filtered activity items
   */
  _renderTimeline(filtered) {
    if (!this._timelineEl) return;
    this._timelineEl.textContent = '';

    // Update header count
    if (this._countEl) {
      const total = this._items.length;
      this._countEl.textContent = `${total} event${total !== 1 ? 's' : ''}`;
    }

    if (filtered.length === 0) {
      if (this._loading) {
        this._timelineEl.appendChild(
          h('div', { class: 'loading-state' },
            h('div', { class: 'loading-spinner' }),
            h('p', { class: 'loading-text' }, 'Loading activity...')
          )
        );
      } else {
        this._timelineEl.appendChild(
          h('div', { class: 'activity-view-empty' },
            h('div', { class: 'activity-view-empty-icon' }, '\u{1F4ED}'),
            h('p', { class: 'activity-view-empty-title' }, 'No activity yet'),
            h('p', { class: 'activity-view-empty-desc' },
              this._filter !== 'all'
                ? 'No events match the selected filter. Try switching to "All".'
                : 'Activity events will appear here as agents work.')
          )
        );
      }
      return;
    }

    // Build timeline — newest first
    const frag = document.createDocumentFragment();
    const reversed = [...filtered].reverse();

    for (const item of reversed) {
      frag.appendChild(this._buildTimelineItem(item));
    }

    this._timelineEl.appendChild(frag);
  }

  /**
   * Build a single timeline item DOM element.
   * @param {object} item — activity event object
   * @returns {HTMLElement}
   */
  _buildTimelineItem(item) {
    const eventType = item.event || item.type || 'system';
    const icon = ACTIVITY_ICONS[eventType] || '\u2022';
    const ts = item.ts || item.timestamp;
    const hasEntity = !!(item.agentId || item.roomId);

    // Root row
    const row = h('div', {
      class: `activity-view-item${hasEntity ? ' activity-view-item--clickable' : ''}`,
      dataset: {
        agentId: item.agentId || '',
        roomId: item.roomId || ''
      }
    });

    // ── Timeline dot + connector ──
    const dotColumn = h('div', { class: 'activity-view-dot-col' },
      h('div', { class: `activity-view-dot activity-view-dot--${this._dotColor(item)}` }),
      h('div', { class: 'activity-view-connector' })
    );
    row.appendChild(dotColumn);

    // ── Content column ──
    const content = h('div', { class: 'activity-view-content' });

    // Icon + summary row
    const summaryRow = h('div', { class: 'activity-view-summary-row' },
      h('span', { class: 'activity-view-icon' }, icon),
      h('span', { class: 'activity-view-summary' }, this._formatSummary(item))
    );

    // Status badge (if applicable)
    const badge = this._buildStatusBadge(item);
    if (badge) {
      summaryRow.appendChild(badge);
    }

    content.appendChild(summaryRow);

    // ── Meta row: entity links + timestamp ──
    const metaRow = h('div', { class: 'activity-view-meta' });

    if (item.agentId) {
      metaRow.appendChild(
        h('span', { class: 'activity-view-entity' },
          EntityLink.agent(item.agentId, item.agentName)
        )
      );
    }

    if (item.roomId) {
      const roomData = resolveRoom(item.roomId);
      metaRow.appendChild(
        h('span', { class: 'activity-view-entity' },
          EntityLink.room(item.roomId, roomData?.name)
        )
      );
    }

    if (ts) {
      metaRow.appendChild(
        h('span', { class: 'activity-view-time' }, formatTime(ts))
      );
    }

    content.appendChild(metaRow);

    // ── Optional details line ──
    if (item.details) {
      content.appendChild(
        h('div', { class: 'activity-view-details' }, item.details)
      );
    }

    // ── Duration indicator ──
    if (item.duration && item.duration > 0) {
      content.appendChild(
        h('div', { class: 'activity-view-duration' },
          h('span', { class: 'activity-view-duration-label' }, 'Duration:'),
          h('span', { class: 'activity-view-duration-value' }, this._formatDuration(item.duration))
        )
      );
    }

    row.appendChild(content);
    return row;
  }

  /* ── Summary formatting ────────────────────────────────── */

  /**
   * Generate a human-readable summary string for an activity event.
   * @param {object} item — activity event
   * @returns {string}
   */
  _formatSummary(item) {
    const event = item.event || item.type || '';

    if (event === 'tool:executed') {
      const agentName = item.agentName ||
        (item.agentId ? resolveAgent(item.agentId)?.name : null) || 'Agent';
      return `${item.toolName || 'Tool'} executed by ${agentName}`;
    }

    if (event === 'phase:advanced') {
      const from = item.from || '';
      const to = item.to || item.newPhase || item.phase || 'next';
      return `Phase advanced: ${from} \u2192 ${to}`;
    }

    if (event === 'phase:gate:signed-off') {
      const verdict = item.verdict || item.signoff_verdict || 'unknown';
      const reviewer = item.reviewer || item.signoff_reviewer;
      return `Gate signed off: ${verdict}${reviewer ? ` by ${reviewer}` : ''}`;
    }

    if (event === 'room:agent:entered') {
      const agentName = item.agentName ||
        (item.agentId ? resolveAgent(item.agentId)?.name : null) || 'Agent';
      const roomName = item.roomType
        ? (resolveRoom(item.roomId)?.name || item.roomType)
        : 'room';
      return `${agentName} entered ${roomName}`;
    }

    if (event === 'room:agent:exited') {
      const agentName = item.agentName ||
        (item.agentId ? resolveAgent(item.agentId)?.name : null) || 'Agent';
      return `${agentName} exited room`;
    }

    if (event === 'agent:status-changed') {
      const agentName = item.agentName ||
        (item.agentId ? resolveAgent(item.agentId)?.name : null) || 'Agent';
      return `${agentName} status changed to ${item.status || 'unknown'}`;
    }

    if (event === 'agent:mentioned') {
      const agentName = item.agentName ||
        (item.agentId ? resolveAgent(item.agentId)?.name : null) || 'Agent';
      return `${agentName} was mentioned`;
    }

    if (event === 'raid:entry:added') {
      return `RAID: ${item.title || item.summary || item.description || 'New entry'}`;
    }

    if (event === 'exit-doc:submitted') {
      return `Exit document submitted${item.roomId ? ` from ${item.roomId}` : ''}`;
    }

    if (event === 'phase-zero:complete') {
      return 'Phase Zero complete \u2014 building configured';
    }

    if (event === 'scope-change') {
      return `Scope change detected: ${item.description || 'unknown'}`;
    }

    if (event === 'task:created') {
      return `Task created: ${item.title || 'Untitled'}`;
    }

    if (event === 'task:updated') {
      return `Task updated: ${item.title || 'Untitled'} \u2192 ${item.status || ''}`;
    }

    // Default: use whatever text fields are available
    return item.message || item.description || item.summary || event || 'Activity';
  }

  /* ── Filtering ─────────────────────────────────────────── */

  /**
   * Return the current filter's subset of items.
   * @returns {Array}
   */
  _getFilteredItems() {
    const predicate = FILTER_PREDICATES[this._filter];
    if (!predicate || this._filter === 'all') return this._items;

    return this._items.filter(item => {
      const event = item.event || item.type || '';
      return predicate(event);
    });
  }

  /**
   * Count items that match a given filter id.
   * @param {string} filter — one of 'all', 'tools', 'phases', 'agents'
   * @returns {number}
   */
  _countByFilter(filter) {
    if (filter === 'all') return this._items.length;

    const predicate = FILTER_PREDICATES[filter];
    if (!predicate) return 0;

    return this._items.filter(item => {
      const event = item.event || item.type || '';
      return predicate(event);
    }).length;
  }

  /**
   * Update all tab badge counts without a full re-render.
   */
  _updateTabBadges() {
    if (!this._tabs) return;
    this._tabs.setBadge('all', String(this._items.length));
    this._tabs.setBadge('tools', String(this._countByFilter('tools')));
    this._tabs.setBadge('phases', String(this._countByFilter('phases')));
    this._tabs.setBadge('agents', String(this._countByFilter('agents')));
  }

  /* ── Live item ingestion ───────────────────────────────── */

  /**
   * Handle a live activity event from the engine bus.
   * Deduplicates by event+timestamp, enforces MAX_ITEMS cap,
   * and incrementally inserts into the timeline if possible.
   * @param {object} data — incoming activity event
   */
  _addItem(data) {
    if (!data) return;

    // Deduplicate: skip if the last item has the same event + timestamp
    const lastItem = this._items[this._items.length - 1];
    if (lastItem &&
        lastItem.event === data.event &&
        data.timestamp &&
        lastItem.timestamp === data.timestamp) {
      return;
    }

    const item = {
      ...data,
      ts: data.ts || new Date().toISOString()
    };

    this._items.push(item);

    // Enforce cap
    if (this._items.length > MAX_ITEMS) {
      this._items = this._items.slice(-MAX_ITEMS);
    }

    // Check if the new item passes the current filter
    const eventType = item.event || item.type || '';
    const predicate = FILTER_PREDICATES[this._filter];
    const passesFilter = !predicate || predicate(eventType);

    if (passesFilter && this._timelineEl) {
      // Remove empty state if present
      const emptyState = this._timelineEl.querySelector('.activity-view-empty');
      if (emptyState) emptyState.remove();

      // Prepend (newest first) the new item
      const newEl = this._buildTimelineItem(item);
      if (this._timelineEl.firstChild) {
        this._timelineEl.insertBefore(newEl, this._timelineEl.firstChild);
      } else {
        this._timelineEl.appendChild(newEl);
      }

      // Trim excess DOM nodes if over cap
      while (this._timelineEl.children.length > MAX_ITEMS) {
        this._timelineEl.removeChild(this._timelineEl.lastChild);
      }
    }

    // Update counts
    this._updateTabBadges();
    if (this._countEl) {
      const total = this._items.length;
      this._countEl.textContent = `${total} event${total !== 1 ? 's' : ''}`;
    }
  }

  /* ── Drawer detail ─────────────────────────────────────── */

  /**
   * Open the side drawer with entity detail when a timeline item is clicked.
   * @param {string} agentId
   * @param {string} roomId
   * @param {HTMLElement} targetEl — the clicked timeline item
   */
  _openDetailDrawer(agentId, roomId, targetEl) {
    // Build drawer content from the item's data attributes and child text
    const content = h('div', { class: 'activity-view-drawer-content' });

    // ── Agent section ──
    if (agentId) {
      const agent = resolveAgent(agentId);
      const agentSection = h('div', { class: 'activity-view-drawer-section' },
        h('h4', { class: 'activity-view-drawer-heading' }, 'Agent'),
        h('div', { class: 'activity-view-drawer-row' },
          h('span', { class: 'activity-view-drawer-label' }, 'Name:'),
          EntityLink.agent(agentId, agent?.name)
        )
      );
      if (agent?.role) {
        agentSection.appendChild(
          h('div', { class: 'activity-view-drawer-row' },
            h('span', { class: 'activity-view-drawer-label' }, 'Role:'),
            h('span', { class: 'badge' }, agent.role)
          )
        );
      }
      if (agent?.status) {
        agentSection.appendChild(
          h('div', { class: 'activity-view-drawer-row' },
            h('span', { class: 'activity-view-drawer-label' }, 'Status:'),
            h('span', { class: `badge agent-status-${agent.status}` }, agent.status)
          )
        );
      }
      content.appendChild(agentSection);

      // Action: navigate to full agent detail
      content.appendChild(
        h('div', { class: 'activity-view-drawer-actions' },
          this._buildDrawerAction('View Full Agent Detail', () => {
            Drawer.close();
            OverlordUI.dispatch('navigate:entity', { type: 'agent', id: agentId });
          })
        )
      );
    }

    // ── Room section ──
    if (roomId) {
      const room = resolveRoom(roomId);
      const roomSection = h('div', { class: 'activity-view-drawer-section' },
        h('h4', { class: 'activity-view-drawer-heading' }, 'Room'),
        h('div', { class: 'activity-view-drawer-row' },
          h('span', { class: 'activity-view-drawer-label' }, 'Name:'),
          EntityLink.room(roomId, room?.name)
        )
      );
      if (room?.type) {
        roomSection.appendChild(
          h('div', { class: 'activity-view-drawer-row' },
            h('span', { class: 'activity-view-drawer-label' }, 'Type:'),
            h('span', { class: 'badge' }, room.type)
          )
        );
      }
      content.appendChild(roomSection);

      // Action: navigate to full room detail
      content.appendChild(
        h('div', { class: 'activity-view-drawer-actions' },
          this._buildDrawerAction('View Room in Building', () => {
            Drawer.close();
            OverlordUI.dispatch('navigate:entity', { type: 'room', id: roomId });
          })
        )
      );
    }

    // ── Recent activity for this entity ──
    const relatedItems = this._items.filter(i =>
      (agentId && (i.agentId === agentId)) ||
      (roomId && (i.roomId === roomId))
    ).slice(-10).reverse();

    if (relatedItems.length > 0) {
      const recentSection = h('div', { class: 'activity-view-drawer-section' },
        h('h4', { class: 'activity-view-drawer-heading' },
          `Recent Activity (${relatedItems.length})`)
      );
      const recentList = h('div', { class: 'activity-view-drawer-recent' });

      for (const ri of relatedItems) {
        const eventType = ri.event || ri.type || 'system';
        const icon = ACTIVITY_ICONS[eventType] || '\u2022';
        const ts = ri.ts || ri.timestamp;

        recentList.appendChild(
          h('div', { class: 'activity-view-drawer-recent-item' },
            h('span', { class: 'activity-view-drawer-recent-icon' }, icon),
            h('span', { class: 'activity-view-drawer-recent-text' },
              this._formatSummary(ri)),
            ts ? h('span', { class: 'activity-view-drawer-recent-time' },
              formatTime(ts)) : null
          )
        );
      }

      recentSection.appendChild(recentList);
      content.appendChild(recentSection);
    }

    // Determine a title for the drawer
    const drawerTitle = agentId
      ? `Activity: ${resolveAgent(agentId)?.name || agentId}`
      : roomId
        ? `Activity: ${resolveRoom(roomId)?.name || roomId}`
        : 'Activity Detail';

    Drawer.open('activity-detail', {
      title: drawerTitle,
      width: '420px',
      content
    });
  }

  /**
   * Build a clickable action button for the drawer.
   * @param {string} label
   * @param {Function} onClick
   * @returns {HTMLElement}
   */
  _buildDrawerAction(label, onClick) {
    const btn = h('button', {
      class: 'activity-view-drawer-btn',
      type: 'button'
    }, label);
    btn.addEventListener('click', onClick);
    return btn;
  }

  /* ── Visual helpers ────────────────────────────────────── */

  /**
   * Determine the dot color class based on event status/type.
   * @param {object} item — activity event
   * @returns {string} — CSS modifier (success, error, warning, info, neutral)
   */
  _dotColor(item) {
    if (item.status === 'error' || item.status === 'failed') return 'error';
    if (item.status === 'success' || item.status === 'ok') return 'success';

    const event = item.event || item.type || '';
    if (event === 'error') return 'error';
    if (event.startsWith('phase:gate:')) return 'warning';
    if (event.startsWith('phase:') || event.startsWith('phase-zero:')) return 'info';
    if (event.startsWith('room:agent:')) return 'info';
    if (event === 'raid:entry:added') return 'warning';
    if (event.startsWith('tool:')) return 'neutral';
    if (event.startsWith('task:')) return 'info';
    return 'neutral';
  }

  /**
   * Build a status badge element for an activity item.
   * @param {object} item
   * @returns {HTMLElement|null}
   */
  _buildStatusBadge(item) {
    if (item.status === 'error' || item.status === 'failed') {
      return h('span', { class: 'activity-view-badge activity-view-badge--error' }, 'ERR');
    }
    if (item.status === 'success' || item.status === 'ok') {
      return h('span', { class: 'activity-view-badge activity-view-badge--success' }, 'OK');
    }
    if (item.tier) {
      return h('span', { class: 'activity-view-badge activity-view-badge--tier' }, `T${item.tier}`);
    }
    return null;
  }

  /**
   * Format a millisecond duration into a human-readable string.
   * @param {number} ms — duration in milliseconds
   * @returns {string}
   */
  _formatDuration(ms) {
    if (ms < 1000) return `${ms}ms`;
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const remainSec = seconds % 60;
    return `${minutes}m ${remainSec}s`;
  }

}
