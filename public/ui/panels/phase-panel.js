/**
 * Overlord v2 — Phase Panel
 *
 * Shows phase gate status for the active building.
 * Displays gate verdicts, sign-off history, and phase advance controls.
 */

import { PanelComponent } from '../components/panel.js';
import { OverlordUI } from '../engine/engine.js';
import { h, formatTime } from '../engine/helpers.js';
import { DrillItem } from '../components/drill-item.js';
import { ProgressBar } from '../components/progress-bar.js';


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

    // Gate list
    if (this._gates.length === 0) {
      body.appendChild(h('div', { class: 'panel-empty' }, 'No phase gates yet.'));
      return;
    }

    const gateList = h('div', { class: 'phase-gate-list' });

    for (const gate of this._gates) {
      const verdictClass = gate.verdict === 'GO' ? 'gate-go' :
                          gate.verdict === 'NO_GO' ? 'gate-nogo' : 'gate-pending';

      const item = DrillItem.create('gate', gate, {
        icon: gate.verdict === 'GO' ? '\u2705' : gate.verdict === 'NO_GO' ? '\u274C' : '\u23F3',
        summary: `${gate.phase} Gate`,
        badge: (d) => ({
          text: d.verdict || 'PENDING',
          color: d.verdict === 'GO' ? 'var(--gate-go)' :
                 d.verdict === 'NO_GO' ? 'var(--gate-nogo)' : 'var(--gate-pending)'
        }),
        meta: (d) => d.created_at ? formatTime(d.created_at) : '',
        detail: [
          { label: 'Phase', key: 'phase' },
          { label: 'Verdict', key: 'verdict' },
          { label: 'Reviewer', key: 'reviewer' },
          { label: 'Created', key: 'created_at', format: 'date' }
        ]
      });

      gateList.appendChild(item);
    }

    body.appendChild(gateList);

    // Advance button (if allowed)
    if (this._canAdvance && this._canAdvance.ok && this._canAdvance.data?.canAdvance) {
      const advanceBtn = h('button', {
        class: 'btn btn-primary btn-sm phase-advance-btn',
        onClick: () => this._handleAdvance()
      }, `Advance to ${this._canAdvance.data.nextPhase || 'next phase'}`);
      body.appendChild(advanceBtn);
    }
  }

  _handleAdvance() {
    OverlordUI.dispatch('phase:advance-requested', {
      currentPhase: this._activePhase
    });
  }
}
