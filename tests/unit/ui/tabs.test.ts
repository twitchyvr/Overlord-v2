// @vitest-environment jsdom
/**
 * Tests for public/ui/components/tabs.js
 *
 * Covers: Tabs construction, mount/render lifecycle, setActive(),
 *         setBadge(), setItems(), tab styles (pills/underline/segmented),
 *         keyboard navigation (ArrowLeft/Right, Home, End),
 *         onChange callback, disabled items, ARIA attributes,
 *         icon rendering, and active style updates.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const tabsPath = '../../../public/ui/components/tabs.js';

let Tabs: any;

beforeEach(async () => {
  document.body.textContent = '';
  const mod = await import(tabsPath);
  Tabs = mod.Tabs;
});

// ─── Helper: standard 3-tab items ────────────────────────────
function threeItems() {
  return [
    { id: 'alpha', label: 'Alpha' },
    { id: 'beta', label: 'Beta' },
    { id: 'gamma', label: 'Gamma' },
  ];
}

function makeTabs(opts: Record<string, any> = {}) {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const t = new Tabs(el, { items: threeItems(), ...opts });
  return t;
}

// ─── Constructor ─────────────────────────────────────────────

describe('Tabs — constructor', () => {
  it('stores the container element as this.el', () => {
    const el = document.createElement('div');
    const t = new Tabs(el, { items: threeItems() });
    expect(t.el).toBe(el);
  });

  it('merges opts with defaults', () => {
    const el = document.createElement('div');
    const onChange = vi.fn();
    const t = new Tabs(el, { items: threeItems(), onChange, style: 'underline' });

    expect(t.opts.style).toBe('underline');
    expect(t.opts.onChange).toBe(onChange);
    expect(t.opts.items.length).toBe(3);
  });

  it('defaults style to pills', () => {
    const el = document.createElement('div');
    const t = new Tabs(el, { items: threeItems() });
    expect(t.opts.style).toBe('pills');
  });

  it('defaults onChange to null', () => {
    const el = document.createElement('div');
    const t = new Tabs(el);
    expect(t.opts.onChange).toBeNull();
  });

  it('defaults items to empty array', () => {
    const el = document.createElement('div');
    const t = new Tabs(el);
    expect(t.opts.items).toEqual([]);
  });

  it('sets _activeId to opts.activeId when provided', () => {
    const el = document.createElement('div');
    const t = new Tabs(el, { items: threeItems(), activeId: 'beta' });
    expect(t._activeId).toBe('beta');
  });

  it('defaults _activeId to first item id when no activeId given', () => {
    const el = document.createElement('div');
    const t = new Tabs(el, { items: threeItems() });
    expect(t._activeId).toBe('alpha');
  });

  it('defaults _activeId to null when items is empty', () => {
    const el = document.createElement('div');
    const t = new Tabs(el, { items: [] });
    expect(t._activeId).toBeNull();
  });

  it('initializes _tabEls as an empty Map', () => {
    const el = document.createElement('div');
    const t = new Tabs(el, { items: threeItems() });
    expect(t._tabEls).toBeInstanceOf(Map);
    expect(t._tabEls.size).toBe(0);
  });

  it('is not mounted initially', () => {
    const el = document.createElement('div');
    const t = new Tabs(el, { items: threeItems() });
    expect(t._mounted).toBeFalsy();
  });
});

// ─── mount() ─────────────────────────────────────────────────

describe('Tabs — mount()', () => {
  it('sets _mounted to true', () => {
    const t = makeTabs();
    expect(t._mounted).toBeFalsy();
    t.mount();
    expect(t._mounted).toBe(true);
  });

  it('renders tab buttons into the container', () => {
    const t = makeTabs();
    t.mount();

    const buttons = t.el.querySelectorAll('button.tab-item');
    expect(buttons.length).toBe(3);
  });

  it('assigns the correct CSS class based on style option', () => {
    const t = makeTabs({ style: 'segmented' });
    t.mount();
    expect(t.el.className).toBe('tabs tabs-segmented');
  });

  it('populates _tabEls map with entries for each item', () => {
    const t = makeTabs();
    t.mount();
    expect(t._tabEls.size).toBe(3);
    expect(t._tabEls.has('alpha')).toBe(true);
    expect(t._tabEls.has('beta')).toBe(true);
    expect(t._tabEls.has('gamma')).toBe(true);
  });
});

// ─── Tab styles ──────────────────────────────────────────────

describe('Tabs — styles', () => {
  it('applies tabs-pills class for pills style', () => {
    const t = makeTabs({ style: 'pills' });
    t.mount();
    expect(t.el.classList.contains('tabs-pills')).toBe(true);
  });

  it('applies tabs-underline class for underline style', () => {
    const t = makeTabs({ style: 'underline' });
    t.mount();
    expect(t.el.classList.contains('tabs-underline')).toBe(true);
  });

  it('applies tabs-segmented class for segmented style', () => {
    const t = makeTabs({ style: 'segmented' });
    t.mount();
    expect(t.el.classList.contains('tabs-segmented')).toBe(true);
  });
});

// ─── Rendering details ──────────────────────────────────────

describe('Tabs — rendering', () => {
  it('renders labels inside .tab-label spans', () => {
    const t = makeTabs();
    t.mount();

    const labels = t.el.querySelectorAll('.tab-label');
    expect(labels[0].textContent).toBe('Alpha');
    expect(labels[1].textContent).toBe('Beta');
    expect(labels[2].textContent).toBe('Gamma');
  });

  it('sets data-tab-id attribute on each button', () => {
    const t = makeTabs();
    t.mount();

    const buttons = t.el.querySelectorAll('button.tab-item');
    expect(buttons[0].getAttribute('data-tab-id')).toBe('alpha');
    expect(buttons[1].getAttribute('data-tab-id')).toBe('beta');
    expect(buttons[2].getAttribute('data-tab-id')).toBe('gamma');
  });

  it('sets role=tab on each button', () => {
    const t = makeTabs();
    t.mount();

    const buttons = t.el.querySelectorAll('button.tab-item');
    buttons.forEach((btn: Element) => {
      expect(btn.getAttribute('role')).toBe('tab');
    });
  });

  it('renders icon span when item has icon', () => {
    const items = [{ id: 'a', label: 'Settings', icon: 'G' }];
    const t = makeTabs({ items });
    t.mount();

    const icon = t.el.querySelector('.tab-icon');
    expect(icon).not.toBeNull();
    expect(icon.textContent).toBe('G');
  });

  it('does not render icon span when item has no icon', () => {
    const t = makeTabs();
    t.mount();

    const icon = t.el.querySelector('.tab-icon');
    expect(icon).toBeNull();
  });

  it('renders badge span when item has badge', () => {
    const items = [{ id: 'a', label: 'Inbox', badge: 5 }];
    const t = makeTabs({ items });
    t.mount();

    const badge = t.el.querySelector('.tab-badge');
    expect(badge).not.toBeNull();
    expect(badge.textContent).toBe('5');
  });

  it('does not render badge when badge is null', () => {
    const items = [{ id: 'a', label: 'Inbox', badge: null }];
    const t = makeTabs({ items });
    t.mount();

    const badge = t.el.querySelector('.tab-badge');
    expect(badge).toBeNull();
  });

  it('does not render badge when badge is empty string', () => {
    const items = [{ id: 'a', label: 'Inbox', badge: '' }];
    const t = makeTabs({ items });
    t.mount();

    const badge = t.el.querySelector('.tab-badge');
    expect(badge).toBeNull();
  });

  it('adds disabled class to disabled items', () => {
    const items = [
      { id: 'a', label: 'Enabled' },
      { id: 'b', label: 'Disabled', disabled: true },
    ];
    const t = makeTabs({ items });
    t.mount();

    const buttons = t.el.querySelectorAll('button.tab-item');
    expect(buttons[0].classList.contains('disabled')).toBe(false);
    expect(buttons[1].classList.contains('disabled')).toBe(true);
  });

  it('sets aria-disabled=true on disabled items', () => {
    const items = [
      { id: 'a', label: 'Enabled' },
      { id: 'b', label: 'Disabled', disabled: true },
    ];
    const t = makeTabs({ items });
    t.mount();

    const buttons = t.el.querySelectorAll('button.tab-item');
    expect(buttons[0].hasAttribute('aria-disabled')).toBe(false);
    expect(buttons[1].getAttribute('aria-disabled')).toBe('true');
  });
});

// ─── Active state / ARIA ─────────────────────────────────────

describe('Tabs — active state and ARIA', () => {
  it('marks the first tab as active by default', () => {
    const t = makeTabs();
    t.mount();

    const firstBtn = t._tabEls.get('alpha');
    expect(firstBtn.classList.contains('active')).toBe(true);
    expect(firstBtn.getAttribute('aria-selected')).toBe('true');
    expect(firstBtn.getAttribute('tabindex')).toBe('0');
  });

  it('marks non-active tabs with aria-selected=false and tabindex=-1', () => {
    const t = makeTabs();
    t.mount();

    const secondBtn = t._tabEls.get('beta');
    expect(secondBtn.classList.contains('active')).toBe(false);
    expect(secondBtn.getAttribute('aria-selected')).toBe('false');
    expect(secondBtn.getAttribute('tabindex')).toBe('-1');
  });

  it('honors activeId option on initial render', () => {
    const t = makeTabs({ activeId: 'gamma' });
    t.mount();

    expect(t._tabEls.get('gamma').classList.contains('active')).toBe(true);
    expect(t._tabEls.get('alpha').classList.contains('active')).toBe(false);
  });
});

// ─── getActive() ─────────────────────────────────────────────

describe('Tabs — getActive()', () => {
  it('returns the currently active tab id', () => {
    const t = makeTabs({ activeId: 'beta' });
    t.mount();
    expect(t.getActive()).toBe('beta');
  });

  it('returns default (first item) when no activeId was given', () => {
    const t = makeTabs();
    t.mount();
    expect(t.getActive()).toBe('alpha');
  });
});

// ─── setActive() ─────────────────────────────────────────────

describe('Tabs — setActive()', () => {
  it('changes the active tab', () => {
    const t = makeTabs();
    t.mount();

    t.setActive('beta');
    expect(t.getActive()).toBe('beta');
  });

  it('updates DOM classes when switching tabs', () => {
    const t = makeTabs();
    t.mount();

    t.setActive('beta');

    expect(t._tabEls.get('alpha').classList.contains('active')).toBe(false);
    expect(t._tabEls.get('beta').classList.contains('active')).toBe(true);
  });

  it('updates aria-selected attributes', () => {
    const t = makeTabs();
    t.mount();

    t.setActive('gamma');

    expect(t._tabEls.get('alpha').getAttribute('aria-selected')).toBe('false');
    expect(t._tabEls.get('gamma').getAttribute('aria-selected')).toBe('true');
  });

  it('updates tabindex on active/inactive tabs', () => {
    const t = makeTabs();
    t.mount();

    t.setActive('gamma');

    expect(t._tabEls.get('alpha').getAttribute('tabindex')).toBe('-1');
    expect(t._tabEls.get('gamma').getAttribute('tabindex')).toBe('0');
  });

  it('fires onChange callback with (newId, prevId)', () => {
    const onChange = vi.fn();
    const t = makeTabs({ onChange });
    t.mount();

    t.setActive('beta');
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('beta', 'alpha');
  });

  it('does not fire onChange when silent=true', () => {
    const onChange = vi.fn();
    const t = makeTabs({ onChange });
    t.mount();

    t.setActive('beta', true);
    expect(onChange).not.toHaveBeenCalled();
    expect(t.getActive()).toBe('beta');
  });

  it('is a no-op when setting the same active id', () => {
    const onChange = vi.fn();
    const t = makeTabs({ onChange });
    t.mount();

    t.setActive('alpha');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('does not activate a non-existent tab id', () => {
    const onChange = vi.fn();
    const t = makeTabs({ onChange });
    t.mount();

    t.setActive('nonexistent');
    expect(t.getActive()).toBe('alpha');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('does not activate a disabled tab', () => {
    const items = [
      { id: 'a', label: 'A' },
      { id: 'b', label: 'B', disabled: true },
    ];
    const onChange = vi.fn();
    const t = makeTabs({ items, onChange });
    t.mount();

    t.setActive('b');
    expect(t.getActive()).toBe('a');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('does not fire onChange when onChange is null', () => {
    const t = makeTabs();
    t.mount();

    // Should not throw
    expect(() => t.setActive('beta')).not.toThrow();
    expect(t.getActive()).toBe('beta');
  });
});

// ─── Click-to-select ─────────────────────────────────────────

describe('Tabs — click interaction', () => {
  it('clicking a tab activates it', () => {
    const onChange = vi.fn();
    const t = makeTabs({ onChange });
    t.mount();

    t._tabEls.get('gamma').click();

    expect(t.getActive()).toBe('gamma');
    expect(onChange).toHaveBeenCalledWith('gamma', 'alpha');
  });

  it('clicking a disabled tab does not activate it', () => {
    const items = [
      { id: 'a', label: 'A' },
      { id: 'b', label: 'B', disabled: true },
    ];
    const onChange = vi.fn();
    const t = makeTabs({ items, onChange });
    t.mount();

    t._tabEls.get('b').click();

    expect(t.getActive()).toBe('a');
    expect(onChange).not.toHaveBeenCalled();
  });
});

// ─── setBadge() ──────────────────────────────────────────────

describe('Tabs — setBadge()', () => {
  it('adds a badge to a tab', () => {
    const t = makeTabs();
    t.mount();

    t.setBadge('alpha', 3);

    const badge = t._tabEls.get('alpha').querySelector('.tab-badge');
    expect(badge).not.toBeNull();
    expect(badge.textContent).toBe('3');
  });

  it('updates an existing badge', () => {
    const items = [{ id: 'a', label: 'Inbox', badge: 5 }];
    const t = makeTabs({ items });
    t.mount();

    t.setBadge('a', 10);

    const badge = t._tabEls.get('a').querySelector('.tab-badge');
    expect(badge.textContent).toBe('10');
  });

  it('removes badge when text is null', () => {
    const items = [{ id: 'a', label: 'Inbox', badge: 5 }];
    const t = makeTabs({ items });
    t.mount();

    t.setBadge('a', null);

    const badge = t._tabEls.get('a').querySelector('.tab-badge');
    expect(badge).toBeNull();
  });

  it('removes badge when text is empty string', () => {
    const items = [{ id: 'a', label: 'Inbox', badge: 5 }];
    const t = makeTabs({ items });
    t.mount();

    t.setBadge('a', '');

    const badge = t._tabEls.get('a').querySelector('.tab-badge');
    expect(badge).toBeNull();
  });

  it('updates the item object badge property', () => {
    const t = makeTabs();
    t.mount();

    t.setBadge('alpha', 42);

    const item = t.opts.items.find((i: any) => i.id === 'alpha');
    expect(item.badge).toBe(42);
  });

  it('is a no-op for a non-existent tab id', () => {
    const t = makeTabs();
    t.mount();

    // Should not throw
    expect(() => t.setBadge('nonexistent', 5)).not.toThrow();
  });

  it('converts numeric badge to string in textContent', () => {
    const t = makeTabs();
    t.mount();

    t.setBadge('beta', 99);

    const badge = t._tabEls.get('beta').querySelector('.tab-badge');
    expect(badge.textContent).toBe('99');
  });
});

// ─── setItems() ──────────────────────────────────────────────

describe('Tabs — setItems()', () => {
  it('replaces all items and re-renders', () => {
    const t = makeTabs();
    t.mount();

    const newItems = [
      { id: 'x', label: 'X-Ray' },
      { id: 'y', label: 'Yankee' },
    ];
    t.setItems(newItems);

    const buttons = t.el.querySelectorAll('button.tab-item');
    expect(buttons.length).toBe(2);
    expect(buttons[0].querySelector('.tab-label').textContent).toBe('X-Ray');
    expect(buttons[1].querySelector('.tab-label').textContent).toBe('Yankee');
  });

  it('preserves activeId if it exists in new items', () => {
    const t = makeTabs({ activeId: 'beta' });
    t.mount();

    const newItems = [
      { id: 'alpha', label: 'Alpha' },
      { id: 'beta', label: 'Beta' },
    ];
    t.setItems(newItems);

    expect(t.getActive()).toBe('beta');
  });

  it('resets activeId to first item if old activeId is not in new items', () => {
    const t = makeTabs({ activeId: 'gamma' });
    t.mount();

    const newItems = [
      { id: 'x', label: 'X-Ray' },
      { id: 'y', label: 'Yankee' },
    ];
    t.setItems(newItems);

    expect(t.getActive()).toBe('x');
  });

  it('accepts an explicit activeId parameter', () => {
    const t = makeTabs();
    t.mount();

    const newItems = [
      { id: 'x', label: 'X-Ray' },
      { id: 'y', label: 'Yankee' },
    ];
    t.setItems(newItems, 'y');

    expect(t.getActive()).toBe('y');
  });

  it('updates _tabEls map to match new items', () => {
    const t = makeTabs();
    t.mount();

    const newItems = [
      { id: 'x', label: 'X-Ray' },
      { id: 'y', label: 'Yankee' },
    ];
    t.setItems(newItems);

    expect(t._tabEls.size).toBe(2);
    expect(t._tabEls.has('x')).toBe(true);
    expect(t._tabEls.has('y')).toBe(true);
    expect(t._tabEls.has('alpha')).toBe(false);
  });

  it('sets activeId to null when given empty items', () => {
    const t = makeTabs();
    t.mount();

    t.setItems([]);

    expect(t.getActive()).toBeNull();
    expect(t.el.querySelectorAll('button.tab-item').length).toBe(0);
  });
});

// ─── Keyboard navigation ────────────────────────────────────

describe('Tabs — keyboard navigation', () => {
  function dispatchKey(el: HTMLElement, key: string) {
    const event = new KeyboardEvent('keydown', { key, bubbles: true });
    el.dispatchEvent(event);
  }

  it('ArrowRight moves to next tab', () => {
    const t = makeTabs();
    t.mount();

    dispatchKey(t.el, 'ArrowRight');

    expect(t.getActive()).toBe('beta');
  });

  it('ArrowRight wraps from last to first', () => {
    const t = makeTabs({ activeId: 'gamma' });
    t.mount();

    dispatchKey(t.el, 'ArrowRight');

    expect(t.getActive()).toBe('alpha');
  });

  it('ArrowLeft moves to previous tab', () => {
    const t = makeTabs({ activeId: 'beta' });
    t.mount();

    dispatchKey(t.el, 'ArrowLeft');

    expect(t.getActive()).toBe('alpha');
  });

  it('ArrowLeft wraps from first to last', () => {
    const t = makeTabs({ activeId: 'alpha' });
    t.mount();

    dispatchKey(t.el, 'ArrowLeft');

    expect(t.getActive()).toBe('gamma');
  });

  it('ArrowDown behaves like ArrowRight', () => {
    const t = makeTabs();
    t.mount();

    dispatchKey(t.el, 'ArrowDown');

    expect(t.getActive()).toBe('beta');
  });

  it('ArrowUp behaves like ArrowLeft', () => {
    const t = makeTabs({ activeId: 'beta' });
    t.mount();

    dispatchKey(t.el, 'ArrowUp');

    expect(t.getActive()).toBe('alpha');
  });

  it('Home moves to first tab', () => {
    const t = makeTabs({ activeId: 'gamma' });
    t.mount();

    dispatchKey(t.el, 'Home');

    expect(t.getActive()).toBe('alpha');
  });

  it('End moves to last tab', () => {
    const t = makeTabs({ activeId: 'alpha' });
    t.mount();

    dispatchKey(t.el, 'End');

    expect(t.getActive()).toBe('gamma');
  });

  it('skips disabled tabs in navigation', () => {
    const items = [
      { id: 'a', label: 'A' },
      { id: 'b', label: 'B', disabled: true },
      { id: 'c', label: 'C' },
    ];
    const t = makeTabs({ items, activeId: 'a' });
    t.mount();

    dispatchKey(t.el, 'ArrowRight');

    // Disabled tabs are filtered out, so next non-disabled after 'a' is 'c'
    expect(t.getActive()).toBe('c');
  });

  it('fires onChange on keyboard navigation', () => {
    const onChange = vi.fn();
    const t = makeTabs({ onChange });
    t.mount();

    dispatchKey(t.el, 'ArrowRight');

    expect(onChange).toHaveBeenCalledWith('beta', 'alpha');
  });

  it('focuses the newly active tab element', () => {
    const t = makeTabs();
    t.mount();

    // Spy on focus of the beta tab
    const betaBtn = t._tabEls.get('beta');
    const focusSpy = vi.spyOn(betaBtn, 'focus');

    dispatchKey(t.el, 'ArrowRight');

    expect(focusSpy).toHaveBeenCalled();
  });

  it('ignores unrelated keys', () => {
    const t = makeTabs();
    t.mount();

    dispatchKey(t.el, 'Enter');
    dispatchKey(t.el, 'Tab');
    dispatchKey(t.el, 'a');

    expect(t.getActive()).toBe('alpha');
  });
});
