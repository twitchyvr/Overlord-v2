/**
 * Overlord v2 — Application Bootstrap
 *
 * Initializes engine, store, socket bridge, and mounts the initial view.
 * New users -> Strategist (Phase Zero setup wizard)
 * Returning users -> Dashboard with building list
 */

import { OverlordUI } from './engine/engine.js';
import { createV2Store } from './engine/store.js';
import { initSocketBridge } from './engine/socket-bridge.js';
import { h, setContent } from './engine/helpers.js';

// ── Phase order for the progress bar ──
const PHASE_ORDER = ['strategy', 'discovery', 'architecture', 'execution', 'review', 'deploy'];

// ── Initialize core ──
const store = createV2Store();
const engine = OverlordUI.init(store);

// ── Connect Socket.IO ──
const socket = typeof io !== 'undefined' ? io() : null;

if (socket) {
  const api = initSocketBridge(socket, store, engine);

  // ── Phase bar reactivity ──
  store.subscribe('building.activePhase', (phase) => {
    updatePhaseBar(phase);
  });

  // ── Panel collapse toggles ──
  document.querySelectorAll('.panel-header').forEach((header) => {
    header.addEventListener('click', () => {
      const panel = header.closest('.panel');
      if (panel) panel.classList.toggle('collapsed');
    });
  });

  // ── Mobile nav ──
  document.querySelectorAll('.mobile-nav-item').forEach((item) => {
    item.addEventListener('click', () => {
      document.querySelectorAll('.mobile-nav-item').forEach((i) => i.classList.remove('active'));
      item.classList.add('active');
      const view = item.dataset.view;
      engine.dispatch('nav:change', { view });
    });
  });

  // ── Determine initial view after connection ──
  engine.subscribe('system:status', (data) => {
    const loadingEl = document.getElementById('loading-state');
    if (loadingEl) loadingEl.remove();

    if (data.isNewUser) {
      renderNewUserView();
    } else {
      renderDashboardView(data.buildings);
    }
  });

  // ── Connection lost / reconnected ──
  engine.subscribe('connection:lost', () => {
    showToast('Connection lost. Reconnecting...', 'warning');
  });

  store.subscribe('ui.connected', (connected) => {
    if (connected) {
      showToast('Connected to Overlord', 'success');
    }
  });

} else {
  // No Socket.IO — show error
  const center = document.getElementById('center-panel');
  if (center) {
    setContent(center, null);
    center.appendChild(
      h('div', { class: 'empty-state' },
        h('p', { class: 'empty-state-title' }, 'Socket.IO not available'),
        h('p', { class: 'empty-state-description' }, 'Make sure the Overlord v2 server is running on port 4000.'),
      )
    );
  }
}

// ═══════════════════════════════════════════════════════════
//  VIEW RENDERERS
// ═══════════════════════════════════════════════════════════

/**
 * Clear all children from an element safely.
 */
function clearElement(el) {
  while (el.firstChild) {
    el.removeChild(el.firstChild);
  }
}

/**
 * Update the phase progress bar based on active phase.
 */
function updatePhaseBar(activePhase) {
  const steps = document.querySelectorAll('.phase-step');
  const activeIdx = PHASE_ORDER.indexOf(activePhase);

  steps.forEach((step, i) => {
    step.classList.remove('completed', 'current');
    if (i < activeIdx) {
      step.classList.add('completed');
    } else if (i === activeIdx) {
      step.classList.add('current');
    }
  });
}

/**
 * Render the new user view — Phase Zero setup wizard.
 * Shows Quick Start templates to choose from.
 */
