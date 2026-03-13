/**
 * Overlord v2 — Phase View (Full Page)
 *
 * Replaces the cramped phase-panel sidebar with a proper full-width page
 * showing a visual phase timeline, gate cards with inline sign-off forms,
 * phase advancement controls, and a collapsible phase history section.
 *
 * Store keys:
 *   building.activePhase — current phase string
 *   phase.gates           — array of gate objects
 *   building.active      — active building ID
 *
 * Socket API:
 *   window.overlordSocket.advancePhase(buildingId)
 *   window.overlordSocket.signoffGate({ gateId, reviewer, verdict, conditions })
 */

import { Component } from '../engine/component.js';
import { OverlordUI } from '../engine/engine.js';
import { h, formatTime } from '../engine/helpers.js';
import { Toast } from '../components/toast.js';
import { EntityLink, resolveAgent } from '../engine/entity-nav.js';

/* ── Constants ── */

const PHASE_ORDER = ['strategy', 'discovery', 'architecture', 'execution', 'review', 'deploy'];

const PHASE_DESCRIPTIONS = {
  strategy:     'Define project goals, constraints, and high-level approach. Phase Zero setup.',
  discovery:    'Research requirements, gather information, identify unknowns and risks.',
  architecture: 'Design system architecture, create task breakdown, define interfaces.',
  execution:    'Build the solution. Write code, create tests, implement features.',
  review:       'Review all deliverables. Code review, testing, documentation check.',
  deploy:       'Deploy to production. CI/CD pipeline, release management, monitoring.',
};

const PHASE_ICONS = {
  strategy:     '\u{1F3AF}',
  discovery:    '\u{1F50D}',
  architecture: '\u{1F4D0}',
  execution:    '\u{1F6E0}\uFE0F',
  review:       '\u{1F4DD}',
  deploy:       '\u{1F680}',
};

const GATE_STATUS_CONFIG = {
  pending:     { label: 'Pending',     color: 'var(--gate-pending)',     icon: '\u25CB' },
  go:          { label: 'GO',          color: 'var(--gate-go)',          icon: '\u2714' },
  'no-go':     { label: 'NO-GO',       color: 'var(--gate-nogo)',        icon: '\u2718' },
  conditional: { label: 'Conditional', color: 'var(--gate-conditional)', icon: '\u26A0' },
};

const VERDICT_OPTIONS = [
  { value: 'GO',          label: 'GO -- Approved to advance' },
  { value: 'NO-GO',       label: 'NO-GO -- Blocked, needs work' },
  { value: 'CONDITIONAL', label: 'CONDITIONAL -- Advance with caveats' },
];


/* ── Phase View ── */

export class PhaseView extends Component {

  /**
   * @param {HTMLElement} el — the root container element
   */
  constructor(el) {
    super(el);
    this._currentPhase = 'strategy';
    this._gates = [];
    this._buildingId = null;
    this._historyExpanded = false;
    this._expandedSignoffGateId = null;  // gate ID whose sign-off form is open
  }

  /* ── Lifecycle ── */

  mount() {
    this._mounted = true;
    const store = OverlordUI.getStore();
    if (!store) return;

    // Subscribe to reactive store keys
    this.subscribe(store, 'building.activePhase', (phase) => {
      this._currentPhase = phase || 'strategy';
      this._render();
    });

    this.subscribe(store, 'phase.gates', (gates) => {
      this._gates = gates || [];
      this._render();
    });

    this.subscribe(store, 'building.active', (buildingId) => {
      this._buildingId = buildingId;
      this._render();
    });

    // Listen for real-time phase/gate events and refresh
    this._listeners.push(
      OverlordUI.subscribe('phase:gate:created', () => this._render()),
      OverlordUI.subscribe('phase:gate:signed-off', () => this._render()),
      OverlordUI.subscribe('phase:advanced', () => {
        this._expandedSignoffGateId = null;
        this._render();
      })
    );

    // Seed from current store values
    this._currentPhase = store.get('building.activePhase') || 'strategy';
    this._gates = store.get('phase.gates') || [];
    this._buildingId = store.get('building.active') || null;

    this._render();
  }

  destroy() {
    super.destroy();
  }

  /* ── Main Render ── */

