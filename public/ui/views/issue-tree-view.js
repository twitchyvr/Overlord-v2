/**
 * Overlord v2 — Issue Tree View (Rewrite)
 *
 * Zoomable, fractal-like tree visualization of the project's issue/task
 * hierarchy. Three view modes:
 *
 *   1. Graph (default) — SVG tree graph with curved connectors, pan/zoom
 *   2. Cards — clickable card grid with drill-down to ANY depth
 *   3. Text  — full ASCII text tree with copy support
 *
 * Clicking a node with children "zooms in" to show that node
 * as the new root with its children rendered as polished cards. A
 * breadcrumb trail tracks the zoom path.
 *
 * Store keys: tasks.list, milestones.list, building.active, building.data
 */

import { Component } from '../engine/component.js';
import { OverlordUI } from '../engine/engine.js';
import { h } from '../engine/helpers.js';
import { TreeGraph } from '../components/tree-graph.js';

/* ═══════════════════════════════════════════════════════════
   Constants
   ═══════════════════════════════════════════════════════════ */

const STATUS_CONFIG = {
  done:          { color: 'var(--accent-green)',          label: 'Done',        char: '\u2713' },
  'in-progress': { color: 'var(--accent-blue)',           label: 'In Progress', char: '\u25B6' },
  pending:       { color: 'var(--text-muted)',            label: 'Pending',     char: '\u25CB' },
  blocked:       { color: 'var(--accent-red, #ef4444)',   label: 'Blocked',     char: '\u2716' },
};

const PRIORITY_CONFIG = {
  critical: { color: 'var(--accent-red, #ef4444)',    label: 'Critical' },
  high:     { color: 'var(--accent-orange, #fb923c)', label: 'High' },
  medium:   { color: 'var(--accent-yellow, #fbbf24)', label: 'Medium' },
  normal:   { color: 'var(--text-muted)',             label: 'Normal' },
  low:      { color: 'var(--text-muted)',             label: 'Low' },
};

const TYPE_ICONS = {
  epic:    '\u{1F3AF}',
  feature: '\u{1F527}',
  task:    '\u{1F4CB}',
  bug:     '\u{1F41B}',
  chore:   '\u{1F9F9}',
};

/** View modes: graph is the default */
const VIEW_MODES = ['graph', 'cards', 'text'];

/* ═══════════════════════════════════════════════════════════
   Component
   ═══════════════════════════════════════════════════════════ */

export class IssueTreeView extends Component {

  constructor(el, opts = {}) {
    super(el, opts);
    this._tasks = [];
    this._milestones = [];
    this._viewMode = 'graph';   // 'graph' | 'cards' | 'text'

    // Zoom state: path of node references from root to current focus
    // Each entry: { id, title } — the first is always the synthetic root
    this._zoomPath = [];   // breadcrumb trail
    this._zoomNode = null; // current zoomed-in tree node (null = show all roots)

    // Tree graph instance (for graph mode)
    this._treeGraph = null;

    // Max drill depth (configurable, default practically unlimited)
    this._maxDepth = opts.maxDepth || 1000;
  }

  /* ── Lifecycle ── */

  mount() {
    this._mounted = true;
    const store = OverlordUI.getStore();
    if (!store) return;

    this.subscribe(store, 'tasks.list', (tasks) => {
      this._tasks = tasks || [];
      this._fullRender();
    });
    this.subscribe(store, 'milestones.list', (milestones) => {
      this._milestones = milestones || [];
      this._fullRender();
    });
    this.subscribe(store, 'building.active', (id) => {
      if (id && window.overlordSocket) {
        window.overlordSocket.fetchTasks({ buildingId: id });
        window.overlordSocket.fetchMilestones(id);
      }
      this._resetZoom();
      this._fullRender();
    });
    this.subscribe(store, 'building.data', () => {
      this._fullRender();
    });

    // Hydrate from current store state
    this._tasks = store.get('tasks.list') || [];
    this._milestones = store.get('milestones.list') || [];
    const bid = store.get('building.active');
    if (bid && window.overlordSocket) {
      window.overlordSocket.fetchTasks({ buildingId: bid });
      window.overlordSocket.fetchMilestones(bid);
    }

    this._fullRender();
  }

  destroy() {
    this._destroyTreeGraph();
    super.destroy();
  }

  /* ── Full render (clears and rebuilds entire view) ── */

  _fullRender() {
    // Destroy existing tree graph before clearing DOM
    this._destroyTreeGraph();

    this.el.textContent = '';
    this.el.className = 'issue-tree-view';

    const store = OverlordUI.getStore();
    const building = store?.get('building.data');

    if (!building) {
      this.el.appendChild(this._renderEmptyProject());
      return;
    }

    // Rebuild the tree data from scratch
    this._tree = this._buildTree();

    // Validate zoom path still exists in new data
    this._validateZoom();

    // Inject scoped styles
    this.el.appendChild(this._buildStyles());

    // Header (title + mode toggle + zoom-out)
    this.el.appendChild(this._renderHeader());

    // Stats bar
    this.el.appendChild(this._renderStatsBar());

    // Breadcrumb trail (not shown in graph mode)
    if (this._viewMode !== 'graph') {
      this.el.appendChild(this._renderBreadcrumbs());
    }

    // Main content area
    this._containerEl = h('div', { class: 'issue-tree-container' });

    // Graph mode needs full height
    if (this._viewMode === 'graph') {
      this._containerEl.style.cssText = 'flex:1;min-height:0;position:relative;';
    }

    this.el.appendChild(this._containerEl);

    this._renderContent();
  }

