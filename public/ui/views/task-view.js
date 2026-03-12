/**
 * Overlord v2 — Task View
 *
 * Full task management interface with filterable task list,
 * task detail panel with todos, create/update workflows,
 * and real-time updates via store subscriptions.
 *
 * Data shape (from DB):
 *   id, building_id, title, description, status, parent_id,
 *   milestone_id, assignee_id, room_id, phase, priority,
 *   created_at, updated_at
 *
 * Store keys:
 *   tasks.list      — array of task objects
 *   building.active — current building id
 *   agents.list     — for assignee picker
 */

import { Component } from '../engine/component.js';
import { OverlordUI } from '../engine/engine.js';
import { h, formatTime, escapeHtml } from '../engine/helpers.js';
import { Card } from '../components/card.js';
import { Tabs } from '../components/tabs.js';
import { Button } from '../components/button.js';
import { Modal } from '../components/modal.js';


const STATUS_ORDER = ['pending', 'in-progress', 'done', 'blocked'];

const STATUS_LABELS = {
  'pending':     'Pending',
  'in-progress': 'In Progress',
  'done':        'Done',
  'blocked':     'Blocked'
};

const PRIORITY_ORDER = ['critical', 'high', 'normal', 'low'];

export class TaskView extends Component {

  constructor(el, opts = {}) {
    super(el, opts);
    this._tasks = [];
    this._agents = [];
    this._buildingId = null;
    this._activeFilter = 'all';
    this._searchQuery = '';
    this._selectedTask = null;
    this._tabs = null;
    this._todos = [];
  }

