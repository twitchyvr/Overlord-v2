// @vitest-environment jsdom
/**
 * Tests for public/ui/components/modal.js
 *
 * Covers: Modal static class — open, close, closeAll, isOpen, count,
 *         getBody, z-index stacking, body scroll lock, escape key,
 *         click-outside, close button, duplicate suppression, callbacks
 *
 * NOTE: The modal module has module-level state (_stack and _modalRoot)
 * that persists across tests because vitest caches ES modules. We clean
 * up via Modal.closeAll() in beforeEach/afterEach but do NOT remove or
 * recreate #modal-root, since the module holds a cached reference to it.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const modalPath = '../../../public/ui/components/modal.js';

let Modal: any;

beforeEach(async () => {
  const mod = await import(modalPath);
  Modal = mod.Modal;

  // Clean up any leftover modals from prior tests.
  // IMPORTANT: Call closeAll() BEFORE touching DOM so the module-level
  // _modalRoot reference stays valid (vitest caches the module).
  Modal.closeAll();
  document.body.style.overflow = '';
});

afterEach(() => {
  // Always clean up after each test
  Modal.closeAll();
  document.body.style.overflow = '';
});

// ─── Helper: get the modal root via the returned backdrop ───

/**
 * Returns the modal root container by traversing the returned backdrop
 * element. This avoids fragility from document.getElementById when the
 * module caches its own _modalRoot reference.
 */
function getModalRoot(backdrop: HTMLElement): HTMLElement {
  return backdrop.parentNode as HTMLElement;
}

// ─── open() — DOM structure ──────────────────────────────────

