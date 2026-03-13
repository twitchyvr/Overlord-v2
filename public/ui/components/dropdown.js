/**
 * Overlord v2 — Dropdown Component
 *
 * Self-positioning dropdown with click-outside-close and optional
 * search filtering. Renders at document.body level (never trapped
 * by ancestor backdrop-filter stacking contexts).
 *
 * Ported from v1 dropdown.js with v2 import paths.
 */

import { Component } from '../engine/component.js';
import { h, throttle } from '../engine/helpers.js';


export class Dropdown extends Component {

  /**
   * @param {HTMLElement} triggerEl  — the element that opens the dropdown
   * @param {object}      opts
   * @param {Array}   opts.items      — [{ id, label, icon?, divider?, disabled?, danger? }]
   * @param {Function} [opts.onSelect] — called with (item) on selection
   * @param {boolean}  [opts.searchable=false] — show search input
   * @param {string}   [opts.position='auto'] — 'below' | 'above' | 'auto'
   * @param {string}   [opts.className]        — additional CSS class
   * @param {number}   [opts.maxHeight=300]     — max dropdown height in px
   */
  constructor(triggerEl, opts = {}) {
    super(triggerEl, {
      items:      [],
      onSelect:   null,
      searchable: false,
      position:   'auto',
      className:  '',
      maxHeight:  300,
      ...opts
    });

    this._menuEl    = null;  // the dropdown menu (appended to body)
    this._isOpen    = false;
    this._searchVal = '';
    this._outsideClickHandler = null;
    this._resizeHandler = null;
    this._keydownHandler = null;
    this._highlightedIdx = -1;
  }

  mount() {
    this._mounted = true;
    const triggerClickHandler = (e) => {
      e.stopPropagation();
      this.toggle();
    };
    this.el.addEventListener('click', triggerClickHandler);
    this._listeners.push(() => this.el.removeEventListener('click', triggerClickHandler));
  }

  destroy() {
    this.close();
    super.destroy();
  }

  // ── Public API ───────────────────────────────────────────────

  /** Open the dropdown. */
  open() {
    if (this._isOpen) return;
    this._isOpen = true;
    this._highlightedIdx = -1;
    this._buildMenu();
    this._position();
    this._attachOutsideClick();
    this._attachResize();
    this._attachKeyboard();
  }

  /** Close the dropdown. */
  close() {
    if (!this._isOpen) return;
    this._isOpen = false;
    if (this._menuEl && this._menuEl.parentNode) {
      this._menuEl.parentNode.removeChild(this._menuEl);
    }
    this._menuEl = null;
    this._highlightedIdx = -1;
    this._detachOutsideClick();
    this._detachResize();
    this._detachKeyboard();
    this.el.focus();
  }

  /** Toggle open/close. */
  toggle() {
    if (this._isOpen) this.close();
    else this.open();
  }

  /** Whether the dropdown is open. */
  get isOpen() { return this._isOpen; }

  /**
   * Update the items list dynamically.
   * @param {Array} items
   */
  setItems(items) {
    this.opts.items = items;
    if (this._isOpen) {
      this.close();
      this.open();
    }
  }

  // ── Private ──────────────────────────────────────────────────

  /** @private Build the dropdown menu DOM and append to body. */
  _buildMenu() {
    const menu = h('div', {
      class: `dropdown-menu ${this.opts.className}`.trim(),
      style: {
        position: 'fixed',
        zIndex: '9999',
        maxHeight: this.opts.maxHeight + 'px',
        overflowY: 'auto'
      }
    });

    // Search input (optional)
    if (this.opts.searchable) {
      const searchInput = h('input', {
        class: 'dropdown-search',
        type: 'text',
        placeholder: 'Search...',
      });
      searchInput.addEventListener('input', () => {
        this._searchVal = searchInput.value.toLowerCase();
        this._filterItems();
      });
      menu.appendChild(searchInput);

      // Focus search on open
      requestAnimationFrame(() => searchInput.focus());
    }

    // Items container
    const list = h('div', { class: 'dropdown-list' });

    for (const item of this.opts.items) {
      if (item.divider) {
        list.appendChild(h('div', { class: 'dropdown-divider' }));
        continue;
      }

      const el = h('div', {
        class: `dropdown-item${item.disabled ? ' disabled' : ''}${item.danger ? ' danger' : ''}`,
        'data-dropdown-id': item.id,
        'data-search-text': (item.label || '').toLowerCase()
      });

      if (item.icon) {
        el.appendChild(h('span', { class: 'dropdown-icon' }, item.icon));
      }
      el.appendChild(h('span', { class: 'dropdown-label' }, item.label));

      if (!item.disabled) {
        el.addEventListener('click', (e) => {
          e.stopPropagation();
          this.close();
          if (this.opts.onSelect) this.opts.onSelect(item);
        });
      }

      list.appendChild(el);
    }

    menu.appendChild(list);
    this._menuEl = menu;
    document.body.appendChild(menu);
  }

