/**
 * Overlord v2 — Dashboard View
 *
 * Project overview with KPI cards, building list, active phase status,
 * and quick-action buttons. Shown when a returning user connects.
 */

import { Component } from '../engine/component.js';
import { OverlordUI } from '../engine/engine.js';
import { h, formatTime } from '../engine/helpers.js';
import { Card } from '../components/card.js';
import { ProgressBar } from '../components/progress-bar.js';
import { Button } from '../components/button.js';


const PHASE_ORDER = ['strategy', 'discovery', 'architecture', 'execution', 'review', 'deploy'];

export class DashboardView extends Component {

  constructor(el, opts = {}) {
    super(el, opts);
    this._buildings = [];
    this._agents = [];
    this._raidEntries = [];
    this._activeBuilding = null;
  }

  mount() {
    this._mounted = true;
    const store = OverlordUI.getStore();
    if (!store) return;

    this.subscribe(store, 'building.list', (buildings) => {
      this._buildings = buildings || [];
      this.render();
    });

    this.subscribe(store, 'agents.list', (agents) => {
      this._agents = agents || [];
      this._updateKPIs();
    });

    this.subscribe(store, 'raid.entries', (entries) => {
      this._raidEntries = entries || [];
      this._updateKPIs();
    });

    this.subscribe(store, 'building.active', (id) => {
      this._activeBuilding = id;
      if (id && window.overlordSocket) {
        window.overlordSocket.fetchAgents({});
        window.overlordSocket.fetchRaidEntries(id);
      }
      this.render();
    });

    // Hydrate from store — data may have arrived before this view mounted
    // (navigateTo is async, so store updates can land before subscriptions)
    this._buildings = store.get('building.list') || [];
    this._agents = store.get('agents.list') || [];
    this._raidEntries = store.get('raid.entries') || [];
    this._activeBuilding = store.get('building.active');

    // If a building is active but agents/RAID data is missing, fetch it
    if (this._activeBuilding && window.overlordSocket) {
      if (this._agents.length === 0) {
        window.overlordSocket.fetchAgents({});
      }
      if (this._raidEntries.length === 0) {
        window.overlordSocket.fetchRaidEntries(this._activeBuilding);
      }
    }

    this.render();
  }

  render() {
    this.el.textContent = '';
    this.el.className = 'dashboard-view';

    // Header
    const header = h('div', { class: 'dashboard-header' },
      h('h2', { class: 'dashboard-title' }, 'Dashboard'),
      h('div', { class: 'dashboard-actions' },
        Button.create('New Project', {
          variant: 'primary',
          icon: '+',
          onClick: () => OverlordUI.dispatch('navigate:strategist')
        })
      )
    );
    this.el.appendChild(header);

    // KPI Cards
    this.el.appendChild(this._buildKPISection());

    // Phase Progress (if active building)
    if (this._activeBuilding) {
      const building = this._buildings.find(b => b.id === this._activeBuilding);
      if (building) {
        this.el.appendChild(this._buildPhaseProgress(building));
      }
    }

    // Building List
    this.el.appendChild(this._buildBuildingList());
  }

  _buildKPISection() {
    const section = h('div', { class: 'dashboard-kpi-section' });

    const kpis = [
      {
        label: 'Buildings',
        value: this._buildings.length,
        icon: '\u{1F3D7}',
        color: 'var(--accent-cyan)'
      },
      {
        label: 'Active Phase',
        value: this._getActivePhase(),
        icon: '\u{1F4CD}',
        color: 'var(--electric)'
      },
      {
        label: 'Agents',
        value: this._agents.length,
        icon: '\u{1F916}',
        color: 'var(--accent-green)'
      },
      {
        label: 'RAID Entries',
        value: this._raidEntries.length,
        icon: '\u26A0',
        color: 'var(--accent-amber)'
      }
    ];

    const kpiRow = h('div', { class: 'kpi-card-row' });
    for (const kpi of kpis) {
      const card = h('div', { class: 'kpi-card glass-card' },
        h('div', { class: 'kpi-card-icon', style: { color: kpi.color } }, kpi.icon),
        h('div', { class: 'kpi-card-value' }, String(kpi.value)),
        h('div', { class: 'kpi-card-label' }, kpi.label)
      );
      kpiRow.appendChild(card);
    }

    section.appendChild(kpiRow);
    return section;
  }

  _buildPhaseProgress(building) {
    const section = h('div', { class: 'dashboard-phase-section' },
      h('h3', null, 'Phase Progress')
    );

    const phaseIdx = PHASE_ORDER.indexOf(building.activePhase || building.active_phase || 'strategy');
    const progress = phaseIdx >= 0 ? Math.round(((phaseIdx + 1) / PHASE_ORDER.length) * 100) : 0;

    // Phase progress bar
    const segments = PHASE_ORDER.map((phase, i) => ({
      value: 100 / PHASE_ORDER.length,
      color: i <= phaseIdx ? `var(--floor-${phase})` : 'var(--bg-tertiary)',
      label: phase
    }));

    section.appendChild(ProgressBar.createMulti(segments, { size: 'lg' }));

    // Phase labels
    const labels = h('div', { class: 'phase-label-row' });
    for (let i = 0; i < PHASE_ORDER.length; i++) {
      const phase = PHASE_ORDER[i];
      const isCurrent = i === phaseIdx;
      const isComplete = i < phaseIdx;
      labels.appendChild(h('span', {
        class: `phase-label-item${isCurrent ? ' current' : ''}${isComplete ? ' complete' : ''}`
      }, phase));
    }
    section.appendChild(labels);

    return section;
  }

  _buildBuildingList() {
    const section = h('div', { class: 'dashboard-buildings-section' },
      h('h3', null, 'Buildings')
    );

    if (this._buildings.length === 0) {
      section.appendChild(h('div', { class: 'empty-state' },
        h('p', { class: 'empty-state-text' }, 'No buildings yet. Create a new project to get started.')
      ));
      return section;
    }

    const grid = h('div', { class: 'building-card-grid' });

    for (const building of this._buildings) {
      const isActive = building.id === this._activeBuilding;
      const card = Card.create('building', {
        name: building.name,
        activePhase: building.activePhase || building.active_phase,
        description: building.description || building.project_description || '',
        floorCount: building.floorCount ?? building.floor_count,
        agentCount: building.agentCount ?? building.agent_count ?? 0,
        repoUrl: building.repoUrl || building.repo_url || '',
      }, {
        variant: isActive ? 'solid' : 'glass',
        className: isActive ? 'building-card-active' : '',
        actions: {
          'Open': () => {
            if (window.overlordSocket) {
              window.overlordSocket.selectBuilding(building.id);
            }
            OverlordUI.dispatch('building:selected', { buildingId: building.id });
          }
        }
      });

      grid.appendChild(card);
    }

    section.appendChild(grid);
    return section;
  }

  _getActivePhase() {
    if (this._activeBuilding) {
      const b = this._buildings.find(b => b.id === this._activeBuilding);
      if (b) return b.activePhase || b.active_phase || 'strategy';
    }
    if (this._buildings.length > 0) {
      return this._buildings[0].activePhase || this._buildings[0].active_phase || 'strategy';
    }
    return 'None';
  }

  _updateKPIs() {
    // Lightweight KPI update without full re-render
    const kpiValues = this.el.querySelectorAll('.kpi-card-value');
    if (kpiValues.length >= 4) {
      kpiValues[0].textContent = String(this._buildings.length);
      kpiValues[1].textContent = this._getActivePhase();
      kpiValues[2].textContent = String(this._agents.length);
      kpiValues[3].textContent = String(this._raidEntries.length);
    }
  }
}