function renderNewUserView() {
  const center = document.getElementById('center-panel');
  if (!center) return;

  const templates = [
    { id: 'web-app', name: 'Web Application', desc: 'Full-stack web app with frontend, backend, and deployment', icon: '\u{1F310}' },
    { id: 'microservices', name: 'Microservices', desc: 'Distributed system with multiple services and integration testing', icon: '\u2699' },
    { id: 'data-pipeline', name: 'Data Pipeline', desc: 'ETL/data processing pipeline with validation and monitoring', icon: '\u{1F4CA}' },
    { id: 'cli-tool', name: 'CLI Tool', desc: 'Command-line application with focused scope', icon: '\u2328' },
    { id: 'api-service', name: 'API Service', desc: 'REST/GraphQL API with authentication and documentation', icon: '\u{1F50C}' },
  ];

  clearElement(center);

  const wrapper = h('div', { style: 'padding: 2rem; max-width: 800px; margin: 0 auto;' },
    h('div', { style: 'text-align: center; margin-bottom: 2rem;' },
      h('h1', { style: 'font-size: var(--text-3xl); margin-bottom: var(--sp-2); color: var(--text-primary);' }, 'Welcome to Overlord v2'),
      h('p', { style: 'color: var(--text-secondary); font-size: var(--text-lg);' }, 'Choose a project template to get started, or describe your project for a custom setup.'),
    ),

    h('h3', { style: 'margin-bottom: var(--sp-4); color: var(--text-secondary); font-size: var(--text-sm); text-transform: uppercase; letter-spacing: 0.08em;' }, 'Quick Start Templates'),

    h('div', { style: 'display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: var(--sp-4);' },
      ...templates.map((t) =>
        h('div', {
          class: 'card',
          style: 'cursor: pointer; transition: all 0.2s;',
          dataset: { templateId: t.id },
          onClick: () => handleTemplateSelect(t.id, t.name),
        },
          h('div', { style: 'font-size: 2rem; margin-bottom: var(--sp-3);' }, t.icon),
          h('div', { class: 'card-title', style: 'margin-bottom: var(--sp-2);' }, t.name),
          h('div', { class: 'card-subtitle' }, t.desc),
        )
      )
    ),

    h('div', { style: 'margin-top: var(--sp-8); text-align: center;' },
      h('p', { style: 'color: var(--text-muted); margin-bottom: var(--sp-3);' }, 'Or start from scratch with a custom building layout'),
      h('button', { class: 'btn btn-secondary', onClick: handleAdvancedSetup }, 'Advanced Setup'),
    ),
  );

  center.appendChild(wrapper);
  updatePhaseBar('strategy');
}

/**
 * Render the returning user dashboard.
 */
function renderDashboardView(buildings) {
  const center = document.getElementById('center-panel');
  if (!center) return;

  clearElement(center);

  if (!buildings || buildings.length === 0) {
    renderNewUserView();
    return;
  }

  const wrapper = h('div', { style: 'padding: 2rem;' },
    h('h2', { style: 'margin-bottom: var(--sp-6);' }, 'Dashboard'),

    // KPI row
    h('div', { style: 'display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: var(--sp-4); margin-bottom: var(--sp-6);' },
      renderKpiCard('Buildings', String(buildings.length), 'var(--accent-blue)'),
      renderKpiCard('Active Phase', buildings[0]?.activePhase || 'strategy', 'var(--accent-purple)'),
      renderKpiCard('Agents', String(store.peek('agents.list', []).length), 'var(--accent-green)'),
      renderKpiCard('RAID Entries', String(store.peek('raid.entries', []).length), 'var(--accent-yellow)'),
    ),

    // Building list
    h('h3', { style: 'margin-bottom: var(--sp-4); color: var(--text-secondary); font-size: var(--text-sm); text-transform: uppercase; letter-spacing: 0.08em;' }, 'Your Buildings'),

    h('div', { style: 'display: flex; flex-direction: column; gap: var(--sp-3);' },
      ...buildings.map((b) =>
        h('div', {
          class: 'card',
          style: 'cursor: pointer; display: flex; align-items: center; gap: var(--sp-4);',
          onClick: () => handleBuildingSelect(b.id),
        },
          h('div', {
            style: 'width: 40px; height: 40px; border-radius: var(--radius-lg); display: flex; align-items: center; justify-content: center; font-size: 1.2rem; background: rgba(56, 189, 248, 0.1); color: var(--accent-blue);',
          }, '\u{1F3E2}'),
          h('div', { style: 'flex: 1;' },
            h('div', { class: 'card-title' }, b.name),
            h('div', { class: 'card-subtitle' }, 'Phase: ' + b.activePhase),
          ),
          h('span', { class: 'badge badge-' + (b.activePhase === 'deploy' ? 'go' : 'pending') }, b.activePhase),
        )
      )
    ),

    // New building button
    h('div', { style: 'margin-top: var(--sp-6); text-align: center;' },
      h('button', { class: 'btn btn-primary', onClick: () => renderNewUserView() }, '+ New Building'),
    ),
  );

  center.appendChild(wrapper);

  // Update phase bar for first building
  if (buildings[0]) {
    updatePhaseBar(buildings[0].activePhase);
  }
}

/**
 * Render a KPI card.
 */
