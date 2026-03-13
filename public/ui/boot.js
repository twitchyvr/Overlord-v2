/**
 * Overlord v2 — Application Bootstrap
 *
 * Initializes engine, store, socket bridge, router, and views.
 * New users    -> Strategist (Phase Zero setup wizard)
 * Returning    -> Dashboard with building list
 *
 * The right-panel system has been replaced with:
 *   - Full-page views (Agents, Activity, Phase, Tasks, RAID)
 *   - Contextual Drawer component for entity detail
 */

import { OverlordUI } from './engine/engine.js';
import { createV2Store } from './engine/store.js';
import { initSocketBridge } from './engine/socket-bridge.js';
import { createLogger, setLogLevel } from './engine/logger.js';
import { h, setContent } from './engine/helpers.js';
import { initRouter, navigateTo, getInitialRoute, initBuildingView } from './engine/router.js';
import { Toast } from './components/toast.js';
import { RoomView } from './views/room-view.js';
import { ExitDocForm } from './views/exit-doc-form.js';
import { SettingsView } from './views/settings-view.js';
import { initEntityNav } from './engine/entity-nav.js';
import { GlobalSearch } from './components/global-search.js';
import { QuickActions } from './components/quick-actions.js';

// ═══════════════════════════════════════════════════════════
//  THEME MANAGEMENT
// ═══════════════════════════════════════════════════════════

const THEME_KEY = 'overlord-theme';

/**
 * Initialize theme from saved preference or system preference.
 * Sets data-theme attribute and wires up the toggle button.
 */
function initTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  const systemPrefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;

  // Determine initial theme: saved > system > default (dark)
  const theme = saved || (systemPrefersDark === false ? 'light' : 'dark');
  applyTheme(theme);

  // Wire up toggle button
  const btn = document.getElementById('theme-toggle');
  if (btn) {
    btn.addEventListener('click', () => {
      const current = document.documentElement.getAttribute('data-theme') || 'dark';
      const next = current === 'dark' ? 'light' : 'dark';
      applyTheme(next);
      localStorage.setItem(THEME_KEY, next);
    });
  }

  // Listen for system theme changes (if no saved preference)
  window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
    if (!localStorage.getItem(THEME_KEY)) {
      applyTheme(e.matches ? 'dark' : 'light');
    }
  });
}

/**
 * Apply a theme by setting the data-theme attribute and updating
 * the toggle button's visual state.
 */
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);

  const btn = document.getElementById('theme-toggle');
  if (btn) {
    btn.classList.toggle('theme-light', theme === 'light');
    btn.title = theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme';
  }
}

// ── Initialize theme ──
initTheme();

// ── Initialize core ──
const store = createV2Store();
const engine = OverlordUI.init(store);

// ── DOM references ──
const centerPanel = document.getElementById('center-panel');
const buildingPanel = document.getElementById('building-panel');

// ── Connect Socket.IO ──
const socket = typeof io !== 'undefined' ? io() : null;

