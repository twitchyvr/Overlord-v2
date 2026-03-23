/**
 * Overlord v2 — Building View
 *
 * Vertical tree-style navigation for the building sidebar.
 * Renders floors as collapsible sections with compact room
 * list items — optimized for sidebar width constraints.
 *
 * Lives in #building-panel (left sidebar).
 */

import { Component } from '../engine/component.js';
import { OverlordUI } from '../engine/engine.js';
import { h, formatTime, tip } from '../engine/helpers.js';
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
  'deploy':             { icon: '\u{1F680}', label: 'Deploy',             desc: 'Deployment and release management. CI/CD pipelines and production pushes.' },
  'war-room':           { icon: '\u{1F6A8}', label: 'War Room',           desc: 'Incident response and emergency triage. Elevated access for critical issues.' },
  'integration':        { icon: '\u{1F50C}', label: 'Integration',        desc: 'External APIs, plugins, and third-party service connections.' },
};

/** Suggested room types per floor type. */
const FLOOR_ROOM_SUGGESTIONS = {
  'strategy':      ['strategist', 'building-architect'],
  'collaboration': ['discovery', 'architecture'],
  'execution':     ['code-lab', 'testing-lab'],
  'governance':    ['review'],
  'operations':    ['deploy', 'war-room'],
  'integration':   ['integration'],
};

/** Floor type icons. */
const FLOOR_TYPE_ICONS = {
  'strategy':      '\u{1F3AF}',
  'collaboration': '\u{1F4AC}',
  'execution':     '\u{1F4BB}',
  'governance':    '\u{1F4DD}',
  'operations':    '\u2699\uFE0F',
  'integration':   '\u{1F50C}',
};

export class BuildingView extends Component {
  constructor(el, opts = {}) {
    super(el, opts);
    this._buildingData = null;
    this._floors = [];
    this._expandedFloors = new Set(); // allow multiple floors expanded
    this._agentPositions = {};
    this._collapsed = localStorage.getItem('overlord:sidebar-collapsed') === 'true';
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
      this._updateAgentIndicators();
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

    // Subscribe to active room changes so the highlight updates
    this.subscribe(store, 'rooms.active', () => {
      this.render();
    });

    // Hydrate from store — data may have arrived before this view mounted
    this._buildingData = store.get('building.data') || null;
    this._agentPositions = store.get('building.agentPositions') || {};
    this._floors = store.get('building.floors') || [];

    this.render();
  }

