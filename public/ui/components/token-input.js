/**
 * Overlord v2 — Token Input Component
 *
 * Rich text input with /, @, and # token support for the chat interface.
 *
 * Token types:
 *   / — Commands (e.g., /help, /status, /deploy)
 *   @ — Agent mentions (e.g., @strategist, @architect)
 *   # — Room/topic references (e.g., #discovery-room, #raid-log)
 *
 * Features:
 *   - Autocomplete dropdown triggered by token characters
 *   - Token chips rendered inline after selection
 *   - Keyboard navigation (arrow keys, Enter, Escape)
 *   - Submit on Enter (Shift+Enter for newline)
 *   - Input history (Ctrl+Up/Down)
 */

import { Component } from '../engine/component.js';
import { h } from '../engine/helpers.js';


export class TokenInput extends Component {

  /**
   * @param {HTMLElement} el   — container element
   * @param {object}      opts
   * @param {string}      [opts.placeholder='Type a message...']
   * @param {Function}    [opts.onSubmit]        — called with (text, tokens[])
   * @param {Function}    [opts.onTokenTrigger]  — called with (type, query) to fetch suggestions
   * @param {number}      [opts.maxRows=6]       — max textarea rows before scroll
   */
  constructor(el, opts = {}) {
    super(el, {
      placeholder: 'Type a message...',
      onSubmit:       null,
      onTokenTrigger: null,
      maxRows:        6,
      ...opts
    });

    this._textareaEl    = null;
    this._autocompleteEl = null;
    this._tokens         = [];          // collected tokens [{type, id, label}]
    this._suggestions    = [];          // current autocomplete suggestions
    this._selectedIdx    = -1;          // highlighted suggestion index
    this._tokenTrigger   = null;        // active trigger { type, startPos, query }
    this._history        = [];          // input history
    this._historyIdx     = -1;
    this._currentDraft   = '';          // draft saved when navigating history

    // Token trigger characters
    this._triggerChars = { '/': 'command', '@': 'agent', '#': 'reference' };
  }

  mount() {
    this._mounted = true;
    this._render();
  }

  /** Get the current text content. */
  getText() {
    return this._textareaEl ? this._textareaEl.value : '';
  }

  /** Set the text content. */
  setText(text) {
    if (this._textareaEl) {
      this._textareaEl.value = text;
      this._autoResize();
    }
  }

  /** Get collected tokens. */
  getTokens() {
    return [...this._tokens];
  }

  /** Focus the input. */
  focus() {
    if (this._textareaEl) this._textareaEl.focus();
  }

  /** Clear the input and tokens. */
  clear() {
    this._tokens = [];
    if (this._textareaEl) {
      this._textareaEl.value = '';
      this._autoResize();
    }
    // Clear chip DOM elements (#1167)
    if (this._chipArea) {
      this._chipArea.textContent = '';
    }
    this._closeAutocomplete();
  }

  /**
   * Provide autocomplete suggestions (called by parent after onTokenTrigger).
   * @param {Array} suggestions — [{ id, label, description?, icon? }]
   */
  setSuggestions(suggestions) {
    this._suggestions = suggestions || [];
    this._selectedIdx = this._suggestions.length > 0 ? 0 : -1;
    this._renderAutocomplete();
  }

  // ── Private ──────────────────────────────────────────────────

  /** @private */
  _render() {
    this.el.textContent = '';
    this.el.className = 'token-input-container';

    // Token chips area (rendered above textarea when tokens are present)
    this._chipArea = h('div', { class: 'token-chips' });
    this.el.appendChild(this._chipArea);

    // Input wrapper
    const inputWrapper = h('div', { class: 'token-input-wrapper' });

    this._textareaEl = h('textarea', {
      class: 'token-input',
      placeholder: this.opts.placeholder,
      rows: '1',
      'aria-label': this.opts.placeholder
    });

    this._textareaEl.addEventListener('input', () => this._handleInput());
    this._textareaEl.addEventListener('keydown', (e) => this._handleKeydown(e));

    inputWrapper.appendChild(this._textareaEl);

    // Send button
    const sendBtn = h('button', {
      class: 'token-input-send',
      title: 'Send',
      'aria-label': 'Send message'
    }, '\u27A4');
    sendBtn.addEventListener('click', () => this._submit());
    inputWrapper.appendChild(sendBtn);

    this.el.appendChild(inputWrapper);

    // Autocomplete dropdown (hidden by default)
    this._autocompleteEl = h('div', { class: 'token-autocomplete', style: { display: 'none', position: 'relative', zIndex: '9999' } });
    // #1169 — prevent ALL clicks on autocomplete from bubbling to elements behind
    this._autocompleteEl.addEventListener('mousedown', (e) => e.stopPropagation());
    this._autocompleteEl.addEventListener('click', (e) => e.stopPropagation());
    this.el.appendChild(this._autocompleteEl);
  }

