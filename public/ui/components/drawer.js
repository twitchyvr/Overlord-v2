/**
 * Overlord v2 — Drawer Component
 *
 * A contextual right-side flyout for entity detail views.
 * Replaces the stacked panel system with an on-demand slide-in drawer.
 *
 * Patterns:
 *   - Slides in from the right edge of the screen
 *   - Backdrop overlay with click-to-close
 *   - Animated open/close with CSS transitions
 *   - Keyboard accessible (Escape to close, focus trap)
 *   - Stacks: opening a new drawer replaces the current one
 *   - Responsive: full-screen on mobile, side-panel on desktop
 *
 * Usage:
 *   Drawer.open('agent-detail', {
 *     title: 'Agent: Claude',
 *     width: '420px',
 *     content: domNode,
 *     onClose: () => { ... }
 *   });
 *
 *   Drawer.close();
 */

import { h } from '../engine/helpers.js';

let _activeDrawer = null;
let _backdropEl = null;
let _drawerEl = null;
let _previousFocus = null;

/**
 * Open a drawer with the given content.
 *
 * @param {string} id — unique drawer identifier (for dedup)
 * @param {object} opts
 * @param {string}      opts.title     — drawer header title
 * @param {HTMLElement}  opts.content   — DOM content to display
 * @param {string}      [opts.width='420px'] — drawer width (desktop)
 * @param {Function}    [opts.onClose]  — callback when drawer closes
 */
function open(id, opts = {}) {
  // If same drawer is already open, just update content
  if (_activeDrawer === id && _drawerEl) {
    _updateContent(opts);
    return;
  }

  // Close existing drawer first (no animation, instant swap)
  if (_activeDrawer) {
    _destroyImmediate();
  }

  _activeDrawer = id;
  _previousFocus = document.activeElement;

  const width = opts.width || '420px';

  // ── Backdrop ──
  _backdropEl = h('div', { class: 'drawer-backdrop' });
  _backdropEl.addEventListener('click', close);

  // ── Drawer container ──
  _drawerEl = h('div', {
    class: 'drawer',
    style: { width },
    role: 'dialog',
    'aria-modal': 'true',
    'aria-label': opts.title || 'Detail'
  });

  // ── Header ──
  const header = h('div', { class: 'drawer-header' });

  const titleEl = h('h2', { class: 'drawer-title' }, opts.title || '');
  header.appendChild(titleEl);

  const closeBtn = h('button', {
    class: 'drawer-close-btn',
    'aria-label': 'Close drawer',
    title: 'Close'
  }, '\u2715');
  closeBtn.addEventListener('click', close);
  header.appendChild(closeBtn);

  _drawerEl.appendChild(header);

  // ── Body ──
  const body = h('div', { class: 'drawer-body' });
  if (opts.content) {
    body.appendChild(opts.content);
  }
  _drawerEl.appendChild(body);

  // ── Mount ──
  const root = document.getElementById('drawer-root') || document.getElementById('modal-root') || document.body;
  root.appendChild(_backdropEl);
  root.appendChild(_drawerEl);

  // Store onClose callback
  _drawerEl._onClose = opts.onClose || null;

  // ── Animate in ──
  requestAnimationFrame(() => {
    _backdropEl.classList.add('open');
    _drawerEl.classList.add('open');
  });

  // ── Keyboard ──
  document.addEventListener('keydown', _handleKeydown);

  // Focus the close button
  requestAnimationFrame(() => {
    closeBtn.focus();
  });
}

/**
 * Close the currently open drawer with animation.
 */
function close() {
  if (!_drawerEl || !_backdropEl) return;

  const onClose = _drawerEl._onClose;

  _backdropEl.classList.remove('open');
  _drawerEl.classList.remove('open');

  // Wait for CSS transition to complete
  const drawer = _drawerEl;
  const backdrop = _backdropEl;

  const cleanup = () => {
    drawer.removeEventListener('transitionend', cleanup);
    backdrop.remove();
    drawer.remove();
    _activeDrawer = null;
    _drawerEl = null;
    _backdropEl = null;

    // Restore previous focus
    if (_previousFocus && typeof _previousFocus.focus === 'function') {
      _previousFocus.focus();
    }
    _previousFocus = null;

    document.removeEventListener('keydown', _handleKeydown);

    if (typeof onClose === 'function') onClose();
  };

  drawer.addEventListener('transitionend', cleanup, { once: true });

  // Fallback if transitionend doesn't fire
  setTimeout(cleanup, 400);
}

/**
 * Check if any drawer is currently open.
 * @returns {boolean}
 */
function isOpen() {
  return _activeDrawer !== null;
}

/**
 * Get the ID of the currently open drawer.
 * @returns {string|null}
 */
function getActiveId() {
  return _activeDrawer;
}

/**
 * Update the body content of the currently open drawer.
 * @param {HTMLElement} content — new DOM content
 */
function updateBody(content) {
  if (!_drawerEl) return;
  const body = _drawerEl.querySelector('.drawer-body');
  if (body) {
    body.textContent = '';
    if (content) body.appendChild(content);
  }
}

/**
 * Update the title of the currently open drawer.
 * @param {string} title
 */
function updateTitle(title) {
  if (!_drawerEl) return;
  const titleEl = _drawerEl.querySelector('.drawer-title');
  if (titleEl) titleEl.textContent = title || '';
}

// ── Private ──

function _updateContent(opts) {
  if (opts.title) updateTitle(opts.title);
  if (opts.content) updateBody(opts.content);
}

function _destroyImmediate() {
  if (_backdropEl) _backdropEl.remove();
  if (_drawerEl) _drawerEl.remove();
  _activeDrawer = null;
  _drawerEl = null;
  _backdropEl = null;
  document.removeEventListener('keydown', _handleKeydown);
}

function _handleKeydown(e) {
  if (e.key === 'Escape') {
    e.preventDefault();
    close();
  }

  // Basic focus trap: Tab within drawer
  if (e.key === 'Tab' && _drawerEl) {
    const focusable = _drawerEl.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    if (focusable.length === 0) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }
}

export const Drawer = { open, close, isOpen, getActiveId, updateBody, updateTitle };
