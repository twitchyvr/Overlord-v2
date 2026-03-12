/**
 * Overlord v2 — Room View
 *
 * Detailed room visualization with table/chair layout,
 * agent assignments, tool scope, and exit document status.
 *
 * Opens as a modal when a room is selected from the building view.
 */

import { Component } from '../engine/component.js';
import { OverlordUI } from '../engine/engine.js';
import { h, formatTime, escapeHtml } from '../engine/helpers.js';
import { Modal } from '../components/modal.js';
import { Button } from '../components/button.js';
import { Toast } from '../components/toast.js';


/** Room type → icon mapping. */
const ROOM_ICONS = {
  'code-lab':        '\u{1F4BB}',
  'war-room':        '\u{1F6A8}',
  'architecture':    '\u{1F3D7}\uFE0F',
  'discovery':       '\u{1F50D}',
  'strategist':      '\u{1F9E0}',
  'data-exchange':   '\u{1F4E6}',
  'plugin-bay':      '\u{1F9E9}',
  'provider-hub':    '\u2699\uFE0F',
  'testing-lab':     '\u{1F9EA}',
  'review':          '\u{1F4DD}',
  'deploy':          '\u{1F680}',
};

/** Agent status → CSS class suffix. */
const STATUS_CLASSES = {
  idle:     'idle',
  working:  'working',
  blocked:  'blocked',
  waiting:  'waiting',
};


export class RoomView extends Component {

  constructor(el, opts = {}) {
    super(el, opts);
    this._roomData = null;
    this._agents = [];
    this._agentPositions = {};
    this._activityItems = [];
  }

  mount() {
    this._mounted = true;
    const store = OverlordUI.getStore();
    if (!store) return;

    // Listen for room selection
    this._listeners.push(
      OverlordUI.subscribe('building:room-selected', (data) => {
        this._loadRoom(data.roomId);
      })
    );

    // Subscribe to agent positions
    this.subscribe(store, 'building.agentPositions', (positions) => {
      this._agentPositions = positions || {};
      if (this._roomData) this._updateAgentDisplay();
    });

    // Subscribe to activity/log events
    this._listeners.push(
      OverlordUI.subscribe('room:activity', (data) => {
        if (this._roomData && data.roomId === this._roomData.id) {
          this._addActivity(data);
        }
      })
    );
  }

  async _loadRoom(roomId) {
    if (!window.overlordSocket) return;

    const result = await window.overlordSocket.fetchRoom(roomId);
    if (!result || !result.ok) {
      Toast.error(`Failed to load room: ${result?.error?.message || 'Unknown error'}`);
      return;
    }

    this._roomData = result.data;
    this._activityItems = [];
    this._openModal();
  }

  _openModal() {
    if (!this._roomData) return;
    const content = this._buildContent();

    Modal.open(`room-${this._roomData.id}`, {
      title: this._buildModalTitle(),
      content,
      size: 'lg',
      position: window.innerWidth < 768 ? 'fullscreen' : 'center',
      onClose: () => { this._roomData = null; this._activityItems = []; }
    });
  }

  /** Build a rich modal title with room icon and type. */
  _buildModalTitle() {
    const room = this._roomData;
    const icon = ROOM_ICONS[room.type] || '\u{1F3E0}';
    return `${icon} ${room.name || this._formatRoomType(room.type)}`;
  }

  /** Format room type slug as title (e.g., "code-lab" → "Code Lab"). */
  _formatRoomType(type) {
    if (!type) return 'Room';
    return type.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  }

