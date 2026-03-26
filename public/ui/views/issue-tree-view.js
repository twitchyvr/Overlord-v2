/**
 * Overlord v2 — Issue Tree View (#1321)
 *
 * Visual tree rendering of the project's issue/task hierarchy.
 * Parses parent_id relationships and milestone groupings to build
 * a collapsible, color-coded dependency tree.
 *
 * Dual mode:
 *   - Visual: polished UI tree with icons, colors, connectors
 *   - Text: ASCII tree for AI agents to read/reference
 */

import { Component } from '../engine/component.js';
import { OverlordUI } from '../engine/engine.js';
import { h } from '../engine/helpers.js';

const STATUS_ICONS = {
  done:          { icon: '\u2713', color: 'var(--accent-green)',  label: 'Done' },
  'in-progress': { icon: '\u25B6', color: 'var(--accent-blue)',   label: 'In Progress' },
  pending:       { icon: '\u25CB', color: 'var(--text-muted)',    label: 'Pending' },
  blocked:       { icon: '\u2716', color: 'var(--accent-red, #ef4444)', label: 'Blocked' },
};

const PRIORITY_COLORS = {
  critical: 'var(--accent-red, #ef4444)',
  high:     'var(--accent-orange, #f97316)',
  medium:   'var(--accent-yellow)',
  normal:   'var(--text-muted)',
  low:      'var(--text-muted)',
};

const TYPE_ICONS = {
  epic:    '\u{1F3AF}',  // target
  feature: '\u{1F527}',  // wrench
  task:    '\u{1F4CB}',  // clipboard
  bug:     '\u{1F41B}',  // bug
  chore:   '\u{1F9F9}',  // broom
};

export class IssueTreeView extends Component {

  constructor(el, opts = {}) {
    super(el, opts);
    this._tasks = [];
    this._milestones = [];
    this._collapsed = new Set();
    this._textMode = false;
  }

  mount() {
    const store = OverlordUI.getStore();
    if (!store) return;

    this.subscribe(store, 'tasks.list', (tasks) => {
      this._tasks = tasks || [];
      this._renderTree();
    });
    this.subscribe(store, 'milestones.list', (milestones) => {
      this._milestones = milestones || [];
      this._renderTree();
    });
    this.subscribe(store, 'building.active', (id) => {
      if (id && window.overlordSocket) {
        window.overlordSocket.fetchTasks({ buildingId: id });
        window.overlordSocket.fetchMilestones(id);
      }
      this._render(); // Re-render to show/hide empty state
    });
    this.subscribe(store, 'building.data', () => {
      this._render(); // Re-render when building data arrives
    });

    // Hydrate
    this._tasks = store.get('tasks.list') || [];
    this._milestones = store.get('milestones.list') || [];
    const bid = store.get('building.active');
    if (bid && window.overlordSocket) {
      window.overlordSocket.fetchTasks({ buildingId: bid });
      window.overlordSocket.fetchMilestones(bid);
    }

    this._render();
  }

  _render() {
    this.el.textContent = '';
    this.el.className = 'issue-tree-view';

    const store = OverlordUI.getStore();
    const building = store?.get('building.data');

    if (!building) {
      this.el.appendChild(h('div', { class: 'empty-state' },
        h('div', { class: 'empty-state-icon' }, '\u{1F333}'),
        h('p', { class: 'empty-state-title' }, 'No Project Selected'),
        h('p', { class: 'empty-state-text' }, 'Select a project to see its issue tree.')
      ));
      return;
    }

    // Header
    const header = h('div', { class: 'issue-tree-header' },
      h('div', { class: 'issue-tree-title-row' },
        h('h2', null, '\u{1F333} Issue Tree'),
        h('span', { class: 'issue-tree-subtitle' }, `${this._tasks.length} items`)
      ),
      h('div', { class: 'issue-tree-actions' },
        (() => {
          const toggleBtn = h('button', {
            class: 'btn btn-ghost btn-sm',
            title: 'Toggle text mode for AI readability',
          }, this._textMode ? '\u{1F4BB} Visual' : '\u{1F4C4} Text Mode');
          toggleBtn.addEventListener('click', () => {
            this._textMode = !this._textMode;
            this._render();
          });
          return toggleBtn;
        })(),
        (() => {
          const expandBtn = h('button', { class: 'btn btn-ghost btn-sm' }, '\u{1F50D} Expand All');
          expandBtn.addEventListener('click', () => { this._collapsed.clear(); this._renderTree(); });
          return expandBtn;
        })(),
        (() => {
          const collapseBtn = h('button', { class: 'btn btn-ghost btn-sm' }, '\u{1F4E6} Collapse All');
          collapseBtn.addEventListener('click', () => {
            for (const t of this._tasks) if (this._getChildren(t.id).length > 0) this._collapsed.add(t.id);
            for (const m of this._milestones) this._collapsed.add(`ms_${m.id}`);
            this._renderTree();
          });
          return collapseBtn;
        })()
      )
    );
    this.el.appendChild(header);

    // Stats bar
    const stats = this._computeStats();
    const statsBar = h('div', { class: 'issue-tree-stats' },
      h('span', { class: 'issue-tree-stat done' }, `${stats.done} done`),
      h('span', { class: 'issue-tree-stat progress' }, `${stats.inProgress} in progress`),
      h('span', { class: 'issue-tree-stat pending' }, `${stats.pending} pending`),
      stats.blocked > 0 ? h('span', { class: 'issue-tree-stat blocked' }, `${stats.blocked} blocked`) : null,
    );
    this.el.appendChild(statsBar);

    // Tree container
    this._treeEl = h('div', { class: 'issue-tree-container', id: 'issue-tree-container' });
    this.el.appendChild(this._treeEl);

    this._renderTree();
  }

