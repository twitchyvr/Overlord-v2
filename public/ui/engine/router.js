/**
 * Overlord v2 — Layout Router
 *
 * Manages which view is active in the center panel.
 * All content lives in the center — no right panel.
 *
 * Routes:
 *   'dashboard'   → DashboardView (returning user with buildings)
 *   'strategist'  → StrategistView (new user / new project wizard)
 *   'chat'        → ChatView (active project conversation)
 *   'building'    → BuildingView (rendered in left panel, always active)
 *   'tasks'       → TaskView (task management with filtering)
 *   'raid-log'    → RaidLogView (RAID log with type/status tabs)
 *   'agents'      → AgentsView (agent roster, cards, detail)
 *   'activity'    → ActivityView (real-time activity feed)
 *   'phase'       → PhaseView (phase gates, progress, sign-off)
 */

import { OverlordUI } from './engine.js';
import { h, setContent } from './helpers.js';

// View constructors (lazy-loaded on first use)
let _viewModules = null;
let _activeView = null;
let _activeViewName = null;
let _centerPanel = null;
let _buildingPanel = null;
let _views = {};

/**
 * Initialize the router.
 *
 * @param {object} opts
 * @param {HTMLElement} opts.centerPanel   — the #center-panel element
 * @param {HTMLElement} opts.buildingPanel — the #building-panel element
 */
export function initRouter({ centerPanel, buildingPanel }) {
  _centerPanel = centerPanel;
  _buildingPanel = buildingPanel;

  // Listen for navigation events
  OverlordUI.subscribe('navigate:dashboard', () => navigateTo('dashboard'));
  OverlordUI.subscribe('navigate:strategist', () => navigateTo('strategist'));
  OverlordUI.subscribe('navigate:onboarding', () => navigateTo('onboarding'));
  OverlordUI.subscribe('navigate:chat', () => navigateTo('chat'));
  OverlordUI.subscribe('navigate:tasks', () => navigateTo('tasks'));
  OverlordUI.subscribe('navigate:raid-log', () => navigateTo('raid-log'));
  OverlordUI.subscribe('navigate:agents', () => navigateTo('agents'));
  OverlordUI.subscribe('navigate:activity', () => navigateTo('activity'));
  OverlordUI.subscribe('navigate:email', () => navigateTo('email'));
  OverlordUI.subscribe('navigate:milestones', () => navigateTo('milestones'));
  OverlordUI.subscribe('navigate:phase', () => navigateTo('phase'));

  // Mobile bottom nav
  document.querySelectorAll('#mobile-nav .mobile-nav-item').forEach(item => {
    item.addEventListener('click', () => {
      const view = item.dataset.view;
      if (view) {
        navigateTo(view);
        _updateMobileNav(view);
      }
    });
  });

  // Mobile "More" overflow menu
  const moreBtn = document.getElementById('mobile-nav-more');
  const overflow = document.getElementById('mobile-nav-overflow');
  if (moreBtn && overflow) {
    moreBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = !overflow.hidden;
      overflow.hidden = isOpen;
      moreBtn.setAttribute('aria-expanded', String(!isOpen));
    });
    // Overflow item clicks
    overflow.querySelectorAll('.mobile-nav-overflow-item').forEach(item => {
      item.addEventListener('click', () => {
        const view = item.dataset.view;
        if (view) {
          navigateTo(view);
          _updateMobileNav(view);
        }
        overflow.hidden = true;
        moreBtn.setAttribute('aria-expanded', 'false');
      });
    });
    // Close overflow on outside click
    document.addEventListener('click', () => {
      overflow.hidden = true;
      moreBtn.setAttribute('aria-expanded', 'false');
    });
  }

  // Listen for building selection to show chat
  OverlordUI.subscribe('building:selected', () => {
    navigateTo('chat');
  });
}

/**
 * Navigate to a view.
 * @param {string} viewName
 */
