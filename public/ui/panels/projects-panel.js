/**
 * Overlord v2 — Projects Panel
 *
 * Shows buildings/projects with their phase status.
 * Allows switching active building and viewing project metadata.
 */

import { PanelComponent } from '../components/panel.js';
import { OverlordUI } from '../engine/engine.js';
import { h } from '../engine/helpers.js';
import { DrillItem } from '../components/drill-item.js';


const PHASE_LABELS = {
  strategy: 'Strategy',
  discovery: 'Discovery',
  architecture: 'Architecture',
  execution: 'Execution',
  review: 'Review',
  deploy: 'Deploy'
};

export class ProjectsPanel extends PanelComponent {

  constructor(el) {
    super(el, {
      id: 'panel-projects',
      label: 'Projects',
      icon: '\u{1F3D7}',
      defaultVisible: false
    });
    this._buildings = [];
    this._activeId = null;
  }

  mount() {
    super.mount();
    const store = OverlordUI.getStore();
    if (!store) return;

    this.subscribe(store, 'building.list', (buildings) => {
      this._buildings = buildings || [];
      this._renderContent();
    });

    this.subscribe(store, 'building.active', (id) => {
      this._activeId = id;
      this._renderContent();
    });

    this._renderContent();
  }

  _renderContent() {
    const body = this.$('.panel-body');
    if (!body) return;
    body.textContent = '';

    // Summary
    body.appendChild(h('div', { class: 'panel-summary' },
      h('span', null, `${this._buildings.length} building${this._buildings.length !== 1 ? 's' : ''}`)
    ));

    if (this._buildings.length === 0) {
      body.appendChild(h('div', { class: 'panel-empty' }, 'No buildings yet. Start Phase Zero to create one.'));
      return;
    }

    const list = h('div', { class: 'projects-list' });

    for (const building of this._buildings) {
      const isActive = building.id === this._activeId;
      const phase = building.activePhase || building.phase || 'strategy';

      const item = DrillItem.create('project', building, {
        icon: () => isActive ? '\u{1F3E2}' : '\u{1F3D7}',
        summary: (d) => d.name || 'Untitled Building',
        badge: () => ({
          text: PHASE_LABELS[phase] || phase,
          color: isActive ? 'var(--accent-cyan)' : 'var(--text-muted)'
        }),
        meta: () => isActive ? 'active' : '',
        detail: [
          { label: 'ID', key: 'id' },
          { label: 'Phase', key: 'activePhase' },
          { label: 'Description', key: 'description' },
          { label: 'Created', key: 'created_at' }
        ]
      });

      // Click to select building
      if (!isActive) {
        item.addEventListener('click', (e) => {
          if (e.target.closest('.drill-item-detail')) return;
          this._selectBuilding(building.id);
        });
        item.style.cursor = 'pointer';
      }

      list.appendChild(item);
    }

    body.appendChild(list);
  }

  _selectBuilding(buildingId) {
    if (window.overlordSocket) {
      window.overlordSocket.selectBuilding(buildingId);
    }
    OverlordUI.dispatch('building:selected', { buildingId });
  }
}