  /* ── Content render (just the card grid / text / graph, no header rebuild) ── */

  _renderContent() {
    if (!this._containerEl) return;
    this._containerEl.textContent = '';

    if (this._viewMode === 'text') {
      this._containerEl.appendChild(this._renderTextMode());
      return;
    }

    if (this._viewMode === 'graph') {
      this._renderGraphMode();
      return;
    }

    // Cards mode
    const currentChildren = this._getZoomedChildren();

    if (currentChildren.length === 0) {
      this._containerEl.appendChild(
        h('div', { class: 'issue-tree-empty' },
          h('div', { class: 'issue-tree-empty-icon' }, '\u{1F333}'),
          h('p', null, this._zoomNode
            ? 'No sub-items. This is a leaf node.'
            : 'No tasks or milestones yet. Start your project to see the issue tree grow.')
        )
      );
      return;
    }

    // If zoomed into a node, show a summary card for it
    if (this._zoomNode) {
      this._containerEl.appendChild(this._renderFocusSummary(this._zoomNode));
    }

    // Render children as cards
    const grid = h('div', { class: 'issue-tree-grid' });
    for (const child of currentChildren) {
      grid.appendChild(this._renderCard(child));
    }
    this._containerEl.appendChild(grid);
  }

  /* ═══════════════════════════════════════════════════════════
     Graph Mode
     ═══════════════════════════════════════════════════════════ */

  _renderGraphMode() {
    if (!this._containerEl) return;

    // Create a graph container that fills available space
    const graphEl = h('div', {
      class: 'issue-tree-graph-container',
      style: { width: '100%', height: 'calc(100vh - 220px)', minHeight: '400px' },
    });
    this._containerEl.appendChild(graphEl);

    // Create TreeGraph instance
    this._treeGraph = new TreeGraph(graphEl, {
      onNodeClick: (nodeData) => this._onGraphNodeClick(nodeData),
      maxDepth: this._maxDepth,
    });

    // Pass the tree data to the graph
    const treeData = this._tree || [];
    this._treeGraph.render(treeData);
  }

  _onGraphNodeClick(nodeData) {
    if (!nodeData || !this._treeGraph) return;
    this._treeGraph.centerOnNode(nodeData.id);
    this._showNodeDetail(nodeData);
  }

