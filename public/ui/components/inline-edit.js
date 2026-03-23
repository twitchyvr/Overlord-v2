/**
 * Overlord v2 — Inline Edit Component (#1037)
 *
 * Reusable click-to-edit pattern for any text value.
 * Shows a pencil icon on hover, turns into an input on click,
 * auto-saves on blur or Enter, reverts on Escape.
 *
 * Usage:
 *   InlineEdit.text(element, { value, onSave, placeholder })
 *   InlineEdit.select(element, { value, options, onSave })
 */

import { h } from '../engine/helpers.js';

export class InlineEdit {

  /**
   * Make a text element click-to-edit.
   * @param {HTMLElement} el — the element to make editable
   * @param {object} opts
   * @param {string} opts.value — current value
   * @param {function} opts.onSave — called with (newValue) when saved
   * @param {string} [opts.placeholder] — placeholder text
   * @param {string} [opts.type] — 'text' | 'textarea' | 'date'
   */
  static text(el, opts) {
    const { value, onSave, placeholder = '', type = 'text' } = opts;

    // Add hover indicator
    el.style.cursor = 'pointer';
    el.style.position = 'relative';
    el.title = 'Click to edit';

    // Pencil icon on hover
    const pencil = h('span', {
      class: 'inline-edit-pencil',
      style: 'display:none; margin-left:4px; font-size:0.7rem; opacity:0.5;',
    }, '\u270F\uFE0F');
    el.appendChild(pencil);
    el.addEventListener('mouseenter', () => { pencil.style.display = 'inline'; });
    el.addEventListener('mouseleave', () => { pencil.style.display = 'none'; });

    el.addEventListener('click', (e) => {
      e.stopPropagation();
      if (el.querySelector('.inline-edit-input')) return; // already editing

      const currentText = el.childNodes[0]?.textContent || value || '';
      el.textContent = '';
      pencil.style.display = 'none';

      const input = type === 'textarea'
        ? h('textarea', {
            class: 'inline-edit-input',
            style: 'width:100%; min-height:60px; padding:4px; font:inherit; border:1px solid var(--accent-primary,#7B68EE); border-radius:4px; background:var(--surface-1); color:var(--text-primary); resize:vertical;',
          })
        : h('input', {
            class: 'inline-edit-input',
            type: type === 'date' ? 'date' : 'text',
            style: 'width:100%; padding:4px; font:inherit; border:1px solid var(--accent-primary,#7B68EE); border-radius:4px; background:var(--surface-1); color:var(--text-primary);',
            placeholder,
          });

      input.value = currentText;
      el.appendChild(input);
      input.focus();
      if (type !== 'date') input.select();

      const save = () => {
        const newValue = input.value.trim();
        el.textContent = newValue || placeholder || value;
        el.appendChild(pencil);
        if (newValue !== currentText && newValue) {
          onSave(newValue);
        }
      };

      const cancel = () => {
        el.textContent = currentText || placeholder || value;
        el.appendChild(pencil);
      };

      input.addEventListener('blur', save);
      input.addEventListener('keydown', (ke) => {
        if (ke.key === 'Enter' && type !== 'textarea') { ke.preventDefault(); input.blur(); }
        if (ke.key === 'Escape') { input.removeEventListener('blur', save); cancel(); }
      });
    });
  }

  /**
   * Make an element click-to-select from a dropdown.
   * @param {HTMLElement} el
   * @param {object} opts
   * @param {string} opts.value — current value
   * @param {string[]} opts.options — dropdown options
   * @param {function} opts.onSave — called with (newValue)
   */
  static select(el, opts) {
    const { value, options, onSave } = opts;

    el.style.cursor = 'pointer';
    el.title = 'Click to change';

    const pencil = h('span', {
      style: 'display:none; margin-left:4px; font-size:0.7rem; opacity:0.5;',
    }, '\u270F\uFE0F');
    el.appendChild(pencil);
    el.addEventListener('mouseenter', () => { pencil.style.display = 'inline'; });
    el.addEventListener('mouseleave', () => { pencil.style.display = 'none'; });

    el.addEventListener('click', (e) => {
      e.stopPropagation();
      if (el.querySelector('select')) return;

      const currentText = el.childNodes[0]?.textContent || value;
      el.textContent = '';

      const select = h('select', {
        style: 'padding:4px; font:inherit; border:1px solid var(--accent-primary,#7B68EE); border-radius:4px; background:var(--surface-1); color:var(--text-primary);',
      });
      for (const opt of options) {
        const option = h('option', { value: opt }, opt);
        if (opt === value) option.selected = true;
        select.appendChild(option);
      }

      el.appendChild(select);
      select.focus();

      const save = () => {
        const newValue = select.value;
        el.textContent = newValue;
        el.appendChild(pencil);
        if (newValue !== value) {
          onSave(newValue);
        }
      };

      select.addEventListener('change', save);
      select.addEventListener('blur', save);
      select.addEventListener('keydown', (ke) => {
        if (ke.key === 'Escape') {
          el.textContent = currentText;
          el.appendChild(pencil);
        }
      });
    });
  }
}
