/**
 * Overlord v2 — Phase View (Full Page)
 *
 * Replaces the cramped phase-panel sidebar with a proper full-width page
 * showing a visual phase timeline, gate cards with inline sign-off forms,
 * phase advancement controls, and a collapsible phase history section.
 *
 * Store keys:
 *   building.activePhase — current phase string
 *   building.gates       — array of gate objects
 *   building.active      — active building ID
 *
 * Socket API:
 *   window.overlordSocket.advancePhase(buildingId)
 *   window.overlordSocket.signOffGate({ buildingId, gateId, verdict, reason })
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
  { value: 'go',          label: 'GO -- Approved to advance' },
  { value: 'no-go',       label: 'NO-GO -- Blocked, needs work' },
  { value: 'conditional', label: 'CONDITIONAL -- Advance with caveats' },
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

    this.subscribe(store, 'building.gates', (gates) => {
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
    this._gates = store.get('building.gates') || [];
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

    // Inject scoped styles on first render
    this._injectStyles();

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
        const verdictCfg = GATE_STATUS_CONFIG[signoff.verdict] || GATE_STATUS_CONFIG.pending;
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
    let selectedVerdict = 'go';

    for (const opt of VERDICT_OPTIONS) {
      const cfg = GATE_STATUS_CONFIG[opt.value] || GATE_STATUS_CONFIG.pending;
      const radio = h('label', {
        class: `phase-view-verdict-option phase-view-verdict-${opt.value}${opt.value === selectedVerdict ? ' phase-view-verdict-selected' : ''}`,
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
      const result = await window.overlordSocket.signOffGate({
        buildingId: this._buildingId,
        gateId,
        verdict,
        reason
      });

      if (result && result.ok) {
        const label = (GATE_STATUS_CONFIG[verdict] || {}).label || verdict;
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

  // ── Scoped Styles ────────────────────────────────────────────

  _injectStyles() {
    if (document.getElementById('phase-view-styles')) return;

    const style = document.createElement('style');
    style.id = 'phase-view-styles';
    style.textContent = `
/* ═══════════════════════════════════════════════════
   PHASE VIEW — Full-Page Dashboard Styles
   ═══════════════════════════════════════════════════ */

/* ── Layout ── */
.phase-view {
  padding: var(--sp-6);
  overflow-y: auto;
  height: 100%;
  background: var(--bg-primary);
}

/* ── Page Header ── */
.phase-view-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: var(--sp-6);
  flex-wrap: wrap;
  gap: var(--sp-4);
}
.phase-view-header-left {
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
}
.phase-view-header-right {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: var(--sp-2);
}
.phase-view-title {
  font-size: var(--text-2xl);
  font-weight: var(--font-bold);
  color: var(--text-primary);
  margin: 0;
}
.phase-view-subtitle {
  font-size: var(--text-sm);
  color: var(--text-muted);
}

/* ── Header Badge (current phase) ── */
.phase-view-header-badge {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-2);
  padding: var(--sp-2) var(--sp-4);
  border-radius: var(--radius-full);
  font-weight: var(--font-bold);
  font-size: var(--text-sm);
}
.phase-view-badge-strategy {
  background: rgba(168, 85, 247, 0.15);
  color: var(--accent-purple);
  border: 1px solid rgba(168, 85, 247, 0.3);
}
.phase-view-badge-discovery {
  background: rgba(56, 189, 248, 0.15);
  color: var(--accent-blue);
  border: 1px solid rgba(56, 189, 248, 0.3);
}
.phase-view-badge-architecture {
  background: rgba(34, 211, 238, 0.15);
  color: var(--accent-cyan);
  border: 1px solid rgba(34, 211, 238, 0.3);
}
.phase-view-badge-execution {
  background: rgba(74, 222, 128, 0.15);
  color: var(--accent-green);
  border: 1px solid rgba(74, 222, 128, 0.3);
}
.phase-view-badge-review {
  background: rgba(251, 191, 36, 0.15);
  color: var(--accent-yellow);
  border: 1px solid rgba(251, 191, 36, 0.3);
}
.phase-view-badge-deploy {
  background: rgba(248, 113, 113, 0.15);
  color: var(--accent-red);
  border: 1px solid rgba(248, 113, 113, 0.3);
}

