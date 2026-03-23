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
import { EntityLink, resolveAgent, resolveAgentName, resolveRoom } from '../engine/entity-nav.js';


/* ── Constants ─────────────────────────────────────────────── */

const MAX_ITEMS = 200;

const ACTIVITY_ICONS = {
  'tool:executed':            '\u{1F527}',
  'phase:advanced':           '\u{1F6A7}',
  'phase:gate:created':       '\u{1F3C1}',
  'phase:gate:signed-off':    '\u{1F3C6}',
  'phase:conditions:resolved':'\u2705',
  'phase:room-provisioned':   '\u{1F3E0}',
  'room:agent:entered':       '\u{1F6AA}',
  'room:agent:exited':        '\u{1F6B6}',
  'room:updated':             '\u{1F3E2}',
  'room:deleted':             '\u{1F5D1}',
  'raid:entry:added':         '\u26A0',
  'exit-doc:submitted':       '\u{1F4C4}',
  'scope-change':             '\u{1F504}',
  'phase-zero:complete':      '\u{1F3C1}',
  'task:created':             '\u{1F4CB}',
  'task:updated':             '\u{1F4DD}',
  'task:assigned':            '\u{1F4CC}',
  'agent:status-changed':     '\u{1F504}',
  'agent:mentioned':          '\u{1F4AC}',
  'agent:profile-updated':    '\u{1F464}',
  'agent:profile-generated':  '\u{1F5BC}',
  'floor:created':            '\u{1F3D7}',
  'floor:updated':            '\u{1F3D7}',
  'floor:deleted':            '\u{1F5D1}',
  'table:created':            '\u{1FA91}',
  'table:updated':            '\u{1FA91}',
  'table:deleted':            '\u{1F5D1}',
  'table:work-divided':       '\u2702',
  'building:onboarded':       '\u{1F3E2}',
  'building:onboard-failed':  '\u274C',
  'building:created':         '\u{1F3D7}',
  'deploy:check':             '\u{1F680}',
  'citation:added':           '\u{1F4CE}',
  'escalation:stale-gate':    '\u23F0',
  'escalation:war-room':      '\u{1F6A8}',
  'escalation:failed':        '\u274C',
  'tool:executing':           '\u{2699}',
  'agent:activity':           '\u{1F916}',
  'agent:created':            '\u{1F464}',
  'ai:request':               '\u{1F4B0}',
  'error':                    '\u274C',
  'system':                   '\u2139'
};

/** Truncate tool input params to a short preview string. */
function _truncateParams(input) {
  if (!input || typeof input !== 'object') return '';
  const keys = Object.keys(input);
  if (keys.length === 0) return '';
  // Show first key=value pair, truncated
  const firstKey = keys[0];
  let firstVal = String(input[firstKey] || '');
  if (firstVal.length > 40) firstVal = firstVal.slice(0, 37) + '...';
  const extra = keys.length > 1 ? ` (+${keys.length - 1} more)` : '';
  return `${firstKey}=${firstVal}${extra}`;
}

/** Filter definitions — maps filter id to a predicate on event type. */
const FILTER_PREDICATES = {
  all: () => true,
  tools: (event) => event.startsWith('tool:') || event === 'tool:executed' || event === 'ai:request',
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
    event === 'room:agent:exited',
  building: (event) =>
    event.startsWith('building:') ||
    event.startsWith('floor:') ||
    event.startsWith('room:') ||
    event.startsWith('table:'),
  tasks: (event) =>
    event.startsWith('task:') ||
    event.startsWith('todo:')
};


/* ── ActivityView ──────────────────────────────────────────── */

