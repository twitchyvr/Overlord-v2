/**
 * Overlord v2 — RAID Log View
 *
 * Full RAID (Risks, Assumptions, Issues, Decisions) log interface.
 * Filterable by type and status, with search, create, and
 * status management capabilities.
 *
 * Data shape (from DB):
 *   id, building_id, type, phase, room_id, summary, rationale,
 *   decided_by, approved_by, affected_areas, status,
 *   created_at, updated_at
 *
 * Store keys:
 *   raid.entries     — array of RAID entry objects
 *   building.active  — current building id
 */

import { Component } from '../engine/component.js';
import { OverlordUI } from '../engine/engine.js';
import { h, formatTime, escapeHtml } from '../engine/helpers.js';
import { Card } from '../components/card.js';
import { Tabs } from '../components/tabs.js';
import { Button } from '../components/button.js';
import { Modal } from '../components/modal.js';
import { Drawer } from '../components/drawer.js';
import { Toast } from '../components/toast.js';
import { EntityLink, resolveAgent } from '../engine/entity-nav.js';


const RAID_TYPES = ['risk', 'assumption', 'issue', 'decision'];

const RAID_TYPE_LABELS = {
  risk:       'Risk',
  assumption: 'Assumption',
  issue:      'Issue',
  decision:   'Decision'
};

const RAID_TYPE_ICONS = {
  risk:       '\u26A0',
  assumption: '\u2753',
  issue:      '\u{1F41B}',
  decision:   '\u2705'
};

const RAID_STATUSES = ['active', 'superseded', 'closed'];

const PHASE_ORDER = ['strategy', 'discovery', 'architecture', 'execution', 'review', 'deploy'];

export class RaidLogView extends Component {

  constructor(el, opts = {}) {
    super(el, opts);
    this._entries = [];
    this._buildingId = null;
    this._activeTypeFilter = 'all';
    this._activeStatusFilter = 'all';
    this._searchQuery = '';
    this._typeTabs = null;
    this._statusTabs = null;
    this._loading = true;
  }

  mount() {
    this._mounted = true;
    const store = OverlordUI.getStore();
    if (!store) return;

    this.subscribe(store, 'raid.entries', (entries) => {
      this._entries = entries || [];
      this._loading = false;
      this._updateEntryList();
      this._updateTabBadges();
    });

    this.subscribe(store, 'building.active', (id) => {
      this._buildingId = id;
      this._fetchEntries();
    });

    // Listen for real-time RAID events
    this._listeners.push(
      OverlordUI.subscribe('raid:entry:added', () => this._fetchEntries())
    );

    // Quick Actions FAB dispatches this to open the create form from any view
    this._listeners.push(
      OverlordUI.subscribe('raid:request-create', () => this._openCreateForm())
    );

    this._buildingId = store.get('building.active');
    this._entries = store.get('raid.entries') || [];
    if (this._entries.length > 0) this._loading = false;

    this.render();
    this._fetchEntries();
  }