  _renderTree() {
    if (!this._treeEl) return;
    this._treeEl.textContent = '';

    if (this._textMode) {
      this._renderTextTree();
      return;
    }

    const tree = this._buildTree();

    if (tree.length === 0) {
      this._treeEl.appendChild(h('div', { class: 'issue-tree-empty' },
        'No tasks or milestones yet. Start your project to see the issue tree grow.'
      ));
      return;
    }

    for (const node of tree) {
      this._treeEl.appendChild(this._renderNode(node, 0));
    }
  }

  // ── Tree Data Structure ──

  _buildTree() {
    // Build a forest: milestones as top-level, then orphan tasks
    const taskMap = new Map();
    for (const t of this._tasks) taskMap.set(t.id, t);

    // Find root tasks (no parent_id)
    const roots = this._tasks.filter(t => !t.parent_id);
    const childMap = new Map();
    for (const t of this._tasks) {
      if (t.parent_id) {
        if (!childMap.has(t.parent_id)) childMap.set(t.parent_id, []);
        childMap.get(t.parent_id).push(t);
      }
    }
    this._childMap = childMap;

    // Group roots by milestone
    const milestoneGroups = new Map();
    const orphans = [];
    for (const t of roots) {
      if (t.milestone_id) {
        if (!milestoneGroups.has(t.milestone_id)) milestoneGroups.set(t.milestone_id, []);
        milestoneGroups.get(t.milestone_id).push(t);
      } else {
        orphans.push(t);
      }
    }

    const nodes = [];

    // Milestone nodes
    for (const ms of this._milestones) {
      const tasks = milestoneGroups.get(ms.id) || [];
      const doneCount = tasks.filter(t => t.status === 'done').length;
      nodes.push({
        id: `ms_${ms.id}`,
        title: ms.title,
        type: 'epic',
        status: ms.status === 'completed' ? 'done' : 'pending',
        priority: 'high',
        children: tasks.map(t => this._taskToNode(t)),
        meta: `${doneCount}/${tasks.length} tasks`,
      });
    }

    // Orphan tasks (no milestone)
    for (const t of orphans) {
      nodes.push(this._taskToNode(t));
    }

    return nodes;
  }

  _taskToNode(task) {
    const children = (this._childMap?.get(task.id) || []).map(c => this._taskToNode(c));
    const type = this._inferType(task);
    const doneChildren = children.filter(c => c.status === 'done').length;
    return {
      id: task.id,
      title: task.title,
      type,
      status: task.status || 'pending',
      priority: task.priority || 'normal',
      assignee: task.assignee_name || task.assignee_id || null,
      children,
      meta: children.length > 0 ? `${doneChildren}/${children.length}` : null,
    };
  }

  _inferType(task) {
    const t = (task.title || '').toLowerCase();
    if (t.startsWith('[epic')) return 'epic';
    if (t.startsWith('[feature')) return 'feature';
    if (t.startsWith('[bug')) return 'bug';
    if (t.startsWith('[chore') || t.startsWith('[infra')) return 'chore';
    return 'task';
  }

  _getChildren(taskId) {
    return this._childMap?.get(taskId) || [];
  }

  // ── Visual Tree Rendering ──

