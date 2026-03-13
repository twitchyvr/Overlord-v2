/**
 * Overlord v2 — Scripts View
 *
 * Full-page script manager for browsing, configuring, and monitoring
 * Lua plugins. Non-technical users can manage scripts through an
 * intuitive dashboard without touching code or JSON.
 *
 * Data flows:
 *   - socket `plugin:list` — fetches all installed plugins
 *   - socket `plugin:get` — fetches single plugin detail
 *   - socket `plugin:toggle` — enable/disable a plugin
 *   - socket `plugin:config:get` / `plugin:config:set` — read/write config
 *   - engine event `plugin:status-changed` — live status updates
 *
 * Layout:
 *   ┌─────────────────────────────────────────┐
 *   │  Filter Bar  [All] [Active] [Paused] …  │
 *   │  Search: [________________]              │
 *   ├─────────────────────────────────────────┤
 *   │  Script Grid / List                      │
 *   │  ┌───────┐ ┌───────┐ ┌───────┐         │
 *   │  │ Card  │ │ Card  │ │ Card  │  …       │
 *   │  └───────┘ └───────┘ └───────┘         │
 *   ├─────────────────────────────────────────┤
 *   │  Detail Drawer (when a script is open)   │
 *   └─────────────────────────────────────────┘
 */

import { Component } from '../engine/component.js';
import { OverlordUI } from '../engine/engine.js';
import { h, formatTime } from '../engine/helpers.js';
import { Tabs } from '../components/tabs.js';
import { Drawer } from '../components/drawer.js';

/* ── Constants ─────────────────────────────────────── */

const STATUS_LABELS = {
  active:   'Active',
  loading:  'Loading',
  error:    'Error',
  unloaded: 'Paused',
};

const STATUS_COLORS = {
  active:   'var(--color-success, #22c55e)',
  loading:  'var(--color-warning, #eab308)',
  error:    'var(--color-error, #ef4444)',
  unloaded: 'var(--text-muted, #888)',
};

const CATEGORY_MAP = {
  'agent-activity-tracker': 'Agents',
  'auto-assign-agent':      'Agents',
  'agent-handoff':          'Agents',
  'agent-mood-system':      'Agents',
  'daily-standup':          'Project',
  'deadline-tracker':       'Project',
  'progress-dashboard':     'Project',
  'scope-creep-detector':   'Project',
  'time-estimator':         'Project',
  'todo-scanner':           'Code',
  'changelog-generator':    'Code',
  'dependency-watcher':     'Code',
  'code-complexity-alert':  'Code',
  'auto-phase-advance':     'Rooms',
  'exit-doc-validator':     'Rooms',
  'phase-gate-reporter':    'Rooms',
  'room-timer':             'Rooms',
  'email-digest':           'Comms',
  'escalation-notifier':    'Comms',
  'raid-summary':           'Comms',
  'export-to-markdown':     'Comms',
  'webhook-forwarder':      'Comms',
  'github-sync':            'Comms',
  'custom-dashboard-widget':'UI',
  'keyboard-shortcuts':     'UI',
  'theme-switcher':         'UI',
};

const CATEGORY_ICONS = {
  'Agents':  '\u{1F916}',
  'Project': '\u{1F4CA}',
  'Code':    '\u{1F4BB}',
  'Rooms':   '\u{1F3E0}',
  'Comms':   '\u{1F4E8}',
  'UI':      '\u{1F3A8}',
};

const PERMISSION_LABELS = {
  'room:read':     'View rooms',
  'room:write':    'Modify rooms',
  'tool:execute':  'Run tools',
  'agent:read':    'View agents',
  'bus:emit':      'Send events',
  'storage:read':  'Read data',
  'storage:write': 'Save data',
  'fs:read':       'Read files',
  'fs:write':      'Write files',
  'net:http':      'Internet access',
};

const FILTER_TABS = [
  { id: 'all',      label: 'All' },
  { id: 'active',   label: 'Active' },
  { id: 'paused',   label: 'Paused' },
  { id: 'error',    label: 'Errors' },
];

const TEMPLATES = [
  { id: 'blank',            label: 'Blank Script' },
  { id: 'room-hook',        label: 'Room Lifecycle Hook' },
  { id: 'tool-hook',        label: 'Tool Execution Hook' },
  { id: 'phase-hook',       label: 'Phase Gate Hook' },
  { id: 'dashboard-widget', label: 'Dashboard Widget' },
  { id: 'validator',        label: 'Exit Doc Validator' },
];

