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
import { h, formatTime, escapeHtml, tip } from '../engine/helpers.js';
import { Modal } from '../components/modal.js';
import { Button } from '../components/button.js';
import { Toast } from '../components/toast.js';
import { EntityLink } from '../engine/entity-nav.js';


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

/** Room type → default tools mapping (#801). */
const ROOM_TYPE_DEFAULTS = {
  strategist: ['read_file','list_dir','search_files','web_search','record_note','recall_notes','session_note','create_task','create_raid_entry','create_milestone','search_library','get_document','list_library'],
  discovery: ['read_file','list_dir','web_search','fetch_webpage','record_note','recall_notes','session_note'],
  architecture: ['read_file','list_dir','web_search','fetch_webpage','record_note','recall_notes','session_note'],
  'code-lab': ['read_file','write_file','copy_file','patch_file','list_dir','bash','web_search','fetch_webpage','screenshot','analyze_screenshot','session_note','game_engine','dev_server','workspace_sandbox'],
  'testing-lab': ['read_file','list_dir','bash','qa_run_tests','qa_check_lint','qa_check_types','qa_check_coverage','qa_audit_deps','e2e_test','screenshot','analyze_screenshot','session_note'],
  review: ['read_file','list_dir','web_search','recall_notes','qa_run_tests','qa_check_lint','session_note'],
  deploy: ['read_file','list_dir','bash','github','qa_run_tests','session_note'],
  'war-room': ['read_file','write_file','patch_file','list_dir','bash','web_search','fetch_webpage','qa_run_tests','qa_check_lint','github','session_note'],
};

/** Agent status → CSS class suffix. */
const STATUS_CLASSES = {
  idle:     'idle',
  working:  'working',
  blocked:  'blocked',
  waiting:  'waiting',
};

/** Table type definitions for the tycoon-game aesthetic. */
const TABLE_TYPES = {
  focus:         { icon: '\u{1F3AF}', label: 'Focus',         color: '#4fc3f7', defaultChairs: 1, desc: 'Solo deep-work station. One agent, no distractions.' },
  collaboration: { icon: '\u{1F91D}', label: 'Collaboration', color: '#81c784', defaultChairs: 3, desc: 'Team table for 2\u20134 agents working together.' },
  review:        { icon: '\u{1F50D}', label: 'Review',        color: '#ffb74d', defaultChairs: 2, desc: 'Peer-review station. Structured critique and sign-off.' },
  boardroom:     { icon: '\u{1F3DB}\uFE0F', label: 'Boardroom',    color: '#ce93d8', defaultChairs: 6, desc: 'Large meeting table for 5+ agents. Strategy sessions.' },
};

/** File scope options with descriptions. */
const FILE_SCOPE_OPTIONS = [
  { value: 'assigned', label: 'Assigned files only', desc: 'Agent can only access files explicitly assigned to the room.' },
  { value: 'read-only', label: 'Read-only',          desc: 'Agent can read any file but cannot write.' },
  { value: 'full',     label: 'Full access',         desc: 'Agent has full read/write access to the project.' },
  { value: 'none',     label: 'None',                desc: 'No file system access at all.' },
];