function renderKpiCard(label, value, color) {
  return h('div', { class: 'card', style: 'text-align: center; padding: var(--sp-4);' },
    h('div', { style: 'font-size: var(--text-3xl); font-weight: var(--font-bold); color: ' + color + '; margin-bottom: var(--sp-1);' }, value),
    h('div', { style: 'font-size: var(--text-xs); color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.06em;' }, label),
  );
}

// ═══════════════════════════════════════════════════════════
//  EVENT HANDLERS
// ═══════════════════════════════════════════════════════════

/**
 * Handle Quick Start template selection.
 */
async function handleTemplateSelect(templateId, templateName) {
  const center = document.getElementById('center-panel');
  if (!center) return;

  clearElement(center);

  // Show project name input
  const wrapper = h('div', { style: 'padding: 2rem; max-width: 600px; margin: 0 auto;' },
    h('h2', { style: 'margin-bottom: var(--sp-2);' }, 'New ' + templateName + ' Project'),
    h('p', { style: 'color: var(--text-secondary); margin-bottom: var(--sp-6);' }, 'Give your project a name and describe your goals.'),

    h('label', { style: 'display: block; margin-bottom: var(--sp-4);' },
      h('span', { style: 'display: block; font-size: var(--text-sm); color: var(--text-secondary); margin-bottom: var(--sp-1);' }, 'Project Name'),
      h('input', { type: 'text', id: 'project-name', placeholder: 'My Awesome Project', style: 'width: 100%;' }),
    ),

    h('label', { style: 'display: block; margin-bottom: var(--sp-4);' },
      h('span', { style: 'display: block; font-size: var(--text-sm); color: var(--text-secondary); margin-bottom: var(--sp-1);' }, 'Project Goals (one per line)'),
      h('textarea', { id: 'project-goals', rows: '4', placeholder: 'Build a user authentication system\nDeploy to production\nAchieve 80% test coverage', style: 'width: 100%;' }),
    ),

    h('label', { style: 'display: block; margin-bottom: var(--sp-6);' },
      h('span', { style: 'display: block; font-size: var(--text-sm); color: var(--text-secondary); margin-bottom: var(--sp-1);' }, 'Success Criteria (one per line)'),
      h('textarea', { id: 'project-criteria', rows: '3', placeholder: 'All tests passing\nAPI documentation complete\nSecurity audit passed', style: 'width: 100%;' }),
    ),

    h('div', { style: 'display: flex; gap: var(--sp-3); justify-content: flex-end;' },
      h('button', { class: 'btn btn-secondary', onClick: () => renderNewUserView() }, 'Back'),
      h('button', { class: 'btn btn-primary', id: 'create-project-btn', onClick: () => createProject(templateId) }, 'Create Project'),
    ),
  );

  center.appendChild(wrapper);
}

/**
 * Create a project from a template.
 */
async function createProject(templateId) {
  const nameEl = document.getElementById('project-name');
  const goalsEl = document.getElementById('project-goals');
  const criteriaEl = document.getElementById('project-criteria');

  const name = nameEl?.value?.trim();
  const goals = goalsEl?.value?.split('\n').map((g) => g.trim()).filter(Boolean) || [];
  const criteria = criteriaEl?.value?.split('\n').map((c) => c.trim()).filter(Boolean) || [];

  if (!name) {
    showToast('Please enter a project name', 'warning');
    return;
  }
  if (goals.length === 0) {
    showToast('Please enter at least one project goal', 'warning');
    return;
  }

  const btn = document.getElementById('create-project-btn');
  if (btn) { btn.textContent = 'Creating...'; btn.disabled = true; }

  try {
    // 1. Create building
    const buildResult = await window.overlordSocket.createBuilding({ name });
    if (!buildResult.ok) {
      showToast('Failed to create building: ' + (buildResult.error?.message || 'Unknown error'), 'error');
      return;
    }

    const buildingId = buildResult.data.id;

    // 2. Apply blueprint
    const blueprint = {
      mode: 'quickStart',
      templateId,
      projectGoals: goals,
      successCriteria: criteria,
    };

    const applyResult = await window.overlordSocket.applyBlueprint(buildingId, blueprint, 'user');
    if (!applyResult.ok) {
      showToast('Failed to apply blueprint: ' + (applyResult.error?.message || 'Unknown error'), 'error');
      return;
    }

    showToast('Project "' + name + '" created successfully!', 'success');

    // 3. Refresh and show dashboard
    const statusRes = await new Promise((resolve) => {
      socket.emit('system:status', {}, resolve);
    });
    if (statusRes.ok) {
      renderDashboardView(statusRes.data.buildings);
    }

  } catch (err) {
    showToast('Error: ' + err.message, 'error');
  } finally {
    if (btn) { btn.textContent = 'Create Project'; btn.disabled = false; }
  }
}