if (socket) {
  const api = initSocketBridge(socket, store, engine);

  // ── Initialize router ──
  initRouter({ centerPanel, buildingPanel });

  // ── Mount building view (always-on in left sidebar) ──
  initBuildingView();

  // ── Initialize entity navigation (opens drawers for entity detail) ──
  initEntityNav();

  // ── Mount room view handler (listens for room-selected events) ──
  const roomView = new RoomView(document.createElement('div'));
  roomView.mount();

  // ── Mount exit document form handler (listens for exit-doc:open-form events) ──
  const exitDocForm = new ExitDocForm(document.createElement('div'));
  exitDocForm.mount();

  // ── Mount settings view handler (listens for settings:open events) ──
  const settingsView = new SettingsView(document.createElement('div'));
  settingsView.mount();

  // ── Mount global search (Cmd+K) ──
  const searchContainer = document.createElement('div');
  searchContainer.id = 'global-search-container';
  const toolbarRight = document.querySelector('.toolbar-right');
  if (toolbarRight) {
    toolbarRight.insertBefore(searchContainer, toolbarRight.firstChild);
  }
  const globalSearch = new GlobalSearch(searchContainer);
  globalSearch.mount();

  // ── Mount Quick Actions FAB (floating action button, bottom-right) ──
  const qaContainer = document.createElement('div');
  document.body.appendChild(qaContainer);
  const quickActions = new QuickActions(qaContainer);
  quickActions.mount();

  // Wire settings button
  const settingsBtn = document.getElementById('settings-btn');
  if (settingsBtn) {
    settingsBtn.addEventListener('click', () => {
      OverlordUI.dispatch('settings:open');
    });
  }

  // ── Toolbar navigation click handlers ──
  document.querySelectorAll('#app-toolbar .toolbar-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const view = btn.dataset.view;
      if (view) navigateTo(view);
    });
  });

  // ── Sidebar toggle (tablet breakpoint) ──
  const sidebarToggle = document.getElementById('sidebar-toggle');
  const sidebarBackdrop = document.getElementById('sidebar-backdrop');
  if (sidebarToggle && buildingPanel) {
    const mql = window.matchMedia('(max-width: 1024px)');

    function toggleSidebar() {
      const isOpen = buildingPanel.classList.toggle('open');
      sidebarToggle.setAttribute('aria-expanded', String(isOpen));
      if (sidebarBackdrop) {
        sidebarBackdrop.hidden = !isOpen;
        // Force reflow before adding class for transition
        if (isOpen) {
          sidebarBackdrop.offsetHeight;
          sidebarBackdrop.classList.add('visible');
        } else {
          sidebarBackdrop.classList.remove('visible');
        }
      }
    }

    function closeSidebar() {
      buildingPanel.classList.remove('open');
      sidebarToggle.setAttribute('aria-expanded', 'false');
      if (sidebarBackdrop) {
        sidebarBackdrop.classList.remove('visible');
        sidebarBackdrop.hidden = true;
      }
    }

    sidebarToggle.addEventListener('click', toggleSidebar);

    if (sidebarBackdrop) {
      sidebarBackdrop.addEventListener('click', closeSidebar);
    }

    // Show/hide toggle based on viewport
    function handleViewportChange(e) {
      sidebarToggle.hidden = !e.matches;
      if (!e.matches) closeSidebar();
    }
    handleViewportChange(mql);
    mql.addEventListener('change', handleViewportChange);
  }

  // ── Connection indicator ──
  const connectionEl = document.getElementById('toolbar-connection');
  if (connectionEl) {
    store.subscribe('ui.connectionState', (state) => {
      connectionEl.classList.remove('connected', 'disconnected', 'reconnecting');
      connectionEl.classList.add(state || 'disconnected');
      const labels = { connected: 'Connected', disconnected: 'Disconnected', reconnecting: 'Reconnecting...', failed: 'Connection failed' };
      const label = labels[state] || 'Unknown';
      connectionEl.title = label;
      connectionEl.setAttribute('aria-label', `Connection status: ${label}`);
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
      step.setAttribute('aria-label', `${phase} phase — completed`);
      step.setAttribute('aria-current', 'false');
    } else if (idx === activeIdx) {
      step.classList.add('current');
      step.setAttribute('aria-label', `${phase} phase — current`);
      step.setAttribute('aria-current', 'step');
    } else {
      step.setAttribute('aria-label', `${phase} phase — pending`);
      step.setAttribute('aria-current', 'false');
    }
  });
}

// ── Initialize phase bar to strategy ──
_updatePhaseBar('strategy');

// Export for testing
if (typeof window !== 'undefined') {
  window._overlordTheme = { initTheme, applyTheme, THEME_KEY };
  window._overlordLogger = { setLogLevel };
}

const bootLog = createLogger('Overlord');
bootLog.info('Boot complete');