  _render() {
    this.el.textContent = '';
    this.el.className = 'phase-view';

    // No building selected — show empty state
    if (!this._buildingId) {
      this.el.appendChild(this._renderEmptyState());
      return;
    }

    // Page header
    this.el.appendChild(this._renderHeader());

    // Phase stepper (the big visual timeline)
    this.el.appendChild(this._renderPhaseStepper());

    // Current phase card
    this.el.appendChild(this._renderCurrentPhaseCard());

    // Gate cards for the current phase
    this.el.appendChild(this._renderGateCards());

    // Phase history (collapsible)
    this.el.appendChild(this._renderPhaseHistory());
  }

  /* ── Empty State ── */

  _renderEmptyState() {
    return h('div', { class: 'phase-view-empty' },
      h('div', { class: 'phase-view-empty-icon' }, '\u{1F6A7}'),
      h('h2', { class: 'phase-view-empty-title' }, 'No Building Selected'),
      h('p', { class: 'phase-view-empty-text' },
        'Select or create a building from the Dashboard to view phase progress and gate sign-offs.'
      )
    );
  }

  /* ── Page Header ── */

  _renderHeader() {
    const phaseIdx = PHASE_ORDER.indexOf(this._currentPhase);
    const progress = phaseIdx >= 0 ? Math.round(((phaseIdx + 1) / PHASE_ORDER.length) * 100) : 0;

    return h('div', { class: 'phase-view-header' },
      h('div', { class: 'phase-view-header-left' },
        h('h1', { class: 'phase-view-title' }, 'Phase Gates'),
        h('span', { class: 'phase-view-subtitle' },
          `Phase ${phaseIdx + 1} of ${PHASE_ORDER.length} — ${progress}% complete`
        )
      ),
      h('div', { class: 'phase-view-header-right' },
        h('span', { class: `phase-view-header-badge phase-view-badge-${this._currentPhase}` },
          PHASE_ICONS[this._currentPhase] || '',
          ' ',
          this._capitalize(this._currentPhase)
        )
      )
    );
  }

  /* ── Phase Stepper (horizontal timeline) ── */

  _renderPhaseStepper() {
    const currentIdx = PHASE_ORDER.indexOf(this._currentPhase);

    const stepper = h('div', { class: 'phase-view-stepper' });

    for (let i = 0; i < PHASE_ORDER.length; i++) {
      const phase = PHASE_ORDER[i];
      const isComplete = i < currentIdx;
      const isCurrent = i === currentIdx;
      const isFuture = i > currentIdx;

      // Connector line (before each step except the first)
      if (i > 0) {
        const lineClass = [
          'phase-view-stepper-line',
          isComplete ? 'phase-view-stepper-line-complete' : '',
          isCurrent ? 'phase-view-stepper-line-current' : '',
        ].filter(Boolean).join(' ');
        stepper.appendChild(h('div', { class: lineClass }));
      }

      // Step node
      const stepClass = [
        'phase-view-stepper-step',
        isComplete ? 'phase-view-step-complete' : '',
        isCurrent ? 'phase-view-step-current' : '',
        isFuture ? 'phase-view-step-future' : '',
      ].filter(Boolean).join(' ');

      const circleContent = isComplete ? '\u2713' : PHASE_ICONS[phase] || String(i + 1);

      const step = h('div', { class: stepClass },
        h('div', { class: 'phase-view-step-circle' },
          h('span', { class: 'phase-view-step-icon' }, circleContent)
        ),
        h('div', { class: 'phase-view-step-label' }, this._capitalize(phase)),
        h('div', { class: 'phase-view-step-desc' }, this._truncateDescription(PHASE_DESCRIPTIONS[phase], 60))
      );

      stepper.appendChild(step);
    }

    return h('div', { class: 'phase-view-stepper-wrapper' }, stepper);
  }

  /* ── Current Phase Card ── */

