/**
 * Overlord v2 — Agents View (Full-Page)
 *
 * Replaces the cramped agents-panel sidebar with a proper full-width
 * dashboard page showing agent cards in a responsive grid.
 *
 * Features:
 *   - Header with title, agent count, and Create Agent button
 *   - Filter tabs (All / Active / Idle) with badge counts
 *   - Responsive card grid (3 cols wide, 2 medium, 1 narrow)
 *   - Agent cards with status indicator, name, role, room assignment
 *   - Quick-assign button for unassigned agents
 *   - Click card to open agent detail in Drawer
 *   - Create Agent modal with full form
 *   - Quick-assign modal (pick a room)
 *
 * Store keys:
 *   agents.list              — array of agent objects
 *   building.agentPositions  — { [agentId]: { status, roomId, ... } }
 *   rooms.list               — array of room objects
 *   building.active          — active building ID
 */

import { Component } from '../engine/component.js';
import { OverlordUI } from '../engine/engine.js';
import { h, formatTime } from '../engine/helpers.js';
import { Tabs } from '../components/tabs.js';
import { Toast } from '../components/toast.js';
import { Modal } from '../components/modal.js';
import { Drawer } from '../components/drawer.js';
import { EntityLink, resolveAgent, resolveRoom } from '../engine/entity-nav.js';


// ── Constants ────────────────────────────────────────────────────

const ROLES = [
  'strategist', 'analyst', 'architect', 'developer',
  'tester', 'reviewer', 'operator', 'lead'
];

const CAPABILITIES = [
  'chat', 'analysis', 'code-generation', 'code-review',
  'testing', 'deployment', 'documentation', 'planning'
];

const ROOM_TYPES = [
  'strategist', 'building-architect', 'discovery', 'architecture',
  'code-lab', 'testing-lab', 'review', 'deploy', 'war-room',
  'data-exchange', 'provider-hub', 'plugin-bay'
];

const STATUS_CONFIG = {
  active:  { color: 'var(--status-active)',  label: 'Active',  dot: 'agents-view-status-active'  },
  working: { color: 'var(--status-active)',  label: 'Working', dot: 'agents-view-status-active'  },
  paused:  { color: 'var(--status-busy)',    label: 'Paused',  dot: 'agents-view-status-paused'  },
  idle:    { color: 'var(--status-idle)',     label: 'Idle',    dot: 'agents-view-status-idle'    },
  error:   { color: 'var(--status-error)',    label: 'Error',   dot: 'agents-view-status-error'   },
};


export class AgentsView extends Component {

  constructor(el) {
    super(el);
    this._agents = [];
    this._agentPositions = {};
    this._rooms = [];
    this._filter = 'all';
    this._tabs = null;
  }

  // ── Lifecycle ────────────────────────────────────────────────

  mount() {
    this._mounted = true;
    const store = OverlordUI.getStore();
    if (!store) return;

    // Subscribe to agent list updates
    this.subscribe(store, 'agents.list', (agents) => {
      this._agents = agents || [];
      this._render();
    });

    // Subscribe to agent position/status updates
    this.subscribe(store, 'building.agentPositions', (positions) => {
      this._agentPositions = positions || {};
      this._render();
    });

    // Subscribe to room list (for room name resolution and quick-assign)
    this.subscribe(store, 'rooms.list', (rooms) => {
      this._rooms = rooms || [];
      this._render();
    });

    // Listen for real-time agent events
    this._listeners.push(
      OverlordUI.subscribe('agent:registered', () => this._fetchAgents()),
      OverlordUI.subscribe('agent:moved', () => this._fetchAgents()),
      OverlordUI.subscribe('agent:updated', () => this._fetchAgents())
    );

    // Initialize from current store state
    this._agents = store.get('agents.list') || [];
    this._agentPositions = store.get('building.agentPositions') || {};
    this._rooms = store.get('rooms.list') || [];

    this._render();
    this._fetchAgents();
  }

  destroy() {
    this._tabs = null;
    super.destroy();
  }

  // ── Data ─────────────────────────────────────────────────────

  /** Fetch agents from the server. */
  _fetchAgents() {
    if (window.overlordSocket) {
      window.overlordSocket.fetchAgents({});
    }
  }

  /** Get resolved status for an agent (merges positions overlay). */
  _resolveStatus(agent) {
    const position = this._agentPositions[agent.id];
    return position?.status || agent.status || 'idle';
  }

  /** Get resolved room ID for an agent. */
  _resolveRoomId(agent) {
    const position = this._agentPositions[agent.id];
    return agent.current_room_id || position?.roomId || null;
  }

  /** Build a room name lookup map. */
  _buildRoomNameMap() {
    const map = {};
    for (const room of this._rooms) {
      map[room.id] = room.name || this._formatRoomType(room.type);
    }
    return map;
  }

  /** Format a room type slug into a display name. */
  _formatRoomType(type) {
    if (!type) return 'Room';
    return type.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  }

  // ── Filtering ────────────────────────────────────────────────

