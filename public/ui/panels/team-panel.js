/**
 * Overlord v2 — Team Panel
 *
 * Shows the agent team roster organized by role, with current
 * room assignments and status. Different from AgentsPanel in that
 * it focuses on team organization rather than individual agent details.
 */

import { PanelComponent } from '../components/panel.js';
import { OverlordUI } from '../engine/engine.js';
import { h, formatTime } from '../engine/helpers.js';
import { DrillItem } from '../components/drill-item.js';


const ROLE_ICONS = {
  strategist:  '\u{1F3AF}',
  architect:   '\u{1F3D7}',
  developer:   '\u{1F4BB}',
  tester:      '\u{1F9EA}',
  reviewer:    '\u{1F50D}',
  deployer:    '\u{1F680}',
  analyst:     '\u{1F4CA}',
  lead:        '\u{1F451}',
  default:     '\u{1F916}'
};

export class TeamPanel extends PanelComponent {

  constructor(el) {
    super(el, {
      id: 'panel-team',
      label: 'Team',
      icon: '\u{1F465}',
      defaultVisible: false
    });
    this._agents = [];
    this._positions = {};
    this._rooms = [];
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
      this._positions = positions || {};
      this._renderContent();
    });

    this.subscribe(store, 'rooms.list', (rooms) => {
      this._rooms = rooms || [];
      this._renderContent();
    });

    this._renderContent();
  }

  _renderContent() {
    const body = this.$('.panel-body');
    if (!body) return;
    body.textContent = '';

    if (this._agents.length === 0) {
      body.appendChild(h('div', { class: 'panel-empty' }, 'No team members registered.'));
      return;
    }

    // Summary stats
    const activeCount = this._agents.filter(a => {
      const pos = this._positions[a.id];
      return pos && (pos.status === 'active' || pos.status === 'working');
    }).length;

    body.appendChild(h('div', { class: 'panel-summary' },
      h('span', null, `${this._agents.length} agents`),
      h('span', { class: 'team-active-count' }, ` \u2022 ${activeCount} active`)
    ));

    // Group agents by role
    const byRole = this._groupByRole();

    for (const [role, agents] of Object.entries(byRole)) {
      const roleIcon = this._getRoleIcon(role);

      const roleHeader = h('div', { class: 'team-role-header' },
        h('span', { class: 'team-role-icon' }, roleIcon),
        h('span', { class: 'team-role-label' }, this._formatRole(role)),
        h('span', { class: 'team-role-count' }, `(${agents.length})`)
      );
      body.appendChild(roleHeader);

      const list = h('div', { class: 'team-role-list' });

      for (const agent of agents) {
        const pos = this._positions[agent.id];
        const status = pos?.status || agent.status || 'idle';
        const roomName = this._getRoomName(pos?.roomId);

        const item = DrillItem.create('team-member', { ...agent, status, roomName }, {
          icon: (d) => {
            if (d.status === 'active' || d.status === 'working') return '\u{1F7E2}';
            if (d.status === 'paused') return '\u{1F7E1}';
            return '\u26AA';
          },
          summary: (d) => d.name || 'Agent',
          badge: (d) => d.roomName
            ? { text: d.roomName, color: 'var(--accent-cyan)' }
            : { text: 'idle', color: 'var(--text-muted)' },
          meta: () => '',
          detail: [
            { label: 'ID', key: 'id' },
            { label: 'Role', key: 'role' },
            { label: 'Status', key: 'status' },
            { label: 'Room', key: 'roomName' },
            { label: 'Capabilities', key: 'capabilities', format: 'json' }
          ]
        });

        list.appendChild(item);
      }

      body.appendChild(list);
    }
  }

  _groupByRole() {
    const groups = {};
    for (const agent of this._agents) {
      const role = (agent.role || 'unassigned').toLowerCase();
      if (!groups[role]) groups[role] = [];
      groups[role].push(agent);
    }
    return groups;
  }

  _formatRole(role) {
    return role.charAt(0).toUpperCase() + role.slice(1);
  }

  _getRoleIcon(role) {
    const key = role.toLowerCase();
    for (const [pattern, icon] of Object.entries(ROLE_ICONS)) {
      if (key.includes(pattern)) return icon;
    }
    return ROLE_ICONS.default;
  }

  _getRoomName(roomId) {
    if (!roomId) return null;
    const room = this._rooms.find(r => r.id === roomId);
    return room ? (room.name || room.type) : roomId;
  }
}