/* ═══════════════════════════════════════════════════
   PHASE STEPPER — Horizontal Timeline
   ═══════════════════════════════════════════════════ */

.phase-view-stepper-wrapper {
  overflow-x: auto;
  margin-bottom: var(--sp-6);
  padding: var(--sp-4) 0;
  -webkit-overflow-scrolling: touch;
}
.phase-view-stepper {
  display: flex;
  align-items: flex-start;
  justify-content: center;
  gap: var(--sp-1);
}
.phase-view-stepper-step {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--sp-2);
  flex: 0 0 auto;
  min-width: 100px;
}
.phase-view-step-circle {
  width: 48px;
  height: 48px;
  border-radius: var(--radius-full);
  background: var(--bg-secondary);
  border: 3px solid var(--border-primary);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all var(--duration-fast) var(--ease-default);
}
.phase-view-step-icon {
  font-size: var(--text-lg);
}
.phase-view-step-label {
  font-size: var(--text-xs);
  font-weight: var(--font-medium);
  text-transform: capitalize;
  color: var(--text-muted);
  transition: color var(--duration-fast) var(--ease-default);
}
.phase-view-step-desc {
  font-size: var(--text-xs);
  color: var(--text-muted);
  text-align: center;
  max-width: 120px;
  line-height: var(--leading-normal);
}

/* Connector line */
.phase-view-stepper-line {
  flex: 1;
  height: 3px;
  background: var(--border-primary);
  min-width: 20px;
  align-self: center;
  margin-top: -24px;
  border-radius: 2px;
  transition: background var(--duration-fast) var(--ease-default);
}
.phase-view-stepper-line-complete {
  background: var(--accent-green);
}
.phase-view-stepper-line-current {
  background: linear-gradient(90deg, var(--accent-green), var(--accent-blue));
}

/* Step states */
.phase-view-step-complete .phase-view-step-circle {
  background: rgba(74, 222, 128, 0.15);
  border-color: var(--accent-green);
}
.phase-view-step-complete .phase-view-step-icon {
  color: var(--accent-green);
}
.phase-view-step-complete .phase-view-step-label {
  color: var(--accent-green);
}

.phase-view-step-current .phase-view-step-circle {
  background: rgba(56, 189, 248, 0.15);
  border-color: var(--accent-blue);
  box-shadow: 0 0 12px rgba(56, 189, 248, 0.3);
  animation: phase-view-pulse 2s ease-in-out infinite;
}
.phase-view-step-current .phase-view-step-icon {
  color: var(--accent-blue);
}
.phase-view-step-current .phase-view-step-label {
  color: var(--accent-blue);
  font-weight: var(--font-bold);
}

.phase-view-step-future {
  opacity: 0.5;
}
.phase-view-step-future .phase-view-step-circle {
  background: var(--bg-tertiary);
  border-color: var(--border-secondary);
}
.phase-view-step-future .phase-view-step-icon {
  color: var(--text-muted);
}

@keyframes phase-view-pulse {
  0%, 100% { box-shadow: 0 0 12px rgba(56, 189, 248, 0.3); }
  50%      { box-shadow: 0 0 20px rgba(56, 189, 248, 0.5); }
}

/* ═══════════════════════════════════════════════════
   CURRENT PHASE CARD
   ═══════════════════════════════════════════════════ */

.phase-view-current-card {
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-xl);
  padding: var(--sp-6);
  margin-bottom: var(--sp-6);
  backdrop-filter: blur(var(--glass-blur));
  -webkit-backdrop-filter: blur(var(--glass-blur));
}
.phase-view-current-header {
  display: flex;
  flex-direction: row;
  gap: var(--sp-4);
  align-items: center;
}
.phase-view-current-icon {
  font-size: 3rem;
  flex-shrink: 0;
}
.phase-view-current-info {
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
  flex: 1;
  min-width: 0;
}
.phase-view-current-name {
  font-size: var(--text-2xl);
  font-weight: var(--font-bold);
  text-transform: capitalize;
  margin: 0;
}

