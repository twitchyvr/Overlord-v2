/**
 * Overlord v2 — Phase Panel
 *
 * Shows phase gate status for the active building.
 * Displays gate verdicts, sign-off form, and phase advance controls.
 * Wired to socket events for real-time gate updates.
 */

import { PanelComponent } from '../components/panel.js';
import { OverlordUI } from '../engine/engine.js';
import { h, formatTime } from '../engine/helpers.js';
import { DrillItem } from '../components/drill-item.js';
import { ProgressBar } from '../components/progress-bar.js';
import { Toast } from '../components/toast.js';


const PHASE_ORDER = ['strategy', 'discovery', 'architecture', 'execution', 'review', 'deploy'];

export class PhasePanel extends PanelComponent {

  constructor(el) {
    super(el, {
      id: 'panel-phase',
      label: 'Phase Gates',
      icon: '\u{1F6A7}',
      defaultVisible: true
    });
    this._gates = [];
    this._canAdvance = null;
    this._activePhase = 'strategy';
    this._buildingId = null;
    this._showSignoffForm = false;
    this._selectedGateId = null;
  }

  mount() {
    super.mount();
    const store = OverlordUI.getStore();
    if (!store) return;

    this.subscribe(store, 'phase.gates', (gates) => {
      this._gates = gates || [];
      this._renderContent();
    });

    this.subscribe(store, 'phase.canAdvance', (result) => {
      this._canAdvance = result;
      this._renderContent();
    });

    this.subscribe(store, 'building.activePhase', (phase) => {
      this._activePhase = phase || 'strategy';
      this._renderContent();
    });

    this.subscribe(store, 'building.active', (buildingId) => {
      this._buildingId = buildingId;
      if (buildingId && window.overlordSocket) {
        window.overlordSocket.fetchGates(buildingId);
        window.overlordSocket.fetchCanAdvance(buildingId);
      }
    });

    // Listen for gate signoff broadcasts to refresh
    this._listeners.push(
      OverlordUI.subscribe('phase:gate:created', () => {
        if (this._buildingId && window.overlordSocket) {
          window.overlordSocket.fetchGates(this._buildingId);
          window.overlordSocket.fetchCanAdvance(this._buildingId);
        }
      }),
      OverlordUI.subscribe('phase:gate:signed-off', () => {
        if (this._buildingId && window.overlordSocket) {
          window.overlordSocket.fetchGates(this._buildingId);
          window.overlordSocket.fetchCanAdvance(this._buildingId);
        }
      }),
      OverlordUI.subscribe('phase:advanced', () => {
        if (this._buildingId && window.overlordSocket) {
          window.overlordSocket.fetchGates(this._buildingId);
          window.overlordSocket.fetchCanAdvance(this._buildingId);
        }
      })
    );

    // If building is already active, fetch
    const activeBuildingId = store.get('building.active');
    if (activeBuildingId) {
      this._buildingId = activeBuildingId;
      if (window.overlordSocket) {
        window.overlordSocket.fetchGates(activeBuildingId);
        window.overlordSocket.fetchCanAdvance(activeBuildingId);
      }
    }

    this._renderContent();
  }