  /** @private Handle input events — detect token triggers. */
  _handleInput() {
    this._autoResize();

    const text = this._textareaEl.value;
    const cursorPos = this._textareaEl.selectionStart;

    // Look backward from cursor for a trigger character
    // @ mentions allow spaces (multi-word names like "Omar Kim")
    // / commands and # references break on spaces
    let triggerFound = false;
    for (let i = cursorPos - 1; i >= 0; i--) {
      const ch = text[i];

      // Stop at newline (always)
      if (ch === '\n') break;

      if (this._triggerChars[ch]) {
        // Check that trigger is at start of word (preceded by space, newline, or start of string)
        if (i === 0 || text[i - 1] === ' ' || text[i - 1] === '\n') {
          const query = text.substring(i + 1, cursorPos);
          this._tokenTrigger = {
            type: this._triggerChars[ch],
            char: ch,
            startPos: i,
            query
          };
          triggerFound = true;

          // Notify parent to fetch suggestions
          if (this.opts.onTokenTrigger) {
            this.opts.onTokenTrigger(this._tokenTrigger.type, query);
          }
          break;
        }
      }

      // For / and # triggers, stop at spaces (single-word tokens)
      // For @ mentions, allow spaces to support multi-word names (#1172)
      if (ch === ' ') {
        // Check if there's a @ trigger earlier in this "word group"
        let foundAtTrigger = false;
        for (let j = i - 1; j >= 0; j--) {
          if (text[j] === '\n') break;
          if (text[j] === '@') {
            if (j === 0 || text[j - 1] === ' ' || text[j - 1] === '\n') {
              foundAtTrigger = true;
            }
            break;
          }
          if (text[j] === '/' || text[j] === '#') break; // Different trigger — stop
        }
        if (!foundAtTrigger) break; // No @ trigger — stop at space
        // Otherwise continue scanning past the space for the @ trigger
      }
    }

    if (!triggerFound) {
      this._tokenTrigger = null;
      this._closeAutocomplete();
    }
  }

  /** @private Handle keyboard events. */
  _handleKeydown(e) {
    // Autocomplete navigation
    if (this._suggestions.length > 0 && this._autocompleteEl.style.display !== 'none') {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        this._selectedIdx = Math.min(this._selectedIdx + 1, this._suggestions.length - 1);
        this._highlightSuggestion();
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        this._selectedIdx = Math.max(this._selectedIdx - 1, 0);
        this._highlightSuggestion();
        return;
      }
      if (e.key === 'Enter' && this._selectedIdx >= 0) {
        e.preventDefault();
        this._selectSuggestion(this._suggestions[this._selectedIdx]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        this._closeAutocomplete();
        return;
      }
      if (e.key === 'Tab' && this._selectedIdx >= 0) {
        e.preventDefault();
        this._selectSuggestion(this._suggestions[this._selectedIdx]);
        return;
      }
    }

    // Submit on Enter (without Shift)
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      this._submit();
      return;
    }

    // Input history: Ctrl+Up / Ctrl+Down
    if (e.ctrlKey && e.key === 'ArrowUp' && this._history.length > 0) {
      e.preventDefault();
      if (this._historyIdx === -1) {
        this._currentDraft = this._textareaEl.value;
        this._historyIdx = this._history.length - 1;
      } else if (this._historyIdx > 0) {
        this._historyIdx--;
      }
      this._textareaEl.value = this._history[this._historyIdx];
      this._autoResize();
      return;
    }

