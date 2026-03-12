/**
 * Overlord v2 — RAID Panel
 *
 * Shows RAID log entries (Risks, Assumptions, Issues, Dependencies)
 * with type-based filtering and search.
 * Fetches from server when building is active.
 */

import { PanelComponent } from '../components/panel.js';
import { OverlordUI } from '../engine/engine.js';
import { h, formatTime } from '../engine/helpers.js';
import { DrillItem } from '../components/drill-item.js';
import { SearchInput } from '../components/search-input.js';
import { Toast } from '../components/toast.js';
import { EntityLink } from '../engine/entity-nav.js';


const RAID_TYPES = [
  { id: 'risk', label: 'Risks', color: 'var(--raid-risk)' },
  { id: 'assumption', label: 'Assumptions', color: 'var(--raid-assumption)' },
  { id: 'issue', label: 'Issues', color: 'var(--raid-issue)' },
  { id: 'dependency', label: 'Dependencies', color: 'var(--raid-dependency)' }
];

export class RaidPanel extends PanelComponent {

  constructor(el) {
    super(el, {
      id: 'panel-raid',
      label: 'RAID Log',
      icon: '\u26A0',
      defaultVisible: true
    });
    this._entries = [];
    this._filteredEntries = [];
    this._searchQuery = '';
    this._activeFilters = [];
    this._buildingId = null;
    this._showCreateForm = false;
  }

  mount() {
    super.mount();
    const store = OverlordUI.getStore();
    if (!store) return;

    this.subscribe(store, 'raid.entries', (entries) => {
      this._entries = entries || [];
      this._applyFilters();
      this._renderContent();
    });

    // Auto-fetch when building changes
    this.subscribe(store, 'building.active', (buildingId) => {
      this._buildingId = buildingId;
      if (buildingId && window.overlordSocket) {
        window.overlordSocket.fetchRaidEntries(buildingId);
      }
    });

    // If building is already active, fetch
    const activeBuildingId = store.get('building.active');
    if (activeBuildingId) {
      this._buildingId = activeBuildingId;
      if (window.overlordSocket) {
        window.overlordSocket.fetchRaidEntries(activeBuildingId);
      }
    }

    this._renderContent();
  }

  _renderContent() {
    const body = this.$('.panel-body');
    if (!body) return;
    body.textContent = '';

    // New Entry button
    if (this._buildingId) {
      const headerRow = h('div', { class: 'raid-header-row' });
      const newBtn = h('button', { class: 'btn btn-primary btn-xs' }, '+ New Entry');
      newBtn.addEventListener('click', () => {
        this._showCreateForm = !this._showCreateForm;
        this._renderContent();
      });
      headerRow.appendChild(newBtn);
      body.appendChild(headerRow);
    }

    // Create form
    if (this._showCreateForm) {
      body.appendChild(this._buildCreateForm());
    }

    // Search + filter
    const searchContainer = h('div', null);
    const search = new SearchInput(searchContainer, {
      placeholder: 'Search RAID entries...',
      filters: RAID_TYPES.map(t => ({ id: t.id, label: t.label })),
      onChange: (query, filters) => {
        this._searchQuery = query;
        this._activeFilters = filters;
        this._applyFilters();

        // Also trigger server-side search if query is non-trivial
        if (query.length >= 3 && this._buildingId && window.overlordSocket) {
          window.overlordSocket.searchRaid({
            buildingId: this._buildingId,
            query,
            type: filters.length === 1 ? filters[0] : undefined
          });
        }

        this._renderEntries(body);
      }
    });
    search.mount();
    body.appendChild(searchContainer);

    // Stats row
    const stats = h('div', { class: 'raid-stats-row' });
    for (const type of RAID_TYPES) {
      const count = this._entries.filter(e => e.type === type.id).length;
      stats.appendChild(h('div', { class: 'raid-stat' },
        h('span', { class: 'raid-stat-dot', style: { background: type.color } }),
        h('span', { class: 'raid-stat-count' }, String(count)),
        h('span', { class: 'raid-stat-label' }, type.label)
      ));
    }
    body.appendChild(stats);

    // Entries
    this._renderEntries(body);
  }

