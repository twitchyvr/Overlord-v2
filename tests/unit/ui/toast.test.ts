// @vitest-environment jsdom
/**
 * Tests for public/ui/components/toast.js
 *
 * Covers: Toast.show() (types, duration, closable, title, preview, link,
 *         onClick), Toast.dismiss(), Toast.dismissAll(), convenience methods
 *         (info, success, warning, error, agent), auto-dismiss, container
 *         creation, and cleanup.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const toastPath = '../../../public/ui/components/toast.js';

let Toast: any;

beforeEach(async () => {
  // Reset DOM safely — remove all children from body
  while (document.body.firstChild) {
    document.body.removeChild(document.body.firstChild);
  }
  // Reset module to get a fresh _container reference
  vi.resetModules();
  const mod = await import(toastPath);
  Toast = mod.Toast;
  // Use fake timers for auto-dismiss tests
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

// ─── Container ──────────────────────────────────────────────

describe('Toast — container', () => {
  it('creates #toast-container in document.body when first toast is shown', () => {
    expect(document.getElementById('toast-container')).toBeNull();
    Toast.show('Hello');
    const container = document.getElementById('toast-container');
    expect(container).not.toBeNull();
    expect(container!.parentNode).toBe(document.body);
  });

  it('reuses existing #toast-container if already in DOM', () => {
    const existing = document.createElement('div');
    existing.id = 'toast-container';
    document.body.appendChild(existing);

    // Re-import to pick up the existing container
    vi.resetModules();
    return import(toastPath).then((mod) => {
      const T = mod.Toast;
      T.show('Test');
      const containers = document.querySelectorAll('#toast-container');
      expect(containers.length).toBe(1);
    });
  });
});

// ─── show() — basic ────────────────────────────────────────

describe('Toast.show() — basic', () => {
  it('returns an HTMLElement', () => {
    const el = Toast.show('Test message');
    expect(el).toBeInstanceOf(HTMLElement);
  });

  it('creates a .toast element in the container', () => {
    Toast.show('Hello');
    const container = document.getElementById('toast-container');
    expect(container!.children.length).toBe(1);
    expect(container!.children[0].classList.contains('toast')).toBe(true);
  });

  it('sets role="alert" and aria-live="polite" for accessibility', () => {
    const el = Toast.show('Accessible');
    expect(el.getAttribute('role')).toBe('alert');
    expect(el.getAttribute('aria-live')).toBe('polite');
  });

  it('contains the message text', () => {
    const el = Toast.show('Important message');
    expect(el.textContent).toContain('Important message');
  });
});

// ─── show() — types ─────────────────────────────────────────

describe('Toast.show() — types', () => {
  it('defaults to toast-info type', () => {
    const el = Toast.show('Default');
    expect(el.classList.contains('toast-info')).toBe(true);
  });

  it('applies toast-success class', () => {
    const el = Toast.show('Done', { type: 'success' });
    expect(el.classList.contains('toast-success')).toBe(true);
  });

  it('applies toast-warning class', () => {
    const el = Toast.show('Careful', { type: 'warning' });
    expect(el.classList.contains('toast-warning')).toBe(true);
  });

  it('applies toast-error class', () => {
    const el = Toast.show('Failed', { type: 'error' });
    expect(el.classList.contains('toast-error')).toBe(true);
  });

  it('applies toast-agent class with agent structure', () => {
    const el = Toast.show('Agent msg', { type: 'agent' });
    expect(el.classList.contains('toast-agent')).toBe(true);
    expect(el.querySelector('.toast-agent-row')).not.toBeNull();
  });
});

// ─── show() — agent toast structure ─────────────────────────

describe('Toast.show() — agent toast', () => {
  it('renders title in .toast-agent-title', () => {
    const el = Toast.show('msg', { type: 'agent', title: 'Agent Alpha' });
    const title = el.querySelector('.toast-agent-title');
    expect(title).not.toBeNull();
    expect(title!.textContent).toBe('Agent Alpha');
  });

  it('renders message in .toast-agent-preview', () => {
    const el = Toast.show('Status update', { type: 'agent' });
    const preview = el.querySelector('.toast-agent-preview');
    expect(preview).not.toBeNull();
    expect(preview!.textContent).toBe('Status update');
  });

  it('renders preview text', () => {
    const el = Toast.show('msg', { type: 'agent', preview: 'Preview text' });
    const previews = el.querySelectorAll('.toast-agent-preview');
    // message + preview = 2 preview elements
    expect(previews.length).toBe(2);
    expect(previews[1].textContent).toBe('Preview text');
  });

  it('renders link text in .toast-agent-link', () => {
    const el = Toast.show('msg', { type: 'agent', link: 'View details' });
    const link = el.querySelector('.toast-agent-link');
    expect(link).not.toBeNull();
    expect(link!.textContent).toBe('View details');
  });
});

// ─── show() — closable ──────────────────────────────────────

describe('Toast.show() — closable', () => {
  it('adds a .toast-close button by default', () => {
    const el = Toast.show('Closable');
    const closeBtn = el.querySelector('.toast-close');
    expect(closeBtn).not.toBeNull();
    expect(closeBtn!.getAttribute('aria-label')).toBe('Dismiss');
  });

  it('does not add close button when closable is false', () => {
    const el = Toast.show('No close', { closable: false });
    expect(el.querySelector('.toast-close')).toBeNull();
  });

  it('dismisses toast when close button is clicked', () => {
    const el = Toast.show('Bye', { duration: 0 });
    const closeBtn = el.querySelector('.toast-close') as HTMLElement;

    closeBtn.click();

    // After animation delay (300ms), element should be removed
    vi.advanceTimersByTime(300);
    const container = document.getElementById('toast-container');
    expect(container!.children.length).toBe(0);
  });
});

// ─── show() — onClick ───────────────────────────────────────

describe('Toast.show() — onClick', () => {
  it('adds click handler when onClick is provided', () => {
    const handler = vi.fn();
    const el = Toast.show('Clickable', { onClick: handler, duration: 0 });

    el.click();

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(el);
  });

  it('sets cursor to pointer when onClick is provided', () => {
    const el = Toast.show('Clickable', { onClick: vi.fn() });
    expect(el.style.cursor).toBe('pointer');
  });

  it('does not set pointer cursor when no onClick', () => {
    const el = Toast.show('Normal');
    expect(el.style.cursor).not.toBe('pointer');
  });
});

// ─── show() — auto-dismiss ──────────────────────────────────

describe('Toast.show() — auto-dismiss', () => {
  it('auto-dismisses after default 4000ms', () => {
    const el = Toast.show('Temp');
    const container = document.getElementById('toast-container');

    expect(container!.contains(el)).toBe(true);

    // Advance past dismiss timer
    vi.advanceTimersByTime(4000);
    // Advance past animation
    vi.advanceTimersByTime(300);

    expect(container!.contains(el)).toBe(false);
  });

  it('auto-dismisses after custom duration', () => {
    const el = Toast.show('Quick', { duration: 1000 });
    const container = document.getElementById('toast-container');

    vi.advanceTimersByTime(999);
    expect(container!.contains(el)).toBe(true);

    vi.advanceTimersByTime(1);
    // Advance past animation
    vi.advanceTimersByTime(300);
    expect(container!.contains(el)).toBe(false);
  });

  it('does not auto-dismiss when duration is 0', () => {
    const el = Toast.show('Persistent', { duration: 0 });
    const container = document.getElementById('toast-container');

    vi.advanceTimersByTime(10000);
    expect(container!.contains(el)).toBe(true);
  });
});

// ─── dismiss() ──────────────────────────────────────────────

describe('Toast.dismiss()', () => {
  it('removes the toast after animation delay', () => {
    const el = Toast.show('Remove me', { duration: 0 });
    const container = document.getElementById('toast-container');

    Toast.dismiss(el);
    // Still present during animation
    expect(container!.contains(el)).toBe(true);

    vi.advanceTimersByTime(300);
    expect(container!.contains(el)).toBe(false);
  });

  it('sets exit animation style', () => {
    const el = Toast.show('Animate', { duration: 0 });
    Toast.dismiss(el);
    expect(el.style.animation).toContain('toast-out');
  });

  it('clears the auto-dismiss timer', () => {
    const el = Toast.show('Clear timer', { duration: 5000 });
    Toast.dismiss(el);

    vi.advanceTimersByTime(300);

    // Verify no double-removal error by advancing well past original duration
    expect(() => vi.advanceTimersByTime(5000)).not.toThrow();
  });

  it('is idempotent (second call is a no-op)', () => {
    const el = Toast.show('Once', { duration: 0 });
    Toast.dismiss(el);
    // Second call should not throw
    expect(() => Toast.dismiss(el)).not.toThrow();
  });

  it('handles null/undefined gracefully', () => {
    expect(() => Toast.dismiss(null)).not.toThrow();
    expect(() => Toast.dismiss(undefined)).not.toThrow();
  });
});

// ─── dismissAll() ───────────────────────────────────────────

describe('Toast.dismissAll()', () => {
  it('dismisses all active toasts', () => {
    Toast.show('A', { duration: 0 });
    Toast.show('B', { duration: 0 });
    Toast.show('C', { duration: 0 });

    const container = document.getElementById('toast-container');
    expect(container!.children.length).toBe(3);

    Toast.dismissAll();

    vi.advanceTimersByTime(300);
    expect(container!.children.length).toBe(0);
  });

  it('works when no toasts are active', () => {
    expect(() => Toast.dismissAll()).not.toThrow();
  });
});

// ─── Convenience methods ────────────────────────────────────

describe('Toast — convenience methods', () => {
  it('Toast.info() creates an info toast', () => {
    const el = Toast.info('Info msg');
    expect(el.classList.contains('toast-info')).toBe(true);
  });

  it('Toast.success() creates a success toast', () => {
    const el = Toast.success('Success msg');
    expect(el.classList.contains('toast-success')).toBe(true);
  });

  it('Toast.warning() creates a warning toast', () => {
    const el = Toast.warning('Warning msg');
    expect(el.classList.contains('toast-warning')).toBe(true);
  });

  it('Toast.error() creates an error toast', () => {
    const el = Toast.error('Error msg');
    expect(el.classList.contains('toast-error')).toBe(true);
  });

  it('Toast.agent() creates an agent toast', () => {
    const el = Toast.agent('Agent msg');
    expect(el.classList.contains('toast-agent')).toBe(true);
  });

  it('convenience methods pass through opts', () => {
    const el = Toast.success('Done', { duration: 0, closable: false });
    expect(el.querySelector('.toast-close')).toBeNull();
  });
});

// ─── Multiple toasts ────────────────────────────────────────

describe('Toast — multiple toasts', () => {
  it('stacks multiple toasts in the container', () => {
    Toast.show('First', { duration: 0 });
    Toast.show('Second', { duration: 0 });
    Toast.show('Third', { duration: 0 });

    const container = document.getElementById('toast-container');
    expect(container!.children.length).toBe(3);
  });

  it('each toast is independent for dismissal', () => {
    const a = Toast.show('A', { duration: 0 });
    const b = Toast.show('B', { duration: 0 });
    Toast.show('C', { duration: 0 });

    const container = document.getElementById('toast-container');
    Toast.dismiss(b);
    vi.advanceTimersByTime(300);

    expect(container!.children.length).toBe(2);
    expect(container!.contains(a)).toBe(true);
    expect(container!.contains(b)).toBe(false);
  });
});
