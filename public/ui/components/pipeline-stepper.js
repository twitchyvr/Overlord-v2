/**
 * Overlord v2 — Pipeline Stepper Component (#611)
 *
 * Visual 8-stage progress indicator for the Continuous Development Loop.
 * Renders as a horizontal stepper with stage icons, labels, and states.
 *
 * Usage:
 *   const stepper = new PipelineStepper(container, { stages: [...] });
 *   stepper.mount();
 *   stepper.update({ currentStage: 3, stages: [...] });
 */

import { h } from '../engine/helpers.js';

const STAGE_DEFS = [
  { id: 'code',        label: 'Code',        icon: '\u270F\uFE0F' },
  { id: 'iterate',     label: 'Iterate',     icon: '\u{1F504}' },
  { id: 'static-test', label: 'Static Test', icon: '\u{1F9EA}' },
  { id: 'deep-test',   label: 'Deep Test',   icon: '\u{1F50D}' },
  { id: 'syntax',      label: 'Syntax',      icon: '\u2728' },
  { id: 'review',      label: 'Review',      icon: '\u{1F4DD}' },
  { id: 'e2e',         label: 'E2E',         icon: '\u{1F680}' },
  { id: 'dogfood',     label: 'Dogfood',     icon: '\u{1F436}' },
];

const STATE_CONFIG = {
  'not-reached': { css: 'pipeline-stage--pending',  icon: '\u25CB', label: 'Pending' },
  'active':      { css: 'pipeline-stage--active',   icon: '\u{1F535}', label: 'Active' },
  'passed':      { css: 'pipeline-stage--passed',   icon: '\u2705', label: 'Passed' },
  'failed':      { css: 'pipeline-stage--failed',   icon: '\u274C', label: 'Failed' },
  'waiting':     { css: 'pipeline-stage--waiting',  icon: '\u{1F7E0}', label: 'Waiting' },
};

export class PipelineStepper {
  constructor(el, opts = {}) {
    this.el = el;
    this._currentStage = opts.currentStage || 0;
    this._stages = opts.stages || STAGE_DEFS.map((d, i) => ({
      ...d,
      state: i === 0 ? 'active' : 'not-reached',
      evidence: null,
      attempts: 0,
      completedAt: null,
    }));
    this._onStageClick = opts.onStageClick || null;
  }

  mount() {
    this.render();
  }

  update({ currentStage, stages }) {
    if (currentStage !== undefined) this._currentStage = currentStage;
    if (stages) this._stages = stages;
    this.render();
  }

  render() {
    this.el.textContent = '';
    this.el.className = 'pipeline-stepper';

    const stagesRow = h('div', { class: 'pipeline-stages-row' });

    for (let i = 0; i < this._stages.length; i++) {
      const stage = this._stages[i];
      const def = STAGE_DEFS[i] || { label: `Stage ${i + 1}`, icon: '\u25CB' };
      const stateConfig = STATE_CONFIG[stage.state] || STATE_CONFIG['not-reached'];

      // Connector line between stages (not before first)
      if (i > 0) {
        const isPassed = this._stages[i - 1].state === 'passed';
        const connector = h('div', {
          class: `pipeline-connector${isPassed ? ' pipeline-connector--done' : ''}`,
        });
        stagesRow.appendChild(connector);
      }

      // Stage node
      const stageEl = h('div', {
        class: `pipeline-stage ${stateConfig.css}`,
        title: `${def.label}: ${stateConfig.label}${stage.attempts > 1 ? ` (attempt ${stage.attempts})` : ''}`,
        role: 'button',
        tabindex: '0',
      });

      const iconEl = h('div', { class: 'pipeline-stage-icon' },
        stage.state === 'not-reached' ? def.icon : stateConfig.icon
      );
      stageEl.appendChild(iconEl);

      const labelEl = h('div', { class: 'pipeline-stage-label' }, def.label);
      stageEl.appendChild(labelEl);

      if (stage.attempts > 1) {
        stageEl.appendChild(h('div', { class: 'pipeline-stage-attempts' }, `#${stage.attempts}`));
      }

      if (this._onStageClick) {
        stageEl.addEventListener('click', () => this._onStageClick(i, stage));
      }

      stagesRow.appendChild(stageEl);
    }

    this.el.appendChild(stagesRow);

    // Current stage indicator
    if (this._currentStage >= 0 && this._currentStage < this._stages.length) {
      const currentDef = STAGE_DEFS[this._currentStage];
      const currentState = this._stages[this._currentStage];
      const indicator = h('div', { class: 'pipeline-current-indicator' },
        `Stage ${this._currentStage + 1}: ${currentDef?.label || '?'}`,
        currentState.attempts > 1 ? ` (Attempt ${currentState.attempts})` : '',
      );
      this.el.appendChild(indicator);
    }
  }
}

export { STAGE_DEFS, STATE_CONFIG };