  _renderCurrentPhaseCard() {
    const currentIdx = PHASE_ORDER.indexOf(this._currentPhase);
    const currentGates = this._gates.filter(g => g.phase === this._currentPhase);
    const allGatesGo = currentGates.length > 0 && currentGates.every(g => g.status === 'go');
    const noGates = currentGates.length === 0;
    const nextPhase = currentIdx + 1 < PHASE_ORDER.length ? PHASE_ORDER[currentIdx + 1] : null;
    const canAdvance = nextPhase && (allGatesGo || noGates);

    const card = h('div', { class: `phase-view-current-card phase-view-current-${this._currentPhase}` });

    // Card header row
    const headerRow = h('div', { class: 'phase-view-current-header' },
      h('div', { class: 'phase-view-current-icon' }, PHASE_ICONS[this._currentPhase] || ''),
      h('div', { class: 'phase-view-current-info' },
        h('h2', { class: 'phase-view-current-name' }, this._capitalize(this._currentPhase)),
        h('p', { class: 'phase-view-current-desc' }, PHASE_DESCRIPTIONS[this._currentPhase])
      )
    );
    card.appendChild(headerRow);

    // Gate summary bar
    const summaryRow = h('div', { class: 'phase-view-current-summary' });
    if (currentGates.length === 0) {
      summaryRow.appendChild(
        h('span', { class: 'phase-view-current-summary-text' }, 'No gates defined for this phase.')
      );
    } else {
      const goCount = currentGates.filter(g => g.status === 'go').length;
      const pendingCount = currentGates.filter(g => g.status === 'pending').length;
      const noGoCount = currentGates.filter(g => g.status === 'no-go').length;
      const condCount = currentGates.filter(g => g.status === 'conditional').length;

      summaryRow.appendChild(h('div', { class: 'phase-view-current-gate-counts' },
        this._renderGateCountBadge('go', goCount),
        this._renderGateCountBadge('pending', pendingCount),
        this._renderGateCountBadge('conditional', condCount),
        this._renderGateCountBadge('no-go', noGoCount)
      ));
    }
    card.appendChild(summaryRow);

    // Advance button section
    if (nextPhase) {
      const actionRow = h('div', { class: 'phase-view-current-actions' });

      if (canAdvance) {
        const advanceBtn = h('button', {
          class: 'phase-view-advance-btn',
          title: `Advance to ${this._capitalize(nextPhase)}`
        },
          h('span', { class: 'phase-view-advance-btn-text' },
            `Advance to ${this._capitalize(nextPhase)}`
          ),
          h('span', { class: 'phase-view-advance-btn-arrow' }, '\u2192')
        );
        advanceBtn.addEventListener('click', () => this._handleAdvancePhase());
        actionRow.appendChild(advanceBtn);
      } else {
        actionRow.appendChild(
          h('div', { class: 'phase-view-advance-blocked' },
            h('span', { class: 'phase-view-advance-blocked-icon' }, '\u{1F512}'),
            h('span', null, 'All gates must be GO before advancing.')
          )
        );
      }

      card.appendChild(actionRow);
    } else {
      // Final phase
      card.appendChild(
        h('div', { class: 'phase-view-current-actions' },
          h('div', { class: 'phase-view-final-phase' },
            h('span', null, '\u{1F3C1}'),
            h('span', null, ' This is the final phase. Deploy and release!')
          )
        )
      );
    }

    return card;
  }

  /* ── Gate Cards ── */

  _renderGateCards() {
    const currentGates = this._gates.filter(g => g.phase === this._currentPhase);
    const section = h('div', { class: 'phase-view-gates-section' });

    section.appendChild(
      h('h3', { class: 'phase-view-section-title' },
        `Gates for ${this._capitalize(this._currentPhase)} Phase`,
        h('span', { class: 'phase-view-section-count' }, ` (${currentGates.length})`)
      )
    );

    if (currentGates.length === 0) {
      section.appendChild(
        h('div', { class: 'phase-view-gates-empty' },
          h('div', { class: 'phase-view-gates-empty-icon' }, '\u{1F6A7}'),
          h('p', null, 'No gates have been created for this phase yet.'),
          h('p', { class: 'phase-view-gates-empty-hint' },
            'Gates are created automatically when a room or the Strategist initiates a phase gate review.'
          )
        )
      );
      return section;
    }

    const grid = h('div', { class: 'phase-view-gates-grid' });

    for (const gate of currentGates) {
      grid.appendChild(this._renderSingleGateCard(gate));
    }

    section.appendChild(grid);
    return section;
  }

