// @vitest-environment jsdom
/**
 * Tests for public/ui/components/progress-bar.js
 *
 * Covers: ProgressBar.create() value clamping, labels, colors, sizes,
 *         animated flag; ProgressBar.createMulti() multi-segment bars;
 *         ProgressBar.update() dynamic value/label updates.
 */

import { describe, it, expect, beforeEach } from 'vitest';

const barPath = '../../../public/ui/components/progress-bar.js';

let ProgressBar: any;

beforeEach(async () => {
  const mod = await import(barPath);
  ProgressBar = mod.ProgressBar;
});

// ─── create() — basic structure ─────────────────────────────

describe('ProgressBar.create() — basic structure', () => {
  it('returns a div element', () => {
    const bar = ProgressBar.create(50);
    expect(bar.tagName).toBe('DIV');
  });

  it('has role="progressbar"', () => {
    const bar = ProgressBar.create(50);
    expect(bar.getAttribute('role')).toBe('progressbar');
  });

  it('applies progress-bar base class', () => {
    const bar = ProgressBar.create(50);
    expect(bar.classList.contains('progress-bar')).toBe(true);
  });

  it('sets aria-valuenow to the clamped value', () => {
    const bar = ProgressBar.create(42);
    expect(bar.getAttribute('aria-valuenow')).toBe('42');
  });

  it('sets aria-valuemin to 0', () => {
    const bar = ProgressBar.create(42);
    expect(bar.getAttribute('aria-valuemin')).toBe('0');
  });

  it('sets aria-valuemax to 100', () => {
    const bar = ProgressBar.create(42);
    expect(bar.getAttribute('aria-valuemax')).toBe('100');
  });

  it('contains a .progress-bar-fill child', () => {
    const bar = ProgressBar.create(60);
    const fill = bar.querySelector('.progress-bar-fill');
    expect(fill).not.toBeNull();
    expect(fill!.tagName).toBe('DIV');
  });

  it('sets fill width to the given percentage', () => {
    const bar = ProgressBar.create(73);
    const fill = bar.querySelector('.progress-bar-fill') as HTMLElement;
    expect(fill.style.width).toBe('73%');
  });
});

// ─── create() — value clamping ──────────────────────────────

describe('ProgressBar.create() — value clamping', () => {
  it('clamps values below 0 to 0', () => {
    const bar = ProgressBar.create(-25);
    const fill = bar.querySelector('.progress-bar-fill') as HTMLElement;
    expect(fill.style.width).toBe('0%');
    expect(bar.getAttribute('aria-valuenow')).toBe('0');
  });

  it('clamps values above 100 to 100', () => {
    const bar = ProgressBar.create(999);
    const fill = bar.querySelector('.progress-bar-fill') as HTMLElement;
    expect(fill.style.width).toBe('100%');
    expect(bar.getAttribute('aria-valuenow')).toBe('100');
  });

  it('handles exactly 0', () => {
    const bar = ProgressBar.create(0);
    const fill = bar.querySelector('.progress-bar-fill') as HTMLElement;
    expect(fill.style.width).toBe('0%');
    expect(bar.getAttribute('aria-valuenow')).toBe('0');
  });

  it('handles exactly 100', () => {
    const bar = ProgressBar.create(100);
    const fill = bar.querySelector('.progress-bar-fill') as HTMLElement;
    expect(fill.style.width).toBe('100%');
    expect(bar.getAttribute('aria-valuenow')).toBe('100');
  });

  it('handles fractional values', () => {
    const bar = ProgressBar.create(33.7);
    const fill = bar.querySelector('.progress-bar-fill') as HTMLElement;
    expect(fill.style.width).toBe('33.7%');
  });
});

// ─── create() — size variants ───────────────────────────────

describe('ProgressBar.create() — size variants', () => {
  it('defaults to md size', () => {
    const bar = ProgressBar.create(50);
    expect(bar.classList.contains('progress-bar-md')).toBe(true);
  });

  it('applies sm size class', () => {
    const bar = ProgressBar.create(50, { size: 'sm' });
    expect(bar.classList.contains('progress-bar-sm')).toBe(true);
  });

  it('applies lg size class', () => {
    const bar = ProgressBar.create(50, { size: 'lg' });
    expect(bar.classList.contains('progress-bar-lg')).toBe(true);
  });
});

// ─── create() — colors ─────────────────────────────────────

describe('ProgressBar.create() — colors', () => {
  it('uses default accent-cyan when no color specified', () => {
    const bar = ProgressBar.create(50);
    const fill = bar.querySelector('.progress-bar-fill') as HTMLElement;
    expect(fill.style.background).toBe('var(--accent-cyan)');
  });

  it('applies custom color to fill', () => {
    const bar = ProgressBar.create(50, { color: '#ff0000' });
    const fill = bar.querySelector('.progress-bar-fill') as HTMLElement;
    expect(fill.style.background).toBe('rgb(255, 0, 0)');
  });

  it('applies CSS variable color', () => {
    const bar = ProgressBar.create(50, { color: 'var(--accent-green)' });
    const fill = bar.querySelector('.progress-bar-fill') as HTMLElement;
    expect(fill.style.background).toBe('var(--accent-green)');
  });
});

