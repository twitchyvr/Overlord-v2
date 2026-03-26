/**
 * Overlord v2 — Milestone View
 *
 * Full milestone management interface with progress tracking,
 * task assignment, timeline view, and real-time updates.
 *
 * Data shape (from DB):
 *   id, building_id, title, description, status, due_date,
 *   phase, ordinal, task_count, tasks_done, created_at, updated_at
 *
 * Store keys:
 *   milestones.list          — array of milestone objects
 *   tasks.list               — for task assignment
 *   building.active          — current building id
 */

import { Component } from '../engine/component.js';
import { OverlordUI } from '../engine/engine.js';
import { h, formatTime } from '../engine/helpers.js';
import { Modal } from '../components/modal.js';
import { Drawer } from '../components/drawer.js';
import { Toast } from '../components/toast.js';

const STATUS_CONFIG = {
  active:    { label: 'Active',    color: 'var(--accent-blue, #3b82f6)',   icon: '\u25CF' },
  completed: { label: 'Completed', color: 'var(--accent-green, #22c55e)',  icon: '\u2713' },
  cancelled: { label: 'Cancelled', color: 'var(--text-muted, #6b7280)',    icon: '\u2715' },
};

const PHASE_OPTIONS = [
  'strategy', 'collaboration', 'execution', 'governance', 'operations'
];


export class MilestoneView extends Component {

  constructor(el, opts = {}) {
    super(el, opts);
    this._milestones = [];
    this._tasks = [];
    this._buildingId = null;
    this._activeFilter = 'all';
    this._loading = true;
    this._openDrawerMilestoneId = null; // track which milestone drawer is open
  }

  mount() {
    this._mounted = true;
    const store = OverlordUI.getStore();
    if (!store) return;

    this.subscribe(store, 'milestones.list', (milestones) => {
      this._milestones = milestones || [];
      this._loading = false;
      this.render();
    });

    this.subscribe(store, 'building.active', (id) => {
      this._buildingId = id;
      this._fetchMilestones();
    });

    this._listeners.push(
      OverlordUI.subscribe('building:selected', (data) => {
        if (data && data.buildingId && !this._buildingId) {
          this._buildingId = data.buildingId;
          this._fetchMilestones();
        }
      })
    );

    this.subscribe(store, 'tasks.list', (tasks) => {
      this._tasks = tasks || [];
      this.render();
    });

    this._listeners.push(
      OverlordUI.subscribe('milestone:created', () => this._fetchMilestones()),
      OverlordUI.subscribe('milestone:updated', () => {
        this._fetchMilestones();
        // Refresh the open drawer if it shows a milestone that was just updated
        this._refreshOpenDrawer();
      }),
      OverlordUI.subscribe('milestone:deleted', () => {
        this._fetchMilestones();
        // Close drawer if the deleted milestone was being viewed
        if (this._openDrawerMilestoneId) {
          const stillExists = this._milestones.some(m => m.id === this._openDrawerMilestoneId);
          if (!stillExists) {
            Drawer.close();
            this._openDrawerMilestoneId = null;
          }
        }
      }),
      // Quick Actions FAB dispatches this to open the create modal from any view
      OverlordUI.subscribe('milestone:request-create', () => this._openCreateModal())
    );

    // Initial data
    this._buildingId = store.get('building.active');
    this._tasks = store.get('tasks.list') || [];
    this._milestones = store.get('milestones.list') || [];
    this._fetchMilestones();

    this.render();
  }

