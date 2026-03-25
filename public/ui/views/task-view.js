/**
 * Overlord v2 — Task View
 *
 * Full task management interface with filterable task list,
 * task detail panel with todos, create/update workflows,
 * table/team assignment, and real-time updates via store subscriptions.
 *
 * Data shape (from DB):
 *   id, building_id, title, description, status, parent_id,
 *   milestone_id, assignee_id, room_id, table_id, phase, priority,
 *   created_at, updated_at
 *
 * Store keys:
 *   tasks.list               — array of task objects
 *   building.active          — current building id
 *   agents.list              — for assignee picker
 *   rooms.list               — for table assignment (rooms contain tables)
 *   building.agentPositions  — agent location map (for table agent display)
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
import { EntityLink, resolveAgentName } from '../engine/entity-nav.js';
import { InlineEdit } from '../components/inline-edit.js';


const STATUS_ORDER = ['pending', 'in-progress', 'done', 'blocked'];

/** Sort weight for statuses: active/blocked items appear before pending/done */
const STATUS_SORT_WEIGHT = { 'in-progress': 0, 'blocked': 1, 'pending': 2, 'done': 3 };

const STATUS_LABELS = {
  'pending':     'Pending',
  'in-progress': 'In Progress',
  'done':        'Done',
  'blocked':     'Blocked'
};

const PRIORITY_ORDER = ['critical', 'high', 'normal', 'low'];

/** localStorage key helpers for filter persistence (#348) */
const STORAGE_KEY_FILTERS = 'overlord:view:tasks:filters';
const STORAGE_KEY_PRESETS = 'overlord:view:tasks:presets';

export class TaskView extends Component {

  constructor(el, opts = {}) {
    super(el, opts);
    this._tasks = [];
    this._agents = [];
    this._rooms = [];
    this._agentPositions = {};
    this._buildingId = null;
    this._activeFilter = 'all';
    this._tableFilter = null;   // null = show all, string = filter by table_id
    this._searchQuery = '';
    this._viewMode = 'list';    // 'list' | 'kanban'
    this._dragTaskId = null;    // task id being dragged
    this._dragJustEnded = false; // suppress click after drag-drop
    this._selectedTask = null;
    this._tabs = null;
    this._todos = [];
    this._loading = true;

    // Bulk selection state (#345)
    this._selectedTaskIds = new Set();

    // Restore persisted filters (#348)
    this._restoreFilters();
  }

