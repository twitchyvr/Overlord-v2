/**
 * Overlord v2 — Progress Bar Component
 *
 * Multi-segment progress bar for phase tracking, milestones,
 * and building completion visualization.
 *
 * Supports:
 *   - Single value (0-100)
 *   - Multi-segment with per-segment colors
 *   - Animated fill transitions
 *   - Label overlay (percentage or custom text)
 *   - Size variants (sm, md, lg)
 */

import { h } from '../engine/helpers.js';


export class ProgressBar {

  /**
   * Create a simple progress bar.
   *
   * @param {number}  value  — 0 to 100
   * @param {object}  [opts]
   * @param {string}  [opts.size='md']     — 'sm' | 'md' | 'lg'
   * @param {string}  [opts.color]         — CSS color for the fill (defaults to --accent-cyan)
   * @param {boolean} [opts.showLabel=false] — show percentage label
   * @param {string}  [opts.label]         — custom label text (overrides percentage)
   * @param {boolean} [opts.animated=true] — animate fill transition
   * @param {string}  [opts.className]     — additional CSS class
   * @returns {HTMLElement}
   */
  static create(value, opts = {}) {
    const {
      size      = 'md',
      color,
      showLabel = false,
      label,
      animated  = true,
      className = ''
    } = opts;

    const clamped = Math.max(0, Math.min(100, value));

    const bar = h('div', {
      class: `progress-bar progress-bar-${size} ${className}`.trim(),
      role: 'progressbar',
      'aria-valuenow': String(clamped),
      'aria-valuemin': '0',
      'aria-valuemax': '100'
    });

    const fill = h('div', {
      class: `progress-bar-fill${animated ? ' progress-animated' : ''}`,
      style: {
        width: `${clamped}%`,
        background: color || 'var(--accent-cyan)'
      }
    });

    bar.appendChild(fill);

    if (showLabel || label) {
      const labelEl = h('span', { class: 'progress-bar-label' },
        label || `${Math.round(clamped)}%`
      );
      bar.appendChild(labelEl);
    }

    return bar;
  }

  /**
   * Create a multi-segment progress bar.
   *
   * @param {Array}   segments — [{ value: number, color: string, label?: string }]
   * @param {object}  [opts]
   * @param {string}  [opts.size='md']
   * @param {boolean} [opts.animated=true]
   * @param {string}  [opts.className]
   * @returns {HTMLElement}
   */
  static createMulti(segments, opts = {}) {
    const { size = 'md', animated = true, className = '' } = opts;

    const bar = h('div', {
      class: `progress-bar progress-bar-${size} progress-bar-multi ${className}`.trim(),
      role: 'progressbar'
    });

    let total = 0;
    for (const seg of segments) {
      const clamped = Math.max(0, Math.min(100 - total, seg.value));
      total += clamped;

      const fill = h('div', {
        class: `progress-bar-segment${animated ? ' progress-animated' : ''}`,
        style: {
          width: `${clamped}%`,
          background: seg.color || 'var(--accent-cyan)'
        },
        title: seg.label || `${Math.round(clamped)}%`
      });

      bar.appendChild(fill);
    }

    bar.setAttribute('aria-valuenow', String(Math.round(total)));
    bar.setAttribute('aria-valuemin', '0');
    bar.setAttribute('aria-valuemax', '100');

    return bar;
  }

  /**
   * Update an existing progress bar's value.
   *
   * @param {HTMLElement} barEl  — the progress bar element
   * @param {number}      value  — new value (0-100)
   * @param {string}      [label] — optional new label
   */
  static update(barEl, value, label) {
    if (!barEl) return;
    const clamped = Math.max(0, Math.min(100, value));
    const fill = barEl.querySelector('.progress-bar-fill');
    if (fill) fill.style.width = `${clamped}%`;

    barEl.setAttribute('aria-valuenow', String(clamped));

    const labelEl = barEl.querySelector('.progress-bar-label');
    if (labelEl) {
      labelEl.textContent = label || `${Math.round(clamped)}%`;
    }
  }
}