  render() {
    this.el.textContent = '';
    this.el.className = 'raid-log-view';

    // Header
    const header = h('div', { class: 'raid-view-header' },
      h('div', { class: 'raid-view-title-row' },
        h('h2', { class: 'raid-view-title' }, 'RAID Log'),
        h('div', { class: 'raid-view-subtitle' },
          'Risks \u2022 Assumptions \u2022 Issues \u2022 Decisions'
        )
      ),
      h('div', { class: 'raid-view-actions' },
        Button.create('New Entry', {
          variant: 'primary',
          icon: '+',
          onClick: () => this._openCreateForm()
        })
      )
    );
    this.el.appendChild(header);

    // Search bar
    const searchRow = h('div', { class: 'raid-search-row' });
    const searchInput = h('input', {
      class: 'form-input raid-search-input',
      type: 'text',
      placeholder: 'Search RAID entries...'
    });
    searchInput.addEventListener('input', (e) => {
      this._searchQuery = e.target.value.toLowerCase();
      this._updateEntryList();
    });
    searchRow.appendChild(searchInput);
    this.el.appendChild(searchRow);

    // Type filter tabs
    const typeTabWrapper = h('div', { class: 'raid-type-tabs' });
    const typeTabContainer = h('div');
    typeTabWrapper.appendChild(typeTabContainer);
    this._typeTabs = new Tabs(typeTabContainer, {
      items: [
        { id: 'all',        label: 'All',          badge: this._entries.length },
        { id: 'risk',       label: 'Risks',        icon: RAID_TYPE_ICONS.risk,       badge: this._countByType('risk') },
        { id: 'assumption', label: 'Assumptions',  icon: RAID_TYPE_ICONS.assumption, badge: this._countByType('assumption') },
        { id: 'issue',      label: 'Issues',       icon: RAID_TYPE_ICONS.issue,      badge: this._countByType('issue') },
        { id: 'decision',   label: 'Decisions',    icon: RAID_TYPE_ICONS.decision,   badge: this._countByType('decision') }
      ],
      activeId: 'all',
      style: 'pills',
      onChange: (id) => {
        this._activeTypeFilter = id;
        this._updateEntryList();
      }
    });
    this._typeTabs.mount();
    this.el.appendChild(typeTabWrapper);

    // Status filter tabs (secondary)
    const statusTabWrapper = h('div', { class: 'raid-status-tabs' });
    const statusTabContainer = h('div');
    statusTabWrapper.appendChild(statusTabContainer);
    this._statusTabs = new Tabs(statusTabContainer, {
      items: [
        { id: 'all',        label: 'All Statuses' },
        { id: 'active',     label: 'Active',      badge: this._countByStatus('active') },
        { id: 'superseded', label: 'Superseded',   badge: this._countByStatus('superseded') },
        { id: 'closed',     label: 'Closed',       badge: this._countByStatus('closed') }
      ],
      activeId: 'all',
      style: 'underline',
      onChange: (id) => {
        this._activeStatusFilter = id;
        this._updateEntryList();
      }
    });
    this._statusTabs.mount();
    this.el.appendChild(statusTabWrapper);

    // Entry list container
    const listContainer = h('div', { class: 'raid-list-container', id: 'raid-list' });
    this.el.appendChild(listContainer);

    // Delegated click handler for RAID cards
    this.on('click', '.card-raid', (e, target) => {
      const entryId = target.dataset.entryId;
      if (entryId) this._openEntryDetail(entryId);
    });

    this._updateEntryList();
  }

  // ── Data fetching ──────────────────────────────────────────

  _fetchEntries() {
    if (!this._buildingId || !window.overlordSocket) return;
    window.overlordSocket.fetchRaidEntries(this._buildingId);
  }

  // ── Filtering ──────────────────────────────────────────────

  _getFilteredEntries() {
    let entries = [...this._entries];

    // Type filter
    if (this._activeTypeFilter !== 'all') {
      entries = entries.filter(e => e.type === this._activeTypeFilter);
    }

    // Status filter
    if (this._activeStatusFilter !== 'all') {
      entries = entries.filter(e => e.status === this._activeStatusFilter);
    }

    // Search filter
    if (this._searchQuery) {
      entries = entries.filter(e =>
        (e.summary || '').toLowerCase().includes(this._searchQuery) ||
        (e.rationale || '').toLowerCase().includes(this._searchQuery) ||
        (e.type || '').toLowerCase().includes(this._searchQuery)
      );
    }

    // Sort by creation date descending
    entries.sort((a, b) =>
      new Date(b.created_at || 0) - new Date(a.created_at || 0)
    );

    return entries;
  }

  _countByType(type) {
    return this._entries.filter(e => e.type === type).length;
  }

  _countByStatus(status) {
    return this._entries.filter(e => e.status === status).length;
  }

  // ── Rendering ──────────────────────────────────────────────

