/**
 * Overlord v2 — Tasks Panel
 *
 * Right-sidebar panel showing task summary with status counts,
 * recent/active tasks list, and "View All" navigation to the full TaskView.
 * Subscribes to tasks.list store key for real-time updates.
 */

import { PanelComponent } from '../components/panel.js';
import { OverlordUI } from '../engine/engine.js';
import { h, formatTime } from '../engine/helpers.js';
import { DrillItem } from '../components/drill-item.js';
import { Button } from '../components/button.js';
import { navigateTo } from '../engine/router.js';


const STATUS_CONFIG = {
  pending:       { label: 'Pending',     color: 'var(--text-muted)',    icon: '\u25CB' },
  'in-progress': { label: 'In Progress', color: 'var(--accent-blue)',   icon: '\u25D4' },
  done:          { label: 'Done',        color: 'var(--accent-green)',  icon: '\u2714' },
  blocked:       { label: 'Blocked',     color: 'var(--accent-red)',    icon: '\u26D4' },
};

const PRIORITY_ORDER = { critical: 0, high: 1, normal: 2, low: 3 };

const MAX_VISIBLE_TASKS = 15;

export class TasksPanel extends PanelComponent {

  constructor(el) {
    super(el, {
      id: 'panel-tasks',
      label: 'Tasks',
      icon: '\u2611',
      defaultVisible: false
    });
    this._tasks = [];
  }

  mount() {
    super.mount();
    const store = OverlordUI.getStore();
    if (!store) return;

    this.subscribe(store, 'tasks.list', (tasks) => {
      this._tasks = tasks || [];
      this._renderContent();
    });

    // Auto-fetch when building changes
    this.subscribe(store, 'building.active', (buildingId) => {
      if (buildingId && window.overlordSocket) {
        window.overlordSocket.fetchTasks(buildingId);
      }
    });

    // If building is already active, fetch
    const activeBuildingId = store.get('building.active');
    if (activeBuildingId && window.overlordSocket) {
      window.overlordSocket.fetchTasks(activeBuildingId);
    }

    this._renderContent();
  }

  _renderContent() {
    const body = this.$('.panel-body');
    if (!body) return;
    body.textContent = '';

    // Status summary row
    const statsRow = h('div', { class: 'task-stats-row' });
    for (const [status, config] of Object.entries(STATUS_CONFIG)) {
      const count = this._tasks.filter(t => t.status === status).length;
      statsRow.appendChild(h('div', { class: 'task-stat' },
        h('span', { class: 'task-stat-count', style: { color: config.color } }, String(count)),
        h('span', { class: 'task-stat-label' }, config.label)
      ));
    }
    body.appendChild(statsRow);

    // Active / recent tasks — prioritize in-progress and blocked, then pending, then done
    const sortedTasks = [...this._tasks].sort((a, b) => {
      const statusPriority = { 'in-progress': 0, blocked: 1, pending: 2, done: 3 };
      const sDiff = (statusPriority[a.status] ?? 4) - (statusPriority[b.status] ?? 4);
      if (sDiff !== 0) return sDiff;
      const pDiff = (PRIORITY_ORDER[a.priority] ?? 2) - (PRIORITY_ORDER[b.priority] ?? 2);
      if (pDiff !== 0) return pDiff;
      return new Date(b.updated_at || b.created_at || 0).getTime() -
             new Date(a.updated_at || a.created_at || 0).getTime();
    });

    const visible = sortedTasks.slice(0, MAX_VISIBLE_TASKS);

    if (visible.length === 0) {
      body.appendChild(h('div', { class: 'panel-empty' }, 'No tasks yet.'));
    } else {
      const list = h('div', { class: 'tasks-panel-list' });
      for (const task of visible) {
        const statusCfg = STATUS_CONFIG[task.status] || STATUS_CONFIG.pending;

        const item = DrillItem.create('task', task, {
          icon: () => statusCfg.icon,
          summary: (d) => d.title || 'Untitled Task',
          badge: (d) => {
            if (d.priority === 'critical') return { text: 'CRIT', color: 'var(--accent-red)' };
            if (d.priority === 'high') return { text: 'HIGH', color: 'var(--accent-orange)' };
            return null;
          },
          meta: (d) => {
            const parts = [];
            if (d.status) parts.push(statusCfg.label);
            if (d.phase) parts.push(d.phase);
            return parts.join(' \u2022 ');
          },
          detail: [
            { label: 'Status', key: 'status' },
            { label: 'Priority', key: 'priority' },
            { label: 'Phase', key: 'phase' },
            { label: 'Assignee', key: 'assignee_id' },
            { label: 'Description', key: 'description' },
            { label: 'Created', key: 'created_at', format: 'date' },
            { label: 'Updated', key: 'updated_at', format: 'date' }
          ]
        });
        list.appendChild(item);
      }
      body.appendChild(list);

      // Show count if truncated
      if (this._tasks.length > MAX_VISIBLE_TASKS) {
        body.appendChild(h('div', { class: 'panel-truncated' },
          `Showing ${MAX_VISIBLE_TASKS} of ${this._tasks.length} tasks`
        ));
      }
    }

    // "View All" button
    const viewAllContainer = h('div', { class: 'panel-footer-action' });
    const viewAllBtn = Button.create('View All Tasks', {
      variant: 'ghost',
      size: 'sm',
      onClick: () => navigateTo('tasks')
    });
    viewAllContainer.appendChild(viewAllBtn);
    body.appendChild(viewAllContainer);
  }
}