  /** Render a single gate card with status, criteria, sign-offs, and inline sign-off form. */
  _renderSingleGateCard(gate) {
    const statusCfg = GATE_STATUS_CONFIG[gate.status] || GATE_STATUS_CONFIG.pending;
    const isSignoffOpen = this._expandedSignoffGateId === gate.id;

    const card = h('div', {
      class: `phase-view-gate-card phase-view-gate-${gate.status || 'pending'}`,
      'data-gate-id': gate.id
    });

    // ── Gate header ──
    const header = h('div', { class: 'phase-view-gate-header' },
      h('div', { class: 'phase-view-gate-status-dot', style: { background: statusCfg.color } },
        h('span', null, statusCfg.icon)
      ),
      h('div', { class: 'phase-view-gate-title-group' },
        h('h4', { class: 'phase-view-gate-title' },
          `${this._capitalize(gate.phase)} Gate`
        ),
        h('span', { class: 'phase-view-gate-type' }, gate.type || 'gate')
      ),
      h('div', {
        class: 'phase-view-gate-status-badge',
        style: { background: statusCfg.color }
      }, statusCfg.label)
    );
    card.appendChild(header);

    // ── Gate ID + created timestamp ──
    const metaRow = h('div', { class: 'phase-view-gate-meta' },
      h('span', { class: 'phase-view-gate-id' }, `ID: ${this._shortId(gate.id)}`),
      gate.created_at
        ? h('span', { class: 'phase-view-gate-time' }, `Created ${this._formatDate(gate.created_at)}`)
        : null
    );
    card.appendChild(metaRow);

    // ── Criteria checklist ──
    if (gate.criteria && gate.criteria.length > 0) {
      const criteriaSection = h('div', { class: 'phase-view-gate-criteria' });
      criteriaSection.appendChild(
        h('h5', { class: 'phase-view-gate-criteria-title' }, 'Criteria')
      );
      const criteriaList = h('ul', { class: 'phase-view-gate-criteria-list' });
      for (const criterion of gate.criteria) {
        const isChecked = gate.status === 'go';
        criteriaList.appendChild(
          h('li', { class: `phase-view-criterion${isChecked ? ' phase-view-criterion-met' : ''}` },
            h('span', { class: 'phase-view-criterion-check' }, isChecked ? '\u2611' : '\u2610'),
            h('span', null, criterion)
          )
        );
      }
      criteriaSection.appendChild(criteriaList);
      card.appendChild(criteriaSection);
    }

    // ── Existing sign-offs ──
    if (gate.signoffs && gate.signoffs.length > 0) {
      const signoffsSection = h('div', { class: 'phase-view-gate-signoffs' });
      signoffsSection.appendChild(
        h('h5', { class: 'phase-view-gate-signoffs-title' },
          `Sign-offs (${gate.signoffs.length})`
        )
      );

      const signoffsList = h('div', { class: 'phase-view-signoffs-list' });
      for (const signoff of gate.signoffs) {
        const verdictCfg = GATE_STATUS_CONFIG[(signoff.verdict || '').toLowerCase()] || GATE_STATUS_CONFIG.pending;
        const agent = signoff.agent_id ? resolveAgent(signoff.agent_id) : null;

        const signoffRow = h('div', { class: 'phase-view-signoff-row' },
          h('div', {
            class: 'phase-view-signoff-verdict-dot',
            style: { background: verdictCfg.color }
          }, verdictCfg.icon),
          h('div', { class: 'phase-view-signoff-details' },
            h('div', { class: 'phase-view-signoff-who' },
              agent ? EntityLink.agent(signoff.agent_id, agent.name) : h('span', null, signoff.agent_id || 'Unknown'),
              h('span', { class: 'phase-view-signoff-verdict-label' }, verdictCfg.label)
            ),
            signoff.reason
              ? h('div', { class: 'phase-view-signoff-reason' }, signoff.reason)
              : null,
            signoff.timestamp
              ? h('div', { class: 'phase-view-signoff-time' }, this._formatDate(signoff.timestamp))
              : null
          )
        );
        signoffsList.appendChild(signoffRow);
      }
      signoffsSection.appendChild(signoffsList);
      card.appendChild(signoffsSection);
    }

    // ── Sign-off action area ──
    if (gate.status !== 'go') {
      if (isSignoffOpen) {
        card.appendChild(this._renderSignOffForm(gate));
      } else {
        const signoffTrigger = h('div', { class: 'phase-view-gate-signoff-trigger' });
        const signoffBtn = h('button', { class: 'phase-view-signoff-open-btn' },
          '\u270D\uFE0F Sign Off on This Gate'
        );
        signoffBtn.addEventListener('click', () => {
          this._expandedSignoffGateId = gate.id;
          this._render();
        });
        signoffTrigger.appendChild(signoffBtn);
        card.appendChild(signoffTrigger);
      }
    }

    return card;
  }

  /* ── Sign-Off Form (inline in gate card) ── */