  _renderEntries(body) {
    // Remove existing entries list (if any)
    const existingList = body.querySelector('.raid-entries-list');
    if (existingList) existingList.remove();

    const list = h('div', { class: 'raid-entries-list' });

    if (this._filteredEntries.length === 0) {
      list.appendChild(h('div', { class: 'panel-empty' },
        this._entries.length === 0 ? 'No RAID entries yet.' : 'No entries match your filters.'
      ));
      body.appendChild(list);
      return;
    }

    for (const entry of this._filteredEntries) {
      const typeConfig = RAID_TYPES.find(t => t.id === entry.type) || RAID_TYPES[0];

      const item = DrillItem.create('raid', entry, {
        icon: () => {
          switch (entry.type) {
            case 'risk': return '\u{1F534}';
            case 'assumption': return '\u{1F7E1}';
            case 'issue': return '\u{1F7E0}';
            case 'dependency': return '\u{1F535}';
            default: return '\u26A0';
          }
        },
        summary: (d) => d.title || d.summary || d.description || 'RAID Entry',
        badge: (d) => ({
          text: d.type,
          color: typeConfig.color
        }),
        meta: (d) => {
          if (d.severity) return d.severity;
          if (d.status) return d.status;
          return '';
        },
        detail: [
          { label: 'Type', key: 'type' },
          { label: 'Severity', key: 'severity' },
          { label: 'Status', key: 'status' },
          { label: 'Phase', key: 'phase' },
          { label: 'Description', key: 'description' },
          { label: 'Summary', key: 'summary' },
          { label: 'Mitigation', key: 'mitigation' },
          { label: 'Owner', key: 'owner', value: (d) => {
            if (!d.owner) return null;
            return EntityLink.agent(d.owner);
          }},
          { label: 'Decided By', key: 'decided_by', value: (d) => {
            if (!d.decided_by) return null;
            return EntityLink.agent(d.decided_by);
          }},
          { label: 'Room', key: 'room_id', value: (d) => {
            if (!d.room_id) return null;
            return EntityLink.room(d.room_id);
          }},
          { label: 'Created', key: 'created_at', format: 'date' }
        ],
        actions: (d) => [
          { label: 'View Full Detail', onClick: () => OverlordUI.dispatch('navigate:entity', { type: 'raid', id: d.id }) },
          ...(d.owner ? [{ label: 'View Owner', onClick: () => OverlordUI.dispatch('navigate:entity', { type: 'agent', id: d.owner }) }] : []),
          ...(d.room_id ? [{ label: 'View Room', onClick: () => OverlordUI.dispatch('navigate:entity', { type: 'room', id: d.room_id }) }] : []),
        ]
      });

      list.appendChild(item);
    }

    body.appendChild(list);
  }

  _buildCreateForm() {
    const form = h('div', { class: 'raid-create-form' });

    // Type selector
    const typeRow = h('div', { class: 'form-row' },
      h('label', null, 'Type')
    );
    const typeSelect = h('select', { class: 'form-input' });
    for (const t of RAID_TYPES) {
      typeSelect.appendChild(h('option', { value: t.id }, t.label.slice(0, -1)));
    }
    typeRow.appendChild(typeSelect);
    form.appendChild(typeRow);

    // Summary
    const summaryRow = h('div', { class: 'form-row' },
      h('label', null, 'Summary')
    );
    const summaryInput = h('textarea', {
      class: 'form-input',
      rows: '3',
      placeholder: 'Describe the risk, assumption, issue, or dependency...'
    });
    summaryRow.appendChild(summaryInput);
    form.appendChild(summaryRow);

    // Rationale
    const rationaleRow = h('div', { class: 'form-row' },
      h('label', null, 'Rationale')
    );
    const rationaleInput = h('input', {
      type: 'text',
      class: 'form-input',
      placeholder: 'Why is this important? (optional)'
    });
    rationaleRow.appendChild(rationaleInput);
    form.appendChild(rationaleRow);

    // Affected areas
    const areasRow = h('div', { class: 'form-row' },
      h('label', null, 'Affected Areas')
    );
    const areasInput = h('input', {
      type: 'text',
      class: 'form-input',
      placeholder: 'Comma-separated areas (optional)'
    });
    areasRow.appendChild(areasInput);
    form.appendChild(areasRow);

    // Buttons
    const btnRow = h('div', { class: 'form-row form-actions' });
    const submitBtn = h('button', { class: 'btn btn-primary btn-sm' }, 'Add Entry');
    const cancelBtn = h('button', { class: 'btn btn-ghost btn-sm' }, 'Cancel');

    submitBtn.addEventListener('click', () => {
      this._handleCreate({
        type: typeSelect.value,
        summary: summaryInput.value.trim(),
        rationale: rationaleInput.value.trim(),
        affectedAreas: areasInput.value.trim().split(',').map(s => s.trim()).filter(Boolean),
      });
    });

    cancelBtn.addEventListener('click', () => {
      this._showCreateForm = false;
      this._renderContent();
    });

    btnRow.appendChild(cancelBtn);
    btnRow.appendChild(submitBtn);
    form.appendChild(btnRow);

    return form;
  }

  async _handleCreate({ type, summary, rationale, affectedAreas }) {
    if (!summary) {
      Toast.error('Summary is required');
      return;
    }
    if (!this._buildingId || !window.overlordSocket) return;

    const store = OverlordUI.getStore();
    const phase = store ? store.get('building.activePhase') || 'strategy' : 'strategy';

    const result = await window.overlordSocket.addRaidEntry({
      buildingId: this._buildingId,
      type,
      phase,
      summary,
      rationale: rationale || undefined,
      affectedAreas: affectedAreas.length > 0 ? affectedAreas : undefined,
    });

    if (result && result.ok) {
      Toast.success(`${type} entry added`);
      this._showCreateForm = false;
      window.overlordSocket.fetchRaidEntries(this._buildingId);
    } else {
      Toast.error(result?.error?.message || 'Failed to add entry');
    }
  }

  _applyFilters() {
    let entries = [...this._entries];

    // Type filter
    if (this._activeFilters.length > 0) {
      entries = entries.filter(e => this._activeFilters.includes(e.type));
    }

    // Search query
    if (this._searchQuery) {
      const query = this._searchQuery.toLowerCase();
      entries = entries.filter(e =>
        (e.title || '').toLowerCase().includes(query) ||
        (e.summary || '').toLowerCase().includes(query) ||
        (e.description || '').toLowerCase().includes(query) ||
        (e.owner || '').toLowerCase().includes(query) ||
        (e.decided_by || '').toLowerCase().includes(query)
      );
    }

    this._filteredEntries = entries;
  }
}