  _buildContent() {
    const room = this._roomData;
    const container = h('div', { class: 'room-detail-view' });

    // ── Header section with status badge ──
    container.appendChild(this._buildHeaderSection(room));

    // ── Stats summary bar ──
    container.appendChild(this._buildStatsBar(room));

    // ── Agent roster ──
    container.appendChild(this._buildAgentRoster(room));

    // ── Table/Chair visualization ──
    container.appendChild(this._buildTableLayout(room));

    // ── Room info details ──
    container.appendChild(this._buildInfoSection(room));

    // ── Tools section ──
    if (room.tools && room.tools.length > 0) {
      container.appendChild(this._buildToolsSection(room));
    }

    // ── File scope section ──
    if (room.fileScope && room.fileScope.length > 0) {
      container.appendChild(this._buildFileScopeSection(room));
    }

    // ── Tables data section ──
    if (room.tables && Object.keys(room.tables).length > 0) {
      container.appendChild(this._buildTablesSection(room));
    }

    // ── Activity feed ──
    container.appendChild(this._buildActivityFeed());

    return container;
  }

  // ── Section Builders ─────────────────────────────────────────

  _buildHeaderSection(room) {
    const agentsInRoom = this._getAgentsInRoom(room.id);

    const header = h('div', { class: 'room-view-header' },
      h('div', { class: 'room-view-title' },
        h('span', { class: 'room-type-badge' }, this._formatRoomType(room.type)),
        room.name ? h('span', { class: 'room-name-label' }, room.name) : null
      ),
      h('div', { class: 'room-view-subtitle' },
        h('span', { class: `room-status-badge room-status-${agentsInRoom.length > 0 ? 'active' : 'empty'}` },
          agentsInRoom.length > 0 ? 'Active' : 'Empty'
        ),
        h('span', { class: 'room-occupancy-label' },
          `${agentsInRoom.length} agent${agentsInRoom.length !== 1 ? 's' : ''} present`
        )
      )
    );
    return header;
  }

  _buildStatsBar(room) {
    const agentsInRoom = this._getAgentsInRoom(room.id);
    const tableCount = room.tables ? Object.keys(room.tables).length : 0;
    const toolCount = room.tools ? room.tools.length : 0;

    const stats = h('div', { class: 'room-stats-bar' },
      this._statCard('\u{1F465}', 'Agents', String(agentsInRoom.length)),
      this._statCard('\u{1F4CB}', 'Tables', String(tableCount)),
      this._statCard('\u{1F6E0}\uFE0F', 'Tools', String(toolCount)),
      this._statCard(
        room.exitRequired && room.exitRequired.fields ? '\u{1F512}' : '\u{1F513}',
        'Exit Doc',
        room.exitRequired && room.exitRequired.fields ? 'Required' : 'None'
      )
    );
    return stats;
  }

  _statCard(icon, label, value) {
    return h('div', { class: 'room-stat-card' },
      h('span', { class: 'room-stat-icon' }, icon),
      h('div', { class: 'room-stat-text' },
        h('span', { class: 'room-stat-value' }, value),
        h('span', { class: 'room-stat-label' }, label)
      )
    );
  }

  _buildAgentRoster(room) {
    const agentsInRoom = this._getAgentsInRoom(room.id);
    const section = h('div', { class: 'room-agent-roster' },
      h('h4', null, 'Agent Roster')
    );

    if (agentsInRoom.length === 0) {
      section.appendChild(h('div', { class: 'room-roster-empty' },
        h('span', { class: 'room-roster-empty-icon' }, '\u{1F465}'),
        h('span', null, 'No agents in this room')
      ));
      return section;
    }

    const list = h('div', { class: 'room-roster-list' });
    for (const agent of agentsInRoom) {
      const status = agent.status || 'idle';
      const statusClass = STATUS_CLASSES[status] || 'idle';

      const row = h('div', { class: 'room-roster-row' },
        h('div', { class: `room-roster-dot room-roster-dot-${statusClass}` }),
        h('div', { class: 'room-roster-avatar' },
          (agent.name || '?')[0].toUpperCase()
        ),
        h('div', { class: 'room-roster-info' },
          h('span', { class: 'room-roster-name' }, agent.name || agent.agentId),
          h('span', { class: 'room-roster-role' }, agent.role || '')
        ),
        h('span', { class: `room-roster-status room-roster-status-${statusClass}` }, status)
      );
      list.appendChild(row);
    }
    section.appendChild(list);
    return section;
  }