  _renderSignOffForm(gate) {
    const form = h('div', { class: 'phase-view-signoff-form' });

    form.appendChild(
      h('h5', { class: 'phase-view-signoff-form-title' }, 'Submit Sign-Off')
    );

    // Verdict selector
    const verdictGroup = h('div', { class: 'phase-view-form-group' });
    verdictGroup.appendChild(h('label', { class: 'phase-view-form-label' }, 'Verdict'));

    const verdictRow = h('div', { class: 'phase-view-verdict-row' });
    let selectedVerdict = 'GO';

    for (const opt of VERDICT_OPTIONS) {
      const statusKey = opt.value.toLowerCase();
      const cfg = GATE_STATUS_CONFIG[statusKey] || GATE_STATUS_CONFIG.pending;
      const radio = h('label', {
        class: `phase-view-verdict-option phase-view-verdict-${statusKey}${opt.value === selectedVerdict ? ' phase-view-verdict-selected' : ''}`,
        'data-verdict': opt.value
      },
        h('span', { class: 'phase-view-verdict-icon', style: { color: cfg.color } }, cfg.icon),
        h('span', { class: 'phase-view-verdict-text' }, cfg.label)
      );

      radio.addEventListener('click', () => {
        selectedVerdict = opt.value;
        // Update visual selection
        verdictRow.querySelectorAll('.phase-view-verdict-option').forEach(el => {
          el.classList.remove('phase-view-verdict-selected');
        });
        radio.classList.add('phase-view-verdict-selected');
      });

      verdictRow.appendChild(radio);
    }

    verdictGroup.appendChild(verdictRow);
    form.appendChild(verdictGroup);

    // Reason textarea
    const reasonGroup = h('div', { class: 'phase-view-form-group' });
    reasonGroup.appendChild(h('label', { class: 'phase-view-form-label' }, 'Reason / Notes'));
    const reasonTextarea = h('textarea', {
      class: 'phase-view-form-textarea',
      placeholder: 'Explain your verdict: what passed, what needs work, any conditions...',
      rows: '4'
    });
    reasonGroup.appendChild(reasonTextarea);
    form.appendChild(reasonGroup);

    // Action buttons
    const actionsRow = h('div', { class: 'phase-view-form-actions' });

    const submitBtn = h('button', { class: 'phase-view-form-submit' }, 'Submit Sign-Off');
    submitBtn.addEventListener('click', () => {
      const reason = reasonTextarea.value.trim();
      this._handleSignOff(gate.id, selectedVerdict, reason);
    });

    const cancelBtn = h('button', { class: 'phase-view-form-cancel' }, 'Cancel');
    cancelBtn.addEventListener('click', () => {
      this._expandedSignoffGateId = null;
      this._render();
    });

    actionsRow.appendChild(submitBtn);
    actionsRow.appendChild(cancelBtn);
    form.appendChild(actionsRow);

    return form;
  }

  /* ── Phase History (collapsible completed phases) ── */

  _renderPhaseHistory() {
    const currentIdx = PHASE_ORDER.indexOf(this._currentPhase);
    const completedPhases = PHASE_ORDER.slice(0, currentIdx);

    const section = h('div', { class: 'phase-view-history-section' });

    // Collapsible header
    const toggle = h('div', { class: 'phase-view-history-toggle' });
    const toggleBtn = h('button', { class: 'phase-view-history-toggle-btn' },
      h('span', { class: 'phase-view-history-toggle-icon' },
        this._historyExpanded ? '\u25BC' : '\u25B6'
      ),
      h('span', null, `Completed Phases (${completedPhases.length})`),
    );
    toggleBtn.addEventListener('click', () => {
      this._historyExpanded = !this._historyExpanded;
      this._render();
    });
    toggle.appendChild(toggleBtn);
    section.appendChild(toggle);

    if (completedPhases.length === 0) {
      section.appendChild(
        h('div', { class: 'phase-view-history-empty' },
          'No completed phases yet. This is the first phase.'
        )
      );
      return section;
    }

    // Collapsible body
    if (this._historyExpanded) {
      const historyBody = h('div', { class: 'phase-view-history-body' });

      for (const phase of completedPhases) {
        const phaseGates = this._gates.filter(g => g.phase === phase);

        const phaseBlock = h('div', { class: 'phase-view-history-phase' });

        phaseBlock.appendChild(
          h('div', { class: 'phase-view-history-phase-header' },
            h('span', { class: 'phase-view-history-phase-icon' }, '\u2713'),
            h('h4', null, this._capitalize(phase)),
            h('span', { class: 'phase-view-history-gate-count' },
              `${phaseGates.length} gate${phaseGates.length !== 1 ? 's' : ''}`
            )
          )
        );

        if (phaseGates.length > 0) {
          const gateList = h('div', { class: 'phase-view-history-gate-list' });
          for (const gate of phaseGates) {
            const statusCfg = GATE_STATUS_CONFIG[gate.status] || GATE_STATUS_CONFIG.pending;
            const signoffCount = (gate.signoffs || []).length;

            gateList.appendChild(
              h('div', { class: 'phase-view-history-gate-row' },
                h('span', {
                  class: 'phase-view-history-gate-dot',
                  style: { background: statusCfg.color }
                }, statusCfg.icon),
                h('span', { class: 'phase-view-history-gate-label' },
                  `${this._capitalize(gate.phase)} Gate`
                ),
                h('span', { class: 'phase-view-history-gate-verdict' }, statusCfg.label),
                h('span', { class: 'phase-view-history-gate-signoffs' },
                  `${signoffCount} sign-off${signoffCount !== 1 ? 's' : ''}`
                ),
                gate.created_at
                  ? h('span', { class: 'phase-view-history-gate-time' }, this._formatDate(gate.created_at))
                  : null
              )
            );
          }
          phaseBlock.appendChild(gateList);
        } else {
          phaseBlock.appendChild(
            h('div', { class: 'phase-view-history-no-gates' }, 'No gates were recorded for this phase.')
          );
        }

        historyBody.appendChild(phaseBlock);
      }

      section.appendChild(historyBody);
    }

    return section;
  }

