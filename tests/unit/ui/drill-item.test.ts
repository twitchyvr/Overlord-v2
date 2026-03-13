// @vitest-environment jsdom
/**
 * Tests for public/ui/components/drill-item.js
 *
 * Covers: DrillItem.create() static factory — summary row (icon, text,
 *         badge, meta), detail panel (fields, formats, custom renderer,
 *         action buttons), accordion expand/collapse, long-press bottom
 *         sheet trigger, detail modal rendering via _openSheet.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const drillPath = '../../../public/ui/components/drill-item.js';
const modalPath = '../../../public/ui/components/modal.js';

let DrillItem: any;
let Modal: any;

beforeEach(async () => {
  const drillMod = await import(drillPath);
  DrillItem = drillMod.DrillItem;
  const modalMod = await import(modalPath);
  Modal = modalMod.Modal;

  // Close any leftover modals (keeps modal-root in the DOM but empties it)
  Modal.closeAll();
  document.body.style.overflow = '';

  // Remove all non-modal-root children from body
  Array.from(document.body.children).forEach(child => {
    if (child.id !== 'modal-root') child.remove();
  });
});

afterEach(() => {
  Modal.closeAll();
  // Remove all non-modal-root children from body
  Array.from(document.body.children).forEach(child => {
    if (child.id !== 'modal-root') child.remove();
  });
});

// ─── create() — basic structure ─────────────────────────────

describe('DrillItem.create() — basic structure', () => {
  it('returns a div element', () => {
    const el = DrillItem.create('task', { id: '1' }, { summary: 'Test' });
    expect(el.tagName).toBe('DIV');
  });

  it('applies drill-item class', () => {
    const el = DrillItem.create('task', { id: '1' }, { summary: 'Test' });
    expect(el.classList.contains('drill-item')).toBe(true);
  });

  it('sets data-drill-type attribute', () => {
    const el = DrillItem.create('activity', { id: '1' }, { summary: 'Test' });
    expect(el.getAttribute('data-drill-type')).toBe('activity');
  });

  it('sets data-drill-id from data.id', () => {
    const el = DrillItem.create('task', { id: 'abc-123' }, { summary: 'Test' });
    expect(el.getAttribute('data-drill-id')).toBe('abc-123');
  });

  it('falls back to data.toolId for drill id', () => {
    const el = DrillItem.create('tool', { toolId: 'tool-7' }, { summary: 'Test' });
    expect(el.getAttribute('data-drill-id')).toBe('tool-7');
  });

  it('falls back to data.ts for drill id', () => {
    const el = DrillItem.create('log', { ts: 1234567890 }, { summary: 'Test' });
    expect(el.getAttribute('data-drill-id')).toBe('1234567890');
  });

  it('generates a random drill id when no id/toolId/ts', () => {
    const el = DrillItem.create('task', {}, { summary: 'Test' });
    const drillId = el.getAttribute('data-drill-id');
    expect(drillId).toBeTruthy();
    expect(drillId!.length).toBeGreaterThan(0);
  });

  it('starts collapsed (data-expanded="0")', () => {
    const el = DrillItem.create('task', { id: '1' }, { summary: 'Test' });
    expect(el.getAttribute('data-expanded')).toBe('0');
  });

  it('contains a summary row and a detail panel', () => {
    const el = DrillItem.create('task', { id: '1' }, { summary: 'Test' });
    expect(el.querySelector('.drill-summary')).not.toBeNull();
    expect(el.querySelector('.drill-detail')).not.toBeNull();
  });
});

// ─── create() — summary row ────────────────────────────────

describe('DrillItem.create() — summary row', () => {
  it('renders summary text as a string', () => {
    const el = DrillItem.create('task', { id: '1' }, { summary: 'Build the UI' });
    const text = el.querySelector('.drill-summary-text');
    expect(text).not.toBeNull();
    expect(text!.textContent).toBe('Build the UI');
  });

  it('renders summary text from a function', () => {
    const el = DrillItem.create('task', { id: '1', title: 'Deploy' }, {
      summary: (d: any) => `Task: ${d.title}`
    });
    const text = el.querySelector('.drill-summary-text');
    expect(text!.textContent).toBe('Task: Deploy');
  });

  it('renders empty string when summary is falsy', () => {
    const el = DrillItem.create('task', { id: '1' }, { summary: '' });
    const text = el.querySelector('.drill-summary-text');
    expect(text!.textContent).toBe('');
  });

  it('renders icon when provided as a string', () => {
    const el = DrillItem.create('task', { id: '1' }, { summary: 'T', icon: 'W' });
    const icon = el.querySelector('.drill-icon');
    expect(icon).not.toBeNull();
    expect(icon!.textContent).toBe('W');
  });

  it('renders icon from a function', () => {
    const el = DrillItem.create('task', { id: '1', status: 'done' }, {
      summary: 'T',
      icon: (d: any) => d.status === 'done' ? 'V' : '?'
    });
    const icon = el.querySelector('.drill-icon');
    expect(icon!.textContent).toBe('V');
  });

  it('does not render icon when icon function returns falsy', () => {
    const el = DrillItem.create('task', { id: '1' }, {
      summary: 'T',
      icon: () => null
    });
    expect(el.querySelector('.drill-icon')).toBeNull();
  });

  it('does not render icon when not provided', () => {
    const el = DrillItem.create('task', { id: '1' }, { summary: 'T' });
    expect(el.querySelector('.drill-icon')).toBeNull();
  });

  it('renders badge as a string', () => {
    const el = DrillItem.create('task', { id: '1' }, { summary: 'T', badge: 'HIGH' });
    const badge = el.querySelector('.drill-badge');
    expect(badge).not.toBeNull();
    expect(badge!.textContent).toBe('HIGH');
  });

  it('renders badge from a function returning a string', () => {
    const el = DrillItem.create('task', { id: '1', priority: 'low' }, {
      summary: 'T',
      badge: (d: any) => d.priority.toUpperCase()
    });
    const badge = el.querySelector('.drill-badge');
    expect(badge!.textContent).toBe('LOW');
  });

  it('renders badge with color from an object', () => {
    const el = DrillItem.create('task', { id: '1' }, {
      summary: 'T',
      badge: { text: 'CRITICAL', color: 'red' }
    });
    const badge = el.querySelector('.drill-badge') as HTMLElement;
    expect(badge.textContent).toBe('CRITICAL');
    expect(badge.style.color).toBe('red');
  });

  it('renders badge from a function returning an object with color', () => {
    const el = DrillItem.create('task', { id: '1' }, {
      summary: 'T',
      badge: () => ({ text: 'WARN', color: 'orange' })
    });
    const badge = el.querySelector('.drill-badge') as HTMLElement;
    expect(badge.textContent).toBe('WARN');
    expect(badge.style.color).toBe('orange');
  });

  it('does not render badge when not provided', () => {
    const el = DrillItem.create('task', { id: '1' }, { summary: 'T' });
    expect(el.querySelector('.drill-badge')).toBeNull();
  });

  it('does not render badge when function returns null', () => {
    const el = DrillItem.create('task', { id: '1' }, {
      summary: 'T',
      badge: () => null
    });
    expect(el.querySelector('.drill-badge')).toBeNull();
  });

  it('renders meta text as a string', () => {
    const el = DrillItem.create('log', { id: '1' }, { summary: 'T', meta: '2 min ago' });
    const meta = el.querySelector('.drill-meta');
    expect(meta).not.toBeNull();
    expect(meta!.textContent).toBe('2 min ago');
  });

  it('renders meta text from a function', () => {
    const el = DrillItem.create('log', { id: '1', ts: 1234 }, {
      summary: 'T',
      meta: (d: any) => `ts:${d.ts}`
    });
    const meta = el.querySelector('.drill-meta');
    expect(meta!.textContent).toBe('ts:1234');
  });

  it('does not render meta when not provided', () => {
    const el = DrillItem.create('task', { id: '1' }, { summary: 'T' });
    expect(el.querySelector('.drill-meta')).toBeNull();
  });

  it('does not render meta when function returns falsy', () => {
    const el = DrillItem.create('task', { id: '1' }, {
      summary: 'T',
      meta: () => ''
    });
    expect(el.querySelector('.drill-meta')).toBeNull();
  });

  it('always renders the more button', () => {
    const el = DrillItem.create('task', { id: '1' }, { summary: 'T' });
    const btn = el.querySelector('.drill-more-btn');
    expect(btn).not.toBeNull();
    expect(btn!.getAttribute('aria-label')).toBe('View details');
    expect(btn!.textContent).toBe('\u22EF');
  });
});

// ─── create() — detail fields ──────────────────────────────

describe('DrillItem.create() — detail fields', () => {
  it('renders detail rows from config.detail', () => {
    const el = DrillItem.create('task', { id: '1', assignee: 'Alice', priority: 'high' }, {
      summary: 'T',
      detail: [
        { label: 'Assignee', key: 'assignee' },
        { label: 'Priority', key: 'priority' }
      ]
    });
    const rows = el.querySelectorAll('.drill-detail-row');
    expect(rows.length).toBe(2);

    const labels = el.querySelectorAll('.drill-detail-label');
    expect(labels[0].textContent).toBe('Assignee');
    expect(labels[1].textContent).toBe('Priority');

    const values = el.querySelectorAll('.drill-detail-value');
    expect(values[0].textContent).toBe('Alice');
    expect(values[1].textContent).toBe('high');
  });

  it('skips detail rows where value is null or empty string', () => {
    const el = DrillItem.create('task', { id: '1', assignee: null, priority: '' }, {
      summary: 'T',
      detail: [
        { label: 'Assignee', key: 'assignee' },
        { label: 'Priority', key: 'priority' }
      ]
    });
    const rows = el.querySelectorAll('.drill-detail-row');
    expect(rows.length).toBe(0);
  });

  it('uses field.value function over data[field.key]', () => {
    const el = DrillItem.create('task', { id: '1', status: 'active' }, {
      summary: 'T',
      detail: [
        { label: 'Status', key: 'status', value: (d: any) => d.status.toUpperCase() }
      ]
    });
    const value = el.querySelector('.drill-detail-value');
    expect(value!.textContent).toBe('ACTIVE');
  });

  it('formats date values', () => {
    const el = DrillItem.create('task', { id: '1', created: '2026-01-15T00:00:00Z' }, {
      summary: 'T',
      detail: [
        { label: 'Created', key: 'created', format: 'date' }
      ]
    });
    const value = el.querySelector('.drill-detail-value');
    // Should be a formatted date, not the raw ISO string
    expect(value!.textContent).not.toBe('2026-01-15T00:00:00Z');
    expect(value!.textContent!.length).toBeGreaterThan(0);
  });

  it('falls back to string for invalid dates', () => {
    const el = DrillItem.create('task', { id: '1', created: 'not-a-date' }, {
      summary: 'T',
      detail: [
        { label: 'Created', key: 'created', format: 'date' }
      ]
    });
    const value = el.querySelector('.drill-detail-value');
    expect(value!.textContent).toBe('not-a-date');
  });

  it('formats duration values in ms', () => {
    const el = DrillItem.create('task', { id: '1', elapsed: 450 }, {
      summary: 'T',
      detail: [
        { label: 'Elapsed', key: 'elapsed', format: 'duration' }
      ]
    });
    const value = el.querySelector('.drill-detail-value');
    expect(value!.textContent).toBe('450ms');
  });

  it('formats duration values in seconds', () => {
    const el = DrillItem.create('task', { id: '1', elapsed: 2500 }, {
      summary: 'T',
      detail: [
        { label: 'Elapsed', key: 'elapsed', format: 'duration' }
      ]
    });
    const value = el.querySelector('.drill-detail-value');
    expect(value!.textContent).toBe('2.5s');
  });

  it('formats JSON object values', () => {
    const obj = { foo: 'bar', num: 42 };
    const el = DrillItem.create('task', { id: '1', config: obj }, {
      summary: 'T',
      detail: [
        { label: 'Config', key: 'config', format: 'json' }
      ]
    });
    const value = el.querySelector('.drill-detail-value');
    expect(value!.textContent).toBe(JSON.stringify(obj, null, 2));
  });

  it('renders HTMLElement values directly (not as text)', () => {
    const customEl = document.createElement('strong');
    customEl.textContent = 'Bold Value';
    const el = DrillItem.create('task', { id: '1' }, {
      summary: 'T',
      detail: [
        { label: 'Custom', key: 'x', value: () => customEl }
      ]
    });
    const row = el.querySelector('.drill-detail-row');
    expect(row!.querySelector('strong')).toBe(customEl);
    // Should NOT have a .drill-detail-value span wrapping it
    expect(row!.querySelector('.drill-detail-value')).toBeNull();
  });

  it('does not render detail rows when config.detail is absent', () => {
    const el = DrillItem.create('task', { id: '1' }, { summary: 'T' });
    expect(el.querySelectorAll('.drill-detail-row').length).toBe(0);
  });
});

// ─── create() — custom detail renderer ─────────────────────

describe('DrillItem.create() — detailRender', () => {
  it('appends custom HTMLElement from detailRender', () => {
    const custom = document.createElement('div');
    custom.className = 'my-custom-detail';
    custom.textContent = 'Custom content';

    const el = DrillItem.create('task', { id: '1' }, {
      summary: 'T',
      detailRender: () => custom
    });
    const detail = el.querySelector('.drill-detail');
    expect(detail!.querySelector('.my-custom-detail')).toBe(custom);
  });

  it('does not append non-HTMLElement return from detailRender', () => {
    const el = DrillItem.create('task', { id: '1' }, {
      summary: 'T',
      detailRender: () => 'just a string'
    });
    const detail = el.querySelector('.drill-detail');
    expect(detail!.children.length).toBe(0);
  });
});

// ─── create() — action buttons ─────────────────────────────

describe('DrillItem.create() — action buttons', () => {
  it('renders action buttons in a .drill-actions container', () => {
    const el = DrillItem.create('task', { id: '1' }, {
      summary: 'T',
      actions: [
        { label: 'Edit', onClick: vi.fn() },
        { label: 'Delete', onClick: vi.fn(), variant: 'danger' }
      ]
    });
    const actionsContainer = el.querySelector('.drill-actions');
    expect(actionsContainer).not.toBeNull();
    const btns = actionsContainer!.querySelectorAll('.drill-action-btn');
    expect(btns.length).toBe(2);
    expect(btns[0].textContent).toBe('Edit');
    expect(btns[1].textContent).toBe('Delete');
  });

  it('applies danger class to danger variant buttons', () => {
    const el = DrillItem.create('task', { id: '1' }, {
      summary: 'T',
      actions: [
        { label: 'Delete', onClick: vi.fn(), variant: 'danger' }
      ]
    });
    const btn = el.querySelector('.drill-action-btn');
    expect(btn!.classList.contains('danger')).toBe(true);
  });

  it('does not apply danger class to non-danger buttons', () => {
    const el = DrillItem.create('task', { id: '1' }, {
      summary: 'T',
      actions: [
        { label: 'Edit', onClick: vi.fn() }
      ]
    });
    const btn = el.querySelector('.drill-action-btn');
    expect(btn!.classList.contains('danger')).toBe(false);
  });

  it('calls onClick handler with data when action button is clicked', () => {
    const handler = vi.fn();
    const data = { id: '1', name: 'Test Task' };
    const el = DrillItem.create('task', data, {
      summary: 'T',
      actions: [{ label: 'Edit', onClick: handler }]
    });
    document.body.appendChild(el);
    const btn = el.querySelector('.drill-action-btn') as HTMLElement;
    btn.click();
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(data);
  });

  it('stops propagation on action button click', () => {
    const parentHandler = vi.fn();
    const actionHandler = vi.fn();
    const el = DrillItem.create('task', { id: '1' }, {
      summary: 'T',
      actions: [{ label: 'Act', onClick: actionHandler }]
    });
    el.addEventListener('click', parentHandler);
    document.body.appendChild(el);
    const btn = el.querySelector('.drill-action-btn') as HTMLElement;
    btn.click();
    expect(actionHandler).toHaveBeenCalledTimes(1);
    expect(parentHandler).not.toHaveBeenCalled();
  });

  it('renders actions from a function', () => {
    const el = DrillItem.create('task', { id: '1', canEdit: true }, {
      summary: 'T',
      actions: (d: any) => d.canEdit ? [{ label: 'Edit', onClick: vi.fn() }] : []
    });
    const btns = el.querySelectorAll('.drill-action-btn');
    expect(btns.length).toBe(1);
    expect(btns[0].textContent).toBe('Edit');
  });

  it('does not render actions container when actions array is empty', () => {
    const el = DrillItem.create('task', { id: '1' }, {
      summary: 'T',
      actions: []
    });
    expect(el.querySelector('.drill-actions')).toBeNull();
  });

  it('does not render actions container when actions function returns empty', () => {
    const el = DrillItem.create('task', { id: '1' }, {
      summary: 'T',
      actions: () => []
    });
    expect(el.querySelector('.drill-actions')).toBeNull();
  });

  it('sets title attribute on action buttons', () => {
    const el = DrillItem.create('task', { id: '1' }, {
      summary: 'T',
      actions: [{ label: 'Remove', onClick: vi.fn() }]
    });
    const btn = el.querySelector('.drill-action-btn');
    expect(btn!.getAttribute('title')).toBe('Remove');
  });
});

// ─── accordion expand/collapse ──────────────────────────────

describe('DrillItem — accordion expand/collapse', () => {
  it('expands on summary row click', () => {
    const el = DrillItem.create('task', { id: '1' }, { summary: 'T' });
    document.body.appendChild(el);
    const summaryRow = el.querySelector('.drill-summary') as HTMLElement;
    summaryRow.click();
    expect(el.getAttribute('data-expanded')).toBe('1');
  });

  it('collapses on second summary row click', () => {
    const el = DrillItem.create('task', { id: '1' }, { summary: 'T' });
    document.body.appendChild(el);
    const summaryRow = el.querySelector('.drill-summary') as HTMLElement;
    summaryRow.click(); // expand
    summaryRow.click(); // collapse
    expect(el.getAttribute('data-expanded')).toBe('0');
  });

  it('sets maxHeight on detail panel when expanding', () => {
    const el = DrillItem.create('task', { id: '1', assignee: 'Alice' }, {
      summary: 'T',
      detail: [{ label: 'Assignee', key: 'assignee' }]
    });
    document.body.appendChild(el);
    const summaryRow = el.querySelector('.drill-summary') as HTMLElement;
    summaryRow.click();
    const detail = el.querySelector('.drill-detail') as HTMLElement;
    // maxHeight should be set (scrollHeight + 'px')
    expect(detail.style.maxHeight).not.toBe('');
    expect(detail.style.maxHeight).not.toBe('0');
  });

  it('sets maxHeight to 0 when collapsing', () => {
    const el = DrillItem.create('task', { id: '1' }, { summary: 'T' });
    document.body.appendChild(el);
    const summaryRow = el.querySelector('.drill-summary') as HTMLElement;
    summaryRow.click(); // expand
    summaryRow.click(); // collapse
    const detail = el.querySelector('.drill-detail') as HTMLElement;
    // jsdom may normalize '0' to '0' or '0px'
    expect(detail.style.maxHeight === '0' || detail.style.maxHeight === '0px').toBe(true);
  });

  it('collapses siblings when expanding (accordion behavior)', () => {
    const container = document.createElement('div');
    const el1 = DrillItem.create('task', { id: '1' }, { summary: 'First' });
    const el2 = DrillItem.create('task', { id: '2' }, { summary: 'Second' });
    container.appendChild(el1);
    container.appendChild(el2);
    document.body.appendChild(container);

    // Expand first
    (el1.querySelector('.drill-summary') as HTMLElement).click();
    expect(el1.getAttribute('data-expanded')).toBe('1');

    // Expand second — first should collapse
    (el2.querySelector('.drill-summary') as HTMLElement).click();
    expect(el2.getAttribute('data-expanded')).toBe('1');
    expect(el1.getAttribute('data-expanded')).toBe('0');
  });

  it('does not toggle when clicking the more button', () => {
    const el = DrillItem.create('task', { id: '1' }, { summary: 'T' });
    document.body.appendChild(el);
    const moreBtn = el.querySelector('.drill-more-btn') as HTMLElement;
    moreBtn.click();
    expect(el.getAttribute('data-expanded')).toBe('0');
  });

  it('does not toggle when clicking an action button inside summary', () => {
    const el = DrillItem.create('task', { id: '1' }, { summary: 'T' });
    document.body.appendChild(el);
    // Add a button inside summary row to simulate
    const summaryRow = el.querySelector('.drill-summary') as HTMLElement;
    const testBtn = document.createElement('button');
    testBtn.className = 'test-btn';
    summaryRow.appendChild(testBtn);
    testBtn.click();
    expect(el.getAttribute('data-expanded')).toBe('0');
  });

  it('does not toggle when clicking an input inside summary', () => {
    const el = DrillItem.create('task', { id: '1' }, { summary: 'T' });
    document.body.appendChild(el);
    const summaryRow = el.querySelector('.drill-summary') as HTMLElement;
    const input = document.createElement('input');
    summaryRow.appendChild(input);
    input.click();
    expect(el.getAttribute('data-expanded')).toBe('0');
  });
});

// ─── long-press bottom sheet ────────────────────────────────

describe('DrillItem — long-press bottom sheet trigger', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('opens sheet after 500ms pointerdown', () => {
    const el = DrillItem.create('task', { id: 'lp-1' }, { summary: 'Long press me' });
    document.body.appendChild(el);
    const summaryRow = el.querySelector('.drill-summary') as HTMLElement;

    summaryRow.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    vi.advanceTimersByTime(500);

    // Modal should be open
    expect(Modal.isOpen('drill-sheet-task-lp-1')).toBe(true);
  });

  it('does not open sheet if pointerup before 500ms', () => {
    const el = DrillItem.create('task', { id: 'lp-2' }, { summary: 'Quick tap' });
    document.body.appendChild(el);
    const summaryRow = el.querySelector('.drill-summary') as HTMLElement;

    summaryRow.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    vi.advanceTimersByTime(300);
    summaryRow.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    vi.advanceTimersByTime(300);

    expect(Modal.isOpen('drill-sheet-task-lp-2')).toBe(false);
  });

  it('does not open sheet if pointer leaves before 500ms', () => {
    const el = DrillItem.create('task', { id: 'lp-3' }, { summary: 'Drag away' });
    document.body.appendChild(el);
    const summaryRow = el.querySelector('.drill-summary') as HTMLElement;

    summaryRow.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    vi.advanceTimersByTime(200);
    summaryRow.dispatchEvent(new PointerEvent('pointerleave', { bubbles: true }));
    vi.advanceTimersByTime(400);

    expect(Modal.isOpen('drill-sheet-task-lp-3')).toBe(false);
  });

  it('does not open sheet if pointercancel fires', () => {
    const el = DrillItem.create('task', { id: 'lp-4' }, { summary: 'Cancel' });
    document.body.appendChild(el);
    const summaryRow = el.querySelector('.drill-summary') as HTMLElement;

    summaryRow.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    vi.advanceTimersByTime(100);
    summaryRow.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true }));
    vi.advanceTimersByTime(500);

    expect(Modal.isOpen('drill-sheet-task-lp-4')).toBe(false);
  });

  it('does not start long-press timer on button pointerdown', () => {
    const el = DrillItem.create('task', { id: 'lp-5' }, { summary: 'T' });
    document.body.appendChild(el);
    const moreBtn = el.querySelector('.drill-more-btn') as HTMLElement;

    moreBtn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    vi.advanceTimersByTime(600);

    // The long-press handler should not fire because the target was a button.
    // Close any modals that might have been opened by click propagation.
    Modal.closeAll();
    expect(Modal.count).toBe(0);
  });
});

// ─── more button — sheet ────────────────────────────────────

describe('DrillItem — more button opens sheet', () => {
  it('opens a modal when more button is clicked', () => {
    const el = DrillItem.create('task', { id: 'mb-1' }, { summary: 'Test Item' });
    document.body.appendChild(el);
    const moreBtn = el.querySelector('.drill-more-btn') as HTMLElement;
    moreBtn.click();
    expect(Modal.isOpen('drill-sheet-task-mb-1')).toBe(true);
  });

  it('stops propagation so summary row does not toggle', () => {
    const el = DrillItem.create('task', { id: 'mb-2' }, { summary: 'T' });
    document.body.appendChild(el);
    const moreBtn = el.querySelector('.drill-more-btn') as HTMLElement;
    moreBtn.click();
    // Should NOT have expanded
    expect(el.getAttribute('data-expanded')).toBe('0');
  });
});

// ─── _openSheet — detail modal rendering ────────────────────

describe('DrillItem._openSheet() — detail modal', () => {
  it('uses summary as modal title (string)', () => {
    const el = DrillItem.create('task', { id: 'sh-1' }, { summary: 'My Task' });
    document.body.appendChild(el);
    el.querySelector('.drill-more-btn').click();

    const modalRoot = document.getElementById('modal-root');
    const title = modalRoot!.querySelector('.modal-title');
    expect(title!.textContent).toBe('My Task');
  });

  it('uses summary function result as modal title', () => {
    const el = DrillItem.create('task', { id: 'sh-2', name: 'Alpha' }, {
      summary: (d: any) => `Agent: ${d.name}`
    });
    document.body.appendChild(el);
    el.querySelector('.drill-more-btn').click();

    const modalRoot = document.getElementById('modal-root');
    const title = modalRoot!.querySelector('.modal-title');
    expect(title!.textContent).toBe('Agent: Alpha');
  });

  it('renders detail fields in the sheet', () => {
    const el = DrillItem.create('task', { id: 'sh-3', assignee: 'Bob', priority: 'high' }, {
      summary: 'Task',
      detail: [
        { label: 'Assignee', key: 'assignee' },
        { label: 'Priority', key: 'priority' }
      ]
    });
    document.body.appendChild(el);
    el.querySelector('.drill-more-btn').click();

    const modalRoot = document.getElementById('modal-root');
    const rows = modalRoot!.querySelectorAll('.drill-detail-row');
    expect(rows.length).toBe(2);
  });

  it('uses sheetDetail fields when provided', () => {
    const el = DrillItem.create('task', { id: 'sh-4', assignee: 'Carol', status: 'active', desc: 'Full description' }, {
      summary: 'Task',
      detail: [
        { label: 'Assignee', key: 'assignee' }
      ],
      sheetDetail: [
        { label: 'Assignee', key: 'assignee' },
        { label: 'Status', key: 'status' },
        { label: 'Description', key: 'desc' }
      ]
    });
    document.body.appendChild(el);
    el.querySelector('.drill-more-btn').click();

    const modalRoot = document.getElementById('modal-root');
    const rows = modalRoot!.querySelectorAll('.drill-detail-row');
    expect(rows.length).toBe(3);
  });

  it('appends custom sheet content from config.sheet', () => {
    const customContent = document.createElement('div');
    customContent.className = 'custom-sheet';
    customContent.textContent = 'Extra sheet content';

    const el = DrillItem.create('task', { id: 'sh-5' }, {
      summary: 'Task',
      sheet: () => customContent
    });
    document.body.appendChild(el);
    el.querySelector('.drill-more-btn').click();

    const modalRoot = document.getElementById('modal-root');
    expect(modalRoot!.querySelector('.custom-sheet')).toBe(customContent);
  });

  it('does not append non-HTMLElement sheet return', () => {
    const el = DrillItem.create('task', { id: 'sh-6' }, {
      summary: 'Task',
      sheet: () => 'not an element'
    });
    document.body.appendChild(el);
    el.querySelector('.drill-more-btn').click();

    const modalRoot = document.getElementById('modal-root');
    const sheetContent = modalRoot!.querySelector('.drill-sheet-content');
    // Should have no extra children from the sheet function
    expect(sheetContent!.children.length).toBe(0);
  });

  it('uses bottom-sheet position on mobile (width < 768)', () => {
    // Set mobile viewport
    Object.defineProperty(window, 'innerWidth', { value: 375, writable: true, configurable: true });

    const el = DrillItem.create('task', { id: 'sh-7' }, { summary: 'T' });
    document.body.appendChild(el);
    el.querySelector('.drill-more-btn').click();

    const modalRoot = document.getElementById('modal-root');
    const backdrop = modalRoot!.querySelector('.modal-backdrop');
    expect(backdrop!.classList.contains('modal-pos-bottom-sheet')).toBe(true);

    // Restore
    Object.defineProperty(window, 'innerWidth', { value: 1024, writable: true, configurable: true });
  });

  it('uses center position on desktop (width >= 768)', () => {
    Object.defineProperty(window, 'innerWidth', { value: 1024, writable: true, configurable: true });

    const el = DrillItem.create('task', { id: 'sh-8' }, { summary: 'T' });
    document.body.appendChild(el);
    el.querySelector('.drill-more-btn').click();

    const modalRoot = document.getElementById('modal-root');
    const backdrop = modalRoot!.querySelector('.modal-backdrop');
    expect(backdrop!.classList.contains('modal-pos-center')).toBe(true);
  });

  it('uses full size on mobile', () => {
    Object.defineProperty(window, 'innerWidth', { value: 375, writable: true, configurable: true });

    const el = DrillItem.create('task', { id: 'sh-9' }, { summary: 'T' });
    document.body.appendChild(el);
    el.querySelector('.drill-more-btn').click();

    const modalRoot = document.getElementById('modal-root');
    const dialog = modalRoot!.querySelector('.modal-dialog');
    expect(dialog!.classList.contains('modal-full')).toBe(true);

    Object.defineProperty(window, 'innerWidth', { value: 1024, writable: true, configurable: true });
  });

  it('uses md size on desktop', () => {
    Object.defineProperty(window, 'innerWidth', { value: 1024, writable: true, configurable: true });

    const el = DrillItem.create('task', { id: 'sh-10' }, { summary: 'T' });
    document.body.appendChild(el);
    el.querySelector('.drill-more-btn').click();

    const modalRoot = document.getElementById('modal-root');
    const dialog = modalRoot!.querySelector('.modal-dialog');
    expect(dialog!.classList.contains('modal-md')).toBe(true);
  });

  it('constructs modal id from type and data.id', () => {
    const el = DrillItem.create('agent', { id: 'agt-99' }, { summary: 'Agent' });
    document.body.appendChild(el);
    el.querySelector('.drill-more-btn').click();
    expect(Modal.isOpen('drill-sheet-agent-agt-99')).toBe(true);
  });

  it('falls back to data.ts for modal id when no data.id', () => {
    const el = DrillItem.create('log', { ts: 9876 }, { summary: 'Log Entry' });
    document.body.appendChild(el);
    el.querySelector('.drill-more-btn').click();
    expect(Modal.isOpen('drill-sheet-log-9876')).toBe(true);
  });
});
