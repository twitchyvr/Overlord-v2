/**
 * Overlord v2 — Quick Actions FAB
 *
 * Floating Action Button (FAB) that provides one-click access to
 * common operations from any view. Positioned bottom-right.
 *
 * Actions:
 *   - New Task         → navigate to tasks + open create form
 *   - New RAID Entry   → navigate to RAID log + open create form
 *   - New Milestone    → navigate to milestones + open create form
 *   - Chat             → navigate to chat view
 *   - View Activity    → navigate to activity feed
 *   - Settings         → open settings
 *
 * Usage: Instantiate with a container element, then mount().
 * The FAB renders a "+" button that expands into a radial menu.
 */

import { Component } from '../engine/component.js';
import { OverlordUI } from '../engine/engine.js';
import { h } from '../engine/helpers.js';

const ACTIONS = [
  {
    id: 'new-task',
    label: 'New Task',
    icon: '\u2713',
    color: 'var(--accent-blue)',
    action: () => {
      OverlordUI.dispatch('navigate:tasks');
      // Small delay to let the view mount before requesting create
      setTimeout(() => OverlordUI.dispatch('task:request-create'), 150);
    }
  },
  {
    id: 'new-raid',
    label: 'New RAID Entry',
    icon: '\u26A0',
    color: 'var(--accent-orange)',
    action: () => {
      OverlordUI.dispatch('navigate:raid-log');
      setTimeout(() => OverlordUI.dispatch('raid:request-create'), 150);
    }
  },
  {
    id: 'new-milestone',
    label: 'New Milestone',
    icon: '\u{1F3AF}',
    color: 'var(--accent-green)',
    action: () => {
      OverlordUI.dispatch('navigate:milestones');
      setTimeout(() => OverlordUI.dispatch('milestone:request-create'), 150);
    }
  },
  {
    id: 'chat',
    label: 'Open Chat',
    icon: '\u{1F4AC}',
    color: 'var(--accent-purple)',
    action: () => {
      OverlordUI.dispatch('navigate:chat');
    }
  },
  {
    id: 'activity',
    label: 'Activity Feed',
    icon: '\u{1F4CB}',
    color: 'var(--accent-cyan)',
    action: () => {
      OverlordUI.dispatch('navigate:activity');
    }
  },
  {
    id: 'agents',
    label: 'View Agents',
    icon: '\u{1F916}',
    color: 'var(--accent-amber)',
    action: () => {
      OverlordUI.dispatch('navigate:agents');
    }
  }
];


export class QuickActions extends Component {

  constructor(el, opts = {}) {
    super(el, opts);
    this._open = false;
    this._boundClose = this._handleOutsideClick.bind(this);
    this._boundKeydown = this._handleKeydown.bind(this);
  }

  mount() {
    this._mounted = true;
    this.render();
  }

  unmount() {
    this._mounted = false;
    document.removeEventListener('click', this._boundClose);
    document.removeEventListener('keydown', this._boundKeydown);
  }

  render() {
    this.el.textContent = '';
    this.el.className = 'quick-actions-container';

    // Backdrop (only visible when open)
    const backdrop = h('div', {
      class: `qa-backdrop${this._open ? ' visible' : ''}`
    });
    backdrop.addEventListener('click', (e) => {
      e.stopPropagation();
      this._close();
    });
    this.el.appendChild(backdrop);

    // Action items (only rendered when open)
    if (this._open) {
      const menu = h('div', { class: 'qa-menu' });

      ACTIONS.forEach((action, idx) => {
        const item = h('div', {
          class: 'qa-item',
          style: {
            animationDelay: `${idx * 40}ms`
          }
        });

        const btn = h('button', {
          class: 'qa-item-btn',
          title: action.label,
          style: { '--qa-color': action.color }
        });

        const icon = h('span', { class: 'qa-item-icon' }, action.icon);
        const label = h('span', { class: 'qa-item-label' }, action.label);

        btn.appendChild(label);
        btn.appendChild(icon);
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          this._close();
          action.action();
        });

        item.appendChild(btn);
        menu.appendChild(item);
      });

      this.el.appendChild(menu);
    }

    // Main FAB button
    const fab = h('button', {
      class: `qa-fab${this._open ? ' open' : ''}`,
      title: this._open ? 'Close' : 'Quick Actions',
      'aria-label': this._open ? 'Close quick actions' : 'Open quick actions',
      'aria-expanded': String(this._open)
    });

    const fabIcon = h('span', { class: 'qa-fab-icon' }, this._open ? '\u2715' : '\u002B');
    fab.appendChild(fabIcon);

    fab.addEventListener('click', (e) => {
      e.stopPropagation();
      this._toggle();
    });

    this.el.appendChild(fab);

    // Manage global listeners
    if (this._open) {
      document.addEventListener('keydown', this._boundKeydown);
    } else {
      document.removeEventListener('keydown', this._boundKeydown);
    }
  }

  _toggle() {
    this._open = !this._open;
    this.render();
  }

  _close() {
    if (this._open) {
      this._open = false;
      this.render();
    }
  }

  _handleOutsideClick(e) {
    if (this._open && !this.el.contains(e.target)) {
      this._close();
    }
  }

  _handleKeydown(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      this._close();
    }
  }
}
