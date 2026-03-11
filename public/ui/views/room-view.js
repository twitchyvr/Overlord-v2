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


export class RoomView extends Component {

  constructor(el, opts = {}) {
    super(el, opts);
    this._roomData = null;
    this._agents = [];
    this._agentPositions = {};
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
  }

  async _loadRoom(roomId) {
    if (!window.overlordSocket) return;

    const result = await window.overlordSocket.fetchRoom(roomId);
    if (!result || !result.ok) {
      console.warn('[RoomView] Failed to load room:', roomId, result?.error);
      return;
    }

    this._roomData = result.data;
    this._openModal();
  }

  _openModal() {
    if (!this._roomData) return;
    const content = this._buildContent();

    Modal.open(`room-${this._roomData.id}`, {
      title: this._roomData.type ? `${this._roomData.type} Room` : 'Room Details',
      content,
      size: 'lg',
      position: window.innerWidth < 768 ? 'fullscreen' : 'center',
      onClose: () => { this._roomData = null; }
    });
  }

  _buildContent() {
    const room = this._roomData;
    const container = h('div', { class: 'room-detail-view' });

    // Room info header
    const infoSection = h('div', { class: 'room-info-section' },
      h('div', { class: 'room-info-row' },
        h('span', { class: 'room-info-label' }, 'Type'),
        h('span', { class: 'room-info-value' }, room.type || 'Unknown')
      ),
      h('div', { class: 'room-info-row' },
        h('span', { class: 'room-info-label' }, 'Exit Required'),
        h('span', { class: `room-info-value ${room.exitRequired ? 'text-warning' : ''}` },
          room.exitRequired ? 'Yes — exit document needed' : 'No')
      )
    );
    if (room.escalation) {
      infoSection.appendChild(h('div', { class: 'room-info-row' },
        h('span', { class: 'room-info-label' }, 'Escalation'),
        h('span', { class: 'room-info-value' }, room.escalation)
      ));
    }
    container.appendChild(infoSection);

    // Table/Chair visualization
    container.appendChild(this._buildTableLayout(room));

    // Tools section
    if (room.tools && room.tools.length > 0) {
      const toolSection = h('div', { class: 'room-tools-section' },
        h('h4', null, 'Available Tools')
      );
      const toolGrid = h('div', { class: 'room-tool-grid' });
      for (const tool of room.tools) {
        toolGrid.appendChild(h('span', { class: 'tool-tag' }, tool));
      }
      toolSection.appendChild(toolGrid);
      container.appendChild(toolSection);
    }

    // File scope section
    if (room.fileScope && room.fileScope.length > 0) {
      const fileSection = h('div', { class: 'room-file-section' },
        h('h4', null, 'File Scope')
      );
      const fileList = h('div', { class: 'room-file-list' });
      for (const pattern of room.fileScope) {
        fileList.appendChild(h('div', { class: 'room-file-pattern' }, pattern));
      }
      fileSection.appendChild(fileList);
      container.appendChild(fileSection);
    }

    // Tables data section
    if (room.tables && room.tables.length > 0) {
      const tableSection = h('div', { class: 'room-tables-section' },
        h('h4', null, 'Tables')
      );
      for (const table of room.tables) {
        const tableCard = h('div', { class: 'room-table-card' },
          h('div', { class: 'room-table-name' }, table.name || 'Table'),
          h('div', { class: 'room-table-purpose' }, table.purpose || '')
        );
        tableSection.appendChild(tableCard);
      }
      container.appendChild(tableSection);
    }

    return container;
  }

  _buildTableLayout(room) {
    const layout = h('div', { class: 'room-table-layout' },
      h('h4', null, 'Room Layout')
    );

    const tableVis = h('div', { class: 'room-table-vis' });

    // Central table
    const tableEl = h('div', { class: 'room-table-center' },
      h('span', null, room.type || 'Table')
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
        chair.appendChild(h('div', { class: 'room-chair-avatar' },
          (agent.name || '?')[0].toUpperCase()
        ));
        chair.appendChild(h('div', { class: 'room-chair-name' }, agent.name || agent.agentId));
      }

      chairRow.appendChild(chair);
    }

    tableVis.appendChild(chairRow);
    layout.appendChild(tableVis);

    return layout;
  }

  _getAgentsInRoom(roomId) {
    if (!this._agentPositions) return [];
    return Object.values(this._agentPositions).filter(a => a.roomId === roomId);
  }

  _updateAgentDisplay() {
    // Re-render the modal content if open
    const modalBody = Modal.getBody(`room-${this._roomData?.id}`);
    if (modalBody) {
      modalBody.textContent = '';
      modalBody.appendChild(this._buildContent());
    }
  }
}