/* Per-phase accent colors on name */
.phase-view-current-strategy .phase-view-current-name     { color: var(--accent-purple); }
.phase-view-current-discovery .phase-view-current-name    { color: var(--accent-blue); }
.phase-view-current-architecture .phase-view-current-name { color: var(--accent-cyan); }
.phase-view-current-execution .phase-view-current-name    { color: var(--accent-green); }
.phase-view-current-review .phase-view-current-name       { color: var(--accent-yellow); }
.phase-view-current-deploy .phase-view-current-name       { color: var(--accent-red); }

.phase-view-current-desc {
  font-size: var(--text-sm);
  color: var(--text-secondary);
  line-height: var(--leading-normal);
  margin: 0;
}
.phase-view-current-summary {
  padding: var(--sp-3);
  background: var(--bg-tertiary);
  border-radius: var(--radius-md);
  margin-top: var(--sp-4);
}
.phase-view-current-summary-text {
  font-size: var(--text-sm);
  color: var(--text-muted);
}
.phase-view-current-gate-counts {
  display: flex;
  flex-direction: row;
  gap: var(--sp-3);
  flex-wrap: wrap;
}
.phase-view-gate-count-badge {
  display: inline-flex;
  flex-direction: row;
  align-items: center;
  gap: var(--sp-1);
  padding: var(--sp-1) var(--sp-3);
  border-radius: var(--radius-full);
  font-size: var(--text-xs);
  font-weight: var(--font-semibold);
  background: rgba(255, 255, 255, 0.06);
  color: var(--badge-color, var(--text-secondary));
}
.phase-view-gate-count-icon {
  font-size: var(--text-xs);
}

/* Advance / Actions */
.phase-view-current-actions {
  margin-top: var(--sp-4);
  padding-top: var(--sp-4);
  border-top: 1px solid var(--border-secondary);
}
.phase-view-advance-btn {
  display: inline-flex;
  flex-direction: row;
  align-items: center;
  gap: var(--sp-2);
  background: var(--accent-blue);
  color: #fff;
  font-weight: var(--font-bold);
  font-size: var(--text-sm);
  padding: var(--sp-3) var(--sp-6);
  border-radius: var(--radius-md);
  border: none;
  cursor: pointer;
  transition: all var(--duration-fast) var(--ease-default);
}
.phase-view-advance-btn:hover {
  background: #2da1d6;
  box-shadow: var(--shadow-md);
  transform: translateY(-1px);
}
.phase-view-advance-btn:active {
  transform: translateY(0);
}
.phase-view-advance-btn-text {
  white-space: nowrap;
}
.phase-view-advance-btn-arrow {
  font-size: var(--text-lg);
  transition: transform var(--duration-fast) var(--ease-default);
}
.phase-view-advance-btn:hover .phase-view-advance-btn-arrow {
  transform: translateX(3px);
}

.phase-view-advance-blocked {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: var(--sp-2);
  color: var(--text-muted);
  padding: var(--sp-3);
  background: var(--bg-tertiary);
  border-radius: var(--radius-md);
  font-size: var(--text-sm);
}
.phase-view-advance-blocked-icon {
  font-size: var(--text-lg);
  flex-shrink: 0;
}

.phase-view-final-phase {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: var(--sp-2);
  font-size: var(--text-sm);
  color: var(--text-secondary);
}

/* ═══════════════════════════════════════════════════
   EMPTY STATE
   ═══════════════════════════════════════════════════ */