export async function navigateTo(viewName) {
  if (viewName === _activeViewName && _activeView) return;

  // Load view modules if not yet loaded
  if (!_viewModules) {
    try {
      _viewModules = await _loadViewModules();
    } catch (err) {
      console.error('[Router] Failed to load view modules:', err);
      if (_centerPanel) {
        _centerPanel.textContent = '';
        _centerPanel.appendChild(h('div', { class: 'empty-state' },
          h('p', { class: 'empty-state-title' }, 'Failed to load views'),
          h('p', { class: 'empty-state-description' }, err.message || 'Module loading error')
        ));
      }
      return;
    }
  }

  // Unmount current view
  if (_activeView && typeof _activeView.unmount === 'function') {
    _activeView.unmount();
  }

  _activeViewName = viewName;

  // Notify breadcrumb and other listeners of view change
  OverlordUI.dispatch('view:changed', { view: viewName });

  // Clear center panel
  _centerPanel.textContent = '';

  // Remove loading state if present
  const loadingEl = document.getElementById('loading-state');
  if (loadingEl) loadingEl.remove();

  // Create or reuse view
  const ViewClass = _viewModules[viewName];
  if (!ViewClass) {
    _centerPanel.appendChild(h('div', { class: 'empty-state' },
      h('p', { class: 'empty-state-title' }, `Unknown view: ${viewName}`)
    ));
    return;
  }

  // Create container for the view
  const container = h('div', { class: `view-container view-${viewName}` });
  _centerPanel.appendChild(container);

  // Destroy previous cached instance to prevent listener duplication on re-navigation
  if (_views[viewName]) {
    try { _views[viewName].destroy(); } catch (e) { /* already cleaned up */ }
  }

  // Always create a fresh view instance
  _views[viewName] = new ViewClass(container);
  _activeView = _views[viewName];
  _activeView.mount();

  // Update phase bar highlight
  _updatePhaseBarForView(viewName);

  // Update toolbar + mobile nav active states
  _updateToolbar(viewName);
  _updateMobileNav(viewName);
}

/**
 * Get the currently active view name.
 * @returns {string|null}
 */
export function getActiveView() {
  return _activeViewName;
}

/**
 * Determine initial route based on app state.
 * @param {boolean} isNewUser — true if no buildings exist
 * @returns {string}
 */
export function getInitialRoute(isNewUser) {
  return isNewUser ? 'onboarding' : 'dashboard';
}

/**
 * Initialize the building view (always-on in left panel).
 */
export async function initBuildingView() {
  if (!_buildingPanel) return;
  if (!_viewModules) {
    _viewModules = await _loadViewModules();
  }

  const BuildingView = _viewModules.building;
  if (BuildingView && !_views.building) {
    _views.building = new BuildingView(_buildingPanel);
    _views.building.mount();
  }
}

// ── Private ────────────────────────────────────────────────────

async function _loadViewModules() {
  const [
    { DashboardView },
    { StrategistView },
    { OnboardingWizard },
    { ChatView },
    { BuildingView },
    { TaskView },
    { RaidLogView },
    { AgentsView },
    { ActivityView },
    { PhaseView },
    { MilestoneView },
    { EmailView }
  ] = await Promise.all([
    import('../views/dashboard-view.js'),
    import('../views/strategist-view.js'),
    import('../views/onboarding-wizard.js'),
    import('../views/chat-view.js'),
    import('../views/building-view.js'),
    import('../views/task-view.js'),
    import('../views/raid-log-view.js'),
    import('../views/agents-view.js'),
    import('../views/activity-view.js'),
    import('../views/phase-view.js'),
    import('../views/milestone-view.js'),
    import('../views/email-view.js')
  ]);

  return {
    dashboard:  DashboardView,
    strategist: StrategistView,
    onboarding: OnboardingWizard,
    chat:       ChatView,
    building:   BuildingView,
    tasks:      TaskView,
    'raid-log': RaidLogView,
    agents:     AgentsView,
    activity:   ActivityView,
    phase:      PhaseView,
    milestones: MilestoneView,
    email:      EmailView
  };
}

function _updateToolbar(viewName) {
  document.querySelectorAll('#app-toolbar .toolbar-btn').forEach(btn => {
    const isActive = btn.dataset.view === viewName;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-current', isActive ? 'page' : 'false');
  });
}

function _updateMobileNav(viewName) {
  const overflowViews = ['activity', 'email', 'raid-log', 'phase', 'milestones', 'strategist'];
  const isOverflowView = overflowViews.includes(viewName);

  document.querySelectorAll('#mobile-nav .mobile-nav-item').forEach(item => {
    const id = item.id;
    if (id === 'mobile-nav-more') {
      // Highlight "More" when an overflow view is active
      item.classList.toggle('active', isOverflowView);
      item.setAttribute('aria-current', isOverflowView ? 'page' : 'false');
    } else {
      const isActive = item.dataset.view === viewName;
      item.classList.toggle('active', isActive);
      item.setAttribute('aria-current', isActive ? 'page' : 'false');
    }
  });
}

function _updatePhaseBarForView(viewName) {
  // Highlight phase steps based on building state
  const store = OverlordUI.getStore();
  if (!store) return;
  const activePhase = store.get('building.activePhase') || 'strategy';
  _updatePhaseBar(activePhase);
}

function _updatePhaseBar(activePhase) {
  const PHASE_ORDER = ['strategy', 'discovery', 'architecture', 'execution', 'review', 'deploy'];
  const activeIdx = PHASE_ORDER.indexOf(activePhase);

  document.querySelectorAll('.phase-step').forEach(step => {
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