  render() {
    if (!this._mounted) return;
    this.el.textContent = '';

    // No building selected (#691)
    if (!this._buildingId) {
      this.el.appendChild(h('div', { class: 'view-empty-state' },
        h('div', { class: 'view-empty-icon' }, '\u{1F3AF}'),
        h('h2', { class: 'view-empty-title' }, 'No Building Selected'),
        h('p', { class: 'view-empty-text' }, 'Select a project from the Dashboard to view milestones.')
      ));
      return;
    }

    // ── Header ──
    const header = h('div', { class: 'milestone-view-header' });

    const titleRow = h('div', { class: 'milestone-view-title-row' });
    titleRow.appendChild(h('h2', { class: 'milestone-view-title' }, 'Milestones'));

    const count = this._milestones.length;
    const activeCount = this._milestones.filter(m => m.status === 'active').length;
    titleRow.appendChild(h('span', { class: 'milestone-view-count' }, `${activeCount} active / ${count} total`));
    header.appendChild(titleRow);

    // Actions row
    const actionsRow = h('div', { class: 'milestone-view-actions' });

    const createBtn = h('button', { class: 'btn btn-primary btn-sm' }, '+ Create Milestone');
    createBtn.addEventListener('click', () => this._openCreateModal());
    actionsRow.appendChild(createBtn);

    // Filter tabs
    const filterBar = h('div', { class: 'milestone-filter-bar' });
    const filters = [
      { key: 'all', label: 'All' },
      { key: 'active', label: 'Active' },
      { key: 'completed', label: 'Completed' },
      { key: 'cancelled', label: 'Cancelled' },
    ];
    for (const f of filters) {
      const filterCount = f.key === 'all' ? count : this._milestones.filter(m => m.status === f.key).length;
      const btn = h('button', {
        class: `milestone-filter-btn${this._activeFilter === f.key ? ' active' : ''}`
      }, `${f.label} ${filterCount}`);
      btn.addEventListener('click', () => {
        this._activeFilter = f.key;
        this.render();
      });
      filterBar.appendChild(btn);
    }
    actionsRow.appendChild(filterBar);
    header.appendChild(actionsRow);
    this.el.appendChild(header);

    // ── Content ──
    const content = h('div', { class: 'milestone-view-content' });

    if (!this._buildingId) {
      content.appendChild(h('div', { class: 'milestone-empty-state' },
        h('span', { class: 'milestone-empty-icon' }, '\u{1F3AF}'),
        h('p', null, 'Select a building to view milestones.')
      ));
      this.el.appendChild(content);
      return;
    }

    if (this._loading) {
      content.appendChild(h('div', { class: 'milestone-loading' },
        h('div', { class: 'loading-spinner' }),
        h('p', null, 'Loading milestones...')
      ));
      this.el.appendChild(content);
      return;
    }

    // Filter milestones
    const filtered = this._activeFilter === 'all'
      ? this._milestones
      : this._milestones.filter(m => m.status === this._activeFilter);

    if (filtered.length === 0) {
      content.appendChild(h('div', { class: 'milestone-empty-state' },
        h('span', { class: 'milestone-empty-icon' }, '\u{1F3AF}'),
        h('p', null, this._activeFilter === 'all'
          ? 'Milestones mark key deliverables in your project timeline. Agents create them as they plan work, or you can add them manually below.'
          : `No ${this._activeFilter} milestones.`),
        this._activeFilter === 'all' ? (() => {
          const btn = h('button', { class: 'btn btn-primary btn-md' }, '+ Create First Milestone');
          btn.addEventListener('click', () => this._openCreateModal());
          return btn;
        })() : h('span')
      ));
      this.el.appendChild(content);
      return;
    }

    // Milestone timeline
    const timeline = h('div', { class: 'milestone-timeline' });

    // Sort by ordinal, then created_at
    const sorted = [...filtered].sort((a, b) => {
      if (a.ordinal !== b.ordinal) return a.ordinal - b.ordinal;
      return (a.created_at || '').localeCompare(b.created_at || '');
    });

    for (const milestone of sorted) {
      timeline.appendChild(this._renderMilestoneCard(milestone));
    }

    content.appendChild(timeline);
    this.el.appendChild(content);
  }