.phase-view-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: var(--sp-16);
  text-align: center;
  gap: var(--sp-3);
}
.phase-view-empty-icon {
  font-size: 3rem;
  opacity: 0.4;
}
.phase-view-empty-title {
  font-size: var(--text-xl);
  font-weight: var(--font-semibold);
  color: var(--text-primary);
  margin: 0;
}
.phase-view-empty-text {
  font-size: var(--text-sm);
  color: var(--text-muted);
  max-width: 400px;
  line-height: var(--leading-normal);
  margin: 0;
}

/* ═══════════════════════════════════════════════════
   GATE SECTION
   ═══════════════════════════════════════════════════ */

.phase-view-gates-section {
  margin-bottom: var(--sp-8);
}
.phase-view-section-title {
  font-size: var(--text-lg);
  font-weight: var(--font-semibold);
  color: var(--text-primary);
  margin: 0 0 var(--sp-4) 0;
  display: flex;
  align-items: baseline;
  gap: var(--sp-2);
}
.phase-view-section-count {
  color: var(--text-muted);
  font-weight: var(--font-normal);
  font-size: var(--text-sm);
}
.phase-view-gates-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(360px, 1fr));
  gap: var(--sp-4);
}
.phase-view-gates-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: var(--sp-10);
  text-align: center;
  gap: var(--sp-2);
  color: var(--text-muted);
}
.phase-view-gates-empty-icon {
  font-size: 2rem;
  opacity: 0.4;
}
.phase-view-gates-empty-hint {
  font-size: var(--text-xs);
  color: var(--text-muted);
  max-width: 360px;
  line-height: var(--leading-normal);
  margin: 0;
}

/* ═══════════════════════════════════════════════════
   GATE CARD
   ═══════════════════════════════════════════════════ */

.phase-view-gate-card {
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-lg);
  padding: var(--sp-5);
  border-left: 3px solid var(--gate-pending);
  transition: box-shadow var(--duration-fast) var(--ease-default);
}
.phase-view-gate-card:hover {
  box-shadow: var(--shadow-md);
}
.phase-view-gate-pending {
  border-left-color: var(--gate-pending);
}
.phase-view-gate-go {
  border-left-color: var(--gate-go);
}
.phase-view-gate-no-go {
  border-left-color: var(--gate-nogo);
}
.phase-view-gate-conditional {
  border-left-color: var(--gate-conditional);
}

/* Gate header */
.phase-view-gate-header {
  display: flex;
  flex-direction: row;
  gap: var(--sp-3);
  align-items: center;
  margin-bottom: var(--sp-3);
}
.phase-view-gate-status-dot {
  width: 24px;
  height: 24px;
  border-radius: var(--radius-full);
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: var(--text-xs);
  flex-shrink: 0;
}
.phase-view-gate-title-group {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
}
.phase-view-gate-title {
  font-size: var(--text-base);
  font-weight: var(--font-semibold);
  color: var(--text-primary);
  margin: 0;
}
.phase-view-gate-type {
  font-size: var(--text-xs);
  color: var(--text-muted);
}
.phase-view-gate-status-badge {
  display: inline-block;
  padding: var(--sp-1) var(--sp-2);
  border-radius: var(--radius-full);
  font-size: var(--text-xs);
  font-weight: var(--font-bold);
  color: #fff;
  white-space: nowrap;
  flex-shrink: 0;
}

/* Gate meta row */
.phase-view-gate-meta {
  display: flex;
  flex-direction: row;
  gap: var(--sp-3);
  font-size: var(--text-xs);
  color: var(--text-muted);
  margin-bottom: var(--sp-3);
}
.phase-view-gate-id {
  font-family: var(--font-mono);
}
.phase-view-gate-time {
  color: var(--text-muted);
}

/* ═══════════════════════════════════════════════════
   GATE CRITERIA
   ═══════════════════════════════════════════════════ */