  /** Restore filter state from localStorage (#348). */
  _restoreFilters() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_FILTERS);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.activeFilter) this._activeFilter = parsed.activeFilter;
        if (parsed.tableFilter !== undefined) this._tableFilter = parsed.tableFilter;
        if (parsed.searchQuery) this._searchQuery = parsed.searchQuery;
        if (parsed.viewMode) this._viewMode = parsed.viewMode;
      }
    } catch { /* ignore corrupted data */ }
  }

  /** Save current filter state to localStorage (#348). */
  _persistFilters() {
    try {
      localStorage.setItem(STORAGE_KEY_FILTERS, JSON.stringify({
        activeFilter: this._activeFilter,
        tableFilter: this._tableFilter,
        searchQuery: this._searchQuery,
        viewMode: this._viewMode,
      }));
    } catch { /* quota exceeded or private mode */ }
  }

  mount() {
    this._mounted = true;
    const store = OverlordUI.getStore();
    if (!store) return;

    this.subscribe(store, 'tasks.list', (tasks) => {
      this._tasks = tasks || [];
      this._loading = false;
      this._updateTaskList();
      this._updateTabBadges();
    });

    this.subscribe(store, 'building.active', (id) => {
      this._buildingId = id;
      this._fetchTasks();
    });

    this.subscribe(store, 'agents.list', (agents) => {
      this._agents = agents || [];
    });

    this.subscribe(store, 'rooms.list', (rooms) => {
      this._rooms = rooms || [];
      this._updateTaskList();
    });

    this.subscribe(store, 'building.agentPositions', (positions) => {
      this._agentPositions = positions || {};
    });

    // Note: socket-bridge already updates store('tasks.list') on task:created/task:updated
    // broadcasts, so the store subscription above handles re-rendering. No need for
    // additional engine event listeners that would trigger redundant fetch + render cycles.

    // Quick Actions FAB dispatches this to open the create form from any view
    this._listeners.push(
      OverlordUI.subscribe('task:request-create', () => this._openCreateForm())
    );

    // Listen for todo updates to re-render detail view
    this.subscribe(store, 'todos.list', (todos) => {
      this._todos = todos || [];
      this._renderDetailTodos();
    });

    this._buildingId = store.get('building.active');
    this._tasks = store.get('tasks.list') || [];
    this._agents = store.get('agents.list') || [];
    this._rooms = store.get('rooms.list') || [];
    this._agentPositions = store.get('building.agentPositions') || {};

    this.render();
    this._fetchTasks();
  }

  render() {
    this.el.textContent = '';
    this.el.className = 'task-view';

    // No building selected (#691)
    if (!this._buildingId) {
      this.el.appendChild(h('div', { class: 'view-empty-state' },
        h('div', { class: 'view-empty-icon' }, '\u{1F4CB}'),
        h('h2', { class: 'view-empty-title' }, 'No Building Selected'),
        h('p', { class: 'view-empty-text' }, 'Select a project from the Dashboard to view tasks.')
      ));
      return;
    }

    // Header
    const header = h('div', { class: 'task-view-header' },
      h('div', { class: 'task-view-title-row' },
        h('h2', { class: 'task-view-title' }, 'Tasks'),
        h('div', { class: 'task-view-actions' },
          h('div', { class: 'task-view-mode-toggle' },
            h('button', {
              class: `btn btn-ghost btn-sm task-mode-btn ${this._viewMode === 'list' ? 'active' : ''}`,
              title: 'List view',
              onClick: () => this._setViewMode('list')
            }, '\u2630'),
            h('button', {
              class: `btn btn-ghost btn-sm task-mode-btn ${this._viewMode === 'kanban' ? 'active' : ''}`,
              title: 'Kanban board',
              onClick: () => this._setViewMode('kanban')
            }, '\u25A6')
          ),
          this._buildExportDropdown(),
          Button.create('New Task', {
            variant: 'primary',
            icon: '+',
            onClick: () => this._openCreateForm()
          })
        )
      )
    );
    this.el.appendChild(header);

    // Progress bar (#514)
    const progressContainer = h('div', { class: 'task-progress-bar-container', id: 'task-progress-bar' });
    this.el.appendChild(progressContainer);
    this._updateProgressBar();

    // Search bar with table filter, presets, and scope badge
    const searchRow = h('div', { class: 'task-search-row' });
    const searchInput = h('input', {
      class: 'form-input task-search-input',
      type: 'text',
      placeholder: 'Search tasks...',
      value: this._searchQuery || ''
    });
    searchInput.addEventListener('input', (e) => {
      this._searchQuery = e.target.value.toLowerCase();
      this._persistFilters();
      this._updateTaskList();
    });
    searchRow.appendChild(searchInput);

    // Saved filter presets (#352)
    searchRow.appendChild(this._buildPresetControls());

    // Table filter dropdown
    const tableFilterSelect = h('select', {
      class: 'form-input task-table-filter-select',
      id: 'task-table-filter'
    });
    tableFilterSelect.appendChild(h('option', { value: '' }, 'All Tables'));
    tableFilterSelect.appendChild(h('option', { value: '__unassigned__' }, 'Unassigned'));
    this._populateTableFilterOptions(tableFilterSelect);
    if (this._tableFilter) tableFilterSelect.value = this._tableFilter;
    tableFilterSelect.addEventListener('change', (e) => {
      const val = e.target.value;
      if (val === '') {
        this._tableFilter = null;
      } else if (val === '__unassigned__') {
        this._tableFilter = '__unassigned__';
      } else {
        this._tableFilter = val;
      }
      this._persistFilters();
      this._updateTaskList();
    });
    searchRow.appendChild(tableFilterSelect);

    // Scope change detection badge (#350)
    const scopeBadge = this._buildScopeChangeBadge();
    if (scopeBadge) searchRow.appendChild(scopeBadge);

    this.el.appendChild(searchRow);

    // Filter tabs
    const tabWrapper = h('div', { class: 'task-filter-tabs' });
    const tabContainer = h('div');
    tabWrapper.appendChild(tabContainer);
    this._tabs = new Tabs(tabContainer, {
      items: [
        { id: 'all',         label: 'All',         badge: this._tasks.length },
        { id: 'pending',     label: 'Pending',      badge: this._countByStatus('pending') },
        { id: 'in-progress', label: 'In Progress',  badge: this._countByStatus('in-progress') },
        { id: 'done',        label: 'Done',          badge: this._countByStatus('done') },
        { id: 'blocked',     label: 'Blocked',       badge: this._countByStatus('blocked') }
      ],
      activeId: this._activeFilter,
      style: 'pills',
      onChange: (id) => {
        this._activeFilter = id;
        this._persistFilters();
        this._updateTaskList();
      }
    });
    this._tabs.mount();
    this.el.appendChild(tabWrapper);

    // Task list container
    const listContainer = h('div', { class: 'task-list-container', id: 'task-list' });
    this.el.appendChild(listContainer);

    // Delegated click handler for task cards
    this.on('click', '.card-task', (e, target) => {
      const taskId = target.dataset.taskId;
      if (taskId) this._openTaskDetail(taskId);
    });

    // Delegated click for status checkbox
    this.on('click', '.task-checkbox', (e, target) => {
      e.stopPropagation();
      const taskId = target.dataset.taskId;
      if (taskId) this._cycleTaskStatus(taskId);
    });

    this._updateTaskList();
  }

  // ── Data fetching ──────────────────────────────────────────

  _fetchTasks() {
    if (!this._buildingId || !window.overlordSocket) {
      this._loading = false;
      return;
    }
    window.overlordSocket.fetchTasks(this._buildingId);
  }

  // ── Filtering ──────────────────────────────────────────────

  _getFilteredTasks() {
    let tasks = [...this._tasks];

    // Status filter
    if (this._activeFilter !== 'all') {
      tasks = tasks.filter(t => t.status === this._activeFilter);
    }

    // Table filter
    if (this._tableFilter === '__unassigned__') {
      tasks = tasks.filter(t => !t.table_id);
    } else if (this._tableFilter) {
      tasks = tasks.filter(t => t.table_id === this._tableFilter);
    }

    // Search filter
    if (this._searchQuery) {
      tasks = tasks.filter(t =>
        (t.title || '').toLowerCase().includes(this._searchQuery) ||
        (t.description || '').toLowerCase().includes(this._searchQuery)
      );
    }

    // Sort: priority first, then status (active/blocked before pending/done), then newest
    tasks.sort((a, b) => {
      const pa = PRIORITY_ORDER.indexOf(a.priority || 'normal');
      const pb = PRIORITY_ORDER.indexOf(b.priority || 'normal');
      if (pa !== pb) return pa - pb;
      const sa = STATUS_SORT_WEIGHT[a.status] ?? 2;
      const sb = STATUS_SORT_WEIGHT[b.status] ?? 2;
      if (sa !== sb) return sa - sb;
      return new Date(b.created_at || 0) - new Date(a.created_at || 0);
    });

    return tasks;
  }

  _countByStatus(status) {
    return this._tasks.filter(t => t.status === status).length;
  }

  // ── Rendering ──────────────────────────────────────────────

  _updateTaskList() {
    const container = this.$('#task-list');
    if (!container) return;

    container.textContent = '';

    // Show "select a building" message when no building is active
    // (applies to both list and kanban modes)
    if (!this._buildingId) {
      container.appendChild(h('div', { class: 'empty-state' },
        h('p', { class: 'empty-state-title' }, 'Select a project'),
        h('p', { class: 'empty-state-description' }, 'Choose a project from the Dashboard to view its tasks.')
      ));
      return;
    }

    if (this._viewMode === 'kanban') {
      this._renderKanbanBoard(container);
      return;
    }

    const tasks = this._getFilteredTasks();

    if (tasks.length === 0) {
      if (this._loading) {
        container.appendChild(h('div', { class: 'loading-state' },
          h('div', { class: 'loading-spinner' }),
          h('p', { class: 'loading-text' }, 'Loading tasks...')
        ));
      } else {
        container.appendChild(h('div', { class: 'empty-state' },
          h('p', { class: 'empty-state-title' }, this._searchQuery ? 'No matching tasks' : 'No tasks yet'),
          h('p', { class: 'empty-state-description' },
            this._searchQuery
              ? 'Try adjusting your search or filters.'
              : 'Tasks are created automatically as your agents work through project phases. You can also create tasks manually using the + button above, or ask an agent in Chat to plan the work.')
        ));
      }
      return;
    }

    const grid = h('div', { class: 'task-card-grid' });

    // Select All header row (#345)
    const selectAllRow = h('div', { class: 'task-select-all-row' });
    const selectAllCheckbox = h('input', {
      type: 'checkbox',
      class: 'task-bulk-checkbox task-select-all-checkbox',
      title: 'Select all tasks'
    });
    selectAllCheckbox.addEventListener('change', () => {
      const checked = selectAllCheckbox.checked;
      this._selectedTaskIds.clear();
      if (checked) {
        for (const t of tasks) this._selectedTaskIds.add(t.id);
      }
      // Update all visible row checkboxes
      container.querySelectorAll('.task-row-checkbox').forEach(cb => {
        cb.checked = checked;
      });
      this._updateBulkActionBar();
    });
    selectAllRow.appendChild(selectAllCheckbox);
    selectAllRow.appendChild(h('span', { class: 'task-select-all-label' },
      `Select All (${tasks.length})`));
    grid.appendChild(selectAllRow);

    for (const task of tasks) {
      const card = Card.create('task', {
        id: task.id,
        title: task.title,
        description: task.description,
        priority: task.priority || 'normal',
        status: task.status,
        completed: task.status === 'done',
        assignee: this._getAgentName(task.assignee_id),
        created: task.created_at ? formatTime(task.created_at) : null
      });

      // Prepend a selection checkbox to the card (#345)
      const rowCheckbox = h('input', {
        type: 'checkbox',
        class: 'task-bulk-checkbox task-row-checkbox',
        'data-task-id': task.id,
        title: 'Select this task'
      });
      if (this._selectedTaskIds.has(task.id)) rowCheckbox.checked = true;
      rowCheckbox.addEventListener('click', (e) => e.stopPropagation());
      rowCheckbox.addEventListener('change', () => {
        if (rowCheckbox.checked) {
          this._selectedTaskIds.add(task.id);
        } else {
          this._selectedTaskIds.delete(task.id);
        }
        // Update select-all checkbox state
        const allCbs = container.querySelectorAll('.task-row-checkbox');
        const allChecked = [...allCbs].every(cb => cb.checked);
        if (selectAllCheckbox) selectAllCheckbox.checked = allChecked;
        this._updateBulkActionBar();
      });
      card.insertBefore(rowCheckbox, card.firstChild);

      // Add table assignment row to the card
      const tableInfo = this._buildCardTableRow(task);
      if (tableInfo) {
        card.appendChild(tableInfo);
      }

      card.dataset.taskId = task.id;
      card.style.cursor = 'pointer';
      grid.appendChild(card);
    }

    container.appendChild(grid);
  }

  _updateTabBadges() {
    if (!this._tabs) return;
    this._tabs.setBadge('all', this._tasks.length || null);
    this._tabs.setBadge('pending', this._countByStatus('pending') || null);
    this._tabs.setBadge('in-progress', this._countByStatus('in-progress') || null);
    this._tabs.setBadge('done', this._countByStatus('done') || null);
    this._tabs.setBadge('blocked', this._countByStatus('blocked') || null);
    this._updateProgressBar();
  }

  /** Render a progress bar showing task completion (#514). */
  _updateProgressBar() {
    const container = this.$('#task-progress-bar');
    if (!container) return;
    container.textContent = '';

    const total = this._tasks.length;
    const done = this._countByStatus('done');
    const wip = this._countByStatus('in-progress');

    if (total === 0) return;

    const pct = Math.round((done / total) * 100);
    const wipText = wip > 0 ? `, ${wip} in progress` : '';

    const bar = h('div', { class: 'task-progress-bar' },
      h('div', { class: 'task-progress-bar-label' },
        `${pct}% complete (${done}/${total} done${wipText})`
      ),
      h('div', { class: 'task-progress-bar-track' },
        h('div', {
          class: 'task-progress-bar-fill',
          style: { width: `${pct}%` }
        })
      )
    );

    container.appendChild(bar);
  }

  // ── Task Detail Drawer ─────────────────────────────────────

  _openTaskDetail(taskId) {
    const task = this._tasks.find(t => t.id === taskId);
    if (!task) return;

    this._selectedTask = task;

    // Fetch todos for this task
    if (window.overlordSocket) {
      window.overlordSocket.fetchTodos(taskId).then((res) => {
        if (res && res.ok) {
          this._todos = res.data || [];
          this._renderDetailTodos();
        }
      }).catch(() => {});
    }

    const content = this._buildDetailContent(task);

    // Make drawer title editable (#1037)
    const titleEl = h('span', null, task.title || 'Task Detail');
    InlineEdit.text(titleEl, {
      value: task.title || '',
      placeholder: 'Task title...',
      onSave: (v) => {
        if (window.overlordSocket) {
          window.overlordSocket.updateTask({ id: task.id, title: v }).then((res) => {
            if (res?.ok) { Toast.success('Title saved'); Drawer.updateTitle(v); }
          });
        }
      },
    });

    Drawer.open(`task-detail-${taskId}`, {
      title: titleEl,
      content,
      width: '460px',
      onClose: () => {
        this._selectedTask = null;
        this._todos = [];
      }
    });
  }

  _buildDetailContent(task) {
    const container = h('div', { class: 'task-detail-view' });

    // Status progression bar
    container.appendChild(this._buildStatusProgression(task.status));

    // Helper to save task field updates (#1037)
    const saveField = (field, value) => {
      if (window.overlordSocket) {
        window.overlordSocket.updateTask({ id: task.id, [field]: value }).then((res) => {
          if (res?.ok) Toast.success('Saved');
          else Toast.error(res?.error?.message || 'Failed to save');
        });
      }
    };

    // Status and priority row — EDITABLE (#1037)
    const statusEl = h('span', { class: `task-status-badge status-${task.status || 'pending'}` },
      STATUS_LABELS[task.status] || task.status || 'Pending');
    InlineEdit.select(statusEl, {
      value: task.status || 'pending',
      options: ['pending', 'in-progress', 'done', 'blocked'],
      onSave: (v) => saveField('status', v),
    });

    const priorityEl = h('span', { class: `task-priority priority-${task.priority || 'normal'}` },
      task.priority || 'normal');
    InlineEdit.select(priorityEl, {
      value: task.priority || 'normal',
      options: ['low', 'normal', 'high', 'critical'],
      onSave: (v) => saveField('priority', v),
    });

    const metaRow = h('div', { class: 'task-detail-meta' },
      h('div', { class: 'task-detail-meta-item' },
        h('span', { class: 'task-detail-label' }, 'Status'),
        statusEl
      ),
      h('div', { class: 'task-detail-meta-item' },
        h('span', { class: 'task-detail-label' }, 'Priority'),
        priorityEl
      )
    );
    container.appendChild(metaRow);

    // Assignee display
    container.appendChild(this._buildAssigneeSection(task));

    // Milestone / phase info
    container.appendChild(this._buildMilestoneSection(task));

    // Description — EDITABLE (#1037)
    const descSection = h('div', { class: 'task-detail-section' });
    descSection.appendChild(h('h4', null, 'Description'));
    const descEl = h('p', { class: 'task-detail-description' }, task.description || 'No description — click to add');
    InlineEdit.text(descEl, {
      value: task.description || '',
      type: 'textarea',
      placeholder: 'Add a description...',
      onSave: (v) => saveField('description', v),
    });
    descSection.appendChild(descEl);
    container.appendChild(descSection);

    // Metadata
    const infoSection = h('div', { class: 'task-detail-section task-detail-info' });
    if (task.phase) {
      infoSection.appendChild(h('div', { class: 'task-detail-info-row' },
        h('span', { class: 'task-detail-label' }, 'Phase'),
        h('span', null, task.phase)
      ));
    }
    if (task.assignee_id) {
      infoSection.appendChild(h('div', { class: 'task-detail-info-row' },
        h('span', { class: 'task-detail-label' }, 'Assignee'),
        EntityLink.agent(task.assignee_id, this._getAgentName(task.assignee_id))
      ));
    }
    if (task.created_at) {
      infoSection.appendChild(h('div', { class: 'task-detail-info-row' },
        h('span', { class: 'task-detail-label' }, 'Created'),
        h('span', null, new Date(task.created_at).toLocaleString())
      ));
    }
    if (task.updated_at) {
      infoSection.appendChild(h('div', { class: 'task-detail-info-row' },
        h('span', { class: 'task-detail-label' }, 'Updated'),
        h('span', null, new Date(task.updated_at).toLocaleString())
      ));
    }
    if (infoSection.children.length > 0) {
      container.appendChild(infoSection);
    }

    // Table/Team Assignment section
    container.appendChild(this._buildDetailTableSection(task));

    // Todos section
    const todoHeader = h('div', { class: 'todo-section-header' },
      h('h4', null, 'Checklist'),
      Button.create('Add Item', {
        variant: 'ghost',
        size: 'sm',
        icon: '+',
        onClick: () => this._toggleAddTodoForm(task.id)
      })
    );
    const todoAddForm = h('div', { class: 'todo-add-form todo-add-form-hidden', id: 'todo-add-form' });
    this._buildAddTodoForm(todoAddForm, task.id);

    const todoSection = h('div', { class: 'task-detail-section' },
      todoHeader,
      todoAddForm,
      h('div', { class: 'task-todo-list', id: 'task-detail-todos' },
        h('div', { class: 'empty-state-inline' }, 'Loading...')
      )
    );
    container.appendChild(todoSection);

    // Action buttons
    const actions = h('div', { class: 'task-detail-actions' });

    for (const status of STATUS_ORDER) {
      if (status === task.status) continue;
      actions.appendChild(Button.create(STATUS_LABELS[status], {
        variant: status === 'done' ? 'primary' : status === 'blocked' ? 'danger' : 'secondary',
        size: 'sm',
        onClick: () => this._updateTaskStatus(task.id, status)
      }));
    }

    container.appendChild(actions);

    // Delete button (audit finding: no way to delete from detail view)
    const deleteRow = h('div', { style: 'margin-top: var(--sp-4); padding-top: var(--sp-3); border-top: 1px solid var(--border-subtle);' });
    const deleteBtn = Button.create('Delete Task', {
      variant: 'danger',
      size: 'sm',
      onClick: async () => {
        if (!window.overlordSocket) return;
        const confirmed = confirm(`Delete "${task.title}"?\n\nThis cannot be undone.`);
        if (!confirmed) return;
        try {
          const res = await window.overlordSocket.deleteTask(task.id);
          if (res?.ok) {
            Drawer.close();
            Toast.success('Task deleted');
          } else {
            Toast.error(res?.error?.message || 'Failed to delete task');
          }
        } catch {
          Toast.error('Failed to delete task');
        }
      }
    });
    deleteRow.appendChild(deleteBtn);
    container.appendChild(deleteRow);

    return container;
  }

  /** Build a horizontal status progression bar. */
  _buildStatusProgression(currentStatus) {
    const steps = [
      { key: 'pending', label: 'Not Started' },
      { key: 'in-progress', label: 'In Progress' },
      { key: 'blocked', label: 'Blocked' },
      { key: 'done', label: 'Done' },
    ];
    const currentIdx = steps.findIndex(s => s.key === currentStatus);
    const bar = h('div', { class: 'task-status-progression' });
    for (let i = 0; i < steps.length; i++) {
      const cls = i === currentIdx ? 'active' : i < currentIdx ? 'completed' : '';
      bar.appendChild(h('div', { class: `task-status-step ${cls}` }, steps[i].label));
    }
    return bar;
  }

  /** Build the assignee display section. */
  _buildAssigneeSection(task) {
    const section = h('div', { class: 'task-detail-assignee' });
    if (task.assignee_id) {
      const agentName = this._getAgentName(task.assignee_id);
      const agent = this._agents.find(a => a.id === task.assignee_id);
      section.appendChild(h('span', { class: 'task-detail-label' }, 'Assignee: '));
      section.appendChild(EntityLink.agent(task.assignee_id, agentName));
      if (agent && agent.role) {
        section.appendChild(h('span', { class: 'task-detail-label', style: 'margin-left: var(--sp-2)' },
          '(' + agent.role + ')'));
      }
    } else {
      section.appendChild(h('span', { class: 'task-detail-label' }, 'Assignee: '));
      section.appendChild(h('span', { style: 'color: var(--text-muted)' }, 'Unassigned'));
    }
    return section;
  }

  /** Build the milestone / phase info section. */
  _buildMilestoneSection(task) {
    const section = h('div', { class: 'task-detail-milestone' });
    const parts = [];
    if (task.milestone_id || task.milestone) {
      parts.push(h('span', null,
        h('span', { class: 'task-detail-label' }, 'Milestone: '),
        h('span', null, task.milestone || task.milestone_id)
      ));
    }
    if (task.phase) {
      parts.push(h('span', null,
        h('span', { class: 'task-detail-label' }, 'Phase: '),
        h('span', null, task.phase)
      ));
    }
    if (parts.length === 0) {
      section.appendChild(h('span', { class: 'task-detail-label' }, 'Milestone: '));
      section.appendChild(h('span', { style: 'color: var(--text-muted)' }, 'None'));
    } else {
      for (const part of parts) section.appendChild(part);
    }
    return section;
  }

  _renderDetailTodos() {
    const todoContainer = document.getElementById('task-detail-todos');
    if (!todoContainer) return;

    todoContainer.textContent = '';

    if (!this._todos || this._todos.length === 0) {
      todoContainer.appendChild(h('div', { class: 'empty-state-inline' }, 'No checklist items yet'));
      return;
    }

    // Summary bar: X of Y complete
    const doneCount = this._todos.filter(t => t.status === 'done' || t.status === 'completed').length;
    const totalCount = this._todos.length;
    const pct = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;

    const summaryBar = h('div', { class: 'todo-summary-bar' },
      h('span', { class: 'todo-summary-text' }, `${doneCount} of ${totalCount} complete`),
      h('div', { class: 'todo-progress-track' },
        h('div', { class: 'todo-progress-fill', style: { width: `${pct}%` } })
      )
    );
    todoContainer.appendChild(summaryBar);

    for (const todo of this._todos) {
      const isDone = todo.status === 'done' || todo.status === 'completed';
      const agentName = this._getAgentName(todo.agent_id);

      // Build row contents
      const rowChildren = [];

      // Checkbox
      const checkbox = h('div', {
        class: `todo-checkbox ${isDone ? 'checked' : ''}`,
        'data-todo-id': todo.id
      });
      checkbox.addEventListener('click', async () => {
        try {
          if (window.overlordSocket) {
            await window.overlordSocket.toggleTodo(todo.id);
          }
        } catch (err) {
          Toast.error('Failed to toggle todo');
        }
      });
      rowChildren.push(checkbox);

      // Description text
      rowChildren.push(
        h('span', { class: 'todo-text' }, todo.description || 'Untitled todo')
      );

      // Agent assignment badge/dropdown
      const agentControl = h('div', { class: 'todo-agent-control' });
      const agentSelect = h('select', { class: 'todo-agent-select' });
      agentSelect.appendChild(h('option', { value: '' }, 'Unassigned'));
      for (const agent of this._agents) {
        const opt = h('option', { value: agent.id }, agent.display_name || agent.name || 'Agent');
        if (agent.id === todo.agent_id) opt.selected = true;
        agentSelect.appendChild(opt);
      }
      agentSelect.addEventListener('change', async (e) => {
        const newAgentId = e.target.value;
        try {
          if (!window.overlordSocket) return;
          if (newAgentId) {
            await window.overlordSocket.assignTodoToAgent(todo.id, newAgentId);
            Toast.success('Agent assigned');
          } else {
            await window.overlordSocket.unassignTodoFromAgent(todo.id);
            Toast.success('Agent unassigned');
          }
        } catch (err) {
          Toast.error('Failed to update agent assignment');
        }
      });

      // Show badge if assigned, click to reveal dropdown
      if (agentName) {
        const badge = h('span', { class: 'todo-agent-badge' }, agentName);
        badge.addEventListener('click', (e) => {
          e.stopPropagation();
          badge.style.display = 'none';
          agentSelect.style.display = '';
          agentSelect.focus();
        });
        agentSelect.style.display = 'none';
        agentSelect.addEventListener('blur', () => {
          agentSelect.style.display = 'none';
          badge.style.display = '';
          // Update badge text in case agent changed
          const newId = agentSelect.value;
          badge.textContent = this._getAgentName(newId) || 'Unassigned';
          if (!newId) {
            badge.textContent = '';
            badge.style.display = 'none';
            agentSelect.style.display = '';
          }
        });
        agentControl.appendChild(badge);
        agentControl.appendChild(agentSelect);
      } else {
        agentControl.appendChild(agentSelect);
      }
      rowChildren.push(agentControl);

      // Delete button
      const deleteBtn = h('button', {
        class: 'todo-delete-btn',
        title: 'Delete todo'
      }, '\u00D7');
      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const confirmContent = h('div', null,
          h('p', null, `Delete this checklist item?`),
          h('p', { class: 'text-muted', style: { marginTop: 'var(--sp-2)' } },
            (todo.title || todo.text || '').slice(0, 80) || 'This item will be permanently removed.')
        );
        const confirmBtn = Button.create('Delete', {
          variant: 'danger',
          onClick: async () => {
            Modal.close('confirm-delete-todo');
            try {
              if (window.overlordSocket) {
                await window.overlordSocket.deleteTodo(todo.id);
                Toast.success('Todo deleted');
              }
            } catch (err) {
              Toast.error('Failed to delete todo');
            }
          }
        });
        const cancelBtn = Button.create('Cancel', { variant: 'ghost', onClick: () => Modal.close('confirm-delete-todo') });
        confirmContent.appendChild(h('div', { style: { marginTop: 'var(--sp-3)', display: 'flex', gap: 'var(--sp-2)', justifyContent: 'flex-end' } }, cancelBtn, confirmBtn));
        Modal.open('confirm-delete-todo', { title: 'Delete Item', content: confirmContent, size: 'sm', position: 'center' });
      });
      rowChildren.push(deleteBtn);

      const row = h('div', { class: `todo-row ${isDone ? 'todo-done' : ''}` }, ...rowChildren);
      todoContainer.appendChild(row);
    }
  }

  // ── Add Todo Form ─────────────────────────────────────────

  _toggleAddTodoForm(taskId) {
    const form = document.getElementById('todo-add-form');
    if (!form) return;
    form.classList.toggle('todo-add-form-hidden');
    if (!form.classList.contains('todo-add-form-hidden')) {
      const input = form.querySelector('.todo-add-input');
      if (input) input.focus();
    }
  }

  _buildAddTodoForm(container, taskId) {
    container.textContent = '';

    const inputRow = h('div', { class: 'todo-add-input-row' });

    const descInput = h('input', {
      class: 'form-input todo-add-input',
      type: 'text',
      placeholder: 'New checklist item...'
    });
    inputRow.appendChild(descInput);

    // Agent dropdown for new todo
    const agentSelect = h('select', { class: 'form-input todo-add-agent-select' });
    agentSelect.appendChild(h('option', { value: '' }, 'No agent'));
    for (const agent of this._agents) {
      agentSelect.appendChild(h('option', { value: agent.id }, agent.display_name || agent.name || 'Agent'));
    }
    inputRow.appendChild(agentSelect);

    const submitBtn = Button.create('Add', {
      variant: 'primary',
      size: 'sm',
      onClick: async () => {
        const description = descInput.value.trim();
        if (!description) {
          descInput.classList.add('input-error');
          return;
        }
        descInput.classList.remove('input-error');

        const agentId = agentSelect.value || undefined;

        try {
          if (!window.overlordSocket) return;
          const res = await window.overlordSocket.createTodo({
            taskId,
            description,
            agentId,
            status: 'pending'
          });
          if (res && res.ok) {
            Toast.success('Todo added');
            descInput.value = '';
            agentSelect.value = '';
            // Re-fetch todos for this task
            this._refreshTodos(taskId);
          } else {
            Toast.error(res?.error?.message || 'Failed to create todo');
          }
        } catch (err) {
          Toast.error('Failed to create todo');
        }
      }
    });
    inputRow.appendChild(submitBtn);

    container.appendChild(inputRow);

    // Allow Enter key to submit
    descInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        submitBtn.click();
      }
    });
  }

  async _refreshTodos(taskId) {
    if (!window.overlordSocket) return;
    try {
      const res = await window.overlordSocket.fetchTodos(taskId);
      if (res && res.ok) {
        this._todos = res.data || [];
        this._renderDetailTodos();
      }
    } catch { /* swallow */ }
  }

  // ── Create Task Form ───────────────────────────────────────

  _openCreateForm() {
    const form = h('div', { class: 'task-create-form' });

    // Title
    form.appendChild(h('div', { class: 'form-group' },
      h('label', { class: 'form-label' }, 'Title'),
      h('input', {
        class: 'form-input',
        type: 'text',
        id: 'task-create-title',
        placeholder: 'Task title...'
      })
    ));

    // Description
    form.appendChild(h('div', { class: 'form-group' },
      h('label', { class: 'form-label' }, 'Description'),
      h('textarea', {
        class: 'form-input form-textarea',
        id: 'task-create-desc',
        placeholder: 'Describe the task...'
      })
    ));

    // Priority
    const prioritySelect = h('select', {
      class: 'form-input',
      id: 'task-create-priority'
    });
    for (const p of PRIORITY_ORDER) {
      const opt = h('option', { value: p }, p.charAt(0).toUpperCase() + p.slice(1));
      if (p === 'normal') opt.selected = true;
      prioritySelect.appendChild(opt);
    }
    form.appendChild(h('div', { class: 'form-group' },
      h('label', { class: 'form-label' }, 'Priority'),
      prioritySelect
    ));

    // Assignee
    if (this._agents.length > 0) {
      const assigneeSelect = h('select', {
        class: 'form-input',
        id: 'task-create-assignee'
      });
      assigneeSelect.appendChild(h('option', { value: '' }, 'Unassigned'));
      for (const agent of this._agents) {
        assigneeSelect.appendChild(h('option', { value: agent.id }, agent.display_name || agent.name || 'Agent'));
      }
      form.appendChild(h('div', { class: 'form-group' },
        h('label', { class: 'form-label' }, 'Assignee'),
        assigneeSelect
      ));
    }

    // Actions
    form.appendChild(h('div', { class: 'task-create-actions' },
      Button.create('Cancel', {
        variant: 'ghost',
        onClick: () => Modal.close('task-create')
      }),
      Button.create('Create Task', {
        variant: 'primary',
        onClick: () => this._submitCreateForm()
      })
    ));

    Modal.open('task-create', {
      title: 'New Task',
      content: form,
      size: 'md',
      position: 'center'
    });
  }

  async _submitCreateForm() {
    // Clear previous validation errors
    const existingErrors = document.querySelectorAll('.task-create-form .form-error');
    existingErrors.forEach(el => el.remove());

    const titleInput = document.getElementById('task-create-title');
    const title = titleInput?.value?.trim();

    // Validate required fields
    if (!title) {
      if (titleInput) {
        titleInput.classList.add('input-error');
        titleInput.parentElement?.appendChild(
          h('div', { class: 'form-error' }, 'Title is required')
        );
      }
      return;
    }
    if (titleInput) titleInput.classList.remove('input-error');

    const description = document.getElementById('task-create-desc')?.value?.trim() || '';
    const priority = document.getElementById('task-create-priority')?.value || 'normal';
    const assigneeId = document.getElementById('task-create-assignee')?.value || undefined;

    if (!window.overlordSocket || !this._buildingId) return;

    try {
      const result = await window.overlordSocket.createTask({
        buildingId: this._buildingId,
        title,
        description,
        priority,
        assigneeId
      });

      if (result && result.ok) {
        Toast.success('Task created');
        Modal.close('task-create');
      } else {
        Toast.error(result?.error?.message || 'Failed to create task');
      }
    } catch {
      Toast.error('Failed to create task — check your connection');
    }
  }

  // ── Task Status Updates ────────────────────────────────────

  _cycleTaskStatus(taskId) {
    const task = this._tasks.find(t => t.id === taskId);
    if (!task) return;

    // Cycle: pending -> in-progress -> done (stop). Blocked is not part of the cycle.
    const CYCLE = ['pending', 'in-progress', 'done'];
    const currentIdx = CYCLE.indexOf(task.status || 'pending');
    if (currentIdx === -1) return; // blocked or unknown — don't cycle
    const nextIdx = Math.min(currentIdx + 1, CYCLE.length - 1);
    if (nextIdx === currentIdx) return; // already done
    const nextStatus = CYCLE[nextIdx];

    this._updateTaskStatus(taskId, nextStatus);
  }

  async _updateTaskStatus(taskId, status) {
    if (!window.overlordSocket) return;

    try {
      const res = await window.overlordSocket.updateTask({ id: taskId, status });
      if (!res || !res.ok) {
        Toast.error(res?.error?.message || 'Failed to update task status');
        return;
      }
    } catch {
      Toast.error('Failed to update task status');
      return;
    }

    // Close detail drawer if open
    Drawer.close();
  }

  // ── Table Assignment ──────────────────────────────────────

  /**
   * Gather all active tables from all rooms in the current building.
   * Returns flat array of { tableId, tableType, roomId, roomName, roomType, description, agents }.
   */
  _getAllTables() {
    const tables = [];
    for (const room of this._rooms) {
      const activeTables = room.activeTables || [];
      for (const table of activeTables) {
        // Find agents currently seated at this table
        const seatedAgents = Object.values(this._agentPositions)
          .filter(a => a.tableId === table.id || a.current_table_id === table.id);
        tables.push({
          tableId: table.id,
          tableType: table.type || 'focus',
          roomId: room.id,
          roomName: room.name || this._formatRoomType(room.type),
          roomType: room.type,
          description: table.description || '',
          chairs: table.chairs || 1,
          agents: seatedAgents
        });
      }
    }
    return tables;
  }

  /**
   * Find table info for a given table_id.
   */
  _getTableInfo(tableId) {
    if (!tableId) return null;
    return this._getAllTables().find(t => t.tableId === tableId) || null;
  }

  /**
   * Format a room type slug as a title (e.g., "code-lab" -> "Code Lab").
   */
  _formatRoomType(type) {
    if (!type) return 'Room';
    return type.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  }

  /**
   * Build a compact table assignment row shown on each task card.
   * Shows the table type + room name, or "Unassigned" with an assign button.
   */
  _buildCardTableRow(task) {
    const row = h('div', { class: 'task-card-table-row' });

    if (task.table_id) {
      const info = this._getTableInfo(task.table_id);
      // Use server-enriched table_type/room_name if available, then fall back to local lookup
      const label = info
        ? `${info.tableType} in ${info.roomName}`
        : (task.table_type && task.room_name)
          ? `${task.table_type} in ${task.room_name}`
          : `Table: ${task.table_id.slice(0, 8)}`;

      row.appendChild(h('span', { class: 'task-card-table-badge task-card-table-badge-assigned' }, label));

      // Unassign button (small x icon)
      const unassignBtn = h('button', {
        class: 'task-card-table-unassign',
        title: 'Unassign from table'
      }, '\u2715');
      unassignBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._unassignTaskFromTable(task.id);
      });
      row.appendChild(unassignBtn);
    } else {
      // Assign button
      const assignBtn = h('button', {
        class: 'task-card-table-assign-btn',
        title: 'Assign to table'
      }, 'Assign Table');
      assignBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._openTableAssignModal(task);
      });
      row.appendChild(assignBtn);
    }

    return row;
  }

  /**
   * Build the Table/Team section for the task detail drawer.
   * Shows current assignment with agents or an assign dropdown.
   */
  _buildDetailTableSection(task) {
    const section = h('div', { class: 'task-detail-section task-detail-team-section' });
    section.appendChild(h('h4', null, 'Table / Team'));

    const content = h('div', { class: 'task-detail-team-content', id: 'task-detail-team' });

    if (task.table_id) {
      const info = this._getTableInfo(task.table_id);

      // Table info card
      const tableCard = h('div', { class: 'task-detail-team-card' });

      const tableType = info ? info.tableType : (task.table_type || 'Table');
      const roomName = info ? info.roomName : (task.room_name || '');
      const tableHeader = h('div', { class: 'task-detail-team-header' },
        h('span', { class: 'task-detail-team-type' }, tableType),
        h('span', { class: 'task-detail-team-room text-muted' },
          roomName ? `in ${roomName}` : '')
      );
      tableCard.appendChild(tableHeader);

      if (info && info.description) {
        tableCard.appendChild(h('div', { class: 'task-detail-team-desc text-muted' }, info.description));
      }

      // Show seated agents at this table
      if (info && info.agents.length > 0) {
        const agentList = h('div', { class: 'task-detail-team-agents' });
        agentList.appendChild(h('span', { class: 'task-detail-team-agents-label' }, 'Team Members:'));
        for (const agent of info.agents) {
          const name = agent.name || this._getAgentName(agent.agentId) || 'Agent';
          agentList.appendChild(EntityLink.agent(agent.agentId, name));
        }
        tableCard.appendChild(agentList);
      }

      content.appendChild(tableCard);

      // Unassign button
      const unassignBtn = Button.create('Unassign from Table', {
        variant: 'ghost',
        size: 'sm',
        onClick: () => this._unassignTaskFromTable(task.id)
      });
      content.appendChild(h('div', { class: 'task-detail-team-actions' }, unassignBtn));

    } else {
      // No table assigned — show assignment dropdown
      content.appendChild(h('div', { class: 'task-detail-team-empty text-muted' },
        'Not assigned to any table.'));

      const allTables = this._getAllTables();
      if (allTables.length > 0) {
        const selectRow = h('div', { class: 'task-detail-team-assign-row' });

        const tableSelect = h('select', { class: 'form-input task-detail-team-select' });
        tableSelect.appendChild(h('option', { value: '' }, 'Select a table...'));

        for (const t of allTables) {
          const agentCount = t.agents.length;
          const label = `${t.tableType} in ${t.roomName}${agentCount > 0 ? ` (${agentCount} agent${agentCount !== 1 ? 's' : ''})` : ''}`;
          tableSelect.appendChild(h('option', { value: t.tableId }, label));
        }
        selectRow.appendChild(tableSelect);

        const assignBtn = Button.create('Assign', {
          variant: 'primary',
          size: 'sm',
          onClick: async () => {
            const selectedTableId = tableSelect.value;
            if (!selectedTableId) {
              Toast.warning('Please select a table');
              return;
            }
            await this._assignTaskToTable(task.id, selectedTableId);
          }
        });
        selectRow.appendChild(assignBtn);
        content.appendChild(selectRow);
      } else {
        content.appendChild(h('div', { class: 'task-detail-team-empty text-muted' },
          'No tables available. Create tables in rooms first.'));
      }
    }

    section.appendChild(content);
    return section;
  }

  /**
   * Open a modal to pick a table for task assignment.
   * Used when clicking "Assign Table" on a task card.
   */
  _openTableAssignModal(task) {
    const allTables = this._getAllTables();

    if (allTables.length === 0) {
      Toast.warning('No tables available. Create tables in rooms first.');
      return;
    }

    const container = h('div', { class: 'task-assign-table-modal' });

    container.appendChild(h('p', { class: 'text-muted' },
      `Assign "${task.title}" to a table/team.`));

    // Table list
    const tableList = h('div', { class: 'task-assign-table-list' });

    for (const t of allTables) {
      const agentNames = t.agents.map(a => a.name || this._getAgentName(a.agentId) || 'Agent');

      const tableItem = h('div', { class: 'task-assign-table-item' });

      const itemInfo = h('div', { class: 'task-assign-table-item-info' },
        h('div', { class: 'task-assign-table-item-name' }, `${t.tableType} in ${t.roomName}`),
        t.description ? h('div', { class: 'task-assign-table-item-desc text-muted' }, t.description) : null,
        agentNames.length > 0
          ? h('div', { class: 'task-assign-table-item-agents text-muted' }, `Agents: ${agentNames.join(', ')}`)
          : h('div', { class: 'task-assign-table-item-agents text-muted' }, 'No agents seated')
      );
      tableItem.appendChild(itemInfo);

      const selectBtn = Button.create('Assign', {
        variant: 'secondary',
        size: 'sm',
        onClick: async () => {
          await this._assignTaskToTable(task.id, t.tableId);
          Modal.close('task-assign-table');
        }
      });
      tableItem.appendChild(selectBtn);

      tableList.appendChild(tableItem);
    }

    container.appendChild(tableList);

    // Cancel button
    container.appendChild(h('div', { class: 'task-assign-table-actions' },
      Button.create('Cancel', {
        variant: 'ghost',
        onClick: () => Modal.close('task-assign-table')
      })
    ));

    Modal.open('task-assign-table', {
      title: 'Assign Task to Table',
      content: container,
      size: 'md',
      position: 'center'
    });
  }

  /**
   * Assign a task to a table via the socket bridge.
   */
  async _assignTaskToTable(taskId, tableId) {
    if (!window.overlordSocket) return;
    try {
      const res = await window.overlordSocket.assignTaskToTable(taskId, tableId);
      if (res && res.ok) {
        Toast.success('Task assigned to table');
        // Re-open detail if this task is selected
        if (this._selectedTask && this._selectedTask.id === taskId) {
          this._selectedTask = { ...this._selectedTask, table_id: tableId };
          Drawer.close();
          this._openTaskDetail(taskId);
        }
      } else {
        Toast.error(res?.error?.message || 'Failed to assign task');
      }
    } catch (err) {
      Toast.error('Failed to assign task to table');
    }
  }

  /**
   * Unassign a task from its table via the socket bridge.
   */
  async _unassignTaskFromTable(taskId) {
    if (!window.overlordSocket) return;
    try {
      const res = await window.overlordSocket.unassignTaskFromTable(taskId);
      if (res && res.ok) {
        Toast.success('Task unassigned from table');
        // Re-open detail if this task is selected
        if (this._selectedTask && this._selectedTask.id === taskId) {
          this._selectedTask = { ...this._selectedTask, table_id: null };
          Drawer.close();
          this._openTaskDetail(taskId);
        }
      } else {
        Toast.error(res?.error?.message || 'Failed to unassign task');
      }
    } catch (err) {
      Toast.error('Failed to unassign task from table');
    }
  }

  /**
   * Populate the table filter <select> with available tables from rooms.
   */
  _populateTableFilterOptions(selectEl) {
    const allTables = this._getAllTables();
    for (const t of allTables) {
      const label = `${t.tableType} in ${t.roomName}`;
      selectEl.appendChild(h('option', { value: t.tableId }, label));
    }
  }

  // ── View Mode ─────────────────────────────────────────────

  _setViewMode(mode) {
    if (this._viewMode === mode) return;
    this._viewMode = mode;
    this._persistFilters();

    // Update toggle button active states
    this.el.querySelectorAll('.task-mode-btn').forEach(btn => {
      btn.classList.toggle('active', btn.title.toLowerCase().includes(mode));
    });

    this._updateTaskList();
  }

  // ── Kanban Board ────────────────────────────────────────────

  _renderKanbanBoard(container) {
    const board = h('div', { class: 'kanban-board' });

    // Apply search/table filters but NOT status filter (kanban shows all statuses as columns)
    let tasks = [...this._tasks];
    if (this._tableFilter === '__unassigned__') {
      tasks = tasks.filter(t => !t.table_id);
    } else if (this._tableFilter) {
      tasks = tasks.filter(t => t.table_id === this._tableFilter);
    }
    if (this._searchQuery) {
      tasks = tasks.filter(t =>
        (t.title || '').toLowerCase().includes(this._searchQuery) ||
        (t.description || '').toLowerCase().includes(this._searchQuery)
      );
    }

    // Group by status
    const grouped = {};
    for (const status of STATUS_ORDER) {
      grouped[status] = [];
    }
    for (const task of tasks) {
      const status = task.status || 'pending';
      if (!grouped[status]) grouped[status] = [];
      grouped[status].push(task);
    }

    // Sort each column by priority
    for (const status of STATUS_ORDER) {
      grouped[status].sort((a, b) => {
        const pa = PRIORITY_ORDER.indexOf(a.priority || 'normal');
        const pb = PRIORITY_ORDER.indexOf(b.priority || 'normal');
        if (pa !== pb) return pa - pb;
        return new Date(b.created_at || 0) - new Date(a.created_at || 0);
      });
    }

    // Render columns
    for (const status of STATUS_ORDER) {
      const colTasks = grouped[status] || [];
      const column = this._renderKanbanColumn(status, colTasks);
      board.appendChild(column);
    }

    container.appendChild(board);

    // If actively loading with a building selected, show overlay
    if (this._loading && this._buildingId && tasks.length === 0) {
      const overlay = h('div', { class: 'kanban-loading-overlay' },
        h('div', { class: 'loading-spinner' }),
        h('p', { class: 'loading-text' }, 'Loading tasks...')
      );
      container.appendChild(overlay);
    }
  }

  _renderKanbanColumn(status, tasks) {
    const column = h('div', {
      class: `kanban-column kanban-col-${status}`,
      'data-status': status
    });

    // Column header
    const header = h('div', { class: 'kanban-column-header' },
      h('div', { class: 'kanban-column-title-row' },
        h('span', { class: `kanban-column-dot status-dot-${status}` }),
        h('span', { class: 'kanban-column-title' }, STATUS_LABELS[status] || status),
        h('span', { class: 'kanban-column-count' }, String(tasks.length))
      )
    );
    column.appendChild(header);

    // Drop zone
    const dropZone = h('div', { class: 'kanban-drop-zone' });

    // Drag-and-drop handlers on the drop zone
    dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      dropZone.classList.add('kanban-drop-active');
    });
    dropZone.addEventListener('dragleave', () => {
      dropZone.classList.remove('kanban-drop-active');
    });
    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.classList.remove('kanban-drop-active');
      const taskId = e.dataTransfer.getData('text/plain');
      if (taskId && window.overlordSocket) {
        window.overlordSocket.updateTask({ id: taskId, status });
      }
    });

    // Render task cards
    for (const task of tasks) {
      const card = this._renderKanbanCard(task);
      dropZone.appendChild(card);
    }

    // Empty state for column
    if (tasks.length === 0) {
      dropZone.appendChild(h('div', { class: 'kanban-empty' }, 'Drop tasks here'));
    }

    column.appendChild(dropZone);
    return column;
  }

  _renderKanbanCard(task) {
    const card = h('div', {
      class: `kanban-card priority-${task.priority || 'normal'}`,
      draggable: 'true',
      'data-task-id': task.id
    });

    // Drag handlers
    card.addEventListener('dragstart', (e) => {
      this._dragTaskId = task.id;
      e.dataTransfer.setData('text/plain', task.id);
      e.dataTransfer.effectAllowed = 'move';
      card.classList.add('kanban-card-dragging');
    });
    card.addEventListener('dragend', () => {
      this._dragTaskId = null;
      card.classList.remove('kanban-card-dragging');
      // Remove all drop-active highlights
      this.el.querySelectorAll('.kanban-drop-active').forEach(el => el.classList.remove('kanban-drop-active'));
      // Suppress the spurious click that fires after dragend
      this._dragJustEnded = true;
      requestAnimationFrame(() => { this._dragJustEnded = false; });
    });

    // Click to open detail — guarded to prevent spurious click after drag-drop
    card.addEventListener('click', () => {
      if (this._dragJustEnded) return;
      this._openTaskDetail(task.id);
    });

    // Priority indicator bar
    card.appendChild(h('div', { class: `kanban-card-priority-bar priority-bar-${task.priority || 'normal'}` }));

    // Title
    card.appendChild(h('div', { class: 'kanban-card-title' }, task.title || 'Untitled'));

    // Description snippet
    if (task.description) {
      const snippet = task.description.length > 80
        ? task.description.slice(0, 80) + '...'
        : task.description;
      card.appendChild(h('div', { class: 'kanban-card-desc' }, snippet));
    }

    // Footer: assignee + metadata
    const footer = h('div', { class: 'kanban-card-footer' });

    if (task.assignee_id) {
      const agentName = this._getAgentName(task.assignee_id);
      footer.appendChild(h('span', { class: 'kanban-card-assignee' },
        h('span', { class: 'kanban-card-avatar' }, (agentName || '?')[0].toUpperCase()),
        EntityLink.agent(task.assignee_id, agentName || resolveAgentName(task.assignee_id))
      ));
    }

    if (task.phase) {
      footer.appendChild(h('span', { class: 'kanban-card-phase' }, task.phase));
    }

    if (footer.children.length > 0) {
      card.appendChild(footer);
    }

    return card;
  }

  // ── Bulk Actions (#345) ──────────────────────────────────

  /** Show or hide the floating bulk action bar based on selection. */
  _updateBulkActionBar() {
    // Remove existing bar
    const existing = document.querySelector('.task-bulk-action-bar');
    if (existing) existing.remove();

    if (this._selectedTaskIds.size === 0) return;

    const bar = h('div', { class: 'task-bulk-action-bar' },
      h('span', { class: 'task-bulk-count' },
        `${this._selectedTaskIds.size} task${this._selectedTaskIds.size > 1 ? 's' : ''} selected`),
      h('div', { class: 'task-bulk-actions' },
        h('button', { class: 'btn btn-primary btn-sm', onClick: () => this._bulkMarkDone() }, 'Mark Done'),
        h('button', { class: 'btn btn-danger btn-sm', onClick: () => this._bulkDelete() }, 'Delete'),
        h('button', { class: 'btn btn-secondary btn-sm', onClick: () => this._bulkAssign() }, 'Assign'),
        h('button', { class: 'btn btn-ghost btn-sm', onClick: () => this._clearBulkSelection() }, 'Cancel')
      )
    );

    document.body.appendChild(bar);
    // Trigger reflow for animation
    requestAnimationFrame(() => bar.classList.add('visible'));
  }

  _clearBulkSelection() {
    this._selectedTaskIds.clear();
    this.el.querySelectorAll('.task-row-checkbox').forEach(cb => { cb.checked = false; });
    const selectAll = this.el.querySelector('.task-select-all-checkbox');
    if (selectAll) selectAll.checked = false;
    this._updateBulkActionBar();
  }

  _bulkMarkDone() {
    if (!window.overlordSocket) return;
    for (const id of this._selectedTaskIds) {
      window.overlordSocket.updateTask({ id, status: 'done' });
    }
    Toast.success(`Marked ${this._selectedTaskIds.size} tasks as done`);
    this._clearBulkSelection();
  }

  _bulkDelete() {
    const count = this._selectedTaskIds.size;
    if (!confirm(`Delete ${count} selected task${count > 1 ? 's' : ''}? This cannot be undone.`)) return;
    if (!window.overlordSocket) return;
    for (const id of this._selectedTaskIds) {
      window.overlordSocket.deleteTask(id);
    }
    Toast.success(`Deleted ${count} tasks`);
    this._clearBulkSelection();
  }

  _bulkAssign() {
    if (this._agents.length === 0) {
      Toast.info('No agents available to assign');
      return;
    }
    const select = h('select', { class: 'form-input' });
    select.appendChild(h('option', { value: '' }, 'Select an agent...'));
    for (const agent of this._agents) {
      select.appendChild(h('option', { value: agent.id }, agent.display_name || agent.name || 'Agent'));
    }
    const content = h('div', null,
      h('p', null, `Assign ${this._selectedTaskIds.size} tasks to:`),
      select
    );
    const assignBtn = Button.create('Assign', {
      variant: 'primary',
      onClick: () => {
        const agentId = select.value;
        if (!agentId) { Toast.info('Please select an agent'); return; }
        if (!window.overlordSocket) return;
        for (const id of this._selectedTaskIds) {
          window.overlordSocket.updateTask({ id, assignee_id: agentId });
        }
        Toast.success(`Assigned ${this._selectedTaskIds.size} tasks`);
        Modal.close('bulk-assign');
        this._clearBulkSelection();
      }
    });
    content.appendChild(h('div', { style: 'margin-top: var(--sp-3); display: flex; gap: var(--sp-2); justify-content: flex-end;' },
      Button.create('Cancel', { variant: 'ghost', onClick: () => Modal.close('bulk-assign') }),
      assignBtn
    ));
    Modal.open('bulk-assign', { title: 'Bulk Assign', content, size: 'sm', position: 'center' });
  }

  // ── Export (#347) ──────────────────────────────────────────

  /** Build the Export dropdown button. */
  _buildExportDropdown() {
    const wrapper = h('div', { class: 'task-export-dropdown' });
    const btn = h('button', { class: 'btn btn-ghost btn-sm' }, 'Export \u25BE');
    const menu = h('div', { class: 'task-export-menu' },
      h('div', { class: 'task-export-option', 'data-format': 'csv' }, 'Export CSV'),
      h('div', { class: 'task-export-option', 'data-format': 'json' }, 'Export JSON')
    );
    menu.style.display = 'none';

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = menu.style.display !== 'none';
      menu.style.display = isOpen ? 'none' : 'block';
    });

    menu.querySelectorAll('.task-export-option').forEach(opt => {
      opt.addEventListener('click', () => {
        const format = opt.dataset.format;
        this._exportTasks(format);
        menu.style.display = 'none';
      });
    });

    // Close dropdown when clicking outside
    document.addEventListener('click', () => { menu.style.display = 'none'; });

    wrapper.appendChild(btn);
    wrapper.appendChild(menu);
    return wrapper;
  }

  /** Export the current filtered task list as CSV or JSON. */
  _exportTasks(format) {
    const tasks = this._getFilteredTasks();
    if (tasks.length === 0) {
      Toast.info('No tasks to export');
      return;
    }

    let content, mimeType, extension;

    if (format === 'csv') {
      const headers = ['Title', 'Status', 'Priority', 'Assignee', 'Phase', 'Created', 'Updated'];
      const rows = tasks.map(t => [
        `"${(t.title || '').replace(/"/g, '""')}"`,
        t.status || '',
        t.priority || 'normal',
        `"${(this._getAgentName(t.assignee_id) || 'Unassigned').replace(/"/g, '""')}"`,
        t.phase || '',
        t.created_at || '',
        t.updated_at || ''
      ]);
      content = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
      mimeType = 'text/csv';
      extension = 'csv';
    } else {
      const exportData = tasks.map(t => ({
        id: t.id,
        title: t.title,
        description: t.description,
        status: t.status,
        priority: t.priority,
        assignee: this._getAgentName(t.assignee_id) || null,
        phase: t.phase,
        created_at: t.created_at,
        updated_at: t.updated_at
      }));
      content = JSON.stringify(exportData, null, 2);
      mimeType = 'application/json';
      extension = 'json';
    }

    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `overlord-tasks-${new Date().toISOString().slice(0, 10)}.${extension}`;
    a.click();
    URL.revokeObjectURL(url);
    Toast.success(`Exported ${tasks.length} tasks as ${format.toUpperCase()}`);
  }

  // ── Scope Change Detection (#350) ──────────────────────────

  /** Build a scope change warning badge if tasks were added post-architecture. */
  _buildScopeChangeBadge() {
    // Find the earliest architecture-phase task timestamp as a baseline
    const archTasks = this._tasks.filter(t => t.phase === 'architecture' || t.phase === 'planning');
    if (archTasks.length === 0) return null;

    // Find the latest architecture task creation time
    const archEnd = Math.max(...archTasks.map(t => new Date(t.created_at || 0).getTime()));
    if (!archEnd || archEnd <= 0) return null;

    // Count tasks created after architecture phase ended
    const scopeTasks = this._tasks.filter(t => {
      const created = new Date(t.created_at || 0).getTime();
      return created > archEnd && t.phase !== 'architecture' && t.phase !== 'planning';
    });

    if (scopeTasks.length === 0) return null;

    const badge = h('span', {
      class: 'task-scope-badge has-tooltip',
      dataset: { tooltip: 'These tasks were added after the architecture/planning phase, which may indicate scope creep.' }
    }, `${scopeTasks.length} task${scopeTasks.length > 1 ? 's' : ''} added since architecture`);

    return badge;
  }

  // ── Saved Filter Presets (#352) ────────────────────────────

  /** Build the preset save/load controls. */
  _buildPresetControls() {
    const wrapper = h('div', { class: 'task-preset-controls' });

    // Save current filter button
    const saveBtn = h('button', {
      class: 'btn btn-ghost btn-sm task-preset-save-btn',
      title: 'Save current filters as a preset'
    }, 'Save Filter');
    saveBtn.addEventListener('click', () => this._savePresetPrompt());
    wrapper.appendChild(saveBtn);

    // Load presets dropdown
    const presets = this._loadPresets();
    if (presets.length > 0) {
      const select = h('select', { class: 'form-input task-preset-select' });
      select.appendChild(h('option', { value: '' }, 'Load Preset...'));
      for (const preset of presets) {
        select.appendChild(h('option', { value: preset.name }, preset.name));
      }
      select.addEventListener('change', () => {
        if (!select.value) return;
        this._applyPreset(select.value);
        select.value = '';
      });
      wrapper.appendChild(select);
    }

    return wrapper;
  }

  /** Prompt user for a preset name and save it. */
  _savePresetPrompt() {
    const name = prompt('Preset name:');
    if (!name || !name.trim()) return;

    const presets = this._loadPresets();
    // Replace if same name exists
    const existing = presets.findIndex(p => p.name === name.trim());
    const preset = {
      name: name.trim(),
      activeFilter: this._activeFilter,
      tableFilter: this._tableFilter,
      searchQuery: this._searchQuery,
      viewMode: this._viewMode,
    };
    if (existing >= 0) {
      presets[existing] = preset;
    } else {
      presets.push(preset);
    }

    try {
      localStorage.setItem(STORAGE_KEY_PRESETS, JSON.stringify(presets));
    } catch { /* quota exceeded */ }

    Toast.success(`Filter preset "${name.trim()}" saved`);
    this.render(); // re-render to show new preset in dropdown
  }

  /** Load all saved presets from localStorage. */
  _loadPresets() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_PRESETS);
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  }

  /** Apply a named preset by restoring its filter state. */
  _applyPreset(name) {
    const presets = this._loadPresets();
    const preset = presets.find(p => p.name === name);
    if (!preset) return;

    this._activeFilter = preset.activeFilter || 'all';
    this._tableFilter = preset.tableFilter || null;
    this._searchQuery = preset.searchQuery || '';
    this._viewMode = preset.viewMode || 'list';
    this._persistFilters();
    Toast.info(`Applied preset: ${name}`);
    this.render();
  }

  // ── Helpers ────────────────────────────────────────────────

  _getAgentName(agentId) {
    if (!agentId) return null;
    // Use resolveAgentName to never show raw IDs (#673)
    const agent = this._agents.find(a => a.id === agentId);
    return agent ? (agent.display_name || agent.name || resolveAgentName(agentId)) : resolveAgentName(agentId);
  }
}