  mount() {
    this._mounted = true;
    const store = OverlordUI.getStore();
    if (!store) return;

    this.subscribe(store, 'tasks.list', (tasks) => {
      this._tasks = tasks || [];
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

    // Listen for real-time task events
    this._listeners.push(
      OverlordUI.subscribe('task:created', () => this._fetchTasks()),
      OverlordUI.subscribe('task:updated', () => this._fetchTasks())
    );

    // Listen for todo updates to re-render detail view
    this.subscribe(store, 'todos.list', (todos) => {
      this._todos = todos || [];
      this._renderDetailTodos();
    });

    this._buildingId = store.get('building.active');
    this._tasks = store.get('tasks.list') || [];
    this._agents = store.get('agents.list') || [];

    this.render();
    this._fetchTasks();
  }

  render() {
    this.el.textContent = '';
    this.el.className = 'task-view';

    // Header
    const header = h('div', { class: 'task-view-header' },
      h('div', { class: 'task-view-title-row' },
        h('h2', { class: 'task-view-title' }, 'Tasks'),
        h('div', { class: 'task-view-actions' },
          Button.create('New Task', {
            variant: 'primary',
            icon: '+',
            onClick: () => this._openCreateForm()
          })
        )
      )
    );
    this.el.appendChild(header);

    // Search bar
    const searchRow = h('div', { class: 'task-search-row' });
    const searchInput = h('input', {
      class: 'form-input task-search-input',
      type: 'text',
      placeholder: 'Search tasks...'
    });
    searchInput.addEventListener('input', (e) => {
      this._searchQuery = e.target.value.toLowerCase();
      this._updateTaskList();
    });
    searchRow.appendChild(searchInput);
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
      activeId: 'all',
      style: 'pills',
      onChange: (id) => {
        this._activeFilter = id;
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
    if (!this._buildingId || !window.overlordSocket) return;
    window.overlordSocket.fetchTasks(this._buildingId);
  }

  // ── Filtering ──────────────────────────────────────────────

  _getFilteredTasks() {
    let tasks = [...this._tasks];

    // Status filter
    if (this._activeFilter !== 'all') {
      tasks = tasks.filter(t => t.status === this._activeFilter);
    }

    // Search filter
    if (this._searchQuery) {
      tasks = tasks.filter(t =>
        (t.title || '').toLowerCase().includes(this._searchQuery) ||
        (t.description || '').toLowerCase().includes(this._searchQuery)
      );
    }

    // Sort: critical/high first, then by creation date
    tasks.sort((a, b) => {
      const pa = PRIORITY_ORDER.indexOf(a.priority || 'normal');
      const pb = PRIORITY_ORDER.indexOf(b.priority || 'normal');
      if (pa !== pb) return pa - pb;
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
    const tasks = this._getFilteredTasks();

    if (tasks.length === 0) {
      container.appendChild(h('div', { class: 'empty-state' },
        h('p', { class: 'empty-state-title' }, this._searchQuery ? 'No matching tasks' : 'No tasks yet'),
        h('p', { class: 'empty-state-description' },
          this._searchQuery
            ? 'Try adjusting your search or filters.'
            : 'Create a task to get started tracking work.')
      ));
      return;
    }

    const grid = h('div', { class: 'task-card-grid' });

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
  }

  // ── Task Detail Modal ──────────────────────────────────────

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

    Modal.open(`task-detail-${taskId}`, {
      title: task.title || 'Task Detail',
      content,
      size: 'lg',
      position: window.innerWidth < 768 ? 'fullscreen' : 'center',
      onClose: () => {
        this._selectedTask = null;
        this._todos = [];
      }
    });
  }

  _buildDetailContent(task) {
    const container = h('div', { class: 'task-detail-view' });

    // Status and priority row
    const metaRow = h('div', { class: 'task-detail-meta' },
      h('div', { class: 'task-detail-meta-item' },
        h('span', { class: 'task-detail-label' }, 'Status'),
        h('span', { class: `task-status-badge status-${task.status || 'pending'}` },
          STATUS_LABELS[task.status] || task.status || 'Pending')
      ),
      h('div', { class: 'task-detail-meta-item' },
        h('span', { class: 'task-detail-label' }, 'Priority'),
        h('span', { class: `task-priority priority-${task.priority || 'normal'}` },
          task.priority || 'normal')
      )
    );
    container.appendChild(metaRow);

    // Description
    if (task.description) {
      container.appendChild(h('div', { class: 'task-detail-section' },
        h('h4', null, 'Description'),
        h('p', { class: 'task-detail-description' }, task.description)
      ));
    }

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
        h('span', null, this._getAgentName(task.assignee_id))
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

    // Todos section
    const todoSection = h('div', { class: 'task-detail-section' },
      h('h4', null, 'Checklist'),
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

    return container;
  }

  _renderDetailTodos() {
    const todoContainer = document.getElementById('task-detail-todos');
    if (!todoContainer) return;

    todoContainer.textContent = '';

    if (!this._todos || this._todos.length === 0) {
      todoContainer.appendChild(h('div', { class: 'empty-state-inline' }, 'No checklist items'));
      return;
    }

    for (const todo of this._todos) {
      const isDone = todo.status === 'done' || todo.status === 'completed';
      const row = h('div', { class: `todo-row ${isDone ? 'todo-done' : ''}` },
        h('div', { class: `todo-checkbox ${isDone ? 'checked' : ''}`, 'data-todo-id': todo.id }),
        h('span', { class: 'todo-text' }, todo.description || 'Untitled todo')
      );
      // Wire toggle click
      const checkbox = row.querySelector('.todo-checkbox');
      if (checkbox) {
        checkbox.style.cursor = 'pointer';
        checkbox.addEventListener('click', () => {
          if (window.overlordSocket) {
            window.overlordSocket.toggleTodo(todo.id);
          }
        });
      }
      todoContainer.appendChild(row);
    }
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
        assigneeSelect.appendChild(h('option', { value: agent.id }, agent.name || agent.id));
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

  _submitCreateForm() {
    const title = document.getElementById('task-create-title')?.value?.trim();
    if (!title) return;

    const description = document.getElementById('task-create-desc')?.value?.trim() || '';
    const priority = document.getElementById('task-create-priority')?.value || 'normal';
    const assigneeId = document.getElementById('task-create-assignee')?.value || null;

    if (!window.overlordSocket || !this._buildingId) return;

    window.overlordSocket.createTask({
      buildingId: this._buildingId,
      title,
      description,
      priority,
      assigneeId
    });

    Modal.close('task-create');
  }

  // ── Task Status Updates ────────────────────────────────────

  _cycleTaskStatus(taskId) {
    const task = this._tasks.find(t => t.id === taskId);
    if (!task) return;

    const currentIdx = STATUS_ORDER.indexOf(task.status || 'pending');
    const nextIdx = (currentIdx + 1) % STATUS_ORDER.length;
    const nextStatus = STATUS_ORDER[nextIdx];

    this._updateTaskStatus(taskId, nextStatus);
  }

  _updateTaskStatus(taskId, status) {
    if (!window.overlordSocket) return;

    window.overlordSocket.updateTask({ id: taskId, status });

    // Close detail modal if open
    Modal.close(`task-detail-${taskId}`);
  }

  // ── Helpers ────────────────────────────────────────────────

  _getAgentName(agentId) {
    if (!agentId) return null;
    const agent = this._agents.find(a => a.id === agentId);
    return agent ? (agent.name || agentId) : agentId;
  }
}