  _updateEntryList() {
    const container = this.$('#raid-list');
    if (!container) return;

    container.textContent = '';
    const entries = this._getFilteredEntries();

    if (entries.length === 0) {
      if (this._loading) {
        container.appendChild(h('div', { class: 'loading-state' },
          h('div', { class: 'loading-spinner' }),
          h('p', { class: 'loading-text' }, 'Loading RAID entries...')
        ));
      } else {
        container.appendChild(h('div', { class: 'empty-state' },
          h('p', { class: 'empty-state-title' },
            this._searchQuery ? 'No matching entries' : 'No RAID entries yet'),
          h('p', { class: 'empty-state-description' },
            this._searchQuery
              ? 'Try adjusting your search or filters.'
              : 'Add an entry to start tracking risks, assumptions, issues, and decisions.')
        ));
      }
      return;
    }

    // Group by type for visual clarity when showing all
    const grid = h('div', { class: 'raid-entry-grid' });

    for (const entry of entries) {
      // Auto-derive severity from type for visual impact indicators
      const severityMap = { risk: 'high', issue: 'medium', assumption: 'low', decision: 'info' };
      const card = Card.create('raid', {
        type: entry.type,
        title: entry.summary,
        description: entry.rationale,
        status: entry.status || 'active',
        owner: entry.decided_by,
        severity: entry.status === 'closed' ? null : severityMap[entry.type] || null
      });

      card.dataset.entryId = entry.id;
      card.style.cursor = 'pointer';

      // Visual indicator for status
      if (entry.status === 'closed') {
        card.style.opacity = '0.6';
      } else if (entry.status === 'superseded') {
        card.style.opacity = '0.75';
      }

      grid.appendChild(card);
    }

    container.appendChild(grid);
  }

  _updateTabBadges() {
    if (this._typeTabs) {
      this._typeTabs.setBadge('all', this._entries.length || null);
      for (const type of RAID_TYPES) {
        this._typeTabs.setBadge(type, this._countByType(type) || null);
      }
    }
    if (this._statusTabs) {
      for (const status of RAID_STATUSES) {
        this._statusTabs.setBadge(status, this._countByStatus(status) || null);
      }
    }
  }

  // ── Entry Detail Drawer ────────────────────────────────────

  _openEntryDetail(entryId) {
    const entry = this._entries.find(e => e.id === entryId);
    if (!entry) return;

    const content = this._buildDetailContent(entry);

    Drawer.open(`raid-detail-${entryId}`, {
      title: `${RAID_TYPE_LABELS[entry.type] || 'RAID'} Entry`,
      content,
      width: '440px',
    });
  }