  /** Get agents matching a status filter. */
  _getAgentsByStatus(status) {
    return this._agents.filter(a => {
      const agentStatus = this._resolveStatus(a);
      if (status === 'active') return agentStatus === 'active' || agentStatus === 'working';
      if (status === 'idle') return agentStatus === 'idle' || !agentStatus;
      return true;
    });
  }

  /** Get the filtered agent list based on current filter. */
  _getFilteredAgents() {
    if (this._filter === 'all') return this._agents;
    return this._getAgentsByStatus(this._filter);
  }

  // ── Main Render ──────────────────────────────────────────────

  _render() {
    this.el.textContent = '';
    this.el.className = 'agents-view';

    // Inject scoped styles on first render
    this._injectStyles();

    // ── Header row ──
    const header = h('div', { class: 'agents-view-header' },
      h('div', { class: 'agents-view-title-group' },
        h('h2', { class: 'agents-view-title' }, 'Agents'),
        h('span', { class: 'agents-view-count' }, `${this._agents.length} registered`)
      ),
      h('div', { class: 'agents-view-actions' })
    );

    const createBtn = h('button', { class: 'btn btn-primary btn-md' }, '+ Create Agent');
    createBtn.addEventListener('click', () => this._openCreateAgentModal());
    header.querySelector('.agents-view-actions').appendChild(createBtn);

    // Add refresh button
    const refreshBtn = h('button', {
      class: 'btn btn-ghost btn-md',
      title: 'Refresh agent list'
    }, '\u21BB Refresh');
    refreshBtn.addEventListener('click', () => {
      this._fetchAgents();
      Toast.info('Refreshing agents...');
    });
    header.querySelector('.agents-view-actions').appendChild(refreshBtn);

    this.el.appendChild(header);

    // ── Filter tabs ──
    const tabContainer = h('div', { class: 'agents-view-tabs' });
    this._tabs = new Tabs(tabContainer, {
      items: [
        { id: 'all',    label: 'All',    badge: String(this._agents.length) },
        { id: 'active', label: 'Active', badge: String(this._getAgentsByStatus('active').length) },
        { id: 'idle',   label: 'Idle',   badge: String(this._getAgentsByStatus('idle').length) }
      ],
      activeId: this._filter,
      style: 'pills',
      onChange: (id) => {
        this._filter = id;
        this._render();
      }
    });
    this._tabs.mount();
    this.el.appendChild(tabContainer);

    // ── Agent grid ──
    const filtered = this._getFilteredAgents();

    if (filtered.length === 0) {
      this.el.appendChild(this._buildEmptyState());
      return;
    }

    const roomNameMap = this._buildRoomNameMap();
    const grid = h('div', { class: 'agents-view-grid' });

    for (const agent of filtered) {
      grid.appendChild(this._renderAgentCard(agent, roomNameMap));
    }

    this.el.appendChild(grid);
  }

  /** Build the empty state placeholder. */
  _buildEmptyState() {
    const isEmpty = this._agents.length === 0;
    const emptyContainer = h('div', { class: 'agents-view-empty' },
      h('div', { class: 'agents-view-empty-icon' }, '\uD83E\uDD16'),
      h('div', { class: 'agents-view-empty-title' },
        isEmpty ? 'No Agents Registered' : `No ${this._filter} agents`
      ),
      h('div', { class: 'agents-view-empty-text' },
        isEmpty
          ? 'Create your first agent to start building your team.'
          : 'Try changing the filter to see agents with a different status.'
      )
    );

    if (isEmpty) {
      const createBtn = h('button', { class: 'btn btn-primary btn-md' }, '+ Create Agent');
      createBtn.addEventListener('click', () => this._openCreateAgentModal());
      emptyContainer.appendChild(createBtn);
    }

    return emptyContainer;
  }

  // ── Agent Card ───────────────────────────────────────────────

