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
import { Toast } from '../components/toast.js';
import { Modal } from '../components/modal.js';


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

    // Agent count summary + create button
    const summaryRow = h('div', { class: 'agents-panel-summary' },
      h('span', null, `${this._agents.length} registered agents`)
    );
    const createBtn = h('button', { class: 'btn btn-primary btn-sm' }, '+ New Agent');
    createBtn.addEventListener('click', () => this._openCreateAgentModal());
    summaryRow.appendChild(createBtn);
    body.appendChild(summaryRow);

    // Agent list
    const filtered = this._filter === 'all' ? this._agents : this._getAgentsByStatus(this._filter);

    if (filtered.length === 0) {
      body.appendChild(h('div', { class: 'panel-empty' },
        this._filter === 'all' ? 'No agents registered.' : `No ${this._filter} agents.`
      ));
      return;
    }

    // Build room name lookup
    const store = OverlordUI.getStore();
    const roomsList = store?.get('rooms.list') || [];
    const roomNameMap = {};
    for (const r of roomsList) {
      roomNameMap[r.id] = r.name || this._formatRoomType(r.type);
    }

    const list = h('div', { class: 'agents-list' });

    for (const agent of filtered) {
      const position = this._agentPositions[agent.id];
      const status = position?.status || agent.status || 'idle';
      const currentRoomId = agent.current_room_id || position?.roomId || null;
      const currentRoomName = currentRoomId ? (roomNameMap[currentRoomId] || 'Room') : null;

      const item = DrillItem.create('agent', { ...agent, status, currentRoom: currentRoomId, currentRoomName }, {
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
        meta: (d) => d.currentRoomName
          ? `\u{1F3E0} ${d.currentRoomName}`
          : '\u26A0 Unassigned',
        detail: [
          { label: 'Role', key: 'role' },
          { label: 'Status', key: 'status' },
          { label: 'Current Room', key: 'currentRoomName' },
          { label: 'Capabilities', key: 'capabilities', format: 'json' },
          { label: 'Room Access', key: 'room_access', format: 'json' }
        ]
      });

      // If agent has no room, show a quick-assign link
      if (!currentRoomId) {
        const assignLink = h('div', { class: 'agent-quick-assign' });
        const assignBtn = h('button', { class: 'btn btn-ghost btn-xs' }, 'Assign to Room');
        assignBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this._openQuickAssignModal(agent);
        });
        assignLink.appendChild(assignBtn);
        item.appendChild(assignLink);
      }

      list.appendChild(item);
    }

    body.appendChild(list);
  }

  /** Format room type slug to title */
  _formatRoomType(type) {
    if (!type) return 'Room';
    return type.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
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

  /** Open the create agent modal with form fields. */
  _openCreateAgentModal() {
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

    const formData = { name: '', role: 'developer', capabilities: ['chat'], roomAccess: ['*'] };

    const container = h('div', { class: 'agent-create-form' });

    // Name field
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

    // Role select
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

    // Capabilities checkboxes
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

    // Room access
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

    // Action buttons
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
  }

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
      } else {
        throw new Error(result?.error?.message || 'Failed to create agent');
      }
    } catch (err) {
      Toast.error(`Create failed: ${err.message}`);
      submitBtn.disabled = false;
      submitBtn.textContent = 'Create Agent';
    }
  }

  /** Quick-assign modal: pick a room for an unassigned agent. */
  _openQuickAssignModal(agent) {
    const store = OverlordUI.getStore();
    const roomsList = store?.get('rooms.list') || [];

    if (roomsList.length === 0) {
      Toast.warning('No rooms available. Create a room in the building first.');
      return;
    }

    let selectedRoom = null;
    const container = h('div', { class: 'assign-agent-modal' });

    container.appendChild(h('div', { class: 'assign-agent-guidance' },
      h('p', null, 'Select a room for '),
      h('strong', null, agent.name || agent.id),
      h('span', null, ` (${agent.role || 'agent'}).`),
    ));

    container.appendChild(h('label', { class: 'form-label' }, 'Available Rooms'));
    const roomList = h('div', { class: 'assign-agent-list' });

    for (const room of roomsList) {
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
          Toast.success(`${agent.name} assigned to room`);
          Modal.close('quick-assign');
          // Refresh agents to show updated assignment
          window.overlordSocket.fetchAgents({});
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
}