    if (e.ctrlKey && e.key === 'ArrowDown' && this._historyIdx >= 0) {
      e.preventDefault();
      if (this._historyIdx < this._history.length - 1) {
        this._historyIdx++;
        this._textareaEl.value = this._history[this._historyIdx];
      } else {
        this._historyIdx = -1;
        this._textareaEl.value = this._currentDraft;
      }
      this._autoResize();
      return;
    }
  }

  /** @private Submit the message. */
  _submit() {
    const text = this._textareaEl.value.trim();
    if (!text && this._tokens.length === 0) return;

    // Save to history
    if (text) {
      this._history.push(text);
      if (this._history.length > 50) this._history.shift();
    }
    this._historyIdx = -1;

    if (this.opts.onSubmit) {
      this.opts.onSubmit(text, this.getTokens());
    }

    this.clear();
  }

  /** @private Select a suggestion from autocomplete. */
  _selectSuggestion(suggestion) {
    if (!suggestion || !this._tokenTrigger) return;

    const text = this._textareaEl.value;
    const before = text.substring(0, this._tokenTrigger.startPos);
    const after = text.substring(this._textareaEl.selectionStart);

    // Replace trigger+query with the selected suggestion
    this._textareaEl.value = before + this._tokenTrigger.char + suggestion.label + ' ' + after;

    // Save trigger info before clearing
    const triggerType = this._tokenTrigger.type;
    const triggerChar = this._tokenTrigger.char;

    // Record the token
    this._tokens.push({
      type: triggerType,
      id: suggestion.id,
      label: suggestion.label,
      char: triggerChar
    });

    // Render chip
    this._renderChips();

    // Close autocomplete and reset trigger
    this._tokenTrigger = null;
    this._closeAutocomplete();

    // Set cursor after inserted text
    const newPos = before.length + triggerChar.length + suggestion.label.length + 1;
    this._textareaEl.setSelectionRange(newPos, newPos);
    this._textareaEl.focus();
    this._autoResize();
  }

  /** @private Render token chips above textarea. */
  _renderChips() {
    this._chipArea.textContent = '';
    if (this._tokens.length === 0) {
      this._chipArea.style.display = 'none';
      return;
    }
    this._chipArea.style.display = '';

    for (const token of this._tokens) {
      const chip = h('span', {
        class: `token-chip token-chip-${token.type}`,
        'data-token-id': token.id
      },
        h('span', { class: 'token-chip-char' }, token.char),
        h('span', { class: 'token-chip-label' }, token.label)
      );

      const removeBtn = h('button', {
        class: 'token-chip-remove',
        'aria-label': `Remove ${token.label}`
      }, '\u2715');
      removeBtn.addEventListener('click', () => {
        this._tokens = this._tokens.filter(t => t !== token);
        this._renderChips();
      });
      chip.appendChild(removeBtn);

      this._chipArea.appendChild(chip);
    }
  }

  /** @private Render autocomplete dropdown. */
  _renderAutocomplete() {
    if (this._suggestions.length === 0) {
      this._closeAutocomplete();
      return;
    }

    this._autocompleteEl.textContent = '';
    this._autocompleteEl.style.display = '';

    for (let i = 0; i < this._suggestions.length; i++) {
      const sug = this._suggestions[i];
      const item = h('div', {
        class: `token-autocomplete-item${i === this._selectedIdx ? ' selected' : ''}`,
        'data-idx': String(i)
      });

      if (sug.icon) {
        item.appendChild(h('span', { class: 'token-ac-icon' }, sug.icon));
      }

      const textWrap = h('div', { class: 'token-ac-text' });
      textWrap.appendChild(h('span', { class: 'token-ac-label' }, sug.label));
      if (sug.description) {
        textWrap.appendChild(h('span', { class: 'token-ac-desc' }, sug.description));
      }
      item.appendChild(textWrap);

      item.addEventListener('mouseenter', () => {
        this._selectedIdx = i;
        this._highlightSuggestion();
      });
      item.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();  // #1169 — prevent click from reaching elements behind dropdown
        this._selectSuggestion(sug);
      });

      this._autocompleteEl.appendChild(item);
    }
  }

  /** @private Highlight the currently selected suggestion. */
  _highlightSuggestion() {
    if (!this._autocompleteEl) return;
    this._autocompleteEl.querySelectorAll('.token-autocomplete-item').forEach((el, i) => {
      el.classList.toggle('selected', i === this._selectedIdx);
    });
  }

  /** @private Close the autocomplete dropdown. */
  _closeAutocomplete() {
    this._suggestions = [];
    this._selectedIdx = -1;
    if (this._autocompleteEl) {
      this._autocompleteEl.style.display = 'none';
      this._autocompleteEl.textContent = '';
    }
  }

  /** @private Auto-resize textarea to fit content. */
  _autoResize() {
    if (!this._textareaEl) return;
    this._textareaEl.style.height = 'auto';
    const lineHeight = parseInt(getComputedStyle(this._textareaEl).lineHeight) || 20;
    const maxHeight = lineHeight * this.opts.maxRows;
    this._textareaEl.style.height = Math.min(this._textareaEl.scrollHeight, maxHeight) + 'px';
  }
}