  _renderContent() {
    const body = this.$('.panel-body');
    if (!body) return;
    body.textContent = '';

    // Phase progress summary
    const phaseIdx = PHASE_ORDER.indexOf(this._activePhase);
    const progress = phaseIdx >= 0 ? Math.round(((phaseIdx + 1) / PHASE_ORDER.length) * 100) : 0;

    body.appendChild(h('div', { class: 'phase-panel-progress' },
      h('div', { class: 'phase-panel-current' },
        h('span', { class: 'phase-panel-label' }, 'Current Phase'),
        h('span', { class: `phase-badge phase-${this._activePhase}` }, this._activePhase)
      ),
      ProgressBar.create(progress, { size: 'sm', showLabel: true })
    ));

    // Phase step indicators
    const stepsRow = h('div', { class: 'phase-steps-row' });
    for (let i = 0; i < PHASE_ORDER.length; i++) {
      const phase = PHASE_ORDER[i];
      const gate = this._gates.find(g => g.phase === phase);
      const isComplete = i < phaseIdx;
      const isCurrent = i === phaseIdx;

      const stepClass = [
        'phase-step-indicator',
        isComplete ? 'step-complete' : '',
        isCurrent ? 'step-current' : '',
        gate?.signoff_verdict === 'GO' ? 'step-go' : '',
        gate?.signoff_verdict === 'NO_GO' ? 'step-nogo' : ''
      ].filter(Boolean).join(' ');

      const stepStatus = isComplete ? 'completed' : isCurrent ? 'current' : 'pending';
      const verdictSuffix = gate?.signoff_verdict ? ` (${gate.signoff_verdict})` : '';

      stepsRow.appendChild(h('div', {
        class: stepClass,
        title: phase,
        'aria-label': `${phase} phase — ${stepStatus}${verdictSuffix}`,
        'aria-current': isCurrent ? 'step' : 'false'
      },
        h('span', { class: 'step-dot' }, isComplete ? '\u2713' : isCurrent ? '\u25CF' : '\u25CB'),
        h('span', { class: 'step-name' }, phase.slice(0, 4))
      ));
    }
    body.appendChild(stepsRow);

    // Gate list
    if (this._gates.length === 0) {
      body.appendChild(h('div', { class: 'panel-empty' }, 'No phase gates yet.'));
    } else {
      const gateList = h('div', { class: 'phase-gate-list' });

      for (const gate of this._gates) {
        const item = DrillItem.create('gate', gate, {
          icon: gate.signoff_verdict === 'GO' ? '\u2705' :
                gate.signoff_verdict === 'NO_GO' ? '\u274C' :
                gate.signoff_verdict === 'CONDITIONAL' ? '\u26A0' : '\u23F3',
          summary: `${gate.phase} Gate`,
          badge: (d) => ({
            text: d.signoff_verdict || d.status || 'PENDING',
            color: d.signoff_verdict === 'GO' ? 'var(--gate-go)' :
                   d.signoff_verdict === 'NO_GO' ? 'var(--gate-nogo)' :
                   d.signoff_verdict === 'CONDITIONAL' ? 'var(--accent-amber)' :
                   'var(--gate-pending)'
          }),
          meta: (d) => {
            if (d.signoff_reviewer) return `by ${d.signoff_reviewer}`;
            if (d.created_at) return formatTime(d.created_at);
            return '';
          },
          detail: [
            { label: 'Phase', key: 'phase' },
            { label: 'Status', key: 'status' },
            { label: 'Verdict', key: 'signoff_verdict' },
            { label: 'Reviewer', key: 'signoff_reviewer' },
            { label: 'Conditions', key: 'conditions', format: 'json' },
            { label: 'Created', key: 'created_at', format: 'date' }
          ]
        });

        // Add signoff button for pending gates
        if (!gate.signoff_verdict || gate.status === 'pending') {
          const signoffBtn = h('button', {
            class: 'btn btn-ghost btn-xs gate-signoff-btn',
            title: 'Sign off on this gate'
          }, 'Sign Off');
          signoffBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this._selectedGateId = gate.id;
            this._showSignoffForm = true;
            this._renderContent();
          });
          item.appendChild(signoffBtn);
        }

        gateList.appendChild(item);
      }