  _renderMilestoneCard(milestone) {
    const statusCfg = STATUS_CONFIG[milestone.status] || STATUS_CONFIG.active;
    const taskCount = milestone.task_count || 0;
    const tasksDone = milestone.tasks_done || 0;
    const progress = taskCount > 0 ? Math.round((tasksDone / taskCount) * 100) : 0;

    // Get tasks for this milestone from local store
    const milestoneTasks = this._tasks.filter(t => t.milestone_id === milestone.id);

    const card = h('div', { class: `milestone-card milestone-card-${milestone.status}` });

    // ── Card Header ──
    const cardHeader = h('div', { class: 'milestone-card-header' });

    // Status icon
    const statusIcon = h('span', {
      class: `milestone-status-icon milestone-status-${milestone.status}`,
      title: statusCfg.label,
      style: { color: statusCfg.color }
    }, statusCfg.icon);
    cardHeader.appendChild(statusIcon);

    // Title and meta
    const titleGroup = h('div', { class: 'milestone-card-title-group' });
    titleGroup.appendChild(h('h3', { class: 'milestone-card-title' }, milestone.title));

    const metaRow = h('div', { class: 'milestone-card-meta' });
    if (milestone.phase) {
      metaRow.appendChild(h('span', { class: 'milestone-phase-badge' }, milestone.phase));
    }
    // Due dates removed (#1195) — AI agents cannot reliably estimate time
    metaRow.appendChild(h('span', { class: 'milestone-task-count' }, `${tasksDone}/${taskCount} tasks`));
    titleGroup.appendChild(metaRow);
    cardHeader.appendChild(titleGroup);

    // Actions
    const cardActions = h('div', { class: 'milestone-card-actions' });

    const editBtn = h('button', { class: 'btn btn-ghost btn-xs', title: 'Edit', 'aria-label': 'Edit milestone' }, '\u270E');
    editBtn.addEventListener('click', (e) => { e.stopPropagation(); this._openEditModal(milestone); });
    cardActions.appendChild(editBtn);

    if (milestone.status === 'active') {
      const completeBtn = h('button', { class: 'btn btn-ghost btn-xs', title: 'Mark Complete', 'aria-label': 'Mark milestone complete', style: { color: 'var(--accent-green)' } }, '\u2713');
      completeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._updateMilestoneStatus(milestone.id, 'completed');
      });
      cardActions.appendChild(completeBtn);
    } else if (milestone.status === 'completed') {
      const reopenBtn = h('button', { class: 'btn btn-ghost btn-xs', title: 'Reopen', 'aria-label': 'Reopen milestone', style: { color: 'var(--accent-blue)' } }, '\u21BA');
      reopenBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._updateMilestoneStatus(milestone.id, 'active');
      });
      cardActions.appendChild(reopenBtn);
    }

    const deleteBtn = h('button', { class: 'btn btn-ghost btn-xs', title: 'Delete', 'aria-label': 'Delete milestone', style: { color: 'var(--accent-red)' } }, '\u2715');
    deleteBtn.addEventListener('click', (e) => { e.stopPropagation(); this._confirmDelete(milestone); });
    cardActions.appendChild(deleteBtn);

    cardHeader.appendChild(cardActions);
    card.appendChild(cardHeader);

    // ── Description ──
    if (milestone.description) {
      card.appendChild(h('p', { class: 'milestone-card-desc' }, milestone.description));
    }

    // ── Progress Bar ──
    const progressSection = h('div', { class: 'milestone-progress-section' });
    const progressBar = h('div', { class: 'milestone-progress-bar' });
    const progressFill = h('div', {
      class: `milestone-progress-fill milestone-progress-${milestone.status}`,
      style: { width: `${progress}%` }
    });
    progressBar.appendChild(progressFill);
    progressSection.appendChild(progressBar);
    progressSection.appendChild(h('span', { class: 'milestone-progress-label' }, `${progress}%`));
    card.appendChild(progressSection);

    // ── Task chips (compact view of linked tasks) ──
    if (milestoneTasks.length > 0) {
      const taskChips = h('div', { class: 'milestone-task-chips' });
      const displayTasks = milestoneTasks.slice(0, 6);
      for (const task of displayTasks) {
        const chip = h('span', {
          class: `milestone-task-chip milestone-task-chip-${task.status}`,
          title: `${task.title} (${task.status})`
        }, task.title.length > 25 ? task.title.slice(0, 25) + '\u2026' : task.title);
        taskChips.appendChild(chip);
      }
      if (milestoneTasks.length > 6) {
        taskChips.appendChild(h('span', { class: 'milestone-task-chip milestone-task-chip-more' },
          `+${milestoneTasks.length - 6} more`));
      }
      card.appendChild(taskChips);
    }

    // Click to open detail
    card.addEventListener('click', () => this._openMilestoneDetail(milestone));
    card.style.cursor = 'pointer';

    return card;
  }

  // ── Detail Drawer ──

  _refreshOpenDrawer() {
    if (!this._openDrawerMilestoneId) return;
    const updated = this._milestones.find(m => m.id === this._openDrawerMilestoneId);
    if (updated && Drawer.getActiveId() === 'milestone-detail') {
      this._openMilestoneDetail(updated);
    }
  }

  _openMilestoneDetail(milestone) {
    this._openDrawerMilestoneId = milestone.id;
    const statusCfg = STATUS_CONFIG[milestone.status] || STATUS_CONFIG.active;
    const milestoneTasks = this._tasks.filter(t => t.milestone_id === milestone.id);
    const tasksDone = milestoneTasks.filter(t => t.status === 'done').length;
    const progress = milestoneTasks.length > 0 ? Math.round((tasksDone / milestoneTasks.length) * 100) : 0;

    const content = h('div', { class: 'milestone-detail' });

    // Status badge
    const statusBadge = h('div', { class: `milestone-detail-status milestone-detail-status-${milestone.status}` },
      h('span', { style: { color: statusCfg.color } }, statusCfg.icon),
      ' ',
      statusCfg.label
    );
    content.appendChild(statusBadge);

    // Progress
    const progressSection = h('div', { class: 'milestone-detail-section' });
    progressSection.appendChild(h('h4', null, 'Progress'));
    const progressBar = h('div', { class: 'milestone-progress-bar milestone-progress-bar-lg' });
    progressBar.appendChild(h('div', {
      class: `milestone-progress-fill milestone-progress-${milestone.status}`,
      style: { width: `${progress}%` }
    }));
    progressSection.appendChild(progressBar);
    progressSection.appendChild(h('p', { class: 'milestone-detail-progress-text' },
      `${tasksDone} of ${milestoneTasks.length} tasks completed (${progress}%)`));
    content.appendChild(progressSection);

    // Description
    if (milestone.description) {
      const descSection = h('div', { class: 'milestone-detail-section' });
      descSection.appendChild(h('h4', null, 'Description'));
      descSection.appendChild(h('p', { class: 'milestone-detail-desc' }, milestone.description));
      content.appendChild(descSection);
    }

    // Details
    const detailsSection = h('div', { class: 'milestone-detail-section' });
    detailsSection.appendChild(h('h4', null, 'Details'));
    const detailRows = [];
    if (milestone.phase) detailRows.push(['Phase', milestone.phase]);
    // Due date removed (#1195)
    detailRows.push(['Order', `#${milestone.ordinal || 0}`]);
    detailRows.push(['Created', formatTime(milestone.created_at)]);
    detailRows.push(['Updated', formatTime(milestone.updated_at)]);
    for (const [label, value] of detailRows) {
      detailsSection.appendChild(h('div', { class: 'milestone-detail-row' },
        h('span', { class: 'milestone-detail-label' }, label),
        h('span', null, value)
      ));
    }
    content.appendChild(detailsSection);

    // Tasks section
    const tasksSection = h('div', { class: 'milestone-detail-section' });
    const taskHeader = h('div', { class: 'milestone-detail-task-header' });
    taskHeader.appendChild(h('h4', null, `Tasks (${milestoneTasks.length})`));

    const assignBtn = h('button', { class: 'btn btn-ghost btn-xs' }, '+ Assign Task');
    assignBtn.addEventListener('click', () => this._openAssignTaskModal(milestone));
    taskHeader.appendChild(assignBtn);
    tasksSection.appendChild(taskHeader);

    if (milestoneTasks.length === 0) {
      tasksSection.appendChild(h('p', { class: 'milestone-detail-empty' }, 'No tasks assigned to this milestone.'));
    } else {
      const taskList = h('div', { class: 'milestone-detail-task-list' });
      for (const task of milestoneTasks) {
        const taskRow = h('div', { class: `milestone-detail-task-row milestone-detail-task-${task.status}` });

        // Status dot
        const statusDot = h('div', {
          class: `milestone-task-status-dot status-dot-${task.status}`,
          title: task.status
        });
        taskRow.appendChild(statusDot);

        // Title + priority
        const taskInfo = h('div', { class: 'milestone-detail-task-info' });
        taskInfo.appendChild(h('span', { class: 'milestone-detail-task-title' }, task.title));
        if (task.priority && task.priority !== 'normal') {
          taskInfo.appendChild(h('span', {
            class: `milestone-detail-task-priority priority-${task.priority}`
          }, task.priority));
        }
        taskRow.appendChild(taskInfo);

        // Unlink button
        const unlinkBtn = h('button', { class: 'btn btn-ghost btn-xs', title: 'Remove from milestone' }, '\u2715');
        unlinkBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this._unlinkTask(task.id, milestone.id);
        });
        taskRow.appendChild(unlinkBtn);

        taskList.appendChild(taskRow);
      }
      tasksSection.appendChild(taskList);
    }
    content.appendChild(tasksSection);

    // Actions
    const actionsBar = h('div', { class: 'milestone-detail-actions' });

    const editBtn = h('button', { class: 'btn btn-ghost btn-md' }, 'Edit');
    editBtn.addEventListener('click', () => { this._openDrawerMilestoneId = null; Drawer.close(); this._openEditModal(milestone); });
    actionsBar.appendChild(editBtn);

    if (milestone.status === 'active') {
      const completeBtn = h('button', { class: 'btn btn-primary btn-md' }, 'Mark Complete');
      completeBtn.addEventListener('click', () => {
        this._updateMilestoneStatus(milestone.id, 'completed');
        this._openDrawerMilestoneId = null;
        Drawer.close();
      });
      actionsBar.appendChild(completeBtn);
    }

    content.appendChild(actionsBar);

    Drawer.open('milestone-detail', {
      title: `Milestone: ${milestone.title}`,
      width: '520px',
      content,
      onClose: () => { this._openDrawerMilestoneId = null; }
    });
  }

  // ── Modals ──

  _openCreateModal() {
    if (!this._buildingId) {
      Toast.warning('Select a building first');
      return;
    }

    const form = h('div', { class: 'milestone-form' });

    const titleInput = h('input', { type: 'text', class: 'input', placeholder: 'Milestone title...', id: 'ms-title' });
    const descInput = h('textarea', { class: 'input', placeholder: 'Description (optional)...', rows: '3', id: 'ms-desc' });
    const phaseSelect = h('select', { class: 'input', id: 'ms-phase' });
    phaseSelect.appendChild(h('option', { value: '' }, '— No phase —'));
    for (const p of PHASE_OPTIONS) {
      phaseSelect.appendChild(h('option', { value: p }, p.charAt(0).toUpperCase() + p.slice(1)));
    }
    const ordinalInput = h('input', { type: 'number', class: 'input', min: '0', value: String(this._milestones.length), id: 'ms-ordinal' });

    form.appendChild(h('label', { class: 'form-label' }, 'Title'));
    form.appendChild(titleInput);
    form.appendChild(h('label', { class: 'form-label' }, 'Description'));
    form.appendChild(descInput);
    form.appendChild(h('label', { class: 'form-label' }, 'Phase'));
    form.appendChild(phaseSelect);
    form.appendChild(h('label', { class: 'form-label' }, 'Order'));
    form.appendChild(ordinalInput);

    const submitBtn = h('button', { class: 'btn btn-primary btn-md', style: { marginTop: 'var(--sp-4)' } }, 'Create Milestone');
    submitBtn.addEventListener('click', async () => {
      const title = titleInput.value.trim();
      if (!title) { Toast.error('Title is required'); return; }
      if (!window.overlordSocket || !this._buildingId) { Toast.error('Not connected'); return; }
      submitBtn.disabled = true;
      submitBtn.textContent = 'Creating...';
      try {
        const params = {
          buildingId: this._buildingId,
          title,
          description: descInput.value.trim() || undefined,
          phase: phaseSelect.value || undefined,
          ordinal: parseInt(ordinalInput.value, 10) || 0,
        };
        const res = await window.overlordSocket.createMilestone(params);
        if (res && res.ok) {
          Toast.success(`Milestone "${title}" created`);
          Modal.close('milestone-create');
          this._fetchMilestones();
        } else {
          Toast.error(res?.error?.message || 'Failed to create milestone');
          submitBtn.disabled = false;
          submitBtn.textContent = 'Create Milestone';
        }
      } catch (err) {
        Toast.error('Error creating milestone');
        submitBtn.disabled = false;
        submitBtn.textContent = 'Create Milestone';
      }
    });
    form.appendChild(submitBtn);

    Modal.open('milestone-create', {
      title: 'Create Milestone',
      content: form,
      size: 'sm'
    });

    requestAnimationFrame(() => titleInput.focus());
  }

  _openEditModal(milestone) {
    const form = h('div', { class: 'milestone-form' });

    const titleInput = h('input', { type: 'text', class: 'input', value: milestone.title, id: 'ms-edit-title' });
    const descInput = h('textarea', { class: 'input', rows: '3', id: 'ms-edit-desc' });
    descInput.value = milestone.description || '';
    const phaseSelect = h('select', { class: 'input', id: 'ms-edit-phase' });
    phaseSelect.appendChild(h('option', { value: '' }, '— No phase —'));
    for (const p of PHASE_OPTIONS) {
      const opt = h('option', { value: p }, p.charAt(0).toUpperCase() + p.slice(1));
      if (milestone.phase === p) opt.selected = true;
      phaseSelect.appendChild(opt);
    }
    const statusSelect = h('select', { class: 'input', id: 'ms-edit-status' });
    for (const s of ['active', 'completed', 'cancelled']) {
      const opt = h('option', { value: s }, s.charAt(0).toUpperCase() + s.slice(1));
      if (milestone.status === s) opt.selected = true;
      statusSelect.appendChild(opt);
    }
    const ordinalInput = h('input', { type: 'number', class: 'input', min: '0', value: String(milestone.ordinal || 0), id: 'ms-edit-ordinal' });

    form.appendChild(h('label', { class: 'form-label' }, 'Title'));
    form.appendChild(titleInput);
    form.appendChild(h('label', { class: 'form-label' }, 'Description'));
    form.appendChild(descInput);
    form.appendChild(h('label', { class: 'form-label' }, 'Status'));
    form.appendChild(statusSelect);
    form.appendChild(h('label', { class: 'form-label' }, 'Phase'));
    form.appendChild(phaseSelect);
    form.appendChild(h('label', { class: 'form-label' }, 'Order'));
    form.appendChild(ordinalInput);

    const saveBtn = h('button', { class: 'btn btn-primary btn-md', style: { marginTop: 'var(--sp-4)' } }, 'Save Changes');
    saveBtn.addEventListener('click', async () => {
      const title = titleInput.value.trim();
      if (!title) { Toast.error('Title is required'); return; }
      if (!window.overlordSocket) { Toast.error('Not connected'); return; }
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving...';
      try {
        const params = {
          id: milestone.id,
          title,
          description: descInput.value.trim() || undefined,
          status: statusSelect.value,
          phase: phaseSelect.value || undefined,
          ordinal: parseInt(ordinalInput.value, 10) || 0,
        };
        const res = await window.overlordSocket.updateMilestone(params);
        if (res && res.ok) {
          Toast.success('Milestone updated');
          Modal.close('milestone-edit');
          this._fetchMilestones();
        } else {
          Toast.error(res?.error?.message || 'Failed to update');
          saveBtn.disabled = false;
          saveBtn.textContent = 'Save Changes';
        }
      } catch (err) {
        Toast.error('Error updating milestone');
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save Changes';
      }
    });
    form.appendChild(saveBtn);

    Modal.open('milestone-edit', {
      title: `Edit: ${milestone.title}`,
      content: form,
      size: 'sm'
    });
  }

  _openAssignTaskModal(milestone) {
    const unassigned = this._tasks.filter(t => !t.milestone_id || t.milestone_id === milestone.id);

    const content = h('div', { class: 'milestone-assign-modal' });
    content.appendChild(h('p', { class: 'milestone-assign-hint' },
      'Select tasks to assign to this milestone. Already-assigned tasks are checked.'));

    if (unassigned.length === 0) {
      content.appendChild(h('p', { class: 'milestone-detail-empty' }, 'No tasks available.'));
    } else {
      const taskList = h('div', { class: 'milestone-assign-list' });
      for (const task of unassigned) {
        const isLinked = task.milestone_id === milestone.id;
        const row = h('label', { class: 'milestone-assign-row' });
        const checkbox = h('input', { type: 'checkbox' });
        if (isLinked) checkbox.checked = true;
        checkbox.dataset.taskId = task.id;
        checkbox.dataset.wasLinked = isLinked ? '1' : '0';
        row.appendChild(checkbox);
        row.appendChild(h('span', { class: 'milestone-assign-task-title' }, task.title));
        row.appendChild(h('span', { class: `milestone-assign-task-status status-${task.status}` }, task.status));
        taskList.appendChild(row);
      }
      content.appendChild(taskList);
    }

    const saveBtn = h('button', { class: 'btn btn-primary btn-md', style: { marginTop: 'var(--sp-4)' } }, 'Save Assignments');
    saveBtn.addEventListener('click', async () => {
      if (!window.overlordSocket) { Toast.error('Not connected'); return; }
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving...';
      const checkboxes = content.querySelectorAll('input[type="checkbox"]');
      let changed = 0;
      for (const cb of checkboxes) {
        const taskId = cb.dataset.taskId;
        const wasLinked = cb.dataset.wasLinked === '1';
        const isChecked = cb.checked;
        if (isChecked && !wasLinked) {
          await window.overlordSocket.updateTask({ id: taskId, milestoneId: milestone.id });
          changed++;
        } else if (!isChecked && wasLinked) {
          await window.overlordSocket.updateTask({ id: taskId, milestoneId: null });
          changed++;
        }
      }
      if (changed > 0) {
        Toast.success(`${changed} task(s) updated`);
        // Refresh both milestones and tasks
        this._fetchMilestones();
        if (this._buildingId && window.overlordSocket) {
          window.overlordSocket.fetchTasks(this._buildingId);
        }
      }
      Modal.close('milestone-assign');
    });
    content.appendChild(saveBtn);

    Modal.open('milestone-assign', {
      title: `Assign Tasks to: ${milestone.title}`,
      content,
      size: 'md'
    });
  }

  // ── Actions ──

  async _updateMilestoneStatus(milestoneId, status) {
    if (!window.overlordSocket) return;
    const res = await window.overlordSocket.updateMilestone({ id: milestoneId, status });
    if (res && res.ok) {
      Toast.success(`Milestone ${status}`);
      this._fetchMilestones();
    }
  }

  _confirmDelete(milestone) {
    const content = h('div', { class: 'milestone-delete-confirm' });
    content.appendChild(h('p', null, `Are you sure you want to delete "${milestone.title}"?`));
    content.appendChild(h('p', { class: 'milestone-delete-warning' },
      'Tasks assigned to this milestone will be unlinked but not deleted.'));

    const deleteBtn = h('button', { class: 'btn btn-danger btn-md', style: { marginTop: 'var(--sp-3)' } }, 'Delete Milestone');
    deleteBtn.addEventListener('click', async () => {
      if (!window.overlordSocket) { Toast.error('Not connected'); return; }
      deleteBtn.disabled = true;
      deleteBtn.textContent = 'Deleting...';
      try {
        const res = await window.overlordSocket.deleteMilestone(milestone.id);
        if (res && res.ok) {
          Toast.success('Milestone deleted');
          Modal.close('milestone-delete');
          this._openDrawerMilestoneId = null;
          Drawer.close();
          this._fetchMilestones();
        } else {
          Toast.error(res?.error?.message || 'Failed to delete');
          deleteBtn.disabled = false;
          deleteBtn.textContent = 'Delete Milestone';
        }
      } catch (err) {
        Toast.error('Error deleting milestone');
        deleteBtn.disabled = false;
        deleteBtn.textContent = 'Delete Milestone';
      }
    });
    content.appendChild(deleteBtn);

    Modal.open('milestone-delete', {
      title: 'Delete Milestone',
      content,
      size: 'sm'
    });
  }

  async _unlinkTask(taskId, milestoneId) {
    if (!window.overlordSocket) return;
    const res = await window.overlordSocket.updateTask({ id: taskId, milestoneId: null });
    if (res && res.ok) {
      Toast.success('Task removed from milestone');
      this._fetchMilestones();
      // Refresh the drawer
      const updated = this._milestones.find(m => m.id === milestoneId);
      if (updated && Drawer.getActiveId() === 'milestone-detail') {
        this._openMilestoneDetail(updated);
      }
    }
  }

  // ── Data Fetching ──

  async _fetchMilestones() {
    if (!this._buildingId || !window.overlordSocket) return;
    this._loading = true;
    await window.overlordSocket.fetchMilestones(this._buildingId);
    // Store subscription will trigger render
  }
}
