/**
 * Overlord v2 — Global Search Component
 *
 * Command-palette style search that queries across all entity types.
 * Triggered by Cmd+K (Mac) / Ctrl+K (Win) or clicking the search icon.
 * Results grouped by type, each clickable to navigate.
 */

import { Component } from '../engine/component.js';
import { OverlordUI } from '../engine/engine.js';
import { h, debounce, escapeHtml } from '../engine/helpers.js';
import { createLogger } from '../engine/logger.js';

const log = createLogger('GlobalSearch');

/** Icon map for result types */
const TYPE_ICONS = {
  task: '\u2611',
  agent: '\u{1F916}',
  raid: '\u26A0',
  room: '\u{1F3E0}',
  milestone: '\u{1F3AF}',
  message: '\u{1F4AC}',
};

/** View routes for each type */
const TYPE_ROUTES = {
  task: 'tasks',
  agent: 'agents',
  raid: 'raid-log',
  room: 'chat',
  milestone: 'milestones',
  message: 'chat',
};

export class GlobalSearch extends Component {
  constructor(el, opts = {}) {
    super(el, opts);
    this._open = false;
    this._query = '';
    this._results = null;
    this._selectedIdx = -1;
    this._flatItems = [];
    this._overlayEl = null;
    this._inputEl = null;
    this._resultsEl = null;
    this._debouncedSearch = debounce(() => this._doSearch(), 250);
  }

  mount() {
    this._mounted = true;
    this._bindKeyboard();
    this._renderTrigger();
  }

  /** Render the search icon button in the toolbar */
  _renderTrigger() {
    this.el.textContent = '';
    const btn = h('button', {
      class: 'toolbar-btn-icon global-search-trigger',
      title: 'Search (Cmd+K)',
      'aria-label': 'Global search',
    }, '\u{1F50D}');
    btn.addEventListener('click', () => this.open());
    this.el.appendChild(btn);
  }