/* ── ScriptsView ───────────────────────────────────── */

export class ScriptsView extends Component {
  constructor(container) {
    super(container);
    this._plugins = [];
    this._filter = 'all';
    this._search = '';
    this._selectedId = null;
    this._drawer = null;
    this._tabs = null;
    this._gridEl = null;
    this._searchInput = null;
    this._countEl = null;
  }

  mount() {
    this._buildLayout();
    this._fetchPlugins();

    // Live status updates
    this._listeners.push(
      OverlordUI.subscribe('plugin:status-changed', (data) => {
        const idx = this._plugins.findIndex(p => p.id === data.pluginId);
        if (idx >= 0) {
          this._plugins[idx].status = data.status;
          this._renderGrid();
          if (this._selectedId === data.pluginId) this._renderDetail(this._plugins[idx]);
        }
      })
    );
  }

  unmount() {
    if (this._drawer) this._drawer.unmount();
    if (this._tabs) this._tabs.unmount();
    super.unmount();
  }

  destroy() {
    super.destroy();
  }

  /* ── Layout ──────────────────────────── */

  _buildLayout() {
    const createBtn = h('button', { class: 'scripts-create-btn', title: 'Create a new script' }, '+ New Script');
    createBtn.addEventListener('click', () => this._showCreateModal());

    const importBtn = h('button', { class: 'scripts-import-btn', title: 'Import a script' }, 'Import');
    importBtn.addEventListener('click', () => this._showImportDialog());

    const header = h('div', { class: 'scripts-header' },
      h('div', { class: 'scripts-header-top' },
        h('div', null,
          h('h2', { class: 'scripts-title' }, 'Scripts'),
          h('span', { class: 'scripts-subtitle' }, 'Manage automation scripts that enhance your project'),
        ),
        h('div', { class: 'scripts-header-actions' }, createBtn, importBtn),
      ),
    );

    // Filter tabs
    const tabsContainer = h('div', { class: 'scripts-tabs' });
    this._tabs = new Tabs(tabsContainer, {
      tabs: FILTER_TABS,
      activeTab: 'all',
      onTabChange: (tabId) => {
        this._filter = tabId;
        this._renderGrid();
      },
    });
    this._tabs.mount();

    // Search bar
    this._searchInput = h('input', {
      class: 'scripts-search',
      type: 'search',
      placeholder: 'Search scripts by name or description...',
      'aria-label': 'Search scripts',
    });
    this._searchInput.addEventListener('input', () => {
      this._search = this._searchInput.value.toLowerCase();
      this._renderGrid();
    });

    // Count indicator
    this._countEl = h('span', { class: 'scripts-count' });

    const toolbar = h('div', { class: 'scripts-toolbar' },
      tabsContainer,
      h('div', { class: 'scripts-toolbar-right' },
        this._searchInput,
        this._countEl,
      ),
    );

    // Grid
    this._gridEl = h('div', { class: 'scripts-grid', role: 'list', 'aria-label': 'Script list' });

    // Detail drawer
    const drawerContainer = h('div', { class: 'scripts-drawer-container' });
    this._drawer = new Drawer(drawerContainer, {
      position: 'right',
      width: '420px',
      onClose: () => { this._selectedId = null; this._highlightCard(null); },
    });

    this.el.appendChild(header);
    this.el.appendChild(toolbar);
    this.el.appendChild(h('div', { class: 'scripts-body' }, this._gridEl, drawerContainer));
  }

  /* ── Data ─────────────────────────────── */

  _fetchPlugins() {
    const socket = window.overlordSocket?.socket;
    if (!socket) {
      this._renderEmpty('Not connected to server');
      return;
    }

    socket.emit('plugin:list', {}, (res) => {
      if (res?.ok && res.data?.plugins) {
        this._plugins = res.data.plugins;
        this._renderGrid();
      } else {
        this._renderEmpty('No scripts installed');
      }
    });
  }

  /* ── Filtering ───────────────────────── */

  _getFilteredPlugins() {
    let list = [...this._plugins];

    // Status filter
    if (this._filter === 'active') list = list.filter(p => p.status === 'active');
    else if (this._filter === 'paused') list = list.filter(p => p.status === 'unloaded');
    else if (this._filter === 'error') list = list.filter(p => p.status === 'error');

    // Search filter
    if (this._search) {
      list = list.filter(p =>
        p.name.toLowerCase().includes(this._search) ||
        p.description.toLowerCase().includes(this._search) ||
        p.id.toLowerCase().includes(this._search)
      );
    }

    return list;
  }

