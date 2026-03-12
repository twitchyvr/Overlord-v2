/**
 * Overlord v2 — Activity Panel
 *
 * Real-time activity feed showing tool executions, phase transitions,
 * agent events, and system notifications.
 * Populated from socket events via store and engine bus.
 */

import { PanelComponent } from '../components/panel.js';
import { OverlordUI } from '../engine/engine.js';
import { h, formatTime } from '../engine/helpers.js';
import { DrillItem } from '../components/drill-item.js';
import { Tabs } from '../components/tabs.js';


const MAX_ITEMS = 100;

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
  'error':                    '\u274C',
  'system':                   '\u2139'
};

export class ActivityPanel extends PanelComponent {

  constructor(el) {
    super(el, {
      id: 'panel-activity',
      label: 'Activity',
      icon: '\u{1F4CB}',
      defaultVisible: true
    });
    this._items = [];
    this._filter = 'all';
  }

  mount() {
    super.mount();
    const store = OverlordUI.getStore();
    if (!store) return;

    this.subscribe(store, 'activity.items', (items) => {
      this._items = (items || []).slice(-MAX_ITEMS);
      this._renderContent();
    });

    // Also listen for live events via engine bus
    this._listeners.push(
      OverlordUI.subscribe('activity:new', (data) => {
        this._addItem(data);
      })
    );

    this._renderContent();
  }

  _addItem(data) {
    // Deduplicate: if the store already has this item (same event + timestamp), skip
    const lastItem = this._items[this._items.length - 1];
    if (lastItem && lastItem.event === data.event &&
        data.timestamp && lastItem.timestamp === data.timestamp) {
      return;
    }

    this._items.push({
      ...data,
      ts: data.ts || new Date().toISOString()
    });
    if (this._items.length > MAX_ITEMS) {
      this._items = this._items.slice(-MAX_ITEMS);
    }

    this._renderContent();
  }

  _renderContent() {
    const body = this.$('.panel-body');
    if (!body) return;
    body.textContent = '';

    // Filter tabs
    const tabContainer = h('div', null);
    const tabs = new Tabs(tabContainer, {
      items: [
        { id: 'all', label: 'All', badge: String(this._items.length) },
        { id: 'tools', label: 'Tools', badge: String(this._countByFilter('tools')) },
        { id: 'phases', label: 'Phases', badge: String(this._countByFilter('phases')) },
        { id: 'agents', label: 'Agents', badge: String(this._countByFilter('agents')) }
      ],
      activeId: this._filter,
      style: 'pills',
      onChange: (id) => {
        this._filter = id;
        this._renderContent();
      }
    });
    tabs.mount();
    body.appendChild(tabContainer);

    // Filtered items
    const filtered = this._getFilteredItems();

    if (filtered.length === 0) {
      body.appendChild(h('div', { class: 'panel-empty' }, 'No activity yet.'));
      return;
    }

    const list = h('div', { class: 'activity-list' });

    // Show newest first
    const reversed = [...filtered].reverse();
    for (const item of reversed) {
      const eventType = item.event || item.type || 'system';
      const icon = ACTIVITY_ICONS[eventType] || '\u2022';

      const drillItem = DrillItem.create('activity', item, {
        icon: () => icon,
        summary: (d) => this._formatSummary(d),
        badge: (d) => {
          if (d.status === 'error' || d.status === 'failed') return { text: 'ERR', color: 'var(--status-error)' };
          if (d.status === 'success' || d.status === 'ok') return { text: 'OK', color: 'var(--status-success)' };
          if (d.tier) return { text: `T${d.tier}`, color: 'var(--text-muted)' };
          return null;
        },
        meta: (d) => d.ts ? formatTime(d.ts) : d.timestamp ? formatTime(d.timestamp) : '',
        detail: [
          { label: 'Event', key: 'event' },
          { label: 'Agent', key: 'agentId' },
          { label: 'Room', key: 'roomId' },
          { label: 'Tool', key: 'toolName' },
          { label: 'Phase', key: 'phase' },
          { label: 'Duration', key: 'duration', format: 'duration' },
          { label: 'Details', key: 'details' }
        ]
      });

      list.appendChild(drillItem);
    }

    body.appendChild(list);
  }

  _getFilteredItems() {
    if (this._filter === 'all') return this._items;

    return this._items.filter(item => {
      const event = item.event || item.type || '';
      switch (this._filter) {
        case 'tools':
          return event.startsWith('tool:') || event === 'tool:executed';
        case 'phases':
          return event.startsWith('phase:') || event.startsWith('phase-zero:') ||
                 event === 'exit-doc:submitted' || event === 'scope-change' ||
                 event.includes('gate');
        case 'agents':
          return event.startsWith('room:agent:') || event.includes('agent') ||
                 event === 'room:agent:entered' || event === 'room:agent:exited';
        default:
          return true;
      }
    });
  }

  _countByFilter(filter) {
    const saved = this._filter;
    this._filter = filter;
    const count = this._getFilteredItems().length;
    this._filter = saved;
    return count;
  }

  _formatSummary(item) {
    const event = item.event || item.type || '';

    if (event === 'tool:executed') {
      return `${item.toolName || 'Tool'} executed${item.agentId ? ` by ${item.agentId}` : ''}`;
    }
    if (event === 'phase:advanced') {
      return `Phase advanced: ${item.from || ''} → ${item.to || item.newPhase || item.phase || 'next'}`;
    }
    if (event === 'phase:gate:signed-off') {
      return `Gate signed off: ${item.verdict || item.signoff_verdict || 'unknown'}${item.reviewer || item.signoff_reviewer ? ` by ${item.reviewer || item.signoff_reviewer}` : ''}`;
    }
    if (event === 'room:agent:entered') {
      return `${item.agentName || item.agentId || 'Agent'} entered ${item.roomType || 'room'}`;
    }
    if (event === 'room:agent:exited') {
      return `${item.agentName || item.agentId || 'Agent'} exited room`;
    }
    if (event === 'raid:entry:added') {
      return `RAID: ${item.title || item.summary || item.description || 'New entry'}`;
    }
    if (event === 'exit-doc:submitted') {
      return `Exit document submitted${item.roomId ? ` from ${item.roomId}` : ''}`;
    }
    if (event === 'phase-zero:complete') {
      return 'Phase Zero complete — building configured';
    }
    if (event === 'scope-change') {
      return `Scope change detected: ${item.description || 'unknown'}`;
    }
    if (event === 'task:created') {
      return `Task created: ${item.title || 'Untitled'}`;
    }
    if (event === 'task:updated') {
      return `Task updated: ${item.title || 'Untitled'} → ${item.status || ''}`;
    }

    return item.message || item.description || item.summary || event || 'Activity';
  }
}
