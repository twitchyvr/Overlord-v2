/**
 * Overlord v2 — Agents Panel
 *
 * Shows registered agents with their status, current room,
 * role, and capabilities. Supports filtering by status.
 */

import { PanelComponent } from '../components/panel.js';
import { OverlordUI } from '../engine/engine.js';
import { h, formatTime } from '../engine/helpers.js';
import { DrillItem } from '../components/drill-item.js';
import { Tabs } from '../components/tabs.js';


export class AgentsPanel extends PanelComponent {

  constructor(el) {
    super(el, {
      id: 'panel-agents',
      label: 'Agents',
      icon: '\u{1F916}',
      defaultVisible: true
    });
    this._agents = [];
    this._agentPositions = {};
    this._filter = 'all'; // 'all' | 'active' | 'idle'
  }

  mount() {
    super.mount();
    const store = OverlordUI.getStore();
    if (!store) return;

    this.subscribe(store, 'agents.list', (agents) => {
      this._agents = agents || [];
      this._renderContent();
    });

    this.subscribe(store, 'building.agentPositions', (positions) => {
      this._agentPositions = positions || {};
      this._renderContent();
    });

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
        { id: 'all', label: 'All', badge: String(this._agents.length) },
        { id: 'active', label: 'Active', badge: String(this._getAgentsByStatus('active').length) },
        { id: 'idle', label: 'Idle', badge: String(this._getAgentsByStatus('idle').length) }
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

    // Agent count summary
    body.appendChild(h('div', { class: 'agents-panel-summary' },
      h('span', null, `${this._agents.length} registered agents`)
    ));

    // Agent list
    const filtered = this._filter === 'all' ? this._agents : this._getAgentsByStatus(this._filter);

    if (filtered.length === 0) {
      body.appendChild(h('div', { class: 'panel-empty' },
        this._filter === 'all' ? 'No agents registered.' : `No ${this._filter} agents.`
      ));
      return;
    }

    const list = h('div', { class: 'agents-list' });

    for (const agent of filtered) {
      const position = this._agentPositions[agent.id];
      const status = position?.status || agent.status || 'idle';
      const currentRoom = position?.roomId || null;

      const item = DrillItem.create('agent', { ...agent, status, currentRoom }, {
        icon: (d) => {
          if (d.status === 'active' || d.status === 'working') return '\u{1F7E2}';
          if (d.status === 'paused') return '\u{1F7E1}';
          return '\u26AA';
        },
        summary: (d) => d.name || 'Agent',
        badge: (d) => ({
          text: d.role || 'agent',
          color: 'var(--text-muted)'
        }),
        meta: (d) => d.currentRoom ? `in room` : '',
        detail: [
          { label: 'Role', key: 'role' },
          { label: 'Status', key: 'status' },
          { label: 'Current Room', key: 'currentRoom' },
          { label: 'Capabilities', key: 'capabilities', format: 'json' },
          { label: 'Room Access', key: 'room_access', format: 'json' }
        ]
      });

      list.appendChild(item);
    }

    body.appendChild(list);
  }

  _getAgentsByStatus(status) {
    return this._agents.filter(a => {
      const pos = this._agentPositions[a.id];
      const agentStatus = pos?.status || a.status || 'idle';
      if (status === 'active') return agentStatus === 'active' || agentStatus === 'working';
      if (status === 'idle') return agentStatus === 'idle' || !agentStatus;
      return true;
    });
  }
}
