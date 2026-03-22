/**
 * Overlord v2 — Breadcrumb Navigation
 *
 * Shows spatial context across all views: Building > Room > Current View
 * Each segment is clickable for quick navigation back.
 * Hides automatically when no building is selected.
 */

import { Component } from '../engine/component.js';
import { OverlordUI } from '../engine/engine.js';
import { h } from '../engine/helpers.js';
import { resolveRoom } from '../engine/entity-nav.js';

const FLOOR_MAP = {
  'strategist':         'Strategy Floor',
  'building-architect': 'Strategy Floor',
  'discovery':          'Collaboration Floor',
  'architecture':       'Collaboration Floor',
  'war-room':           'Collaboration Floor',
  'code-lab':           'Execution Floor',
  'testing-lab':        'Execution Floor',
  'review':             'Governance Floor',
  'deploy':             'Operations Floor',
};

const VIEW_LABELS = {
  'dashboard':  'Dashboard',
  'chat':       'Chat',
  'tasks':      'Tasks',
  'agents':     'Agents',
  'activity':   'Activity',
  'email':      'Mail',
  'raid-log':   'RAID Log',
  'phase':      'Phase Gates',
  'milestones': 'Milestones',
  'strategist': 'New Project',
  'onboarding': 'Get Started',
};

export class BreadcrumbNav extends Component {

  constructor(el) {
    super(el);
    this._buildingId = null;
    this._buildingName = null;
    this._roomId = null;
    this._roomName = null;
    this._roomFloor = null;
    this._currentView = 'dashboard';
  }

  mount() {
    this._mounted = true;
    const store = OverlordUI.getStore();

    // Track active building
    if (store) {
      this.subscribe(store, 'building.active', (id) => {
        this._buildingId = id;
        this._updateBuildingName();
        this._render();
      });

      this.subscribe(store, 'building.list', () => {
        this._updateBuildingName();
        this._render();
      });
    }

    // Track room selection (opens in drawer alongside any view)
    this._listeners.push(
      OverlordUI.subscribe('building:room-selected', (data) => {
        if (data && data.roomId) {
          this._roomId = data.roomId;
          const room = resolveRoom(data.roomId);
          this._roomName = room?.name || data.roomId;
          this._roomFloor = FLOOR_MAP[room?.type] || null;
        }
        this._render();
      })
    );

    // Track view changes via router event
    this._listeners.push(
      OverlordUI.subscribe('view:changed', (data) => {
        if (data && data.view) {
          this._currentView = data.view;
          // Clear room context on view navigation (room detail is in drawer, not a view)
          this._roomId = null;
          this._roomName = null;
          this._roomFloor = null;
          this._render();
        }
      })
    );

    // Hydrate from store
    if (store) {
      this._buildingId = store.get('building.active');
      this._updateBuildingName();
    }

    this._render();
  }

  _updateBuildingName() {
    if (!this._buildingId) {
      this._buildingName = null;
      return;
    }
    const store = OverlordUI.getStore();
    const buildings = store?.get('building.list') || [];
    const b = buildings.find(b => b.id === this._buildingId);
    this._buildingName = b?.name || b?.project_name || null;
  }

  _render() {
    this.el.textContent = '';
    this.el.className = 'breadcrumb-bar';

    // Hide when no building is selected — nothing useful to show
    if (!this._buildingName) {
      this.el.hidden = true;
      return;
    }

    this.el.hidden = false;

    const nav = h('nav', {
      class: 'breadcrumb-trail',
      'aria-label': 'Breadcrumb navigation'
    });

    const ol = h('ol', { class: 'breadcrumb-list' });
    const segments = this._buildSegments();

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      const isLast = i === segments.length - 1;
      const li = h('li', { class: 'breadcrumb-item' });

      if (isLast || !seg.action) {
        // Current page or non-clickable segment
        li.appendChild(h('span', {
          class: `breadcrumb-label${isLast ? ' breadcrumb-current' : ''}`,
          'aria-current': isLast ? 'page' : undefined,
          title: seg.label,
        }, seg.label));
      } else {
        // Clickable link
        const link = h('button', {
          class: 'breadcrumb-link',
          type: 'button',
          title: `Go to ${seg.label}`,
        }, seg.label);
        link.addEventListener('click', seg.action);
        li.appendChild(link);
      }

      // Separator (chevron) after every non-last segment
      if (!isLast) {
        li.appendChild(h('span', {
          class: 'breadcrumb-sep',
          'aria-hidden': 'true'
        }, '\u203A'));
      }

      ol.appendChild(li);
    }

    nav.appendChild(ol);
    this.el.appendChild(nav);
  }

  _buildSegments() {
    const segments = [];

    // Building name — clickable, goes to dashboard
    segments.push({
      label: this._buildingName,
      action: () => OverlordUI.dispatch('navigate:dashboard'),
    });

    // Floor (when room is selected)
    if (this._roomFloor) {
      segments.push({ label: this._roomFloor });
    }

    // Room (when room is selected)
    if (this._roomName && this._roomId) {
      segments.push({
        label: this._roomName,
        action: () => OverlordUI.dispatch('navigate:entity', { type: 'room', id: this._roomId }),
      });
    }

    // Current view
    const viewLabel = VIEW_LABELS[this._currentView] || this._currentView;
    segments.push({ label: viewLabel, current: true });

    return segments;
  }
}