  _buildInfoSection(room) {
    const infoSection = h('div', { class: 'room-info-section' },
      h('h4', null, 'Room Details')
    );

    infoSection.appendChild(h('div', { class: 'room-info-row' },
      h('span', { class: 'room-info-label' }, 'Type'),
      h('span', { class: 'room-info-value' }, this._formatRoomType(room.type))
    ));

    if (room.fileScope) {
      infoSection.appendChild(h('div', { class: 'room-info-row' },
        h('span', { class: 'room-info-label' }, 'File Access'),
        h('span', { class: 'room-info-value' },
          room.fileScope === 'full' ? 'Full access' :
          room.fileScope === 'read-only' ? 'Read-only' :
          room.fileScope === 'assigned' ? 'Assigned files only' :
          room.fileScope)
      ));
    }

    if (room.exitRequired && room.exitRequired.fields) {
      infoSection.appendChild(h('div', { class: 'room-info-row' },
        h('span', { class: 'room-info-label' }, 'Exit Required'),
        h('span', { class: 'room-info-value text-warning' },
          `Yes \u2014 ${room.exitRequired.fields.length} field${room.exitRequired.fields.length !== 1 ? 's' : ''}`)
      ));
    } else {
      infoSection.appendChild(h('div', { class: 'room-info-row' },
        h('span', { class: 'room-info-label' }, 'Exit Required'),
        h('span', { class: 'room-info-value' }, 'No')
      ));
    }

    if (room.escalation && Object.keys(room.escalation).length > 0) {
      for (const [trigger, target] of Object.entries(room.escalation)) {
        infoSection.appendChild(h('div', { class: 'room-info-row' },
          h('span', { class: 'room-info-label' }, `Escalation: ${trigger}`),
          h('span', { class: 'room-info-value' }, target)
        ));
      }
    }

    if (room.provider) {
      infoSection.appendChild(h('div', { class: 'room-info-row' },
        h('span', { class: 'room-info-label' }, 'AI Provider'),
        h('span', { class: 'room-info-value' }, room.provider)
      ));
    }

    return infoSection;
  }

  _buildToolsSection(room) {
    const section = h('div', { class: 'room-tools-section' },
      h('h4', null, `Available Tools (${room.tools.length})`)
    );
    const grid = h('div', { class: 'room-tool-grid' });
    for (const tool of room.tools) {
      grid.appendChild(h('span', { class: 'tool-tag' }, tool));
    }
    section.appendChild(grid);
    return section;
  }

  _buildFileScopeSection(room) {
    const patterns = Array.isArray(room.fileScope) ? room.fileScope :
      typeof room.fileScope === 'string' ? [room.fileScope] : [];
    if (patterns.length === 0) return h('span');

    const section = h('div', { class: 'room-file-section' },
      h('h4', null, 'File Scope')
    );
    const list = h('div', { class: 'room-file-list' });
    for (const pattern of patterns) {
      list.appendChild(h('div', { class: 'room-file-pattern' }, pattern));
    }
    section.appendChild(list);
    return section;
  }

  _buildTablesSection(room) {
    const tables = room.tables;
    const entries = typeof tables === 'object' && !Array.isArray(tables)
      ? Object.entries(tables) : [];

    const section = h('div', { class: 'room-tables-section' },
      h('h4', null, `Tables (${entries.length})`)
    );

    for (const [name, config] of entries) {
      const purpose = config && typeof config === 'object' ? (config.purpose || '') : '';
      const card = h('div', { class: 'room-table-card' },
        h('div', { class: 'room-table-name' }, name),
        purpose ? h('div', { class: 'room-table-purpose' }, purpose) : null
      );
      section.appendChild(card);
    }
    return section;
  }