  _buildDetailContent(entry) {
    const container = h('div', { class: 'raid-detail-view' });

    // Type and status badges
    const metaRow = h('div', { class: 'raid-detail-meta' },
      h('span', { class: `badge badge-${entry.type}` },
        `${RAID_TYPE_ICONS[entry.type] || ''} ${RAID_TYPE_LABELS[entry.type] || entry.type}`),
      h('span', { class: `raid-status-badge status-${entry.status || 'active'}` },
        entry.status || 'active')
    );
    container.appendChild(metaRow);

    // Summary
    container.appendChild(h('div', { class: 'raid-detail-section' },
      h('h4', null, 'Summary'),
      h('p', { class: 'raid-detail-text' }, entry.summary)
    ));

    // Rationale
    if (entry.rationale) {
      container.appendChild(h('div', { class: 'raid-detail-section' },
        h('h4', null, 'Rationale'),
        h('p', { class: 'raid-detail-text' }, entry.rationale)
      ));
    }

    // Info rows
    const infoSection = h('div', { class: 'raid-detail-section raid-detail-info' });

    if (entry.phase) {
      infoSection.appendChild(h('div', { class: 'raid-detail-info-row' },
        h('span', { class: 'raid-detail-label' }, 'Phase'),
        h('span', null, entry.phase.charAt(0).toUpperCase() + entry.phase.slice(1))
      ));
    }
    if (entry.room_name || entry.room_id) {
      infoSection.appendChild(h('div', { class: 'raid-detail-info-row' },
        h('span', { class: 'raid-detail-label' }, 'Room'),
        h('span', null, entry.room_name || entry.room_id)
      ));
    }
    if (entry.decided_by) {
      const decidedAgent = resolveAgent(entry.decided_by);
      infoSection.appendChild(h('div', { class: 'raid-detail-info-row' },
        h('span', { class: 'raid-detail-label' }, 'Decided By'),
        decidedAgent && decidedAgent.id !== entry.decided_by
          ? EntityLink.agent(decidedAgent.id, decidedAgent.name)
          : EntityLink.agent(entry.decided_by, entry.decided_by)
      ));
    }
    if (entry.approved_by) {
      const approvedAgent = resolveAgent(entry.approved_by);
      infoSection.appendChild(h('div', { class: 'raid-detail-info-row' },
        h('span', { class: 'raid-detail-label' }, 'Approved By'),
        approvedAgent && approvedAgent.id !== entry.approved_by
          ? EntityLink.agent(approvedAgent.id, approvedAgent.name)
          : EntityLink.agent(entry.approved_by, entry.approved_by)
      ));
    }
    if (entry.created_at) {
      infoSection.appendChild(h('div', { class: 'raid-detail-info-row' },
        h('span', { class: 'raid-detail-label' }, 'Created'),
        h('span', null, new Date(entry.created_at).toLocaleString())
      ));
    }

    // Affected areas
    const areas = Array.isArray(entry.affected_areas)
      ? entry.affected_areas
      : (typeof entry.affected_areas === 'string' ? (() => { try { return JSON.parse(entry.affected_areas || '[]'); } catch { return []; } })() : []);
    if (areas.length > 0) {
      const areasRow = h('div', { class: 'raid-detail-info-row' },
        h('span', { class: 'raid-detail-label' }, 'Affected Areas')
      );
      const areaChips = h('div', { class: 'raid-affected-areas' });
      for (const area of areas) {
        areaChips.appendChild(h('span', { class: 'raid-area-chip' }, area));
      }
      areasRow.appendChild(areaChips);
      infoSection.appendChild(areasRow);
    }

    if (infoSection.children.length > 0) {
      container.appendChild(infoSection);
    }

    // Action buttons
    const actions = h('div', { class: 'raid-detail-actions' });

    // Edit button
    actions.appendChild(Button.create('Edit', {
      variant: 'secondary',
      size: 'sm',
      onClick: () => {
        Drawer.close();
        this._openEditForm(entry);
      }
    }));

    // Status change buttons
    for (const status of RAID_STATUSES) {
      if (status === entry.status) continue;
      actions.appendChild(Button.create(`Mark ${status}`, {
        variant: status === 'closed' ? 'primary' : status === 'superseded' ? 'ghost' : 'secondary',
        size: 'sm',
        onClick: () => this._updateEntryStatus(entry.id, status)
      }));
    }

    container.appendChild(actions);

    return container;
  }

  // ── Create Entry Form ──────────────────────────────────────