  _renderNode(node, depth) {
    const hasChildren = node.children && node.children.length > 0;
    const isCollapsed = this._collapsed.has(node.id);
    const statusCfg = STATUS_ICONS[node.status] || STATUS_ICONS.pending;
    const typeIcon = TYPE_ICONS[node.type] || TYPE_ICONS.task;
    const priorityColor = PRIORITY_COLORS[node.priority] || PRIORITY_COLORS.normal;

    const row = h('div', {
      class: `issue-tree-node depth-${Math.min(depth, 5)}`,
      'data-node-id': node.id,
      'data-status': node.status,
    });

    // Indent + connector
    if (depth > 0) {
      row.appendChild(h('span', { class: 'issue-tree-indent' },
        '\u2502 '.repeat(Math.max(0, depth - 1)) + '\u251C\u2500 '
      ));
    }

    // Collapse toggle
    if (hasChildren) {
      const toggle = h('button', {
        class: 'issue-tree-toggle',
        'aria-label': isCollapsed ? 'Expand' : 'Collapse',
        'aria-expanded': isCollapsed ? 'false' : 'true',
      }, isCollapsed ? '\u25B6' : '\u25BC');
      toggle.addEventListener('click', (e) => {
        e.stopPropagation();
        if (isCollapsed) this._collapsed.delete(node.id);
        else this._collapsed.add(node.id);
        this._renderTree();
      });
      row.appendChild(toggle);
    } else {
      row.appendChild(h('span', { class: 'issue-tree-toggle-spacer' }, ' '));
    }

    // Status dot
    row.appendChild(h('span', {
      class: 'issue-tree-status',
      style: { color: statusCfg.color },
      title: statusCfg.label,
    }, statusCfg.icon));

    // Type icon
    row.appendChild(h('span', { class: 'issue-tree-type' }, typeIcon));

    // Title
    const titleEl = h('span', {
      class: `issue-tree-title ${node.status === 'done' ? 'done' : ''}`,
    }, node.title);
    row.appendChild(titleEl);

    // Meta (child count)
    if (node.meta) {
      row.appendChild(h('span', { class: 'issue-tree-meta' }, node.meta));
    }

    // Priority pip
    if (node.priority && node.priority !== 'normal') {
      row.appendChild(h('span', {
        class: 'issue-tree-priority',
        style: { color: priorityColor },
      }, node.priority));
    }

    // Assignee
    if (node.assignee) {
      row.appendChild(h('span', { class: 'issue-tree-assignee' }, node.assignee));
    }

    const wrapper = h('div', { class: 'issue-tree-node-wrapper' });
    wrapper.appendChild(row);

    // Children
    if (hasChildren && !isCollapsed) {
      for (const child of node.children) {
        wrapper.appendChild(this._renderNode(child, depth + 1));
      }
    }

    return wrapper;
  }

  // ── Text Mode (AI-readable) ──

  _renderTextTree() {
    const tree = this._buildTree();
    const lines = [];
    const stats = this._computeStats();

    lines.push(`ISSUE TREE — ${this._tasks.length} items (${stats.done} done, ${stats.inProgress} in progress, ${stats.pending} pending)`);
    lines.push('═'.repeat(80));

    for (const node of tree) {
      this._textNode(node, 0, lines, true);
    }

    const pre = h('pre', { class: 'issue-tree-text' });
    pre.textContent = lines.join('\n');

    // Copy button
    const copyBtn = h('button', { class: 'btn btn-ghost btn-sm issue-tree-copy' }, '\u{1F4CB} Copy');
    copyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(lines.join('\n')).then(() => {
        copyBtn.textContent = '\u2713 Copied!';
        setTimeout(() => { copyBtn.textContent = '\u{1F4CB} Copy'; }, 2000);
      });
    });

    this._treeEl.appendChild(copyBtn);
    this._treeEl.appendChild(pre);
  }

  _textNode(node, depth, lines, isLast) {
    const prefix = depth === 0 ? '' : '  '.repeat(depth - 1) + (isLast ? '\u2514\u2500 ' : '\u251C\u2500 ');
    const statusChar = { done: '\u2713', 'in-progress': '\u25B6', pending: '\u25CB', blocked: '\u2716' }[node.status] || '\u25CB';
    const typeTag = node.type !== 'task' ? `[${node.type}] ` : '';
    const meta = node.meta ? ` (${node.meta})` : '';
    const priority = node.priority && node.priority !== 'normal' ? ` {${node.priority}}` : '';
    const assignee = node.assignee ? ` @${node.assignee}` : '';

    lines.push(`${prefix}${statusChar} ${typeTag}${node.title}${meta}${priority}${assignee}`);

    if (node.children) {
      for (let i = 0; i < node.children.length; i++) {
        this._textNode(node.children[i], depth + 1, lines, i === node.children.length - 1);
      }
    }
  }

  // ── Stats ──

  _computeStats() {
    let done = 0, inProgress = 0, pending = 0, blocked = 0;
    for (const t of this._tasks) {
      if (t.status === 'done') done++;
      else if (t.status === 'in-progress') inProgress++;
      else if (t.status === 'blocked') blocked++;
      else pending++;
    }
    return { done, inProgress, pending, blocked };
  }
}
