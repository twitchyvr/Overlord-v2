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

/** Human-readable role labels (#576) */
const ROLE_LABELS = {
  'strategist': 'Strategist',
  'analyst': 'Business Analyst',
  'architect': 'Solutions Architect',
  'developer': 'Developer',
  'tester': 'QA Engineer',
  'reviewer': 'Code Reviewer',
  'operator': 'DevOps Engineer',
  'lead': 'Team Lead',
  'agent': 'Agent',
};

/** Format a raw role string into a human-readable label. */
function formatRole(role) {
  if (!role) return 'Agent';
  return ROLE_LABELS[role] || role.charAt(0).toUpperCase() + role.slice(1).replace(/-/g, ' ');
}

const CAPABILITIES = [
  'chat', 'analysis', 'code-generation', 'code-review',
  'testing', 'deployment', 'documentation', 'planning'
];

/** Personality traits derived from agent name hash. */
const PERSONALITY_TRAITS = [
  'analytical', 'creative', 'methodical', 'empathetic',
  'pragmatic', 'visionary', 'detail-oriented', 'collaborative'
];

/** Hash an agent name to deterministically pick a personality trait. */
function derivePersonality(name) {
  if (!name) return PERSONALITY_TRAITS[0];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = ((hash << 5) - hash) + name.charCodeAt(i);
    hash |= 0; // 32-bit int
  }
  return PERSONALITY_TRAITS[Math.abs(hash) % PERSONALITY_TRAITS.length];
}

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
    this._sort = 'name';     // 'name' | 'status' | 'last-active'
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
    let list;
    if (this._filter === 'all') list = this._agents;
    else if (this._filter === 'in-room') list = this._getAgentsInRooms();
    else list = this._getAgentsByStatus(this._filter);
    return this._sortAgents(list);
  }

  // ── Main Render ──────────────────────────────────────────────

  _render() {
    this.el.textContent = '';
    this.el.className = 'agents-view';

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

    // Reset agents button (#559)
    const resetBtn = h('button', {
      class: 'btn btn-ghost btn-md',
      title: 'Reset all agents to idle — clears assignments and activity',
      style: { color: 'var(--c-danger, #e74c3c)' }
    }, '\u21BA Reset');
    resetBtn.addEventListener('click', () => {
      const store = OverlordUI.getStore();
      const buildingId = store?.get('activeBuildingId');
      if (!buildingId) { Toast.warning('No active building'); return; }
      if (!confirm('Reset all agents to idle? This clears assignments and activity history.')) return;
      if (window.overlordSocket?.socket) {
        window.overlordSocket.socket.emit('agent:reset-all', { buildingId }, (res) => {
          if (res?.ok) {
            Toast.success(`${res.data.agentsReset} agents reset to idle`);
            this._fetchAgents();
          } else {
            Toast.error(res?.error?.message || 'Reset failed');
          }
        });
      }
    });
    header.querySelector('.agents-view-actions').appendChild(resetBtn);

    this.el.appendChild(header);

    // ── Filter tabs ──
    const tabContainer = h('div', { class: 'agents-view-tabs' });
    this._tabs = new Tabs(tabContainer, {
      items: [
        { id: 'all',    label: 'All',    badge: String(this._agents.length) },
        { id: 'active', label: 'Active', badge: String(this._getAgentsByStatus('active').length) },
        { id: 'idle',   label: 'Idle',   badge: String(this._getAgentsByStatus('idle').length) },
        { id: 'in-room', label: 'In Room', badge: String(this._getAgentsInRooms().length) }
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

    const roomNameMap = this._buildRoomNameMap();

    // ── Sort dropdown ──
    const sortRow = h('div', { class: 'agents-view-sort-row', style: 'display:flex;align-items:center;gap:var(--sp-2);margin-bottom:var(--sp-3)' });
    sortRow.appendChild(h('span', { style: 'font-size:var(--text-sm);color:var(--text-secondary)' }, 'Sort by:'));
    const sortSelect = h('select', { class: 'agents-sort-dropdown' });
    sortSelect.appendChild(h('option', { value: 'name' }, 'Name'));
    sortSelect.appendChild(h('option', { value: 'status' }, 'Status'));
    sortSelect.appendChild(h('option', { value: 'last-active' }, 'Last Active'));
    sortSelect.value = this._sort;
    sortSelect.addEventListener('change', () => {
      this._sort = sortSelect.value;
      this._render();
    });
    sortRow.appendChild(sortSelect);
    this.el.appendChild(sortRow);

    // ── Currently working section ──
    const workingSection = this._renderWorkingSection(roomNameMap);
    if (workingSection) this.el.appendChild(workingSection);

    // ── Unassigned agents banner (#512) ──
    const unassigned = this._agents.filter(a => !this._resolveRoomId(a));
    if (unassigned.length > 0) {
      const banner = h('div', { class: 'agents-unassigned-banner' },
        h('span', { class: 'agents-unassigned-banner-text' },
          `${unassigned.length} agent${unassigned.length === 1 ? ' is' : 's are'} waiting for work. Click 'Assign' to put them in a room.`
        ),
        h('button', {
          class: 'btn btn-primary btn-sm',
          onClick: () => this._autoAssignAll(unassigned)
        }, 'Auto-Assign All')
      );
      this.el.appendChild(banner);
    }

    // ── Agent grid ──
    const filtered = this._getFilteredAgents();

    if (filtered.length === 0) {
      this.el.appendChild(this._buildEmptyState());
      return;
    }

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

  /** Get agents currently assigned to rooms. */
  _getAgentsInRooms() {
    return this._agents.filter(a => this._resolveRoomId(a));
  }

  /** Sort agents by the selected criterion. */
  _sortAgents(agents) {
    const sorted = [...agents];
    if (this._sort === 'name') {
      sorted.sort((a, b) => (this._resolveDisplayName(a) || '').localeCompare(this._resolveDisplayName(b) || ''));
    } else if (this._sort === 'status') {
      const order = { active: 0, working: 0, paused: 1, idle: 2, error: 3 };
      sorted.sort((a, b) => (order[this._resolveStatus(a)] ?? 9) - (order[this._resolveStatus(b)] ?? 9));
    } else if (this._sort === 'last-active') {
      sorted.sort((a, b) => new Date(b.updated_at || 0) - new Date(a.updated_at || 0));
    }
    return sorted;
  }

  /** Render a highlighted section showing agents currently in rooms. */
  _renderWorkingSection(roomNameMap) {
    const working = this._getAgentsInRooms();
    if (working.length === 0) return null;

    const section = h('div', { class: 'agents-working-section' });
    section.appendChild(h('div', { class: 'agents-working-title' },
      `Currently Working (${working.length})`));

    for (const agent of working) {
      const roomId = this._resolveRoomId(agent);
      const roomName = roomId ? (roomNameMap[roomId] || 'Room') : '';
      const statusCfg = STATUS_CONFIG[this._resolveStatus(agent)] || STATUS_CONFIG.idle;
      const row = h('div', { style: 'display:flex;align-items:center;gap:var(--sp-2);padding:var(--sp-1) 0;font-size:var(--text-sm)' },
        h('div', { class: `agents-view-status-dot ${statusCfg.dot}`, style: 'position:static;width:8px;height:8px' }),
        h('span', { style: 'font-weight:var(--font-medium)' }, this._resolveDisplayName(agent)),
        h('span', { style: 'color:var(--text-muted)' }, `in ${roomName}`)
      );
      section.appendChild(row);
    }
    return section;
  }

  // ── Agent Card ───────────────────────────────────────────────

  /** Resolve the display name: prefer display_name, then name, then id. */
  _resolveDisplayName(agent) {
    return agent.display_name || agent.name || agent.id;
  }

  /** Get the avatar initial(s) from display_name or name. */
  _getAvatarInitial(agent) {
    const displayName = this._resolveDisplayName(agent);
    return (displayName || '?')[0].toUpperCase();
  }

  /** Build an avatar element — photo img if photo_url, else initial letter. */
  _buildAvatarElement(agent, size, statusColor) {
    const container = h('div', {
      class: `agents-view-card-avatar agents-view-avatar-${size}`,
      style: { borderColor: statusColor }
    });

    if (agent.photo_url) {
      const img = h('img', {
        class: 'agents-view-avatar-img',
        src: agent.photo_url,
        alt: this._resolveDisplayName(agent),
        loading: 'lazy'
      });
      // On load error, fall back to initial
      img.addEventListener('error', () => {
        img.remove();
        container.textContent = this._getAvatarInitial(agent);
        container.classList.add('agents-view-avatar-fallback');
      });
      // On load success, mark as loaded for fade-in
      img.addEventListener('load', () => {
        img.classList.add('agents-view-avatar-img-loaded');
      });
      container.appendChild(img);
    } else {
      container.textContent = this._getAvatarInitial(agent);
      container.classList.add('agents-view-avatar-fallback');
    }

    return container;
  }

  _renderAgentCard(agent, roomNameMap) {
    const status = this._resolveStatus(agent);
    const roomId = this._resolveRoomId(agent);
    const roomName = roomId ? (roomNameMap[roomId] || 'Room') : null;
    const statusCfg = STATUS_CONFIG[status] || STATUS_CONFIG.idle;

    const capabilities = this._parseArray(agent.capabilities);
    const roomAccess = this._parseArray(agent.room_access);
    const displayName = this._resolveDisplayName(agent);

    // ── Card wrapper ──
    const card = h('div', {
      class: `agents-view-card agents-view-card-${status}`,
      'data-agent-id': agent.id,
      role: 'button',
      tabindex: '0',
      'aria-label': `Agent: ${displayName}`
    });

    // ── Status border accent (top border colored by status) ──
    card.style.borderTopColor = statusCfg.color;

    // ── Card header row ──
    const cardHeader = h('div', { class: 'agents-view-card-header' });

    // Avatar circle (48x48) — photo or initial
    const avatar = this._buildAvatarElement(agent, 'sm', statusCfg.color);
    cardHeader.appendChild(avatar);

    // Status dot (overlaid on avatar)
    const statusDot = h('div', {
      class: `agents-view-status-dot ${statusCfg.dot}`,
      title: statusCfg.label
    });
    cardHeader.appendChild(statusDot);

    // Name, nickname, specialization, and role
    const nameGroup = h('div', { class: 'agents-view-card-name-group' },
      h('div', { class: 'agents-view-card-name' }, displayName),
      agent.nickname
        ? h('div', { class: 'agents-view-card-nickname' }, `"${agent.nickname}"`)
        : null,
      agent.specialization
        ? h('div', { class: 'agents-view-card-specialization' }, agent.specialization)
        : null,
      h('div', { class: 'agents-view-card-role' },
        h('span', { class: 'agents-view-role-badge' }, formatRole(agent.role))
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

    // ── Card footer with role/specialization ──
    const footerLabel = agent.specialization || agent.role || agent.type || '';
    const footer = h('div', { class: 'agents-view-card-footer' },
      footerLabel ? h('span', { class: 'agents-view-card-id' }, footerLabel) : null
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

    // ── Right-click context menu ──
    card.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this._showAgentContextMenu(e, agent);
    });

    return card;
  }

  /** Show a context menu at the cursor position for an agent card. */
  _showAgentContextMenu(event, agent) {
    // Remove any existing context menu
    const existing = document.querySelector('.agent-context-menu');
    if (existing) existing.remove();

    const roomId = this._resolveRoomId(agent);
    const displayName = this._resolveDisplayName(agent);

    const menuItems = [
      { label: 'View Profile', icon: '\uD83D\uDC64', action: () => this._openAgentDetail(agent) },
      { label: 'Send Email', icon: '\u2709', action: () => {
        const firstName = agent.first_name || displayName.split(' ')[0] || '';
        const lastName = agent.last_name || '';
        const email = firstName && lastName
          ? `${firstName.toLowerCase()}.${lastName.toLowerCase()}@overlord.ai`
          : `${(agent.name || agent.id).toLowerCase().replace(/\s+/g, '.')}@overlord.ai`;
        OverlordUI.dispatch('navigate:entity', { type: 'email', id: email, agentId: agent.id });
        Toast.info(`Email: ${email}`);
      }},
      { label: 'Assign to Room', icon: '\uD83C\uDFE0', action: () => this._openQuickAssignModal(agent) },
      { label: 'View Activity', icon: '\uD83D\uDCCA', action: () => {
        OverlordUI.dispatch('navigate:view', { view: 'activity', filter: 'agents', agentId: agent.id });
      }},
    ];

    const menu = h('div', { class: 'agent-context-menu', style: {
      position: 'fixed',
      top: `${event.clientY}px`,
      left: `${event.clientX}px`,
      zIndex: '10000'
    }});

    for (const item of menuItems) {
      const menuItem = h('div', { class: 'agent-context-menu-item' },
        h('span', { class: 'agent-context-menu-icon' }, item.icon),
        h('span', null, item.label)
      );
      menuItem.addEventListener('click', () => {
        menu.remove();
        item.action();
      });
      menu.appendChild(menuItem);
    }

    document.body.appendChild(menu);

    // Adjust position if menu overflows viewport
    const rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
      menu.style.left = `${window.innerWidth - rect.width - 8}px`;
    }
    if (rect.bottom > window.innerHeight) {
      menu.style.top = `${window.innerHeight - rect.height - 8}px`;
    }

    // Close menu on click outside or Escape
    const closeMenu = (e) => {
      if (!menu.contains(e.target)) {
        menu.remove();
        document.removeEventListener('click', closeMenu);
        document.removeEventListener('contextmenu', closeMenu);
        document.removeEventListener('keydown', escHandler);
      }
    };
    const escHandler = (e) => {
      if (e.key === 'Escape') {
        menu.remove();
        document.removeEventListener('click', closeMenu);
        document.removeEventListener('contextmenu', closeMenu);
        document.removeEventListener('keydown', escHandler);
      }
    };
    // Delay adding listeners to avoid immediate close
    setTimeout(() => {
      document.addEventListener('click', closeMenu);
      document.addEventListener('contextmenu', closeMenu);
      document.addEventListener('keydown', escHandler);
    }, 0);
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
    const displayName = this._resolveDisplayName(agent);

    const content = h('div', { class: 'agents-view-detail' });

    // ── Large Profile Photo + Identity Header ──
    const detailHeader = h('div', { class: 'agents-view-detail-header agents-view-detail-header-profile' });

    // Large avatar (120x120) with photo or initial
    const detailAvatar = this._buildAvatarElement(agent, 'lg', statusCfg.color);
    detailAvatar.classList.add('agents-view-detail-avatar');
    detailAvatar.style.color = statusCfg.color;
    detailHeader.appendChild(detailAvatar);

    const identityGroup = h('div', { class: 'agents-view-detail-identity' });

    // Display name (primary)
    identityGroup.appendChild(
      h('h3', { class: 'agents-view-detail-name' }, displayName)
    );

    // If display_name differs from name, show original name as subtitle
    if (agent.display_name && agent.name && agent.display_name !== agent.name) {
      identityGroup.appendChild(
        h('div', { class: 'agents-view-detail-codename' }, agent.name)
      );
    }

    // Specialization as secondary text
    if (agent.specialization) {
      identityGroup.appendChild(
        h('div', { class: 'agents-view-detail-specialization' }, agent.specialization)
      );
    }

    // Role badge + status
    identityGroup.appendChild(
      h('div', { class: 'agents-view-detail-meta' },
        h('span', { class: 'agents-view-role-badge' }, formatRole(agent.role)),
        h('span', {
          class: `agents-view-status-label agents-view-status-label-${status}`,
          style: { marginLeft: 'var(--sp-2)' }
        }, statusCfg.label)
      )
    );

    detailHeader.appendChild(identityGroup);
    content.appendChild(detailHeader);

    // ── Bio Section ──
    if (agent.bio) {
      const bioSection = h('div', { class: 'agents-view-detail-section' });
      bioSection.appendChild(h('h4', { class: 'agents-view-detail-section-title' }, 'Bio'));
      const bioContent = h('div', { class: 'agents-view-detail-bio' });
      // Render bio with proper paragraph formatting
      const paragraphs = agent.bio.split(/\n\n+/);
      for (const para of paragraphs) {
        if (para.trim()) {
          // Handle single newlines within a paragraph as line breaks
          const lines = para.trim().split(/\n/);
          const p = h('p', { class: 'agents-view-detail-bio-paragraph' });
          for (let i = 0; i < lines.length; i++) {
            if (i > 0) p.appendChild(h('br'));
            p.appendChild(document.createTextNode(lines[i]));
          }
          bioContent.appendChild(p);
        }
      }
      bioSection.appendChild(bioContent);
      content.appendChild(bioSection);
    }

    // ── Stats Cards (loaded async) ──
    const statsSection = h('div', { class: 'agents-view-detail-section agents-view-stats-section' });
    statsSection.appendChild(h('h4', { class: 'agents-view-detail-section-title' }, 'Statistics'));
    const statsGrid = h('div', { class: 'agents-view-stats-grid' });
    // Placeholder cards while loading
    const statCards = [
      { key: 'tasksCompleted', label: 'Tasks Done', icon: '\u2705' },
      { key: 'tasksAssigned', label: 'Assigned', icon: '\uD83D\uDCCB' },
      { key: 'messagesCount', label: 'Messages', icon: '\uD83D\uDCAC' },
      { key: 'roomJoins', label: 'Room Joins', icon: '\uD83D\uDEAA' },
      { key: 'sessionsCount', label: 'Sessions', icon: '\u23F1' },
    ];
    for (const sc of statCards) {
      const card = h('div', { class: 'agents-view-stat-card', 'data-stat': sc.key },
        h('div', { class: 'agents-view-stat-icon' }, sc.icon),
        h('div', { class: 'agents-view-stat-value' }, '--'),
        h('div', { class: 'agents-view-stat-label' }, sc.label)
      );
      statsGrid.appendChild(card);
    }
    statsSection.appendChild(statsGrid);
    content.appendChild(statsSection);

    // Fetch stats asynchronously
    if (window.overlordSocket) {
      window.overlordSocket.fetchAgentStats(agent.id).then((res) => {
        if (res && res.ok && res.data) {
          for (const sc of statCards) {
            const el = statsGrid.querySelector(`[data-stat="${sc.key}"] .agents-view-stat-value`);
            if (el) {
              const val = res.data[sc.key] ?? 0;
              el.textContent = sc.key === 'totalActiveTimeMs'
                ? _formatDuration(val) : String(val);
            }
          }
        }
      }).catch(() => {
        for (const sc of statCards) {
          const el = statsGrid.querySelector(`[data-stat="${sc.key}"] .agents-view-stat-value`);
          if (el) el.textContent = '0';
        }
      });
    }

    // ── Recent Activity Timeline ──
    const activitySection = h('div', { class: 'agents-view-detail-section' });
    activitySection.appendChild(h('h4', { class: 'agents-view-detail-section-title' }, 'Recent Activity'));
    const activityList = h('div', { class: 'agents-view-activity-list' });
    activityList.appendChild(h('div', { class: 'agents-view-activity-loading' }, 'Loading...'));
    activitySection.appendChild(activityList);
    content.appendChild(activitySection);

    // Fetch activity asynchronously
    if (window.overlordSocket) {
      window.overlordSocket.fetchAgentActivityLog(agent.id, { limit: 15 }).then((res) => {
        activityList.textContent = '';
        if (res && res.ok && res.data && res.data.length > 0) {
          for (const entry of res.data) {
            const icon = _activityIcon(entry.event_type);
            const desc = _activityDescription(entry);
            const time = _relativeTime(entry.created_at);
            activityList.appendChild(h('div', { class: 'agents-view-activity-entry' },
              h('span', { class: 'agents-view-activity-icon' }, icon),
              h('span', { class: 'agents-view-activity-desc' }, desc),
              h('span', { class: 'agents-view-activity-time' }, time)
            ));
          }
        } else {
          activityList.appendChild(h('div', { class: 'agents-view-activity-empty' }, 'No activity recorded yet'));
        }
      }).catch(() => {
        activityList.textContent = '';
        activityList.appendChild(h('div', { class: 'agents-view-activity-empty' }, 'Failed to load activity'));
      });
    }

    // ── Profile Fields (first_name, last_name, etc.) ──
    const profileSection = h('div', { class: 'agents-view-detail-section' });
    profileSection.appendChild(h('h4', { class: 'agents-view-detail-section-title' }, 'Profile'));

    const profileRows = [];
    if (agent.first_name || agent.last_name) {
      const fullName = [agent.first_name, agent.last_name].filter(Boolean).join(' ');
      profileRows.push(['Full Name', fullName]);
    }
    if (agent.nickname) {
      profileRows.push(['Nickname', `"${agent.nickname}"`]);
    }
    if (agent.first_name && agent.last_name) {
      const emailStyle = `${agent.first_name.toLowerCase()}.${agent.last_name.toLowerCase()}@overlord.ai`;
      profileRows.push(['Contact', emailStyle]);
    }
    if (agent.specialization) {
      profileRows.push(['Specialization', agent.specialization]);
    }
    profileRows.push(['Status', statusCfg.label]);
    profileRows.push(['Role', formatRole(agent.role)]);
    profileRows.push(['Personality', derivePersonality(agent.name || agent.id)]);
    profileRows.push(['Profile Generated', agent.profile_generated ? 'Yes' : 'No']);

    for (const [label, value] of profileRows) {
      profileSection.appendChild(h('div', { class: 'agents-view-detail-row' },
        h('span', { class: 'agents-view-detail-label' }, label),
        h('span', null, value)
      ));
    }
    content.appendChild(profileSection);

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
        const accessDisplayName = access === '*' ? 'All rooms' : this._formatRoomType(access);
        accessGrid.appendChild(h('span', { class: 'agents-view-detail-cap-tag' }, accessDisplayName));
      }
      accessSection.appendChild(accessGrid);
      content.appendChild(accessSection);
    }

    // ── Details (ID, timestamps) ──
    const infoSection = h('div', { class: 'agents-view-detail-section' });
    infoSection.appendChild(h('h4', { class: 'agents-view-detail-section-title' }, 'Details'));

    const infoRows = [
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

    // ── Assigned Todos ──
    const todosSection = h('div', { class: 'agents-view-detail-section' });
    todosSection.appendChild(h('h4', { class: 'agents-view-detail-section-title' }, 'Assigned Todos'));
    const todosContainer = h('div', {
      class: 'agent-todos-list',
      id: `agent-todos-${agent.id}`
    },
      h('div', { class: 'empty-state-inline' }, 'Loading...')
    );
    todosSection.appendChild(todosContainer);
    content.appendChild(todosSection);

    // Fetch todos for this agent asynchronously
    this._fetchAgentTodos(agent.id);

    // ── Profile Generation Actions ──
    const profileActionsSection = h('div', { class: 'agents-view-detail-section' });
    profileActionsSection.appendChild(
      h('h4', { class: 'agents-view-detail-section-title' }, 'Profile Actions')
    );

    const profileBtnRow = h('div', { class: 'agents-view-detail-profile-actions' });

    // Generate Profile button (if not yet generated)
    if (!agent.profile_generated) {
      const generateProfileBtn = h('button', {
        class: 'btn btn-primary btn-sm'
      }, 'Generate Profile');
      generateProfileBtn.addEventListener('click', async () => {
        if (!window.overlordSocket) { Toast.error('Socket not connected.'); return; }
        generateProfileBtn.disabled = true;
        generateProfileBtn.textContent = 'Generating...';
        try {
          const res = await window.overlordSocket.generateAgentProfile(agent.id);
          if (res && res.ok) {
            Toast.success('Profile generated successfully');
            this._fetchAgents();
            // Re-open the drawer with updated agent data after a short delay
            setTimeout(() => {
              const updatedAgent = this._findAgentById(agent.id);
              if (updatedAgent) this._openAgentDetail(updatedAgent);
            }, 1000);
          } else {
            throw new Error(res?.error?.message || 'Profile generation failed');
          }
        } catch (err) {
          Toast.error(`Generate failed: ${err.message}`);
          generateProfileBtn.disabled = false;
          generateProfileBtn.textContent = 'Generate Profile';
        }
      });
      profileBtnRow.appendChild(generateProfileBtn);
    } else {
      // Regenerate profile button
      const regenProfileBtn = h('button', {
        class: 'btn btn-ghost btn-sm'
      }, 'Regenerate Profile');
      regenProfileBtn.addEventListener('click', async () => {
        if (!window.overlordSocket) { Toast.error('Socket not connected.'); return; }
        regenProfileBtn.disabled = true;
        regenProfileBtn.textContent = 'Regenerating...';
        try {
          const res = await window.overlordSocket.generateAgentProfile(agent.id);
          if (res && res.ok) {
            Toast.success('Profile regenerated');
            this._fetchAgents();
            setTimeout(() => {
              const updatedAgent = this._findAgentById(agent.id);
              if (updatedAgent) this._openAgentDetail(updatedAgent);
            }, 1000);
          } else {
            throw new Error(res?.error?.message || 'Profile regeneration failed');
          }
        } catch (err) {
          Toast.error(`Regenerate failed: ${err.message}`);
          regenProfileBtn.disabled = false;
          regenProfileBtn.textContent = 'Regenerate Profile';
        }
      });
      profileBtnRow.appendChild(regenProfileBtn);
    }

    // Regenerate Photo button
    const regenPhotoBtn = h('button', {
      class: 'btn btn-ghost btn-sm'
    }, 'Regenerate Photo');
    regenPhotoBtn.addEventListener('click', async () => {
      if (!window.overlordSocket) { Toast.error('Socket not connected.'); return; }
      regenPhotoBtn.disabled = true;
      regenPhotoBtn.textContent = 'Generating Photo...';
      try {
        const res = await window.overlordSocket.generateAgentPhoto(agent.id);
        if (res && res.ok) {
          Toast.success('Photo generated successfully');
          this._fetchAgents();
          setTimeout(() => {
            const updatedAgent = this._findAgentById(agent.id);
            if (updatedAgent) this._openAgentDetail(updatedAgent);
          }, 1500);
        } else {
          throw new Error(res?.error?.message || 'Photo generation failed');
        }
      } catch (err) {
        Toast.error(`Photo generation failed: ${err.message}`);
        regenPhotoBtn.disabled = false;
        regenPhotoBtn.textContent = 'Regenerate Photo';
      }
    });
    profileBtnRow.appendChild(regenPhotoBtn);

    profileActionsSection.appendChild(profileBtnRow);
    content.appendChild(profileActionsSection);

    // ── Edit Profile Section ──
    const editSection = h('div', { class: 'agents-view-detail-section agents-view-detail-edit-section' });
    editSection.appendChild(
      h('h4', { class: 'agents-view-detail-section-title agents-view-detail-edit-toggle' }, 'Edit Profile')
    );

    const editForm = h('div', { class: 'agents-view-detail-edit-form agents-view-detail-edit-collapsed' });

    // Toggle edit form visibility
    const editToggle = editSection.querySelector('.agents-view-detail-edit-toggle');
    editToggle.style.cursor = 'pointer';
    editToggle.addEventListener('click', () => {
      editForm.classList.toggle('agents-view-detail-edit-collapsed');
      editToggle.classList.toggle('agents-view-detail-edit-toggle-open');
    });

    // First Name
    const firstNameGroup = h('div', { class: 'agents-view-detail-edit-field' });
    firstNameGroup.appendChild(h('label', { class: 'agents-view-detail-edit-label' }, 'First Name'));
    const firstNameInput = h('input', {
      class: 'form-input',
      type: 'text',
      value: agent.first_name || '',
      placeholder: 'First name'
    });
    firstNameGroup.appendChild(firstNameInput);
    editForm.appendChild(firstNameGroup);

    // Last Name
    const lastNameGroup = h('div', { class: 'agents-view-detail-edit-field' });
    lastNameGroup.appendChild(h('label', { class: 'agents-view-detail-edit-label' }, 'Last Name'));
    const lastNameInput = h('input', {
      class: 'form-input',
      type: 'text',
      value: agent.last_name || '',
      placeholder: 'Last name'
    });
    lastNameGroup.appendChild(lastNameInput);
    editForm.appendChild(lastNameGroup);

    // Nickname
    const nicknameGroup = h('div', { class: 'agents-view-detail-edit-field' });
    nicknameGroup.appendChild(h('label', { class: 'agents-view-detail-edit-label' }, 'Nickname'));
    const nicknameInput = h('input', {
      class: 'form-input',
      type: 'text',
      value: agent.nickname || '',
      placeholder: 'e.g., Ace, The Architect, Pixel'
    });
    nicknameGroup.appendChild(nicknameInput);
    editForm.appendChild(nicknameGroup);

    // Specialization
    const specGroup = h('div', { class: 'agents-view-detail-edit-field' });
    specGroup.appendChild(h('label', { class: 'agents-view-detail-edit-label' }, 'Specialization'));
    const specInput = h('input', {
      class: 'form-input',
      type: 'text',
      value: agent.specialization || '',
      placeholder: 'e.g., Full-Stack Development, Security Analysis'
    });
    specGroup.appendChild(specInput);
    editForm.appendChild(specGroup);

    // Bio
    const bioGroup = h('div', { class: 'agents-view-detail-edit-field' });
    bioGroup.appendChild(h('label', { class: 'agents-view-detail-edit-label' }, 'Bio'));
    const bioInput = h('textarea', {
      class: 'form-input agents-view-detail-edit-textarea',
      placeholder: 'Agent bio and background...',
      rows: '5'
    });
    bioInput.value = agent.bio || '';
    bioGroup.appendChild(bioInput);
    editForm.appendChild(bioGroup);

    // Save button
    const editActions = h('div', { class: 'agents-view-detail-edit-actions' });
    const saveProfileBtn = h('button', { class: 'btn btn-primary btn-sm' }, 'Save Changes');
    saveProfileBtn.addEventListener('click', async () => {
      if (!window.overlordSocket) { Toast.error('Socket not connected.'); return; }
      saveProfileBtn.disabled = true;
      saveProfileBtn.textContent = 'Saving...';
      try {
        const profileUpdate = {
          firstName: firstNameInput.value.trim() || undefined,
          lastName: lastNameInput.value.trim() || undefined,
          nickname: nicknameInput.value.trim() || null,
          specialization: specInput.value.trim() || undefined,
          bio: bioInput.value.trim() || undefined,
        };
        // Build displayName from first + last
        if (profileUpdate.firstName || profileUpdate.lastName) {
          profileUpdate.displayName = [profileUpdate.firstName, profileUpdate.lastName]
            .filter(Boolean).join(' ');
        }
        const res = await window.overlordSocket.updateAgentProfile(agent.id, profileUpdate);
        if (res && res.ok) {
          Toast.success('Profile updated');
          this._fetchAgents();
          setTimeout(() => {
            const updatedAgent = this._findAgentById(agent.id);
            if (updatedAgent) this._openAgentDetail(updatedAgent);
          }, 500);
        } else {
          throw new Error(res?.error?.message || 'Update failed');
        }
      } catch (err) {
        Toast.error(`Update failed: ${err.message}`);
        saveProfileBtn.disabled = false;
        saveProfileBtn.textContent = 'Save Changes';
      }
    });
    editActions.appendChild(saveProfileBtn);
    editForm.appendChild(editActions);

    editSection.appendChild(editForm);
    content.appendChild(editSection);

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
      title: `Agent: ${displayName}`,
      width: '520px',
      content
    });
  }

  /** Find an agent by ID from the current agent list. */
  _findAgentById(agentId) {
    return this._agents.find(a => a.id === agentId) || null;
  }

  // ── Agent Todos ────────────────────────────────────────────────

  /**
   * Fetch and render todos assigned to a specific agent.
   * Renders into #agent-todos-{agentId} container within the drawer.
   */
  async _fetchAgentTodos(agentId) {
    const container = document.getElementById(`agent-todos-${agentId}`);
    if (!container) return;

    if (!window.overlordSocket) {
      container.textContent = '';
      container.appendChild(h('div', { class: 'empty-state-inline' }, 'Not connected'));
      return;
    }

    try {
      const res = await window.overlordSocket.listTodosByAgent(agentId);
      if (!res || !res.ok) {
        container.textContent = '';
        container.appendChild(h('div', { class: 'empty-state-inline' }, 'Failed to load todos'));
        return;
      }

      const todos = res.data || [];
      container.textContent = '';

      if (todos.length === 0) {
        container.appendChild(h('div', { class: 'empty-state-inline' }, 'No todos assigned to this agent'));
        return;
      }

      // Resolve task titles from the store
      const store = OverlordUI.getStore();
      const tasks = store?.get('tasks.list') || [];

      for (const todo of todos) {
        const isDone = todo.status === 'done' || todo.status === 'completed';
        const parentTask = tasks.find(t => t.id === todo.task_id);
        const taskTitle = parentTask ? parentTask.title : 'Unknown task';

        const todoRow = h('div', { class: `agent-todo-row ${isDone ? 'agent-todo-done' : ''}` });

        // Status indicator
        const statusDot = h('div', { class: `agent-todo-status ${isDone ? 'agent-todo-status-done' : 'agent-todo-status-pending'}` });
        todoRow.appendChild(statusDot);

        // Content: description + parent task
        const todoContent = h('div', { class: 'agent-todo-content' });
        todoContent.appendChild(
          h('div', { class: 'agent-todo-description' }, todo.description || 'Untitled todo')
        );

        // Parent task link
        const taskLink = h('div', { class: 'agent-todo-task-link' });
        const taskBtn = h('button', { class: 'agent-todo-task-btn' }, taskTitle);
        taskBtn.addEventListener('click', () => {
          Drawer.close();
          OverlordUI.dispatch('navigate:entity', { type: 'task', id: todo.task_id });
        });
        taskLink.appendChild(taskBtn);
        todoContent.appendChild(taskLink);

        todoRow.appendChild(todoContent);

        // Status badge
        const statusBadge = h('span', {
          class: `agent-todo-badge ${isDone ? 'agent-todo-badge-done' : 'agent-todo-badge-pending'}`
        }, isDone ? 'Done' : 'Pending');
        todoRow.appendChild(statusBadge);

        container.appendChild(todoRow);
      }
    } catch (err) {
      container.textContent = '';
      container.appendChild(h('div', { class: 'empty-state-inline' }, 'Error loading todos'));
    }
  }

  // ── Create Agent Modal ───────────────────────────────────────

  _openCreateAgentModal() {
    const formData = {
      name: '',
      role: 'developer',
      capabilities: ['chat'],
      roomAccess: ['*'],
      autoGenerateProfile: true,
      // Manual profile fields (used when auto-generate is off)
      first_name: '',
      last_name: '',
      nickname: '',
      bio: '',
      specialization: '',
    };

    const container = h('div', { class: 'agent-create-form' });

    // ── Name field ──
    const nameGroup = h('div', { class: 'agent-create-field' });
    nameGroup.appendChild(h('label', { class: 'agent-create-label' }, 'Agent Name *'));
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
    roleGroup.appendChild(h('label', { class: 'agent-create-label' }, 'Role *'));
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

    // ── Profile Generation Options ──
    const profileSection = h('div', { class: 'agent-create-field agent-create-profile-section' });
    profileSection.appendChild(h('label', { class: 'agent-create-label' }, 'Profile Generation'));

    // Auto-generate checkbox
    const autoGenRow = h('label', { class: 'agent-create-autogen-label' });
    const autoGenCheckbox = h('input', { type: 'checkbox' });
    autoGenCheckbox.checked = formData.autoGenerateProfile;
    autoGenRow.appendChild(autoGenCheckbox);
    autoGenRow.appendChild(h('span', { class: 'agent-create-autogen-text' }, ' Auto-generate profile'));
    profileSection.appendChild(autoGenRow);

    // Auto-generate info note
    const autoGenNote = h('div', { class: 'agent-create-autogen-note' },
      h('span', { class: 'agent-create-autogen-note-icon' }, '\u2728'),
      h('span', null, 'A professional name, bio, and photo will be generated based on the role and capabilities.')
    );
    profileSection.appendChild(autoGenNote);

    // Manual profile fields container (hidden when auto-generate is on)
    const manualFields = h('div', { class: 'agent-create-manual-fields agent-create-manual-hidden' });

    // First Name
    const fnGroup = h('div', { class: 'agent-create-field' });
    fnGroup.appendChild(h('label', { class: 'agent-create-label agent-create-label-sub' }, 'First Name'));
    const fnInput = h('input', {
      class: 'form-input',
      type: 'text',
      placeholder: 'Agent first name'
    });
    fnInput.addEventListener('input', () => { formData.first_name = fnInput.value; });
    fnGroup.appendChild(fnInput);
    manualFields.appendChild(fnGroup);

    // Last Name
    const lnGroup = h('div', { class: 'agent-create-field' });
    lnGroup.appendChild(h('label', { class: 'agent-create-label agent-create-label-sub' }, 'Last Name'));
    const lnInput = h('input', {
      class: 'form-input',
      type: 'text',
      placeholder: 'Agent last name'
    });
    lnInput.addEventListener('input', () => { formData.last_name = lnInput.value; });
    lnGroup.appendChild(lnInput);
    manualFields.appendChild(lnGroup);

    // Nickname
    const nnGroup = h('div', { class: 'agent-create-field' });
    nnGroup.appendChild(h('label', { class: 'agent-create-label agent-create-label-sub' }, 'Nickname'));
    const nnInput = h('input', {
      class: 'form-input',
      type: 'text',
      placeholder: 'e.g., Ace, The Architect, Pixel'
    });
    nnInput.addEventListener('input', () => { formData.nickname = nnInput.value; });
    nnGroup.appendChild(nnInput);
    manualFields.appendChild(nnGroup);

    // Specialization
    const specManualGroup = h('div', { class: 'agent-create-field' });
    specManualGroup.appendChild(h('label', { class: 'agent-create-label agent-create-label-sub' }, 'Specialization'));
    const specManualInput = h('input', {
      class: 'form-input',
      type: 'text',
      placeholder: 'e.g., Full-Stack Development, Security Analysis'
    });
    specManualInput.addEventListener('input', () => { formData.specialization = specManualInput.value; });
    specManualGroup.appendChild(specManualInput);
    manualFields.appendChild(specManualGroup);

    // Bio
    const bioManualGroup = h('div', { class: 'agent-create-field' });
    bioManualGroup.appendChild(h('label', { class: 'agent-create-label agent-create-label-sub' }, 'Bio'));
    const bioManualInput = h('textarea', {
      class: 'form-input agent-create-textarea',
      placeholder: 'Brief agent background and description...',
      rows: '4'
    });
    bioManualInput.addEventListener('input', () => { formData.bio = bioManualInput.value; });
    bioManualGroup.appendChild(bioManualInput);
    manualFields.appendChild(bioManualGroup);

    profileSection.appendChild(manualFields);

    // Toggle between auto-generate and manual fields
    autoGenCheckbox.addEventListener('change', () => {
      formData.autoGenerateProfile = autoGenCheckbox.checked;
      if (autoGenCheckbox.checked) {
        autoGenNote.classList.remove('agent-create-autogen-note-hidden');
        manualFields.classList.add('agent-create-manual-hidden');
      } else {
        autoGenNote.classList.add('agent-create-autogen-note-hidden');
        manualFields.classList.remove('agent-create-manual-hidden');
      }
    });

    container.appendChild(profileSection);

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
      const roomDisplayName = roomType.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
      label.appendChild(checkbox);
      label.appendChild(h('span', null, ` ${roomDisplayName}`));
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

      // Build the registration payload
      const payload = {
        name: formData.name.trim(),
        role: formData.role,
        capabilities: formData.capabilities,
        roomAccess: formData.roomAccess,
        buildingId: buildingId || undefined,
        autoGenerateProfile: formData.autoGenerateProfile,
      };

      // Include manual profile fields when auto-generate is off
      // Backend expects camelCase field names (matching Zod schema)
      if (!formData.autoGenerateProfile) {
        if (formData.first_name.trim()) payload.firstName = formData.first_name.trim();
        if (formData.last_name.trim()) payload.lastName = formData.last_name.trim();
        if (formData.nickname.trim()) payload.nickname = formData.nickname.trim();
        if (formData.specialization.trim()) payload.specialization = formData.specialization.trim();
        if (formData.bio.trim()) payload.bio = formData.bio.trim();
        // Build displayName from first + last name
        if (payload.firstName || payload.lastName) {
          payload.displayName = [payload.firstName, payload.lastName].filter(Boolean).join(' ');
        }
      }

      const result = await window.overlordSocket.registerAgent(payload);

      if (result && result.ok) {
        const successMsg = formData.autoGenerateProfile
          ? `Agent "${formData.name}" created. Profile generation in progress...`
          : `Agent "${formData.name}" created successfully`;
        Toast.success(successMsg);
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
      h('span', null, ` (${formatRole(agent.role)}).`),
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

  // ── Auto-Assign All (#512) ─────────────────────────────────────

  /**
   * Auto-assign each unassigned agent to the first room in their room_access list.
   * Falls back to the first available room if room_access is empty or wildcard.
   */
  async _autoAssignAll(unassigned) {
    if (!window.overlordSocket) {
      Toast.error('Not connected');
      return;
    }
    if (this._rooms.length === 0) {
      Toast.warning('No rooms available. Create rooms first.');
      return;
    }

    const roomMap = {};
    for (const room of this._rooms) {
      roomMap[room.type] = room.id;
    }
    const fallbackRoomId = this._rooms[0]?.id;

    let assigned = 0;
    let failed = 0;

    for (const agent of unassigned) {
      const roomAccess = this._parseArray(agent.room_access);
      let targetRoomId = null;

      // Find the first matching room from the agent's room_access
      for (const accessType of roomAccess) {
        if (accessType === '*') {
          targetRoomId = fallbackRoomId;
          break;
        }
        if (roomMap[accessType]) {
          targetRoomId = roomMap[accessType];
          break;
        }
      }

      // Fall back to first available room if no match found
      if (!targetRoomId) targetRoomId = fallbackRoomId;

      try {
        const result = await window.overlordSocket.moveAgent(agent.id, targetRoomId);
        if (result && result.ok) {
          assigned++;
        } else {
          failed++;
        }
      } catch {
        failed++;
      }
    }

    if (assigned > 0) Toast.success(`${assigned} agent${assigned === 1 ? '' : 's'} assigned to rooms`);
    if (failed > 0) Toast.warning(`${failed} agent${failed === 1 ? '' : 's'} could not be assigned`);

    this._fetchAgents();
  }

}

// ── Stats Helper Functions (module-scoped) ──

function _formatDuration(ms) {
  if (!ms || ms <= 0) return '0m';
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

const ACTIVITY_ICONS = {
  room_join: '\uD83D\uDEAA',
  room_leave: '\uD83D\uDEB6',
  status_change: '\uD83D\uDD04',
  task_complete: '\u2705',
  task_assign: '\uD83D\uDCCB',
  session_start: '\u25B6',
  session_end: '\u23F9',
  message_sent: '\uD83D\uDCAC',
};

function _activityIcon(eventType) {
  return ACTIVITY_ICONS[eventType] || '\u2022';
}

function _activityDescription(entry) {
  const data = entry.event_data || {};
  switch (entry.event_type) {
    case 'room_join': return `Joined room${data.roomType ? ` (${data.roomType})` : ''}`;
    case 'room_leave': return `Left room${data.roomType ? ` (${data.roomType})` : ''}`;
    case 'status_change': return `Status: ${data.from || '?'} → ${data.to || '?'}`;
    case 'task_complete': return `Completed task: ${data.taskTitle || data.taskId || 'unknown'}`;
    case 'task_assign': return `Assigned task: ${data.taskTitle || data.taskId || 'unknown'}`;
    case 'session_start': return 'Session started';
    case 'session_end': return `Session ended${data.durationMs ? ` (${_formatDuration(data.durationMs)})` : ''}`;
    default: return entry.event_type.replace(/_/g, ' ');
  }
}

function _relativeTime(isoStr) {
  if (!isoStr) return '';
  const date = new Date(isoStr);
  const now = new Date();
  const diffMs = now - date;
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return 'just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  return date.toLocaleDateString();
}