/** AI provider options. */
const PROVIDER_OPTIONS = [
  { value: '',          label: 'Default (configured)' },
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'openai',    label: 'OpenAI' },
  { value: 'minimax',   label: 'MiniMax' },
  { value: 'ollama',    label: 'Ollama (local)' },
];


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
    this._tables = [];
    this._tasks = [];            // all building tasks (for table task counts)
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

    // Subscribe to tasks list (for table task count badges — #225)
    this.subscribe(store, 'tasks.list', (tasks) => {
      this._tasks = tasks || [];
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
    this._tables = [];
    this._openModal();
    this._fetchExitDocHistory(roomId);
    this._fetchCitations(roomId);
    this._fetchTables(roomId);
  }

  /** Fetch active tables for this room from the server. */
  async _fetchTables(roomId) {
    if (!window.overlordSocket) return;
    try {
      const result = await window.overlordSocket.fetchTables(roomId);
      if (result && result.ok && Array.isArray(result.data)) {
        this._tables = result.data;
        this._refreshTableSection();
      }
    } catch {
      // Tables are supplementary
    }
  }

  /** Re-render just the table management section in the open modal. */
  _refreshTableSection() {
    const modalBody = Modal.getBody(`room-${this._roomData?.id}`);
    if (!modalBody) return;
    const tableContainer = modalBody.querySelector('[data-testid="table-management"]');
    if (!tableContainer) return;
    tableContainer.textContent = '';
    const room = this._roomData;
    if (!room) return;
    const inner = this._buildTableManagementInner(room);
    tableContainer.appendChild(inner);
  }

  _openModal() {
    if (!this._roomData) return;
    const content = this._buildContent();
    const modalId = `room-${this._roomData.id}`;

    // If modal is already open, replace body content with fresh data
    const existingBody = Modal.getBody(modalId);
    if (existingBody) {
      existingBody.textContent = '';
      existingBody.appendChild(content);
      return;
    }

    Modal.open(modalId, {
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

    // ── Room Configuration Panel (#220) ──
    container.appendChild(this._buildConfigPanel(room));

    // ── Tools Configuration (#220) ──
    container.appendChild(this._buildToolsConfigSection(room));

    // ── Room Rules Display (#220) ──
    container.appendChild(this._buildRulesSection(room));

    // ── Stats summary bar ──
    container.appendChild(this._buildStatsBar(room));

    // ── Agent roster ──
    container.appendChild(this._buildAgentRoster(room));

    // ── Table & Seat Management (#221) ──
    container.appendChild(this._buildTableManagement(room));

    // ── Exit Template Display (#220) ──
    if (room.exitRequired && room.exitRequired.fields && room.exitRequired.fields.length > 0) {
      container.appendChild(this._buildExitTemplateSection(room));
      container.appendChild(this._buildExitDocSection(room));
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

  // ── Room Configuration Panel (#220) ──────────────────────────

  _buildConfigPanel(room) {
    const section = h('div', { class: 'rv-config-panel' });

    const header = h('div', { class: 'room-section-header' },
      h('h4', null, 'Room Configuration')
    );
    const actionsRow = h('div', { class: 'room-config-actions' });
    const editBtn = h('button', { class: 'btn btn-secondary btn-sm' }, '\u270E Edit Config');
    editBtn.addEventListener('click', () => this._openEditConfigModal(room));
    actionsRow.appendChild(editBtn);
    const deleteBtn = h('button', { class: 'btn btn-danger btn-sm' }, '\u2715 Delete');
    deleteBtn.addEventListener('click', () => this._openDeleteRoomConfirm(room));
    actionsRow.appendChild(deleteBtn);
    header.appendChild(actionsRow);
    section.appendChild(header);

    // Config grid
    const grid = h('div', { class: 'rv-config-grid' });

    // Type (read-only badge)
    const typeInfo = TABLE_TYPES[room.type] || {};
    grid.appendChild(this._configRow('Type',
      h('span', { class: 'rv-type-badge', style: `background:${typeInfo.color || 'var(--surface-2)'}` },
        `${ROOM_ICONS[room.type] || '\u{1F3E0}'} ${this._formatRoomType(room.type)}`
      ),
      'Room type is set by the building contract and cannot be changed.'
    ));

    // Name (display)
    grid.appendChild(this._configRow('Name',
      h('span', { class: 'rv-config-val' }, room.name || this._formatRoomType(room.type))
    ));

    // Status indicator
    const agentsInRoom = this._getAgentsInRoom(room.id);
    const statusText = agentsInRoom.length > 0 ? 'Active' : 'Empty';
    const statusColor = agentsInRoom.length > 0 ? '#81c784' : 'var(--text-3)';
    grid.appendChild(this._configRow('Status',
      h('span', { class: 'rv-status-dot', style: `color:${statusColor}` },
        `\u25CF ${statusText}`
      )
    ));

    // AI Provider
    const provLabel = PROVIDER_OPTIONS.find(p => p.value === (room.provider || ''))?.label || room.provider || 'Default';
    grid.appendChild(this._configRow(tip('AI Provider'),
      h('span', { class: 'rv-config-val' }, provLabel)
    ));

    // File Scope
    const scopeOpt = FILE_SCOPE_OPTIONS.find(s => s.value === room.fileScope) || FILE_SCOPE_OPTIONS[0];
    grid.appendChild(this._configRow(tip('File Scope'),
      h('span', { class: 'rv-config-val' }, scopeOpt.label),
      scopeOpt.desc
    ));

    // Capacity bar
    const totalChairs = this._getTotalChairs(room);
    const occupied = agentsInRoom.length;
    grid.appendChild(this._configRow('Capacity',
      this._buildCapacityBar(occupied, totalChairs),
      `${occupied} of ${totalChairs} chairs occupied across all tables.`
    ));

    section.appendChild(grid);
    return section;
  }

  _configRow(label, valueEl, hint) {
    const row = h('div', { class: 'rv-config-row' },
      h('span', { class: 'rv-config-label' }, label),
      h('div', { class: 'rv-config-value-wrap' },
        typeof valueEl === 'string' ? h('span', null, valueEl) : valueEl,
        hint ? h('span', { class: 'rv-config-hint' }, hint) : null
      )
    );
    return row;
  }

  _buildCapacityBar(occupied, total) {
    const pct = total > 0 ? Math.round((occupied / total) * 100) : 0;
    const barColor = pct > 80 ? '#ef5350' : pct > 50 ? '#ffb74d' : '#81c784';
    return h('div', { class: 'rv-capacity-wrap' },
      h('div', { class: 'rv-capacity-bar' },
        h('div', { class: 'rv-capacity-fill', style: `width:${pct}%;background:${barColor}` })
      ),
      h('span', { class: 'rv-capacity-text' }, `${occupied}/${total} (${pct}%)`)
    );
  }

  _getTotalChairs(room) {
    // Sum chairs from active tables
    const activeTables = this._tables.length > 0 ? this._tables : (room.activeTables || []);
    let total = 0;
    for (const t of activeTables) {
      total += (t.chairs || 1);
    }
    // Also count contract-defined tables if no active tables exist
    if (total === 0 && room.tables && typeof room.tables === 'object') {
      for (const cfg of Object.values(room.tables)) {
        total += (cfg?.chairs || 1);
      }
    }
    return total || 1;
  }

  /** Open the full edit configuration modal (#220). */
  _openEditConfigModal(room) {
    let editName = room.name || '';
    let editFileScope = room.fileScope || 'assigned';
    let editProvider = room.provider || '';
    let editTools = (room.tools || []).join(', ');

    const container = h('div', { class: 'rv-edit-config-modal' });

    // Name field
    const nameGroup = h('div', { class: 'rv-edit-field' });
    nameGroup.appendChild(h('label', { class: 'form-label' }, 'Room Name'));
    const nameInput = h('input', { class: 'form-input', type: 'text', value: editName, placeholder: 'e.g., Backend Code Lab' });
    nameInput.addEventListener('input', () => { editName = nameInput.value; });
    nameGroup.appendChild(nameInput);
    container.appendChild(nameGroup);

    // Type (read-only display)
    const typeGroup = h('div', { class: 'rv-edit-field' });
    typeGroup.appendChild(h('label', { class: 'form-label' }, 'Room Type'));
    const typeInfo = TABLE_TYPES[room.type] || {};
    typeGroup.appendChild(h('div', { class: 'rv-edit-readonly' },
      h('span', { class: 'rv-type-badge', style: `background:${typeInfo.color || 'var(--surface-2)'}` },
        `${ROOM_ICONS[room.type] || '\u{1F3E0}'} ${this._formatRoomType(room.type)}`
      ),
      h('span', { class: 'form-hint' }, 'Type is defined by the building contract and cannot be changed.')
    ));
    container.appendChild(typeGroup);

    // File Scope dropdown
    const scopeGroup = h('div', { class: 'rv-edit-field' });
    scopeGroup.appendChild(h('label', { class: 'form-label' }, tip('File Scope')));
    const scopeSelect = h('select', { class: 'form-input' });
    for (const opt of FILE_SCOPE_OPTIONS) {
      const optEl = h('option', { value: opt.value }, opt.label);
      if (opt.value === editFileScope) optEl.selected = true;
      scopeSelect.appendChild(optEl);
    }
    scopeSelect.addEventListener('change', () => { editFileScope = scopeSelect.value; });
    scopeGroup.appendChild(scopeSelect);
    scopeGroup.appendChild(h('span', { class: 'form-hint' },
      FILE_SCOPE_OPTIONS.find(o => o.value === editFileScope)?.desc || ''
    ));
    container.appendChild(scopeGroup);

    // AI Provider select
    const provGroup = h('div', { class: 'rv-edit-field' });
    provGroup.appendChild(h('label', { class: 'form-label' }, tip('AI Provider')));
    const provSelect = h('select', { class: 'form-input' });
    for (const opt of PROVIDER_OPTIONS) {
      const optEl = h('option', { value: opt.value }, opt.label);
      if (opt.value === editProvider) optEl.selected = true;
      provSelect.appendChild(optEl);
    }
    provSelect.addEventListener('change', () => { editProvider = provSelect.value; });
    provGroup.appendChild(provSelect);
    container.appendChild(provGroup);

    // Allowed Tools textarea
    const toolsGroup = h('div', { class: 'rv-edit-field' });
    toolsGroup.appendChild(h('label', { class: 'form-label' }, 'Allowed Tools'));
    const toolsInput = h('textarea', { class: 'form-input form-textarea', rows: '3', placeholder: 'read_file, write_file, search_code\n(comma-separated tool names)' });
    toolsInput.value = editTools;
    toolsInput.addEventListener('input', () => { editTools = toolsInput.value; });
    toolsGroup.appendChild(toolsInput);
    toolsGroup.appendChild(h('span', { class: 'form-hint' }, 'Comma-separated list of tools available in this room.'));
    container.appendChild(toolsGroup);

    // Actions
    const actions = h('div', { class: 'rv-edit-actions' });
    const cancelBtn = h('button', { class: 'btn btn-ghost btn-md' }, 'Cancel');
    cancelBtn.addEventListener('click', () => Modal.close('rv-edit-config'));

    const saveBtn = h('button', { class: 'btn btn-primary btn-md' }, 'Save Changes');
    saveBtn.addEventListener('click', async () => {
      if (!window.overlordSocket) { Toast.error('Not connected'); return; }
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving...';
      try {
        const updates = {
          name: editName.trim() || undefined,
          fileScope: editFileScope,
          provider: editProvider.trim() || undefined,
          allowedTools: editTools.split(',').map(t => t.trim()).filter(Boolean),
        };
        const result = await window.overlordSocket.updateRoom(room.id, updates);
        if (result && result.ok) {
          Toast.success('Room configuration updated');
          Modal.close('rv-edit-config');
          this._loadRoom(room.id);
        } else {
          throw new Error(result?.error?.message || 'Failed to update');
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

    Modal.open('rv-edit-config', {
      title: `Edit: ${room.name || this._formatRoomType(room.type)}`,
      content: container,
      size: 'md',
      position: window.innerWidth < 768 ? 'fullscreen' : 'center',
    });
  }

  /* _openEditRoomModal replaced by _openEditConfigModal above */

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
          EntityLink.agent(agent.agentId || agent.id, agent.display_name || agent.name || 'Agent'),
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

  // ── Tools Configuration (#220) ─────────────────────────────────

  _buildToolsConfigSection(room) {
    const tools = room.tools || [];
    const section = h('div', { class: 'rv-tools-section' });

    const header = h('div', { class: 'room-section-header' },
      h('h4', null, `Allowed Tools (${tools.length})`)
    );
    const addToolBtn = h('button', { class: 'btn btn-ghost btn-sm' }, '+ Add Tool');
    addToolBtn.addEventListener('click', () => this._openAddToolInput(room));
    header.appendChild(addToolBtn);
    section.appendChild(header);

    if (tools.length === 0) {
      section.appendChild(h('div', { class: 'rv-tools-empty text-muted' },
        'No tools configured. Agents in this room will have no tool access. Click "+ Add Tool" to grant tools.'
      ));
      return section;
    }

    const grid = h('div', { class: 'rv-tools-grid' });
    for (const tool of tools) {
      const tag = h('div', { class: 'rv-tool-tag' },
        h('span', { class: 'rv-tool-name' }, tool)
      );
      const removeBtn = h('button', { class: 'rv-tool-remove', title: `Remove ${tool}` }, '\u2715');
      removeBtn.addEventListener('click', () => this._confirmRemoveTool(room, tool));
      tag.appendChild(removeBtn);
      grid.appendChild(tag);
    }
    section.appendChild(grid);
    return section;
  }

  /** Add a single tool to the room's allowed list. */
  _openAddToolInput(room) {
    const container = h('div', { class: 'rv-add-tool-modal' });
    const existingTools = new Set(room.tools || []);
    let allTools = [];
    let searchTerm = '';

    const defaultTools = ROOM_TYPE_DEFAULTS[room.type] || [];

    container.appendChild(h('p', { class: 'text-muted', style: 'margin-bottom: 8px' },
      'Search and select tools to add to this room. Tools control what agents can do.'
    ));

    // Defaults button row (#801)
    if (defaultTools.length > 0) {
      const defaultsRow = h('div', { style: 'display:flex; gap:var(--sp-2); margin-bottom:var(--sp-2); align-items:center' });
      const applyDefaultsBtn = h('button', { class: 'btn btn-primary btn-sm' },
        `Apply ${room.type} Defaults (${defaultTools.length} tools)`
      );
      applyDefaultsBtn.addEventListener('click', async () => {
        applyDefaultsBtn.textContent = 'Applying...';
        applyDefaultsBtn.disabled = true;
        try {
          const merged = [...new Set([...existingTools, ...defaultTools])];
          const result = await window.overlordSocket.updateRoom(room.id, { allowedTools: merged });
          if (result?.ok) {
            for (const t of defaultTools) existingTools.add(t);
            Toast.success(`Applied ${defaultTools.length} default tools for ${room.type}`);
            renderTools();
          }
        } catch { Toast.error('Failed to apply defaults'); }
        applyDefaultsBtn.textContent = `Apply ${room.type} Defaults (${defaultTools.length} tools)`;
        applyDefaultsBtn.disabled = false;
      });
      defaultsRow.appendChild(applyDefaultsBtn);
      defaultsRow.appendChild(h('span', { style: 'font-size:var(--text-xs); color:var(--text-muted)' },
        'Adds recommended tools without removing existing ones'
      ));
      container.appendChild(defaultsRow);
    }

    // Search input
    const searchInput = h('input', {
      class: 'form-input',
      type: 'text',
      placeholder: 'Search tools by name or category...',
      style: 'margin-bottom: 8px',
    });
    container.appendChild(searchInput);

    // Tool list container
    const toolList = h('div', {
      class: 'rv-tool-picker-list',
      style: 'max-height: 320px; overflow-y: auto; border: 1px solid var(--border-primary); border-radius: 6px; padding: 4px;',
    });
    container.appendChild(toolList);

    const renderTools = () => {
      toolList.textContent = '';
      const filtered = allTools.filter(t =>
        !existingTools.has(t.name) &&
        (t.name.toLowerCase().includes(searchTerm) || t.category.toLowerCase().includes(searchTerm) || t.description.toLowerCase().includes(searchTerm))
      );
      if (filtered.length === 0) {
        toolList.appendChild(h('div', { style: 'padding: 12px; color: var(--text-muted); text-align: center;' },
          searchTerm ? 'No matching tools found' : 'All tools already added'));
        return;
      }
      let lastCategory = '';
      for (const tool of filtered) {
        if (tool.category !== lastCategory) {
          lastCategory = tool.category;
          toolList.appendChild(h('div', {
            style: 'padding: 4px 8px; font-size: 0.65rem; font-weight: 700; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; margin-top: 4px;',
          }, tool.category));
        }
        const row = h('div', {
          class: 'rv-tool-picker-item',
          style: 'display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-radius: 4px; cursor: pointer;',
        },
          h('span', { style: 'font-weight: 500; font-size: var(--text-sm); color: var(--text-primary);' }, tool.name),
          defaultTools.includes(tool.name)
            ? h('span', { style: 'font-size: 0.6rem; background: var(--c-primary, #3498db); color: white; padding: 1px 5px; border-radius: 3px; font-weight: 600;' }, 'REC')
            : null,
          h('span', { style: 'font-size: 0.7rem; color: var(--text-muted); flex: 1;' }, tool.description.slice(0, 60) + (tool.description.length > 60 ? '...' : '')),
        );
        row.addEventListener('mouseenter', () => { row.style.background = 'var(--bg-tertiary)'; });
        row.addEventListener('mouseleave', () => { row.style.background = ''; });
        row.addEventListener('click', async () => {
          row.style.opacity = '0.5';
          row.style.pointerEvents = 'none';
          try {
            const newTools = [...existingTools, tool.name];
            const result = await window.overlordSocket.updateRoom(room.id, { allowedTools: [...newTools] });
            if (result && result.ok) {
              existingTools.add(tool.name);
              Toast.success(`"${tool.name}" added`);
              renderTools();
            } else {
              throw new Error(result?.error?.message || 'Failed');
            }
          } catch (err) {
            Toast.error(`Failed: ${err.message}`);
            row.style.opacity = '1';
            row.style.pointerEvents = '';
          }
        });
        toolList.appendChild(row);
      }
    };

    searchInput.addEventListener('input', () => {
      searchTerm = searchInput.value.toLowerCase().trim();
      renderTools();
    });

    // Fetch all registered tools
    if (window.overlordSocket?.socket) {
      window.overlordSocket.socket.emit('tools:list-all', (res) => {
        if (res?.ok) {
          allTools = res.data || [];
          renderTools();
        } else {
          toolList.appendChild(h('div', { style: 'padding: 12px; color: var(--text-muted);' }, 'Failed to load tools'));
        }
      });
    }

    const actions = h('div', { class: 'rv-edit-actions', style: 'margin-top: 8px;' });
    const doneBtn = h('button', { class: 'btn btn-primary btn-md' }, 'Done');
    doneBtn.addEventListener('click', () => {
      Modal.close('rv-add-tool');
      this._loadRoom(room.id);
    });
    actions.appendChild(doneBtn);
    container.appendChild(actions);

    Modal.open('rv-add-tool', {
      title: 'Add Tools',
      content: container,
      size: 'md',
      position: window.innerWidth < 768 ? 'fullscreen' : 'center',
    });

    // Focus search input
    setTimeout(() => searchInput.focus(), 100);
  }

  /** Confirm before removing a tool from the room. */
  _confirmRemoveTool(room, toolName) {
    const content = h('div', null,
      h('p', null, `Remove "${toolName}" from this room?`),
      h('p', { class: 'text-muted', style: { marginTop: 'var(--sp-2)' } },
        'Agents in this room will no longer have access to this tool.')
    );
    const removeBtn = Button.create('Remove Tool', {
      variant: 'danger',
      onClick: () => { Modal.close('confirm-remove-tool'); this._removeTool(room, toolName); }
    });
    const cancelBtn = Button.create('Cancel', {
      variant: 'ghost',
      onClick: () => Modal.close('confirm-remove-tool')
    });
    content.appendChild(h('div', { style: { marginTop: 'var(--sp-3)', display: 'flex', gap: 'var(--sp-2)', justifyContent: 'flex-end' } }, cancelBtn, removeBtn));
    Modal.open('confirm-remove-tool', { title: 'Remove Tool', content, size: 'sm', position: 'center' });
  }

  /** Remove a tool from the room's allowed list. */
  async _removeTool(room, toolName) {
    if (!window.overlordSocket) { Toast.error('Not connected'); return; }
    const newTools = (room.tools || []).filter(t => t !== toolName);
    try {
      const result = await window.overlordSocket.updateRoom(room.id, { allowedTools: newTools });
      if (result && result.ok) {
        Toast.success(`Removed "${toolName}"`);
        this._loadRoom(room.id);
      } else {
        throw new Error(result?.error?.message || 'Failed');
      }
    } catch (err) {
      Toast.error(`Remove failed: ${err.message}`);
    }
  }

  // ── Room Rules Display (#220) ─────────────────────────────────

  _buildRulesSection(room) {
    const rules = room.rules || room.systemPromptRules || [];
    const section = h('div', { class: 'rv-rules-section' });

    section.appendChild(h('div', { class: 'room-section-header' },
      h('h4', null, `Room Rules (${Array.isArray(rules) ? rules.length : 0})`)
    ));

    if (!Array.isArray(rules) || rules.length === 0) {
      section.appendChild(h('div', { class: 'rv-rules-empty text-muted' },
        'No explicit rules defined for this room. Agent behavior is governed by the room type contract.'
      ));
      return section;
    }

    const list = h('ul', { class: 'rv-rules-list' });
    for (const rule of rules) {
      const text = typeof rule === 'string' ? rule : (rule.text || rule.description || JSON.stringify(rule));
      list.appendChild(h('li', { class: 'rv-rule-item' }, text));
    }
    section.appendChild(list);
    return section;
  }

  // ── Exit Template Display (#220) ──────────────────────────────

  _buildExitTemplateSection(room) {
    const exitReq = room.exitRequired;
    if (!exitReq || !exitReq.fields || exitReq.fields.length === 0) {
      return h('span');
    }

    const section = h('div', { class: 'rv-exit-template-section' });
    section.appendChild(h('div', { class: 'room-section-header' },
      h('h4', null, 'Exit Template')
    ));

    // Structured fields display
    const fieldsGrid = h('div', { class: 'rv-exit-fields' });
    for (const field of exitReq.fields) {
      const label = typeof field === 'string'
        ? field.replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase()).trim()
        : (field.label || field.name || 'Field');
      const type = typeof field === 'object' ? (field.type || 'text') : 'text';
      const required = typeof field === 'object' ? (field.required !== false) : true;

      fieldsGrid.appendChild(h('div', { class: 'rv-exit-field-card' },
        h('div', { class: 'rv-exit-field-name' }, label),
        h('div', { class: 'rv-exit-field-meta' },
          h('span', { class: 'rv-exit-field-type badge' }, type),
          required ? h('span', { class: 'rv-exit-field-req' }, 'required') : null
        )
      ));
    }
    section.appendChild(fieldsGrid);

    // JSON viewer toggle
    const toggleBtn = h('button', { class: 'btn btn-ghost btn-xs rv-exit-json-toggle' }, 'View as JSON');
    const jsonPre = h('pre', { class: 'rv-exit-json hidden' }, JSON.stringify(exitReq, null, 2));
    toggleBtn.addEventListener('click', () => {
      jsonPre.classList.toggle('hidden');
      toggleBtn.textContent = jsonPre.classList.contains('hidden') ? 'View as JSON' : 'Hide JSON';
    });
    section.appendChild(toggleBtn);
    section.appendChild(jsonPre);

    return section;
  }

  /* _buildFileScopeSection and _buildTablesSection removed -- replaced by config panel and table management */

  // ── Table & Seat Management (#221) ─────────────────────────────

  _buildTableManagement(room) {
    const section = h('div', { class: 'rv-table-mgmt' });

    const header = h('div', { class: 'room-section-header' },
      h('h4', null, 'Tables & Seating')
    );
    const addTableBtn = h('button', { class: 'btn btn-primary btn-sm' }, '+ Add Table');
    addTableBtn.addEventListener('click', () => this._openAddTableModal(room));
    header.appendChild(addTableBtn);
    section.appendChild(header);

    // Container for dynamic refresh
    const inner = h('div', { 'data-testid': 'table-management' });
    inner.appendChild(this._buildTableManagementInner(room));
    section.appendChild(inner);

    return section;
  }

  /** Inner content for table management -- called on initial render and refresh. */
  _buildTableManagementInner(room) {
    const frag = document.createDocumentFragment();
    const activeTables = this._tables.length > 0 ? this._tables : (room.activeTables || []);
    const agentsInRoom = room.agents || this._getAgentsInRoom(room.id);

    if (activeTables.length > 0) {
      const grid = h('div', { class: 'rv-tables-grid' });
      for (const table of activeTables) {
        const tableAgents = agentsInRoom.filter(a => a.current_table_id === table.id);
        grid.appendChild(this._buildTableCard(table, tableAgents, room));
      }
      frag.appendChild(grid);
    } else {
      // Empty state with table type hints
      const emptyState = h('div', { class: 'rv-tables-empty' });
      emptyState.appendChild(h('p', { class: 'rv-tables-empty-text' },
        'No tables yet. Add a table to start seating agents.'
      ));

      // Table type explanations
      const typeHints = h('div', { class: 'rv-type-hints-grid' });
      for (const [key, info] of Object.entries(TABLE_TYPES)) {
        typeHints.appendChild(h('div', { class: 'rv-type-hint-card' },
          h('span', { class: 'rv-type-hint-icon', style: `color:${info.color}` }, info.icon),
          h('div', { class: 'rv-type-hint-text' },
            h('strong', null, info.label),
            h('span', { class: 'text-muted' }, info.desc)
          )
        ));
      }
      emptyState.appendChild(typeHints);
      frag.appendChild(emptyState);
    }

    // Contract-defined tables (if any)
    if (room.tables && typeof room.tables === 'object' && Object.keys(room.tables).length > 0) {
      frag.appendChild(this._buildContractTables(room));
    }

    return frag;
  }

  /** Build a single table card with full management UI (#221). */
  _buildTableCard(table, tableAgents, room) {
    const chairCount = table.chairs || 1;
    const occupancy = tableAgents.length;
    const typeInfo = TABLE_TYPES[table.type] || TABLE_TYPES.focus;
    const typeColor = typeInfo?.color || '#4fc3f7';

    // Count tasks assigned to this table (#225)
    const tableTasks = this._tasks.filter(t => t.table_id === table.id);
    const taskCount = tableTasks.length;

    const card = h('div', { class: 'rv-table-card' });

    // ── Card header: type badge, occupancy, task badge, action buttons
    const cardHeader = h('div', { class: 'rv-table-card-header' });
    const titleGroup = h('div', { class: 'rv-table-card-title' },
      h('span', { class: 'rv-table-type-badge', style: `background:${typeColor}` },
        `${typeInfo?.icon || '\u{1F4CB}'} ${typeInfo?.label || table.type || 'Table'}`
      ),
      h('span', { class: 'rv-table-occupancy' }, `${occupancy}/${chairCount}`)
    );
    // Task count badge (clickable → opens task list for this table)
    if (taskCount > 0) {
      const taskBadge = h('span', {
        class: 'rv-table-task-badge',
        title: `${taskCount} task${taskCount !== 1 ? 's' : ''} assigned`
      }, `${taskCount} task${taskCount !== 1 ? 's' : ''}`);
      taskBadge.addEventListener('click', (e) => {
        e.stopPropagation();
        this._openTableTaskList(table, tableTasks);
      });
      titleGroup.appendChild(taskBadge);
    }
    cardHeader.appendChild(titleGroup);

    const cardActions = h('div', { class: 'rv-table-card-actions' });
    // Assign task button (#225)
    const assignTaskBtn = h('button', { class: 'btn btn-ghost btn-xs', title: 'Assign a task to this table' }, '\u{1F4CB} Task');
    assignTaskBtn.addEventListener('click', (e) => { e.stopPropagation(); this._openAssignTaskToTableModal(table, room); });
    cardActions.appendChild(assignTaskBtn);
    // Seat agent button
    if (occupancy < chairCount) {
      const seatBtn = h('button', { class: 'btn btn-ghost btn-xs', title: 'Seat an agent' }, '\u{1F4BA} Seat');
      seatBtn.addEventListener('click', (e) => { e.stopPropagation(); this._openSeatAgentModal(table, room); });
      cardActions.appendChild(seatBtn);
    }
    // Edit button
    const editBtn = h('button', { class: 'btn btn-ghost btn-xs', title: 'Edit table' }, '\u270E');
    editBtn.addEventListener('click', (e) => { e.stopPropagation(); this._openEditTableModal(table, room); });
    cardActions.appendChild(editBtn);
    // Delete button
    const delBtn = h('button', { class: 'btn btn-ghost btn-xs rv-table-action-danger', title: 'Delete table' }, '\u2715');
    delBtn.addEventListener('click', (e) => { e.stopPropagation(); this._openDeleteTableConfirm(table, room); });
    cardActions.appendChild(delBtn);
    cardHeader.appendChild(cardActions);
    card.appendChild(cardHeader);

    // Description
    if (table.description) {
      card.appendChild(h('div', { class: 'rv-table-desc text-muted' }, table.description));
    }

    // ── Table surface visualization with chair layout
    const surface = h('div', { class: 'rv-table-surface' });
    const tableTop = h('div', { class: 'rv-table-top', style: `border-color:${typeColor}` });

    // Chair circle layout
    const chairRow = h('div', { class: 'rv-chair-layout' });
    for (let i = 0; i < chairCount; i++) {
      const agent = tableAgents[i];
      if (agent) {
        // Occupied chair: solid green border
        const statusClass = STATUS_CLASSES[agent.status] || 'idle';
        const displayName = agent.display_name || agent.name || 'Agent';
        const chair = h('div', { class: `rv-chair rv-chair-occupied rv-chair-${statusClass}`, title: `${displayName} (${agent.status || 'idle'})` },
          h('div', { class: 'rv-chair-circle' },
            h('div', { class: 'rv-chair-avatar' }, (displayName)[0].toUpperCase()),
          ),
          h('div', { class: 'rv-chair-name' }, displayName)
        );
        chairRow.appendChild(chair);
      } else {
        // Empty chair: dashed border
        const chair = h('div', { class: 'rv-chair rv-chair-empty', title: 'Empty seat' },
          h('div', { class: 'rv-chair-circle' },
            h('div', { class: 'rv-chair-empty-icon' }, '+'),
          ),
          h('div', { class: 'rv-chair-name' }, 'Empty')
        );
        chairRow.appendChild(chair);
      }
    }
    tableTop.appendChild(chairRow);
    surface.appendChild(tableTop);
    card.appendChild(surface);

    // ── Seated agents detail list
    if (tableAgents.length > 0) {
      const agentList = h('div', { class: 'rv-table-agents' });
      for (const agent of tableAgents) {
        const statusClass = STATUS_CLASSES[agent.status] || 'idle';
        agentList.appendChild(h('div', { class: 'rv-table-agent-row' },
          h('div', { class: `rv-table-agent-dot rv-table-agent-dot-${statusClass}` }),
          h('div', { class: 'rv-table-agent-avatar' }, (agent.name || '?')[0].toUpperCase()),
          h('div', { class: 'rv-table-agent-info' },
            h('span', { class: 'rv-table-agent-name' }, agent.display_name || agent.name || 'Agent'),
            h('span', { class: 'rv-table-agent-role text-muted' }, agent.role || '')
          ),
          h('span', { class: `rv-table-agent-status rv-table-agent-status-${statusClass}` }, agent.status || 'idle')
        ));
      }
      card.appendChild(agentList);
    }

    return card;
  }

  /** Display contract-defined table types from the room definition. */
  _buildContractTables(room) {
    const section = h('div', { class: 'rv-contract-tables' });
    section.appendChild(h('div', { class: 'rv-contract-tables-header text-muted' },
      'Contract-defined table types (auto-created when agents are assigned):'
    ));
    for (const [name, config] of Object.entries(room.tables)) {
      const cfg = config || {};
      const typeInfo = TABLE_TYPES[name] || {};
      section.appendChild(h('div', { class: 'rv-contract-table-item' },
        h('span', { class: 'rv-contract-table-icon' }, typeInfo.icon || '\u{1F4CB}'),
        h('span', { class: 'rv-contract-table-name' }, name),
        h('span', { class: 'rv-contract-table-chairs text-muted' },
          `${cfg.chairs || 1} chair${(cfg.chairs || 1) > 1 ? 's' : ''}`
        ),
        cfg.description ? h('span', { class: 'rv-contract-table-desc text-muted' }, cfg.description) : null
      ));
    }
    return section;
  }

  /** Open modal to seat a specific agent at a specific table (#221). */
  _openSeatAgentModal(table, room) {
    const agentsInRoom = room.agents || this._getAgentsInRoom(room.id);
    const seatedAtTable = new Set(agentsInRoom.filter(a => a.current_table_id === table.id).map(a => a.id));
    const store = OverlordUI.getStore();
    const allAgents = store?.get('agents.list') || [];
    // Available = in room but not seated at this table, OR unassigned
    const available = allAgents.filter(a => !seatedAtTable.has(a.id));
    let selectedAgent = null;

    const container = h('div', { class: 'rv-seat-agent-modal' });
    const typeInfo = TABLE_TYPES[table.type] || TABLE_TYPES.focus;

    container.appendChild(h('div', { class: 'rv-seat-agent-header' },
      h('span', { class: 'rv-table-type-badge', style: `background:${typeInfo?.color || '#4fc3f7'}` },
        `${typeInfo?.icon || ''} ${typeInfo?.label || table.type || 'Table'}`
      ),
      h('span', { class: 'text-muted' },
        `${seatedAtTable.size} of ${table.chairs || 1} chairs occupied`
      )
    ));

    if (available.length === 0) {
      container.appendChild(h('div', { class: 'rv-seat-agent-empty' },
        h('p', null, 'No agents available to seat.'),
        h('p', { class: 'text-muted' }, 'Assign agents to this room first from the Agent Roster above.')
      ));
      Modal.open('rv-seat-agent', { title: 'Seat Agent', content: container, size: 'sm' });
      return;
    }

    const agentList = h('div', { class: 'assign-agent-list' });
    for (const agent of available) {
      const card = h('div', { class: 'assign-agent-card', 'data-agent-id': agent.id },
        h('div', { class: 'assign-agent-avatar' }, (agent.name || '?')[0].toUpperCase()),
        h('div', { class: 'assign-agent-info' },
          h('div', { class: 'assign-agent-name' }, agent.display_name || agent.name || 'Agent'),
          h('div', { class: 'assign-agent-role text-muted' }, agent.role || 'agent')
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

    const actions = h('div', { class: 'rv-edit-actions' });
    const cancelBtn = h('button', { class: 'btn btn-ghost btn-md' }, 'Cancel');
    cancelBtn.addEventListener('click', () => Modal.close('rv-seat-agent'));
    const seatBtn = h('button', { class: 'btn btn-primary btn-md' }, 'Seat Agent');
    seatBtn.addEventListener('click', async () => {
      if (!selectedAgent) { Toast.warning('Select an agent'); return; }
      if (!window.overlordSocket) { Toast.error('Not connected'); return; }
      seatBtn.disabled = true;
      seatBtn.textContent = 'Seating...';
      try {
        const result = await window.overlordSocket.moveAgent(selectedAgent, room.id, table.type || 'focus');
        if (result && result.ok) {
          Toast.success('Agent seated');
          Modal.close('rv-seat-agent');
          this._loadRoom(room.id);
        } else {
          throw new Error(result?.error?.message || 'Failed');
        }
      } catch (err) {
        Toast.error(`Seat failed: ${err.message}`);
        seatBtn.disabled = false;
        seatBtn.textContent = 'Seat Agent';
      }
    });
    actions.appendChild(cancelBtn);
    actions.appendChild(seatBtn);
    container.appendChild(actions);

    Modal.open('rv-seat-agent', {
      title: `Seat Agent at ${typeInfo?.label || table.type || 'Table'}`,
      content: container,
      size: 'md',
      position: window.innerWidth < 768 ? 'fullscreen' : 'center',
    });
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
    section.appendChild(h('h4', null, tip('Exit Document')));

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
      h('h4', null, tip('Cross-Room Citations'))
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

    // Check room access for each available agent (mirrors server checkRoomAccess logic)
    const roomType = room.type || '';
    const hasAccess = (agent) => {
      // Badge takes priority over room_access (server enforces same rule)
      if (agent.badge) {
        try {
          const badge = typeof agent.badge === 'string' ? JSON.parse(agent.badge) : agent.badge;
          if (badge && Array.isArray(badge.rooms)) {
            return badge.rooms.includes('*') || badge.rooms.includes(roomType);
          }
        } catch { /* malformed badge — fall through to room_access */ }
      }
      // Fallback to room_access array
      const access = agent.room_access || [];
      return access.includes('*') || access.includes(roomType);
    };

    // Sort: agents with access first, then those without
    const sorted = [...available].sort((a, b) => {
      const aOk = hasAccess(a) ? 0 : 1;
      const bOk = hasAccess(b) ? 0 : 1;
      return aOk - bOk;
    });

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

    // Inline error banner (hidden by default)
    const errorBanner = h('div', {
      class: 'assign-agent-error',
      style: { display: 'none' }
    });
    container.appendChild(errorBanner);

    // Agent picker
    container.appendChild(h('label', { class: 'form-label' }, 'Select Agent'));
    const agentList = h('div', { class: 'assign-agent-list' });

    for (const agent of sorted) {
      const agentHasAccess = hasAccess(agent);
      const card = h('div', {
        class: `assign-agent-card${selectedAgent === agent.id ? ' selected' : ''}${!agentHasAccess ? ' no-access' : ''}`,
        'data-agent-id': agent.id
      },
        h('div', { class: 'assign-agent-avatar' }, (agent.name || '?')[0].toUpperCase()),
        h('div', { class: 'assign-agent-info' },
          h('div', { class: 'assign-agent-name-row' },
            h('span', { class: 'assign-agent-name' }, agent.display_name || agent.name || 'Agent'),
            agentHasAccess
              ? h('span', { class: 'assign-agent-badge access-ok' }, 'Has Access')
              : h('span', { class: 'assign-agent-badge access-denied' }, 'No Access')
          ),
          h('div', { class: 'assign-agent-role text-muted' }, agent.role || 'agent'),
          agent.current_room_id
            ? h('div', { class: 'assign-agent-current text-muted' }, 'Currently in another room')
            : h('div', { class: 'assign-agent-current text-muted' }, 'Unassigned'),
          !agentHasAccess
            ? h('div', { class: 'assign-agent-access-hint text-muted' },
                `Access: ${(agent.room_access || []).join(', ') || 'none'} (needs "${roomType}")`)
            : null
        )
      );

      card.addEventListener('click', () => {
        selectedAgent = agent.id;
        // Hide error when selecting a different agent
        errorBanner.style.display = 'none';
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

      // Clear previous error
      errorBanner.style.display = 'none';

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
        // Show inline error banner (persistent, not auto-dismissing like toast)
        errorBanner.textContent = err.message;
        errorBanner.style.display = 'block';
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

  /** Open modal to add a table with type picker cards (#221). */
  _openAddTableModal(room) {
    let selectedType = 'focus';
    let chairs = TABLE_TYPES.focus.defaultChairs;
    let description = '';

    const container = h('div', { class: 'rv-add-table-modal' });

    // Type picker cards
    container.appendChild(h('label', { class: 'form-label' }, 'Select Table Type'));
    const typePicker = h('div', { class: 'rv-type-picker' });

    for (const [key, info] of Object.entries(TABLE_TYPES)) {
      const card = h('div', {
        class: `rv-type-picker-card${key === selectedType ? ' selected' : ''}`,
        'data-type': key
      },
        h('div', { class: 'rv-type-picker-icon', style: `color:${info.color}` }, info.icon),
        h('div', { class: 'rv-type-picker-label' }, info.label),
        h('div', { class: 'rv-type-picker-desc text-muted' }, info.desc),
        h('div', { class: 'rv-type-picker-chairs text-muted' }, `Default: ${info.defaultChairs} chair${info.defaultChairs > 1 ? 's' : ''}`)
      );
      card.addEventListener('click', () => {
        selectedType = key;
        chairs = info.defaultChairs;
        chairInput.value = String(chairs);
        typePicker.querySelectorAll('.rv-type-picker-card').forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        this._updateChairPreview(previewEl, chairs);
      });
      typePicker.appendChild(card);
    }
    container.appendChild(typePicker);

    // Chairs input
    const chairGroup = h('div', { class: 'rv-edit-field' });
    chairGroup.appendChild(h('label', { class: 'form-label' }, 'Number of Chairs'));
    const chairInput = h('input', { class: 'form-input', type: 'number', value: String(chairs), min: '1', max: '20' });
    chairInput.addEventListener('input', () => {
      const val = parseInt(chairInput.value);
      if (val >= 1 && val <= 20) {
        chairs = val;
        this._updateChairPreview(previewEl, chairs);
      }
    });
    chairGroup.appendChild(chairInput);
    container.appendChild(chairGroup);

    // Live chair preview
    const previewEl = h('div', { class: 'rv-chair-preview' });
    this._updateChairPreview(previewEl, chairs);
    container.appendChild(previewEl);

    // Description
    const descGroup = h('div', { class: 'rv-edit-field' });
    descGroup.appendChild(h('label', { class: 'form-label' }, 'Description (optional)'));
    const descInput = h('input', { class: 'form-input', type: 'text', placeholder: 'What is this table for?' });
    descInput.addEventListener('input', () => { description = descInput.value; });
    descGroup.appendChild(descInput);
    container.appendChild(descGroup);

    // Actions
    const actions = h('div', { class: 'rv-edit-actions' });
    const cancelBtn = h('button', { class: 'btn btn-ghost btn-md' }, 'Cancel');
    cancelBtn.addEventListener('click', () => Modal.close('rv-add-table'));

    const createBtn = h('button', { class: 'btn btn-primary btn-md' }, 'Create Table');
    createBtn.addEventListener('click', async () => {
      if (!window.overlordSocket) { Toast.error('Not connected'); return; }
      createBtn.disabled = true;
      createBtn.textContent = 'Creating...';
      try {
        const result = await window.overlordSocket.createTable(room.id, selectedType, chairs, description.trim() || undefined);
        if (result && result.ok) {
          Toast.success(`${TABLE_TYPES[selectedType]?.label || selectedType} table created`);
          Modal.close('rv-add-table');
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

    Modal.open('rv-add-table', {
      title: 'Add Table',
      content: container,
      size: 'md',
      position: window.innerWidth < 768 ? 'fullscreen' : 'center',
    });
  }

  /** Render a live preview of empty chairs in the add-table modal. */
  _updateChairPreview(container, count) {
    container.textContent = '';
    const row = h('div', { class: 'rv-chair-layout rv-chair-preview-row' });
    for (let i = 0; i < Math.min(count, 20); i++) {
      row.appendChild(h('div', { class: 'rv-chair rv-chair-empty' },
        h('div', { class: 'rv-chair-empty-icon' }, '+')
      ));
    }
    container.appendChild(row);
    container.appendChild(h('div', { class: 'rv-chair-preview-label text-muted' },
      `${count} chair${count > 1 ? 's' : ''}`
    ));
  }

  /** Open modal to edit a table's configuration (#221 enhanced). */
  _openEditTableModal(table, room) {
    let editChairs = table.chairs || 1;
    let editDescription = table.description || '';

    const container = h('div', { class: 'rv-edit-config-modal' });

    // Table name (read-only, derived from type)
    const tableLabel = table.description || table.type || 'Table';
    const idGroup = h('div', { class: 'rv-edit-field' });
    idGroup.appendChild(h('label', { class: 'form-label' }, 'Table'));
    idGroup.appendChild(h('div', { class: 'rv-edit-readonly' },
      h('span', null, tableLabel)
    ));
    container.appendChild(idGroup);

    // Type (read-only with badge)
    const typeInfo = TABLE_TYPES[table.type] || TABLE_TYPES.focus;
    const typeGroup = h('div', { class: 'rv-edit-field' });
    typeGroup.appendChild(h('label', { class: 'form-label' }, 'Table Type'));
    typeGroup.appendChild(h('div', { class: 'rv-edit-readonly' },
      h('span', { class: 'rv-table-type-badge', style: `background:${typeInfo?.color || '#4fc3f7'}` },
        `${typeInfo?.icon || ''} ${typeInfo?.label || table.type}`
      )
    ));
    container.appendChild(typeGroup);

    // Chairs input
    const chairGroup = h('div', { class: 'rv-edit-field' });
    chairGroup.appendChild(h('label', { class: 'form-label' }, 'Chairs (max agents)'));
    const chairInput = h('input', {
      class: 'form-input', type: 'number',
      value: String(editChairs), min: '1', max: '20'
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
    const descGroup = h('div', { class: 'rv-edit-field' });
    descGroup.appendChild(h('label', { class: 'form-label' }, 'Description'));
    const descInput = h('textarea', { class: 'form-input form-textarea', rows: '3', placeholder: 'What is this table used for?' });
    descInput.value = editDescription;
    descInput.addEventListener('input', () => { editDescription = descInput.value; });
    descGroup.appendChild(descInput);
    container.appendChild(descGroup);

    // Actions
    const actions = h('div', { class: 'rv-edit-actions' });
    const cancelBtn = h('button', { class: 'btn btn-ghost btn-md' }, 'Cancel');
    cancelBtn.addEventListener('click', () => Modal.close('edit-table'));

    const saveBtn = h('button', { class: 'btn btn-primary btn-md' }, 'Save Changes');
    saveBtn.addEventListener('click', async () => {
      if (!window.overlordSocket) { Toast.error('Not connected'); return; }
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving...';
      try {
        const updates = {
          chairs: editChairs,
          description: editDescription.trim() || undefined,
        };
        const result = await window.overlordSocket.updateTable(table.id, updates);
        if (result && result.ok) {
          Toast.success('Table updated');
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
      title: `Edit Table: ${typeInfo?.label || table.type || 'Table'}`,
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
  // ── Table Task Assignment (#225) ─────────────────────────────

  /**
   * Open a small modal listing all tasks assigned to a table.
   * Triggered by clicking the task count badge on a table card.
   */
  _openTableTaskList(table, tableTasks) {
    const typeInfo = TABLE_TYPES[table.type] || TABLE_TYPES.focus;
    const container = h('div', { class: 'room-table-tasklist-modal' });

    if (tableTasks.length === 0) {
      container.appendChild(h('div', { class: 'empty-state-inline' }, 'No tasks assigned to this table.'));
    } else {
      const list = h('div', { class: 'room-table-tasklist' });
      for (const task of tableTasks) {
        const statusClass = task.status || 'pending';
        const taskRow = h('div', { class: 'room-table-tasklist-item' },
          h('span', { class: `room-table-tasklist-status room-table-tasklist-status-${statusClass}` }),
          h('div', { class: 'room-table-tasklist-info' },
            h('span', { class: 'room-table-tasklist-title' }, task.title || 'Untitled'),
            h('span', { class: 'room-table-tasklist-meta text-muted' },
              `${task.priority || 'normal'} \u2022 ${task.status || 'pending'}`)
          ),
          (() => {
            const unassignBtn = h('button', {
              class: 'btn btn-ghost btn-xs rv-table-action-danger',
              title: 'Unassign from table'
            }, '\u2715');
            unassignBtn.addEventListener('click', (e) => {
              e.stopPropagation();
              const confirmContent = h('div', null,
                h('p', null, `Unassign "${task.title || 'this task'}" from the table?`),
                h('p', { class: 'text-muted', style: { marginTop: 'var(--sp-2)' } },
                  'The task will remain in the backlog but will no longer be assigned to this table.')
              );
              const confirmBtn = Button.create('Unassign', {
                variant: 'danger',
                onClick: async () => {
                  Modal.close('confirm-unassign-task');
                  if (!window.overlordSocket) return;
                  try {
                    const res = await window.overlordSocket.unassignTaskFromTable(task.id);
                    if (res && res.ok) {
                      Toast.success('Task unassigned from table');
                      Modal.close(`table-tasks-${table.id}`);
                    } else {
                      Toast.error(res?.error?.message || 'Failed to unassign task');
                    }
                  } catch {
                    Toast.error('Failed to unassign task');
                  }
                }
              });
              const cancelBtn = Button.create('Cancel', { variant: 'ghost', onClick: () => Modal.close('confirm-unassign-task') });
              confirmContent.appendChild(h('div', { style: { marginTop: 'var(--sp-3)', display: 'flex', gap: 'var(--sp-2)', justifyContent: 'flex-end' } }, cancelBtn, confirmBtn));
              Modal.open('confirm-unassign-task', { title: 'Unassign Task', content: confirmContent, size: 'sm', position: 'center' });
            });
            return unassignBtn;
          })()
        );
        list.appendChild(taskRow);
      }
      container.appendChild(list);
    }

    // Close button
    container.appendChild(h('div', { class: 'room-table-tasklist-actions' },
      (() => {
        const closeBtn = h('button', { class: 'btn btn-ghost btn-sm' }, 'Close');
        closeBtn.addEventListener('click', () => Modal.close(`table-tasks-${table.id}`));
        return closeBtn;
      })()
    ));

    Modal.open(`table-tasks-${table.id}`, {
      title: `Tasks: ${typeInfo?.label || table.type || 'Table'}`,
      content: container,
      size: 'sm',
      position: 'center'
    });
  }

  /**
   * Open a task picker modal showing unassigned tasks from the building.
   * Selecting a task assigns it to the given table.
   */
  _openAssignTaskToTableModal(table, room) {
    const unassignedTasks = this._tasks.filter(t => !t.table_id && t.status !== 'done');

    const container = h('div', { class: 'room-table-taskpicker-modal' });

    container.appendChild(h('p', { class: 'text-muted' },
      `Assign an unassigned task to the "${table.type || 'focus'}" table in ${room.name || this._formatRoomType(room.type)}.`));

    if (unassignedTasks.length === 0) {
      container.appendChild(h('div', { class: 'empty-state-inline' },
        'No unassigned tasks available. Create tasks first from the Tasks view.'));
    } else {
      // Search filter for task picker
      const searchInput = h('input', {
        class: 'form-input room-table-taskpicker-search',
        type: 'text',
        placeholder: 'Search tasks...'
      });
      container.appendChild(searchInput);

      const taskList = h('div', { class: 'room-table-taskpicker-list' });

      const renderTaskList = (filter) => {
        taskList.textContent = '';
        let filtered = unassignedTasks;
        if (filter) {
          const q = filter.toLowerCase();
          filtered = unassignedTasks.filter(t =>
            (t.title || '').toLowerCase().includes(q) ||
            (t.description || '').toLowerCase().includes(q)
          );
        }

        if (filtered.length === 0) {
          taskList.appendChild(h('div', { class: 'empty-state-inline' }, 'No matching tasks.'));
          return;
        }

        for (const task of filtered) {
          const taskItem = h('div', { class: 'room-table-taskpicker-item' });

          taskItem.appendChild(h('div', { class: 'room-table-taskpicker-item-info' },
            h('span', { class: 'room-table-taskpicker-item-title' }, task.title || 'Untitled'),
            h('span', { class: 'room-table-taskpicker-item-meta text-muted' },
              `${task.priority || 'normal'} \u2022 ${task.status || 'pending'}`)
          ));

          const assignBtn = h('button', { class: 'btn btn-secondary btn-sm' }, 'Assign');
          assignBtn.addEventListener('click', async () => {
            if (!window.overlordSocket) return;
            try {
              const res = await window.overlordSocket.assignTaskToTable(task.id, table.id);
              if (res && res.ok) {
                Toast.success(`Task "${task.title}" assigned to table`);
                Modal.close(`assign-task-table-${table.id}`);
              } else {
                Toast.error(res?.error?.message || 'Failed to assign task');
              }
            } catch {
              Toast.error('Failed to assign task to table');
            }
          });
          taskItem.appendChild(assignBtn);

          taskList.appendChild(taskItem);
        }
      };

      searchInput.addEventListener('input', (e) => renderTaskList(e.target.value));
      renderTaskList('');
      container.appendChild(taskList);
    }

    // Cancel button
    container.appendChild(h('div', { class: 'room-table-taskpicker-actions' },
      (() => {
        const cancelBtn = h('button', { class: 'btn btn-ghost btn-sm' }, 'Cancel');
        cancelBtn.addEventListener('click', () => Modal.close(`assign-task-table-${table.id}`));
        return cancelBtn;
      })()
    ));

    Modal.open(`assign-task-table-${table.id}`, {
      title: 'Assign Task to Table',
      content: container,
      size: 'md',
      position: 'center'
    });
  }
}