  _openCreateForm() {
    const form = h('div', { class: 'raid-create-form' });

    // Type selector
    const typeSelect = h('select', { class: 'form-input', id: 'raid-create-type' });
    for (const type of RAID_TYPES) {
      typeSelect.appendChild(h('option', { value: type },
        `${RAID_TYPE_ICONS[type]} ${RAID_TYPE_LABELS[type]}`));
    }
    form.appendChild(h('div', { class: 'form-group' },
      h('label', { class: 'form-label' }, 'Type'),
      typeSelect
    ));

    // Summary
    form.appendChild(h('div', { class: 'form-group' },
      h('label', { class: 'form-label' }, 'Summary'),
      h('input', {
        class: 'form-input',
        type: 'text',
        id: 'raid-create-summary',
        placeholder: 'Brief summary of the entry...'
      })
    ));

    // Rationale
    form.appendChild(h('div', { class: 'form-group' },
      h('label', { class: 'form-label' }, 'Rationale'),
      h('textarea', {
        class: 'form-input form-textarea',
        id: 'raid-create-rationale',
        placeholder: 'Why is this important? What is the context?'
      })
    ));

    // Phase selector
    const phaseSelect = h('select', { class: 'form-input', id: 'raid-create-phase' });
    for (const phase of PHASE_ORDER) {
      const opt = h('option', { value: phase }, phase.charAt(0).toUpperCase() + phase.slice(1));
      phaseSelect.appendChild(opt);
    }
    form.appendChild(h('div', { class: 'form-group' },
      h('label', { class: 'form-label' }, 'Phase'),
      phaseSelect
    ));

    // Decided by
    form.appendChild(h('div', { class: 'form-group' },
      h('label', { class: 'form-label' }, 'Decided By'),
      h('input', {
        class: 'form-input',
        type: 'text',
        id: 'raid-create-decided-by',
        placeholder: 'Who made this decision?'
      })
    ));

    // Affected areas
    form.appendChild(h('div', { class: 'form-group' },
      h('label', { class: 'form-label' }, 'Affected Areas'),
      h('input', {
        class: 'form-input',
        type: 'text',
        id: 'raid-create-areas',
        placeholder: 'Comma-separated areas (e.g., auth, api, frontend)'
      })
    ));

    // Actions
    form.appendChild(h('div', { class: 'raid-create-actions' },
      Button.create('Cancel', {
        variant: 'ghost',
        onClick: () => Modal.close('raid-create')
      }),
      Button.create('Add Entry', {
        variant: 'primary',
        onClick: () => this._submitCreateForm()
      })
    ));

    Modal.open('raid-create', {
      title: 'New RAID Entry',
      content: form,
      size: 'md',
      position: 'center'
    });
  }

  async _submitCreateForm() {
    // Clear previous validation errors
    const existingErrors = document.querySelectorAll('.raid-create-form .form-error');
    existingErrors.forEach(el => el.remove());

    const summaryInput = document.getElementById('raid-create-summary');
    const summary = summaryInput?.value?.trim();

    // Validate required fields
    if (!summary) {
      if (summaryInput) {
        summaryInput.classList.add('input-error');
        summaryInput.parentElement?.appendChild(
          h('div', { class: 'form-error' }, 'Summary is required')
        );
      }
      return;
    }
    if (summaryInput) summaryInput.classList.remove('input-error');

    const type = document.getElementById('raid-create-type')?.value || 'risk';
    const rationale = document.getElementById('raid-create-rationale')?.value?.trim() || '';
    const phase = document.getElementById('raid-create-phase')?.value || 'strategy';
    const decidedBy = document.getElementById('raid-create-decided-by')?.value?.trim() || '';
    const areasRaw = document.getElementById('raid-create-areas')?.value?.trim() || '';
    const affectedAreas = areasRaw ? areasRaw.split(',').map(a => a.trim()).filter(Boolean) : [];

    if (!window.overlordSocket || !this._buildingId) return;

    try {
      const result = await window.overlordSocket.addRaidEntry({
        buildingId: this._buildingId,
        type,
        summary,
        rationale,
        phase,
        decidedBy,
        affectedAreas
      });

      if (result && result.ok) {
        Toast.success('RAID entry added');
        Modal.close('raid-create');
      } else {
        Toast.error(result?.error?.message || 'Failed to add RAID entry');
        // Keep modal open so user can fix and retry
      }
    } catch (err) {
      Toast.error('Error adding RAID entry');
    }
  }

  // ── Edit Entry Form ──────────────────────────────────────────