/**
 * Handle building selection from dashboard.
 */
async function handleBuildingSelect(buildingId) {
  showToast('Loading building...', 'info');
  const result = await window.overlordSocket.fetchBuilding(buildingId);
  if (result.ok) {
    store.set('building.active', buildingId);
    renderBuildingView(result.data);
  } else {
    showToast('Failed to load building', 'error');
  }
}

/**
 * Render a building's floor/room view in the building panel.
 */
function renderBuildingView(buildingData) {
  const panel = document.getElementById('building-panel');
  if (!panel) return;

  clearElement(panel);

  const floors = buildingData.floors || [];
  if (floors.length === 0) {
    panel.appendChild(h('div', { class: 'empty-state' },
      h('p', { class: 'empty-state-title' }, 'No floors yet'),
    ));
    return;
  }

  const buildingView = h('div', { class: 'building-view' },
    ...floors.map((floor) =>
      h('div', {
        class: 'floor-bar',
        dataset: { type: floor.type, floorId: floor.id },
        onClick: () => handleFloorClick(floor.id),
      },
        h('div', { class: 'floor-icon' }, getFloorIcon(floor.type)),
        h('div', { class: 'floor-info' },
          h('div', { class: 'floor-name' }, floor.name),
          h('div', { class: 'floor-meta' },
            h('span', null, floor.type),
          ),
        ),
        h('span', { class: 'floor-expand-icon' }, '\u25B6'),
      )
    )
  );

  panel.appendChild(buildingView);
  updatePhaseBar(buildingData.active_phase || 'strategy');
}

/**
 * Handle floor click — expand to show rooms.
 */
async function handleFloorClick(floorId) {
  const bar = document.querySelector('[data-floor-id="' + floorId + '"]');
  if (!bar) return;

  // Toggle active
  const wasActive = bar.classList.contains('active');
  document.querySelectorAll('.floor-bar').forEach((b) => b.classList.remove('active'));

  // Remove any existing room grid
  const existingGrid = bar.nextElementSibling;
  if (existingGrid && existingGrid.classList.contains('floor-rooms')) {
    existingGrid.remove();
  }

  if (wasActive) return;

  bar.classList.add('active');

  // Fetch floor details with rooms
  const result = await window.overlordSocket.fetchFloor(floorId);
  if (!result.ok) return;

  const rooms = result.data.rooms || [];
  if (rooms.length === 0) return;

  const grid = h('div', { class: 'floor-rooms' },
    ...rooms.map((room) =>
      h('div', { class: 'room-card', dataset: { roomId: room.id } },
        h('div', { class: 'room-card-header' },
          h('span', { class: 'room-type-label' }, room.type),
        ),
        h('div', { class: 'room-card-name' }, room.name || room.type),
        h('div', { class: 'room-card-meta' },
          h('span', null, 'Scope: ' + (room.file_scope || 'assigned')),
        ),
      )
    )
  );

  bar.after(grid);
}

/**
 * Handle advanced setup — placeholder for future Building Architect room.
 */
function handleAdvancedSetup() {
  showToast('Advanced setup coming soon -- use Quick Start for now', 'info');
}

// ═══════════════════════════════════════════════════════════
//  UTILITY
// ═══════════════════════════════════════════════════════════

/**
 * Get a floor icon by type.
 */
function getFloorIcon(type) {
  const icons = {
    strategy: '\u2696',
    collaboration: '\u{1F91D}',
    execution: '\u2699',
    governance: '\u2611',
    operations: '\u{1F680}',
    integration: '\u{1F517}',
  };
  return icons[type] || '\u25A0';
}

/**
 * Show a toast notification.
 */
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = h('div', { class: 'toast toast-' + type },
    h('span', { class: 'toast-message' }, message),
    h('span', { class: 'toast-dismiss', onClick: () => toast.remove() }, '\u2715'),
  );

  container.appendChild(toast);

  // Auto-dismiss after 4 seconds
  setTimeout(() => {
    if (toast.parentNode) {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(100%)';
      toast.style.transition = 'all 0.3s';
      setTimeout(() => toast.remove(), 300);
    }
  }, 4000);
}

// ── Initialize phase bar to strategy ──
updatePhaseBar('strategy');

console.log('[Overlord v2] Boot complete');