// ─── create() — labels ─────────────────────────────────────

describe('ProgressBar.create() — labels', () => {
  it('does not show label by default', () => {
    const bar = ProgressBar.create(50);
    expect(bar.querySelector('.progress-bar-label')).toBeNull();
  });

  it('shows percentage label when showLabel is true', () => {
    const bar = ProgressBar.create(75, { showLabel: true });
    const label = bar.querySelector('.progress-bar-label');
    expect(label).not.toBeNull();
    expect(label!.textContent).toBe('75%');
  });

  it('rounds percentage in label', () => {
    const bar = ProgressBar.create(33.333, { showLabel: true });
    const label = bar.querySelector('.progress-bar-label');
    expect(label!.textContent).toBe('33%');
  });

  it('shows custom label text when label option is provided', () => {
    const bar = ProgressBar.create(50, { label: 'Half done' });
    const label = bar.querySelector('.progress-bar-label');
    expect(label).not.toBeNull();
    expect(label!.textContent).toBe('Half done');
  });

  it('custom label overrides percentage even when showLabel is true', () => {
    const bar = ProgressBar.create(75, { showLabel: true, label: 'Custom' });
    const label = bar.querySelector('.progress-bar-label');
    expect(label!.textContent).toBe('Custom');
  });
});

// ─── create() — animated flag ───────────────────────────────

describe('ProgressBar.create() — animated flag', () => {
  it('adds progress-animated class by default', () => {
    const bar = ProgressBar.create(50);
    const fill = bar.querySelector('.progress-bar-fill');
    expect(fill!.classList.contains('progress-animated')).toBe(true);
  });

  it('omits progress-animated class when animated is false', () => {
    const bar = ProgressBar.create(50, { animated: false });
    const fill = bar.querySelector('.progress-bar-fill');
    expect(fill!.classList.contains('progress-animated')).toBe(false);
  });
});

// ─── create() — className option ────────────────────────────

describe('ProgressBar.create() — className option', () => {
  it('appends additional className to bar element', () => {
    const bar = ProgressBar.create(50, { className: 'my-custom-bar' });
    expect(bar.classList.contains('my-custom-bar')).toBe(true);
    expect(bar.classList.contains('progress-bar')).toBe(true);
  });

  it('works without className (no trailing space)', () => {
    const bar = ProgressBar.create(50);
    // Class string should be trimmed — no trailing whitespace
    expect(bar.className).not.toMatch(/\s$/);
  });
});

// ─── createMulti() — multi-segment bars ─────────────────────