.phase-view-gate-criteria {
  margin-top: var(--sp-3);
}
.phase-view-gate-criteria-title {
  font-size: var(--text-xs);
  text-transform: uppercase;
  font-weight: var(--font-semibold);
  color: var(--text-muted);
  letter-spacing: 0.05em;
  margin: 0 0 var(--sp-2) 0;
}
.phase-view-gate-criteria-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
}
.phase-view-criterion {
  display: flex;
  flex-direction: row;
  align-items: flex-start;
  gap: var(--sp-2);
  font-size: var(--text-sm);
  color: var(--text-secondary);
}
.phase-view-criterion-met {
  color: var(--accent-green);
}
.phase-view-criterion-check {
  flex-shrink: 0;
  font-size: var(--text-sm);
}

/* ═══════════════════════════════════════════════════
   GATE SIGN-OFFS
   ═══════════════════════════════════════════════════ */

.phase-view-gate-signoffs {
  padding-top: var(--sp-3);
  border-top: 1px solid var(--border-secondary);
  margin-top: var(--sp-3);
}
.phase-view-gate-signoffs-title {
  font-size: var(--text-xs);
  text-transform: uppercase;
  font-weight: var(--font-semibold);
  color: var(--text-muted);
  letter-spacing: 0.05em;
  margin: 0 0 var(--sp-2) 0;
}
.phase-view-signoffs-list {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}
.phase-view-signoff-row {
  display: flex;
  flex-direction: row;
  gap: var(--sp-3);
  padding: var(--sp-2);
  border-radius: var(--radius-md);
  align-items: flex-start;
  transition: background var(--duration-fast) var(--ease-default);
}
.phase-view-signoff-row:hover {
  background: var(--bg-hover);
}
.phase-view-signoff-verdict-dot {
  width: 20px;
  height: 20px;
  border-radius: var(--radius-full);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: var(--text-xs);
  color: #fff;
  flex-shrink: 0;
  margin-top: 2px;
}
.phase-view-signoff-details {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
}
.phase-view-signoff-who {
  display: flex;
  flex-direction: row;
  gap: var(--sp-2);
  align-items: center;
}
.phase-view-signoff-verdict-label {
  font-size: var(--text-xs);
  font-weight: var(--font-semibold);
}
.phase-view-signoff-reason {
  font-size: var(--text-xs);
  color: var(--text-secondary);
  padding-top: var(--sp-1);
  line-height: var(--leading-normal);
}
.phase-view-signoff-time {
  font-size: var(--text-xs);
  color: var(--text-muted);
  margin-top: var(--sp-1);
}

/* ═══════════════════════════════════════════════════
   SIGN-OFF FORM (inline in gate card)
   ═══════════════════════════════════════════════════ */

.phase-view-gate-signoff-trigger {
  padding-top: var(--sp-3);
  border-top: 1px solid var(--border-secondary);
  margin-top: var(--sp-3);
}
.phase-view-signoff-open-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  padding: var(--sp-2) var(--sp-4);
  background: none;
  border: 1px dashed var(--border-primary);
  border-radius: var(--radius-md);
  color: var(--text-secondary);
  font-size: var(--text-sm);
  cursor: pointer;
  transition: all var(--duration-fast) var(--ease-default);
}
.phase-view-signoff-open-btn:hover {
  background: var(--bg-hover);
  border-color: var(--accent-blue);
  color: var(--accent-blue);
}

.phase-view-signoff-form {
  background: var(--bg-tertiary);
  border-radius: var(--radius-md);
  padding: var(--sp-4);
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
  margin-top: var(--sp-3);
}
.phase-view-signoff-form-title {
  font-size: var(--text-sm);
  font-weight: var(--font-semibold);
  color: var(--text-primary);
  margin: 0;
}

/* Form groups */
.phase-view-form-group {
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
}
.phase-view-form-label {
  font-size: var(--text-xs);
  text-transform: uppercase;
  font-weight: var(--font-semibold);
  color: var(--text-muted);
  letter-spacing: 0.05em;
}