  /* ── Grid Rendering ──────────────────── */

  _renderGrid() {
    const filtered = this._getFilteredPlugins();
    this._countEl.textContent = `${filtered.length} of ${this._plugins.length} scripts`;

    this._gridEl.textContent = '';
    if (filtered.length === 0) {
      this._gridEl.appendChild(
        h('div', { class: 'scripts-empty' },
          h('p', { class: 'scripts-empty-icon' }, '\u{1F4E6}'),
          h('p', { class: 'scripts-empty-text' },
            this._search ? 'No scripts match your search' : 'No scripts in this category'
          ),
        )
      );
      return;
    }

    for (const plugin of filtered) {
      this._gridEl.appendChild(this._buildCard(plugin));
    }
  }

  _buildCard(plugin) {
    const category = CATEGORY_MAP[plugin.id] || 'Other';
    const categoryIcon = CATEGORY_ICONS[category] || '\u{1F4E6}';
    const statusLabel = STATUS_LABELS[plugin.status] || plugin.status;
    const statusColor = STATUS_COLORS[plugin.status] || STATUS_COLORS.unloaded;

    const card = h('div', {
      class: `scripts-card ${this._selectedId === plugin.id ? 'selected' : ''}`,
      role: 'listitem',
      tabindex: '0',
      'aria-label': `${plugin.name} — ${statusLabel}`,
      'data-plugin-id': plugin.id,
    },
      // Top row: category + toggle
      h('div', { class: 'scripts-card-top' },
        h('span', { class: 'scripts-card-category' }, `${categoryIcon} ${category}`),
        this._buildToggle(plugin),
      ),
      // Name
      h('div', { class: 'scripts-card-name' }, plugin.name),
      // Description
      h('div', { class: 'scripts-card-desc' }, plugin.description),
      // Bottom: status + version
      h('div', { class: 'scripts-card-footer' },
        h('span', { class: 'scripts-card-status', style: `color: ${statusColor}` },
          h('span', { class: 'scripts-card-status-dot', style: `background: ${statusColor}` }),
          statusLabel,
        ),
        h('span', { class: 'scripts-card-version' }, `v${plugin.version}`),
      ),
    );

    // Click to open detail
    card.addEventListener('click', (e) => {
      if (e.target.closest('.scripts-toggle')) return; // Don't open detail when toggling
      this._selectedId = plugin.id;
      this._highlightCard(plugin.id);
      this._renderDetail(plugin);
      this._drawer.open();
    });

    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        card.click();
      }
    });

    return card;
  }

  _buildToggle(plugin) {
    const isActive = plugin.status === 'active';
    const toggle = h('label', { class: 'scripts-toggle', 'aria-label': `Toggle ${plugin.name}` },
      h('input', {
        type: 'checkbox',
        class: 'scripts-toggle-input',
        ...(isActive ? { checked: '' } : {}),
      }),
      h('span', { class: 'scripts-toggle-slider' }),
    );

    const input = toggle.querySelector('input');
    input.addEventListener('change', (e) => {
      e.stopPropagation();
      this._togglePlugin(plugin.id, input.checked);
    });

    return toggle;
  }

  _highlightCard(pluginId) {
    this._gridEl.querySelectorAll('.scripts-card').forEach(c => {
      c.classList.toggle('selected', c.dataset.pluginId === pluginId);
    });
  }

  /* ── Toggle ──────────────────────────── */

  _togglePlugin(pluginId, enabled) {
    const socket = window.overlordSocket?.socket;
    if (!socket) return;

    socket.emit('plugin:toggle', { pluginId, enabled }, (res) => {
      if (res?.ok) {
        const idx = this._plugins.findIndex(p => p.id === pluginId);
        if (idx >= 0) {
          this._plugins[idx].status = res.data.status;
          this._renderGrid();
          if (this._selectedId === pluginId) this._renderDetail(this._plugins[idx]);
        }
      }
    });
  }

  /* ── Detail Panel ────────────────────── */

  _renderDetail(plugin) {
    const category = CATEGORY_MAP[plugin.id] || 'Other';
    const categoryIcon = CATEGORY_ICONS[category] || '\u{1F4E6}';
    const statusLabel = STATUS_LABELS[plugin.status] || plugin.status;
    const statusColor = STATUS_COLORS[plugin.status] || STATUS_COLORS.unloaded;

    const content = h('div', { class: 'scripts-detail' },
      // Header
      h('div', { class: 'scripts-detail-header' },
        h('div', { class: 'scripts-detail-icon' }, categoryIcon),
        h('div', { class: 'scripts-detail-title-group' },
          h('h3', { class: 'scripts-detail-name' }, plugin.name),
          h('span', { class: 'scripts-detail-version' }, `v${plugin.version}`),
          h('span', { class: 'scripts-detail-author' }, `by ${plugin.author}`),
        ),
      ),
      // Status bar
      h('div', { class: 'scripts-detail-status-bar' },
        h('span', { class: 'scripts-detail-status', style: `color: ${statusColor}` },
          h('span', { class: 'scripts-card-status-dot', style: `background: ${statusColor}` }),
          statusLabel,
        ),
        this._buildToggle(plugin),
      ),
      // Description
      h('div', { class: 'scripts-detail-section' },
        h('h4', { class: 'scripts-detail-section-title' }, 'About'),
        h('p', { class: 'scripts-detail-desc' }, plugin.description),
      ),
      // Permissions
      h('div', { class: 'scripts-detail-section' },
        h('h4', { class: 'scripts-detail-section-title' }, 'Permissions'),
        this._buildPermissions(plugin.permissions),
      ),
      // Hooks
      h('div', { class: 'scripts-detail-section' },
        h('h4', { class: 'scripts-detail-section-title' }, 'Responds to'),
        this._buildHooks(plugin.hooks),
      ),
      // Error (if any)
      ...(plugin.error ? [
        h('div', { class: 'scripts-detail-section scripts-detail-error' },
          h('h4', { class: 'scripts-detail-section-title' }, 'Error'),
          h('p', { class: 'scripts-detail-error-text' }, plugin.error),
        ),
      ] : []),
      // Action buttons
      h('div', { class: 'scripts-detail-actions' },
        h('button', {
          class: 'scripts-action-btn',
          'data-action': 'view-source',
          title: 'View script source code',
        }, 'View Source'),
        h('button', {
          class: 'scripts-action-btn',
          'data-action': 'edit-script',
          title: plugin.isBuiltIn ? 'Fork built-in and edit' : 'Edit script',
        }, plugin.isBuiltIn ? 'Fork & Edit' : 'Edit Script'),
        h('button', {
          class: 'scripts-action-btn',
          'data-action': 'export',
          title: 'Export as .overlord-script bundle',
        }, 'Export'),
        ...(!plugin.isBuiltIn ? [h('button', {
          class: 'scripts-action-btn danger',
          'data-action': 'delete',
          title: 'Delete this script',
        }, 'Delete')] : []),
      ),
      // Loaded time
      h('div', { class: 'scripts-detail-meta' },
        h('span', null, `Loaded: ${plugin.loadedAt ? formatTime(plugin.loadedAt) : 'Never'}`),
        plugin.isBuiltIn ? h('span', { class: 'scripts-builtin-badge' }, 'Built-in') : null,
        plugin.engine ? h('span', { class: 'scripts-engine-badge' }, plugin.engine.toUpperCase()) : null,
      ),
    );

    // Wire action button handlers
    content.querySelector('[data-action="view-source"]')?.addEventListener('click', () => {
      OverlordUI.dispatch('navigate:script-editor', { pluginId: plugin.id });
    });
    content.querySelector('[data-action="edit-script"]')?.addEventListener('click', () => {
      OverlordUI.dispatch('navigate:script-editor', { pluginId: plugin.id });
    });
    content.querySelector('[data-action="export"]')?.addEventListener('click', () => {
      this._exportPlugin(plugin.id);
    });
    content.querySelector('[data-action="delete"]')?.addEventListener('click', () => {
      this._deletePlugin(plugin.id);
    });

    this._drawer.setContent(content);
  }

  _buildPermissions(permissions) {
    if (!permissions || permissions.length === 0) {
      return h('p', { class: 'scripts-detail-none' }, 'No special permissions needed');
    }
    const list = h('ul', { class: 'scripts-permission-list' });
    for (const perm of permissions) {
      const label = PERMISSION_LABELS[perm] || perm;
      list.appendChild(h('li', { class: 'scripts-permission-item' },
        h('span', { class: 'scripts-permission-icon' }, '\u{1F512}'),
        h('span', null, label),
      ));
    }
    return list;
  }

  _buildHooks(hooks) {
    if (!hooks || hooks.length === 0) {
      return h('p', { class: 'scripts-detail-none' }, 'No event hooks registered');
    }
    const HOOK_LABELS = {
      onLoad:              'When script starts',
      onUnload:            'When script stops',
      onRoomEnter:         'When agent enters a room',
      onRoomExit:          'When agent leaves a room',
      onToolExecute:       'When a tool runs',
      onPhaseAdvance:      'When phase changes',
      onPhaseGateEvaluate: 'Override phase gate decisions',
      onExitDocValidate:   'Override exit doc validation',
      onAgentAssign:       'Override agent assignment',
      onNotificationRule:  'Override notification routing',
      onProgressReport:    'Custom progress metrics',
      onBuildingCreate:    'When building is created',
    };
    const list = h('ul', { class: 'scripts-hook-list' });
    for (const hook of hooks) {
      list.appendChild(h('li', { class: 'scripts-hook-item' },
        h('span', { class: 'scripts-hook-icon' }, '\u26A1'),
        h('span', null, HOOK_LABELS[hook] || hook),
      ));
    }
    return list;
  }

  /* ── Create Script ───────────────────── */

  _showCreateModal() {
    const modal = h('div', { class: 'scripts-modal-overlay' },
      h('div', { class: 'scripts-modal' },
        h('h3', { class: 'scripts-modal-title' }, 'Create New Script'),
        h('div', { class: 'scripts-modal-field' },
          h('label', null, 'Script ID (kebab-case)'),
          h('input', { type: 'text', class: 'scripts-modal-input', id: 'create-id', placeholder: 'my-custom-script' }),
        ),
        h('div', { class: 'scripts-modal-field' },
          h('label', null, 'Display Name'),
          h('input', { type: 'text', class: 'scripts-modal-input', id: 'create-name', placeholder: 'My Custom Script' }),
        ),
        h('div', { class: 'scripts-modal-field' },
          h('label', null, 'Description'),
          h('input', { type: 'text', class: 'scripts-modal-input', id: 'create-desc', placeholder: 'What does this script do?' }),
        ),
        h('div', { class: 'scripts-modal-field' },
          h('label', null, 'Template'),
          h('select', { class: 'scripts-modal-select', id: 'create-template' },
            ...TEMPLATES.map(t => h('option', { value: t.id }, t.label)),
          ),
        ),
        h('div', { class: 'scripts-modal-actions' },
          h('button', { class: 'scripts-modal-btn cancel' }, 'Cancel'),
          h('button', { class: 'scripts-modal-btn primary' }, 'Create'),
        ),
      ),
    );

    // Cancel
    modal.querySelector('.cancel').addEventListener('click', () => modal.remove());
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });

    // Create
    modal.querySelector('.primary').addEventListener('click', () => {
      const id = modal.querySelector('#create-id').value.trim();
      const name = modal.querySelector('#create-name').value.trim();
      const description = modal.querySelector('#create-desc').value.trim();
      const template = modal.querySelector('#create-template').value;

      if (!id || !name) {
        OverlordUI.dispatch('toast', { message: 'ID and Name are required', type: 'warning' });
        return;
      }

      const socket = window.overlordSocket?.socket;
      if (!socket) return;

      socket.emit('plugin:create', { id, name, description, template }, (res) => {
        if (res?.ok) {
          modal.remove();
          this._fetchPlugins();
          OverlordUI.dispatch('toast', { message: `Script "${name}" created`, type: 'success' });
          // Open in editor
          OverlordUI.dispatch('navigate:script-editor', { pluginId: id });
        } else {
          OverlordUI.dispatch('toast', { message: `Failed: ${res?.error?.message}`, type: 'error' });
        }
      });
    });

    document.body.appendChild(modal);
    modal.querySelector('#create-id').focus();
  }

  /* ── Import ─────────────────────────── */

  _showImportDialog() {
    const modal = h('div', { class: 'scripts-modal-overlay' },
      h('div', { class: 'scripts-modal' },
        h('h3', { class: 'scripts-modal-title' }, 'Import Script'),
        h('div', { class: 'scripts-import-zone', tabindex: '0' },
          h('p', { class: 'scripts-import-icon' }, '\u{1F4E5}'),
          h('p', null, 'Drop a .overlord-script file here'),
          h('p', { class: 'scripts-import-or' }, 'or'),
          h('button', { class: 'scripts-import-file-btn' }, 'Choose File'),
          h('input', { type: 'file', class: 'scripts-import-file-input', accept: '.overlord-script', hidden: '' }),
        ),
        h('div', { class: 'scripts-modal-field' },
          h('label', null, 'Or paste bundle (base64)'),
          h('textarea', { class: 'scripts-modal-textarea', id: 'import-base64', placeholder: 'Paste base64 bundle here...', rows: '3' }),
        ),
        h('div', { class: 'scripts-modal-actions' },
          h('button', { class: 'scripts-modal-btn cancel' }, 'Cancel'),
          h('button', { class: 'scripts-modal-btn primary' }, 'Import'),
        ),
      ),
    );

    const zone = modal.querySelector('.scripts-import-zone');
    const fileInput = modal.querySelector('.scripts-import-file-input');

    // File button
    modal.querySelector('.scripts-import-file-btn').addEventListener('click', () => fileInput.click());

    // File selection
    fileInput.addEventListener('change', () => {
      if (fileInput.files.length > 0) {
        this._readFileAsBase64(fileInput.files[0], modal);
      }
    });

    // Drag and drop
    zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('drag-over'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      zone.classList.remove('drag-over');
      if (e.dataTransfer.files.length > 0) {
        this._readFileAsBase64(e.dataTransfer.files[0], modal);
      }
    });

    // Cancel
    modal.querySelector('.cancel').addEventListener('click', () => modal.remove());
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });

    // Import from textarea
    modal.querySelector('.primary').addEventListener('click', () => {
      const base64 = modal.querySelector('#import-base64').value.trim();
      if (base64) {
        this._importBundle(base64, modal);
      } else {
        OverlordUI.dispatch('toast', { message: 'No bundle data provided', type: 'warning' });
      }
    });

    document.body.appendChild(modal);
  }

  _readFileAsBase64(file, modal) {
    const reader = new FileReader();
    reader.onload = () => {
      // File content is the raw bundle — base64 encode it
      const base64 = btoa(reader.result);
      modal.querySelector('#import-base64').value = base64;
      this._importBundle(base64, modal);
    };
    reader.readAsBinaryString(file);
  }

  _importBundle(base64, modal) {
    const socket = window.overlordSocket?.socket;
    if (!socket) return;

    socket.emit('plugin:import', { bundle: base64 }, (res) => {
      if (res?.ok) {
        modal.remove();
        this._fetchPlugins();
        OverlordUI.dispatch('toast', {
          message: `Script "${res.data.manifest?.name || res.data.pluginId}" imported`,
          type: 'success',
        });
      } else {
        OverlordUI.dispatch('toast', { message: `Import failed: ${res?.error?.message}`, type: 'error' });
      }
    });
  }

  /* ── Export ─────────────────────────── */

  _exportPlugin(pluginId) {
    const socket = window.overlordSocket?.socket;
    if (!socket) return;

    socket.emit('plugin:export', { pluginId }, (res) => {
      if (res?.ok && res.data?.bundle) {
        // Trigger browser download
        const blob = new Blob([atob(res.data.bundle)], { type: 'application/octet-stream' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${pluginId}.overlord-script`;
        a.click();
        URL.revokeObjectURL(url);
        OverlordUI.dispatch('toast', { message: `Exported "${pluginId}"`, type: 'success' });
      } else {
        OverlordUI.dispatch('toast', { message: `Export failed: ${res?.error?.message}`, type: 'error' });
      }
    });
  }

  /* ── Delete ─────────────────────────── */

  _deletePlugin(pluginId) {
    if (!confirm(`Delete script "${pluginId}"? This cannot be undone.`)) return;

    const socket = window.overlordSocket?.socket;
    if (!socket) return;

    socket.emit('plugin:delete', { pluginId }, (res) => {
      if (res?.ok) {
        this._plugins = this._plugins.filter(p => p.id !== pluginId);
        this._selectedId = null;
        this._drawer.close();
        this._renderGrid();
        OverlordUI.dispatch('toast', { message: `Deleted "${pluginId}"`, type: 'success' });
      } else {
        OverlordUI.dispatch('toast', { message: `Delete failed: ${res?.error?.message}`, type: 'error' });
      }
    });
  }

  /* ── Empty State ─────────────────────── */

  _renderEmpty(msg) {
    this._gridEl.textContent = '';
    this._gridEl.appendChild(
      h('div', { class: 'scripts-empty' },
        h('p', { class: 'scripts-empty-icon' }, '\u{1F4E6}'),
        h('p', { class: 'scripts-empty-text' }, msg),
      )
    );
  }
}
