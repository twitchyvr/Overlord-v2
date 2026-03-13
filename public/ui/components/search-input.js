/**
 * Overlord v2 — Search Input Component
 *
 * Search input with filter chip support for RAID log, activity,
 * and agent filtering. Supports type-ahead and filter chips.
 */

import { Component } from '../engine/component.js';
import { h, debounce } from '../engine/helpers.js';


export class SearchInput extends Component {

  /**
   * @param {HTMLElement} el   — container element
   * @param {object}      opts
   * @param {string}      [opts.placeholder='Search...']
   * @param {Array}       [opts.filters]     — [{ id, label, active? }] filter chip definitions
   * @param {Function}    [opts.onSearch]     — called with (query, activeFilters[])
   * @param {Function}    [opts.onChange]     — called on every keystroke with (query, activeFilters[])
   * @param {number}      [opts.debounceMs=200] — debounce delay for onChange
   * @param {string}      [opts.className]   — additional CSS class
   */
  constructor(el, opts = {}) {
    super(el, {
      placeholder: 'Search...',
      filters:     [],
      onSearch:    null,
      onChange:    null,
      debounceMs: 200,
      className:  '',
      ...opts
    });

    this._inputEl = null;
    this._chipContainer = null;
    this._query = '';
    this._activeFilters = new Set(
      (this.opts.filters || []).filter(f => f.active).map(f => f.id)
    );
  }

  mount() {
    this._mounted = true;
    this._render();
  }

  /** Get the current search query. */
  getQuery() { return this._query; }

  /** Get the set of active filter IDs. */
  getActiveFilters() { return [...this._activeFilters]; }

  /** Set the query programmatically. */
  setQuery(query) {
    this._query = query;
    if (this._inputEl) this._inputEl.value = query;
  }

  /** Clear the search input and all filters. */
  clear() {
    this._query = '';
    this._activeFilters.clear();
    this._render();
    this._emitChange();
  }

  /** Toggle a filter chip. */
  toggleFilter(filterId) {
    if (this._activeFilters.has(filterId)) {
      this._activeFilters.delete(filterId);
    } else {
      this._activeFilters.add(filterId);
    }
    this._updateChipStyles();
    this._emitChange();
  }

  // ── Private ──────────────────────────────────────────────────

  /** @private */
  _render() {
    this.el.textContent = '';
    this.el.className = `search-input-container ${this.opts.className}`.trim();

    // Search row
    const searchRow = h('div', { class: 'search-input-row' });

    const searchIcon = h('span', { class: 'search-input-icon' }, '\u{1F50D}');
    searchRow.appendChild(searchIcon);

    this._inputEl = h('input', {
      class: 'search-input',
      type: 'text',
      placeholder: this.opts.placeholder,
      'aria-label': this.opts.placeholder
    });
    this._inputEl.value = this._query;

    const debouncedChange = debounce(() => {
      this._query = this._inputEl.value;
      this._emitChange();
    }, this.opts.debounceMs);

    this._inputEl.addEventListener('input', debouncedChange);
    this._inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && this.opts.onSearch) {
        this._query = this._inputEl.value;
        this.opts.onSearch(this._query, this.getActiveFilters());
      }
      if (e.key === 'Escape') {
        this._inputEl.value = '';
        this._query = '';
        this._emitChange();
      }
    });

    searchRow.appendChild(this._inputEl);

    // Clear button
    const clearBtn = h('button', {
      class: 'search-input-clear',
      'aria-label': 'Clear search',
      title: 'Clear'
    }, '\u2715');
    clearBtn.addEventListener('click', () => this.clear());
    searchRow.appendChild(clearBtn);

    this.el.appendChild(searchRow);

    // Filter chips
    if (this.opts.filters && this.opts.filters.length > 0) {
      this._chipContainer = h('div', { class: 'search-filter-chips' });

      for (const filter of this.opts.filters) {
        const isActive = this._activeFilters.has(filter.id);
        const chip = h('button', {
          class: `filter-chip${isActive ? ' active' : ''}`,
          'data-filter-id': filter.id,
          'aria-pressed': isActive ? 'true' : 'false'
        }, filter.label);

        chip.addEventListener('click', () => this.toggleFilter(filter.id));
        this._chipContainer.appendChild(chip);
      }

      this.el.appendChild(this._chipContainer);
    }
  }

  /** @private Update chip active/inactive styles. */
  _updateChipStyles() {
    if (!this._chipContainer) return;
    this._chipContainer.querySelectorAll('.filter-chip').forEach(chip => {
      const id = chip.dataset.filterId;
      const active = this._activeFilters.has(id);
      chip.classList.toggle('active', active);
      chip.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  }

  /** @private Emit the onChange callback. */
  _emitChange() {
    if (this.opts.onChange) {
      this.opts.onChange(this._query, this.getActiveFilters());
    }
  }
}