/* Verdict selector */
.phase-view-verdict-row {
  display: flex;
  flex-direction: row;
  gap: var(--sp-2);
  flex-wrap: wrap;
}
.phase-view-verdict-option {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: var(--sp-2);
  padding: var(--sp-2) var(--sp-3);
  border-radius: var(--radius-md);
  border: 1px solid var(--border-primary);
  cursor: pointer;
  transition: all var(--duration-fast) var(--ease-default);
  background: none;
}
.phase-view-verdict-option:hover {
  background: var(--bg-hover);
}
.phase-view-verdict-selected {
  border-color: var(--border-accent);
  background: var(--bg-active);
}
.phase-view-verdict-go.phase-view-verdict-selected {
  border-color: rgba(74, 222, 128, 0.4);
  background: rgba(74, 222, 128, 0.08);
}
.phase-view-verdict-no-go.phase-view-verdict-selected {
  border-color: rgba(248, 113, 113, 0.4);
  background: rgba(248, 113, 113, 0.08);
}
.phase-view-verdict-conditional.phase-view-verdict-selected {
  border-color: rgba(251, 191, 36, 0.4);
  background: rgba(251, 191, 36, 0.08);
}
.phase-view-verdict-icon {
  font-size: var(--text-sm);
}
.phase-view-verdict-text {
  font-size: var(--text-sm);
  color: var(--text-secondary);
}

/* Textarea */
.phase-view-form-textarea {
  width: 100%;
  min-height: 80px;
  padding: var(--sp-3);
  background: var(--bg-secondary);
  border: 1px solid var(--border-primary);
  border-radius: var(--radius-md);
  color: var(--text-primary);
  font-family: var(--font-sans);
  font-size: var(--text-sm);
  line-height: var(--leading-normal);
  resize: vertical;
  outline: none;
  transition: border-color var(--duration-fast) var(--ease-default);
  box-sizing: border-box;
}
.phase-view-form-textarea::placeholder {
  color: var(--text-muted);
}
.phase-view-form-textarea:focus {
  border-color: var(--accent-blue);
}

/* Form actions */
.phase-view-form-actions {
  display: flex;
  flex-direction: row;
  gap: var(--sp-2);
  justify-content: flex-end;
}
.phase-view-form-submit {
  background: var(--accent-blue);
  color: #fff;
  font-weight: var(--font-bold);
  font-size: var(--text-sm);
  padding: var(--sp-2) var(--sp-4);
  border-radius: var(--radius-md);
  border: none;
  cursor: pointer;
  transition: all var(--duration-fast) var(--ease-default);
}
.phase-view-form-submit:hover {
  background: #2da1d6;
  box-shadow: var(--shadow-sm);
}
.phase-view-form-cancel {
  background: none;
  color: var(--text-muted);
  font-size: var(--text-sm);
  padding: var(--sp-2) var(--sp-4);
  border-radius: var(--radius-md);
  border: 1px solid var(--border-primary);
  cursor: pointer;
  transition: all var(--duration-fast) var(--ease-default);
}
.phase-view-form-cancel:hover {
  background: var(--bg-hover);
  color: var(--text-secondary);
}

/* ═══════════════════════════════════════════════════
   PHASE HISTORY (collapsible)
   ═══════════════════════════════════════════════════ */