  _renderAgentCard(agent, roomNameMap) {
    const status = this._resolveStatus(agent);
    const roomId = this._resolveRoomId(agent);
    const roomName = roomId ? (roomNameMap[roomId] || 'Room') : null;
    const statusCfg = STATUS_CONFIG[status] || STATUS_CONFIG.idle;

    const capabilities = this._parseArray(agent.capabilities);
    const roomAccess = this._parseArray(agent.room_access);

    // ── Card wrapper ──
    const card = h('div', {
      class: `agents-view-card agents-view-card-${status}`,
      'data-agent-id': agent.id,
      role: 'button',
      tabindex: '0',
      'aria-label': `Agent: ${agent.name || agent.id}`
    });

    // ── Status border accent (top border colored by status) ──
    card.style.borderTopColor = statusCfg.color;

    // ── Card header row ──
    const cardHeader = h('div', { class: 'agents-view-card-header' });

    // Avatar circle
    const avatarLetter = (agent.name || '?')[0].toUpperCase();
    const avatar = h('div', {
      class: 'agents-view-card-avatar',
      style: { borderColor: statusCfg.color }
    }, avatarLetter);
    cardHeader.appendChild(avatar);

    // Status dot (overlaid on avatar)
    const statusDot = h('div', {
      class: `agents-view-status-dot ${statusCfg.dot}`,
      title: statusCfg.label
    });
    cardHeader.appendChild(statusDot);

    // Name and role
    const nameGroup = h('div', { class: 'agents-view-card-name-group' },
      h('div', { class: 'agents-view-card-name' }, agent.name || agent.id),
      h('div', { class: 'agents-view-card-role' },
        h('span', { class: 'agents-view-role-badge' }, agent.role || 'agent')
      )
    );
    cardHeader.appendChild(nameGroup);

    // Status label
    const statusLabel = h('span', {
      class: `agents-view-status-label agents-view-status-label-${status}`
    }, statusCfg.label);
    cardHeader.appendChild(statusLabel);

    card.appendChild(cardHeader);

    // ── Room assignment row ──
    const roomRow = h('div', { class: 'agents-view-card-room' });
    if (roomId && roomName) {
      const roomIcon = h('span', { class: 'agents-view-room-icon' }, '\uD83C\uDFE0');
      roomRow.appendChild(roomIcon);
      const roomLink = EntityLink.room(roomId, roomName);
      roomLink.classList.add('agents-view-room-link');
      roomRow.appendChild(roomLink);
    } else {
      roomRow.classList.add('agents-view-card-room-unassigned');
      roomRow.appendChild(h('span', { class: 'agents-view-unassigned-icon' }, '\u26A0'));
      roomRow.appendChild(h('span', { class: 'agents-view-unassigned-text' }, 'Unassigned'));

      // Quick-assign button
      const assignBtn = h('button', {
        class: 'btn btn-ghost btn-xs agents-view-assign-btn',
        title: 'Assign to a room'
      }, 'Assign');
      assignBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._openQuickAssignModal(agent);
      });
      roomRow.appendChild(assignBtn);
    }
    card.appendChild(roomRow);

    // ── Capabilities tags ──
    if (capabilities.length > 0) {
      const capRow = h('div', { class: 'agents-view-card-caps' });
      const maxVisible = 4;
      const visibleCaps = capabilities.slice(0, maxVisible);
      for (const cap of visibleCaps) {
        capRow.appendChild(h('span', { class: 'agents-view-cap-tag' }, cap));
      }
      if (capabilities.length > maxVisible) {
        capRow.appendChild(h('span', {
          class: 'agents-view-cap-tag agents-view-cap-more'
        }, `+${capabilities.length - maxVisible}`));
      }
      card.appendChild(capRow);
    }

    // ── Card footer with ID ──
    const footer = h('div', { class: 'agents-view-card-footer' },
      h('span', { class: 'agents-view-card-id' }, `ID: ${agent.id.slice(0, 12)}...`)
    );
    if (agent.created_at) {
      footer.appendChild(
        h('span', { class: 'agents-view-card-time' }, formatTime(agent.created_at))
      );
    }
    card.appendChild(footer);

    // ── Click handler -> open detail drawer ──
    card.addEventListener('click', () => this._openAgentDetail(agent));
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        this._openAgentDetail(agent);
      }
    });

    return card;
  }

  /** Parse capabilities/room_access which may be string or array. */
  _parseArray(value) {
    if (!value) return [];
    if (Array.isArray(value)) return value;
    if (typeof value === 'string') {
      try { return JSON.parse(value); }
      catch { return []; }
    }
    return [];
  }

  // ── Agent Detail (Drawer) ────────────────────────────────────

  _openAgentDetail(agent) {
    const status = this._resolveStatus(agent);
    const roomId = this._resolveRoomId(agent);
    const roomNameMap = this._buildRoomNameMap();
    const roomName = roomId ? (roomNameMap[roomId] || 'Room') : null;
    const statusCfg = STATUS_CONFIG[status] || STATUS_CONFIG.idle;
    const capabilities = this._parseArray(agent.capabilities);
    const roomAccess = this._parseArray(agent.room_access);

    const content = h('div', { class: 'agents-view-detail' });

    // ── Avatar + Identity Header ──
    const detailHeader = h('div', { class: 'agents-view-detail-header' });

    const avatarLetter = (agent.name || '?')[0].toUpperCase();
    const detailAvatar = h('div', {
      class: 'agents-view-detail-avatar',
      style: { borderColor: statusCfg.color, color: statusCfg.color }
    }, avatarLetter);
    detailHeader.appendChild(detailAvatar);

    const identityGroup = h('div', { class: 'agents-view-detail-identity' },
      h('h3', { class: 'agents-view-detail-name' }, agent.name || agent.id),
      h('div', { class: 'agents-view-detail-meta' },
        h('span', { class: 'agents-view-role-badge' }, agent.role || 'agent'),
        h('span', {
          class: `agents-view-status-label agents-view-status-label-${status}`,
          style: { marginLeft: 'var(--sp-2)' }
        }, statusCfg.label)
      )
    );
    detailHeader.appendChild(identityGroup);
    content.appendChild(detailHeader);

    // ── Current Room Assignment ──
    const roomSection = h('div', { class: 'agents-view-detail-section' });
    roomSection.appendChild(h('h4', { class: 'agents-view-detail-section-title' }, 'Current Assignment'));

    if (roomId && roomName) {
      const roomRow = h('div', { class: 'agents-view-detail-row' },
        h('span', { class: 'agents-view-detail-label' }, 'Room:'),
        EntityLink.room(roomId, roomName)
      );
      roomSection.appendChild(roomRow);

      // View Room action
      const viewRoomBtn = h('button', {
        class: 'btn btn-ghost btn-sm',
        style: { marginTop: 'var(--sp-2)' }
      }, 'View Room');
      viewRoomBtn.addEventListener('click', () => {
        Drawer.close();
        OverlordUI.dispatch('navigate:entity', { type: 'room', id: roomId });
      });
      roomSection.appendChild(viewRoomBtn);
    } else {
      roomSection.appendChild(h('div', { class: 'agents-view-detail-unassigned' },
        h('span', null, 'Not assigned to any room')
      ));

      // Assign to Room action
      const assignBtn = h('button', {
        class: 'btn btn-primary btn-sm',
        style: { marginTop: 'var(--sp-2)' }
      }, 'Assign to Room');
      assignBtn.addEventListener('click', () => {
        Drawer.close();
        this._openQuickAssignModal(agent);
      });
      roomSection.appendChild(assignBtn);
    }
    content.appendChild(roomSection);

    // ── Capabilities ──
    if (capabilities.length > 0) {
      const capSection = h('div', { class: 'agents-view-detail-section' });
      capSection.appendChild(h('h4', { class: 'agents-view-detail-section-title' }, 'Capabilities'));
      const capGrid = h('div', { class: 'agents-view-detail-cap-grid' });
      for (const cap of capabilities) {
        capGrid.appendChild(h('span', { class: 'agents-view-detail-cap-tag' }, cap));
      }
      capSection.appendChild(capGrid);
      content.appendChild(capSection);
    }

    // ── Room Access ──
    if (roomAccess.length > 0) {
      const accessSection = h('div', { class: 'agents-view-detail-section' });
      accessSection.appendChild(h('h4', { class: 'agents-view-detail-section-title' }, 'Room Access'));
      const accessGrid = h('div', { class: 'agents-view-detail-cap-grid' });
      for (const access of roomAccess) {
        const displayName = access === '*' ? 'All rooms' : this._formatRoomType(access);
        accessGrid.appendChild(h('span', { class: 'agents-view-detail-cap-tag' }, displayName));
      }
      accessSection.appendChild(accessGrid);
      content.appendChild(accessSection);
    }

    // ── Details (ID, timestamps) ──
    const infoSection = h('div', { class: 'agents-view-detail-section' });
    infoSection.appendChild(h('h4', { class: 'agents-view-detail-section-title' }, 'Details'));

    const infoRows = [
      ['ID', agent.id],
      ['Status', statusCfg.label],
      ['Role', agent.role || 'agent'],
      ['Created', agent.created_at ? new Date(agent.created_at).toLocaleString() : '\u2014'],
      ['Updated', agent.updated_at ? new Date(agent.updated_at).toLocaleString() : '\u2014'],
    ];

    for (const [label, value] of infoRows) {
      infoSection.appendChild(h('div', { class: 'agents-view-detail-row' },
        h('span', { class: 'agents-view-detail-label' }, label),
        h('span', null, value)
      ));
    }
    content.appendChild(infoSection);

    // ── Actions bar ──
    const actionsBar = h('div', { class: 'agents-view-detail-actions' });

    if (!roomId) {
      const assignAction = h('button', { class: 'btn btn-primary btn-md' }, 'Assign to Room');
      assignAction.addEventListener('click', () => {
        Drawer.close();
        this._openQuickAssignModal(agent);
      });
      actionsBar.appendChild(assignAction);
    } else {
      const viewRoomAction = h('button', { class: 'btn btn-primary btn-md' }, 'View Room');
      viewRoomAction.addEventListener('click', () => {
        Drawer.close();
        OverlordUI.dispatch('navigate:entity', { type: 'room', id: roomId });
      });
      actionsBar.appendChild(viewRoomAction);
    }

    const viewProfileAction = h('button', { class: 'btn btn-ghost btn-md' }, 'Full Profile');
    viewProfileAction.addEventListener('click', () => {
      Drawer.close();
      OverlordUI.dispatch('navigate:entity', { type: 'agent', id: agent.id });
    });
    actionsBar.appendChild(viewProfileAction);

    content.appendChild(actionsBar);

    // ── Open the Drawer ──
    Drawer.open('agent-detail', {
      title: `Agent: ${agent.name || agent.id}`,
      width: '480px',
      content
    });
  }

  // ── Create Agent Modal ───────────────────────────────────────

  _openCreateAgentModal() {
    const formData = {
      name: '',
      role: 'developer',
      capabilities: ['chat'],
      roomAccess: ['*']
    };

    const container = h('div', { class: 'agent-create-form' });

    // ── Name field ──
    const nameGroup = h('div', { class: 'agent-create-field' });
    nameGroup.appendChild(h('label', { class: 'agent-create-label' }, 'Agent Name'));
    const nameInput = h('input', {
      class: 'form-input',
      type: 'text',
      placeholder: 'e.g., Frontend Developer, QA Lead...',
    });
    nameInput.addEventListener('input', () => { formData.name = nameInput.value; });
    nameGroup.appendChild(nameInput);
    container.appendChild(nameGroup);

    // ── Role select ──
    const roleGroup = h('div', { class: 'agent-create-field' });
    roleGroup.appendChild(h('label', { class: 'agent-create-label' }, 'Role'));
    const roleSelect = h('select', { class: 'form-input' });
    for (const role of ROLES) {
      const opt = h('option', { value: role }, role.charAt(0).toUpperCase() + role.slice(1));
      if (role === formData.role) opt.selected = true;
      roleSelect.appendChild(opt);
    }
    roleSelect.addEventListener('change', () => { formData.role = roleSelect.value; });
    roleGroup.appendChild(roleSelect);
    container.appendChild(roleGroup);

    // ── Capabilities checkboxes ──
    const capGroup = h('div', { class: 'agent-create-field' });
    capGroup.appendChild(h('label', { class: 'agent-create-label' }, 'Capabilities'));
    const capGrid = h('div', { class: 'agent-create-cap-grid' });
    for (const cap of CAPABILITIES) {
      const label = h('label', { class: 'agent-create-cap-label' });
      const checkbox = h('input', { type: 'checkbox', value: cap });
      if (formData.capabilities.includes(cap)) checkbox.checked = true;
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) {
          if (!formData.capabilities.includes(cap)) formData.capabilities.push(cap);
        } else {
          formData.capabilities = formData.capabilities.filter(c => c !== cap);
        }
      });
      label.appendChild(checkbox);
      label.appendChild(h('span', null, ` ${cap}`));
      capGrid.appendChild(label);
    }
    capGroup.appendChild(capGrid);
    container.appendChild(capGroup);

    // ── Room access ──
    const roomGroup = h('div', { class: 'agent-create-field' });
    roomGroup.appendChild(h('label', { class: 'agent-create-label' }, 'Room Access'));
    roomGroup.appendChild(h('p', { class: 'agent-create-hint' },
      'Select which room types this agent can enter. Use * for all rooms.'));
    const roomGrid = h('div', { class: 'agent-create-cap-grid' });

    // Wildcard option
    const wildcardLabel = h('label', { class: 'agent-create-cap-label' });
    const wildcardCb = h('input', { type: 'checkbox', value: '*' });
    wildcardCb.checked = formData.roomAccess.includes('*');
    wildcardCb.addEventListener('change', () => {
      if (wildcardCb.checked) {
        formData.roomAccess = ['*'];
        roomGrid.querySelectorAll('input[type="checkbox"]').forEach(cb => {
          if (cb.value !== '*') { cb.checked = false; cb.disabled = true; }
        });
      } else {
        formData.roomAccess = [];
        roomGrid.querySelectorAll('input[type="checkbox"]').forEach(cb => { cb.disabled = false; });
      }
    });
    wildcardLabel.appendChild(wildcardCb);
    wildcardLabel.appendChild(h('span', { style: { fontWeight: 'var(--font-semibold)' } }, ' * (All rooms)'));
    roomGrid.appendChild(wildcardLabel);

    for (const roomType of ROOM_TYPES) {
      const label = h('label', { class: 'agent-create-cap-label' });
      const checkbox = h('input', { type: 'checkbox', value: roomType });
      if (formData.roomAccess.includes('*')) checkbox.disabled = true;
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) {
          if (!formData.roomAccess.includes(roomType)) formData.roomAccess.push(roomType);
        } else {
          formData.roomAccess = formData.roomAccess.filter(r => r !== roomType);
        }
      });
      const displayName = roomType.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
      label.appendChild(checkbox);
      label.appendChild(h('span', null, ` ${displayName}`));
      roomGrid.appendChild(label);
    }
    roomGroup.appendChild(roomGrid);
    container.appendChild(roomGroup);

    // ── Action buttons ──
    const actions = h('div', { class: 'agent-create-actions' });
    const cancelBtn = h('button', { class: 'btn btn-ghost btn-md' }, 'Cancel');
    cancelBtn.addEventListener('click', () => Modal.close('agent-create'));
    const submitBtn = h('button', { class: 'btn btn-primary btn-md' }, 'Create Agent');
    submitBtn.addEventListener('click', () => this._submitCreateAgent(formData, submitBtn));
    actions.appendChild(cancelBtn);
    actions.appendChild(submitBtn);
    container.appendChild(actions);

    Modal.open('agent-create', {
      title: 'Create New Agent',
      content: container,
      size: 'md',
      position: window.innerWidth < 768 ? 'fullscreen' : 'center',
    });

    // Auto-focus the name input after modal opens
    requestAnimationFrame(() => nameInput.focus());
  }

  /** Submit the create agent form. */
  async _submitCreateAgent(formData, submitBtn) {
    if (!formData.name.trim()) {
      Toast.warning('Please enter an agent name.');
      return;
    }

    if (!window.overlordSocket) {
      Toast.error('Socket not connected.');
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Creating...';

    try {
      const store = OverlordUI.getStore();
      const buildingId = store?.get('building.active');

      const result = await window.overlordSocket.registerAgent({
        name: formData.name.trim(),
        role: formData.role,
        capabilities: formData.capabilities,
        roomAccess: formData.roomAccess,
        buildingId: buildingId || undefined,
      });

      if (result && result.ok) {
        Toast.success(`Agent "${formData.name}" created successfully`);
        Modal.close('agent-create');
        this._fetchAgents();
      } else {
        throw new Error(result?.error?.message || 'Failed to create agent');
      }
    } catch (err) {
      Toast.error(`Create failed: ${err.message}`);
      submitBtn.disabled = false;
      submitBtn.textContent = 'Create Agent';
    }
  }

  // ── Quick-Assign Modal ───────────────────────────────────────

  _openQuickAssignModal(agent) {
    if (this._rooms.length === 0) {
      Toast.warning('No rooms available. Create a room in the building first.');
      return;
    }

    let selectedRoom = null;
    const container = h('div', { class: 'assign-agent-modal' });

    // Guidance text
    container.appendChild(h('div', { class: 'assign-agent-guidance' },
      h('p', null, 'Select a room for '),
      h('strong', null, agent.name || agent.id),
      h('span', null, ` (${agent.role || 'agent'}).`),
    ));

    container.appendChild(h('label', { class: 'form-label' }, 'Available Rooms'));
    const roomList = h('div', { class: 'assign-agent-list' });

    for (const room of this._rooms) {
      const roomName = room.name || this._formatRoomType(room.type);
      const card = h('div', {
        class: `assign-agent-card${selectedRoom === room.id ? ' selected' : ''}`,
        'data-room-id': room.id
      },
        h('div', { class: 'assign-agent-avatar' }, (roomName || '?')[0].toUpperCase()),
        h('div', { class: 'assign-agent-info' },
          h('div', { class: 'assign-agent-name' }, roomName),
          h('div', { class: 'assign-agent-role text-muted' }, room.type || '')
        )
      );

      card.addEventListener('click', () => {
        selectedRoom = room.id;
        roomList.querySelectorAll('.assign-agent-card').forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
      });

      roomList.appendChild(card);
    }
    container.appendChild(roomList);

    // Action buttons
    const actions = h('div', { class: 'assign-agent-actions' });
    const cancelBtn = h('button', { class: 'btn btn-ghost btn-md' }, 'Cancel');
    cancelBtn.addEventListener('click', () => Modal.close('quick-assign'));

    const assignBtn = h('button', { class: 'btn btn-primary btn-md' }, 'Assign');
    assignBtn.addEventListener('click', async () => {
      if (!selectedRoom) {
        Toast.warning('Please select a room');
        return;
      }
      if (!window.overlordSocket) {
        Toast.error('Not connected');
        return;
      }

      assignBtn.disabled = true;
      assignBtn.textContent = 'Assigning...';

      try {
        const result = await window.overlordSocket.moveAgent(agent.id, selectedRoom);
        if (result && result.ok) {
          Toast.success(`${agent.name || 'Agent'} assigned to room`);
          Modal.close('quick-assign');
          this._fetchAgents();
        } else {
          throw new Error(result?.error?.message || 'Assignment failed');
        }
      } catch (err) {
        Toast.error(`Assign failed: ${err.message}`);
        assignBtn.disabled = false;
        assignBtn.textContent = 'Assign';
      }
    });

    actions.appendChild(cancelBtn);
    actions.appendChild(assignBtn);
    container.appendChild(actions);

    Modal.open('quick-assign', {
      title: `Assign ${agent.name || 'Agent'} to Room`,
      content: container,
      size: 'md',
      position: window.innerWidth < 768 ? 'fullscreen' : 'center',
    });
  }

  // ── Scoped Styles ────────────────────────────────────────────

  _injectStyles() {
    if (document.getElementById('agents-view-styles')) return;

    const style = document.createElement('style');
    style.id = 'agents-view-styles';
    style.textContent = `
/* ═══════════════════════════════════════════════════
   AGENTS VIEW — Full-Page Dashboard Styles
   ═══════════════════════════════════════════════════ */

/* ── Layout ── */
.agents-view {
  padding: var(--sp-6);
  overflow-y: auto;
  height: 100%;
  background: var(--bg-primary);
}

/* ── Header ── */
.agents-view-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--sp-5);
  flex-wrap: wrap;
  gap: var(--sp-3);
}
.agents-view-title-group {
  display: flex;
  align-items: baseline;
  gap: var(--sp-3);
}
.agents-view-title {
  font-size: var(--text-2xl);
  font-weight: var(--font-bold);
  color: var(--text-primary);
  margin: 0;
}
.agents-view-count {
  font-size: var(--text-sm);
  color: var(--text-muted);
  font-weight: var(--font-medium);
}
.agents-view-actions {
  display: flex;
  gap: var(--sp-2);
  align-items: center;
}

/* ── Filter Tabs ── */
.agents-view-tabs {
  margin-bottom: var(--sp-5);
}

/* ── Card Grid ── */
.agents-view-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: var(--sp-4);
}

/* ── Agent Card ── */
.agents-view-card {
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-top: 3px solid var(--status-idle);
  border-radius: var(--radius-lg);
  backdrop-filter: blur(var(--glass-blur));
  -webkit-backdrop-filter: blur(var(--glass-blur));
  padding: var(--sp-5);
  cursor: pointer;
  transition: all var(--duration-fast) var(--ease-default);
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
  position: relative;
  outline: none;
}
.agents-view-card:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-md);
  border-color: var(--border-accent);
}
.agents-view-card:focus-visible {
  box-shadow: 0 0 0 2px var(--accent-blue);
}
.agents-view-card-active,
.agents-view-card-working {
  border-top-color: var(--status-active);
}
.agents-view-card-paused {
  border-top-color: var(--status-busy);
}
.agents-view-card-idle {
  border-top-color: var(--status-idle);
}
.agents-view-card-error {
  border-top-color: var(--status-error);
}

/* ── Card Header ── */
.agents-view-card-header {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  position: relative;
}

/* Avatar */
.agents-view-card-avatar {
  width: 48px;
  height: 48px;
  border-radius: var(--radius-full);
  background: var(--bg-tertiary);
  border: 2px solid var(--status-idle);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: var(--text-xl);
  font-weight: var(--font-bold);
  color: var(--text-primary);
  flex-shrink: 0;
  position: relative;
}

/* Status dot (bottom-right of avatar) */
.agents-view-status-dot {
  width: 14px;
  height: 14px;
  border-radius: var(--radius-full);
  border: 2px solid var(--bg-primary);
  position: absolute;
  top: 38px;
  left: 38px;
  z-index: 1;
}
.agents-view-status-active {
  background: var(--status-active);
}
.agents-view-status-paused {
  background: var(--status-busy);
}
.agents-view-status-idle {
  background: var(--status-idle);
}
.agents-view-status-error {
  background: var(--status-error);
}

/* Name group */
.agents-view-card-name-group {
  flex: 1;
  min-width: 0;
}
.agents-view-card-name {
  font-size: var(--text-lg);
  font-weight: var(--font-semibold);
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.agents-view-card-role {
  margin-top: var(--sp-1);
}

/* Role badge */
.agents-view-role-badge {
  display: inline-block;
  padding: 2px var(--sp-2);
  border-radius: var(--radius-full);
  font-size: var(--text-xs);
  font-weight: var(--font-medium);
  background: var(--bg-active);
  color: var(--text-secondary);
  text-transform: capitalize;
}

/* Status label */
.agents-view-status-label {
  font-size: var(--text-xs);
  font-weight: var(--font-semibold);
  padding: 2px var(--sp-2);
  border-radius: var(--radius-full);
  text-transform: capitalize;
  flex-shrink: 0;
}
.agents-view-status-label-active,
.agents-view-status-label-working {
  color: var(--status-active);
  background: rgba(74, 222, 128, 0.1);
}
.agents-view-status-label-paused {
  color: var(--status-busy);
  background: rgba(251, 191, 36, 0.1);
}
.agents-view-status-label-idle {
  color: var(--status-idle);
  background: rgba(100, 116, 139, 0.1);
}
.agents-view-status-label-error {
  color: var(--status-error);
  background: rgba(248, 113, 113, 0.1);
}

/* ── Room Assignment Row ── */
.agents-view-card-room {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  padding: var(--sp-2) var(--sp-3);
  border-radius: var(--radius-md);
  background: var(--bg-hover);
  font-size: var(--text-sm);
  min-height: 36px;
}
.agents-view-room-icon {
  font-size: var(--text-base);
  flex-shrink: 0;
}
.agents-view-room-link {
  color: var(--text-accent);
  font-weight: var(--font-medium);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.agents-view-card-room-unassigned {
  background: rgba(248, 113, 113, 0.06);
  border: 1px dashed rgba(248, 113, 113, 0.3);
}
.agents-view-unassigned-icon {
  color: var(--accent-yellow);
  font-size: var(--text-base);
  flex-shrink: 0;
}
.agents-view-unassigned-text {
  color: var(--text-muted);
  font-style: italic;
  flex: 1;
}
.agents-view-assign-btn {
  margin-left: auto;
  flex-shrink: 0;
}

/* ── Capability Tags ── */
.agents-view-card-caps {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sp-1);
}
.agents-view-cap-tag {
  display: inline-block;
  padding: 1px var(--sp-2);
  border-radius: var(--radius-full);
  font-size: 0.6875rem;
  font-weight: var(--font-medium);
  background: var(--bg-tertiary);
  color: var(--text-muted);
  border: 1px solid var(--border-secondary);
  white-space: nowrap;
}
.agents-view-cap-more {
  background: var(--bg-active);
  color: var(--text-secondary);
  font-weight: var(--font-semibold);
}

/* ── Card Footer ── */
.agents-view-card-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-top: var(--sp-2);
  border-top: 1px solid var(--border-secondary);
  font-size: var(--text-xs);
  color: var(--text-muted);
}
.agents-view-card-id {
  font-family: var(--font-mono);
  opacity: 0.7;
}
.agents-view-card-time {
  font-size: var(--text-xs);
}

/* ── Empty State ── */
.agents-view-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: var(--sp-16) var(--sp-6);
  text-align: center;
  gap: var(--sp-3);
}
.agents-view-empty-icon {
  font-size: 3rem;
  opacity: 0.4;
}
.agents-view-empty-title {
  font-size: var(--text-xl);
  font-weight: var(--font-semibold);
  color: var(--text-primary);
}
.agents-view-empty-text {
  font-size: var(--text-sm);
  color: var(--text-muted);
  max-width: 400px;
  line-height: var(--leading-normal);
}

/* ══════════════════════════════════════════════════
   AGENTS VIEW — Drawer Detail Styles
   ══════════════════════════════════════════════════ */

.agents-view-detail {
  display: flex;
  flex-direction: column;
  gap: var(--sp-5);
}

/* Detail header */
.agents-view-detail-header {
  display: flex;
  align-items: center;
  gap: var(--sp-4);
  padding-bottom: var(--sp-4);
  border-bottom: 1px solid var(--border-secondary);
}
.agents-view-detail-avatar {
  width: 64px;
  height: 64px;
  border-radius: var(--radius-full);
  background: var(--bg-tertiary);
  border: 3px solid var(--status-idle);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: var(--text-3xl);
  font-weight: var(--font-bold);
  flex-shrink: 0;
}
.agents-view-detail-identity {
  flex: 1;
  min-width: 0;
}
.agents-view-detail-name {
  font-size: var(--text-xl);
  font-weight: var(--font-bold);
  color: var(--text-primary);
  margin: 0 0 var(--sp-1) 0;
}
.agents-view-detail-meta {
  display: flex;
  align-items: center;
  gap: var(--sp-1);
  flex-wrap: wrap;
}

/* Detail sections */
.agents-view-detail-section {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}
.agents-view-detail-section-title {
  font-size: var(--text-sm);
  font-weight: var(--font-semibold);
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin: 0;
  padding-bottom: var(--sp-1);
  border-bottom: 1px solid var(--border-secondary);
}

/* Detail rows */
.agents-view-detail-row {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  font-size: var(--text-sm);
  padding: var(--sp-1) 0;
}
.agents-view-detail-label {
  font-weight: var(--font-medium);
  color: var(--text-muted);
  min-width: 80px;
  flex-shrink: 0;
}
.agents-view-detail-unassigned {
  color: var(--text-muted);
  font-style: italic;
  padding: var(--sp-2);
  background: rgba(248, 113, 113, 0.06);
  border: 1px dashed rgba(248, 113, 113, 0.3);
  border-radius: var(--radius-md);
  font-size: var(--text-sm);
}

/* Detail capability tags */
.agents-view-detail-cap-grid {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sp-1);
}
.agents-view-detail-cap-tag {
  display: inline-block;
  padding: var(--sp-1) var(--sp-2);
  border-radius: var(--radius-sm);
  font-size: var(--text-xs);
  font-weight: var(--font-medium);
  background: var(--bg-tertiary);
  color: var(--text-secondary);
  border: 1px solid var(--border-primary);
}

/* Detail actions bar */
.agents-view-detail-actions {
  display: flex;
  gap: var(--sp-2);
  padding-top: var(--sp-4);
  border-top: 1px solid var(--border-secondary);
  margin-top: var(--sp-2);
}

/* ══════════════════════════════════════════════════
   RESPONSIVE — Agents View
   ══════════════════════════════════════════════════ */

/* Medium screens: 2 columns */
@media (max-width: 1200px) {
  .agents-view-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

/* Narrow screens: 1 column */
@media (max-width: 768px) {
  .agents-view {
    padding: var(--sp-4);
  }
  .agents-view-grid {
    grid-template-columns: 1fr;
  }
  .agents-view-header {
    flex-direction: column;
    align-items: flex-start;
  }
  .agents-view-actions {
    width: 100%;
  }
  .agents-view-actions .btn {
    flex: 1;
  }
  .agents-view-card-avatar {
    width: 40px;
    height: 40px;
    font-size: var(--text-lg);
  }
  .agents-view-status-dot {
    top: 30px;
    left: 30px;
    width: 12px;
    height: 12px;
  }
  .agents-view-detail-avatar {
    width: 48px;
    height: 48px;
    font-size: var(--text-2xl);
  }
}

/* Very small screens */
@media (max-width: 480px) {
  .agents-view {
    padding: var(--sp-3);
  }
  .agents-view-card {
    padding: var(--sp-3);
  }
  .agents-view-card-name {
    font-size: var(--text-base);
  }
}
    `;

    document.head.appendChild(style);
  }
}
