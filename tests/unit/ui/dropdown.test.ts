// @vitest-environment jsdom
/**
 * Tests for public/ui/components/dropdown.js
 *
 * Covers: Dropdown construction, mount/open/close/toggle lifecycle,
 *         item rendering, dividers, disabled items, onSelect callback,
 *         setItems dynamic update, and destroy cleanup.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const dropdownPath = '../../../public/ui/components/dropdown.js';

let Dropdown: any;

beforeEach(async () => {
  // Clean up any lingering dropdown menus from prior tests
  document.body.textContent = '';

  const mod = await import(dropdownPath);
  Dropdown = mod.Dropdown;
});

// ─── Constructor ─────────────────────────────────────────────

describe('Dropdown — constructor', () => {
  it('stores opts with defaults merged', () => {
    const trigger = document.createElement('button');
    const onSelect = vi.fn();
    const dd = new Dropdown(trigger, {
      items: [{ id: 'a', label: 'Alpha' }],
      onSelect,
      searchable: true,
    });

    expect(dd.el).toBe(trigger);
    expect(dd.opts.items).toEqual([{ id: 'a', label: 'Alpha' }]);
    expect(dd.opts.onSelect).toBe(onSelect);
    expect(dd.opts.searchable).toBe(true);
    // Defaults
    expect(dd.opts.position).toBe('auto');
    expect(dd.opts.className).toBe('');
    expect(dd.opts.maxHeight).toBe(300);
  });

  it('initializes internal state flags', () => {
    const trigger = document.createElement('button');
    const dd = new Dropdown(trigger);

    expect(dd._menuEl).toBeNull();
    expect(dd._isOpen).toBe(false);
    expect(dd._searchVal).toBe('');
    expect(dd._outsideClickHandler).toBeNull();
    expect(dd._resizeHandler).toBeNull();
  });
});

// ─── mount() ─────────────────────────────────────────────────

describe('Dropdown — mount()', () => {
  it('makes trigger element clickable to toggle', () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);

    const dd = new Dropdown(trigger, {
      items: [{ id: '1', label: 'One' }],
    });
    dd.mount();

    // Click should open
    trigger.click();
    expect(dd.isOpen).toBe(true);

    // Click again should close
    trigger.click();
    expect(dd.isOpen).toBe(false);
  });

  it('sets _mounted to true', () => {
    const trigger = document.createElement('button');
    const dd = new Dropdown(trigger);
    expect(dd._mounted).toBe(false);
    dd.mount();
    expect(dd._mounted).toBe(true);
  });
});

// ─── open() ──────────────────────────────────────────────────

describe('Dropdown — open()', () => {
  it('creates .dropdown-menu in document.body', () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);

    const dd = new Dropdown(trigger, {
      items: [{ id: '1', label: 'One' }],
    });
    dd.mount();
    dd.open();

    const menu = document.body.querySelector('.dropdown-menu');
    expect(menu).not.toBeNull();
    expect(menu!.parentNode).toBe(document.body);
  });

  it('sets position:fixed on the menu', () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);

    const dd = new Dropdown(trigger, {
      items: [{ id: '1', label: 'One' }],
    });
    dd.mount();
    dd.open();

    expect(dd._menuEl.style.position).toBe('fixed');
  });

  it('does not open again if already open', () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);

    const dd = new Dropdown(trigger, {
      items: [{ id: '1', label: 'One' }],
    });
    dd.mount();
    dd.open();

    const firstMenu = dd._menuEl;
    dd.open(); // second call should be a no-op
    expect(dd._menuEl).toBe(firstMenu);
  });

  it('applies custom className to the menu', () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);

    const dd = new Dropdown(trigger, {
      items: [{ id: '1', label: 'One' }],
      className: 'my-custom-class',
    });
    dd.mount();
    dd.open();

    expect(dd._menuEl.classList.contains('dropdown-menu')).toBe(true);
    expect(dd._menuEl.classList.contains('my-custom-class')).toBe(true);
  });

  it('sets maxHeight from opts', () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);

    const dd = new Dropdown(trigger, {
      items: [{ id: '1', label: 'One' }],
      maxHeight: 500,
    });
    dd.mount();
    dd.open();

    expect(dd._menuEl.style.maxHeight).toBe('500px');
  });
});

// ─── close() ─────────────────────────────────────────────────

describe('Dropdown — close()', () => {
  it('removes menu from DOM', () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);

    const dd = new Dropdown(trigger, {
      items: [{ id: '1', label: 'One' }],
    });
    dd.mount();
    dd.open();
    expect(document.body.querySelector('.dropdown-menu')).not.toBeNull();

    dd.close();
    expect(document.body.querySelector('.dropdown-menu')).toBeNull();
    expect(dd._menuEl).toBeNull();
  });

  it('sets _isOpen to false', () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);

    const dd = new Dropdown(trigger, {
      items: [{ id: '1', label: 'One' }],
    });
    dd.mount();
    dd.open();
    expect(dd._isOpen).toBe(true);

    dd.close();
    expect(dd._isOpen).toBe(false);
  });

  it('is a no-op if already closed', () => {
    const trigger = document.createElement('button');
    const dd = new Dropdown(trigger);
    dd.mount();

    // Should not throw
    expect(() => dd.close()).not.toThrow();
    expect(dd._isOpen).toBe(false);
  });

  it('detaches outsideClick and resize handlers', () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);

    const dd = new Dropdown(trigger, {
      items: [{ id: '1', label: 'One' }],
    });
    dd.mount();
    dd.open();
    expect(dd._resizeHandler).not.toBeNull();

    dd.close();
    expect(dd._outsideClickHandler).toBeNull();
    expect(dd._resizeHandler).toBeNull();
  });
});

// ─── toggle() ────────────────────────────────────────────────

describe('Dropdown — toggle()', () => {
  it('opens when closed', () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);

    const dd = new Dropdown(trigger, {
      items: [{ id: '1', label: 'One' }],
    });
    dd.mount();

    expect(dd.isOpen).toBe(false);
    dd.toggle();
    expect(dd.isOpen).toBe(true);
  });

  it('closes when open', () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);

    const dd = new Dropdown(trigger, {
      items: [{ id: '1', label: 'One' }],
    });
    dd.mount();

    dd.open();
    expect(dd.isOpen).toBe(true);
    dd.toggle();
    expect(dd.isOpen).toBe(false);
  });
});

// ─── isOpen getter ───────────────────────────────────────────

describe('Dropdown — isOpen getter', () => {
  it('returns false initially', () => {
    const trigger = document.createElement('button');
    const dd = new Dropdown(trigger);
    expect(dd.isOpen).toBe(false);
  });

  it('returns true after open()', () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);

    const dd = new Dropdown(trigger, {
      items: [{ id: '1', label: 'One' }],
    });
    dd.mount();
    dd.open();
    expect(dd.isOpen).toBe(true);
  });

  it('returns false after close()', () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);

    const dd = new Dropdown(trigger, {
      items: [{ id: '1', label: 'One' }],
    });
    dd.mount();
    dd.open();
    dd.close();
    expect(dd.isOpen).toBe(false);
  });
});

// ─── Items rendering ─────────────────────────────────────────

describe('Dropdown — items rendering', () => {
  it('renders correct number of dropdown-item elements', () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);

    const items = [
      { id: 'a', label: 'Alpha' },
      { id: 'b', label: 'Beta' },
      { id: 'c', label: 'Gamma' },
    ];

    const dd = new Dropdown(trigger, { items });
    dd.mount();
    dd.open();

    const rendered = dd._menuEl.querySelectorAll('.dropdown-item');
    expect(rendered.length).toBe(3);
  });

  it('renders item labels correctly', () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);

    const items = [
      { id: 'a', label: 'Alpha' },
      { id: 'b', label: 'Beta' },
    ];

    const dd = new Dropdown(trigger, { items });
    dd.mount();
    dd.open();

    const labels = dd._menuEl.querySelectorAll('.dropdown-label');
    expect(labels[0].textContent).toBe('Alpha');
    expect(labels[1].textContent).toBe('Beta');
  });

  it('renders icons when provided', () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);

    const items = [
      { id: 'a', label: 'Settings', icon: '\u2699' },
    ];

    const dd = new Dropdown(trigger, { items });
    dd.mount();
    dd.open();

    const icon = dd._menuEl.querySelector('.dropdown-icon');
    expect(icon).not.toBeNull();
    expect(icon.textContent).toBe('\u2699');
  });

  it('does not render icon span when icon is missing', () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);

    const items = [{ id: 'a', label: 'No Icon' }];

    const dd = new Dropdown(trigger, { items });
    dd.mount();
    dd.open();

    const icon = dd._menuEl.querySelector('.dropdown-icon');
    expect(icon).toBeNull();
  });

  it('adds data-dropdown-id attribute to items', () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);

    const items = [{ id: 'my-item', label: 'Test' }];

    const dd = new Dropdown(trigger, { items });
    dd.mount();
    dd.open();

    const el = dd._menuEl.querySelector('.dropdown-item');
    expect(el.getAttribute('data-dropdown-id')).toBe('my-item');
  });

  it('adds "disabled" class to disabled items', () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);

    const items = [
      { id: 'a', label: 'Enabled' },
      { id: 'b', label: 'Disabled', disabled: true },
    ];

    const dd = new Dropdown(trigger, { items });
    dd.mount();
    dd.open();

    const rendered = dd._menuEl.querySelectorAll('.dropdown-item');
    expect(rendered[0].classList.contains('disabled')).toBe(false);
    expect(rendered[1].classList.contains('disabled')).toBe(true);
  });

  it('adds "danger" class to danger items', () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);

    const items = [{ id: 'del', label: 'Delete', danger: true }];

    const dd = new Dropdown(trigger, { items });
    dd.mount();
    dd.open();

    const el = dd._menuEl.querySelector('.dropdown-item');
    expect(el.classList.contains('danger')).toBe(true);
  });
});

// ─── Disabled items don't fire onSelect ──────────────────────

describe('Dropdown — disabled items', () => {
  it('does not call onSelect when a disabled item is clicked', () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);

    const onSelect = vi.fn();
    const items = [
      { id: 'dis', label: 'Disabled', disabled: true },
    ];

    const dd = new Dropdown(trigger, { items, onSelect });
    dd.mount();
    dd.open();

    const disabledEl = dd._menuEl.querySelector('.dropdown-item.disabled');
    disabledEl.click();

    expect(onSelect).not.toHaveBeenCalled();
    // Menu should still be open since disabled items have no click handler
    expect(dd.isOpen).toBe(true);
  });
});

// ─── Non-disabled items call onSelect and close ──────────────

describe('Dropdown — item selection', () => {
  it('calls onSelect with the item and closes the menu', () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);

    const onSelect = vi.fn();
    const items = [
      { id: 'a', label: 'Alpha' },
      { id: 'b', label: 'Beta' },
    ];

    const dd = new Dropdown(trigger, { items, onSelect });
    dd.mount();
    dd.open();

    const secondItem = dd._menuEl.querySelectorAll('.dropdown-item')[1];
    secondItem.click();

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(items[1]);
    expect(dd.isOpen).toBe(false);
  });

  it('closes even if onSelect is not provided', () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);

    const items = [{ id: 'a', label: 'Alpha' }];

    const dd = new Dropdown(trigger, { items });
    dd.mount();
    dd.open();

    const el = dd._menuEl.querySelector('.dropdown-item');
    el.click();

    expect(dd.isOpen).toBe(false);
  });
});

// ─── Divider items ───────────────────────────────────────────

describe('Dropdown — divider items', () => {
  it('renders divider items as .dropdown-divider', () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);

    const items = [
      { id: 'a', label: 'Alpha' },
      { divider: true },
      { id: 'b', label: 'Beta' },
    ];

    const dd = new Dropdown(trigger, { items });
    dd.mount();
    dd.open();

    const dividers = dd._menuEl.querySelectorAll('.dropdown-divider');
    expect(dividers.length).toBe(1);

    // Only two real items (divider is not a .dropdown-item)
    const regularItems = dd._menuEl.querySelectorAll('.dropdown-item');
    expect(regularItems.length).toBe(2);
  });

  it('renders multiple dividers correctly', () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);

    const items = [
      { id: 'a', label: 'A' },
      { divider: true },
      { id: 'b', label: 'B' },
      { divider: true },
      { id: 'c', label: 'C' },
    ];

    const dd = new Dropdown(trigger, { items });
    dd.mount();
    dd.open();

    const dividers = dd._menuEl.querySelectorAll('.dropdown-divider');
    expect(dividers.length).toBe(2);
  });
});

// ─── setItems() ──────────────────────────────────────────────

describe('Dropdown — setItems()', () => {
  it('updates items when closed (no DOM rebuild)', () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);

    const dd = new Dropdown(trigger, {
      items: [{ id: 'a', label: 'Alpha' }],
    });
    dd.mount();

    dd.setItems([{ id: 'x', label: 'X-Ray' }, { id: 'y', label: 'Yankee' }]);
    expect(dd.opts.items.length).toBe(2);
    expect(dd.opts.items[0].id).toBe('x');
  });

  it('re-renders when open (close+open cycle)', () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);

    const dd = new Dropdown(trigger, {
      items: [{ id: 'a', label: 'Alpha' }],
    });
    dd.mount();
    dd.open();

    let items = dd._menuEl.querySelectorAll('.dropdown-item');
    expect(items.length).toBe(1);

    dd.setItems([
      { id: 'x', label: 'X-Ray' },
      { id: 'y', label: 'Yankee' },
      { id: 'z', label: 'Zulu' },
    ]);

    // Should still be open with updated items
    expect(dd.isOpen).toBe(true);
    items = dd._menuEl.querySelectorAll('.dropdown-item');
    expect(items.length).toBe(3);
  });
});

// ─── destroy() ───────────────────────────────────────────────

describe('Dropdown — destroy()', () => {
  it('closes menu if open', () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);

    const dd = new Dropdown(trigger, {
      items: [{ id: '1', label: 'One' }],
    });
    dd.mount();
    dd.open();

    dd.destroy();
    expect(dd.isOpen).toBe(false);
    expect(document.body.querySelector('.dropdown-menu')).toBeNull();
  });

  it('removes trigger click handler (via parent destroy)', () => {
    const trigger = document.createElement('button');
    const parent = document.createElement('div');
    parent.appendChild(trigger);
    document.body.appendChild(parent);

    const dd = new Dropdown(trigger, {
      items: [{ id: '1', label: 'One' }],
    });
    dd.mount();
    dd.destroy();

    // After destroy, clicking trigger should NOT open a menu
    trigger.click();
    expect(document.body.querySelector('.dropdown-menu')).toBeNull();
  });

  it('cleans up _listeners array', () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);

    const dd = new Dropdown(trigger, {
      items: [{ id: '1', label: 'One' }],
    });
    dd.mount();
    expect(dd._listeners.length).toBeGreaterThan(0);

    dd.destroy();
    expect(dd._listeners).toEqual([]);
  });
});

// ─── Keyboard navigation ─────────────────────────────────────

function pressKey(key: string) {
  document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
}

describe('Dropdown — keyboard navigation', () => {
  it('ArrowDown highlights the first item', () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);

    const items = [
      { id: 'a', label: 'Alpha' },
      { id: 'b', label: 'Beta' },
      { id: 'c', label: 'Gamma' },
    ];

    const dd = new Dropdown(trigger, { items });
    dd.mount();
    dd.open();

    pressKey('ArrowDown');

    const highlighted = dd._menuEl.querySelector('.dropdown-item.highlighted');
    expect(highlighted).not.toBeNull();
    expect(highlighted.getAttribute('data-dropdown-id')).toBe('a');
  });

  it('ArrowDown moves highlight to next item', () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);

    const items = [
      { id: 'a', label: 'Alpha' },
      { id: 'b', label: 'Beta' },
      { id: 'c', label: 'Gamma' },
    ];

    const dd = new Dropdown(trigger, { items });
    dd.mount();
    dd.open();

    pressKey('ArrowDown'); // → Alpha
    pressKey('ArrowDown'); // → Beta

    const highlighted = dd._menuEl.querySelectorAll('.dropdown-item.highlighted');
    expect(highlighted.length).toBe(1);
    expect(highlighted[0].getAttribute('data-dropdown-id')).toBe('b');
  });

  it('ArrowDown wraps from last to first item', () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);

    const items = [
      { id: 'a', label: 'Alpha' },
      { id: 'b', label: 'Beta' },
    ];

    const dd = new Dropdown(trigger, { items });
    dd.mount();
    dd.open();

    pressKey('ArrowDown'); // → Alpha
    pressKey('ArrowDown'); // → Beta
    pressKey('ArrowDown'); // → wraps to Alpha

    const highlighted = dd._menuEl.querySelector('.dropdown-item.highlighted');
    expect(highlighted.getAttribute('data-dropdown-id')).toBe('a');
  });

  it('ArrowUp highlights the last item when no highlight exists', () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);

    const items = [
      { id: 'a', label: 'Alpha' },
      { id: 'b', label: 'Beta' },
      { id: 'c', label: 'Gamma' },
    ];

    const dd = new Dropdown(trigger, { items });
    dd.mount();
    dd.open();

    pressKey('ArrowUp');

    const highlighted = dd._menuEl.querySelector('.dropdown-item.highlighted');
    expect(highlighted.getAttribute('data-dropdown-id')).toBe('c');
  });

  it('ArrowUp wraps from first to last item', () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);

    const items = [
      { id: 'a', label: 'Alpha' },
      { id: 'b', label: 'Beta' },
    ];

    const dd = new Dropdown(trigger, { items });
    dd.mount();
    dd.open();

    pressKey('ArrowDown'); // → Alpha (idx 0)
    pressKey('ArrowUp');   // → wraps to Beta (idx 1)

    const highlighted = dd._menuEl.querySelector('.dropdown-item.highlighted');
    expect(highlighted.getAttribute('data-dropdown-id')).toBe('b');
  });

  it('skips disabled items during navigation', () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);

    const items = [
      { id: 'a', label: 'Alpha' },
      { id: 'b', label: 'Beta', disabled: true },
      { id: 'c', label: 'Gamma' },
    ];

    const dd = new Dropdown(trigger, { items });
    dd.mount();
    dd.open();

    pressKey('ArrowDown'); // → Alpha
    pressKey('ArrowDown'); // → skips Beta (disabled), goes to Gamma

    const highlighted = dd._menuEl.querySelector('.dropdown-item.highlighted');
    expect(highlighted.getAttribute('data-dropdown-id')).toBe('c');
  });

  it('Enter selects the highlighted item', () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);

    const onSelect = vi.fn();
    const items = [
      { id: 'a', label: 'Alpha' },
      { id: 'b', label: 'Beta' },
    ];

    const dd = new Dropdown(trigger, { items, onSelect });
    dd.mount();
    dd.open();

    pressKey('ArrowDown'); // → Alpha
    pressKey('ArrowDown'); // → Beta
    pressKey('Enter');

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(items[1]);
    expect(dd.isOpen).toBe(false);
  });

  it('Space selects the highlighted item', () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);

    const onSelect = vi.fn();
    const items = [
      { id: 'a', label: 'Alpha' },
    ];

    const dd = new Dropdown(trigger, { items, onSelect });
    dd.mount();
    dd.open();

    pressKey('ArrowDown'); // → Alpha
    pressKey(' ');

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(items[0]);
  });

  it('Enter does nothing when no item is highlighted', () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);

    const onSelect = vi.fn();
    const items = [
      { id: 'a', label: 'Alpha' },
    ];

    const dd = new Dropdown(trigger, { items, onSelect });
    dd.mount();
    dd.open();

    pressKey('Enter');

    expect(onSelect).not.toHaveBeenCalled();
    expect(dd.isOpen).toBe(true);
  });

  it('Escape closes the dropdown', () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);

    const dd = new Dropdown(trigger, {
      items: [{ id: 'a', label: 'Alpha' }],
    });
    dd.mount();
    dd.open();
    expect(dd.isOpen).toBe(true);

    pressKey('Escape');

    expect(dd.isOpen).toBe(false);
  });

  it('Escape returns focus to trigger element', () => {
    const trigger = document.createElement('button');
    trigger.tabIndex = 0;
    document.body.appendChild(trigger);

    const dd = new Dropdown(trigger, {
      items: [{ id: 'a', label: 'Alpha' }],
    });
    dd.mount();
    dd.open();

    const focusSpy = vi.spyOn(trigger, 'focus');
    pressKey('Escape');

    expect(focusSpy).toHaveBeenCalled();
  });

  it('close() returns focus to trigger element', () => {
    const trigger = document.createElement('button');
    trigger.tabIndex = 0;
    document.body.appendChild(trigger);

    const dd = new Dropdown(trigger, {
      items: [{ id: 'a', label: 'Alpha' }],
    });
    dd.mount();
    dd.open();

    const focusSpy = vi.spyOn(trigger, 'focus');
    dd.close();

    expect(focusSpy).toHaveBeenCalled();
  });

  it('detaches keydown handler on close', () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);

    const dd = new Dropdown(trigger, {
      items: [{ id: 'a', label: 'Alpha' }],
    });
    dd.mount();
    dd.open();
    expect(dd._keydownHandler).not.toBeNull();

    dd.close();
    expect(dd._keydownHandler).toBeNull();
  });

  it('resets highlight index on re-open', () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);

    const items = [
      { id: 'a', label: 'Alpha' },
      { id: 'b', label: 'Beta' },
    ];

    const dd = new Dropdown(trigger, { items });
    dd.mount();

    dd.open();
    pressKey('ArrowDown'); // → Alpha
    pressKey('ArrowDown'); // → Beta
    dd.close();

    dd.open();
    pressKey('ArrowDown'); // should start at Alpha again

    const highlighted = dd._menuEl.querySelector('.dropdown-item.highlighted');
    expect(highlighted.getAttribute('data-dropdown-id')).toBe('a');
  });
});