      body.appendChild(gateList);
    }

    // Signoff form (shown when a gate is selected)
    if (this._showSignoffForm && this._selectedGateId) {
      body.appendChild(this._buildSignoffForm());
    }

    // Phase actions section
    const nextIdx = PHASE_ORDER.indexOf(this._activePhase) + 1;
    const nextPhase = nextIdx < PHASE_ORDER.length ? PHASE_ORDER[nextIdx] : null;
    const currentGate = this._gates.find(g => g.phase === this._activePhase);

    if (!this._showSignoffForm && nextPhase) {
      const actionsSection = h('div', { class: 'phase-advance-section' });

      if (!currentGate) {
        // No gate for current phase — show Create Gate + Quick Advance
        actionsSection.appendChild(h('div', { class: 'phase-advance-info' },
          h('span', null, `No gate for ${this._activePhase} phase.`)
        ));

        const createGateBtn = h('button', {
          class: 'btn btn-ghost btn-sm'
        }, 'Create Gate');
        createGateBtn.addEventListener('click', () => this._handleCreateGate());

        const advanceBtn = h('button', {
          class: 'btn btn-primary btn-sm phase-advance-btn'
        }, `Advance to ${nextPhase}`);
        advanceBtn.addEventListener('click', () => this._handleAdvance());

        actionsSection.appendChild(h('div', { class: 'phase-actions-row' }, createGateBtn, advanceBtn));
      } else if (currentGate.status === 'go' || currentGate.signoff_verdict === 'GO') {
        // Gate passed — show Advance button
        actionsSection.appendChild(h('div', { class: 'phase-advance-info' },
          h('span', null, 'Gate passed. Ready to advance.')
        ));

        const advanceBtn = h('button', {
          class: 'btn btn-primary btn-sm phase-advance-btn'
        }, `Advance to ${nextPhase}`);
        advanceBtn.addEventListener('click', () => this._handleAdvance());
        actionsSection.appendChild(advanceBtn);
      } else {
        // Gate exists but not signed off as GO
        actionsSection.appendChild(h('div', { class: 'phase-advance-info' },
          h('span', null, `Gate is ${currentGate.status || 'pending'}. Sign off to advance.`)
        ));
      }

      body.appendChild(actionsSection);
    }
  }

  _buildSignoffForm() {
    const gate = this._gates.find(g => g.id === this._selectedGateId);
    const form = h('div', { class: 'gate-signoff-form' },
      h('h4', null, `Sign Off: ${gate?.phase || 'Unknown'} Gate`)
    );

    // Reviewer input
    const reviewerRow = h('div', { class: 'form-row' },
      h('label', null, 'Reviewer'),
      h('input', {
        type: 'text',
        class: 'form-input',
        placeholder: 'Your name',
        id: 'gate-reviewer-input'
      })
    );
    form.appendChild(reviewerRow);

    // Verdict select
    const verdictRow = h('div', { class: 'form-row' },
      h('label', null, 'Verdict')
    );
    const verdictSelect = h('select', { class: 'form-select', id: 'gate-verdict-select' },
      h('option', { value: 'GO' }, 'GO — Approved'),
      h('option', { value: 'NO_GO' }, 'NO GO — Rejected'),
      h('option', { value: 'CONDITIONAL' }, 'CONDITIONAL — With conditions')
    );
    verdictRow.appendChild(verdictSelect);
    form.appendChild(verdictRow);

    // Conditions textarea (shown for CONDITIONAL)
    const conditionsRow = h('div', { class: 'form-row', id: 'gate-conditions-row', style: { display: 'none' } },
      h('label', null, 'Conditions (one per line)'),
      h('textarea', {
        class: 'form-textarea',
        placeholder: 'Enter conditions...',
        rows: '3',
        id: 'gate-conditions-input'
      })
    );
    form.appendChild(conditionsRow);

    // Show/hide conditions based on verdict
    verdictSelect.addEventListener('change', () => {
      const condRow = document.getElementById('gate-conditions-row');
      if (condRow) {
        condRow.style.display = verdictSelect.value === 'CONDITIONAL' ? '' : 'none';
      }
    });

    // Buttons
    const btnRow = h('div', { class: 'form-actions' });

    const submitBtn = h('button', { class: 'btn btn-primary btn-sm' }, 'Submit');
    submitBtn.addEventListener('click', () => this._submitSignoff());
    btnRow.appendChild(submitBtn);

    const cancelBtn = h('button', { class: 'btn btn-ghost btn-sm' }, 'Cancel');
    cancelBtn.addEventListener('click', () => {
      this._showSignoffForm = false;
      this._selectedGateId = null;
      this._renderContent();
    });
    btnRow.appendChild(cancelBtn);

    form.appendChild(btnRow);
    return form;
  }

  async _submitSignoff() {
    const reviewer = document.getElementById('gate-reviewer-input')?.value?.trim();
    const verdict = document.getElementById('gate-verdict-select')?.value;
    const conditionsText = document.getElementById('gate-conditions-input')?.value?.trim();

    if (!reviewer) {
      Toast.warning('Please enter a reviewer name.');
      return;
    }

    if (!this._selectedGateId) return;

    const conditions = verdict === 'CONDITIONAL' && conditionsText
      ? conditionsText.split('\n').map(c => c.trim()).filter(Boolean)
      : [];

    if (!window.overlordSocket) return;

    const result = await window.overlordSocket.signoffGate({
      gateId: this._selectedGateId,
      reviewer,
      verdict,
      conditions
    });

    if (result && result.ok) {
      Toast.success(`Gate signed off as ${verdict}`);
      this._showSignoffForm = false;
      this._selectedGateId = null;

      // Refresh gates
      if (this._buildingId) {
        window.overlordSocket.fetchGates(this._buildingId);
        window.overlordSocket.fetchCanAdvance(this._buildingId);
      }
    } else {
      Toast.error(result?.error?.message || 'Failed to sign off gate');
    }
  }

  async _handleCreateGate() {
    if (!this._buildingId || !window.overlordSocket) return;

    const result = await window.overlordSocket.createGate(this._buildingId, this._activePhase);

    if (result && result.ok) {
      Toast.success(`Gate created for ${this._activePhase} phase`);
      window.overlordSocket.fetchGates(this._buildingId);
    } else {
      Toast.error(result?.error?.message || 'Failed to create gate');
    }
  }

  async _handleAdvance() {
    if (!this._buildingId || !window.overlordSocket) return;

    const result = await window.overlordSocket.advancePhase(this._buildingId, 'user');

    if (result && result.ok) {
      Toast.success('Phase advanced successfully');
    } else {
      Toast.error(result?.error?.message || 'Failed to advance phase');
    }
  }
}