.phase-view-history-section {
  margin-top: var(--sp-8);
  padding-top: var(--sp-6);
  border-top: 1px solid var(--border-primary);
}
.phase-view-history-toggle {
  margin-bottom: var(--sp-2);
}
.phase-view-history-toggle-btn {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: var(--sp-2);
  background: none;
  border: none;
  cursor: pointer;
  color: var(--text-secondary);
  font-weight: var(--font-semibold);
  font-size: var(--text-base);
  padding: var(--sp-2);
  border-radius: var(--radius-md);
  transition: all var(--duration-fast) var(--ease-default);
}
.phase-view-history-toggle-btn:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}
.phase-view-history-toggle-icon {
  font-size: var(--text-xs);
  transition: transform var(--duration-fast) var(--ease-default);
}
.phase-view-history-empty {
  font-size: var(--text-sm);
  color: var(--text-muted);
  padding: var(--sp-3);
}
.phase-view-history-body {
  padding-top: var(--sp-4);
  display: flex;
  flex-direction: column;
  gap: var(--sp-4);
}
.phase-view-history-phase {
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-lg);
  padding: var(--sp-4);
}
.phase-view-history-phase-header {
  display: flex;
  flex-direction: row;
  gap: var(--sp-2);
  align-items: center;
  margin-bottom: var(--sp-3);
}
.phase-view-history-phase-header h4 {
  margin: 0;
  font-size: var(--text-base);
  font-weight: var(--font-semibold);
  color: var(--text-primary);
  text-transform: capitalize;
}
.phase-view-history-phase-icon {
  color: var(--accent-green);
  font-size: var(--text-lg);
  font-weight: var(--font-bold);
}
.phase-view-history-gate-count {
  font-size: var(--text-xs);
  color: var(--text-muted);
  margin-left: auto;
}
.phase-view-history-gate-list {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}
.phase-view-history-gate-row {
  display: flex;
  flex-direction: row;
  gap: var(--sp-2);
  align-items: center;
  padding: var(--sp-2);
  font-size: var(--text-sm);
  border-radius: var(--radius-sm);
  transition: background var(--duration-fast) var(--ease-default);
}
.phase-view-history-gate-row:hover {
  background: var(--bg-hover);
}
.phase-view-history-gate-dot {
  width: 16px;
  height: 16px;
  border-radius: var(--radius-full);
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 0.625rem;
  flex-shrink: 0;
}
.phase-view-history-gate-label {
  color: var(--text-primary);
  font-weight: var(--font-medium);
  flex: 1;
  min-width: 0;
}
.phase-view-history-gate-verdict {
  font-size: var(--text-xs);
  font-weight: var(--font-semibold);
  color: var(--text-secondary);
}
.phase-view-history-gate-signoffs {
  font-size: var(--text-xs);
  color: var(--text-muted);
}
.phase-view-history-gate-time {
  font-size: var(--text-xs);
  color: var(--text-muted);
  margin-left: auto;
}
.phase-view-history-no-gates {
  font-size: var(--text-sm);
  color: var(--text-muted);
  font-style: italic;
  padding: var(--sp-2);
}

/* ═══════════════════════════════════════════════════
   RESPONSIVE — Phase View
   ═══════════════════════════════════════════════════ */

@media (max-width: 768px) {
  .phase-view {
    padding: var(--sp-4);
  }
  .phase-view-header {
    flex-direction: column;
    gap: var(--sp-2);
  }
  .phase-view-gates-grid {
    grid-template-columns: 1fr;
  }
  .phase-view-stepper-step {
    min-width: 80px;
  }
  .phase-view-step-circle {
    width: 40px;
    height: 40px;
  }
  .phase-view-step-desc {
    display: none;
  }
  .phase-view-stepper-line {
    margin-top: -20px;
  }
  .phase-view-current-card {
    padding: var(--sp-4);
  }
  .phase-view-current-icon {
    font-size: 2rem;
  }
  .phase-view-gate-card {
    padding: var(--sp-4);
  }
  .phase-view-verdict-row {
    flex-direction: column;
  }
}

@media (max-width: 480px) {
  .phase-view {
    padding: var(--sp-3);
  }
  .phase-view-header-badge {
    font-size: var(--text-xs);
    padding: var(--sp-1) var(--sp-2);
  }
  .phase-view-stepper-step {
    min-width: 64px;
  }
  .phase-view-step-circle {
    width: 36px;
    height: 36px;
  }
  .phase-view-step-icon {
    font-size: var(--text-sm);
  }
  .phase-view-step-label {
    font-size: 0.625rem;
  }
  .phase-view-stepper-line {
    margin-top: -18px;
    min-width: 12px;
  }
  .phase-view-current-card {
    padding: var(--sp-3);
  }
  .phase-view-gate-card {
    padding: var(--sp-3);
  }
  .phase-view-advance-btn {
    width: 100%;
    justify-content: center;
  }
}
    `;

    document.head.appendChild(style);
  }
}