  _showNodeDetail(node) {
    // Remove existing panel
    const existing = this.el.querySelector('.issue-tree-detail-panel');
    if (existing) existing.remove();

    const statusCfg = STATUS_CONFIG[node.status] || STATUS_CONFIG.pending;
    const typeCfg = TYPE_ICONS[node.type] || TYPE_ICONS.task;
    const priorityCfg = PRIORITY_CONFIG[node.priority] || {};
    const progress = this._computeProgress(node);

    // Find parent and siblings
    const parent = this._findParentOf(node.id, this._tree);
    const siblings = parent?.children?.filter(c => c.id !== node.id) || [];

    const panel = h('div', { class: 'issue-tree-detail-panel' });

    // Close button
    const closeBtn = h('button', {
      class: 'issue-tree-detail-close',
      'aria-label': 'Close detail panel',
    }, '\u2715');
    closeBtn.addEventListener('click', () => panel.remove());
    panel.appendChild(closeBtn);

    // Header
    panel.appendChild(h('div', { class: 'issue-tree-detail-header' },
      h('span', { class: 'issue-tree-detail-type' }, typeCfg),
      h('span', {
        class: 'issue-tree-detail-status',
        style: { color: statusCfg.color },
      }, statusCfg.label),
    ));

    // Title
    panel.appendChild(h('h3', { class: 'issue-tree-detail-title' }, node.title));

    // Meta badges
    const meta = h('div', { class: 'issue-tree-detail-meta' });
    if (node.priority && node.priority !== 'normal') {
      meta.appendChild(h('span', {
        class: 'issue-tree-detail-badge',
        style: { borderColor: priorityCfg.color || 'var(--text-muted)', color: priorityCfg.color || 'var(--text-muted)' },
      }, node.priority.toUpperCase()));
    }
    if (node.assignee) {
      meta.appendChild(h('span', { class: 'issue-tree-detail-badge' }, node.assignee));
    }
    meta.appendChild(h('span', { class: 'issue-tree-detail-badge' }, node.type));
    panel.appendChild(meta);

    // Progress
    if (node.children && node.children.length > 0) {
      const done = node.children.filter(c => c.status === 'done').length;
      const total = node.children.length;
      const pct = total > 0 ? Math.round((done / total) * 100) : 0;

      const progressSection = h('div', { class: 'issue-tree-detail-progress' },
        h('div', { class: 'issue-tree-detail-progress-label' }, `${done}/${total} children done (${pct}%)`),
        h('div', { class: 'issue-tree-detail-progress-bar' },
          h('div', { class: 'issue-tree-detail-progress-fill', style: { width: `${pct}%` } }),
        ),
      );
      panel.appendChild(progressSection);
    }

    // Connections section
    const connections = h('div', { class: 'issue-tree-detail-connections' });
    connections.appendChild(h('div', { class: 'issue-tree-detail-section-title' }, 'Connections'));

    // Parent
    if (parent && parent.id !== '__vroot__') {
      const parentRow = h('div', { class: 'issue-tree-detail-conn-row' },
        h('span', { class: 'issue-tree-detail-conn-type', style: { color: 'var(--accent-purple)' } }, '\u2191 Parent'),
        h('span', { class: 'issue-tree-detail-conn-name' }, parent.title),
      );
      parentRow.style.cursor = 'pointer';
      parentRow.addEventListener('click', () => {
        this._treeGraph?.centerOnNode(parent.id);
        this._showNodeDetail(parent);
      });
      connections.appendChild(parentRow);
    }

    // Children
    if (node.children && node.children.length > 0) {
      connections.appendChild(h('div', { class: 'issue-tree-detail-conn-label' },
        `\u2193 ${node.children.length} ${node.children.length === 1 ? 'child' : 'children'}`));
      for (const child of node.children.slice(0, 10)) {
        const childStatusCfg = STATUS_CONFIG[child.status] || STATUS_CONFIG.pending;
        const row = h('div', { class: 'issue-tree-detail-conn-row' },
          h('span', { style: { color: childStatusCfg.color } }, childStatusCfg.char),
          h('span', { class: 'issue-tree-detail-conn-name' }, child.title),
        );
        row.style.cursor = 'pointer';
        row.addEventListener('click', () => {
          this._treeGraph?.centerOnNode(child.id);
          this._showNodeDetail(child);
        });
        connections.appendChild(row);
      }
      if (node.children.length > 10) {
        connections.appendChild(h('div', { class: 'issue-tree-detail-conn-more' }, `+${node.children.length - 10} more`));
      }
    }

    // Siblings
    if (siblings.length > 0) {
      connections.appendChild(h('div', { class: 'issue-tree-detail-conn-label' },
        `\u2194 ${siblings.length} ${siblings.length === 1 ? 'sibling' : 'siblings'}`));
      for (const sib of siblings.slice(0, 5)) {
        const sibStatusCfg = STATUS_CONFIG[sib.status] || STATUS_CONFIG.pending;
        const row = h('div', { class: 'issue-tree-detail-conn-row' },
          h('span', { style: { color: sibStatusCfg.color } }, sibStatusCfg.char),
          h('span', { class: 'issue-tree-detail-conn-name' }, sib.title),
        );
        row.style.cursor = 'pointer';
        row.addEventListener('click', () => {
          this._treeGraph?.centerOnNode(sib.id);
          this._showNodeDetail(sib);
        });
        connections.appendChild(row);
      }
      if (siblings.length > 5) {
        connections.appendChild(h('div', { class: 'issue-tree-detail-conn-more' }, `+${siblings.length - 5} more`));
      }
    }

    panel.appendChild(connections);

    // Quick actions — navigate to related Overlord views
    const actions = h('div', { class: 'issue-tree-detail-actions' });
    actions.appendChild(h('div', { class: 'issue-tree-detail-section-title' }, 'Quick Actions'));

    const makeAction = (label, icon, handler) => {
      const btn = h('button', { class: 'issue-tree-detail-action-btn' },
        h('span', null, icon), h('span', null, label));
      btn.addEventListener('click', handler);
      return btn;
    };

    actions.appendChild(makeAction('View in Tasks', '\u{1F4CB}', () => OverlordUI.navigateTo('tasks')));
    if (node.assignee) {
      actions.appendChild(makeAction('View Agent', '\u{1F916}', () => OverlordUI.navigateTo('agents')));
    }
    actions.appendChild(makeAction('View Activity', '\u{23F2}', () => OverlordUI.navigateTo('activity')));
    actions.appendChild(makeAction('View RAID Log', '\u26A0\uFE0F', () => OverlordUI.navigateTo('raid-log')));

    panel.appendChild(actions);
    this.el.appendChild(panel);
  }

  _findParentOf(nodeId, nodes, parent = null) {
    if (!nodes) return null;
    for (const node of nodes) {
      if (node.id === nodeId) return parent;
      if (node.children) {
        const found = this._findParentOf(nodeId, node.children, node);
        if (found) return found;
      }
    }
    return null;
  }

  _destroyTreeGraph() {
    if (this._treeGraph) {
      this._treeGraph.destroy();
      this._treeGraph = null;
    }
  }

  /* ═══════════════════════════════════════════════════════════
     Tree Data Construction
     ═══════════════════════════════════════════════════════════ */

  _buildTree() {
    // Build child lookup from parent_id relationships.
    // This is the key fix: every task with parent_id gets attached
    // to its parent as a child, regardless of whether the parent
    // is a milestone or another task. This enables drill-down to
    // ANY depth, not just milestones.
    const childMap = new Map();
    for (const t of this._tasks) {
      if (t.parent_id) {
        if (!childMap.has(t.parent_id)) childMap.set(t.parent_id, []);
        childMap.get(t.parent_id).push(t);
      }
    }
    this._childMap = childMap;

    // Root tasks (no parent_id)
    const roots = this._tasks.filter(t => !t.parent_id);

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
      nodes.push({
        id: `ms_${ms.id}`,
        title: ms.title,
        type: 'epic',
        status: ms.status === 'completed' ? 'done' : 'pending',
        priority: 'high',
        children: tasks.map(t => this._taskToNode(t, 0)),
        assignee: null,
      });
    }