  render() {
    this.el.textContent = '';
    // Apply persisted collapsed state on every render
    this.el.classList.toggle('collapsed', this._collapsed);

    if (!this._buildingData) {
      this.el.appendChild(this._renderEmptyState());
      return;
    }

    // ── Building header ──
    const header = h('div', { class: 'building-header' });

    const headerTop = h('div', { class: 'building-header-top' },
      h('div', { class: 'building-name', title: this._buildingData.name || 'Building' }, this._buildingData.name || 'Building'),
      h('div', { class: 'building-phase' },
        h('span', { class: `phase-badge phase-${this._buildingData.active_phase || 'strategy'}` },
          this._buildingData.active_phase || 'strategy'
        )
      )
    );
    header.appendChild(headerTop);

    // Project directory and repo info — always show, warn if missing (#606)
    const projectInfo = h('div', { class: 'building-project-info' });
    if (this._buildingData.working_directory) {
      const fullPath = this._buildingData.working_directory;
      const shortPath = fullPath.split('/').filter(Boolean).pop() || fullPath;
      const pathRow = h('div', { class: 'building-project-path mono', title: fullPath },
        h('span', { class: 'building-project-icon' }, '\u{1F4C1}'),
        shortPath
      );

      // Inline edit button for working directory (#539)
      const editBtn = h('button', {
        class: 'btn btn-ghost btn-xs building-wd-edit',
        title: 'Change working directory',
      }, '\u270E');
      editBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._showInlineWdEdit(pathRow, fullPath);
      });
      pathRow.appendChild(editBtn);
      projectInfo.appendChild(pathRow);
    } else {
      // No working directory — show warning with set button
      const warningRow = h('div', { class: 'building-project-path building-wd-warning' },
        h('span', { class: 'building-project-icon' }, '\u26A0'),
        h('span', null, 'No working directory set')
      );
      const setBtn = h('button', {
        class: 'btn btn-ghost btn-xs building-wd-edit',
        title: 'Set working directory',
      }, 'Set path');
      setBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._showInlineWdEdit(warningRow, '');
      });
      warningRow.appendChild(setBtn);
      projectInfo.appendChild(warningRow);
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

    // ── Floor tree (top-down, natural reading order) ──
    const tree = h('div', { class: 'building-tree' });

    // Sort floors by ordinal (lowest first = top-down)
    const sortedFloors = [...this._floors].sort((a, b) => (a.ordinal || 0) - (b.ordinal || 0));

    for (const floor of sortedFloors) {
      tree.appendChild(this._renderFloorSection(floor));
    }

    this.el.appendChild(tree);

    // ── Compact inline stats (#726) ──
    const floorCount = this._floors.length;
    const roomCount = this._countTotalRooms();
    const activeCount = this._countActiveAgents();
    const stats = h('div', { class: 'building-stats-inline' },
      h('span', null, `${floorCount} ${floorCount === 1 ? 'floor' : 'floors'}`),
      h('span', { class: 'building-stats-sep' }, '\u00B7'),
      h('span', null, `${roomCount} ${roomCount === 1 ? 'room' : 'rooms'}`),
      h('span', { class: 'building-stats-sep' }, '\u00B7'),
      h('span', null, `${activeCount} active`),
    );
    this.el.appendChild(stats);

    // ── Collapse toggle button ──
    const collapseBtn = h('button', {
      class: 'sidebar-collapse-toggle',
      title: this._collapsed ? 'Expand sidebar' : 'Collapse sidebar',
      'aria-label': this._collapsed ? 'Expand sidebar' : 'Collapse sidebar',
    }, this._collapsed ? '\u25B6' : '\u25C0');
    collapseBtn.addEventListener('click', () => {
      this._collapsed = !this._collapsed;
      localStorage.setItem('overlord:sidebar-collapsed', String(this._collapsed));
      this.el.classList.toggle('collapsed', this._collapsed);
      this.render();
    });
    this.el.appendChild(collapseBtn);

    // ── Resize handle ──
    if (!this._collapsed) {
      this._initResizeHandle();
    }
  }

  // ── Floor Section (collapsible) ────────────────────────

  _renderFloorSection(floor) {
    const isExpanded = this._expandedFloors.has(floor.id);
    const floorType = floor.type || 'default';
    const roomCount = (floor.rooms || []).length;
    const agentsOnFloor = this._getAgentsOnFloor(floor.id);
    const floorIcon = FLOOR_TYPE_ICONS[floorType] || '\u{1F3E2}';

    // Map floor type to its CSS color variable for the left border
    const floorColorMap = {
      'strategy': 'var(--floor-strategy)',
      'collaboration': 'var(--floor-collaboration)',
      'execution': 'var(--floor-execution)',
      'governance': 'var(--floor-governance)',
      'operations': 'var(--floor-operations)',
      'integration': 'var(--floor-integration)',
    };

    const section = h('div', {
      class: `floor-section${isExpanded ? ' expanded' : ''}`,
      'data-floor-id': floor.id,
      'data-type': floorType,
      style: `--floor-section-color: ${floorColorMap[floorType] || 'var(--border-secondary)'}`,
    });

    // Floor header row — clickable/keyboard-navigable to expand/collapse
    const header = h('div', {
      class: 'floor-section-header',
      tabindex: '0',
      role: 'button',
      'aria-expanded': isExpanded ? 'true' : 'false',
      'aria-label': `${floor.name || floorType} floor, ${roomCount} rooms`,
    });

    // Chevron — uses CSS rotation for smooth animation
    const chevron = h('span', { class: 'floor-chevron' }, '\u25B8');

    // Floor purpose descriptions (#1034) — plain language for non-technical users
    const FLOOR_PURPOSES = {
      strategy: 'Define the vision — analyze project, set goals, identify risks',
      collaboration: 'Research and design — gather requirements, plan architecture',
      execution: 'Build it — write code, run tests, create documentation',
      governance: 'Quality check — review work, verify standards before moving forward',
      operations: 'Ship it — prepare releases, monitor deployment',
      integration: 'Connect systems — data exchange, provider config, plugins',
    };
    const floorPurpose = FLOOR_PURPOSES[floorType] || '';

    // Floor type icon
    const iconEl = h('span', { class: 'floor-type-icon', title: floorPurpose || floorType }, floorIcon);

    // Floor name + room count
    const floorLabel = floor.name || `${floorType.charAt(0).toUpperCase() + floorType.slice(1)} Floor`;
    const nameEl = h('span', { class: 'floor-section-name', title: floorPurpose || floorLabel }, floorLabel);

    // Room count pill
    const countPill = h('span', { class: 'floor-section-count' }, String(roomCount));

    // Agent activity indicator
    const agentIndicator = agentsOnFloor.length > 0
      ? h('span', { class: 'floor-agent-indicator', title: `${agentsOnFloor.length} agent${agentsOnFloor.length !== 1 ? 's' : ''} on this floor` },
          h('span', { class: 'floor-agent-pulse' }),
          String(agentsOnFloor.length)
        )
      : null;

    header.appendChild(chevron);
    header.appendChild(iconEl);
    header.appendChild(nameEl);
    if (agentIndicator) header.appendChild(agentIndicator);
    header.appendChild(countPill);

    // Toggle expand/collapse — shared logic for click and keyboard
    const toggleFloor = () => {
      // If sidebar is collapsed, expand it and this floor
      if (this._collapsed) {
        this._collapsed = false;
        localStorage.setItem('overlord:sidebar-collapsed', 'false');
        this.el.classList.remove('collapsed');
        this._expandedFloors.add(floor.id);
        this.render();
        return;
      }
      // Cancel any in-flight collapse animation to prevent double-body race condition
      const inflightBody = section.querySelector('.floor-section-body.collapsing');
      if (inflightBody) inflightBody.remove();

      const wasExpanded = this._expandedFloors.has(floor.id);
      if (wasExpanded) {
        this._expandedFloors.delete(floor.id);
        header.setAttribute('aria-expanded', 'false');
        // Animate collapse: add collapsing class, then remove body after animation
        const body = section.querySelector('.floor-section-body');
        if (body) {
          body.classList.add('collapsing');
          body.addEventListener('animationend', () => {
            body.remove();
            section.classList.remove('expanded');
          }, { once: true });
        } else {
          section.classList.remove('expanded');
        }
      } else {
        // Accordion: collapse all other floors first (#726)
        for (const otherId of [...this._expandedFloors]) {
          if (otherId !== floor.id) {
            this._expandedFloors.delete(otherId);
            const otherSection = this.el.querySelector(`[data-floor-id="${otherId}"]`);
            if (otherSection) {
              const otherBody = otherSection.querySelector('.floor-section-body');
              if (otherBody) otherBody.remove();
              otherSection.classList.remove('expanded');
              const otherHeader = otherSection.querySelector('.floor-section-header');
              if (otherHeader) otherHeader.setAttribute('aria-expanded', 'false');
            }
          }
        }

        this._expandedFloors.add(floor.id);
        header.setAttribute('aria-expanded', 'true');
        section.classList.add('expanded');
        const body = this._buildFloorBody(floor);
        section.appendChild(body);
      }
      OverlordUI.dispatch('building:floor-selected', { floorId: floor.id, expanded: this._expandedFloors.has(floor.id) });
    };

    // Click to expand/collapse
    header.addEventListener('click', toggleFloor);

    // Keyboard: Enter/Space to toggle, Arrow keys to navigate
    header.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggleFloor();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        // Focus next focusable element (next floor header or first room in expanded body)
        const next = section.querySelector('.room-item[tabindex]') ||
                     section.nextElementSibling?.querySelector('.floor-section-header');
        if (next) /** @type {HTMLElement} */ (next).focus();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        // Focus previous floor header
        const prev = section.previousElementSibling?.querySelector('.floor-section-header');
        if (prev) /** @type {HTMLElement} */ (prev).focus();
      }
    });

    // Context menu on right-click
    header.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this._showFloorContextMenu(e, floor);
    });

    section.appendChild(header);

    // Expanded content: room list + actions
    if (isExpanded) {
      section.appendChild(this._buildFloorBody(floor));
    }

    return section;
  }

  /** Build the expandable body content for a floor section. */
  _buildFloorBody(floor) {
    const body = h('div', { class: 'floor-section-body' });

    if (floor.rooms && floor.rooms.length > 0) {
      const roomList = h('div', { class: 'floor-room-list' });
      for (const room of floor.rooms) {
        roomList.appendChild(this._renderRoomItem(room, floor.id));
      }
      body.appendChild(roomList);
    } else {
      body.appendChild(h('div', { class: 'floor-empty' },
        'No rooms yet'
      ));
    }

    // Floor actions (compact)
    const actions = h('div', { class: 'floor-section-actions' });

    const addRoomBtn = h('button', { class: 'btn btn-ghost btn-xs floor-add-room-btn' }, '+ Room');
    addRoomBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._openAddRoomModal(floor);
    });
    actions.appendChild(addRoomBtn);

    const editFloorBtn = h('button', { class: 'btn btn-ghost btn-xs' }, 'Edit');
    editFloorBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._openEditFloorModal(floor);
    });
    actions.appendChild(editFloorBtn);

    const deleteFloorBtn = h('button', { class: 'btn btn-ghost btn-xs btn-danger-ghost' }, 'Delete');
    deleteFloorBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._confirmDeleteFloor(floor);
    });
    actions.appendChild(deleteFloorBtn);

    body.appendChild(actions);
    return body;
  }

  // ── Room Item (detail-rich mini card) ────────────────────

  _renderRoomItem(room, floorId) {
    const agentsInRoom = this._getAgentsInRoom(room.id);
    const roomStatus = this._getRoomStatus(agentsInRoom);
    const store = OverlordUI.getStore();
    const isActiveRoom = store?.get('rooms.active') === room.id;
    const typeInfo = ROOM_TYPE_INFO[room.type] || {};
    const roomName = room.name || typeInfo.label || this._formatRoomType(room.type);

    const item = h('div', {
      class: `room-item${isActiveRoom ? ' room-item-active' : ''}${agentsInRoom.length > 0 ? ' room-item-occupied' : ''}`,
      'data-room-id': room.id,
      tabindex: '0',
      role: 'button',
      'aria-label': `${roomName}, ${roomStatus}, ${agentsInRoom.length} agents`,
      ...(isActiveRoom ? { 'aria-current': 'true' } : {}),
    });

    // ── Single-line compact layout (#726): dot + name + agent count ──
    const row1 = h('div', { class: 'room-item-row1' });

    // Status dot (tiny colored circle, not a full badge)
    const statusDot = h('span', {
      class: `room-item-dot room-item-dot-${roomStatus}`,
      title: roomStatus,
    });

    // Room name
    const nameEl = h('span', { class: 'room-item-name', title: roomName }, roomName);

    // Agent count (compact — just the number if > 0)
    const countEl = agentsInRoom.length > 0
      ? h('span', { class: 'room-item-count' }, String(agentsInRoom.length))
      : null;

    row1.appendChild(statusDot);
    row1.appendChild(nameEl);
    if (countEl) row1.appendChild(countEl);
    item.appendChild(row1);

    // ── Last activity (if available) ──
    if (room.lastActivity) {
      const activity = h('div', { class: 'room-item-activity' },
        h('span', { class: 'room-item-activity-label' }, 'Last:'),
        h('span', { class: 'room-item-activity-time' }, formatTime(room.lastActivity))
      );
      item.appendChild(activity);
    }

    // ── Hover action buttons ──
    const actions = h('div', { class: 'room-item-actions' });
    const editBtn = h('button', { class: 'room-item-action-btn', title: 'Edit room' }, '\u270F\uFE0F');
    editBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._openEditRoomModal(room, floorId);
    });
    actions.appendChild(editBtn);

    const deleteBtn = h('button', { class: 'room-item-action-btn room-item-action-danger', title: 'Delete room' }, '\u{1F5D1}\uFE0F');
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._confirmDeleteRoom(room);
    });
    actions.appendChild(deleteBtn);
    item.appendChild(actions);

    // Click to select room
    item.addEventListener('click', (e) => {
      if (e.target.closest('.room-item-actions')) return;
      e.stopPropagation();
      const st = OverlordUI.getStore();
      if (st) {
        st.set('rooms.active', room.id);
      }
      OverlordUI.dispatch('building:room-selected', { roomId: room.id, floorId });
      this.render();
    });

    // Keyboard: Enter to select room, arrow keys to navigate
    item.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        item.click();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        // Find next .room-item sibling (skip non-room elements)
        let next = item.nextElementSibling;
        while (next && !next.classList.contains('room-item')) next = next.nextElementSibling;
        if (next) {
          /** @type {HTMLElement} */ (next).focus();
        } else {
          // Last room in floor — jump to next floor header
          const floorSection = item.closest('.floor-section');
          const nextFloor = floorSection?.nextElementSibling?.querySelector('.floor-section-header');
          if (nextFloor) /** @type {HTMLElement} */ (nextFloor).focus();
        }
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        // Find previous .room-item sibling
        let prev = item.previousElementSibling;
        while (prev && !prev.classList.contains('room-item')) prev = prev.previousElementSibling;
        if (prev) {
          /** @type {HTMLElement} */ (prev).focus();
        } else {
          // First room — focus back to floor header
          const floorSection = item.closest('.floor-section');
          const header = floorSection?.querySelector('.floor-section-header');
          if (header) /** @type {HTMLElement} */ (header).focus();
        }
      }
    });

    // Right-click context menu
    item.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this._showRoomContextMenu(e, room, floorId);
    });

    return item;
  }

  // ── Context Menus ──────────────────────────────────────

  _showFloorContextMenu(e, floor) {
    this._closeContextMenu();
    const menu = h('div', { class: 'ctx-menu' });
    menu.style.left = `${e.clientX}px`;
    menu.style.top = `${e.clientY}px`;

    const addRoom = h('button', { class: 'ctx-menu-item' }, '+ Add Room');
    addRoom.addEventListener('click', () => { this._closeContextMenu(); this._openAddRoomModal(floor); });
    menu.appendChild(addRoom);

    const editFloor = h('button', { class: 'ctx-menu-item' }, 'Edit Floor');
    editFloor.addEventListener('click', () => { this._closeContextMenu(); this._openEditFloorModal(floor); });
    menu.appendChild(editFloor);

    const deleteFloor = h('button', { class: 'ctx-menu-item ctx-menu-danger' }, 'Delete Floor');
    deleteFloor.addEventListener('click', () => { this._closeContextMenu(); this._confirmDeleteFloor(floor); });
    menu.appendChild(deleteFloor);

    document.body.appendChild(menu);
    // Close on click outside
    setTimeout(() => {
      const closer = (ev) => {
        if (!menu.contains(ev.target)) { this._closeContextMenu(); document.removeEventListener('click', closer); }
      };
      document.addEventListener('click', closer);
    }, 0);
  }

  _showRoomContextMenu(e, room, floorId) {
    this._closeContextMenu();
    const menu = h('div', { class: 'ctx-menu' });
    menu.style.left = `${e.clientX}px`;
    menu.style.top = `${e.clientY}px`;

    const editRoom = h('button', { class: 'ctx-menu-item' }, 'Edit Room');
    editRoom.addEventListener('click', () => { this._closeContextMenu(); this._openEditRoomModal(room, floorId); });
    menu.appendChild(editRoom);

    const deleteRoom = h('button', { class: 'ctx-menu-item ctx-menu-danger' }, 'Delete Room');
    deleteRoom.addEventListener('click', () => { this._closeContextMenu(); this._confirmDeleteRoom(room); });
    menu.appendChild(deleteRoom);

    document.body.appendChild(menu);
    setTimeout(() => {
      const closer = (ev) => {
        if (!menu.contains(ev.target)) { this._closeContextMenu(); document.removeEventListener('click', closer); }
      };
      document.addEventListener('click', closer);
    }, 0);
  }

  _closeContextMenu() {
    document.querySelectorAll('.ctx-menu').forEach(m => m.remove());
  }

  // ── Resize Handle ──────────────────────────────────────

  _initResizeHandle() {
    // Only add once
    if (this.el.parentElement?.querySelector('.sidebar-resize-handle')) return;

    const handle = h('div', { class: 'sidebar-resize-handle' });
    this.el.parentElement?.appendChild?.(handle); // Append to parent of building-panel

    // Actually, append as last child of building-panel itself
    // so it sits on the right edge
    handle.remove();
    this.el.appendChild(handle);

    let startX = 0;
    let startWidth = 0;

    const onMouseMove = (e) => {
      const newWidth = startWidth + (e.clientX - startX);
      const min = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--sidebar-min-width')) || 240;
      const max = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--sidebar-max-width')) || 480;
      const clamped = Math.max(min, Math.min(max, newWidth));
      this.el.style.width = `${clamped}px`;
    };

    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      handle.classList.remove('dragging');
    };

    handle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      startX = e.clientX;
      startWidth = this.el.getBoundingClientRect().width;
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      handle.classList.add('dragging');
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    });
  }

  // ── Inline Working Directory Edit (#539) ────────────────

  _showInlineWdEdit(pathRow, currentPath) {
    pathRow.textContent = '';
    const input = h('input', {
      class: 'form-input form-input-sm mono',
      type: 'text',
      value: currentPath,
      placeholder: '/path/to/project',
    });
    const saveBtn = h('button', { class: 'btn btn-primary btn-xs' }, 'Save');
    const cancelBtn = h('button', { class: 'btn btn-ghost btn-xs' }, 'Cancel');

    cancelBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.render();
    });

    saveBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const newPath = input.value.trim();
      if (!newPath || newPath === currentPath) { this.render(); return; }
      if (!window.overlordSocket) { Toast.error('Not connected'); return; }
      saveBtn.disabled = true;
      saveBtn.textContent = '...';
      try {
        const result = await window.overlordSocket.updateBuilding(this._buildingData.id, {
          workingDirectory: newPath,
        });
        if (result && result.ok) {
          Toast.success('Working directory updated');
          this._buildingData.working_directory = newPath;
        } else {
          throw new Error(result?.error?.message || 'Update failed');
        }
      } catch (err) {
        Toast.error(`Failed: ${err.message}`);
      }
      this.render();
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') saveBtn.click();
      if (e.key === 'Escape') cancelBtn.click();
    });

    pathRow.appendChild(input);
    pathRow.appendChild(saveBtn);
    pathRow.appendChild(cancelBtn);
    requestAnimationFrame(() => input.focus());
  }

  // ── Building Management Modal ────────────────────────────

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
          workingDirectory: workingDirectory.trim(),
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

  _openEditFloorModal(floor) {
    let floorName = floor.name || '';
    let isActive = floor.is_active !== 0;

    const container = h('div', { class: 'edit-floor-modal' });

    const nameGroup = h('div', { class: 'add-room-field' });
    nameGroup.appendChild(h('label', { class: 'form-label' }, 'Floor Name'));
    const nameInput = h('input', { class: 'form-input', type: 'text', value: floorName });
    nameInput.addEventListener('input', () => { floorName = nameInput.value; });
    nameGroup.appendChild(nameInput);
    container.appendChild(nameGroup);

    const typeGroup = h('div', { class: 'add-room-field' });
    typeGroup.appendChild(h('label', { class: 'form-label' }, 'Floor Type'));
    typeGroup.appendChild(h('div', { class: 'form-input-readonly' }, floor.type || 'default'));
    typeGroup.appendChild(h('span', { class: 'form-hint' }, 'Floor type cannot be changed — it defines the floor\'s purpose.'));
    container.appendChild(typeGroup);

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
      const actions = h('div', { class: 'add-room-actions' });
      const cancelBtn = h('button', { class: 'btn btn-ghost btn-md' }, 'OK');
      cancelBtn.addEventListener('click', () => Modal.close('confirm-delete-floor'));
      actions.appendChild(cancelBtn);
      container.appendChild(actions);

      Modal.open('confirm-delete-floor', {
        title: 'Cannot Delete Floor',
        content: container,
        size: 'sm',
        position: 'center',
      });
      return;
    }

    const actions = h('div', { class: 'add-room-actions' });
    const cancelBtn = h('button', { class: 'btn btn-ghost btn-md' }, 'Cancel');
    cancelBtn.addEventListener('click', () => Modal.close('confirm-delete-floor'));

    const deleteBtn = h('button', { class: 'btn btn-danger btn-md' }, 'Delete Floor');
    deleteBtn.addEventListener('click', async () => {
      if (!window.overlordSocket) { Toast.error('Not connected'); return; }
      deleteBtn.disabled = true;
      deleteBtn.textContent = 'Deleting...';
      try {
        const result = await window.overlordSocket.deleteFloor(floor.id);
        if (result && result.ok) {
          Toast.success('Floor deleted');
          Modal.close('confirm-delete-floor');
          this._expandedFloors.delete(floor.id);
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

    Modal.open('confirm-delete-floor', {
      title: 'Delete Floor',
      content: container,
      size: 'sm',
      position: 'center',
    });
  }

  // ── Room Management Modals ──────────────────────────────

  _openAddRoomModal(floor) {
    const floorType = floor.type || 'default';
    const existingTypes = new Set((floor.rooms || []).map(r => r.type));
    const suggested = (FLOOR_ROOM_SUGGESTIONS[floorType] || []).filter(t => !existingTypes.has(t));
    const allTypes = Object.entries(ROOM_TYPE_INFO);

    const sorted = [...allTypes].sort((a, b) => {
      const aS = suggested.includes(a[0]) ? 0 : 1;
      const bS = suggested.includes(b[0]) ? 0 : 1;
      return aS - bS;
    });

    let selectedType = suggested[0] || allTypes[0][0];
    let roomName = '';

    const container = h('div', { class: 'add-room-modal' });

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

    const nameGroup = h('div', { class: 'add-room-field' });
    nameGroup.appendChild(h('label', { class: 'form-label' }, 'Room Name (optional)'));
    const nameInput = h('input', { class: 'form-input', type: 'text', placeholder: 'e.g., "Frontend Code Lab"' });
    nameInput.addEventListener('input', () => { roomName = nameInput.value; });
    nameGroup.appendChild(nameInput);
    container.appendChild(nameGroup);

    container.appendChild(h('label', { class: 'form-label' }, 'Room Type'));
    const typeGrid = h('div', { class: 'add-room-type-grid' });

    for (const [typeKey, info] of sorted) {
      const isSuggested = suggested.includes(typeKey);
      const alreadyExists = existingTypes.has(typeKey);
      const card = h('div', {
        class: `add-room-type-card${selectedType === typeKey ? ' selected' : ''}${isSuggested ? ' suggested' : ''}${alreadyExists ? ' disabled' : ''}`,
        'data-type': typeKey,
        title: alreadyExists ? `${info.label} already exists on this floor` : info.desc,
      },
        h('div', { class: 'add-room-type-icon' }, info.icon),
        h('div', { class: 'add-room-type-info' },
          h('div', { class: 'add-room-type-label' },
            info.label,
            isSuggested ? h('span', { class: 'add-room-type-badge' }, 'Recommended') : null,
            alreadyExists ? h('span', { class: 'add-room-type-badge add-room-type-exists' }, 'Already added') : null,
          ),
          h('div', { class: 'add-room-type-desc' }, info.desc)
        )
      );

      if (!alreadyExists) {
        card.addEventListener('click', () => {
          selectedType = typeKey;
          typeGrid.querySelectorAll('.add-room-type-card').forEach(c => c.classList.remove('selected'));
          card.classList.add('selected');
        });
      }

      typeGrid.appendChild(card);
    }
    container.appendChild(typeGrid);

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

  _openEditRoomModal(room, floorId) {
    let roomName = room.name || '';
    let allowedTools = room.allowed_tools || room.allowedTools || [];
    let fileScope = room.file_scope || room.fileScope || 'assigned';
    let provider = room.provider || 'configurable';

    if (typeof allowedTools === 'string') {
      try { allowedTools = JSON.parse(allowedTools); } catch { allowedTools = []; }
    }

    const container = h('div', { class: 'edit-room-modal' });

    const nameGroup = h('div', { class: 'add-room-field' });
    nameGroup.appendChild(h('label', { class: 'form-label' }, 'Room Name'));
    const nameInput = h('input', { class: 'form-input', type: 'text', value: roomName });
    nameInput.addEventListener('input', () => { roomName = nameInput.value; });
    nameGroup.appendChild(nameInput);
    container.appendChild(nameGroup);

    const typeGroup = h('div', { class: 'add-room-field' });
    typeGroup.appendChild(h('label', { class: 'form-label' }, 'Room Type'));
    const typeInfo = ROOM_TYPE_INFO[room.type] || { icon: '\u2753', label: room.type, desc: '' };
    typeGroup.appendChild(h('div', { class: 'form-input-readonly' },
      h('span', null, `${typeInfo.icon} ${typeInfo.label}`)));
    typeGroup.appendChild(h('span', { class: 'form-hint' }, typeInfo.desc));
    container.appendChild(typeGroup);

    const scopeGroup = h('div', { class: 'add-room-field' });
    scopeGroup.appendChild(h('label', { class: 'form-label' }, tip('File Scope')));
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

    const providerGroup = h('div', { class: 'add-room-field' });
    providerGroup.appendChild(h('label', { class: 'form-label' }, tip('AI Provider')));
    const providerSelect = h('select', { class: 'form-input settings-select' });
    for (const prov of ['configurable', 'anthropic', 'minimax', 'openai', 'ollama']) {
      const opt = h('option', { value: prov }, prov.charAt(0).toUpperCase() + prov.slice(1));
      if (prov === provider) opt.selected = true;
      providerSelect.appendChild(opt);
    }
    providerSelect.addEventListener('change', () => { provider = providerSelect.value; });
    providerGroup.appendChild(providerSelect);
    container.appendChild(providerGroup);

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
    cancelBtn.addEventListener('click', () => Modal.close('confirm-delete-room'));

    const deleteBtn = h('button', { class: 'btn btn-danger btn-md' }, 'Delete Room');
    deleteBtn.addEventListener('click', async () => {
      if (!window.overlordSocket) { Toast.error('Not connected'); return; }
      deleteBtn.disabled = true;
      deleteBtn.textContent = 'Deleting...';
      try {
        const result = await window.overlordSocket.deleteRoom(room.id);
        if (result && result.ok) {
          Toast.success(`Room "${typeName}" deleted`);
          Modal.close('confirm-delete-room');
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

    Modal.open('confirm-delete-room', {
      title: 'Delete Room',
      content: container,
      size: 'sm',
      position: 'center',
    });
  }

  // ── Add Floor Modal ──────────────────────────────────────

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

    const nameGroup = h('div', { class: 'add-room-field' });
    nameGroup.appendChild(h('label', { class: 'form-label' }, 'Floor Name (optional)'));
    const nameInput = h('input', { class: 'form-input', type: 'text', placeholder: 'e.g., "Frontend Execution"' });
    nameInput.addEventListener('input', () => { floorName = nameInput.value; });
    nameGroup.appendChild(nameInput);
    container.appendChild(nameGroup);

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

  _getRoomStatus(agents) {
    if (agents.length === 0) return 'idle';
    const hasError = agents.some(a => a.status === 'error');
    if (hasError) return 'error';
    const hasActive = agents.some(a => a.status === 'active' || a.status === 'working');
    if (hasActive) return 'active';
    return 'idle';
  }

  _formatRoomType(type) {
    if (!type) return 'Room';
    return type.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  }

  _renderEmptyState() {
    const store = OverlordUI.getStore();
    const buildings = store?.get('building.list') || [];

    // Returning users (have buildings) — show summary, not getting started guide (#1016)
    if (buildings.length > 0) {
      const totalAgents = buildings.reduce((sum, b) => sum + (b.agent_count || b.agentCount || 0), 0);
      const container = h('div', { class: 'empty-state building-empty-state' },
        h('div', { class: 'empty-state-icon' }, '\u{1F3D7}\uFE0F'),
        h('h3', { class: 'empty-state-title' }, 'No Building Selected'),
        h('p', { class: 'empty-state-text' }, 'Click a project on the Dashboard to view its structure.'),
        h('div', { style: 'margin-top:var(--sp-3); display:flex; flex-direction:column; gap:var(--sp-1); font-size:0.85rem; color:var(--text-muted);' },
          h('div', null, `\u{1F4CA} ${buildings.length} projects`),
          h('div', null, `\u{1F916} ${totalAgents} agents across all projects`),
        )
      );
      return container;
    }

    // New users (no buildings) — show getting started guide
    const container = h('div', { class: 'empty-state building-empty-state' },
      h('div', { class: 'empty-state-icon' }, '\u{1F3D7}\uFE0F'),
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
    // Only count agents that belong to the current building (#686)
    const store = OverlordUI.getStore();
    const agentsList = store?.get('agents.list') || [];
    const buildingAgents = agentsList.length > 0 ? new Set(agentsList.map(a => a.id)) : null;
    return Object.entries(this._agentPositions)
      .filter(([id, a]) => (a.status === 'active' || a.status === 'working') && (!buildingAgents || buildingAgents.has(id)))
      .length;
  }

  _updateAgentIndicators() {
    // Lightweight update — just refresh agent dots and counts without full re-render
    // For the tree design, a full re-render is fast enough since items are lightweight
    this.render();
  }
}
