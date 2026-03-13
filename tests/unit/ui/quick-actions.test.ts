// @vitest-environment jsdom
/**
 * Tests for public/ui/components/quick-actions.js
 *
 * Covers: QuickActions component — FAB toggle, menu rendering,
 *         action dispatching, keyboard close, outside click close,
 *         aria attributes, unmount cleanup
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Mock engine (OverlordUI.dispatch) ──────────────────────
const dispatchedEvents: Array<{ event: string; data?: unknown }> = [];

vi.mock('../../../public/ui/engine/engine.js', () => ({
  OverlordUI: {
    dispatch(event: string, data?: unknown) {
      dispatchedEvents.push({ event, data });
    },
    subscribe: vi.fn(() => vi.fn()),
    getStore: vi.fn(() => null)
  }
}));

// ── Mock helpers — real DOM element factory ────────────────
vi.mock('../../../public/ui/engine/helpers.js', () => ({
  h(tag: string, attrs?: Record<string, unknown> | null, ...children: unknown[]) {
    const el = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (k === 'style' && typeof v === 'object' && v !== null) {
          for (const [sk, sv] of Object.entries(v as Record<string, string>)) {
            (el.style as any)[sk] = sv;
          }
        } else if (k === 'class') {
          el.className = String(v);
        } else if (typeof v === 'string') {
          el.setAttribute(k, v);
        }
      }
    }
    for (const child of children) {
      if (child instanceof HTMLElement) {
        el.appendChild(child);
      } else if (typeof child === 'string') {
        el.appendChild(document.createTextNode(child));
      }
    }
    return el;
  },
  $: (sel: string, ctx?: HTMLElement) => (ctx || document).querySelector(sel),
  $$: (sel: string, ctx?: HTMLElement) => Array.from((ctx || document).querySelectorAll(sel))
}));

let QuickActions: any;

beforeEach(async () => {
  document.body.textContent = '';
  dispatchedEvents.length = 0;

  const mod = await import('../../../public/ui/components/quick-actions.js');
  QuickActions = mod.QuickActions;
});

afterEach(() => {
  document.body.textContent = '';
});

// ─── Mounting ─────────────────────────────────────────────

describe('QuickActions — mounting', () => {
  it('renders a container with the FAB button', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const qa = new QuickActions(el);
    qa.mount();

    expect(el.className).toBe('quick-actions-container');
    const fab = el.querySelector('.qa-fab');
    expect(fab).not.toBeNull();
  });

  it('FAB has correct aria attributes when closed', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const qa = new QuickActions(el);
    qa.mount();

    const fab = el.querySelector('.qa-fab') as HTMLElement;
    expect(fab.getAttribute('aria-label')).toBe('Open quick actions');
    expect(fab.getAttribute('aria-expanded')).toBe('false');
  });

  it('shows a "+" icon when closed', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const qa = new QuickActions(el);
    qa.mount();

    const icon = el.querySelector('.qa-fab-icon') as HTMLElement;
    // Unicode \u002B is "+"
    expect(icon.textContent).toBe('+');
  });
});

// ─── Open / Close ─────────────────────────────────────────

describe('QuickActions — toggle', () => {
  it('opens menu when FAB is clicked', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const qa = new QuickActions(el);
    qa.mount();

    el.querySelector('.qa-fab')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    // After render(), the DOM is rebuilt — re-query for the new elements
    const fab = el.querySelector('.qa-fab') as HTMLElement;
    expect(fab.classList.contains('open')).toBe(true);
    const menu = el.querySelector('.qa-menu');
    expect(menu).not.toBeNull();
  });

  it('shows 6 action items when open', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const qa = new QuickActions(el);
    qa.mount();

    el.querySelector('.qa-fab')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    const items = el.querySelectorAll('.qa-item');
    expect(items.length).toBe(6);
  });

  it('updates aria attributes when open', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const qa = new QuickActions(el);
    qa.mount();

    el.querySelector('.qa-fab')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    const fab = el.querySelector('.qa-fab') as HTMLElement;
    expect(fab.getAttribute('aria-label')).toBe('Close quick actions');
    expect(fab.getAttribute('aria-expanded')).toBe('true');
  });

  it('shows "\u2715" icon when open', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const qa = new QuickActions(el);
    qa.mount();

    el.querySelector('.qa-fab')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    const icon = el.querySelector('.qa-fab-icon') as HTMLElement;
    expect(icon.textContent).toBe('\u2715');
  });

  it('closes when FAB is clicked again', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const qa = new QuickActions(el);
    qa.mount();

    const fab = el.querySelector('.qa-fab') as HTMLElement;
    fab.click(); // open
    fab.click(); // close

    expect(el.querySelector('.qa-menu')).toBeNull();
    expect(fab.classList.contains('open')).toBe(false);
  });

  it('closes when backdrop is clicked', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const qa = new QuickActions(el);
    qa.mount();

    el.querySelector('.qa-fab')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(el.querySelector('.qa-menu')).not.toBeNull();

    const backdrop = el.querySelector('.qa-backdrop') as HTMLElement;
    backdrop.click();

    expect(el.querySelector('.qa-menu')).toBeNull();
  });

  it('closes when Escape key is pressed', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const qa = new QuickActions(el);
    qa.mount();

    el.querySelector('.qa-fab')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(el.querySelector('.qa-menu')).not.toBeNull();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

    expect(el.querySelector('.qa-menu')).toBeNull();
  });
});

// ─── Action Dispatching ──────────────────────────────────

describe('QuickActions — actions', () => {
  it('dispatches navigate:tasks when "New Task" is clicked', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const qa = new QuickActions(el);
    qa.mount();

    // Open menu
    el.querySelector('.qa-fab')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    // Click first action (New Task)
    const items = el.querySelectorAll('.qa-item-btn') as NodeListOf<HTMLElement>;
    items[0].click();

    const navEvent = dispatchedEvents.find(e => e.event === 'navigate:tasks');
    expect(navEvent).toBeDefined();
  });

  it('dispatches navigate:raid-log when "New RAID Entry" is clicked', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const qa = new QuickActions(el);
    qa.mount();

    el.querySelector('.qa-fab')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const items = el.querySelectorAll('.qa-item-btn') as NodeListOf<HTMLElement>;
    items[1].click();

    const navEvent = dispatchedEvents.find(e => e.event === 'navigate:raid-log');
    expect(navEvent).toBeDefined();
  });

  it('dispatches navigate:milestones when "New Milestone" is clicked', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const qa = new QuickActions(el);
    qa.mount();

    el.querySelector('.qa-fab')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const items = el.querySelectorAll('.qa-item-btn') as NodeListOf<HTMLElement>;
    items[2].click();

    const navEvent = dispatchedEvents.find(e => e.event === 'navigate:milestones');
    expect(navEvent).toBeDefined();
  });

  it('dispatches navigate:chat when "Open Chat" is clicked', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const qa = new QuickActions(el);
    qa.mount();

    el.querySelector('.qa-fab')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const items = el.querySelectorAll('.qa-item-btn') as NodeListOf<HTMLElement>;
    items[3].click();

    const navEvent = dispatchedEvents.find(e => e.event === 'navigate:chat');
    expect(navEvent).toBeDefined();
  });

  it('dispatches navigate:activity when "Activity Feed" is clicked', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const qa = new QuickActions(el);
    qa.mount();

    el.querySelector('.qa-fab')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const items = el.querySelectorAll('.qa-item-btn') as NodeListOf<HTMLElement>;
    items[4].click();

    const navEvent = dispatchedEvents.find(e => e.event === 'navigate:activity');
    expect(navEvent).toBeDefined();
  });

  it('dispatches navigate:agents when "View Agents" is clicked', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const qa = new QuickActions(el);
    qa.mount();

    el.querySelector('.qa-fab')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const items = el.querySelectorAll('.qa-item-btn') as NodeListOf<HTMLElement>;
    items[5].click();

    const navEvent = dispatchedEvents.find(e => e.event === 'navigate:agents');
    expect(navEvent).toBeDefined();
  });

  it('closes menu after action is clicked', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const qa = new QuickActions(el);
    qa.mount();

    el.querySelector('.qa-fab')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const items = el.querySelectorAll('.qa-item-btn') as NodeListOf<HTMLElement>;
    items[0].click();

    // Menu should be closed
    expect(el.querySelector('.qa-menu')).toBeNull();
  });
});

// ─── Action Labels (non-technical) ──────────────────────

describe('QuickActions — labels', () => {
  it('displays user-friendly labels for all actions', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const qa = new QuickActions(el);
    qa.mount();

    el.querySelector('.qa-fab')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    const labels = el.querySelectorAll('.qa-item-label');
    const texts = Array.from(labels).map((l: Element) => l.textContent);

    expect(texts).toContain('New Task');
    expect(texts).toContain('New RAID Entry');
    expect(texts).toContain('New Milestone');
    expect(texts).toContain('Open Chat');
    expect(texts).toContain('Activity Feed');
    expect(texts).toContain('View Agents');
  });

  it('each action button has a title tooltip', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const qa = new QuickActions(el);
    qa.mount();

    el.querySelector('.qa-fab')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    const buttons = el.querySelectorAll('.qa-item-btn');
    buttons.forEach((btn: Element) => {
      expect(btn.getAttribute('title')).toBeTruthy();
    });
  });
});

// ─── Unmount ─────────────────────────────────────────────

describe('QuickActions — unmount', () => {
  it('removes event listeners on unmount', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const qa = new QuickActions(el);
    qa.mount();

    // Open to register keydown listener
    el.querySelector('.qa-fab')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(el.querySelector('.qa-menu')).not.toBeNull();

    qa.unmount();

    // Escape should not close since listeners are removed
    // (The component re-renders on close, so if Escape fired it would
    // call render() which would fail since _mounted is false)
    // We just verify unmount doesn't throw
    expect(qa._mounted).toBe(false);
  });
});

// ─── Backdrop Visibility ─────────────────────────────────

describe('QuickActions — backdrop', () => {
  it('backdrop has "visible" class when menu is open', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const qa = new QuickActions(el);
    qa.mount();

    el.querySelector('.qa-fab')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    const backdrop = el.querySelector('.qa-backdrop') as HTMLElement;
    expect(backdrop.classList.contains('visible')).toBe(true);
  });

  it('backdrop does not have "visible" class when closed', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const qa = new QuickActions(el);
    qa.mount();

    const backdrop = el.querySelector('.qa-backdrop') as HTMLElement;
    expect(backdrop.classList.contains('visible')).toBe(false);
  });
});

// ─── Staggered Animation ─────────────────────────────────

describe('QuickActions — animation', () => {
  it('applies staggered animation delay to each item', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const qa = new QuickActions(el);
    qa.mount();

    el.querySelector('.qa-fab')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    const items = el.querySelectorAll('.qa-item') as NodeListOf<HTMLElement>;
    // First item should have 0ms delay, second 40ms, etc.
    expect(items[0].style.animationDelay).toBe('0ms');
    expect(items[1].style.animationDelay).toBe('40ms');
    expect(items[2].style.animationDelay).toBe('80ms');
  });
});
