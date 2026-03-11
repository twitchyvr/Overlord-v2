/**
 * Overlord v2 — Building View
 *
 * Tycoon-game cross-section visualization of the building.
 * Renders floors bottom-up (column-reverse) with agent dots,
 * room indicators, and phase-colored floor bars.
 *
 * Lives in #building-panel (left sidebar).
 */

import { Component } from '../engine/component.js';
import { OverlordUI } from '../engine/engine.js';
import { h, formatTime } from '../engine/helpers.js';


export class BuildingView extends Component {

  /**
   * @param {HTMLElement} el — the #building-panel element
   */
  constructor(el, opts = {}) {
    super(el, opts);
    this._buildingData = null;
    this._floors = [];
    this._expandedFloor = null;
    this._agentPositions = {};
  }

  mount() {
    this._mounted = true;
    const store = OverlordUI.getStore();
    if (!store) return;

    // Subscribe to building data updates
    this.subscribe(store, 'building.data', (data) => {
      this._buildingData = data;
      this.render();
    });

    // Subscribe to agent position updates
    this.subscribe(store, 'building.agentPositions', (positions) => {
      this._agentPositions = positions || {};
      this._updateAgentDots();
    });

    // Subscribe to floor data
    this.subscribe(store, 'building.floors', (floors) => {
      this._floors = floors || [];
      this.render();
    });

    this.render();
  }

  render() {
    this.el.textContent = '';

    if (!this._buildingData) {
      this.el.appendChild(this._renderEmptyState());
      return;
    }

    // Building header
    const header = h('div', { class: 'building-header' },
      h('div', { class: 'building-name' }, this._buildingData.name || 'Building'),
      h('div', { class: 'building-phase' },
        h('span', { class: `phase-badge phase-${this._buildingData.active_phase || 'strategy'}` },
          this._buildingData.active_phase || 'strategy'
        )
      )
    );
    this.el.appendChild(header);

    // Building cross-section (column-reverse for bottom-up)
    const crossSection = h('div', { class: 'building-cross-section' });

    // Sort floors by ordinal (highest = top of building)
    const sortedFloors = [...this._floors].sort((a, b) => (b.ordinal || 0) - (a.ordinal || 0));

    for (const floor of sortedFloors) {
      const floorBar = this._renderFloorBar(floor);
      crossSection.appendChild(floorBar);
    }

    // Ground/foundation
    const foundation = h('div', { class: 'building-foundation' },
      h('span', null, 'Foundation')
    );
    crossSection.appendChild(foundation);

    this.el.appendChild(crossSection);

    // Building stats
    const stats = h('div', { class: 'building-stats' },
      h('div', { class: 'building-stat' },
        h('span', { class: 'building-stat-value' }, String(this._floors.length)),
        h('span', { class: 'building-stat-label' }, 'Floors')
      ),
      h('div', { class: 'building-stat' },
        h('span', { class: 'building-stat-value' }, String(this._countTotalRooms())),
        h('span', { class: 'building-stat-label' }, 'Rooms')
      ),
      h('div', { class: 'building-stat' },
        h('span', { class: 'building-stat-value' }, String(this._countActiveAgents())),
        h('span', { class: 'building-stat-label' }, 'Active')
      )
    );
    this.el.appendChild(stats);
  }

