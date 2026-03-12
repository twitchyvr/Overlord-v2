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
import { Modal } from '../components/modal.js';
import { Toast } from '../components/toast.js';

/** Room type metadata for the creation modal. */
const ROOM_TYPE_INFO = {
  'strategist':         { icon: '\u{1F9E0}', label: 'Strategist',         desc: 'High-level planning and project strategy. Defines goals, phases, and resource allocation.' },
  'building-architect': { icon: '\u{1F3D7}\uFE0F', label: 'Building Architect', desc: 'Designs the building blueprint — floors, rooms, and agent assignments.' },
  'discovery':          { icon: '\u{1F50D}', label: 'Discovery',          desc: 'Research and requirements gathering. Agents analyze the problem space.' },
  'architecture':       { icon: '\u{1F4D0}', label: 'Architecture',       desc: 'System design and technical architecture. Produces design documents.' },
  'code-lab':           { icon: '\u{1F4BB}', label: 'Code Lab',           desc: 'Active development room. Agents write, refactor, and generate code.' },
  'testing-lab':        { icon: '\u{1F9EA}', label: 'Testing Lab',        desc: 'Test execution and QA. Agents run tests, generate test cases, and validate.' },
  'review':             { icon: '\u{1F4DD}', label: 'Review',             desc: 'Code review and quality gates. Agents review PRs and verify standards.' },
  'deploy':             { icon: '\u{1F680}', label: 'Deploy',             desc: 'Deployment and release management. Agents manage CI/CD and releases.' },
  'war-room':           { icon: '\u{1F6A8}', label: 'War Room',           desc: 'Incident response and escalation. Created when critical issues arise.' },
  'data-exchange':      { icon: '\u{1F4E6}', label: 'Data Exchange',      desc: 'Cross-room data sharing and artifact transfer between phases.' },
  'provider-hub':       { icon: '\u2699\uFE0F', label: 'Provider Hub',     desc: 'AI provider management and configuration.' },
  'plugin-bay':         { icon: '\u{1F9E9}', label: 'Plugin Bay',         desc: 'Plugin and extension management. Lua scripts and custom tools.' },
};