  /** @private Position the menu relative to the trigger. */
  _position() {
    if (!this._menuEl) return;
    const triggerRect = this.el.getBoundingClientRect();
    const menuRect = this._menuEl.getBoundingClientRect();

    let top, left;

    // Horizontal: align left edge with trigger, but don't overflow right
    left = triggerRect.left;
    if (left + menuRect.width > window.innerWidth - 8) {
      left = window.innerWidth - menuRect.width - 8;
    }
    left = Math.max(8, left);

    // Vertical: auto-position above or below
    const spaceBelow = window.innerHeight - triggerRect.bottom;
    const spaceAbove = triggerRect.top;
    const preferBelow = this.opts.position === 'below' ||
      (this.opts.position === 'auto' && spaceBelow >= menuRect.height) ||
      (this.opts.position === 'auto' && spaceBelow >= spaceAbove);

    if (preferBelow) {
      top = triggerRect.bottom + 4;
      // Clamp if overflows bottom
      if (top + menuRect.height > window.innerHeight - 8) {
        this._menuEl.style.maxHeight = (window.innerHeight - top - 8) + 'px';
      }
    } else {
      top = triggerRect.top - menuRect.height - 4;
      if (top < 8) {
        top = 8;
        this._menuEl.style.maxHeight = (triggerRect.top - 12) + 'px';
      }
    }

    this._menuEl.style.top = top + 'px';
    this._menuEl.style.left = left + 'px';
    this._menuEl.style.minWidth = Math.max(160, triggerRect.width) + 'px';
  }

  /** @private Filter visible items by search text. */
  _filterItems() {
    if (!this._menuEl) return;
    const items = this._menuEl.querySelectorAll('.dropdown-item');
    items.forEach(el => {
      const text = el.dataset.searchText || '';
      el.style.display = text.includes(this._searchVal) ? '' : 'none';
    });
  }

  /** @private Attach click-outside handler. */
  _attachOutsideClick() {
    this._outsideClickHandler = (e) => {
      if (this._menuEl && !this._menuEl.contains(e.target) && !this.el.contains(e.target)) {
        this.close();
      }
    };
    // Defer to avoid immediately closing from the trigger click.
    // Guard against close() being called before rAF fires.
    requestAnimationFrame(() => {
      if (this._isOpen && this._outsideClickHandler) {
        document.addEventListener('mousedown', this._outsideClickHandler);
      }
    });
  }

  /** @private Detach click-outside handler. */
  _detachOutsideClick() {
    if (this._outsideClickHandler) {
      document.removeEventListener('mousedown', this._outsideClickHandler);
      this._outsideClickHandler = null;
    }
  }

  /** @private Attach resize/scroll handler to reposition. */
  _attachResize() {
    this._resizeHandler = throttle(() => {
      if (this._isOpen) this._position();
    }, 100);
    window.addEventListener('resize', this._resizeHandler);
    window.addEventListener('scroll', this._resizeHandler, true);
  }

  /** @private Detach resize/scroll handler. */
  _detachResize() {
    if (this._resizeHandler) {
      window.removeEventListener('resize', this._resizeHandler);
      window.removeEventListener('scroll', this._resizeHandler, true);
      this._resizeHandler = null;
    }
  }

  /** @private Attach keyboard navigation handler. */
  _attachKeyboard() {
    this._keydownHandler = (e) => {
      if (!this._isOpen || !this._menuEl) return;

      const items = this._getSelectableItems();
      if (!items.length) return;

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          this._moveHighlight(items, 1);
          break;
        case 'ArrowUp':
          e.preventDefault();
          this._moveHighlight(items, -1);
          break;
        case 'Enter':
        case ' ':
          e.preventDefault();
          if (this._highlightedIdx >= 0 && this._highlightedIdx < items.length) {
            items[this._highlightedIdx].click();
          }
          break;
        case 'Escape':
          e.preventDefault();
          this.close();
          break;
      }
    };
    document.addEventListener('keydown', this._keydownHandler);
  }

  /** @private Detach keyboard handler. */
  _detachKeyboard() {
    if (this._keydownHandler) {
      document.removeEventListener('keydown', this._keydownHandler);
      this._keydownHandler = null;
    }
  }

  /** @private Get all selectable (non-disabled, non-divider, visible) items. */
  _getSelectableItems() {
    if (!this._menuEl) return [];
    return Array.from(
      this._menuEl.querySelectorAll('.dropdown-item:not(.disabled)')
    ).filter(el => el.style.display !== 'none');
  }

  /** @private Move highlight by delta (+1 or -1), wrapping at boundaries. */
  _moveHighlight(items, delta) {
    // Remove old highlight
    if (this._highlightedIdx >= 0 && this._highlightedIdx < items.length) {
      items[this._highlightedIdx].classList.remove('highlighted');
    }

    if (this._highlightedIdx < 0) {
      // No current highlight — start at first (ArrowDown) or last (ArrowUp)
      this._highlightedIdx = delta > 0 ? 0 : items.length - 1;
    } else {
      this._highlightedIdx += delta;
      // Wrap around
      if (this._highlightedIdx >= items.length) this._highlightedIdx = 0;
      if (this._highlightedIdx < 0) this._highlightedIdx = items.length - 1;
    }

    // Apply new highlight
    items[this._highlightedIdx].classList.add('highlighted');
    items[this._highlightedIdx].scrollIntoView?.({ block: 'nearest' });
  }
}