  /** Render a single floor bar. */
  _renderFloorBar(floor) {
    const isExpanded = this._expandedFloor === floor.id;
    const floorType = floor.type || 'default';
    const roomCount = (floor.rooms || []).length;
    const agentsOnFloor = this._getAgentsOnFloor(floor.id);

    const bar = h('div', {
      class: `floor-bar${isExpanded ? ' expanded' : ''}`,
      'data-floor-id': floor.id,
      'data-type': floorType
    });

    // Floor info row
    const infoRow = h('div', { class: 'floor-bar-info' },
      h('span', { class: 'floor-bar-name' }, floor.name || `Floor ${floor.ordinal || '?'}`),
      h('span', { class: 'floor-bar-type' }, floorType),
      h('span', { class: 'floor-bar-rooms' }, `${roomCount} rm`)
    );
    bar.appendChild(infoRow);

    // Agent dots
    if (agentsOnFloor.length > 0) {
      const dotsRow = h('div', { class: 'floor-agent-dots' });
      for (const agent of agentsOnFloor.slice(0, 8)) {
        const dot = h('div', {
          class: `agent-dot agent-dot-${agent.status || 'idle'}`,
          title: agent.name || agent.agentId
        });
        dotsRow.appendChild(dot);
      }
      if (agentsOnFloor.length > 8) {
        dotsRow.appendChild(h('span', { class: 'agent-dot-overflow' }, `+${agentsOnFloor.length - 8}`));
      }
      bar.appendChild(dotsRow);
    }

    // Expand icon
    const expandIcon = h('span', { class: 'floor-expand-icon' }, isExpanded ? '\u25BC' : '\u25B6');
    bar.appendChild(expandIcon);

    // Click to expand/collapse
    bar.addEventListener('click', () => {
      this._expandedFloor = isExpanded ? null : floor.id;
      OverlordUI.dispatch('building:floor-selected', { floorId: floor.id, expanded: !isExpanded });
      this.render();
    });

    // Expanded content: room grid
    if (isExpanded && floor.rooms && floor.rooms.length > 0) {
      const roomGrid = h('div', { class: 'floor-room-grid' });
      for (const room of floor.rooms) {
        const agentsInRoom = this._getAgentsInRoom(room.id);
        const roomCard = h('div', {
          class: `room-card${agentsInRoom.length > 0 ? ' room-occupied' : ''}`,
          'data-room-id': room.id
        },
          h('div', { class: 'room-card-header' },
            h('span', { class: `status-dot status-${agentsInRoom.length > 0 ? 'active' : 'idle'}` }),
            h('span', { class: 'room-card-name' }, room.name || room.type)
          ),
          h('div', { class: 'room-card-meta' },
            h('span', null, room.type)
          )
        );

        if (agentsInRoom.length > 0) {
          const avatarRow = h('div', { class: 'room-agent-avatars' });
          for (const agent of agentsInRoom) {
            avatarRow.appendChild(h('div', {
              class: 'agent-avatar',
              title: agent.name || agent.agentId
            }, (agent.name || '?')[0].toUpperCase()));
          }
          roomCard.appendChild(avatarRow);
        }

        roomCard.addEventListener('click', (e) => {
          e.stopPropagation();
          OverlordUI.dispatch('building:room-selected', { roomId: room.id, floorId: floor.id });
        });
        roomGrid.appendChild(roomCard);
      }
      bar.appendChild(roomGrid);
    }

    return bar;
  }

  _renderEmptyState() {
    return h('div', { class: 'empty-state' },
      h('div', { class: 'empty-state-icon' }, '\u{1F3D7}'),
      h('p', { class: 'empty-state-title' }, 'No Building Selected'),
      h('p', { class: 'empty-state-text' }, 'Create a project or select a building to see its structure.')
    );
  }

  _getAgentsOnFloor(floorId) {
    if (!this._agentPositions) return [];
    return Object.values(this._agentPositions).filter(a => a.floorId === floorId);
  }

  _getAgentsInRoom(roomId) {
    if (!this._agentPositions) return [];
    return Object.values(this._agentPositions).filter(a => a.roomId === roomId);
  }

  _countTotalRooms() {
    return this._floors.reduce((sum, f) => sum + (f.rooms || []).length, 0);
  }

  _countActiveAgents() {
    if (!this._agentPositions) return 0;
    return Object.values(this._agentPositions).filter(a => a.status === 'active' || a.status === 'working').length;
  }

  _updateAgentDots() {
    // Optimized partial update — just re-render agent dots without full render
    this.el.querySelectorAll('.floor-bar').forEach(bar => {
      const floorId = bar.dataset.floorId;
      const dotsRow = bar.querySelector('.floor-agent-dots');
      const agents = this._getAgentsOnFloor(floorId);

      if (dotsRow) {
        dotsRow.textContent = '';
        for (const agent of agents.slice(0, 8)) {
          dotsRow.appendChild(h('div', {
            class: `agent-dot agent-dot-${agent.status || 'idle'}`,
            title: agent.name || agent.agentId
          }));
        }
        if (agents.length > 8) {
          dotsRow.appendChild(h('span', { class: 'agent-dot-overflow' }, `+${agents.length - 8}`));
        }
      } else if (agents.length > 0) {
        // Agent dots didn't exist yet — need full re-render
        this.render();
      }
    });
  }
}