  /** Bind global keyboard shortcut */
  _bindKeyboard() {
    document.addEventListener('keydown', (e) => {
      // Cmd+K or Ctrl+K to open
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        this.toggle();
        return;
      }
      // "/" to open (only when not in an input)
      if (e.key === '/' && !this._open) {
        const tag = document.activeElement?.tagName;
        if (tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT') {
          e.preventDefault();
          this.open();
        }
      }
    });
  }

  toggle() {
    this._open ? this.close() : this.open();
  }

  open() {
    if (this._open) return;
    this._open = true;
    this._query = '';
    this._results = null;
    this._selectedIdx = -1;
    this._flatItems = [];
    this._renderOverlay();
  }

  close() {
    if (!this._open) return;
    this._open = false;
    if (this._overlayEl) {
      this._overlayEl.remove();
      this._overlayEl = null;
    }
  }

  _renderOverlay() {
    // Backdrop
    this._overlayEl = h('div', { class: 'global-search-overlay' });
    this._overlayEl.addEventListener('mousedown', (e) => {
      if (e.target === this._overlayEl) this.close();
    });

    // Modal container
    const modal = h('div', { class: 'global-search-modal' });

    // Search input row
    const inputRow = h('div', { class: 'global-search-input-row' });
    const icon = h('span', { class: 'global-search-icon' }, '\u{1F50D}');
    inputRow.appendChild(icon);

    this._inputEl = h('input', {
      class: 'global-search-input',
      type: 'text',
      placeholder: 'Search tasks, agents, RAID entries, rooms...',
      'aria-label': 'Global search',
    });

    this._inputEl.addEventListener('input', () => {
      this._query = this._inputEl.value;
      this._selectedIdx = -1;
      this._debouncedSearch();
    });

    this._inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { this.close(); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); this._moveSelection(1); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); this._moveSelection(-1); return; }
      if (e.key === 'Enter') { e.preventDefault(); this._activateSelection(); return; }
    });

    inputRow.appendChild(this._inputEl);

    const hint = h('span', { class: 'global-search-hint' }, 'ESC');
    inputRow.appendChild(hint);

    modal.appendChild(inputRow);

    // Filter chips
    const chips = h('div', { class: 'global-search-chips' });
    const types = [
      { id: 'task', label: 'Tasks' },
      { id: 'agent', label: 'Agents' },
      { id: 'raid', label: 'RAID' },
      { id: 'room', label: 'Rooms' },
      { id: 'milestone', label: 'Milestones' },
      { id: 'message', label: 'Messages' },
    ];
    this._activeFilters = new Set();

    for (const t of types) {
      const chip = h('button', {
        class: 'global-search-chip',
        'data-type': t.id,
      }, `${TYPE_ICONS[t.id] || ''} ${t.label}`);
      chip.addEventListener('click', () => {
        if (this._activeFilters.has(t.id)) {
          this._activeFilters.delete(t.id);
          chip.classList.remove('active');
        } else {
          this._activeFilters.add(t.id);
          chip.classList.add('active');
        }
        this._doSearch();
      });
      chips.appendChild(chip);
    }
    modal.appendChild(chips);

    // Results container
    this._resultsEl = h('div', { class: 'global-search-results' });
    this._resultsEl.appendChild(
      h('div', { class: 'global-search-empty' }, 'Type to search across your project...')
    );
    modal.appendChild(this._resultsEl);

    this._overlayEl.appendChild(modal);
    document.body.appendChild(this._overlayEl);

    // Focus input
    requestAnimationFrame(() => this._inputEl?.focus());
  }

  async _doSearch() {
    const query = this._query.trim();
    if (!query) {
      this._results = null;
      this._flatItems = [];
      this._renderResults();
      return;
    }

    const store = OverlordUI.getStore();
    const buildingId = store?.get('building.active');
    if (!buildingId || !window.overlordSocket) {
      this._renderError('Select a project first to search.');
      return;
    }

    const filters = [...(this._activeFilters || [])];
    const res = await window.overlordSocket.globalSearch(buildingId, query, filters, 10);

    if (res && res.ok) {
      this._results = res.data;
      this._buildFlatItems();
      this._renderResults();
    } else {
      this._renderError('Search failed. Please try again.');
    }
  }

  _buildFlatItems() {
    this._flatItems = [];
    if (!this._results || !this._results.groups) return;
    for (const group of this._results.groups) {
      for (const item of group.items) {
        this._flatItems.push({ type: group.type, item });
      }
    }
  }

  _renderResults() {
    if (!this._resultsEl) return;
    this._resultsEl.textContent = '';

    if (!this._results || !this._query.trim()) {
      this._resultsEl.appendChild(
        h('div', { class: 'global-search-empty' }, 'Type to search across your project...')
      );
      return;
    }

    if (this._results.groups.length === 0) {
      this._resultsEl.appendChild(
        h('div', { class: 'global-search-empty' }, `No results for "${escapeHtml(this._query)}"`)
      );
      return;
    }

    let flatIdx = 0;
    for (const group of this._results.groups) {
      const section = h('div', { class: 'global-search-group' });
      section.appendChild(
        h('div', { class: 'global-search-group-header' },
          h('span', { class: 'global-search-group-icon' }, group.icon),
          h('span', null, `${group.label} (${group.total})`)
        )
      );

      for (const item of group.items) {
        const idx = flatIdx++;
        const row = h('div', {
          class: `global-search-item${idx === this._selectedIdx ? ' selected' : ''}`,
          'data-idx': String(idx),
        });

        row.appendChild(this._renderItemContent(group.type, item));

        row.addEventListener('click', () => {
          this._navigateToItem(group.type, item);
        });
        row.addEventListener('mouseenter', () => {
          this._selectedIdx = idx;
          this._updateSelectionStyles();
        });
        section.appendChild(row);
      }

      this._resultsEl.appendChild(section);
    }
  }

  _renderItemContent(type, item) {
    const content = h('div', { class: 'global-search-item-content' });

    switch (type) {
      case 'task': {
        const statusClass = item.status === 'done' ? 'done' : item.status === 'in-progress' ? 'active' : '';
        content.appendChild(h('div', { class: 'global-search-item-title' }, item.title || 'Untitled task'));
        const meta = h('div', { class: 'global-search-item-meta' });
        if (item.status) meta.appendChild(h('span', { class: `search-badge ${statusClass}` }, item.status));
        if (item.priority && item.priority !== 'normal') meta.appendChild(h('span', { class: 'search-badge' }, item.priority));
        if (item.assignee_name) meta.appendChild(h('span', null, item.assignee_name));
        content.appendChild(meta);
        break;
      }
      case 'agent': {
        content.appendChild(h('div', { class: 'global-search-item-title' }, item.display_name || item.name));
        const meta = h('div', { class: 'global-search-item-meta' });
        if (item.role) meta.appendChild(h('span', null, item.role));
        if (item.specialization) meta.appendChild(h('span', null, this._truncate(item.specialization, 60)));
        content.appendChild(meta);
        break;
      }
      case 'raid': {
        content.appendChild(h('div', { class: 'global-search-item-title' }, item.summary || 'Untitled entry'));
        const meta = h('div', { class: 'global-search-item-meta' });
        if (item.type) meta.appendChild(h('span', { class: `search-badge raid-${item.type}` }, item.type));
        if (item.status) meta.appendChild(h('span', { class: 'search-badge' }, item.status));
        if (item.room_name) meta.appendChild(h('span', null, item.room_name));
        content.appendChild(meta);
        break;
      }
      case 'room': {
        content.appendChild(h('div', { class: 'global-search-item-title' }, item.name));
        const meta = h('div', { class: 'global-search-item-meta' });
        if (item.type) meta.appendChild(h('span', { class: 'search-badge' }, item.type));
        if (item.floor_name) meta.appendChild(h('span', null, item.floor_name));
        content.appendChild(meta);
        break;
      }
      case 'milestone': {
        content.appendChild(h('div', { class: 'global-search-item-title' }, item.title));
        const meta = h('div', { class: 'global-search-item-meta' });
        if (item.status) meta.appendChild(h('span', { class: 'search-badge' }, item.status));
        if (item.due_date) meta.appendChild(h('span', null, item.due_date));
        content.appendChild(meta);
        break;
      }
      case 'message': {
        const snippet = this._truncate(item.content || '', 80);
        content.appendChild(h('div', { class: 'global-search-item-title' }, snippet));
        const meta = h('div', { class: 'global-search-item-meta' });
        if (item.agent_name) meta.appendChild(h('span', null, item.agent_name));
        if (item.room_name) meta.appendChild(h('span', null, item.room_name));
        content.appendChild(meta);
        break;
      }
      default:
        content.appendChild(h('div', null, JSON.stringify(item)));
    }

    return content;
  }

  _truncate(text, max) {
    if (!text || text.length <= max) return text || '';
    return text.slice(0, max) + '...';
  }

  _renderError(msg) {
    if (!this._resultsEl) return;
    this._resultsEl.textContent = '';
    this._resultsEl.appendChild(h('div', { class: 'global-search-empty global-search-error' }, msg));
  }

  _moveSelection(dir) {
    if (this._flatItems.length === 0) return;
    this._selectedIdx += dir;
    if (this._selectedIdx < 0) this._selectedIdx = this._flatItems.length - 1;
    if (this._selectedIdx >= this._flatItems.length) this._selectedIdx = 0;
    this._updateSelectionStyles();
  }

  _updateSelectionStyles() {
    if (!this._resultsEl) return;
    this._resultsEl.querySelectorAll('.global-search-item').forEach((el) => {
      el.classList.toggle('selected', Number(el.dataset.idx) === this._selectedIdx);
    });
    // Scroll selected into view
    const selected = this._resultsEl.querySelector('.global-search-item.selected');
    if (selected) selected.scrollIntoView({ block: 'nearest' });
  }

  _activateSelection() {
    if (this._selectedIdx < 0 || this._selectedIdx >= this._flatItems.length) return;
    const { type, item } = this._flatItems[this._selectedIdx];
    this._navigateToItem(type, item);
  }

  _navigateToItem(type, item) {
    this.close();
    const route = TYPE_ROUTES[type] || 'dashboard';

    // Navigate to the appropriate view
    OverlordUI.dispatch('navigate', { view: route });

    // Dispatch entity-specific events for drill-down
    switch (type) {
      case 'task':
        OverlordUI.dispatch('entity:navigate', { entityType: 'task', entityId: item.id });
        break;
      case 'agent':
        OverlordUI.dispatch('entity:navigate', { entityType: 'agent', entityId: item.id });
        break;
      case 'raid':
        OverlordUI.dispatch('entity:navigate', { entityType: 'raid', entityId: item.id });
        break;
      case 'room':
        OverlordUI.dispatch('entity:navigate', { entityType: 'room', entityId: item.id });
        break;
      case 'milestone':
        OverlordUI.dispatch('entity:navigate', { entityType: 'milestone', entityId: item.id });
        break;
      case 'message':
        if (item.room_id) {
          OverlordUI.dispatch('entity:navigate', { entityType: 'room', entityId: item.room_id });
        }
        break;
    }
  }
}