/** Which room types are recommended per floor type. */
const FLOOR_ROOM_SUGGESTIONS = {
  strategy:      ['strategist', 'building-architect'],
  collaboration: ['discovery', 'architecture'],
  execution:     ['code-lab', 'testing-lab'],
  governance:    ['review', 'deploy'],
  operations:    ['war-room'],
  integration:   ['data-exchange', 'provider-hub', 'plugin-bay'],
  lobby:         [],
};


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

    // Expanded content: room grid + add button
    if (isExpanded) {
      const expandedContent = h('div', { class: 'floor-expanded-content' });
      expandedContent.addEventListener('click', (e) => e.stopPropagation());

      if (floor.rooms && floor.rooms.length > 0) {
        const roomGrid = h('div', { class: 'floor-room-grid' });
        for (const room of floor.rooms) {
          roomGrid.appendChild(this._renderRoomCard(room, floor.id));
        }
        expandedContent.appendChild(roomGrid);
      } else {
        // Empty floor guidance
        expandedContent.appendChild(h('div', { class: 'floor-empty-guidance' },
          h('span', { class: 'floor-empty-icon' }, '\u{1F4AD}'),
          h('p', null, `This floor has no rooms yet. Add a room to start working in the ${floorType} phase.`)
        ));
      }

      // "Add Room" button
      const addRoomBtn = h('button', { class: 'btn btn-primary btn-sm floor-add-room-btn' }, '+ Add Room');
      addRoomBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._openAddRoomModal(floor);
      });
      expandedContent.appendChild(addRoomBtn);

      bar.appendChild(expandedContent);
    }

    return bar;
  }

  /** Render a single room card within an expanded floor. */
  _renderRoomCard(room, floorId) {
    const agentsInRoom = this._getAgentsInRoom(room.id);
    const roomStatus = this._getRoomStatus(agentsInRoom);

    const roomCard = h('div', {
      class: `room-card${agentsInRoom.length > 0 ? ' room-occupied' : ''}`,
      'data-room-id': room.id
    });

    // Header: status badge + name
    const header = h('div', { class: 'room-card-header' },
      h('span', { class: `room-status-badge room-status-${roomStatus}` }, roomStatus),
      h('span', { class: 'room-card-name' }, room.name || this._formatRoomType(room.type))
    );
    roomCard.appendChild(header);

    // Meta row: room type + agent count
    const meta = h('div', { class: 'room-card-meta' },
      h('span', { class: 'room-card-type-tag' }, room.type),
      h('span', { class: 'room-card-agent-count' },
        `${agentsInRoom.length} agent${agentsInRoom.length !== 1 ? 's' : ''}`
      )
    );
    roomCard.appendChild(meta);

    // Last activity timestamp (if room has lastActivity)
    if (room.lastActivity) {
      roomCard.appendChild(h('div', { class: 'room-card-activity' },
        h('span', { class: 'room-card-activity-label' }, 'Last:'),
        h('span', { class: 'room-card-activity-time' }, formatTime(room.lastActivity))
      ));
    }

    // Agent avatars
    if (agentsInRoom.length > 0) {
      const avatarRow = h('div', { class: 'room-agent-avatars' });
      for (const agent of agentsInRoom) {
        avatarRow.appendChild(h('div', {
          class: `agent-avatar${agent.status === 'active' || agent.status === 'working' ? ' active' : ''}`,
          title: agent.name || agent.agentId
        }, (agent.name || '?')[0].toUpperCase()));
      }
      roomCard.appendChild(avatarRow);
    }

    roomCard.addEventListener('click', (e) => {
      e.stopPropagation();
      OverlordUI.dispatch('building:room-selected', { roomId: room.id, floorId });
    });

    return roomCard;
  }

  /** Open modal to add a room to a floor. */
  _openAddRoomModal(floor) {
    const floorType = floor.type || 'default';
    const suggested = FLOOR_ROOM_SUGGESTIONS[floorType] || [];
    const allTypes = Object.entries(ROOM_TYPE_INFO);

    // Sort: suggested types first, then the rest
    const sorted = [...allTypes].sort((a, b) => {
      const aS = suggested.includes(a[0]) ? 0 : 1;
      const bS = suggested.includes(b[0]) ? 0 : 1;
      return aS - bS;
    });

    let selectedType = suggested[0] || allTypes[0][0];
    let roomName = '';

    const container = h('div', { class: 'add-room-modal' });

    // Guidance text
    container.appendChild(h('div', { class: 'add-room-guidance' },
      h('p', null, `Adding a room to `),
      h('strong', null, floor.name || `Floor ${floor.ordinal || '?'}`),
      h('span', null, ` (${floorType} floor)`),
    ));

    if (suggested.length > 0) {
      container.appendChild(h('div', { class: 'add-room-suggestion' },
        h('span', { class: 'add-room-suggestion-icon' }, '\u{1F4A1}'),
        h('span', null, `Recommended for ${floorType}: ${suggested.map(t => ROOM_TYPE_INFO[t]?.label || t).join(', ')}`)
      ));
    }

    // Room name input
    const nameGroup = h('div', { class: 'add-room-field' });
    nameGroup.appendChild(h('label', { class: 'form-label' }, 'Room Name (optional)'));
    const nameInput = h('input', { class: 'form-input', type: 'text', placeholder: 'e.g., "Frontend Code Lab"' });
    nameInput.addEventListener('input', () => { roomName = nameInput.value; });
    nameGroup.appendChild(nameInput);
    container.appendChild(nameGroup);

    // Room type picker grid
    container.appendChild(h('label', { class: 'form-label' }, 'Room Type'));
    const typeGrid = h('div', { class: 'add-room-type-grid' });

    for (const [typeKey, info] of sorted) {
      const isSuggested = suggested.includes(typeKey);
      const card = h('div', {
        class: `add-room-type-card${selectedType === typeKey ? ' selected' : ''}${isSuggested ? ' suggested' : ''}`,
        'data-type': typeKey
      },
        h('div', { class: 'add-room-type-icon' }, info.icon),
        h('div', { class: 'add-room-type-info' },
          h('div', { class: 'add-room-type-label' },
            info.label,
            isSuggested ? h('span', { class: 'add-room-type-badge' }, 'Recommended') : null
          ),
          h('div', { class: 'add-room-type-desc' }, info.desc)
        )
      );

      card.addEventListener('click', () => {
        selectedType = typeKey;
        typeGrid.querySelectorAll('.add-room-type-card').forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
      });

      typeGrid.appendChild(card);
    }
    container.appendChild(typeGrid);

    // Action buttons
    const actions = h('div', { class: 'add-room-actions' });
    const cancelBtn = h('button', { class: 'btn btn-ghost btn-md' }, 'Cancel');
    cancelBtn.addEventListener('click', () => Modal.close('add-room'));

    const createBtn = h('button', { class: 'btn btn-primary btn-md' }, 'Create Room');
    createBtn.addEventListener('click', async () => {
      if (!window.overlordSocket) {
        Toast.error('Not connected to server');
        return;
      }

      createBtn.disabled = true;
      createBtn.textContent = 'Creating...';

      try {
        const result = await window.overlordSocket.createRoom({
          type: selectedType,
          floorId: floor.id,
          name: roomName.trim() || undefined,
        });

        if (result && result.ok) {
          Toast.success(`Room "${ROOM_TYPE_INFO[selectedType]?.label || selectedType}" created`);
          Modal.close('add-room');

          // Refresh floor data to show new room
          const store = OverlordUI.getStore();
          const buildingId = store?.get('building.active');
          if (buildingId && window.overlordSocket) {
            window.overlordSocket.fetchFloors(buildingId);
            window.overlordSocket.fetchRooms();
          }
        } else {
          throw new Error(result?.error?.message || 'Failed to create room');
        }
      } catch (err) {
        Toast.error(`Create failed: ${err.message}`);
        createBtn.disabled = false;
        createBtn.textContent = 'Create Room';
      }
    });

    actions.appendChild(cancelBtn);
    actions.appendChild(createBtn);
    container.appendChild(actions);

    Modal.open('add-room', {
      title: `Add Room to ${floor.name || 'Floor'}`,
      content: container,
      size: 'lg',
      position: window.innerWidth < 768 ? 'fullscreen' : 'center',
    });
  }

  /**
   * Determine the room status based on its agents.
   * @returns {'active' | 'idle' | 'error'}
   */
  _getRoomStatus(agents) {
    if (agents.length === 0) return 'idle';
    const hasError = agents.some(a => a.status === 'error');
    if (hasError) return 'error';
    const hasActive = agents.some(a => a.status === 'active' || a.status === 'working');
    if (hasActive) return 'active';
    return 'idle';
  }

  /** Format room type slug as title (e.g., "code-lab" -> "Code Lab"). */
  _formatRoomType(type) {
    if (!type) return 'Room';
    return type.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  }

  _renderEmptyState() {
    const container = h('div', { class: 'empty-state building-empty-state' },
      h('div', { class: 'empty-state-icon' }, '\u{1F3D7}'),
      h('h3', { class: 'empty-state-title' }, 'No Building Selected'),
      h('p', { class: 'empty-state-text' }, 'Create a project or select a building to see its structure.'),
      h('div', { class: 'empty-state-guide' },
        h('h4', null, 'Getting Started'),
        h('ol', { class: 'empty-state-steps' },
          h('li', null, 'Click "New Project" on the Dashboard to create a building'),
          h('li', null, 'The Strategist will create a blueprint with floors and rooms'),
          h('li', null, 'Expand a floor and click rooms to see details'),
          h('li', null, 'Assign agents to rooms so they can start working'),
          h('li', null, 'Use exit documents to advance through project phases')
        )
      )
    );
    return container;
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
    // Optimized partial update — update agent dots + room avatars without full render
    let needsFullRender = false;

    this.el.querySelectorAll('.floor-bar').forEach(bar => {
      const floorId = bar.dataset.floorId;
      const agents = this._getAgentsOnFloor(floorId);

      // Update floor-level dots
      let dotsRow = bar.querySelector('.floor-agent-dots');
      if (agents.length > 0) {
        if (!dotsRow) {
          // Create dots row if it didn't exist
          dotsRow = h('div', { class: 'floor-agent-dots' });
          const expandIcon = bar.querySelector('.floor-expand-icon');
          if (expandIcon) {
            bar.insertBefore(dotsRow, expandIcon);
          } else {
            bar.appendChild(dotsRow);
          }
        }
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
      } else if (dotsRow) {
        // No agents on floor — remove dots row
        dotsRow.remove();
      }

      // Update room cards (for expanded floors)
      bar.querySelectorAll('.room-card').forEach(roomCard => {
        const roomId = roomCard.dataset.roomId;
        const agentsInRoom = this._getAgentsInRoom(roomId);
        const existingAvatarRow = roomCard.querySelector('.room-agent-avatars');
        const roomStatus = this._getRoomStatus(agentsInRoom);

        // Update occupied class
        roomCard.classList.toggle('room-occupied', agentsInRoom.length > 0);

        // Update status badge
        const statusBadge = roomCard.querySelector('.room-status-badge');
        if (statusBadge) {
          statusBadge.classList.remove('room-status-active', 'room-status-idle', 'room-status-error');
          statusBadge.classList.add(`room-status-${roomStatus}`);
          statusBadge.textContent = roomStatus;
        }

        // Update agent count
        const agentCount = roomCard.querySelector('.room-card-agent-count');
        if (agentCount) {
          agentCount.textContent = `${agentsInRoom.length} agent${agentsInRoom.length !== 1 ? 's' : ''}`;
        }

        if (agentsInRoom.length > 0) {
          const avatarRow = existingAvatarRow || h('div', { class: 'room-agent-avatars' });
          avatarRow.textContent = '';
          for (const agent of agentsInRoom) {
            avatarRow.appendChild(h('div', {
              class: `agent-avatar${agent.status === 'active' || agent.status === 'working' ? ' active' : ''}`,
              title: agent.name || agent.agentId
            }, (agent.name || '?')[0].toUpperCase()));
          }
          if (!existingAvatarRow) {
            roomCard.appendChild(avatarRow);
          }
        } else if (existingAvatarRow) {
          existingAvatarRow.remove();
        }
      });
    });

    // Update active agent count in stats
    const activeStatEl = this.el.querySelector('.building-stats .building-stat:last-child .building-stat-value');
    if (activeStatEl) {
      activeStatEl.textContent = String(this._countActiveAgents());
    }
  }
}