describe('Modal.open() — DOM structure', () => {
  it('creates modal backdrop with correct position class', () => {
    const el = Modal.open('test-1', { content: 'hello' });
    expect(el).toBeInstanceOf(HTMLElement);
    expect(el.classList.contains('modal-backdrop')).toBe(true);
    expect(el.classList.contains('modal-pos-center')).toBe(true);
    expect(el.getAttribute('data-modal-id')).toBe('test-1');
  });

  it('creates dialog with correct size class', () => {
    const el = Modal.open('test-size', { content: 'hi', size: 'lg' });
    const dialog = el.querySelector('.modal-dialog');
    expect(dialog).not.toBeNull();
    expect(dialog.classList.contains('modal-lg')).toBe(true);
    expect(dialog.getAttribute('role')).toBe('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
  });

  it('uses default size "md" and position "center" when not specified', () => {
    const el = Modal.open('test-defaults', { content: 'defaults' });
    const dialog = el.querySelector('.modal-dialog');
    expect(dialog.classList.contains('modal-md')).toBe(true);
    expect(el.classList.contains('modal-pos-center')).toBe(true);
  });

  it('applies custom position class', () => {
    const el = Modal.open('test-drawer', { content: 'x', position: 'drawer-right' });
    expect(el.classList.contains('modal-pos-drawer-right')).toBe(true);
  });

  it('applies additional className to backdrop', () => {
    const el = Modal.open('test-class', { content: 'x', className: 'my-custom' });
    expect(el.classList.contains('my-custom')).toBe(true);
  });

  it('creates .modal-body inside dialog', () => {
    const el = Modal.open('test-body', { content: 'body text' });
    const body = el.querySelector('.modal-body');
    expect(body).not.toBeNull();
  });

  it('appends modal to a modal-root container', () => {
    const el = Modal.open('test-root', { content: 'content' });
    const root = getModalRoot(el);
    expect(root).not.toBeNull();
    expect(root.id).toBe('modal-root');
    // The root should contain exactly one child (the backdrop we just created)
    // plus any from prior tests that were cleaned up — but closeAll clears them
    expect(root.querySelector('[data-modal-id="test-root"]')).toBe(el);
  });

  it('modal-root container is appended to document.body', () => {
    const el = Modal.open('test-in-body', { content: 'content' });
    const root = getModalRoot(el);
    // Walk up to verify it's in the live DOM
    expect(document.body.contains(root)).toBe(true);
  });
});

// ─── open() — header ────────────────────────────────────────

describe('Modal.open() — header with title', () => {
  it('creates header with h3.modal-title when title is provided', () => {
    const el = Modal.open('test-title', { content: 'body', title: 'My Title' });
    const header = el.querySelector('.modal-header');
    expect(header).not.toBeNull();
    const h3 = header.querySelector('h3.modal-title');
    expect(h3).not.toBeNull();
    expect(h3.textContent).toBe('My Title');
    expect(h3.id).toBe('modal-title-test-title');
  });

  it('creates close button in header', () => {
    const el = Modal.open('test-close-btn', { content: 'body', title: 'Title' });
    const closeBtn = el.querySelector('.modal-close');
    expect(closeBtn).not.toBeNull();
    expect(closeBtn.getAttribute('aria-label')).toBe('Close');
    expect(closeBtn.textContent).toBe('\u2715');
  });

  it('sets aria-labelledby on dialog when title is provided', () => {
    const el = Modal.open('test-aria', { content: 'body', title: 'Accessible' });
    const dialog = el.querySelector('.modal-dialog');
    expect(dialog.getAttribute('aria-labelledby')).toBe('modal-title-test-aria');
  });

  it('does NOT create header when title is omitted', () => {
    const el = Modal.open('test-no-title', { content: 'body only' });
    const header = el.querySelector('.modal-header');
    expect(header).toBeNull();
  });

  it('does NOT set aria-labelledby when title is omitted', () => {
    const el = Modal.open('test-no-aria', { content: 'body only' });
    const dialog = el.querySelector('.modal-dialog');
    // h() skips attributes with undefined values
    expect(dialog.hasAttribute('aria-labelledby')).toBe(false);
  });
});

// ─── open() — content handling ──────────────────────────────

describe('Modal.open() — content handling', () => {
  it('sets string content via setTrustedContent (innerHTML)', () => {
    const el = Modal.open('test-str', { content: '<strong>bold</strong>' });
    const body = el.querySelector('.modal-body');
    const strong = body.querySelector('strong');
    expect(strong).not.toBeNull();
    expect(strong.textContent).toBe('bold');
  });

  it('appends Node content directly', () => {
    const node = document.createElement('p');
    node.textContent = 'paragraph';
    const el = Modal.open('test-node', { content: node });
    const body = el.querySelector('.modal-body');
    expect(body.querySelector('p')).toBe(node);
    expect(body.textContent).toBe('paragraph');
  });

  it('creates empty body when no content is provided', () => {
    const el = Modal.open('test-empty', {});
    const body = el.querySelector('.modal-body');
    expect(body).not.toBeNull();
    expect(body.children.length).toBe(0);
  });
});

// ─── open() — body scroll lock ──────────────────────────────

describe('Modal.open() — body scroll lock', () => {
  it('locks body scroll on first modal', () => {
    Modal.open('test-lock', { content: 'x' });
    expect(document.body.style.overflow).toBe('hidden');
  });

  it('keeps body scroll locked when second modal opens', () => {
    Modal.open('lock-a', { content: 'a' });
    Modal.open('lock-b', { content: 'b' });
    expect(document.body.style.overflow).toBe('hidden');
  });
});

// ─── close() ────────────────────────────────────────────────

describe('Modal.close()', () => {
  it('removes modal element from DOM', () => {
    const el = Modal.open('test-close', { content: 'x' });
    const root = getModalRoot(el);
    expect(root.contains(el)).toBe(true);
    Modal.close('test-close');
    expect(root.contains(el)).toBe(false);
  });

  it('modal-root has no children after last modal is closed', () => {
    const el = Modal.open('test-close-empty', { content: 'x' });
    const root = getModalRoot(el);
    Modal.close('test-close-empty');
    expect(root.children.length).toBe(0);
  });

  it('unlocks body scroll when last modal closes', () => {
    Modal.open('close-lock', { content: 'x' });
    expect(document.body.style.overflow).toBe('hidden');
    Modal.close('close-lock');
    expect(document.body.style.overflow).toBe('');
  });

  it('does NOT unlock body scroll when other modals remain', () => {
    Modal.open('remain-a', { content: 'a' });
    Modal.open('remain-b', { content: 'b' });
    Modal.close('remain-a');
    expect(document.body.style.overflow).toBe('hidden');
  });

  it('fires onClose callback', () => {
    const onClose = vi.fn();
    Modal.open('test-cb', { content: 'x', onClose });
    Modal.close('test-cb');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('handles onClose errors gracefully (no throw)', () => {
    const onClose = vi.fn(() => { throw new Error('callback error'); });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    Modal.open('test-cb-err', { content: 'x', onClose });
    expect(() => Modal.close('test-cb-err')).not.toThrow();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('is a no-op when id is not found', () => {
    expect(() => Modal.close('nonexistent')).not.toThrow();
  });
});

// ─── closeAll() ─────────────────────────────────────────────

describe('Modal.closeAll()', () => {
  it('closes all open modals', () => {
    Modal.open('all-a', { content: 'a' });
    Modal.open('all-b', { content: 'b' });
    Modal.open('all-c', { content: 'c' });
    expect(Modal.count).toBe(3);
    Modal.closeAll();
    expect(Modal.count).toBe(0);
  });

  it('removes all modal elements from DOM', () => {
    const elA = Modal.open('dom-a', { content: 'a' });
    Modal.open('dom-b', { content: 'b' });
    const root = getModalRoot(elA);
    expect(root.children.length).toBe(2);
    Modal.closeAll();
    expect(root.children.length).toBe(0);
  });

  it('unlocks body scroll after closing all', () => {
    Modal.open('scroll-a', { content: 'a' });
    Modal.open('scroll-b', { content: 'b' });
    Modal.closeAll();
    expect(document.body.style.overflow).toBe('');
  });

  it('fires onClose for each modal', () => {
    const cbA = vi.fn();
    const cbB = vi.fn();
    Modal.open('cb-a', { content: 'a', onClose: cbA });
    Modal.open('cb-b', { content: 'b', onClose: cbB });
    Modal.closeAll();
    expect(cbA).toHaveBeenCalledTimes(1);
    expect(cbB).toHaveBeenCalledTimes(1);
  });

  it('is safe to call when no modals are open', () => {
    expect(() => Modal.closeAll()).not.toThrow();
    expect(Modal.count).toBe(0);
  });
});

// ─── isOpen() ───────────────────────────────────────────────

describe('Modal.isOpen()', () => {
  it('returns true for an open modal', () => {
    Modal.open('is-open', { content: 'x' });
    expect(Modal.isOpen('is-open')).toBe(true);
  });

  it('returns false for a closed modal', () => {
    Modal.open('was-open', { content: 'x' });
    Modal.close('was-open');
    expect(Modal.isOpen('was-open')).toBe(false);
  });

  it('returns false for a never-opened id', () => {
    expect(Modal.isOpen('never-opened')).toBe(false);
  });
});

// ─── count getter ───────────────────────────────────────────

describe('Modal.count', () => {
  it('returns 0 when no modals are open', () => {
    expect(Modal.count).toBe(0);
  });

  it('increments with each open modal', () => {
    Modal.open('cnt-a', { content: 'a' });
    expect(Modal.count).toBe(1);
    Modal.open('cnt-b', { content: 'b' });
    expect(Modal.count).toBe(2);
  });

  it('decrements when a modal is closed', () => {
    Modal.open('cnt-x', { content: 'x' });
    Modal.open('cnt-y', { content: 'y' });
    Modal.close('cnt-x');
    expect(Modal.count).toBe(1);
  });
});

// ─── getBody() ──────────────────────────────────────────────

describe('Modal.getBody()', () => {
  it('returns the .modal-body element for an open modal', () => {
    Modal.open('get-body', { content: 'content here' });
    const body = Modal.getBody('get-body');
    expect(body).not.toBeNull();
    expect(body).toBeInstanceOf(HTMLElement);
    expect(body.classList.contains('modal-body')).toBe(true);
  });

  it('returns null for a non-existent modal', () => {
    expect(Modal.getBody('no-such')).toBeNull();
  });

  it('returns null after modal is closed', () => {
    Modal.open('closed-body', { content: 'x' });
    Modal.close('closed-body');
    expect(Modal.getBody('closed-body')).toBeNull();
  });
});

// ─── Duplicate open suppression ─────────────────────────────

describe('Modal.open() — duplicate suppression', () => {
  it('returns existing element when opening same id twice', () => {
    const first = Modal.open('dup', { content: 'first' });
    const second = Modal.open('dup', { content: 'second' });
    expect(second).toBe(first);
  });

  it('does not increment count on duplicate open', () => {
    Modal.open('dup-cnt', { content: 'a' });
    Modal.open('dup-cnt', { content: 'b' });
    expect(Modal.count).toBe(1);
  });

  it('does not add duplicate DOM elements', () => {
    const el = Modal.open('dup-dom', { content: 'a' });
    Modal.open('dup-dom', { content: 'b' });
    const root = getModalRoot(el);
    expect(root.children.length).toBe(1);
  });
});

// ─── Z-index stacking ──────────────────────────────────────

describe('Modal.open() — z-index stacking', () => {
  it('first modal gets z-index 1000', () => {
    const el = Modal.open('z-first', { content: 'x' });
    expect(el.style.zIndex).toBe('1000');
  });

  it('second modal gets z-index 1010', () => {
    Modal.open('z-a', { content: 'a' });
    const el = Modal.open('z-b', { content: 'b' });
    expect(el.style.zIndex).toBe('1010');
  });

  it('third modal gets z-index 1020', () => {
    Modal.open('z-1', { content: '1' });
    Modal.open('z-2', { content: '2' });
    const el = Modal.open('z-3', { content: '3' });
    expect(el.style.zIndex).toBe('1020');
  });
});

// ─── Click-outside (closeOnBackdrop) ────────────────────────

describe('Modal.open() — closeOnBackdrop', () => {
  it('closes modal when clicking on the backdrop (default: closeOnBackdrop=true)', () => {
    const backdrop = Modal.open('click-outside', { content: 'x' });

    // Simulate mousedown directly on the backdrop element (not on dialog)
    const event = new MouseEvent('mousedown', { bubbles: true });
    Object.defineProperty(event, 'target', { value: backdrop });
    backdrop.dispatchEvent(event);

    expect(Modal.isOpen('click-outside')).toBe(false);
  });

  it('does NOT close when clicking on the dialog (inside the modal)', () => {
    const backdrop = Modal.open('click-inside', { content: 'x' });
    const dialog = backdrop.querySelector('.modal-dialog');

    const event = new MouseEvent('mousedown', { bubbles: true });
    Object.defineProperty(event, 'target', { value: dialog });
    backdrop.dispatchEvent(event);

    expect(Modal.isOpen('click-inside')).toBe(true);
  });

  it('does NOT close when closeOnBackdrop=false', () => {
    const backdrop = Modal.open('no-backdrop-close', {
      content: 'x',
      closeOnBackdrop: false
    });

    const event = new MouseEvent('mousedown', { bubbles: true });
    Object.defineProperty(event, 'target', { value: backdrop });
    backdrop.dispatchEvent(event);

    expect(Modal.isOpen('no-backdrop-close')).toBe(true);
  });
});

// ─── Close button in header ─────────────────────────────────

describe('Modal — close button in header', () => {
  it('clicking header close button closes the modal', () => {
    const backdrop = Modal.open('btn-close', { content: 'x', title: 'Closable' });
    const closeBtn = backdrop.querySelector('.modal-close') as HTMLElement;

    expect(closeBtn).not.toBeNull();
    closeBtn.click();

    expect(Modal.isOpen('btn-close')).toBe(false);
    expect(Modal.count).toBe(0);
  });
});

// ─── Escape key handling ────────────────────────────────────

describe('Modal — escape key handling', () => {
  it('escape closes the topmost modal (default: closeOnEscape=true)', () => {
    Modal.open('esc-a', { content: 'a' });
    Modal.open('esc-b', { content: 'b' });

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

    // Only the topmost modal (esc-b) should close
    expect(Modal.isOpen('esc-b')).toBe(false);
    expect(Modal.isOpen('esc-a')).toBe(true);
    expect(Modal.count).toBe(1);
  });

  it('does NOT close when closeOnEscape=false', () => {
    Modal.open('no-esc', { content: 'x', closeOnEscape: false });

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

    expect(Modal.isOpen('no-esc')).toBe(true);
  });

  it('removes escape handler after modal closes', () => {
    const removeListenerSpy = vi.spyOn(document, 'removeEventListener');
    Modal.open('esc-cleanup', { content: 'x' });
    Modal.close('esc-cleanup');

    // removeEventListener should have been called with 'keydown'
    const keydownCalls = removeListenerSpy.mock.calls.filter(
      (call) => call[0] === 'keydown'
    );
    expect(keydownCalls.length).toBeGreaterThanOrEqual(1);
    removeListenerSpy.mockRestore();
  });

  it('escape only affects topmost modal, not lower ones', () => {
    Modal.open('lower', { content: 'lower' });
    Modal.open('upper', { content: 'upper' });

    // First escape closes the top
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(Modal.isOpen('upper')).toBe(false);
    expect(Modal.isOpen('lower')).toBe(true);

    // Second escape closes the remaining
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(Modal.isOpen('lower')).toBe(false);
    expect(Modal.count).toBe(0);
  });
});

// ─── onOpen callback ────────────────────────────────────────

describe('Modal.open() — onOpen callback', () => {
  it('fires onOpen with backdrop and dialog after requestAnimationFrame', async () => {
    const onOpen = vi.fn();
    const el = Modal.open('on-open', { content: 'x', title: 'Test', onOpen });

    // onOpen is called inside requestAnimationFrame, so it hasn't fired yet
    expect(onOpen).not.toHaveBeenCalled();

    // Flush the rAF queue
    await new Promise((resolve) => {
      requestAnimationFrame(() => resolve(undefined));
    });

    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenCalledWith(el, el.querySelector('.modal-dialog'));
  });
});
