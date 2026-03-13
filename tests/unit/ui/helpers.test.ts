// @vitest-environment jsdom
/**
 * Tests for public/ui/engine/helpers.js
 *
 * Covers: h(), setContent(), setTrustedContent(), debounce(), throttle(),
 *         escapeHtml(), uid(), formatTime(), clamp(), $(), $$()
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// We import from the JS source directly (vitest resolves .js as ESM)
const helpersPath = '../../../public/ui/engine/helpers.js';

let h: any, setContent: any, setTrustedContent: any;
let debounce: any, throttle: any, escapeHtml: any;
let uid: any, formatTime: any, clamp: any, $: any, $$: any;
let tip: any;

beforeEach(async () => {
  const mod = await import(helpersPath);
  h = mod.h;
  setContent = mod.setContent;
  setTrustedContent = mod.setTrustedContent;
  debounce = mod.debounce;
  throttle = mod.throttle;
  escapeHtml = mod.escapeHtml;
  uid = mod.uid;
  formatTime = mod.formatTime;
  clamp = mod.clamp;
  $ = mod.$;
  $$ = mod.$$;
  tip = mod.tip;
});

// ─── h() ────────────────────────────────────────────────────

describe('h() — hyperscript', () => {
  it('creates an element with the specified tag', () => {
    const el = h('div');
    expect(el.tagName).toBe('DIV');
  });

  it('sets text content from string children', () => {
    const el = h('span', null, 'hello');
    expect(el.textContent).toBe('hello');
  });

  it('sets class from attrs.class', () => {
    const el = h('div', { class: 'foo bar' });
    expect(el.className).toBe('foo bar');
  });

  it('sets class from attrs.className', () => {
    const el = h('div', { className: 'baz' });
    expect(el.className).toBe('baz');
  });

  it('sets inline styles from an object', () => {
    const el = h('div', { style: { color: 'red', fontSize: '14px' } });
    expect(el.style.color).toBe('red');
    expect(el.style.fontSize).toBe('14px');
  });

  it('sets data-* attributes from dataset', () => {
    const el = h('div', { dataset: { id: '123', type: 'test' } });
    expect(el.dataset.id).toBe('123');
    expect(el.dataset.type).toBe('test');
  });

  it('registers event listeners from on* attributes', () => {
    const handler = vi.fn();
    const el = h('button', { onClick: handler });
    el.click();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('sets boolean true attributes as empty string', () => {
    const el = h('input', { disabled: true });
    expect(el.getAttribute('disabled')).toBe('');
  });

  it('ignores false and null attribute values', () => {
    const el = h('div', { 'data-x': false, 'data-y': null });
    expect(el.hasAttribute('data-x')).toBe(false);
    expect(el.hasAttribute('data-y')).toBe(false);
  });

  it('nests child elements', () => {
    const el = h('ul', null,
      h('li', null, 'A'),
      h('li', null, 'B')
    );
    expect(el.children.length).toBe(2);
    expect(el.children[0].textContent).toBe('A');
    expect(el.children[1].textContent).toBe('B');
  });

  it('flattens array children', () => {
    const items = ['x', 'y'].map(t => h('span', null, t));
    const el = h('div', null, items);
    expect(el.children.length).toBe(2);
  });

  it('skips null and false children', () => {
    const el = h('div', null, null, false, 'text');
    expect(el.childNodes.length).toBe(1);
    expect(el.textContent).toBe('text');
  });

  it('converts number children to text', () => {
    const el = h('span', null, 42);
    expect(el.textContent).toBe('42');
  });
});

// ─── setContent() ───────────────────────────────────────────

describe('setContent()', () => {
  it('clears element and sets text', () => {
    const el = document.createElement('div');
    el.textContent = 'old';
    setContent(el, 'new');
    expect(el.textContent).toBe('new');
  });

  it('clears element when given null', () => {
    const el = document.createElement('div');
    el.textContent = 'old';
    setContent(el, null);
    expect(el.textContent).toBe('');
  });

  it('appends a Node child', () => {
    const el = document.createElement('div');
    const child = document.createElement('span');
    child.textContent = 'child';
    setContent(el, child);
    expect(el.children.length).toBe(1);
    expect(el.textContent).toBe('child');
  });

  it('appends an array of nodes and strings', () => {
    const el = document.createElement('div');
    const span = document.createElement('span');
    span.textContent = 'span';
    setContent(el, [span, 'text']);
    expect(el.childNodes.length).toBe(2);
  });
});

// ─── setTrustedContent() ────────────────────────────────────

describe('setTrustedContent()', () => {
  it('sets HTML content from a string', () => {
    const el = document.createElement('div');
    setTrustedContent(el, '<strong>bold</strong>');
    expect(el.querySelector('strong')).not.toBeNull();
    expect(el.textContent).toBe('bold');
  });

  it('replaces existing content', () => {
    const el = document.createElement('div');
    el.textContent = 'old';
    setTrustedContent(el, '<em>new</em>');
    expect(el.textContent).toBe('new');
  });
});

// ─── escapeHtml() ───────────────────────────────────────────

describe('escapeHtml()', () => {
  it('escapes angle brackets', () => {
    const result = escapeHtml('<b>test</b>');
    expect(result).toContain('&lt;');
    expect(result).not.toContain('<b>');
  });

  it('escapes ampersands', () => {
    expect(escapeHtml('a & b')).toBe('a &amp; b');
  });

  it('leaves safe strings unchanged', () => {
    expect(escapeHtml('hello world')).toBe('hello world');
  });
});

// ─── uid() ──────────────────────────────────────────────────

describe('uid()', () => {
  it('returns a string', () => {
    expect(typeof uid()).toBe('string');
  });

  it('includes prefix', () => {
    expect(uid('test-')).toMatch(/^test-/);
  });

  it('generates unique values', () => {
    const ids = new Set(Array.from({ length: 100 }, () => uid()));
    expect(ids.size).toBe(100);
  });
});

// ─── formatTime() ───────────────────────────────────────────

describe('formatTime()', () => {
  it('returns "Just now" for timestamps less than a minute old', () => {
    const result = formatTime(new Date());
    expect(result).toBe('Just now');
  });

  it('returns relative minutes for timestamps under an hour', () => {
    const d = new Date(Date.now() - 15 * 60000);
    expect(formatTime(d)).toBe('15m ago');
  });

  it('returns relative hours for timestamps under 24 hours', () => {
    const d = new Date(Date.now() - 5 * 3600000);
    expect(formatTime(d)).toBe('5h ago');
  });

  it('returns "Yesterday" with time for yesterday timestamps', () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(14, 30, 0, 0);
    const result = formatTime(yesterday);
    expect(result).toMatch(/^Yesterday, .*2:30/);
  });

  it('returns month and day for older dates this year', () => {
    const d = new Date();
    d.setMonth(d.getMonth() - 2);
    const result = formatTime(d);
    // Should include month abbreviation and day
    expect(result).toMatch(/\w{3} \d{1,2},/);
  });

  it('returns month, day, and year for dates from a prior year', () => {
    const d = new Date(2024, 0, 15, 14, 30);
    const result = formatTime(d);
    expect(result).toMatch(/Jan 15, 2024/);
  });

  it('handles ISO strings', () => {
    const result = formatTime('2024-01-01T14:30:00Z');
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  it('returns empty string for null/undefined', () => {
    expect(formatTime(null)).toBe('');
    expect(formatTime(undefined)).toBe('');
  });

  it('returns empty string for invalid date', () => {
    expect(formatTime('not-a-date')).toBe('');
  });
});

// ─── clamp() ────────────────────────────────────────────────

describe('clamp()', () => {
  it('returns value when in range', () => {
    expect(clamp(5, 0, 10)).toBe(5);
  });

  it('clamps to min', () => {
    expect(clamp(-5, 0, 10)).toBe(0);
  });

  it('clamps to max', () => {
    expect(clamp(15, 0, 10)).toBe(10);
  });
});

// ─── $() and $$() ───────────────────────────────────────────

describe('$() and $$()', () => {
  it('$ returns first match', () => {
    document.body.textContent = '';
    const d1 = document.createElement('div');
    d1.className = 'a';
    const d2 = document.createElement('div');
    d2.className = 'a';
    document.body.appendChild(d1);
    document.body.appendChild(d2);

    const result = $('.a');
    expect(result).not.toBeNull();
    expect(result.className).toBe('a');
  });

  it('$$ returns all matches as array', () => {
    document.body.textContent = '';
    for (let i = 0; i < 3; i++) {
      const d = document.createElement('div');
      d.className = 'b';
      document.body.appendChild(d);
    }
    const result = $$('.b');
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(3);
  });

  it('$ respects scope', () => {
    document.body.textContent = '';
    const container = document.createElement('div');
    const inner = document.createElement('span');
    inner.className = 'c';
    inner.textContent = 'in';
    container.appendChild(inner);

    const outer = document.createElement('span');
    outer.className = 'c';
    outer.textContent = 'out';
    document.body.appendChild(outer);
    document.body.appendChild(container);

    const result = $('.c', container);
    expect(result.textContent).toBe('in');
  });
});

// ─── debounce() ─────────────────────────────────────────────

describe('debounce()', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('delays invocation', () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 100);
    debounced();
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('resets delay on repeated calls', () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 100);
    debounced();
    vi.advanceTimersByTime(50);
    debounced();
    vi.advanceTimersByTime(50);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(50);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

// ─── throttle() ─────────────────────────────────────────────

describe('throttle()', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('invokes immediately on first call', () => {
    const fn = vi.fn();
    const throttled = throttle(fn, 100);
    throttled('a');
    expect(fn).toHaveBeenCalledWith('a');
  });

  it('suppresses calls within the limit', () => {
    const fn = vi.fn();
    const throttled = throttle(fn, 100);
    throttled('a');
    throttled('b');
    throttled('c');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('fires trailing call after limit', () => {
    const fn = vi.fn();
    const throttled = throttle(fn, 100);
    throttled('a');
    throttled('b');
    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn).toHaveBeenLastCalledWith('b');
  });
});

// ─── tip() ────────────────────────────────────────────────────

describe('tip() — jargon tooltips', () => {
  it('returns a span with tooltip for known glossary terms', () => {
    const el = tip('File Scope');
    expect(el.tagName).toBe('SPAN');
    expect(el.className).toBe('has-tooltip');
    expect(el.dataset.tooltip).toBe('Controls which project files agents in this room can access');
    expect(el.textContent).toBe('File Scope');
  });

  it('returns a text node for unknown terms', () => {
    const node = tip('Some Unknown Term');
    expect(node.nodeType).toBe(Node.TEXT_NODE);
    expect(node.textContent).toBe('Some Unknown Term');
  });

  it('uses override text when provided', () => {
    const el = tip('Custom Label', 'My custom explanation');
    expect(el.tagName).toBe('SPAN');
    expect(el.dataset.tooltip).toBe('My custom explanation');
    expect(el.textContent).toBe('Custom Label');
  });

  it('handles all major glossary terms', () => {
    const terms = ['Exit Document', 'AI Provider', 'RAID Log', 'Cross-Room Citations', 'Phase Gate'];
    for (const term of terms) {
      const el = tip(term);
      expect(el.tagName).toBe('SPAN');
      expect(el.dataset.tooltip).toBeTruthy();
    }
  });
});
