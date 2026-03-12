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

    // Subscribe to phase changes so sidebar badge updates
    this.subscribe(store, 'building.activePhase', (phase) => {
      if (this._buildingData && phase) {
        this._buildingData = { ...this._buildingData, active_phase: phase };
        this.render();
      }
    });

    // Hydrate from store — data may have arrived before this view mounted
    this._buildingData = store.get('building.data') || null;
    this._agentPositions = store.get('building.agentPositions') || {};
    this._floors = store.get('building.floors') || [];

    this.render();
  }

  render() {
    this.el.textContent = '';

    if (!this._buildingData) {
      this.el.appendChild(this._renderEmptyState());
      return;
    }

    // Building header with management controls
    const header = h('div', { class: 'building-header' });

    const headerTop = h('div', { class: 'building-header-top' },
      h('div', { class: 'building-name' }, this._buildingData.name || 'Building'),
      h('div', { class: 'building-phase' },
        h('span', { class: `phase-badge phase-${this._buildingData.active_phase || 'strategy'}` },
          this._buildingData.active_phase || 'strategy'
        )
      )
    );
    header.appendChild(headerTop);

    // Project directory and repo info
    if (this._buildingData.working_directory || this._buildingData.repo_url) {
      const projectInfo = h('div', { class: 'building-project-info' });
      if (this._buildingData.working_directory) {
        projectInfo.appendChild(h('div', { class: 'building-project-path mono' },
          h('span', { class: 'building-project-icon' }, '\u{1F4C1}'),
          this._buildingData.working_directory
        ));
      }
      if (this._buildingData.repo_url) {
        const repoLink = h('a', {
          class: 'building-project-repo mono',
          href: this._buildingData.repo_url,
          target: '_blank',
          rel: 'noopener',
        },
          h('span', { class: 'building-project-icon' }, '\u{1F517}'),
          this._buildingData.repo_url.replace('https://github.com/', '')
        );
        projectInfo.appendChild(repoLink);
      }
      header.appendChild(projectInfo);
    }

    // Building action bar
    const headerActions = h('div', { class: 'building-header-actions' });
    const addFloorBtn = h('button', { class: 'btn btn-primary btn-sm' }, '+ Add Floor');
    addFloorBtn.addEventListener('click', () => this._openAddFloorModal());
    headerActions.appendChild(addFloorBtn);

    const editBuildingBtn = h('button', { class: 'btn btn-ghost btn-sm' }, 'Edit Building');
    editBuildingBtn.addEventListener('click', () => this._openEditBuildingModal());
    headerActions.appendChild(editBuildingBtn);
    header.appendChild(headerActions);

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

    // Floor info row — name on first line, type + room count as metadata
    const floorLabel = floor.name || `Floor ${floor.ordinal || '?'}`;
    const infoRow = h('div', { class: 'floor-bar-info' },
      h('span', { class: 'floor-bar-name', title: floorLabel }, floorLabel),
      h('span', { class: 'floor-bar-meta-row' },
        h('span', { class: 'floor-bar-type' }, floorType),
        h('span', { class: 'floor-bar-rooms' }, `${roomCount} rm`)
      )
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

    // Expanded content: room grid + floor management
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

      // Floor action toolbar
      const floorActions = h('div', { class: 'floor-action-bar' });

      const addRoomBtn = h('button', { class: 'btn btn-primary btn-sm' }, '+ Add Room');
      addRoomBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._openAddRoomModal(floor);
      });
      floorActions.appendChild(addRoomBtn);

      const editFloorBtn = h('button', { class: 'btn btn-ghost btn-sm' }, 'Edit Floor');
      editFloorBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._openEditFloorModal(floor);
      });
      floorActions.appendChild(editFloorBtn);

      const deleteFloorBtn = h('button', { class: 'btn btn-ghost btn-sm btn-danger-ghost' }, 'Delete');
      deleteFloorBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._confirmDeleteFloor(floor);
      });
      floorActions.appendChild(deleteFloorBtn);

      expandedContent.appendChild(floorActions);
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
      h('span', { class: 'room-card-name', title: room.name || this._formatRoomType(room.type) }, room.name || this._formatRoomType(room.type))
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

    // Room action buttons (visible on hover via CSS)
    const roomActions = h('div', { class: 'room-card-actions' });
    const editRoomBtn = h('button', { class: 'room-action-btn', title: 'Edit room' }, '\u270F\uFE0F');
    editRoomBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._openEditRoomModal(room, floorId);
    });
    roomActions.appendChild(editRoomBtn);

    const deleteRoomBtn = h('button', { class: 'room-action-btn room-action-danger', title: 'Delete room' }, '\u{1F5D1}\uFE0F');
    deleteRoomBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._confirmDeleteRoom(room);
    });
    roomActions.appendChild(deleteRoomBtn);
    roomCard.appendChild(roomActions);

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

  // ── Building Management Modal ────────────────────────────

  /** Open modal to edit building name and configuration. */
  _openEditBuildingModal() {
    if (!this._buildingData) return;
    let buildingName = this._buildingData.name || '';
    let workingDirectory = this._buildingData.working_directory || '';
    let repoUrl = this._buildingData.repo_url || '';

    const container = h('div', { class: 'edit-building-modal' });

    // Name input
    const nameGroup = h('div', { class: 'add-room-field' });
    nameGroup.appendChild(h('label', { class: 'form-label' }, 'Building Name'));
    const nameInput = h('input', { class: 'form-input', type: 'text', value: buildingName });
    nameInput.addEventListener('input', () => { buildingName = nameInput.value; });
    nameGroup.appendChild(nameInput);
    container.appendChild(nameGroup);

    // Working Directory input
    const wdGroup = h('div', { class: 'add-room-field' });
    wdGroup.appendChild(h('label', { class: 'form-label' }, 'Project Directory'));
    const wdInput = h('input', { class: 'form-input mono', type: 'text', value: workingDirectory, placeholder: '/path/to/project' });
    wdInput.addEventListener('input', () => { workingDirectory = wdInput.value; });
    wdGroup.appendChild(wdInput);
    wdGroup.appendChild(h('div', { class: 'form-hint' }, 'Local filesystem path where agents will read/write project files'));
    container.appendChild(wdGroup);

    // Repo URL input
    const repoGroup = h('div', { class: 'add-room-field' });
    repoGroup.appendChild(h('label', { class: 'form-label' }, 'GitHub Repository'));
    const repoInput = h('input', { class: 'form-input mono', type: 'text', value: repoUrl, placeholder: 'https://github.com/owner/repo' });
    repoInput.addEventListener('input', () => { repoUrl = repoInput.value; });
    repoGroup.appendChild(repoInput);
    repoGroup.appendChild(h('div', { class: 'form-hint' }, 'GitHub repository URL for issues, PRs, and CI/CD'));
    container.appendChild(repoGroup);

    // Building ID (read-only)
    const idGroup = h('div', { class: 'add-room-field' });
    idGroup.appendChild(h('label', { class: 'form-label' }, 'Building ID'));
    idGroup.appendChild(h('div', { class: 'form-input-readonly mono' }, this._buildingData.id));
    container.appendChild(idGroup);

    // Phase (read-only)
    const phaseGroup = h('div', { class: 'add-room-field' });
    phaseGroup.appendChild(h('label', { class: 'form-label' }, 'Current Phase'));
    phaseGroup.appendChild(h('div', { class: 'form-input-readonly' },
      h('span', { class: `phase-badge phase-${this._buildingData.active_phase || 'strategy'}` },
        this._buildingData.active_phase || 'strategy'
      )
    ));
    container.appendChild(phaseGroup);

    // Summary
    container.appendChild(h('div', { class: 'edit-building-summary' },
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
        h('span', { class: 'building-stat-label' }, 'Active Agents')
      )
    ));

    // Actions
    const actions = h('div', { class: 'add-room-actions' });
    const cancelBtn = h('button', { class: 'btn btn-ghost btn-md' }, 'Cancel');
    cancelBtn.addEventListener('click', () => Modal.close('edit-building'));

    const saveBtn = h('button', { class: 'btn btn-primary btn-md' }, 'Save Changes');
    saveBtn.addEventListener('click', async () => {
      if (!window.overlordSocket) { Toast.error('Not connected'); return; }
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving...';
      try {
        const result = await window.overlordSocket.updateBuilding(this._buildingData.id, {
          name: buildingName.trim() || this._buildingData.name,
          workingDirectory: workingDirectory.trim() || undefined,
          repoUrl: repoUrl.trim() || undefined,
        });
        if (result && result.ok) {
          Toast.success('Building updated');
          Modal.close('edit-building');
        } else {
          throw new Error(result?.error?.message || 'Update failed');
        }
      } catch (err) {
        Toast.error(`Failed: ${err.message}`);
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save Changes';
      }
    });

    actions.appendChild(cancelBtn);
    actions.appendChild(saveBtn);
    container.appendChild(actions);

    Modal.open('edit-building', {
      title: `Edit Building: ${this._buildingData.name || 'Building'}`,
      content: container,
      size: 'md',
      position: window.innerWidth < 768 ? 'fullscreen' : 'center',
    });
  }

  // ── Floor Management Modals ──────────────────────────────

  /** Open modal to edit a floor's name and configuration. */
  _openEditFloorModal(floor) {
    let floorName = floor.name || '';
    let isActive = floor.is_active !== 0;

    const container = h('div', { class: 'edit-floor-modal' });

    // Name input
    const nameGroup = h('div', { class: 'add-room-field' });
    nameGroup.appendChild(h('label', { class: 'form-label' }, 'Floor Name'));
    const nameInput = h('input', { class: 'form-input', type: 'text', value: floorName });
    nameInput.addEventListener('input', () => { floorName = nameInput.value; });
    nameGroup.appendChild(nameInput);
    container.appendChild(nameGroup);

    // Floor type (read-only — structural identity)
    const typeGroup = h('div', { class: 'add-room-field' });
    typeGroup.appendChild(h('label', { class: 'form-label' }, 'Floor Type'));
    typeGroup.appendChild(h('div', { class: 'form-input-readonly' }, floor.type || 'default'));
    typeGroup.appendChild(h('span', { class: 'form-hint' }, 'Floor type cannot be changed — it defines the floor\'s purpose.'));
    container.appendChild(typeGroup);

    // Active toggle
    const activeGroup = h('div', { class: 'add-room-field' });
    activeGroup.appendChild(h('label', { class: 'form-label' }, 'Active'));
    const activeToggle = h('button', {
      class: `settings-switch${isActive ? ' on' : ''}`,
      role: 'switch',
      'aria-checked': isActive ? 'true' : 'false'
    });
    activeToggle.appendChild(h('span', { class: 'settings-switch-knob' }));
    activeToggle.addEventListener('click', () => {
      isActive = !isActive;
      activeToggle.classList.toggle('on', isActive);
      activeToggle.setAttribute('aria-checked', isActive ? 'true' : 'false');
    });
    activeGroup.appendChild(activeToggle);
    activeGroup.appendChild(h('span', { class: 'form-hint' }, 'Inactive floors are hidden from agents but preserved.'));
    container.appendChild(activeGroup);

    // Room summary (read-only info)
    const rooms = floor.rooms || [];
    if (rooms.length > 0) {
      container.appendChild(h('div', { class: 'edit-floor-rooms-summary' },
        h('label', { class: 'form-label' }, `Rooms on this floor (${rooms.length})`),
        h('ul', { class: 'edit-floor-room-list' },
          ...rooms.map(r => h('li', null,
            h('span', null, r.name || this._formatRoomType(r.type)),
            h('span', { class: 'edit-floor-room-type' }, r.type)
          ))
        )
      ));
    }

    // Actions
    const actions = h('div', { class: 'add-room-actions' });
    const cancelBtn = h('button', { class: 'btn btn-ghost btn-md' }, 'Cancel');
    cancelBtn.addEventListener('click', () => Modal.close('edit-floor'));

    const saveBtn = h('button', { class: 'btn btn-primary btn-md' }, 'Save Changes');
    saveBtn.addEventListener('click', async () => {
      if (!window.overlordSocket) { Toast.error('Not connected'); return; }
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving...';
      try {
        const result = await window.overlordSocket.updateFloor(floor.id, {
          name: floorName.trim() || floor.name,
          isActive: isActive ? 1 : 0,
        });
        if (result && result.ok) {
          Toast.success('Floor updated');
          Modal.close('edit-floor');
        } else {
          throw new Error(result?.error?.message || 'Update failed');
        }
      } catch (err) {
        Toast.error(`Failed: ${err.message}`);
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save Changes';
      }
    });

    actions.appendChild(cancelBtn);
    actions.appendChild(saveBtn);
    container.appendChild(actions);

    Modal.open('edit-floor', {
      title: `Edit Floor: ${floor.name || 'Floor'}`,
      content: container,
      size: 'md',
      position: window.innerWidth < 768 ? 'fullscreen' : 'center',
    });
  }

  /** Confirm and delete a floor. */
  _confirmDeleteFloor(floor) {
    const rooms = floor.rooms || [];
    const container = h('div', { class: 'confirm-delete-modal' });

    container.appendChild(h('p', { class: 'confirm-delete-message' },
      `Are you sure you want to delete "${floor.name || 'this floor'}"?`));

    if (rooms.length > 0) {
      container.appendChild(h('div', { class: 'confirm-delete-warning' },
        h('span', { class: 'confirm-delete-warning-icon' }, '\u26A0\uFE0F'),
        h('span', null, `This floor has ${rooms.length} room${rooms.length > 1 ? 's' : ''}. You must delete all rooms first before removing this floor.`)
      ));
      // Disable delete button when floor has rooms
      const actions = h('div', { class: 'add-room-actions' });
      const cancelBtn = h('button', { class: 'btn btn-ghost btn-md' }, 'OK');
      cancelBtn.addEventListener('click', () => Modal.close('confirm-delete'));
      actions.appendChild(cancelBtn);
      container.appendChild(actions);

      Modal.open('confirm-delete', {
        title: 'Cannot Delete Floor',
        content: container,
        size: 'sm',
        position: 'center',
      });
      return;
    }

    const actions = h('div', { class: 'add-room-actions' });
    const cancelBtn = h('button', { class: 'btn btn-ghost btn-md' }, 'Cancel');
    cancelBtn.addEventListener('click', () => Modal.close('confirm-delete'));

    const deleteBtn = h('button', { class: 'btn btn-danger btn-md' }, 'Delete Floor');
    deleteBtn.addEventListener('click', async () => {
      if (!window.overlordSocket) { Toast.error('Not connected'); return; }
      deleteBtn.disabled = true;
      deleteBtn.textContent = 'Deleting...';
      try {
        const result = await window.overlordSocket.deleteFloor(floor.id);
        if (result && result.ok) {
          Toast.success('Floor deleted');
          Modal.close('confirm-delete');
          this._expandedFloor = null;
        } else {
          throw new Error(result?.error?.message || 'Delete failed');
        }
      } catch (err) {
        Toast.error(`Failed: ${err.message}`);
        deleteBtn.disabled = false;
        deleteBtn.textContent = 'Delete Floor';
      }
    });

    actions.appendChild(cancelBtn);
    actions.appendChild(deleteBtn);
    container.appendChild(actions);

    Modal.open('confirm-delete', {
      title: 'Delete Floor',
      content: container,
      size: 'sm',
      position: 'center',
    });
  }

  // ── Room Management Modals ──────────────────────────────

  /** Open modal to edit a room's name, tools, and configuration. */
  _openEditRoomModal(room, floorId) {
    let roomName = room.name || '';
    let allowedTools = room.allowed_tools || room.allowedTools || [];
    let fileScope = room.file_scope || room.fileScope || 'assigned';
    let provider = room.provider || 'configurable';

    if (typeof allowedTools === 'string') {
      try { allowedTools = JSON.parse(allowedTools); } catch { allowedTools = []; }
    }

    const container = h('div', { class: 'edit-room-modal' });

    // Name input
    const nameGroup = h('div', { class: 'add-room-field' });
    nameGroup.appendChild(h('label', { class: 'form-label' }, 'Room Name'));
    const nameInput = h('input', { class: 'form-input', type: 'text', value: roomName });
    nameInput.addEventListener('input', () => { roomName = nameInput.value; });
    nameGroup.appendChild(nameInput);
    container.appendChild(nameGroup);

    // Room type (read-only)
    const typeGroup = h('div', { class: 'add-room-field' });
    typeGroup.appendChild(h('label', { class: 'form-label' }, 'Room Type'));
    const typeInfo = ROOM_TYPE_INFO[room.type] || { icon: '\u2753', label: room.type, desc: '' };
    typeGroup.appendChild(h('div', { class: 'form-input-readonly' },
      h('span', null, `${typeInfo.icon} ${typeInfo.label}`)));
    typeGroup.appendChild(h('span', { class: 'form-hint' }, typeInfo.desc));
    container.appendChild(typeGroup);

    // File scope selector
    const scopeGroup = h('div', { class: 'add-room-field' });
    scopeGroup.appendChild(h('label', { class: 'form-label' }, 'File Scope'));
    const scopeSelect = h('select', { class: 'form-input settings-select' });
    for (const scope of ['assigned', 'read-only', 'full', 'none']) {
      const opt = h('option', { value: scope }, scope.charAt(0).toUpperCase() + scope.slice(1).replace('-', ' '));
      if (scope === fileScope) opt.selected = true;
      scopeSelect.appendChild(opt);
    }
    scopeSelect.addEventListener('change', () => { fileScope = scopeSelect.value; });
    scopeGroup.appendChild(scopeSelect);
    scopeGroup.appendChild(h('span', { class: 'form-hint' }, 'Controls agent file access in this room.'));
    container.appendChild(scopeGroup);

    // Provider selector
    const providerGroup = h('div', { class: 'add-room-field' });
    providerGroup.appendChild(h('label', { class: 'form-label' }, 'AI Provider'));
    const providerSelect = h('select', { class: 'form-input settings-select' });
    for (const prov of ['configurable', 'anthropic', 'minimax', 'openai', 'ollama']) {
      const opt = h('option', { value: prov }, prov.charAt(0).toUpperCase() + prov.slice(1));
      if (prov === provider) opt.selected = true;
      providerSelect.appendChild(opt);
    }
    providerSelect.addEventListener('change', () => { provider = providerSelect.value; });
    providerGroup.appendChild(providerSelect);
    container.appendChild(providerGroup);

    // Tools list
    const toolsGroup = h('div', { class: 'add-room-field' });
    toolsGroup.appendChild(h('label', { class: 'form-label' }, `Allowed Tools (${allowedTools.length})`));
    const toolsTextarea = h('textarea', {
      class: 'form-input form-textarea',
      rows: '4',
      placeholder: 'One tool per line, e.g.:\nread_file\nwrite_file\nbash',
    });
    toolsTextarea.value = Array.isArray(allowedTools) ? allowedTools.join('\n') : '';
    toolsGroup.appendChild(toolsTextarea);
    toolsGroup.appendChild(h('span', { class: 'form-hint' }, 'One tool per line. Only these tools will be available to agents in this room.'));
    container.appendChild(toolsGroup);

    // Actions
    const actions = h('div', { class: 'add-room-actions' });
    const cancelBtn = h('button', { class: 'btn btn-ghost btn-md' }, 'Cancel');
    cancelBtn.addEventListener('click', () => Modal.close('edit-room'));

    const saveBtn = h('button', { class: 'btn btn-primary btn-md' }, 'Save Changes');
    saveBtn.addEventListener('click', async () => {
      if (!window.overlordSocket) { Toast.error('Not connected'); return; }
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving...';

      const parsedTools = toolsTextarea.value
        .split('\n')
        .map(t => t.trim())
        .filter(Boolean);

      try {
        const result = await window.overlordSocket.updateRoom(room.id, {
          name: roomName.trim() || room.name,
          fileScope,
          provider,
          allowedTools: parsedTools,
        });
        if (result && result.ok) {
          Toast.success('Room updated');
          Modal.close('edit-room');
        } else {
          throw new Error(result?.error?.message || 'Update failed');
        }
      } catch (err) {
        Toast.error(`Failed: ${err.message}`);
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save Changes';
      }
    });

    actions.appendChild(cancelBtn);
    actions.appendChild(saveBtn);
    container.appendChild(actions);

    Modal.open('edit-room', {
      title: `Edit Room: ${room.name || typeInfo.label}`,
      content: container,
      size: 'lg',
      position: window.innerWidth < 768 ? 'fullscreen' : 'center',
    });
  }

  /** Confirm and delete a room. */
  _confirmDeleteRoom(room) {
    const container = h('div', { class: 'confirm-delete-modal' });
    const typeName = ROOM_TYPE_INFO[room.type]?.label || room.type;

    container.appendChild(h('p', { class: 'confirm-delete-message' },
      `Are you sure you want to delete "${room.name || typeName}"?`));

    container.appendChild(h('div', { class: 'confirm-delete-warning' },
      h('span', { class: 'confirm-delete-warning-icon' }, '\u26A0\uFE0F'),
      h('span', null, 'Any agents seated in this room will be unseated. Tables and their data will be removed.')
    ));

    const actions = h('div', { class: 'add-room-actions' });
    const cancelBtn = h('button', { class: 'btn btn-ghost btn-md' }, 'Cancel');
    cancelBtn.addEventListener('click', () => Modal.close('confirm-delete'));

    const deleteBtn = h('button', { class: 'btn btn-danger btn-md' }, 'Delete Room');
    deleteBtn.addEventListener('click', async () => {
      if (!window.overlordSocket) { Toast.error('Not connected'); return; }
      deleteBtn.disabled = true;
      deleteBtn.textContent = 'Deleting...';
      try {
        const result = await window.overlordSocket.deleteRoom(room.id);
        if (result && result.ok) {
          Toast.success(`Room "${typeName}" deleted`);
          Modal.close('confirm-delete');
        } else {
          throw new Error(result?.error?.message || 'Delete failed');
        }
      } catch (err) {
        Toast.error(`Failed: ${err.message}`);
        deleteBtn.disabled = false;
        deleteBtn.textContent = 'Delete Room';
      }
    });

    actions.appendChild(cancelBtn);
    actions.appendChild(deleteBtn);
    container.appendChild(actions);

    Modal.open('confirm-delete', {
      title: 'Delete Room',
      content: container,
      size: 'sm',
      position: 'center',
    });
  }

  // ── Add Floor Modal ──────────────────────────────────────

  /** Open modal to add a new floor to the building. */
  _openAddFloorModal() {
    const FLOOR_TYPES = [
      { type: 'strategy',      label: 'Strategy',      icon: '\u{1F3AF}', desc: 'Phase Zero setup, consulting, and project strategy' },
      { type: 'collaboration', label: 'Collaboration', icon: '\u{1F4AC}', desc: 'Discovery, architecture, and planning rooms' },
      { type: 'execution',     label: 'Execution',     icon: '\u{1F4BB}', desc: 'Code labs, testing labs, and active development' },
      { type: 'governance',    label: 'Governance',    icon: '\u{1F4DD}', desc: 'Review, audit, and release management' },
      { type: 'operations',    label: 'Operations',    icon: '\u2699\uFE0F', desc: 'Deploy, monitoring, and incident response' },
      { type: 'integration',   label: 'Integration',   icon: '\u{1F50C}', desc: 'Plugins, data exchange, and external APIs' },
    ];

    let selectedType = FLOOR_TYPES[0].type;
    let floorName = '';

    const container = h('div', { class: 'add-floor-modal' });

    // Name input
    const nameGroup = h('div', { class: 'add-room-field' });
    nameGroup.appendChild(h('label', { class: 'form-label' }, 'Floor Name (optional)'));
    const nameInput = h('input', { class: 'form-input', type: 'text', placeholder: 'e.g., "Frontend Execution"' });
    nameInput.addEventListener('input', () => { floorName = nameInput.value; });
    nameGroup.appendChild(nameInput);
    container.appendChild(nameGroup);

    // Floor type picker
    container.appendChild(h('label', { class: 'form-label' }, 'Floor Type'));
    const typeGrid = h('div', { class: 'add-room-type-grid' });

    for (const ft of FLOOR_TYPES) {
      const card = h('div', {
        class: `add-room-type-card${selectedType === ft.type ? ' selected' : ''}`,
        'data-type': ft.type
      },
        h('div', { class: 'add-room-type-icon' }, ft.icon),
        h('div', { class: 'add-room-type-info' },
          h('div', { class: 'add-room-type-label' }, ft.label),
          h('div', { class: 'add-room-type-desc' }, ft.desc)
        )
      );

      card.addEventListener('click', () => {
        selectedType = ft.type;
        typeGrid.querySelectorAll('.add-room-type-card').forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
      });
      typeGrid.appendChild(card);
    }
    container.appendChild(typeGrid);

    // Actions
    const actions = h('div', { class: 'add-room-actions' });
    const cancelBtn = h('button', { class: 'btn btn-ghost btn-md' }, 'Cancel');
    cancelBtn.addEventListener('click', () => Modal.close('add-floor'));

    const createBtn = h('button', { class: 'btn btn-primary btn-md' }, 'Create Floor');
    createBtn.addEventListener('click', async () => {
      if (!window.overlordSocket) { Toast.error('Not connected'); return; }
      const buildingId = OverlordUI.getStore()?.get('building.active');
      if (!buildingId) { Toast.error('No building selected'); return; }

      createBtn.disabled = true;
      createBtn.textContent = 'Creating...';

      const name = floorName.trim() || `${selectedType.charAt(0).toUpperCase() + selectedType.slice(1)} Floor`;
      try {
        const result = await window.overlordSocket.createFloor(buildingId, selectedType, name);
        if (result && result.ok) {
          Toast.success(`Floor "${name}" created`);
          Modal.close('add-floor');
        } else {
          throw new Error(result?.error?.message || 'Failed to create floor');
        }
      } catch (err) {
        Toast.error(`Create failed: ${err.message}`);
        createBtn.disabled = false;
        createBtn.textContent = 'Create Floor';
      }
    });

    actions.appendChild(cancelBtn);
    actions.appendChild(createBtn);
    container.appendChild(actions);

    Modal.open('add-floor', {
      title: 'Add Floor to Building',
      content: container,
      size: 'lg',
      position: window.innerWidth < 768 ? 'fullscreen' : 'center',
    });
  }

  // ── Helpers ──────────────────────────────────────────────

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
