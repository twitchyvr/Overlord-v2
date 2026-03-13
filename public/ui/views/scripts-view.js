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
    this._listen('plugin:status-changed', (data) => {
      const idx = this._plugins.findIndex(p => p.id === data.pluginId);
      if (idx >= 0) {
        this._plugins[idx].status = data.status;
        this._renderGrid();
        if (this._selectedId === data.pluginId) this._renderDetail(this._plugins[idx]);
      }
    });
  }

  unmount() {
    if (this._drawer) this._drawer.unmount();
    if (this._tabs) this._tabs.unmount();
    super.unmount();
  }

  destroy() {
    this.unmount();
  }

  /* ── Layout ──────────────────────────── */

  _buildLayout() {
    const header = h('div', { class: 'scripts-header' },
      h('div', { class: 'scripts-header-top' },
        h('h2', { class: 'scripts-title' }, 'Scripts'),
        h('span', { class: 'scripts-subtitle' }, 'Manage automation scripts that enhance your project'),
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
      // Loaded time
      h('div', { class: 'scripts-detail-meta' },
        h('span', null, `Loaded: ${plugin.loadedAt ? formatTime(plugin.loadedAt) : 'Never'}`),
      ),
    );

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
      onLoad:         'When script starts',
      onUnload:       'When script stops',
      onRoomEnter:    'When agent enters a room',
      onRoomExit:     'When agent leaves a room',
      onToolExecute:  'When a tool runs',
      onPhaseAdvance: 'When phase changes',
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