  _openEditForm(entry) {
    const form = h('div', { class: 'raid-create-form' });

    // Summary
    form.appendChild(h('div', { class: 'form-group' },
      h('label', { class: 'form-label' }, 'Summary'),
      h('input', {
        class: 'form-input',
        type: 'text',
        id: 'raid-edit-summary',
        value: entry.summary || ''
      })
    ));

    // Rationale
    const rationaleTextarea = h('textarea', {
      class: 'form-input form-textarea',
      id: 'raid-edit-rationale'
    });
    rationaleTextarea.value = entry.rationale || '';
    form.appendChild(h('div', { class: 'form-group' },
      h('label', { class: 'form-label' }, 'Rationale'),
      rationaleTextarea
    ));

    // Decided by
    form.appendChild(h('div', { class: 'form-group' },
      h('label', { class: 'form-label' }, 'Decided By'),
      h('input', {
        class: 'form-input',
        type: 'text',
        id: 'raid-edit-decided-by',
        value: entry.decided_by || ''
      })
    ));

    // Affected areas
    const areas = Array.isArray(entry.affected_areas)
      ? entry.affected_areas
      : (typeof entry.affected_areas === 'string' ? (() => { try { return JSON.parse(entry.affected_areas || '[]'); } catch { return []; } })() : []);
    form.appendChild(h('div', { class: 'form-group' },
      h('label', { class: 'form-label' }, 'Affected Areas'),
      h('input', {
        class: 'form-input',
        type: 'text',
        id: 'raid-edit-areas',
        value: areas.join(', '),
        placeholder: 'Comma-separated areas'
      })
    ));

    // Actions
    form.appendChild(h('div', { class: 'raid-create-actions' },
      Button.create('Cancel', {
        variant: 'ghost',
        onClick: () => Modal.close('raid-edit')
      }),
      Button.create('Save Changes', {
        variant: 'primary',
        onClick: () => this._submitEditForm(entry.id)
      })
    ));

    Modal.open('raid-edit', {
      title: `Edit ${RAID_TYPE_LABELS[entry.type] || 'RAID'} Entry`,
      content: form,
      size: 'md',
      position: 'center'
    });
  }

  async _submitEditForm(entryId) {
    const existingErrors = document.querySelectorAll('.raid-create-form .form-error');
    existingErrors.forEach(el => el.remove());

    const summaryInput = document.getElementById('raid-edit-summary');
    const summary = summaryInput?.value?.trim();

    if (!summary) {
      if (summaryInput) {
        summaryInput.classList.add('input-error');
        summaryInput.parentElement?.appendChild(
          h('div', { class: 'form-error' }, 'Summary is required')
        );
      }
      return;
    }
    if (summaryInput) summaryInput.classList.remove('input-error');

    const rationale = document.getElementById('raid-edit-rationale')?.value?.trim() || '';
    const decidedBy = document.getElementById('raid-edit-decided-by')?.value?.trim() || '';
    const areasRaw = document.getElementById('raid-edit-areas')?.value?.trim() || '';
    const affectedAreas = areasRaw ? areasRaw.split(',').map(a => a.trim()).filter(Boolean) : [];

    if (!window.overlordSocket) return;

    try {
      const result = await window.overlordSocket.editRaidEntry({
        id: entryId,
        summary,
        rationale,
        decidedBy,
        affectedAreas
      });

      if (result && result.ok) {
        Toast.success('RAID entry updated');
        Modal.close('raid-edit');
      } else {
        Toast.error(result?.error?.message || 'Failed to update RAID entry');
      }
    } catch (err) {
      Toast.error('Error updating RAID entry');
    }
  }

  // ── Status Updates ─────────────────────────────────────────

  async _updateEntryStatus(entryId, status) {
    if (!window.overlordSocket) return;

    try {
      const result = await window.overlordSocket.updateRaidStatus({ id: entryId, status });

      if (result && result.ok) {
        Toast.success(`Entry marked as ${status}`);
        Drawer.close();
        this._fetchEntries();
      } else {
        Toast.error(result?.error?.message || 'Failed to update status');
      }
    } catch (err) {
      Toast.error('Error updating entry status');
    }
  }
}
