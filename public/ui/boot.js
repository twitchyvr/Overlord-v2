/**
 * Overlord v2 — Application Bootstrap
 *
 * Initializes engine, store, socket bridge, router, panels, and views.
 * New users    -> Strategist (Phase Zero setup wizard)
 * Returning    -> Dashboard with building list
 */

import { OverlordUI } from './engine/engine.js';
import { createV2Store } from './engine/store.js';
import { initSocketBridge } from './engine/socket-bridge.js';
import { h, setContent } from './engine/helpers.js';
import { initRouter, navigateTo, getInitialRoute, initBuildingView } from './engine/router.js';
import { initPanelSystem } from './components/panel.js';
import { Toast } from './components/toast.js';
import { RoomView } from './views/room-view.js';

// ── Import panel classes (they self-register on construction) ──
import { PhasePanel } from './panels/phase-panel.js';
import { AgentsPanel } from './panels/agents-panel.js';
import { RaidPanel } from './panels/raid-panel.js';
import { ActivityPanel } from './panels/activity-panel.js';
import { ProjectsPanel } from './panels/projects-panel.js';
import { ToolsPanel } from './panels/tools-panel.js';
import { LogsPanel } from './panels/logs-panel.js';
import { TeamPanel } from './panels/team-panel.js';
import { TasksPanel } from './panels/tasks-panel.js';

// ── Initialize core ──
const store = createV2Store();
const engine = OverlordUI.init(store);

// ── DOM references ──
const centerPanel = document.getElementById('center-panel');
const buildingPanel = document.getElementById('building-panel');
const rightPanel = document.getElementById('right-panel');

// ── Connect Socket.IO ──
const socket = typeof io !== 'undefined' ? io() : null;

if (socket) {
  const api = initSocketBridge(socket, store, engine);

  // ── Initialize router ──
  initRouter({ centerPanel, buildingPanel });

  // ── Construct panels (they self-register into the global PANELS map) ──
  const phaseEl = document.getElementById('panel-phase');
  const agentsEl = document.getElementById('panel-agents');
  const tasksEl = document.getElementById('panel-tasks');
  const raidEl = document.getElementById('panel-raid');
  const activityEl = document.getElementById('panel-activity');
  const projectsEl = document.getElementById('panel-projects');
  const toolsEl = document.getElementById('panel-tools');
  const logsEl = document.getElementById('panel-logs');
  const teamEl = document.getElementById('panel-team');

  if (phaseEl) new PhasePanel(phaseEl);
  if (agentsEl) new AgentsPanel(agentsEl);
  if (tasksEl) new TasksPanel(tasksEl);
  if (raidEl) new RaidPanel(raidEl);
  if (activityEl) new ActivityPanel(activityEl);
  if (projectsEl) new ProjectsPanel(projectsEl);
  if (toolsEl) new ToolsPanel(toolsEl);
  if (logsEl) new LogsPanel(logsEl);
  if (teamEl) new TeamPanel(teamEl);

  // ── Initialize panel system (mounts, restores visibility/heights, drag-resize) ──
  initPanelSystem();

  // ── Mount building view (always-on in left sidebar) ──
  initBuildingView();

  // ── Mount room view handler (listens for room-selected events) ──
  const roomView = new RoomView(document.createElement('div'));
  roomView.mount();

  // ── Toolbar navigation click handlers ──
  document.querySelectorAll('#app-toolbar .toolbar-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const view = btn.dataset.view;
      if (view) navigateTo(view);
    });
  });

  // ── Connection indicator ──
  const connectionEl = document.getElementById('toolbar-connection');
  if (connectionEl) {
    store.subscribe('ui.connectionState', (state) => {
      connectionEl.classList.remove('connected', 'disconnected', 'reconnecting');
      connectionEl.classList.add(state || 'disconnected');
      const labels = { connected: 'Connected', disconnected: 'Disconnected', reconnecting: 'Reconnecting...', failed: 'Connection failed' };
      connectionEl.title = labels[state] || 'Unknown';
    });
  }

  // ── Determine initial view after connection ──
  engine.subscribe('system:status', (data) => {
    const loadingEl = document.getElementById('loading-state');
    if (loadingEl) loadingEl.remove();

    // Populate store with initial data
    if (data.buildings) {
      store.set('building.list', data.buildings);
    }

    // Navigate to the appropriate view
    const route = getInitialRoute(data.isNewUser || !data.buildings?.length);
    navigateTo(route);
  });

  // ── Connection lost / reconnected ──
  engine.subscribe('connection:lost', () => {
    Toast.warning('Connection lost. Reconnecting...');
  });

  engine.subscribe('connection:reconnected', (data) => {
    Toast.success(`Reconnected after ${data.attempt} attempt${data.attempt === 1 ? '' : 's'}`);
  });

  engine.subscribe('connection:failed', () => {
    Toast.error('Connection failed. Please refresh the page.');
  });

  store.subscribe('ui.connected', (connected) => {
    if (connected) {
      Toast.success('Connected to Overlord');
    }
  });

  // ── Operation error feedback ──
  engine.subscribe('operation:error', (data) => {
    Toast.error(`${data.message}`);
  });

  // ── Phase bar reactivity ──
  store.subscribe('building.activePhase', (phase) => {
    _updatePhaseBar(phase);
  });

} else {
  // No Socket.IO — show error
  if (centerPanel) {
    setContent(centerPanel, null);
    centerPanel.appendChild(
      h('div', { class: 'empty-state' },
        h('div', { class: 'empty-state-icon' }, '\u26A0'),
        h('p', { class: 'empty-state-title' }, 'Socket.IO not available'),
        h('p', { class: 'empty-state-description' }, 'Make sure the Overlord v2 server is running on port 4000.'),
      )
    );
  }
}

// ═══════════════════════════════════════════════════════════
//  PRIVATE HELPERS
// ═══════════════════════════════════════════════════════════

const PHASE_ORDER = ['strategy', 'discovery', 'architecture', 'execution', 'review', 'deploy'];

function _updatePhaseBar(activePhase) {
  const steps = document.querySelectorAll('.phase-step');
  const activeIdx = PHASE_ORDER.indexOf(activePhase);

  steps.forEach((step) => {
    const phase = step.dataset.phase;
    const idx = PHASE_ORDER.indexOf(phase);
    step.classList.remove('completed', 'current');
    if (idx < activeIdx) {
      step.classList.add('completed');
    } else if (idx === activeIdx) {
      step.classList.add('current');
    }
  });
}

// ── Initialize phase bar to strategy ──
_updatePhaseBar('strategy');

console.log('[Overlord v2] Boot complete');
