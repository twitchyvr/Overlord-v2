/**
 * Overlord v2 — Activity Panel
 *
 * Real-time activity feed showing tool executions, phase transitions,
 * agent events, and system notifications.
 */

import { PanelComponent } from '../components/panel.js';
import { OverlordUI } from '../engine/engine.js';
import { h, formatTime } from '../engine/helpers.js';
import { DrillItem } from '../components/drill-item.js';
import { Tabs } from '../components/tabs.js';


const MAX_ITEMS = 100;

const ACTIVITY_ICONS = {
  'tool:executed':       '\u{1F527}',
  'phase:advanced':      '\u{1F6A7}',
  'room:agent:entered':  '\u{1F6AA}',
  'room:agent:exited':   '\u{1F6B6}',
  'raid:entry:added':    '\u26A0',
  'exit-doc:submitted':  '\u{1F4C4}',
  'scope-change':        '\u{1F504}',
  'phase-zero:complete': '\u{1F3C1}',
  'error':               '\u274C',
  'system':              '\u2139'
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
    this._items.push({
      ...data,
      ts: data.ts || new Date().toISOString()
    });
    if (this._items.length > MAX_ITEMS) {
      this._items = this._items.slice(-MAX_ITEMS);
    }

    const store = OverlordUI.getStore();
    if (store) store.set('activity.items', this._items);

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
        { id: 'all', label: 'All' },
        { id: 'tools', label: 'Tools' },
        { id: 'phases', label: 'Phases' },
        { id: 'agents', label: 'Agents' }
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
        meta: (d) => d.ts ? formatTime(d.ts) : '',
        detail: [
          { label: 'Event', key: 'event' },
          { label: 'Agent', key: 'agentId' },
          { label: 'Room', key: 'roomId' },
          { label: 'Tool', key: 'toolName' },
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
          return event.startsWith('phase:') || event.startsWith('phase-zero:') || event === 'exit-doc:submitted';
        case 'agents':
          return event.startsWith('room:agent:') || event.includes('agent');
        default:
          return true;
      }
    });
  }

  _formatSummary(item) {
    const event = item.event || item.type || '';

    if (event === 'tool:executed') {
      return `${item.toolName || 'Tool'} executed${item.agentId ? ` by ${item.agentId}` : ''}`;
    }
    if (event === 'phase:advanced') {
      return `Phase advanced to ${item.newPhase || item.phase || 'next'}`;
    }
    if (event === 'room:agent:entered') {
      return `${item.agentId || 'Agent'} entered room`;
    }
    if (event === 'room:agent:exited') {
      return `${item.agentId || 'Agent'} exited room`;
    }
    if (event === 'raid:entry:added') {
      return `RAID: ${item.title || item.description || 'New entry'}`;
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

    return item.message || item.description || event || 'Activity';
  }
}
