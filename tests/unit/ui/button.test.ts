// @vitest-environment jsdom
/**
 * Tests for public/ui/components/button.js
 *
 * Covers: Button.create() (variants, sizes, icons, loading, disabled, onClick,
 *         className, dataset), Button.setLoading(), Button.group()
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const buttonPath = '../../../public/ui/components/button.js';

let Button: any;

beforeEach(async () => {
  const mod = await import(buttonPath);
  Button = mod.Button;
});

// ─── create() — basic ───────────────────────────────────────

describe('Button.create() — basic', () => {
  it('returns a button element', () => {
    const btn = Button.create('Click me');
    expect(btn).toBeInstanceOf(HTMLButtonElement);
  });

  it('has default type="button"', () => {
    const btn = Button.create('OK');
    expect(btn.getAttribute('type')).toBe('button');
  });

  it('contains a .btn-label span with the label text', () => {
    const btn = Button.create('Save');
    const label = btn.querySelector('.btn-label');
    expect(label).not.toBeNull();
    expect(label!.textContent).toBe('Save');
  });

  it('applies default variant (secondary) and size (md) classes', () => {
    const btn = Button.create('Default');
    expect(btn.classList.contains('btn')).toBe(true);
    expect(btn.classList.contains('btn-secondary')).toBe(true);
    expect(btn.classList.contains('btn-md')).toBe(true);
  });
});

// ─── create() — variant & size ──────────────────────────────

describe('Button.create() — variant and size', () => {
  it('applies the specified variant class', () => {
    const btn = Button.create('Go', { variant: 'primary' });
    expect(btn.classList.contains('btn-primary')).toBe(true);
    expect(btn.classList.contains('btn-secondary')).toBe(false);
  });

  it('applies the specified size class', () => {
    const btn = Button.create('Big', { size: 'lg' });
    expect(btn.classList.contains('btn-lg')).toBe(true);
    expect(btn.classList.contains('btn-md')).toBe(false);
  });

  it('supports danger variant', () => {
    const btn = Button.create('Delete', { variant: 'danger' });
    expect(btn.classList.contains('btn-danger')).toBe(true);
  });

  it('supports electric variant', () => {
    const btn = Button.create('Boost', { variant: 'electric' });
    expect(btn.classList.contains('btn-electric')).toBe(true);
  });

  it('supports ghost variant', () => {
    const btn = Button.create('Ghost', { variant: 'ghost' });
    expect(btn.classList.contains('btn-ghost')).toBe(true);
  });

  it('supports sm size', () => {
    const btn = Button.create('Small', { size: 'sm' });
    expect(btn.classList.contains('btn-sm')).toBe(true);
  });
});

// ─── create() — icon ────────────────────────────────────────

describe('Button.create() — icon', () => {
  it('adds a .btn-icon span before the label when icon is provided', () => {
    const btn = Button.create('Save', { icon: '💾' });
    const children = [...btn.children];
    const iconSpan = children.find((c: Element) => c.classList.contains('btn-icon'));
    const labelSpan = children.find((c: Element) => c.classList.contains('btn-label'));

    expect(iconSpan).not.toBeNull();
    expect(iconSpan!.textContent).toBe('💾');

    // Icon must appear before label
    const iconIdx = children.indexOf(iconSpan!);
    const labelIdx = children.indexOf(labelSpan!);
    expect(iconIdx).toBeLessThan(labelIdx);
  });

  it('does not add icon span when icon is not provided', () => {
    const btn = Button.create('Plain');
    const iconSpan = btn.querySelector('.btn-icon');
    expect(iconSpan).toBeNull();
  });
});

// ─── create() — iconAfter ───────────────────────────────────

describe('Button.create() — iconAfter', () => {
  it('adds a .btn-icon.btn-icon-after span after the label', () => {
    const btn = Button.create('Next', { iconAfter: '→' });
    const afterSpan = btn.querySelector('.btn-icon-after');
    expect(afterSpan).not.toBeNull();
    expect(afterSpan!.textContent).toBe('→');
    expect(afterSpan!.classList.contains('btn-icon')).toBe(true);
  });

  it('places iconAfter after the label', () => {
    const btn = Button.create('Next', { iconAfter: '→' });
    const children = [...btn.children];
    const labelSpan = children.find((c: Element) => c.classList.contains('btn-label'));
    const afterSpan = children.find((c: Element) => c.classList.contains('btn-icon-after'));

    const labelIdx = children.indexOf(labelSpan!);
    const afterIdx = children.indexOf(afterSpan!);
    expect(afterIdx).toBeGreaterThan(labelIdx);
  });

  it('supports both icon and iconAfter simultaneously', () => {
    const btn = Button.create('Middle', { icon: '←', iconAfter: '→' });
    const children = [...btn.children];
    const icons = children.filter((c: Element) => c.classList.contains('btn-icon'));
    expect(icons.length).toBe(2);

    const afterSpan = btn.querySelector('.btn-icon-after');
    expect(afterSpan).not.toBeNull();
  });
});

// ─── create() — loading ─────────────────────────────────────

describe('Button.create() — loading', () => {
  it('adds btn-loading class when loading is true', () => {
    const btn = Button.create('Wait', { loading: true });
    expect(btn.classList.contains('btn-loading')).toBe(true);
  });

  it('adds a .btn-spinner span when loading is true', () => {
    const btn = Button.create('Wait', { loading: true });
    const spinner = btn.querySelector('.btn-spinner');
    expect(spinner).not.toBeNull();
  });

  it('disables the button when loading is true', () => {
    const btn = Button.create('Wait', { loading: true });
    expect(btn.disabled).toBe(true);
  });

  it('places spinner before the label', () => {
    const btn = Button.create('Wait', { loading: true });
    const children = [...btn.children];
    const spinner = children.find((c: Element) => c.classList.contains('btn-spinner'));
    const label = children.find((c: Element) => c.classList.contains('btn-label'));

    const spinnerIdx = children.indexOf(spinner!);
    const labelIdx = children.indexOf(label!);
    expect(spinnerIdx).toBeLessThan(labelIdx);
  });

  it('does not add spinner when loading is false', () => {
    const btn = Button.create('Go', { loading: false });
    expect(btn.querySelector('.btn-spinner')).toBeNull();
    expect(btn.classList.contains('btn-loading')).toBe(false);
  });
});

// ─── create() — disabled ────────────────────────────────────

describe('Button.create() — disabled', () => {
  it('sets disabled attribute when disabled is true', () => {
    const btn = Button.create('Nope', { disabled: true });
    expect(btn.disabled).toBe(true);
  });

  it('is not disabled by default', () => {
    const btn = Button.create('OK');
    expect(btn.disabled).toBe(false);
  });
});

// ─── create() — onClick ─────────────────────────────────────

describe('Button.create() — onClick', () => {
  it('wires click handler from opts.onClick', () => {
    const handler = vi.fn();
    const btn = Button.create('Click', { onClick: handler });
    btn.click();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('does not throw when onClick is not provided', () => {
    const btn = Button.create('Plain');
    expect(() => btn.click()).not.toThrow();
  });

  it('passes the click event to the handler', () => {
    const handler = vi.fn();
    const btn = Button.create('Click', { onClick: handler });
    btn.click();
    expect(handler.mock.calls[0][0]).toBeInstanceOf(Event);
  });
});

// ─── create() — className ───────────────────────────────────

describe('Button.create() — className', () => {
  it('adds custom className alongside default classes', () => {
    const btn = Button.create('Styled', { className: 'my-custom' });
    expect(btn.classList.contains('my-custom')).toBe(true);
    expect(btn.classList.contains('btn')).toBe(true);
    expect(btn.classList.contains('btn-secondary')).toBe(true);
  });
});

// ─── create() — dataset ─────────────────────────────────────

describe('Button.create() — dataset', () => {
  it('applies data-* attributes from opts.dataset', () => {
    const btn = Button.create('Data', { dataset: { action: 'submit', id: '42' } });
    expect(btn.dataset.action).toBe('submit');
    expect(btn.dataset.id).toBe('42');
  });

  it('has no custom data attributes when dataset is not provided', () => {
    const btn = Button.create('Clean');
    expect(Object.keys(btn.dataset).length).toBe(0);
  });
});

// ─── create() — title ───────────────────────────────────────

describe('Button.create() — title', () => {
  it('sets title attribute when provided', () => {
    const btn = Button.create('Hover', { title: 'Tooltip text' });
    expect(btn.getAttribute('title')).toBe('Tooltip text');
  });
});

// ─── create() — type ────────────────────────────────────────

describe('Button.create() — type', () => {
  it('allows overriding type to submit', () => {
    const btn = Button.create('Submit', { type: 'submit' });
    expect(btn.getAttribute('type')).toBe('submit');
  });
});

// ─── setLoading() ───────────────────────────────────────────

describe('Button.setLoading()', () => {
  it('enables loading state on a non-loading button', () => {
    const btn = Button.create('Action');
    expect(btn.classList.contains('btn-loading')).toBe(false);
    expect(btn.querySelector('.btn-spinner')).toBeNull();

    Button.setLoading(btn, true);

    expect(btn.classList.contains('btn-loading')).toBe(true);
    expect(btn.disabled).toBe(true);
    expect(btn.querySelector('.btn-spinner')).not.toBeNull();
  });

  it('disables loading state on a loading button', () => {
    const btn = Button.create('Action', { loading: true });
    expect(btn.classList.contains('btn-loading')).toBe(true);

    Button.setLoading(btn, false);

    expect(btn.classList.contains('btn-loading')).toBe(false);
    expect(btn.disabled).toBe(false);
    expect(btn.querySelector('.btn-spinner')).toBeNull();
  });

  it('inserts spinner before first child', () => {
    const btn = Button.create('Action', { icon: '🔧' });
    Button.setLoading(btn, true);

    const firstChild = btn.children[0];
    expect(firstChild.classList.contains('btn-spinner')).toBe(true);
  });

  it('is idempotent when called multiple times with true', () => {
    const btn = Button.create('Action');
    Button.setLoading(btn, true);
    Button.setLoading(btn, true);

    const spinners = btn.querySelectorAll('.btn-spinner');
    expect(spinners.length).toBe(1);
  });
});

// ─── group() ────────────────────────────────────────────────

describe('Button.group()', () => {
  it('returns a div with .btn-group class', () => {
    const group = Button.group([]);
    expect(group.tagName).toBe('DIV');
    expect(group.classList.contains('btn-group')).toBe(true);
  });

  it('wraps provided buttons as children', () => {
    const btn1 = Button.create('A');
    const btn2 = Button.create('B');
    const btn3 = Button.create('C');

    const group = Button.group([btn1, btn2, btn3]);
    expect(group.children.length).toBe(3);
    expect(group.children[0]).toBe(btn1);
    expect(group.children[1]).toBe(btn2);
    expect(group.children[2]).toBe(btn3);
  });

  it('supports additional className', () => {
    const group = Button.group([], { className: 'my-group' });
    expect(group.classList.contains('btn-group')).toBe(true);
    expect(group.classList.contains('my-group')).toBe(true);
  });

  it('works with empty array', () => {
    const group = Button.group([]);
    expect(group.children.length).toBe(0);
  });
});