describe('ProgressBar.createMulti()', () => {
  it('returns a div with progress-bar-multi class', () => {
    const bar = ProgressBar.createMulti([{ value: 30, color: 'red' }]);
    expect(bar.tagName).toBe('DIV');
    expect(bar.classList.contains('progress-bar-multi')).toBe(true);
    expect(bar.classList.contains('progress-bar')).toBe(true);
  });

  it('has role="progressbar" with correct aria attributes', () => {
    const bar = ProgressBar.createMulti([
      { value: 40, color: 'red' },
      { value: 25, color: 'blue' }
    ]);
    expect(bar.getAttribute('role')).toBe('progressbar');
    expect(bar.getAttribute('aria-valuenow')).toBe('65');
    expect(bar.getAttribute('aria-valuemin')).toBe('0');
    expect(bar.getAttribute('aria-valuemax')).toBe('100');
  });

  it('creates one .progress-bar-segment per segment', () => {
    const bar = ProgressBar.createMulti([
      { value: 20, color: 'red' },
      { value: 30, color: 'green' },
      { value: 10, color: 'blue' }
    ]);
    const segs = bar.querySelectorAll('.progress-bar-segment');
    expect(segs.length).toBe(3);
  });

  it('sets correct width for each segment', () => {
    const bar = ProgressBar.createMulti([
      { value: 25, color: 'red' },
      { value: 50, color: 'blue' }
    ]);
    const segs = bar.querySelectorAll('.progress-bar-segment') as NodeListOf<HTMLElement>;
    expect(segs[0].style.width).toBe('25%');
    expect(segs[1].style.width).toBe('50%');
  });

  it('applies per-segment colors', () => {
    const bar = ProgressBar.createMulti([
      { value: 30, color: 'var(--accent-green)' },
      { value: 20, color: 'var(--accent-red)' }
    ]);
    const segs = bar.querySelectorAll('.progress-bar-segment') as NodeListOf<HTMLElement>;
    expect(segs[0].style.background).toBe('var(--accent-green)');
    expect(segs[1].style.background).toBe('var(--accent-red)');
  });

  it('uses default color when segment color is not provided', () => {
    const bar = ProgressBar.createMulti([{ value: 50 }]);
    const seg = bar.querySelector('.progress-bar-segment') as HTMLElement;
    expect(seg.style.background).toBe('var(--accent-cyan)');
  });

  it('sets title attribute to custom label or percentage', () => {
    const bar = ProgressBar.createMulti([
      { value: 40, color: 'red', label: 'Phase 1' },
      { value: 30, color: 'blue' }
    ]);
    const segs = bar.querySelectorAll('.progress-bar-segment');
    expect(segs[0].getAttribute('title')).toBe('Phase 1');
    expect(segs[1].getAttribute('title')).toBe('30%');
  });

  it('clamps total to 100 — excess segments get reduced width', () => {
    const bar = ProgressBar.createMulti([
      { value: 60, color: 'red' },
      { value: 60, color: 'blue' }
    ]);
    const segs = bar.querySelectorAll('.progress-bar-segment') as NodeListOf<HTMLElement>;
    expect(segs[0].style.width).toBe('60%');
    // Second segment clamped to remaining 40%
    expect(segs[1].style.width).toBe('40%');
    expect(bar.getAttribute('aria-valuenow')).toBe('100');
  });

  it('applies size variant to multi bar', () => {
    const bar = ProgressBar.createMulti([{ value: 50, color: 'red' }], { size: 'lg' });
    expect(bar.classList.contains('progress-bar-lg')).toBe(true);
  });

  it('adds progress-animated class to segments by default', () => {
    const bar = ProgressBar.createMulti([{ value: 50, color: 'red' }]);
    const seg = bar.querySelector('.progress-bar-segment');
    expect(seg!.classList.contains('progress-animated')).toBe(true);
  });

  it('omits progress-animated when animated is false', () => {
    const bar = ProgressBar.createMulti([{ value: 50, color: 'red' }], { animated: false });
    const seg = bar.querySelector('.progress-bar-segment');
    expect(seg!.classList.contains('progress-animated')).toBe(false);
  });

  it('appends additional className', () => {
    const bar = ProgressBar.createMulti([{ value: 50 }], { className: 'phase-bar' });
    expect(bar.classList.contains('phase-bar')).toBe(true);
  });
});

// ─── update() — dynamic value updates ──────────────────────

describe('ProgressBar.update()', () => {
  it('updates fill width to new value', () => {
    const bar = ProgressBar.create(20, { showLabel: true });
    ProgressBar.update(bar, 80);
    const fill = bar.querySelector('.progress-bar-fill') as HTMLElement;
    expect(fill.style.width).toBe('80%');
  });

  it('updates aria-valuenow attribute', () => {
    const bar = ProgressBar.create(20);
    ProgressBar.update(bar, 55);
    expect(bar.getAttribute('aria-valuenow')).toBe('55');
  });

  it('updates label text to new percentage', () => {
    const bar = ProgressBar.create(20, { showLabel: true });
    ProgressBar.update(bar, 90);
    const label = bar.querySelector('.progress-bar-label');
    expect(label!.textContent).toBe('90%');
  });

  it('updates label to custom text when provided', () => {
    const bar = ProgressBar.create(20, { showLabel: true });
    ProgressBar.update(bar, 100, 'Complete!');
    const label = bar.querySelector('.progress-bar-label');
    expect(label!.textContent).toBe('Complete!');
  });

  it('clamps updated values below 0', () => {
    const bar = ProgressBar.create(50);
    ProgressBar.update(bar, -10);
    const fill = bar.querySelector('.progress-bar-fill') as HTMLElement;
    expect(fill.style.width).toBe('0%');
    expect(bar.getAttribute('aria-valuenow')).toBe('0');
  });

  it('clamps updated values above 100', () => {
    const bar = ProgressBar.create(50);
    ProgressBar.update(bar, 200);
    const fill = bar.querySelector('.progress-bar-fill') as HTMLElement;
    expect(fill.style.width).toBe('100%');
    expect(bar.getAttribute('aria-valuenow')).toBe('100');
  });

  it('does nothing when barEl is null', () => {
    // Should not throw
    expect(() => ProgressBar.update(null, 50)).not.toThrow();
  });

  it('handles bar without a label element gracefully', () => {
    const bar = ProgressBar.create(30); // no showLabel
    expect(bar.querySelector('.progress-bar-label')).toBeNull();
    // Should not throw, just update fill and aria
    expect(() => ProgressBar.update(bar, 60)).not.toThrow();
    expect(bar.getAttribute('aria-valuenow')).toBe('60');
  });
});