  /* ── Actions ── */

  async _handleSignOff(gateId, verdict, reason) {
    if (!this._buildingId) {
      Toast.error('No active building');
      return;
    }
    if (!window.overlordSocket) {
      Toast.error('Not connected to server');
      return;
    }

    try {
      const result = await window.overlordSocket.signoffGate({
        gateId,
        reviewer: 'user',
        verdict,
        conditions: verdict === 'CONDITIONAL' && reason ? [reason] : [],
      });

      if (result && result.ok) {
        const statusKey = verdict.toLowerCase();
        const label = (GATE_STATUS_CONFIG[statusKey] || {}).label || verdict;
        Toast.success(`Gate signed off as ${label}`);
        this._expandedSignoffGateId = null;
        // The store subscription will trigger re-render when gates update
      } else {
        Toast.error(result?.error?.message || 'Failed to sign off gate');
      }
    } catch (err) {
      Toast.error(`Sign-off failed: ${err.message || err}`);
    }
  }

  async _handleAdvancePhase() {
    if (!this._buildingId) {
      Toast.error('No active building');
      return;
    }
    if (!window.overlordSocket) {
      Toast.error('Not connected to server');
      return;
    }

    const currentIdx = PHASE_ORDER.indexOf(this._currentPhase);
    const nextPhase = currentIdx + 1 < PHASE_ORDER.length ? PHASE_ORDER[currentIdx + 1] : null;
    if (!nextPhase) {
      Toast.warning('Already at the final phase');
      return;
    }

    try {
      const result = await window.overlordSocket.advancePhase(this._buildingId);

      if (result && result.ok) {
        Toast.success(`Advanced to ${this._capitalize(nextPhase)} phase`);
        this._expandedSignoffGateId = null;
        // Store subscription will trigger re-render
      } else {
        Toast.error(result?.error?.message || 'Failed to advance phase');
      }
    } catch (err) {
      Toast.error(`Advance failed: ${err.message || err}`);
    }
  }

  /* ── UI Helpers ── */

  _renderGateCountBadge(status, count) {
    if (count <= 0) return null;
    const cfg = GATE_STATUS_CONFIG[status] || GATE_STATUS_CONFIG.pending;
    return h('span', {
      class: 'phase-view-gate-count-badge',
      style: { '--badge-color': cfg.color }
    },
      h('span', { class: 'phase-view-gate-count-icon' }, cfg.icon),
      h('span', null, ` ${count} ${cfg.label}`)
    );
  }

  _capitalize(str) {
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  _shortId(id) {
    if (!id) return '---';
    return id.length > 12 ? id.slice(0, 8) + '...' : id;
  }

  _truncateDescription(text, maxLen) {
    if (!text) return '';
    if (text.length <= maxLen) return text;
    return text.slice(0, maxLen - 3) + '...';
  }

  _formatDate(dateStr) {
    if (!dateStr) return '';
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
        ' ' + formatTime(d);
    } catch {
      return dateStr;
    }
  }

}