  _buildTableLayout(room) {
    const layout = h('div', { class: 'room-table-layout' },
      h('h4', null, 'Room Layout')
    );

    const tableVis = h('div', { class: 'room-table-vis' });

    // Central table
    const tableEl = h('div', { class: 'room-table-center' },
      h('span', null, this._formatRoomType(room.type))
    );
    tableVis.appendChild(tableEl);

    // Chair positions (around the table)
    const chairRow = h('div', { class: 'room-chair-row' });
    const agentsInRoom = this._getAgentsInRoom(room.id);
    const maxChairs = Math.max(4, agentsInRoom.length + 2); // At least 4, plus empty chairs

    for (let i = 0; i < maxChairs; i++) {
      const agent = agentsInRoom[i];
      const chair = h('div', {
        class: `room-chair${agent ? ' room-chair-occupied' : ' room-chair-empty'}`,
        title: agent ? (agent.name || agent.agentId) : 'Empty seat'
      });

      if (agent) {
        const statusClass = STATUS_CLASSES[agent.status] || 'idle';
        chair.appendChild(h('div', {
          class: `room-chair-avatar room-chair-avatar-${statusClass}`
        }, (agent.name || '?')[0].toUpperCase()));
        chair.appendChild(h('div', { class: 'room-chair-name' }, agent.name || agent.agentId));
      }

      chairRow.appendChild(chair);
    }

    tableVis.appendChild(chairRow);
    layout.appendChild(tableVis);

    return layout;
  }

  _buildActivityFeed() {
    const section = h('div', { class: 'room-activity-section' },
      h('h4', null, 'Recent Activity')
    );

    const feed = h('div', { class: 'room-activity-feed', 'data-testid': 'room-activity-feed' });

    if (this._activityItems.length === 0) {
      feed.appendChild(h('div', { class: 'room-activity-empty' },
        'No activity recorded yet'
      ));
    } else {
      for (const item of this._activityItems.slice(-20)) {
        feed.appendChild(this._buildActivityItem(item));
      }
    }

    section.appendChild(feed);
    return section;
  }

  _buildActivityItem(item) {
    return h('div', { class: 'room-activity-item' },
      h('span', { class: 'room-activity-time' }, formatTime(item.timestamp)),
      h('span', { class: `room-activity-type room-activity-type-${item.type || 'info'}` },
        item.type || 'info'
      ),
      h('span', { class: 'room-activity-text' }, item.message || '')
    );
  }

  // ── Data Helpers ──────────────────────────────────────────────

  _getAgentsInRoom(roomId) {
    if (!this._agentPositions) return [];
    return Object.values(this._agentPositions).filter(a => a.roomId === roomId);
  }

  _addActivity(data) {
    this._activityItems.push({
      type: data.type || 'info',
      message: data.message || '',
      timestamp: data.timestamp || new Date().toISOString(),
    });
    // Keep only last 50
    if (this._activityItems.length > 50) {
      this._activityItems = this._activityItems.slice(-50);
    }
    // Re-render activity section if modal is open
    this._updateActivityFeed();
  }

  _updateAgentDisplay() {
    // Re-render the modal content if open
    const modalBody = Modal.getBody(`room-${this._roomData?.id}`);
    if (modalBody) {
      modalBody.textContent = '';
      modalBody.appendChild(this._buildContent());
    }
  }

  _updateActivityFeed() {
    const modalBody = Modal.getBody(`room-${this._roomData?.id}`);
    if (!modalBody) return;
    const feedEl = modalBody.querySelector('[data-testid="room-activity-feed"]');
    if (!feedEl) return;
    feedEl.textContent = '';
    if (this._activityItems.length === 0) {
      feedEl.appendChild(h('div', { class: 'room-activity-empty' }, 'No activity recorded yet'));
    } else {
      for (const item of this._activityItems.slice(-20)) {
        feedEl.appendChild(this._buildActivityItem(item));
      }
    }
  }
}