    // Orphan tasks (recursively built with children from parent_id)
    for (const t of orphans) {
      nodes.push(this._taskToNode(t, 0));
    }

    return nodes;
  }

  /**
   * Recursively convert a task to a tree node, attaching children
   * found via parent_id. Depth-limited by this._maxDepth to prevent
   * infinite recursion on malformed data.
   */
  _taskToNode(task, depth) {
    const childTasks = this._childMap?.get(task.id) || [];
    const children = depth < this._maxDepth
      ? childTasks.map(c => this._taskToNode(c, depth + 1))
      : [];

    return {
      id: task.id,
      title: task.title,
      type: this._inferType(task),
      status: task.status || 'pending',
      priority: task.priority || 'normal',
      assignee: task.assignee_name || task.assignee_id || null,
      children,
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

  /* ═══════════════════════════════════════════════════════════
     Progress Computation
     ═══════════════════════════════════════════════════════════ */

  /**
   * Recursively compute progress for a node.
   * Returns { done, total, percent }.
   * Leaf nodes: done = status==='done' ? 1 : 0, total = 1
   * Parent nodes: aggregate of all descendant leaves.
   */
  _computeProgress(node) {
    if (!node.children || node.children.length === 0) {
      const isDone = node.status === 'done' ? 1 : 0;
      return { done: isDone, total: 1, percent: isDone * 100 };
    }

    let done = 0;
    let total = 0;
    for (const child of node.children) {
      const cp = this._computeProgress(child);
      done += cp.done;
      total += cp.total;
    }
    const percent = total > 0 ? Math.round((done / total) * 100) : 0;
    return { done, total, percent };
  }

  /**
   * Compute direct-children-level progress (not deep).
   * Returns { done, total, percent }.
   */
  _computeDirectProgress(node) {
    if (!node.children || node.children.length === 0) {
      return { done: 0, total: 0, percent: 0 };
    }
    let done = 0;
    for (const child of node.children) {
      if (child.status === 'done') done++;
    }
    const total = node.children.length;
    const percent = total > 0 ? Math.round((done / total) * 100) : 0;
    return { done, total, percent };
  }

  /* ═══════════════════════════════════════════════════════════
     Zoom Navigation
     ═══════════════════════════════════════════════════════════ */

  _resetZoom() {
    this._zoomPath = [];
    this._zoomNode = null;
  }

  _zoomInto(node) {
    this._zoomPath.push({ id: node.id, title: node.title });
    this._zoomNode = node;
    this._fullRender();
  }

  _zoomTo(index) {
    // index -1 means root (All)
    if (index < 0) {
      this._resetZoom();
    } else {
      this._zoomPath = this._zoomPath.slice(0, index + 1);
      // Re-find the node in the tree
      const target = this._zoomPath[this._zoomPath.length - 1];
      this._zoomNode = this._findNode(this._tree, target.id);
    }
    this._fullRender();
  }

  _zoomOut() {
    if (this._zoomPath.length === 0) return;
    this._zoomPath.pop();
    if (this._zoomPath.length === 0) {
      this._zoomNode = null;
    } else {
      const target = this._zoomPath[this._zoomPath.length - 1];
      this._zoomNode = this._findNode(this._tree, target.id);
    }
    this._fullRender();
  }

  _findNode(nodes, id) {
    for (const n of nodes) {
      if (n.id === id) return n;
      if (n.children) {
        const found = this._findNode(n.children, id);
        if (found) return found;
      }
    }
    return null;
  }

  _validateZoom() {
    // After tree rebuild, verify each zoom path entry still exists
    if (this._zoomPath.length === 0) {
      this._zoomNode = null;
      return;
    }
    let valid = true;
    for (const entry of this._zoomPath) {
      if (!this._findNode(this._tree, entry.id)) {
        valid = false;
        break;
      }
    }
    if (!valid) {
      this._resetZoom();
    } else {
      const last = this._zoomPath[this._zoomPath.length - 1];
      this._zoomNode = this._findNode(this._tree, last.id);
    }
  }

  _getZoomedChildren() {
    if (this._zoomNode) {
      return this._zoomNode.children || [];
    }
    return this._tree || [];
  }

  /* ═══════════════════════════════════════════════════════════
     Stats
     ═══════════════════════════════════════════════════════════ */

  _computeStats() {
    let done = 0, inProgress = 0, pending = 0, blocked = 0;
    for (const t of this._tasks) {
      if (t.status === 'done') done++;
      else if (t.status === 'in-progress') inProgress++;
      else if (t.status === 'blocked') blocked++;
      else pending++;
    }
    return { done, inProgress, pending, blocked, total: this._tasks.length };
  }

  /* ═══════════════════════════════════════════════════════════
     Render: Header
     ═══════════════════════════════════════════════════════════ */

  _renderEmptyProject() {
    return h('div', { class: 'empty-state' },
      h('div', { class: 'empty-state-icon' }, '\u{1F333}'),
      h('p', { class: 'empty-state-title' }, 'No Project Selected'),
      h('p', { class: 'empty-state-text' }, 'Select a project to see its issue tree.')
    );
  }

  _renderHeader() {
    // View mode toggle buttons (Graph | Cards | Text)
    const modeButtons = h('div', { class: 'issue-tree-mode-toggle' });

    const modes = [
      { key: 'graph', label: '\u{1F578}\uFE0F Graph',  title: 'SVG tree graph view' },
      { key: 'cards', label: '\u{1F3AF} Cards', title: 'Drill-down card view' },
      { key: 'text',  label: '\u{1F4C4} Text',  title: 'ASCII text tree view' },
    ];

    for (const mode of modes) {
      const btn = h('button', {
        class: `btn btn-ghost btn-sm issue-tree-mode-btn ${this._viewMode === mode.key ? 'issue-tree-mode-btn--active' : ''}`,
        title: mode.title,
      }, mode.label);
      btn.addEventListener('click', () => {
        if (this._viewMode === mode.key) return;
        this._viewMode = mode.key;
        this._fullRender();
      });
      modeButtons.appendChild(btn);
    }

    const actions = [modeButtons];

    if (this._viewMode !== 'graph' && this._zoomPath.length > 0) {
      const zoomOutBtn = h('button', {
        class: 'btn btn-ghost btn-sm',
        title: 'Zoom out one level',
      }, '\u2B06 Zoom Out');
      zoomOutBtn.addEventListener('click', () => this._zoomOut());
      actions.unshift(zoomOutBtn);
    }

    return h('div', { class: 'issue-tree-header' },
      h('div', { class: 'issue-tree-title-row' },
        h('h2', null, '\u{1F333} Issue Tree'),
        h('span', { class: 'issue-tree-subtitle' },
          `${this._tasks.length} items`)
      ),
      h('div', { class: 'issue-tree-actions' }, ...actions)
    );
  }

  /* ═══════════════════════════════════════════════════════════
     Render: Stats Bar
     ═══════════════════════════════════════════════════════════ */

  _renderStatsBar() {
    const stats = this._computeStats();
    const children = [
      h('span', { class: 'issue-tree-stat done' }, `${stats.done} done`),
      h('span', { class: 'issue-tree-stat progress' }, `${stats.inProgress} in progress`),
      h('span', { class: 'issue-tree-stat pending' }, `${stats.pending} pending`),
    ];
    if (stats.blocked > 0) {
      children.push(h('span', { class: 'issue-tree-stat blocked' }, `${stats.blocked} blocked`));
    }
    return h('div', { class: 'issue-tree-stats' }, ...children);
  }

  /* ═══════════════════════════════════════════════════════════
     Render: Breadcrumbs
     ═══════════════════════════════════════════════════════════ */

  _renderBreadcrumbs() {
    const trail = h('nav', {
      class: 'issue-tree-breadcrumbs',
      'aria-label': 'Issue tree navigation',
    });

    // "All" root link
    const allLink = h('button', {
      class: `issue-tree-crumb ${this._zoomPath.length === 0 ? 'issue-tree-crumb--active' : ''}`,
    }, 'All');
    allLink.addEventListener('click', () => this._zoomTo(-1));
    trail.appendChild(allLink);

    for (let i = 0; i < this._zoomPath.length; i++) {
      const entry = this._zoomPath[i];
      const isLast = i === this._zoomPath.length - 1;

      trail.appendChild(h('span', { class: 'issue-tree-crumb-sep' }, '\u203A'));

      const crumb = h('button', {
        class: `issue-tree-crumb ${isLast ? 'issue-tree-crumb--active' : ''}`,
      }, this._truncate(entry.title, 30));
      const idx = i;
      crumb.addEventListener('click', () => this._zoomTo(idx));
      trail.appendChild(crumb);
    }

    return trail;
  }

  /* ═══════════════════════════════════════════════════════════
     Render: Focus Summary (shown when zoomed into a node)
     ═══════════════════════════════════════════════════════════ */

  _renderFocusSummary(node) {
    const statusCfg = STATUS_CONFIG[node.status] || STATUS_CONFIG.pending;
    const typeIcon = TYPE_ICONS[node.type] || TYPE_ICONS.task;
    const progress = this._computeProgress(node);
    const directProgress = this._computeDirectProgress(node);

    return h('div', { class: 'issue-tree-focus' },
      h('div', { class: 'issue-tree-focus-header' },
        h('span', { class: 'issue-tree-focus-type' }, typeIcon),
        h('span', { class: 'issue-tree-focus-title' }, node.title),
        h('span', {
          class: 'issue-tree-focus-status',
          style: { color: statusCfg.color },
        }, statusCfg.label)
      ),
      h('div', { class: 'issue-tree-focus-meta' },
        h('span', null, `${directProgress.done}/${directProgress.total} direct children done`),
        h('span', null, '\u00B7'),
        h('span', null, `${progress.done}/${progress.total} total (${progress.percent}%)`)
      ),
      this._renderProgressBar(progress.percent, statusCfg.color, false)
    );
  }

  /* ═══════════════════════════════════════════════════════════
     Render: Node Card
     ═══════════════════════════════════════════════════════════ */

  _renderCard(node) {
    const statusCfg = STATUS_CONFIG[node.status] || STATUS_CONFIG.pending;
    const typeIcon = TYPE_ICONS[node.type] || TYPE_ICONS.task;
    const priorityCfg = PRIORITY_CONFIG[node.priority] || PRIORITY_CONFIG.normal;

    // FIX: Check for children from parent_id relationships, not just
    // milestone-level. The children array is already populated recursively
    // by _taskToNode, so ANY node with children gets the drill-down chevron.
    const hasChildren = node.children && node.children.length > 0;
    const progress = hasChildren ? this._computeProgress(node) : null;

    const card = h('div', {
      class: 'issue-tree-card',
      style: { borderLeftColor: statusCfg.color },
      'data-status': node.status,
      'data-node-id': node.id,
    });

    // Top row: type icon + title + chevron
    const topRow = h('div', { class: 'issue-tree-card-top' });

    topRow.appendChild(h('span', { class: 'issue-tree-card-type' }, typeIcon));

    topRow.appendChild(h('span', { class: 'issue-tree-card-title' },
      this._truncate(node.title, 50)));

    // FIX: Chevron shown for ALL nodes with children, not just milestones.
    // This enables drilling into tasks that have sub-tasks via parent_id.
    if (hasChildren) {
      const chevron = h('button', {
        class: 'issue-tree-card-chevron',
        'aria-label': `Zoom into ${node.title}`,
        title: `Zoom in (${node.children.length} children)`,
      }, '\u203A');
      chevron.addEventListener('click', (e) => {
        e.stopPropagation();
        this._zoomInto(node);
      });
      topRow.appendChild(chevron);
    }

    card.appendChild(topRow);

    // Middle row: progress bar (if has children)
    if (progress) {
      card.appendChild(this._renderProgressBar(progress.percent, statusCfg.color, true));
    }

    // Bottom row: badges
    const bottomRow = h('div', { class: 'issue-tree-card-bottom' });

    // Status badge
    bottomRow.appendChild(h('span', {
      class: 'issue-tree-card-badge',
      style: { color: statusCfg.color },
    }, `${statusCfg.char} ${statusCfg.label}`));

    // Child count badge
    if (hasChildren) {
      bottomRow.appendChild(h('span', { class: 'issue-tree-card-badge issue-tree-card-badge--count' },
        `${progress.done}/${progress.total} done`));
    }

    // Priority badge (only for non-normal)
    if (node.priority && node.priority !== 'normal' && node.priority !== 'low') {
      bottomRow.appendChild(h('span', {
        class: `issue-tree-card-badge issue-tree-card-badge--priority`,
        style: { color: priorityCfg.color, borderColor: priorityCfg.color },
      }, priorityCfg.label));
    }

    // Assignee
    if (node.assignee) {
      bottomRow.appendChild(h('span', { class: 'issue-tree-card-badge issue-tree-card-badge--assignee' },
        `@${node.assignee}`));
    }

    card.appendChild(bottomRow);

    // Preview of grandchildren if this node has children
    if (hasChildren) {
      const preview = this._renderChildrenPreview(node);
      if (preview) card.appendChild(preview);
    }

    // Make entire card clickable to zoom if it has children
    if (hasChildren) {
      card.style.cursor = 'pointer';
      card.addEventListener('click', () => this._zoomInto(node));
    }

    return card;
  }

  /* ── Progress bar ── */

  _renderProgressBar(percent, color, compact) {
    const barHeight = compact ? '4px' : '6px';
    return h('div', { class: 'issue-tree-progress-wrap' },
      h('div', {
        class: 'issue-tree-progress-track',
        style: { height: barHeight },
      },
        h('div', {
          class: 'issue-tree-progress-fill',
          style: { width: `${percent}%`, background: color },
        })
      ),
      compact
        ? h('span', { class: 'issue-tree-progress-label' }, `${percent}%`)
        : null
    );
  }

  /* ── Children preview (shown inside a parent card) ── */

  _renderChildrenPreview(node) {
    if (!node.children || node.children.length === 0) return null;

    const MAX_PREVIEW = 3;
    const showing = node.children.slice(0, MAX_PREVIEW);
    const remaining = node.children.length - MAX_PREVIEW;

    const preview = h('div', { class: 'issue-tree-card-preview' });

    for (const child of showing) {
      const childStatusCfg = STATUS_CONFIG[child.status] || STATUS_CONFIG.pending;
      const childTypeIcon = TYPE_ICONS[child.type] || TYPE_ICONS.task;
      const childHasKids = child.children && child.children.length > 0;
      const childProgress = childHasKids ? this._computeProgress(child) : null;

      const row = h('div', { class: 'issue-tree-card-preview-item' },
        h('span', {
          class: 'issue-tree-card-preview-dot',
          style: { background: childStatusCfg.color },
        }),
        h('span', { class: 'issue-tree-card-preview-icon' }, childTypeIcon),
        h('span', { class: 'issue-tree-card-preview-title' },
          this._truncate(child.title, 35)),
        // Show child count indicator for grandchildren
        childHasKids
          ? h('span', { class: 'issue-tree-card-preview-progress' },
              childProgress ? `${childProgress.percent}% (${child.children.length})` : `(${child.children.length})`)
          : null
      );
      preview.appendChild(row);
    }

    if (remaining > 0) {
      preview.appendChild(h('div', { class: 'issue-tree-card-preview-more' },
        `+${remaining} more`));
    }

    return preview;
  }

  /* ═══════════════════════════════════════════════════════════
     Render: Text Mode (ASCII tree)
     ═══════════════════════════════════════════════════════════ */

  _renderTextMode() {
    const tree = this._tree || [];
    const stats = this._computeStats();
    const lines = [];

    lines.push(`ISSUE TREE \u2014 ${stats.total} items (${stats.done} done, ${stats.inProgress} in progress, ${stats.pending} pending${stats.blocked > 0 ? `, ${stats.blocked} blocked` : ''})`);
    lines.push('\u2550'.repeat(80));
    lines.push('');

    for (let i = 0; i < tree.length; i++) {
      this._textNode(tree[i], 0, lines, i === tree.length - 1, '');
    }

    const textContent = lines.join('\n');

    const wrapper = h('div', { class: 'issue-tree-text-wrapper' });

    const copyBtn = h('button', { class: 'btn btn-ghost btn-sm issue-tree-copy' }, '\u{1F4CB} Copy');
    copyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(textContent).then(() => {
        copyBtn.textContent = '\u2713 Copied!';
        setTimeout(() => { copyBtn.textContent = '\u{1F4CB} Copy'; }, 2000);
      });
    });

    const pre = h('pre', { class: 'issue-tree-text' });
    pre.textContent = textContent;

    wrapper.appendChild(copyBtn);
    wrapper.appendChild(pre);
    return wrapper;
  }

  _textNode(node, depth, lines, isLast, parentPrefix) {
    const connector = depth === 0 ? '' : (isLast ? '\u2514\u2500\u2500 ' : '\u251C\u2500\u2500 ');
    const prefix = depth === 0 ? '' : parentPrefix + connector;

    const statusChar = (STATUS_CONFIG[node.status] || STATUS_CONFIG.pending).char;
    const typeTag = node.type !== 'task' ? `[${node.type}] ` : '';
    const hasChildren = node.children && node.children.length > 0;
    const progress = hasChildren ? this._computeProgress(node) : null;
    const progressStr = progress ? ` (${progress.done}/${progress.total} \u2014 ${progress.percent}%)` : '';
    const priorityStr = (node.priority && node.priority !== 'normal' && node.priority !== 'low')
      ? ` {${node.priority}}`
      : '';
    const assigneeStr = node.assignee ? ` @${node.assignee}` : '';

    lines.push(`${prefix}${statusChar} ${typeTag}${node.title}${progressStr}${priorityStr}${assigneeStr}`);

    if (hasChildren) {
      const childPrefix = depth === 0 ? '' : parentPrefix + (isLast ? '    ' : '\u2502   ');
      for (let i = 0; i < node.children.length; i++) {
        this._textNode(node.children[i], depth + 1, lines, i === node.children.length - 1, childPrefix);
      }
    }
  }

  /* ═══════════════════════════════════════════════════════════
     Utilities
     ═══════════════════════════════════════════════════════════ */

  _truncate(str, max) {
    if (!str) return '';
    return str.length > max ? str.slice(0, max - 1) + '\u2026' : str;
  }

  /* ═══════════════════════════════════════════════════════════
     Scoped Styles (injected as <style> element)
     ═══════════════════════════════════════════════════════════ */

  _buildStyles() {
    const css = `
/* ── Issue Tree: Layout ── */
.issue-tree-view {
  display: flex;
  flex-direction: column;
  height: 100%;
}

/* ── Issue Tree: Mode Toggle ── */
.issue-tree-mode-toggle {
  display: flex;
  gap: 2px;
  background: var(--bg-tertiary);
  border-radius: var(--radius-md);
  padding: 2px;
}
.issue-tree-mode-btn {
  font-size: var(--text-xs) !important;
  padding: var(--sp-1) var(--sp-2) !important;
  border-radius: var(--radius-sm) !important;
  white-space: nowrap;
  transition: all var(--duration-fast);
}
.issue-tree-mode-btn--active {
  background: var(--bg-secondary) !important;
  color: var(--text-primary) !important;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
}

/* ── Issue Tree: Graph container ── */
.issue-tree-graph-container {
  border: 1px solid var(--border-primary);
  border-radius: var(--radius-lg);
  overflow: hidden;
}

/* ── Issue Tree: Breadcrumbs ── */
.issue-tree-breadcrumbs {
  display: flex;
  align-items: center;
  gap: var(--sp-1);
  margin-bottom: var(--sp-4);
  flex-wrap: wrap;
}
.issue-tree-crumb {
  background: none;
  border: none;
  color: var(--text-secondary);
  font-size: var(--text-sm);
  font-family: var(--font-sans);
  cursor: pointer;
  padding: var(--sp-1) var(--sp-2);
  border-radius: var(--radius-sm);
  transition: color var(--duration-fast), background var(--duration-fast);
}
.issue-tree-crumb:hover {
  color: var(--text-primary);
  background: var(--bg-hover);
}
.issue-tree-crumb--active {
  color: var(--text-primary);
  font-weight: var(--font-semibold);
  cursor: default;
}
.issue-tree-crumb--active:hover {
  background: transparent;
}
.issue-tree-crumb-sep {
  color: var(--text-muted);
  font-size: var(--text-sm);
  user-select: none;
}

/* ── Issue Tree: Focus Summary ── */
.issue-tree-focus {
  background: var(--bg-secondary);
  border: 1px solid var(--border-primary);
  border-radius: var(--radius-lg);
  padding: var(--sp-4);
  margin-bottom: var(--sp-4);
}
.issue-tree-focus-header {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  margin-bottom: var(--sp-2);
}
.issue-tree-focus-type {
  font-size: var(--text-xl);
}
.issue-tree-focus-title {
  font-size: var(--text-lg);
  font-weight: var(--font-bold);
  color: var(--text-primary);
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.issue-tree-focus-status {
  font-size: var(--text-sm);
  font-weight: var(--font-semibold);
}
.issue-tree-focus-meta {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  font-size: var(--text-sm);
  color: var(--text-muted);
  margin-bottom: var(--sp-3);
}

/* ── Issue Tree: Card Grid ── */
.issue-tree-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: var(--sp-3);
}

/* ── Issue Tree: Card ── */
.issue-tree-card {
  background: var(--bg-secondary);
  border: 1px solid var(--border-primary);
  border-left: 4px solid var(--text-muted);
  border-radius: var(--radius-lg);
  padding: var(--sp-3) var(--sp-4);
  transition: border-color var(--duration-fast), box-shadow var(--duration-fast), transform var(--duration-fast);
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}
.issue-tree-card:hover {
  border-color: var(--border-accent);
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.25);
  transform: translateY(-1px);
}
.issue-tree-card[data-status="done"] {
  opacity: 0.7;
}

/* Card top row */
.issue-tree-card-top {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
}
.issue-tree-card-type {
  font-size: var(--text-lg);
  flex-shrink: 0;
}
.issue-tree-card-title {
  flex: 1;
  min-width: 0;
  font-weight: var(--font-semibold);
  color: var(--text-primary);
  font-size: var(--text-sm);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.issue-tree-card[data-status="done"] .issue-tree-card-title {
  text-decoration: line-through;
  color: var(--text-muted);
}
.issue-tree-card-chevron {
  background: var(--bg-tertiary);
  border: 1px solid var(--border-primary);
  color: var(--text-secondary);
  width: 28px;
  height: 28px;
  border-radius: var(--radius-md);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: var(--text-lg);
  font-weight: var(--font-bold);
  flex-shrink: 0;
  transition: color var(--duration-fast), background var(--duration-fast), border-color var(--duration-fast);
}
.issue-tree-card-chevron:hover {
  background: var(--accent-blue-bg);
  color: var(--accent-blue);
  border-color: var(--accent-blue-border);
}

/* Card progress bar */
.issue-tree-progress-wrap {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
}
.issue-tree-progress-track {
  flex: 1;
  background: var(--bg-tertiary);
  border-radius: var(--radius-full);
  overflow: hidden;
}
.issue-tree-progress-fill {
  height: 100%;
  border-radius: var(--radius-full);
  transition: width var(--duration-normal);
}
.issue-tree-progress-label {
  font-size: var(--text-xs);
  color: var(--text-muted);
  font-weight: var(--font-semibold);
  min-width: 32px;
  text-align: right;
  flex-shrink: 0;
}

/* Card bottom row (badges) */
.issue-tree-card-bottom {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  flex-wrap: wrap;
}
.issue-tree-card-badge {
  font-size: var(--text-xs);
  padding: 1px 8px;
  border-radius: var(--radius-full);
  background: var(--bg-tertiary);
  color: var(--text-muted);
  white-space: nowrap;
}
.issue-tree-card-badge--count {
  background: var(--bg-tertiary);
}
.issue-tree-card-badge--priority {
  border: 1px solid;
  background: transparent;
  font-weight: var(--font-semibold);
  text-transform: uppercase;
  font-size: 0.65rem;
  letter-spacing: 0.03em;
}
.issue-tree-card-badge--assignee {
  color: var(--accent-blue);
}

/* Card children preview */
.issue-tree-card-preview {
  border-top: 1px solid var(--border-secondary);
  padding-top: var(--sp-2);
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.issue-tree-card-preview-item {
  display: flex;
  align-items: center;
  gap: var(--sp-1);
  font-size: var(--text-xs);
  color: var(--text-secondary);
}
.issue-tree-card-preview-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}
.issue-tree-card-preview-icon {
  font-size: 0.7rem;
  flex-shrink: 0;
}
.issue-tree-card-preview-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.issue-tree-card-preview-progress {
  color: var(--text-muted);
  font-weight: var(--font-semibold);
  flex-shrink: 0;
}
.issue-tree-card-preview-more {
  font-size: var(--text-xs);
  color: var(--text-muted);
  font-style: italic;
  padding-left: var(--sp-2);
}

/* ── Issue Tree: Empty state ── */
.issue-tree-empty {
  padding: var(--sp-12);
  text-align: center;
  color: var(--text-muted);
}
.issue-tree-empty-icon {
  font-size: 3rem;
  margin-bottom: var(--sp-3);
  opacity: 0.5;
}

/* ── Issue Tree: Text mode wrapper ── */
.issue-tree-text-wrapper {
  position: relative;
}
`;

    const style = document.createElement('style');
    style.textContent = css;
    style.setAttribute('data-component', 'issue-tree-view');
    return style;
  }
}