/** localStorage key for activity filter persistence (#348) */
const ACTIVITY_STORAGE_KEY = 'overlord:view:activity:filters';

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

    /** @type {string} Active filter pill id. */
    this._pillFilter = 'all';

    /** @type {number} Number of items visible (for load-more). */
    this._visibleCount = 50;

    // Restore persisted filter (#348)
    this._restoreActivityFilters();
  }

  /** Restore filter state from localStorage (#348). */
  _restoreActivityFilters() {
    try {
      const saved = localStorage.getItem(ACTIVITY_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.pillFilter) this._pillFilter = parsed.pillFilter;
        if (parsed.filter) this._filter = parsed.filter;
      }
    } catch { /* ignore */ }
  }

  /** Save filter state to localStorage (#348). */
  _persistActivityFilters() {
    try {
      localStorage.setItem(ACTIVITY_STORAGE_KEY, JSON.stringify({
        pillFilter: this._pillFilter,
        filter: this._filter,
      }));
    } catch { /* ignore */ }
  }

  /* ── Lifecycle ─────────────────────────────────────────── */

  mount() {
    this._mounted = true;
    const store = OverlordUI.getStore();
    if (!store) return;

    // Seed from existing store data
    this._items = (store.get('activity.items') || []).slice(-MAX_ITEMS);
    if (this._items.length > 0) this._loading = false;

    // No building selected — nothing to load, clear loading state
    const buildingId = store.get('building.active');
    if (!buildingId) this._loading = false;

    // Fetch historical activities from DB on mount (#565)
    if (buildingId && window.overlordSocket?.fetchActivityHistory) {
      window.overlordSocket.fetchActivityHistory(buildingId);
    }

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

    // No building selected (#691)
    const store = OverlordUI.getStore();
    if (!store?.get('building.active')) {
      this.el.appendChild(h('div', { class: 'view-empty-state' },
        h('div', { class: 'view-empty-icon' }, '\u{1F4E1}'),
        h('h2', { class: 'view-empty-title' }, 'No Building Selected'),
        h('p', { class: 'view-empty-text' }, 'Select a project from the Dashboard to view activity.')
      ));
      return;
    }

    // ── Header row ──
    const header = h('div', { class: 'activity-view-header' },
      h('div', { class: 'activity-view-title-row' },
        h('h2', { class: 'activity-view-title' }, 'Activity Feed'),
        this._countEl = h('span', { class: 'activity-view-count' },
          `${this._items.length} event${this._items.length !== 1 ? 's' : ''}`)
      )
    );
    this.el.appendChild(header);

    // ── Filter pills ──
    const pillsContainer = h('div', { class: 'activity-filter-pills' });
    const pillDefs = [
      { id: 'all', label: 'All' },
      { id: 'rooms', label: 'Rooms' },
      { id: 'agents', label: 'Agents' },
      { id: 'tools', label: 'Tools' },
      { id: 'phases', label: 'Phase Gates' }
    ];
    for (const def of pillDefs) {
      const pill = h('button', {
        class: `activity-filter-pill ${this._pillFilter === def.id ? 'active' : ''}`,
        dataset: { filterId: def.id }
      }, def.label);
      pill.addEventListener('click', () => {
        this._pillFilter = def.id;
        this._filter = def.id === 'rooms' ? 'building' : def.id;
        this._visibleCount = 50;
        this._persistActivityFilters();
        this._render();
      });
      pillsContainer.appendChild(pill);
    }
    this.el.appendChild(pillsContainer);

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

    // Load more button
    const filtered = this._getFilteredItems();
    if (filtered.length > this._visibleCount) {
      const remaining = filtered.length - this._visibleCount;
      const loadMoreBtn = h('button', { class: 'activity-load-more' },
        `Load more (${remaining} remaining)`);
      loadMoreBtn.addEventListener('click', () => this._loadMore());
      this.el.appendChild(loadMoreBtn);
    }
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

    // Show "select a project" when no building is active
    const store = OverlordUI.getStore();
    const hasBuilding = store && store.get('building.active');

    if (filtered.length === 0) {
      if (!hasBuilding) {
        this._timelineEl.appendChild(
          h('div', { class: 'activity-view-empty' },
            h('div', { class: 'activity-view-empty-icon' }, '\u{1F3E2}'),
            h('p', { class: 'activity-view-empty-title' }, 'Select a project'),
            h('p', { class: 'activity-view-empty-desc' },
              'Choose a project from the Dashboard to view its activity.')
          )
        );
      } else if (this._loading) {
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
                : 'This is your project\'s live activity feed. Events appear in real-time as agents enter rooms, execute tools, submit documents, and advance phases. Start a conversation in Chat to see activity flow.')
          )
        );
      }
      return;
    }

    // Build timeline — newest first, limited by visibleCount
    const frag = document.createDocumentFragment();
    const reversed = [...filtered].reverse();
    const visible = reversed.slice(0, this._visibleCount);

    for (const item of visible) {
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

    // #1035 — Phase handoff cards render as rich cards, not plain text
    if (eventType === 'phase:advanced') {
      const from = item.from || 'previous';
      const to = item.to || item.newPhase || 'next';
      const handoffCard = h('div', {
        class: 'activity-view-handoff-card',
        style: 'padding:var(--sp-2); background:var(--surface-2); border-radius:var(--radius-sm); border-left:3px solid var(--accent-primary,#7B68EE); margin:var(--sp-1) 0;',
      },
        h('div', { style: 'font-weight:600; margin-bottom:var(--sp-1);' },
          `\u{1F4CB} Phase Handoff: ${from.charAt(0).toUpperCase() + from.slice(1)} \u2192 ${to.charAt(0).toUpperCase() + to.slice(1)}`
        ),
        h('div', { style: 'font-size:0.8rem; color:var(--text-muted);' },
          `Phase gate signed GO \u2014 work passed to ${to} phase agents`
        )
      );
      content.appendChild(handoffCard);
    } else {
      // Icon + summary row with event type icon
      const typeIcon = this._eventTypeIcon(eventType);
      const summaryRow = h('div', { class: 'activity-view-summary-row' },
        h('span', { class: 'activity-view-icon' }, icon),
        typeIcon ? h('span', { class: 'activity-event-icon' }, typeIcon) : null,
        h('span', { class: 'activity-view-summary' }, this._formatSummary(item))
      );

      // Status badge (if applicable)
      const badge = this._buildStatusBadge(item);
      if (badge) {
        summaryRow.appendChild(badge);
      }

      content.appendChild(summaryRow);
    }

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
        h('span', { class: 'activity-view-time' }, this._relativeTime(ts))
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

    // #929 — Tool executing (start) with agent name + tool params preview
    if (event === 'tool:executing') {
      const agentName = item.agentName ||
        (item.agentId ? resolveAgent(item.agentId)?.name : null) || 'Agent';
      const toolName = item.toolName || 'tool';
      const paramPreview = item.input ? _truncateParams(item.input) : '';
      return `${agentName} calling ${toolName}${paramPreview ? `: ${paramPreview}` : ''}`;
    }

    if (event === 'tool:executed') {
      const agentName = item.agentName ||
        (item.agentId ? resolveAgent(item.agentId)?.name : null) || 'Agent';
      const status = item.success === false ? ' (failed)' : '';
      return `${item.toolName || 'Tool'} completed${status} \u2014 ${agentName}`;
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

    if (event === 'task:assigned') {
      return `Task assigned: ${item.title || item.taskId || 'Task'}`;
    }

    if (event === 'agent:profile-updated') {
      const agentName = item.agentName ||
        (item.agentId ? resolveAgent(item.agentId)?.name : null) || 'Agent';
      return `${agentName} profile updated`;
    }

    if (event === 'agent:profile-generated') {
      const agentName = item.agentName ||
        (item.agentId ? resolveAgent(item.agentId)?.name : null) || 'Agent';
      return `${agentName} profile generated`;
    }

    if (event === 'floor:created') {
      return `Floor created: ${item.name || item.type || 'New floor'}`;
    }

    if (event === 'floor:updated' || event === 'floor:deleted') {
      const action = event === 'floor:updated' ? 'updated' : 'deleted';
      return `Floor ${action}: ${item.name || item.floorId || 'Floor'}`;
    }

    if (event === 'room:updated' || event === 'room:deleted') {
      const action = event === 'room:updated' ? 'updated' : 'deleted';
      return `Room ${action}: ${item.name || item.roomType || item.roomId || 'Room'}`;
    }

    if (event === 'table:created' || event === 'table:updated' || event === 'table:deleted') {
      const action = event.split(':')[1];
      return `Table ${action}: ${item.type || item.tableId || 'Table'}`;
    }

    if (event === 'table:work-divided') {
      return `Work divided at table: ${item.type || item.tableId || 'Table'}`;
    }

    if (event === 'building:onboarded') {
      return `Building onboarded: ${item.name || item.buildingId || 'Building'}`;
    }

    if (event === 'building:onboard-failed') {
      return `Building onboard failed: ${item.error || item.reason || 'Unknown error'}`;
    }

    if (event === 'building:created') {
      return `Building created: ${item.name || 'New building'}`;
    }

    if (event === 'citation:added') {
      return `Citation added: ${item.source || item.title || 'Reference'}`;
    }

    if (event === 'escalation:failed') {
      return `Escalation failed: ${item.error || item.reason || 'Unknown'}`;
    }

    if (event === 'deploy:check') {
      return `Deploy check: ${item.status || item.result || 'Running'}`;
    }

    if (event === 'phase:gate:created') {
      return `Phase gate created for ${item.phase || 'phase'}`;
    }

    if (event === 'phase:conditions:resolved') {
      return `Gate conditions resolved: ${item.gateId || 'gate'}`;
    }

    if (event === 'phase:room-provisioned') {
      return `Room provisioned for phase: ${item.phase || ''} (${item.roomType || ''})`;
    }

    if (event === 'escalation:stale-gate') {
      return `Stale gate escalation: ${item.phase || item.gateId || 'gate'}`;
    }

    if (event === 'escalation:war-room') {
      return `War room activated: ${item.reason || item.warRoomId || 'Escalation'}`;
    }

    // Handle underscore-format event types from agent_activity_log (#721)
    if (event === 'task_assign') {
      const agentName = resolveAgentName(item.agentId);
      return `Task assigned to ${agentName}`;
    }
    if (event === 'task_complete') {
      return `Task completed`;
    }
    if (event === 'session_start') {
      const agentName = resolveAgentName(item.agentId);
      return `${agentName} session started`;
    }
    if (event === 'session_end') {
      const agentName = resolveAgentName(item.agentId);
      return `${agentName} session ended`;
    }
    if (event === 'room_join') {
      const agentName = resolveAgentName(item.agentId);
      return `${agentName} joined room`;
    }
    if (event === 'room_leave') {
      const agentName = resolveAgentName(item.agentId);
      return `${agentName} left room`;
    }
    if (event === 'status_change') {
      const agentName = resolveAgentName(item.agentId);
      return `${agentName} status changed to ${item.status || item.newStatus || 'unknown'}`;
    }
    if (event === 'message_sent') {
      const agentName = resolveAgentName(item.agentId);
      return `${agentName} sent a message`;
    }
    if (event === 'todo:checked-out') {
      const agentName = resolveAgentName(item.agentId);
      return `${agentName} checked out a todo`;
    }
    if (event === 'todo:released') {
      return `Todo lock released`;
    }
    // #923 — Agent activity events (thinking, coding, reading, etc.)
    if (event === 'agent:activity') {
      const name = item.agentName || resolveAgentName(item.agentId);
      const activity = item.activity || 'working';
      const tool = item.toolName ? ` (${item.toolName})` : '';
      return `${name} is ${activity}${tool}`;
    }
    // #923 — Agent created
    if (event === 'agent:created') {
      const name = item.agent?.name || resolveAgentName(item.agentId);
      return `${name} joined the team`;
    }
    // #931 — AI API call with token usage
    if (event === 'ai:request') {
      const name = item.agentName || resolveAgentName(item.agentId);
      const inp = item.inputTokens || 0;
      const out = item.outputTokens || 0;
      const model = item.model || 'unknown';
      return `${name} \u2192 ${model}: ${inp.toLocaleString()} in / ${out.toLocaleString()} out tokens`;
    }

    // Default: use whatever text fields are available, format raw event name as readable
    const readableEvent = event ? event.replace(/[_:]/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : '';
    return item.message || item.description || item.summary || readableEvent || 'Activity';
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
          EntityLink.agent(agentId, resolveAgentName(agentId))
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
      ? `Activity: ${resolveAgentName(agentId)}`
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

  /* ── Load more ────────────────────────────────────────── */

  /** Increase visible count and re-render. */
  _loadMore() {
    this._visibleCount += 50;
    this._render();
  }

  /** Format a timestamp as a relative string. */
  _relativeTime(timestamp) {
    if (!timestamp) return '';
    const d = timestamp instanceof Date ? timestamp : new Date(timestamp);
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

  /** Map event type to a contextual emoji icon. */
  _eventTypeIcon(eventType) {
    if (!eventType) return null;
    if (eventType.startsWith('room:agent:entered')) return '\u{1F6AA}';
    if (eventType.startsWith('room:agent:exited')) return '\u{1F6AA}';
    if (eventType.startsWith('tool:')) return '\u{1F527}';
    if (eventType.startsWith('phase:')) return '\u{1F4CB}';
    if (eventType.startsWith('agent:')) return '\u{1F464}';
    if (eventType.startsWith('task:')) return '\u{1F4DD}';
    if (eventType.startsWith('building:')) return '\u{1F3D7}';
    return null;
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
    if (event.startsWith('building:')) return 'success';
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
