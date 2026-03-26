/**
 * Overlord v2 — Project Switcher
 *
 * Toolbar dropdown for quick project switching without going to Dashboard.
 * Shows all buildings with phase + status. Click to switch — current view persists.
 * (#1258)
 */

import { Component } from '../engine/component.js';
import { OverlordUI } from '../engine/engine.js';
import { h } from '../engine/helpers.js';

const PHASE_ICONS = {
  strategy: '🎯', discovery: '🔍', architecture: '📐',
  execution: '🛠️', review: '📝', deploy: '🚀',
};

export class ProjectSwitcher extends Component {

  constructor(el, opts = {}) {
    super(el, opts);
    this._buildings = [];
    this._activeId = null;
    this._open = false;
  }

  mount() {
    const store = OverlordUI.getStore();
    if (!store) return;

    this.subscribe(store, 'building.list', (buildings) => {
      this._buildings = buildings || [];
      this._updateList();
    });
    this.subscribe(store, 'building.active', (id) => {
      this._activeId = id;
      this._updateLabel();
      this._updateList();
    });

    this._buildings = store.get('building.list') || [];
    this._activeId = store.get('building.active');

    this._render();
  }

  _render() {
    this.el.className = 'project-switcher';

    // Trigger button
    const active = this._buildings.find(b => b.id === this._activeId);
    const label = active ? active.name : 'Select Project';
    this._btn = h('button', {
      class: 'project-switcher-btn toolbar-btn-icon',
      title: 'Switch project',
      'aria-label': `Current project: ${label}`,
      'aria-expanded': 'false',
      'aria-haspopup': 'listbox',
    },
      h('span', { class: 'project-switcher-icon' }, '📁'),
      h('span', { class: 'project-switcher-label' }, label),
      h('span', { class: 'project-switcher-caret' }, '▾')
    );
    this._btn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._toggle();
    });
    this.el.appendChild(this._btn);

    // Dropdown panel
    this._dropdown = h('div', { class: 'project-switcher-dropdown', role: 'listbox', 'aria-label': 'Projects' });
    this._dropdown.style.display = 'none';
    this.el.appendChild(this._dropdown);

    // Close on outside click
    this._outsideClickHandler = (e) => {
      if (this._open && !this.el.contains(e.target)) this._close();
    };
    document.addEventListener('click', this._outsideClickHandler);

    // Keyboard: Escape closes
    this._keyHandler = (e) => {
      if (e.key === 'Escape' && this._open) this._close();
    };
    document.addEventListener('keydown', this._keyHandler);

    this._updateList();
  }

  destroy() {
    if (this._outsideClickHandler) document.removeEventListener('click', this._outsideClickHandler);
    if (this._keyHandler) document.removeEventListener('keydown', this._keyHandler);
    super.destroy();
  }

  _toggle() {
    this._open ? this._close() : this._openDropdown();
  }

  _openDropdown() {
    this._open = true;
    this._dropdown.style.display = '';
    this._btn.setAttribute('aria-expanded', 'true');
  }

  _close() {
    this._open = false;
    this._dropdown.style.display = 'none';
    this._btn.setAttribute('aria-expanded', 'false');
  }

  _updateLabel() {
    const labelEl = this.el.querySelector('.project-switcher-label');
    if (!labelEl) return;
    const active = this._buildings.find(b => b.id === this._activeId);
    labelEl.textContent = active ? active.name : 'Select Project';
    if (this._btn) {
      this._btn.setAttribute('aria-label', `Current project: ${active?.name || 'none'}`);
    }
  }

  _updateList() {
    if (!this._dropdown) return;
    this._dropdown.textContent = '';

    if (this._buildings.length === 0) {
      this._dropdown.appendChild(h('div', { class: 'project-switcher-empty' }, 'No projects yet'));
      return;
    }

    for (const b of this._buildings) {
      const isActive = b.id === this._activeId;
      const phase = b.activePhase || b.active_phase || 'strategy';
      const phaseIcon = PHASE_ICONS[phase] || '📋';
      const state = b.executionState || b.execution_state || 'stopped';

      const item = h('div', {
        class: `project-switcher-item${isActive ? ' active' : ''}`,
        role: 'option',
        'aria-selected': isActive ? 'true' : 'false',
        tabindex: '0',
      },
        h('span', { class: `project-switcher-state project-switcher-state-${state}` }),
        h('span', { class: 'project-switcher-name' }, b.name),
        h('span', { class: 'project-switcher-phase' }, `${phaseIcon} ${phase}`),
      );

      item.addEventListener('click', () => this._selectProject(b.id));
      item.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          this._selectProject(b.id);
        }
      });
      this._dropdown.appendChild(item);
    }
  }

  _selectProject(buildingId) {
    this._close();
    if (buildingId === this._activeId) return;
    if (window.overlordSocket) {
      window.overlordSocket.selectBuilding(buildingId);
    }
  }
}
