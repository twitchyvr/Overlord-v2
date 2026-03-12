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
    this._exitDocHistory = [];
    this._citations = [];
    this._backlinks = [];
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
    this._exitDocHistory = [];
    this._citations = [];
    this._backlinks = [];
    this._openModal();
    this._fetchExitDocHistory(roomId);
    this._fetchCitations(roomId);
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

    // ── Room Configuration Panel ──
    container.appendChild(this._buildRoomConfigSection(room));

    // ── Stats summary bar ──
    container.appendChild(this._buildStatsBar(room));

    // ── Agent roster ──
    container.appendChild(this._buildAgentRoster(room));

    // ── Table/Chair visualization with management ──
    container.appendChild(this._buildTableLayout(room));

    // ── Room info details ──
    container.appendChild(this._buildInfoSection(room));

    // ── Exit Document action ──
    if (room.exitRequired && room.exitRequired.fields && room.exitRequired.fields.length > 0) {
      container.appendChild(this._buildExitDocSection(room));
    }

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

    // ── Citations / Backlinks section ──
    container.appendChild(this._buildCitationsSection(room));

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

  // ── Room Configuration Panel ──────────────────────────────────

  _buildRoomConfigSection(room) {
    const section = h('div', { class: 'room-config-section' });

    const header = h('div', { class: 'room-section-header' },
      h('h4', null, 'Room Configuration')
    );

    const actionsRow = h('div', { class: 'room-config-actions' });

    // Edit Room button
    const editBtn = h('button', { class: 'btn btn-secondary btn-sm' }, 'Edit Room');
    editBtn.addEventListener('click', () => this._openEditRoomModal(room));
    actionsRow.appendChild(editBtn);

    // Delete Room button
    const deleteBtn = h('button', { class: 'btn btn-danger btn-sm' }, 'Delete Room');
    deleteBtn.addEventListener('click', () => this._openDeleteRoomConfirm(room));
    actionsRow.appendChild(deleteBtn);

    header.appendChild(actionsRow);
    section.appendChild(header);

    // Config summary grid
    const grid = h('div', { class: 'room-config-grid' });

    grid.appendChild(this._configItem('Name', room.name || this._formatRoomType(room.type)));
    grid.appendChild(this._configItem('Type', this._formatRoomType(room.type)));

    const fileScopeLabel =
      room.fileScope === 'full' ? 'Full access' :
      room.fileScope === 'read-only' ? 'Read-only' :
      room.fileScope === 'assigned' ? 'Assigned files only' :
      room.fileScope === 'none' ? 'None' :
      room.fileScope || 'Not set';
    grid.appendChild(this._configItem('File Scope', fileScopeLabel));

    grid.appendChild(this._configItem('AI Provider', room.provider || 'Default'));

    const toolsList = room.tools && room.tools.length > 0
      ? room.tools.join(', ')
      : 'None';
    grid.appendChild(this._configItem('Allowed Tools', toolsList));

    section.appendChild(grid);
    return section;
  }

  _configItem(label, value) {
    return h('div', { class: 'room-config-item' },
      h('span', { class: 'room-config-item-label' }, label),
      h('span', { class: 'room-config-item-value' }, value)
    );
  }

  /** Open modal to edit room configuration. */
  _openEditRoomModal(room) {
    let editName = room.name || '';
    let editFileScope = room.fileScope || 'assigned';
    let editProvider = room.provider || '';
    let editTools = (room.tools || []).join(', ');

    const container = h('div', { class: 'edit-room-config-modal' });

    // Name field
    const nameGroup = h('div', { class: 'edit-room-field' });
    nameGroup.appendChild(h('label', { class: 'form-label' }, 'Room Name'));
    const nameInput = h('input', {
      class: 'form-input',
      type: 'text',
      value: editName,
      placeholder: 'e.g., Backend Code Lab'
    });
    nameInput.addEventListener('input', () => { editName = nameInput.value; });
    nameGroup.appendChild(nameInput);
    container.appendChild(nameGroup);

    // File Scope dropdown
    const scopeGroup = h('div', { class: 'edit-room-field' });
    scopeGroup.appendChild(h('label', { class: 'form-label' }, 'File Scope'));
    const scopeSelect = h('select', { class: 'form-input' });
    const scopeOptions = [
      { value: 'assigned', label: 'Assigned files only' },
      { value: 'read-only', label: 'Read-only' },
      { value: 'full', label: 'Full access' },
      { value: 'none', label: 'None' },
    ];
    for (const opt of scopeOptions) {
      const optEl = h('option', { value: opt.value }, opt.label);
      if (opt.value === editFileScope) optEl.selected = true;
      scopeSelect.appendChild(optEl);
    }
    scopeSelect.addEventListener('change', () => { editFileScope = scopeSelect.value; });
    scopeGroup.appendChild(scopeSelect);
    scopeGroup.appendChild(h('span', { class: 'form-hint' },
      'Controls how agents in this room can access the project file system.'
    ));
    container.appendChild(scopeGroup);

    // AI Provider field
    const providerGroup = h('div', { class: 'edit-room-field' });
    providerGroup.appendChild(h('label', { class: 'form-label' }, 'AI Provider'));
    const providerInput = h('input', {
      class: 'form-input',
      type: 'text',
      value: editProvider,
      placeholder: 'e.g., anthropic, openai, minimax'
    });
    providerInput.addEventListener('input', () => { editProvider = providerInput.value; });
    providerGroup.appendChild(providerInput);
    providerGroup.appendChild(h('span', { class: 'form-hint' },
      'Leave blank to use the default provider.'
    ));
    container.appendChild(providerGroup);

    // Allowed Tools textarea
    const toolsGroup = h('div', { class: 'edit-room-field' });
    toolsGroup.appendChild(h('label', { class: 'form-label' }, 'Allowed Tools'));
    const toolsInput = h('textarea', {
      class: 'form-input form-textarea',
      rows: '3',
      placeholder: 'read_file, write_file, search_code\n(comma-separated tool names)'
    });
    toolsInput.value = editTools;
    toolsInput.addEventListener('input', () => { editTools = toolsInput.value; });
    toolsGroup.appendChild(toolsInput);
    toolsGroup.appendChild(h('span', { class: 'form-hint' },
      'Comma-separated list of tools available in this room. Only these tools will be accessible to agents.'
    ));
    container.appendChild(toolsGroup);

    // Actions
    const actions = h('div', { class: 'edit-room-actions' });
    const cancelBtn = h('button', { class: 'btn btn-ghost btn-md' }, 'Cancel');
    cancelBtn.addEventListener('click', () => Modal.close('edit-room-config'));

    const saveBtn = h('button', { class: 'btn btn-primary btn-md' }, 'Save Changes');
    saveBtn.addEventListener('click', async () => {
      if (!window.overlordSocket) {
        Toast.error('Not connected to server');
        return;
      }

      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving...';

      try {
        const updates = {
          name: editName.trim() || undefined,
          fileScope: editFileScope,
          provider: editProvider.trim() || undefined,
          allowedTools: editTools
            .split(',')
            .map(t => t.trim())
            .filter(Boolean),
        };

        const result = await window.overlordSocket.updateRoom(room.id, updates);
        if (result && result.ok) {
          Toast.success('Room configuration updated');
          Modal.close('edit-room-config');
          // Reload room to reflect changes
          this._loadRoom(room.id);
        } else {
          throw new Error(result?.error?.message || 'Failed to update room');
        }
      } catch (err) {
        Toast.error(`Save failed: ${err.message}`);
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save Changes';
      }
    });

    actions.appendChild(cancelBtn);
    actions.appendChild(saveBtn);
    container.appendChild(actions);

    Modal.open('edit-room-config', {
      title: `Edit Room: ${room.name || this._formatRoomType(room.type)}`,
      content: container,
      size: 'md',
      position: window.innerWidth < 768 ? 'fullscreen' : 'center',
    });
  }

  /** Open confirmation dialog to delete a room. */
  _openDeleteRoomConfirm(room) {
    const container = h('div', { class: 'confirm-delete-modal' });

    container.appendChild(h('p', { class: 'confirm-delete-message' },
      `Are you sure you want to delete the room "${room.name || this._formatRoomType(room.type)}"?`
    ));

    const warning = h('div', { class: 'confirm-delete-warning' },
      h('span', { class: 'confirm-delete-warning-icon' }, '\u26A0\uFE0F'),
      h('div', null,
        h('p', null, 'This action cannot be undone.'),
        h('p', null, 'All tables, agent assignments, and activity history for this room will be permanently removed.')
      )
    );
    container.appendChild(warning);

    const actions = h('div', { class: 'edit-room-actions' });
    const cancelBtn = h('button', { class: 'btn btn-ghost btn-md' }, 'Cancel');
    cancelBtn.addEventListener('click', () => Modal.close('delete-room-confirm'));

    const deleteBtn = h('button', { class: 'btn btn-danger btn-md' }, 'Delete Room');
    deleteBtn.addEventListener('click', async () => {
      if (!window.overlordSocket) {
        Toast.error('Not connected to server');
        return;
      }

      deleteBtn.disabled = true;
      deleteBtn.textContent = 'Deleting...';

      try {
        const result = await window.overlordSocket.deleteRoom(room.id);
        if (result && result.ok) {
          Toast.success('Room deleted');
          Modal.close('delete-room-confirm');
          // Close the room detail modal
          Modal.close(`room-${room.id}`);
        } else {
          throw new Error(result?.error?.message || 'Failed to delete room');
        }
      } catch (err) {
        Toast.error(`Delete failed: ${err.message}`);
        deleteBtn.disabled = false;
        deleteBtn.textContent = 'Delete Room';
      }
    });

    actions.appendChild(cancelBtn);
    actions.appendChild(deleteBtn);
    container.appendChild(actions);

    Modal.open('delete-room-confirm', {
      title: 'Delete Room',
      content: container,
      size: 'sm',
      position: window.innerWidth < 768 ? 'fullscreen' : 'center',
    });
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
    const agentsInRoom = room.agents || this._getAgentsInRoom(room.id);
    const section = h('div', { class: 'room-agent-roster' });

    // Header with assign button
    const rosterHeader = h('div', { class: 'room-section-header' },
      h('h4', null, `Agent Roster (${agentsInRoom.length})`),
    );
    const assignBtn = h('button', { class: 'btn btn-primary btn-sm' }, '+ Assign Agent');
    assignBtn.addEventListener('click', () => this._openAssignAgentModal(room));
    rosterHeader.appendChild(assignBtn);
    section.appendChild(rosterHeader);

    if (agentsInRoom.length === 0) {
      section.appendChild(h('div', { class: 'room-roster-empty' },
        h('span', { class: 'room-roster-empty-icon' }, '\u{1F465}'),
        h('div', { class: 'room-roster-empty-text' },
          h('p', null, 'No agents assigned to this room yet.'),
          h('p', { class: 'text-muted' }, 'Click "Assign Agent" to seat an agent here. Agents gain access to the room\'s tools and participate in its workflow.')
        )
      ));
      return section;
    }

    const list = h('div', { class: 'room-roster-list' });
    for (const agent of agentsInRoom) {
      const status = agent.status || 'idle';
      const statusClass = STATUS_CLASSES[status] || 'idle';
      const tableName = agent.current_table_id ? 'Seated' : 'Not seated';

      const row = h('div', { class: 'room-roster-row' },
        h('div', { class: `room-roster-dot room-roster-dot-${statusClass}` }),
        h('div', { class: 'room-roster-avatar' },
          (agent.name || '?')[0].toUpperCase()
        ),
        h('div', { class: 'room-roster-info' },
          h('span', { class: 'room-roster-name' }, agent.name || agent.id || 'Agent'),
          h('span', { class: 'room-roster-role' }, agent.role || ''),
          h('span', { class: 'room-roster-table text-muted' }, tableName)
        ),
        h('span', { class: `room-roster-status room-roster-status-${statusClass}` }, status)
      );

      // Remove agent button
      const removeBtn = h('button', {
        class: 'btn btn-ghost btn-xs room-roster-remove',
        title: 'Remove from room'
      }, '\u2715');
      removeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._removeAgentFromRoom(agent.id, room.id);
      });
      row.appendChild(removeBtn);

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
    const layout = h('div', { class: 'room-table-layout' });

    // Header with add table button
    const tableHeader = h('div', { class: 'room-section-header' },
      h('h4', null, 'Tables & Seating')
    );
    const addTableBtn = h('button', { class: 'btn btn-ghost btn-sm' }, '+ Add Table');
    addTableBtn.addEventListener('click', () => this._openAddTableModal(room));
    tableHeader.appendChild(addTableBtn);
    layout.appendChild(tableHeader);

    // Show active tables from DB (with agents seated at each)
    const activeTables = room.activeTables || [];
    const agentsInRoom = room.agents || this._getAgentsInRoom(room.id);

    if (activeTables.length > 0) {
      // Table list with management columns
      const tableList = h('div', { class: 'room-table-list' });

      for (const table of activeTables) {
        const tableAgents = agentsInRoom.filter(a => a.current_table_id === table.id);
        const chairCount = table.chairs || 1;
        const occupancy = tableAgents.length;

        const tableCard = h('div', { class: 'room-table-card-vis' });

        // Header row with type, occupancy, and action buttons
        const cardHeader = h('div', { class: 'room-table-card-header' });
        cardHeader.appendChild(h('span', { class: 'room-table-card-type' }, table.type || 'focus'));
        cardHeader.appendChild(h('span', { class: 'room-table-card-occupancy' }, `${occupancy}/${chairCount}`));

        // Table action buttons (edit / delete)
        const tableActions = h('div', { class: 'room-table-card-actions' });

        const editTableBtn = h('button', {
          class: 'btn btn-ghost btn-xs room-table-action-btn',
          title: 'Edit table'
        }, '\u270E');
        editTableBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this._openEditTableModal(table, room);
        });
        tableActions.appendChild(editTableBtn);

        const deleteTableBtn = h('button', {
          class: 'btn btn-ghost btn-xs room-table-action-btn room-table-action-danger',
          title: 'Delete table'
        }, '\u2715');
        deleteTableBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this._openDeleteTableConfirm(table, room);
        });
        tableActions.appendChild(deleteTableBtn);

        cardHeader.appendChild(tableActions);
        tableCard.appendChild(cardHeader);

        if (table.description) {
          tableCard.appendChild(h('div', { class: 'room-table-card-desc text-muted' }, table.description));
        }

        // Seated agents list
        if (tableAgents.length > 0) {
          const seatedList = h('div', { class: 'room-table-seated-agents' });
          seatedList.appendChild(h('span', { class: 'room-table-seated-label' }, 'Seated:'));
          for (const agent of tableAgents) {
            const statusClass = STATUS_CLASSES[agent.status] || 'idle';
            seatedList.appendChild(h('span', {
              class: `room-table-seated-agent room-table-seated-agent-${statusClass}`,
              title: `${agent.name || agent.id} (${agent.status || 'idle'})`
            }, agent.name || agent.id));
          }
          tableCard.appendChild(seatedList);
        }

        // Chair visualization
        const chairRow = h('div', { class: 'room-chair-row' });
        for (let i = 0; i < chairCount; i++) {
          const agent = tableAgents[i];
          const chair = h('div', {
            class: `room-chair${agent ? ' room-chair-occupied' : ' room-chair-empty'}`,
            title: agent ? (agent.name || agent.id) : 'Empty seat'
          });
          if (agent) {
            const statusClass = STATUS_CLASSES[agent.status] || 'idle';
            chair.appendChild(h('div', {
              class: `room-chair-avatar room-chair-avatar-${statusClass}`
            }, (agent.name || '?')[0].toUpperCase()));
            chair.appendChild(h('div', { class: 'room-chair-name' }, agent.name || agent.id));
          }
          chairRow.appendChild(chair);
        }
        tableCard.appendChild(chairRow);
        tableList.appendChild(tableCard);
      }

      layout.appendChild(tableList);
    } else if (room.tables && Object.keys(room.tables).length > 0) {
      // Show contract-defined tables (from room type definition)
      const contractInfo = h('div', { class: 'room-tables-contract' });
      contractInfo.appendChild(h('p', { class: 'text-muted' },
        'This room type defines the following table types. Tables are auto-created when agents are assigned.'
      ));
      for (const [tableName, config] of Object.entries(room.tables)) {
        const cfg = config || {};
        contractInfo.appendChild(h('div', { class: 'room-table-contract-item' },
          h('span', { class: 'room-table-contract-name' }, tableName),
          h('span', { class: 'room-table-contract-chairs text-muted' }, `${cfg.chairs || 1} chair${(cfg.chairs || 1) > 1 ? 's' : ''}`),
          cfg.description ? h('span', { class: 'room-table-contract-desc text-muted' }, cfg.description) : null
        ));
      }
      layout.appendChild(contractInfo);
    } else {
      layout.appendChild(h('div', { class: 'room-tables-empty text-muted' },
        'No tables configured. Add a table or assign an agent to auto-create one.'
      ));
    }

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

  _buildExitDocSection(room) {
    const exitReq = room.exitRequired;
    const section = h('div', { class: 'room-exit-doc-section' });

    // Header
    section.appendChild(h('h4', null, 'Exit Document'));

    // Info about the required exit doc
    const infoRow = h('div', { class: 'room-exit-doc-info' },
      h('div', { class: 'room-exit-doc-type' },
        h('span', { class: 'room-exit-doc-icon' }, '\u{1F4DD}'),
        h('span', null, `Type: `),
        h('span', { class: 'badge' }, exitReq.type)
      ),
      h('div', { class: 'room-exit-doc-fields-count' },
        `${exitReq.fields.length} required field${exitReq.fields.length !== 1 ? 's' : ''}: `,
        h('span', { class: 'room-exit-doc-field-list' },
          exitReq.fields.map(f =>
            f.replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase()).trim()
          ).join(', ')
        )
      )
    );
    section.appendChild(infoRow);

    // Submit button
    const submitBtn = h('button', {
      class: 'btn btn-primary btn-md room-exit-doc-btn'
    }, '\u{1F4CB} Submit Exit Document');

    submitBtn.addEventListener('click', () => {
      const store = OverlordUI.getStore();
      OverlordUI.dispatch('exit-doc:open-form', {
        roomId: room.id,
        roomData: room,
        buildingId: store?.get('building.active'),
        phase: store?.get('building.activePhase') || 'strategy',
      });
    });

    section.appendChild(submitBtn);

    // Exit doc history placeholder (populated async)
    const historyContainer = h('div', {
      class: 'room-exit-doc-history',
      'data-testid': 'exit-doc-history'
    });
    section.appendChild(historyContainer);

    // Render history if already loaded
    if (this._exitDocHistory.length > 0) {
      this._renderExitDocHistory(historyContainer);
    }

    return section;
  }

  async _fetchExitDocHistory(roomId) {
    if (!window.overlordSocket) return;
    try {
      const result = await window.overlordSocket.fetchExitDocs(roomId);
      if (result && result.ok && Array.isArray(result.data)) {
        this._exitDocHistory = result.data;
        // Update the history container in the modal
        const modalBody = Modal.getBody(`room-${roomId}`);
        if (modalBody) {
          const histEl = modalBody.querySelector('[data-testid="exit-doc-history"]');
          if (histEl) this._renderExitDocHistory(histEl);
        }
      }
    } catch {
      // Silently fail — history is supplementary
    }
  }

  _renderExitDocHistory(container) {
    container.textContent = '';
    if (this._exitDocHistory.length === 0) return;

    container.appendChild(h('div', { class: 'room-exit-doc-history-header' },
      h('span', null, `Previous Submissions (${this._exitDocHistory.length})`)
    ));

    for (const doc of this._exitDocHistory.slice(0, 5)) {
      const fields = typeof doc.fields === 'string' ? JSON.parse(doc.fields || '{}') : (doc.fields || {});
      const fieldCount = Object.keys(fields).length;
      const date = doc.created_at ? new Date(doc.created_at).toLocaleString() : '—';

      const row = h('div', { class: 'room-exit-doc-history-row' },
        h('div', { class: 'room-exit-doc-history-meta' },
          h('span', { class: 'badge' }, doc.type || 'unknown'),
          h('span', { class: 'room-exit-doc-history-by' }, `by ${doc.completed_by || 'unknown'}`),
          h('span', { class: 'room-exit-doc-history-date' }, date)
        ),
        h('div', { class: 'room-exit-doc-history-summary' },
          `${fieldCount} field${fieldCount !== 1 ? 's' : ''} documented`
        )
      );

      // Expandable: click to show field details
      row.addEventListener('click', () => {
        const existing = row.querySelector('.room-exit-doc-history-detail');
        if (existing) {
          existing.remove();
          return;
        }
        const detail = h('div', { class: 'room-exit-doc-history-detail' });
        for (const [key, val] of Object.entries(fields)) {
          const label = key.replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase()).trim();
          const value = typeof val === 'object' ? JSON.stringify(val, null, 2) : String(val);
          detail.appendChild(h('div', { class: 'room-exit-doc-history-field' },
            h('span', { class: 'room-exit-doc-history-field-label' }, label),
            h('div', { class: 'room-exit-doc-history-field-value' }, value.length > 200 ? value.slice(0, 200) + '...' : value)
          ));
        }
        row.appendChild(detail);
      });

      container.appendChild(row);
    }
  }

  // ── Citations / Backlinks ──────────────────────────────────────

  _buildCitationsSection(room) {
    const section = h('div', { class: 'room-citations-section' },
      h('h4', null, 'Cross-Room Citations')
    );
    const container = h('div', {
      class: 'room-citations-list',
      'data-testid': 'room-citations'
    });
    container.appendChild(h('div', { class: 'room-citations-loading' }, 'Loading citations...'));
    section.appendChild(container);
    return section;
  }

  async _fetchCitations(roomId) {
    if (!window.overlordSocket) return;
    try {
      const [citResult, blResult] = await Promise.all([
        window.overlordSocket.emitWithAck('citations:list', { roomId }),
        window.overlordSocket.emitWithAck('citations:backlinks', { roomId }),
      ]);
      if (citResult && citResult.ok) this._citations = citResult.data || [];
      if (blResult && blResult.ok) this._backlinks = blResult.data || [];

      const modalBody = Modal.getBody(`room-${roomId}`);
      if (modalBody) {
        const el = modalBody.querySelector('[data-testid="room-citations"]');
        if (el) this._renderCitations(el);
      }
    } catch {
      // Citations are supplementary — silent fail
    }
  }

  _renderCitations(container) {
    container.textContent = '';

    if (this._backlinks.length === 0 && this._citations.length === 0) {
      container.appendChild(h('div', { class: 'room-citations-empty' },
        'No cross-room citations yet'
      ));
      return;
    }

    // Backlinks — "Cited by" (incoming references from other rooms)
    if (this._backlinks.length > 0) {
      container.appendChild(h('div', { class: 'room-citations-group-header' },
        `Cited by (${this._backlinks.length})`
      ));
      for (const bl of this._backlinks.slice(0, 10)) {
        container.appendChild(h('div', { class: 'room-citation-row room-citation-incoming' },
          h('span', { class: 'room-citation-icon' }, '\u2190'),
          h('span', { class: 'room-citation-room' }, bl.sourceRoomId),
          h('span', { class: 'room-citation-type badge' }, bl.targetType),
          h('span', { class: 'room-citation-time' }, formatTime(bl.createdAt))
        ));
      }
    }

    // Outgoing — citations this room made
    const outgoing = this._citations.filter(c => c.sourceRoomId === this._roomData?.id);
    if (outgoing.length > 0) {
      container.appendChild(h('div', { class: 'room-citations-group-header' },
        `References (${outgoing.length})`
      ));
      for (const cit of outgoing.slice(0, 10)) {
        container.appendChild(h('div', { class: 'room-citation-row room-citation-outgoing' },
          h('span', { class: 'room-citation-icon' }, '\u2192'),
          h('span', { class: 'room-citation-room' }, cit.targetRoomId),
          h('span', { class: 'room-citation-type badge' }, cit.targetType),
          h('span', { class: 'room-citation-time' }, formatTime(cit.createdAt))
        ));
      }
    }
  }

  // ── Interactive Actions ─────────────────────────────────────────

  /** Open modal to assign an agent to this room. */
  async _openAssignAgentModal(room) {
    if (!window.overlordSocket) {
      Toast.error('Not connected to server');
      return;
    }

    // Fetch all agents and filter to unassigned ones
    const store = OverlordUI.getStore();
    const allAgents = store?.get('agents.list') || [];
    const agentsInRoom = room.agents || [];
    const assignedIds = new Set(agentsInRoom.map(a => a.id));
    const available = allAgents.filter(a => !assignedIds.has(a.id));

    // Get table types from room contract
    const tableTypes = room.tables ? Object.keys(room.tables) : ['focus'];
    let selectedAgent = null;
    let selectedTable = tableTypes[0] || 'focus';

    const container = h('div', { class: 'assign-agent-modal' });

    // Guidance
    container.appendChild(h('div', { class: 'assign-agent-guidance' },
      h('p', null, `Assign an agent to `),
      h('strong', null, room.name || this._formatRoomType(room.type)),
      h('span', null, '. The agent will gain access to this room\'s tools and participate in its workflow.')
    ));

    if (available.length === 0) {
      container.appendChild(h('div', { class: 'assign-agent-empty' },
        h('span', { class: 'assign-agent-empty-icon' }, '\u{1F916}'),
        h('p', null, 'No agents available to assign.'),
        h('p', { class: 'text-muted' }, 'All registered agents are already in rooms, or no agents have been created yet. Create an agent first from the Agents panel.')
      ));

      Modal.open('assign-agent', {
        title: 'Assign Agent',
        content: container,
        size: 'md',
        position: window.innerWidth < 768 ? 'fullscreen' : 'center',
      });
      return;
    }

    // Agent picker
    container.appendChild(h('label', { class: 'form-label' }, 'Select Agent'));
    const agentList = h('div', { class: 'assign-agent-list' });

    for (const agent of available) {
      const card = h('div', {
        class: `assign-agent-card${selectedAgent === agent.id ? ' selected' : ''}`,
        'data-agent-id': agent.id
      },
        h('div', { class: 'assign-agent-avatar' }, (agent.name || '?')[0].toUpperCase()),
        h('div', { class: 'assign-agent-info' },
          h('div', { class: 'assign-agent-name' }, agent.name || agent.id),
          h('div', { class: 'assign-agent-role text-muted' }, agent.role || 'agent'),
          agent.current_room_id
            ? h('div', { class: 'assign-agent-current text-muted' }, `Currently in another room`)
            : h('div', { class: 'assign-agent-current text-muted' }, 'Unassigned')
        )
      );

      card.addEventListener('click', () => {
        selectedAgent = agent.id;
        agentList.querySelectorAll('.assign-agent-card').forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
      });

      agentList.appendChild(card);
    }
    container.appendChild(agentList);

    // Table type selector (if room has multiple table types)
    if (tableTypes.length > 1) {
      const tableGroup = h('div', { class: 'assign-agent-field' });
      tableGroup.appendChild(h('label', { class: 'form-label' }, 'Table Type'));
      const tableSelect = h('select', { class: 'form-input' });
      for (const tt of tableTypes) {
        const config = room.tables[tt] || {};
        const opt = h('option', { value: tt }, `${tt} (${config.chairs || 1} chair${(config.chairs || 1) > 1 ? 's' : ''})`);
        if (tt === selectedTable) opt.selected = true;
        tableSelect.appendChild(opt);
      }
      tableSelect.addEventListener('change', () => { selectedTable = tableSelect.value; });
      tableGroup.appendChild(tableSelect);
      container.appendChild(tableGroup);
    }

    // Actions
    const actions = h('div', { class: 'assign-agent-actions' });
    const cancelBtn = h('button', { class: 'btn btn-ghost btn-md' }, 'Cancel');
    cancelBtn.addEventListener('click', () => Modal.close('assign-agent'));

    const assignBtn = h('button', { class: 'btn btn-primary btn-md' }, 'Assign Agent');
    assignBtn.addEventListener('click', async () => {
      if (!selectedAgent) {
        Toast.warning('Please select an agent');
        return;
      }

      assignBtn.disabled = true;
      assignBtn.textContent = 'Assigning...';

      try {
        const result = await window.overlordSocket.moveAgent(selectedAgent, room.id, selectedTable);
        if (result && result.ok) {
          Toast.success('Agent assigned to room');
          Modal.close('assign-agent');
          // Reload room data to update the view
          this._loadRoom(room.id);
        } else {
          throw new Error(result?.error?.message || 'Assignment failed');
        }
      } catch (err) {
        Toast.error(`Assign failed: ${err.message}`);
        assignBtn.disabled = false;
        assignBtn.textContent = 'Assign Agent';
      }
    });

    actions.appendChild(cancelBtn);
    actions.appendChild(assignBtn);
    container.appendChild(actions);

    Modal.open('assign-agent', {
      title: `Assign Agent to ${room.name || this._formatRoomType(room.type)}`,
      content: container,
      size: 'md',
      position: window.innerWidth < 768 ? 'fullscreen' : 'center',
    });
  }

  /** Remove an agent from this room. */
  async _removeAgentFromRoom(agentId, roomId) {
    if (!window.overlordSocket) return;

    try {
      const result = await window.overlordSocket.exitRoom(roomId, agentId);
      if (result && result.ok) {
        Toast.success('Agent removed from room');
        this._loadRoom(roomId);
      } else {
        Toast.error(result?.error?.message || 'Failed to remove agent');
      }
    } catch (err) {
      Toast.error(`Remove failed: ${err.message}`);
    }
  }

  /** Open modal to add a table to the room. */
  _openAddTableModal(room) {
    let tableType = 'focus';
    let chairs = 1;
    let description = '';

    const container = h('div', { class: 'add-table-modal' });

    container.appendChild(h('div', { class: 'add-table-guidance' },
      h('p', null, 'Add a new table to this room. Tables define seating capacity for agents.'),
      h('p', { class: 'text-muted' }, 'Each table has a type (e.g., focus, pair, review) and a number of chairs limiting how many agents can sit there.')
    ));

    // Type input
    const typeGroup = h('div', { class: 'add-table-field' });
    typeGroup.appendChild(h('label', { class: 'form-label' }, 'Table Type'));
    const typeInput = h('input', { class: 'form-input', type: 'text', value: 'focus', placeholder: 'e.g., focus, pair, review' });
    typeInput.addEventListener('input', () => { tableType = typeInput.value; });
    typeGroup.appendChild(typeInput);
    container.appendChild(typeGroup);

    // Chairs input
    const chairGroup = h('div', { class: 'add-table-field' });
    chairGroup.appendChild(h('label', { class: 'form-label' }, 'Chairs (max agents)'));
    const chairInput = h('input', { class: 'form-input', type: 'number', value: '1', min: '1', max: '20' });
    chairInput.addEventListener('input', () => { chairs = parseInt(chairInput.value) || 1; });
    chairGroup.appendChild(chairInput);
    container.appendChild(chairGroup);

    // Description
    const descGroup = h('div', { class: 'add-table-field' });
    descGroup.appendChild(h('label', { class: 'form-label' }, 'Description (optional)'));
    const descInput = h('input', { class: 'form-input', type: 'text', placeholder: 'What is this table for?' });
    descInput.addEventListener('input', () => { description = descInput.value; });
    descGroup.appendChild(descInput);
    container.appendChild(descGroup);

    // Actions
    const actions = h('div', { class: 'add-table-actions' });
    const cancelBtn = h('button', { class: 'btn btn-ghost btn-md' }, 'Cancel');
    cancelBtn.addEventListener('click', () => Modal.close('add-table'));

    const createBtn = h('button', { class: 'btn btn-primary btn-md' }, 'Create Table');
    createBtn.addEventListener('click', async () => {
      if (!tableType.trim()) {
        Toast.warning('Please enter a table type');
        return;
      }
      if (!window.overlordSocket) {
        Toast.error('Not connected to server');
        return;
      }

      createBtn.disabled = true;
      createBtn.textContent = 'Creating...';

      try {
        const result = await window.overlordSocket.createTable(room.id, tableType.trim(), chairs, description.trim() || undefined);
        if (result && result.ok) {
          Toast.success(`Table "${tableType}" created`);
          Modal.close('add-table');
          this._loadRoom(room.id);
        } else {
          throw new Error(result?.error?.message || 'Failed to create table');
        }
      } catch (err) {
        Toast.error(`Create failed: ${err.message}`);
        createBtn.disabled = false;
        createBtn.textContent = 'Create Table';
      }
    });

    actions.appendChild(cancelBtn);
    actions.appendChild(createBtn);
    container.appendChild(actions);

    Modal.open('add-table', {
      title: 'Add Table',
      content: container,
      size: 'sm',
      position: window.innerWidth < 768 ? 'fullscreen' : 'center',
    });
  }

  /** Open modal to edit a table's configuration. */
  _openEditTableModal(table, room) {
    let editType = table.type || 'focus';
    let editChairs = table.chairs || 1;
    let editDescription = table.description || '';

    const container = h('div', { class: 'edit-table-modal' });

    // Table ID (read-only)
    const idGroup = h('div', { class: 'edit-table-field' });
    idGroup.appendChild(h('label', { class: 'form-label' }, 'Table ID'));
    idGroup.appendChild(h('div', { class: 'form-input-readonly mono' }, table.id));
    container.appendChild(idGroup);

    // Type input
    const typeGroup = h('div', { class: 'edit-table-field' });
    typeGroup.appendChild(h('label', { class: 'form-label' }, 'Table Type'));
    const typeInput = h('input', {
      class: 'form-input',
      type: 'text',
      value: editType,
      placeholder: 'e.g., focus, pair, review'
    });
    typeInput.addEventListener('input', () => { editType = typeInput.value; });
    typeGroup.appendChild(typeInput);
    container.appendChild(typeGroup);

    // Chairs input
    const chairGroup = h('div', { class: 'edit-table-field' });
    chairGroup.appendChild(h('label', { class: 'form-label' }, 'Chairs (max agents)'));
    const chairInput = h('input', {
      class: 'form-input',
      type: 'number',
      value: String(editChairs),
      min: '1',
      max: '20'
    });
    chairInput.addEventListener('input', () => {
      const val = parseInt(chairInput.value);
      editChairs = val >= 1 && val <= 20 ? val : editChairs;
    });
    chairGroup.appendChild(chairInput);
    chairGroup.appendChild(h('span', { class: 'form-hint' },
      'Number of agents that can sit at this table simultaneously (1-20).'
    ));
    container.appendChild(chairGroup);

    // Description textarea
    const descGroup = h('div', { class: 'edit-table-field' });
    descGroup.appendChild(h('label', { class: 'form-label' }, 'Description'));
    const descInput = h('textarea', {
      class: 'form-input form-textarea',
      rows: '3',
      placeholder: 'What is this table used for?'
    });
    descInput.value = editDescription;
    descInput.addEventListener('input', () => { editDescription = descInput.value; });
    descGroup.appendChild(descInput);
    container.appendChild(descGroup);

    // Actions
    const actions = h('div', { class: 'edit-table-actions' });
    const cancelBtn = h('button', { class: 'btn btn-ghost btn-md' }, 'Cancel');
    cancelBtn.addEventListener('click', () => Modal.close('edit-table'));

    const saveBtn = h('button', { class: 'btn btn-primary btn-md' }, 'Save Changes');
    saveBtn.addEventListener('click', async () => {
      if (!editType.trim()) {
        Toast.warning('Table type cannot be empty');
        return;
      }
      if (!window.overlordSocket) {
        Toast.error('Not connected to server');
        return;
      }

      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving...';

      try {
        const updates = {
          type: editType.trim(),
          chairs: editChairs,
          description: editDescription.trim() || undefined,
        };

        const result = await window.overlordSocket.updateTable(table.id, updates);
        if (result && result.ok) {
          Toast.success(`Table "${editType}" updated`);
          Modal.close('edit-table');
          this._loadRoom(room.id);
        } else {
          throw new Error(result?.error?.message || 'Failed to update table');
        }
      } catch (err) {
        Toast.error(`Update failed: ${err.message}`);
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save Changes';
      }
    });

    actions.appendChild(cancelBtn);
    actions.appendChild(saveBtn);
    container.appendChild(actions);

    Modal.open('edit-table', {
      title: `Edit Table: ${table.type || 'Table'}`,
      content: container,
      size: 'sm',
      position: window.innerWidth < 768 ? 'fullscreen' : 'center',
    });
  }

  /** Open confirmation dialog to delete a table. */
  _openDeleteTableConfirm(table, room) {
    const container = h('div', { class: 'confirm-delete-modal' });

    container.appendChild(h('p', { class: 'confirm-delete-message' },
      `Are you sure you want to delete the "${table.type || 'Table'}" table?`
    ));

    // Show seated agents warning if any
    const agentsInRoom = room.agents || this._getAgentsInRoom(room.id);
    const seatedAgents = agentsInRoom.filter(a => a.current_table_id === table.id);

    const warning = h('div', { class: 'confirm-delete-warning' },
      h('span', { class: 'confirm-delete-warning-icon' }, '\u26A0\uFE0F'),
      h('div', null,
        h('p', null, 'This action cannot be undone.'),
        seatedAgents.length > 0
          ? h('p', null, `${seatedAgents.length} agent${seatedAgents.length !== 1 ? 's are' : ' is'} currently seated at this table and will be unseated.`)
          : h('p', null, 'The table and its configuration will be permanently removed.')
      )
    );
    container.appendChild(warning);

    const actions = h('div', { class: 'edit-table-actions' });
    const cancelBtn = h('button', { class: 'btn btn-ghost btn-md' }, 'Cancel');
    cancelBtn.addEventListener('click', () => Modal.close('delete-table-confirm'));

    const deleteBtn = h('button', { class: 'btn btn-danger btn-md' }, 'Delete Table');
    deleteBtn.addEventListener('click', async () => {
      if (!window.overlordSocket) {
        Toast.error('Not connected to server');
        return;
      }

      deleteBtn.disabled = true;
      deleteBtn.textContent = 'Deleting...';

      try {
        const result = await window.overlordSocket.deleteTable(table.id);
        if (result && result.ok) {
          Toast.success('Table deleted');
          Modal.close('delete-table-confirm');
          this._loadRoom(room.id);
        } else {
          throw new Error(result?.error?.message || 'Failed to delete table');
        }
      } catch (err) {
        Toast.error(`Delete failed: ${err.message}`);
        deleteBtn.disabled = false;
        deleteBtn.textContent = 'Delete Table';
      }
    });

    actions.appendChild(cancelBtn);
    actions.appendChild(deleteBtn);
    container.appendChild(actions);

    Modal.open('delete-table-confirm', {
      title: 'Delete Table',
      content: container,
      size: 'sm',
      position: window.innerWidth < 768 ? 'fullscreen' : 'center',
    });
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
  // ── Inline Styles (#220 + #221) ──────────────────────────────

  _injectStyles() {
    if (this._stylesInjected) return;
    this._stylesInjected = true;
    const style = document.createElement('style');
    style.setAttribute('data-component', 'room-view-enhanced');
    style.textContent = `
.rv-config-panel{margin-bottom:var(--sp-4,16px)}
.rv-config-grid{display:flex;flex-direction:column;gap:var(--sp-2,8px)}
.rv-config-row{display:flex;align-items:flex-start;gap:var(--sp-3,12px);padding:var(--sp-2,8px) 0;border-bottom:1px solid var(--surface-2,#2a2a2a)}
.rv-config-label{min-width:110px;font-size:var(--font-sm,.85rem);color:var(--text-2,#aaa);font-weight:500;flex-shrink:0}
.rv-config-value-wrap{display:flex;flex-direction:column;gap:2px;flex:1}
.rv-config-val{font-size:var(--font-sm,.85rem);color:var(--text-1,#eee)}
.rv-config-hint{font-size:var(--font-xs,.75rem);color:var(--text-3,#777)}
.rv-type-badge{display:inline-flex;align-items:center;gap:4px;padding:2px 10px;border-radius:var(--radius-sm,4px);font-size:var(--font-xs,.75rem);font-weight:600;color:#111;white-space:nowrap}
.rv-status-dot{font-size:var(--font-sm,.85rem);font-weight:500}
.rv-capacity-wrap{display:flex;align-items:center;gap:var(--sp-2,8px);width:100%}
.rv-capacity-bar{flex:1;height:8px;background:var(--surface-2,#2a2a2a);border-radius:4px;overflow:hidden}
.rv-capacity-fill{height:100%;border-radius:4px;transition:width .3s ease}
.rv-capacity-text{font-size:var(--font-xs,.75rem);color:var(--text-2,#aaa);white-space:nowrap}
.rv-tools-section{margin-bottom:var(--sp-4,16px)}
.rv-tools-empty{padding:var(--sp-3,12px);font-size:var(--font-sm,.85rem)}
.rv-tools-grid{display:flex;flex-wrap:wrap;gap:var(--sp-2,8px);padding:var(--sp-2,8px) 0}
.rv-tool-tag{display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border-radius:var(--radius-sm,4px);background:var(--surface-2,#2a2a2a);border:1px solid var(--surface-3,#3a3a3a);font-size:var(--font-xs,.75rem);color:var(--text-1,#eee)}
.rv-tool-name{font-family:var(--font-mono,monospace)}
.rv-tool-remove{background:none;border:none;color:var(--text-3,#777);cursor:pointer;font-size:10px;padding:0 2px;line-height:1;transition:color .15s}
.rv-tool-remove:hover{color:#ef5350}
.rv-rules-section{margin-bottom:var(--sp-4,16px)}
.rv-rules-empty{padding:var(--sp-3,12px);font-size:var(--font-sm,.85rem)}
.rv-rules-list{list-style:none;padding:0;margin:var(--sp-2,8px) 0;display:flex;flex-direction:column;gap:var(--sp-1,4px)}
.rv-rule-item{padding:var(--sp-2,8px) var(--sp-3,12px);background:var(--surface-1,#1a1a1a);border-left:3px solid var(--accent,#4fc3f7);border-radius:0 var(--radius-sm,4px) var(--radius-sm,4px) 0;font-size:var(--font-sm,.85rem);color:var(--text-1,#eee)}
.rv-exit-template-section{margin-bottom:var(--sp-4,16px)}
.rv-exit-fields{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:var(--sp-2,8px);padding:var(--sp-2,8px) 0}
.rv-exit-field-card{padding:var(--sp-2,8px) var(--sp-3,12px);background:var(--surface-1,#1a1a1a);border:1px solid var(--surface-3,#3a3a3a);border-radius:var(--radius-sm,4px)}
.rv-exit-field-name{font-size:var(--font-sm,.85rem);font-weight:500;color:var(--text-1,#eee)}
.rv-exit-field-meta{display:flex;gap:6px;margin-top:4px;align-items:center}
.rv-exit-field-type{font-size:var(--font-xs,.75rem)}
.rv-exit-field-req{font-size:var(--font-xs,.75rem);color:#ffb74d}
.rv-exit-json-toggle{margin-top:var(--sp-2,8px)}
.rv-exit-json{margin-top:var(--sp-2,8px);padding:var(--sp-3,12px);background:var(--surface-0,#111);border:1px solid var(--surface-2,#2a2a2a);border-radius:var(--radius-sm,4px);overflow-x:auto;font-family:var(--font-mono,monospace);font-size:var(--font-xs,.75rem);color:var(--text-2,#aaa);white-space:pre}
.rv-exit-json.hidden{display:none}
.rv-table-mgmt{margin-bottom:var(--sp-4,16px)}
.rv-tables-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:var(--sp-3,12px);padding:var(--sp-2,8px) 0}
.rv-tables-empty{padding:var(--sp-4,16px) 0;text-align:center}
.rv-tables-empty-text{font-size:var(--font-sm,.85rem);color:var(--text-2,#aaa);margin-bottom:var(--sp-3,12px)}
.rv-type-hints-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:var(--sp-2,8px);text-align:left}
.rv-type-hint-card{display:flex;gap:var(--sp-2,8px);align-items:flex-start;padding:var(--sp-2,8px);background:var(--surface-1,#1a1a1a);border-radius:var(--radius-sm,4px);border:1px dashed var(--surface-3,#3a3a3a)}
.rv-type-hint-icon{font-size:1.2rem;flex-shrink:0}
.rv-type-hint-text{display:flex;flex-direction:column;gap:2px;font-size:var(--font-xs,.75rem)}
.rv-table-card{background:var(--surface-1,#1a1a1a);border:1px solid var(--surface-3,#3a3a3a);border-radius:var(--radius-md,8px);overflow:hidden;transition:border-color .2s}
.rv-table-card:hover{border-color:var(--accent,#4fc3f7)}
.rv-table-card-header{display:flex;justify-content:space-between;align-items:center;padding:var(--sp-2,8px) var(--sp-3,12px);background:var(--surface-0,#111);border-bottom:1px solid var(--surface-2,#2a2a2a)}
.rv-table-card-title{display:flex;align-items:center;gap:var(--sp-2,8px)}
.rv-table-type-badge{display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:var(--radius-sm,4px);font-size:var(--font-xs,.75rem);font-weight:600;color:#111}
.rv-table-occupancy{font-size:var(--font-xs,.75rem);color:var(--text-2,#aaa);font-family:var(--font-mono,monospace)}
.rv-table-card-actions{display:flex;gap:4px}
.rv-table-action-danger:hover{color:#ef5350!important}
.rv-table-desc{padding:var(--sp-1,4px) var(--sp-3,12px);font-size:var(--font-xs,.75rem)}
.rv-table-surface{padding:var(--sp-3,12px)}
.rv-table-top{border:2px solid var(--surface-3,#3a3a3a);border-radius:var(--radius-md,8px);padding:var(--sp-3,12px);min-height:60px;background:repeating-linear-gradient(45deg,transparent,transparent 10px,rgba(255,255,255,.015) 10px,rgba(255,255,255,.015) 20px)}
.rv-chair-layout{display:flex;flex-wrap:wrap;gap:var(--sp-2,8px);justify-content:center;align-items:center}
.rv-chair{width:48px;height:48px;border-radius:50%;display:flex;flex-direction:column;align-items:center;justify-content:center;transition:all .2s;position:relative}
.rv-chair-empty{border:2px dashed var(--surface-3,#555);background:transparent}
.rv-chair-empty-icon{font-size:16px;color:var(--text-3,#555);line-height:1}
.rv-chair-occupied{border:2px solid #81c784;background:rgba(129,199,132,.1)}
.rv-chair-working{border-color:#4fc3f7;background:rgba(79,195,247,.1)}
.rv-chair-blocked{border-color:#ef5350;background:rgba(239,83,80,.1)}
.rv-chair-waiting{border-color:#ffb74d;background:rgba(255,183,77,.1)}
.rv-chair-avatar{font-size:14px;font-weight:700;color:var(--text-1,#eee);line-height:1}
.rv-chair-name{font-size:8px;color:var(--text-2,#aaa);max-width:44px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:center;line-height:1}
.rv-table-agents{border-top:1px solid var(--surface-2,#2a2a2a);padding:var(--sp-2,8px) var(--sp-3,12px)}
.rv-table-agent-row{display:flex;align-items:center;gap:var(--sp-2,8px);padding:var(--sp-1,4px) 0}
.rv-table-agent-dot{width:6px;height:6px;border-radius:50%;flex-shrink:0}
.rv-table-agent-dot-idle{background:var(--text-3,#777)}
.rv-table-agent-dot-working{background:#4fc3f7}
.rv-table-agent-dot-blocked{background:#ef5350}
.rv-table-agent-dot-waiting{background:#ffb74d}
.rv-table-agent-avatar{width:24px;height:24px;border-radius:50%;background:var(--surface-2,#2a2a2a);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:var(--text-1,#eee);flex-shrink:0}
.rv-table-agent-info{display:flex;flex-direction:column;flex:1;min-width:0}
.rv-table-agent-name{font-size:var(--font-sm,.85rem);color:var(--text-1,#eee)}
.rv-table-agent-role{font-size:var(--font-xs,.75rem)}
.rv-table-agent-status{font-size:var(--font-xs,.75rem);padding:1px 6px;border-radius:var(--radius-sm,4px);white-space:nowrap}
.rv-table-agent-status-idle{color:var(--text-3,#777)}
.rv-table-agent-status-working{color:#4fc3f7}
.rv-table-agent-status-blocked{color:#ef5350}
.rv-table-agent-status-waiting{color:#ffb74d}
.rv-contract-tables{margin-top:var(--sp-3,12px)}
.rv-contract-tables-header{font-size:var(--font-xs,.75rem);margin-bottom:var(--sp-2,8px)}
.rv-contract-table-item{display:flex;align-items:center;gap:var(--sp-2,8px);padding:var(--sp-1,4px) var(--sp-2,8px);font-size:var(--font-xs,.75rem)}
.rv-contract-table-icon{flex-shrink:0}
.rv-contract-table-name{font-weight:500;color:var(--text-1,#eee)}
.rv-add-table-modal{display:flex;flex-direction:column;gap:var(--sp-3,12px)}
.rv-type-picker{display:grid;grid-template-columns:repeat(2,1fr);gap:var(--sp-2,8px)}
.rv-type-picker-card{padding:var(--sp-3,12px);border:2px solid var(--surface-3,#3a3a3a);border-radius:var(--radius-md,8px);cursor:pointer;transition:all .2s;text-align:center;background:var(--surface-1,#1a1a1a)}
.rv-type-picker-card:hover{border-color:var(--accent,#4fc3f7)}
.rv-type-picker-card.selected{border-color:var(--accent,#4fc3f7);background:rgba(79,195,247,.08);box-shadow:0 0 0 1px var(--accent,#4fc3f7)}
.rv-type-picker-icon{font-size:1.5rem;margin-bottom:4px}
.rv-type-picker-label{font-weight:600;font-size:var(--font-sm,.85rem);color:var(--text-1,#eee)}
.rv-type-picker-desc{font-size:var(--font-xs,.75rem);margin-top:2px}
.rv-type-picker-chairs{font-size:var(--font-xs,.75rem);margin-top:4px}
.rv-chair-preview{padding:var(--sp-2,8px) 0;text-align:center}
.rv-chair-preview-row{justify-content:center}
.rv-chair-preview-label{font-size:var(--font-xs,.75rem);margin-top:var(--sp-1,4px)}
.rv-edit-config-modal,.rv-seat-agent-modal,.rv-add-tool-modal{display:flex;flex-direction:column;gap:var(--sp-3,12px)}
.rv-edit-field{display:flex;flex-direction:column;gap:var(--sp-1,4px)}
.rv-edit-readonly{display:flex;align-items:center;gap:var(--sp-2,8px);padding:var(--sp-2,8px);background:var(--surface-1,#1a1a1a);border-radius:var(--radius-sm,4px);border:1px solid var(--surface-2,#2a2a2a)}
.rv-edit-actions{display:flex;justify-content:flex-end;gap:var(--sp-2,8px);padding-top:var(--sp-3,12px);border-top:1px solid var(--surface-2,#2a2a2a)}
.rv-seat-agent-header{display:flex;align-items:center;gap:var(--sp-2,8px);padding-bottom:var(--sp-2,8px);border-bottom:1px solid var(--surface-2,#2a2a2a)}
.rv-seat-agent-empty{text-align:center;padding:var(--sp-4,16px);font-size:var(--font-sm,.85rem);color:var(--text-2,#aaa)}
@media(max-width:600px){.rv-config-row{flex-direction:column;gap:var(--sp-1,4px)}.rv-config-label{min-width:unset}.rv-tables-grid{grid-template-columns:1fr}.rv-type-picker{grid-template-columns:1fr}.rv-exit-fields{grid-template-columns:1fr}.rv-type-hints-grid{grid-template-columns:1fr}}
`;
    document.head.appendChild(style);
  }
}
