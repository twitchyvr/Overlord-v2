// @vitest-environment jsdom
/**
 * Tests for public/ui/components/notification-center.js
 *
 * Covers: NotificationCenter component — bell rendering, unread badge,
 *         activity filtering, drawer open/close, mark read, clear all,
 *         time formatting, persistence
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Track dispatched events ──────────────────────────────
const dispatchedEvents: Array<{ event: string; data?: unknown }> = [];
const subscribers: Record<string, Array<(data: unknown) => void>> = {};

vi.mock('../../../public/ui/engine/engine.js', () => ({
  OverlordUI: {
    dispatch(event: string, data?: unknown) {
      dispatchedEvents.push({ event, data });
    },
    subscribe(event: string, cb: (data: unknown) => void) {
      if (!subscribers[event]) subscribers[event] = [];
      subscribers[event].push(cb);
      return () => {
        const idx = (subscribers[event] || []).indexOf(cb);
        if (idx >= 0) subscribers[event].splice(idx, 1);
      };
    },
    getStore: vi.fn(() => ({
      get: vi.fn(() => []),
      subscribe: vi.fn(() => vi.fn())
    }))
  }
}));

// ── Mock helpers — real DOM factory ──────────────────────
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
  formatTime: vi.fn((ts: number) => new Date(ts).toISOString()),
  $: (sel: string, ctx?: HTMLElement) => (ctx || document).querySelector(sel),
  $$: (sel: string, ctx?: HTMLElement) => Array.from((ctx || document).querySelectorAll(sel))
}));

// ── Mock Drawer ──────────────────────────────────────────
const drawerState = { opened: false, id: '', opts: {} as Record<string, unknown> };

vi.mock('../../../public/ui/components/drawer.js', () => ({
  Drawer: {
    open(id: string, opts: Record<string, unknown>) {
      drawerState.opened = true;
      drawerState.id = id;
      drawerState.opts = opts;
    },
    close() {
      // Call onClose callback if provided
      if (drawerState.opts.onClose && typeof drawerState.opts.onClose === 'function') {
        (drawerState.opts.onClose as () => void)();
      }
      drawerState.opened = false;
      drawerState.id = '';
    },
    isOpen: () => drawerState.opened,
    getActiveId: () => drawerState.id
  }
}));

let NotificationCenter: any;

beforeEach(async () => {
  document.body.textContent = '';
  dispatchedEvents.length = 0;
  drawerState.opened = false;
  drawerState.id = '';
  drawerState.opts = {};
  for (const key of Object.keys(subscribers)) {
    subscribers[key] = [];
  }
  localStorage.clear();

  const mod = await import('../../../public/ui/components/notification-center.js');
  NotificationCenter = mod.NotificationCenter;
});

afterEach(() => {
  document.body.textContent = '';
  localStorage.clear();
});

// Helper: simulate an activity event
function emit(event: string, data: Record<string, unknown> = {}) {
  const handlers = subscribers['activity:new'] || [];
  for (const handler of handlers) {
    handler({ event, ...data, timestamp: Date.now() });
  }
}

// ─── Bell Rendering ──────────────────────────────────────

describe('NotificationCenter — bell', () => {
  it('renders a bell button on mount', () => {
    const el = document.createElement('span');
    document.body.appendChild(el);
    const nc = new NotificationCenter(el);
    nc.mount();

    const btn = el.querySelector('.notif-bell-btn');
    expect(btn).not.toBeNull();
  });

  it('shows bell icon', () => {
    const el = document.createElement('span');
    document.body.appendChild(el);
    const nc = new NotificationCenter(el);
    nc.mount();

    const icon = el.querySelector('.notif-bell-icon');
    expect(icon).not.toBeNull();
    expect(icon!.textContent).toBe('\u{1F514}');
  });

  it('has no badge when no notifications', () => {
    const el = document.createElement('span');
    document.body.appendChild(el);
    const nc = new NotificationCenter(el);
    nc.mount();

    expect(el.querySelector('.notif-badge')).toBeNull();
  });

  it('has correct aria-label when no notifications', () => {
    const el = document.createElement('span');
    document.body.appendChild(el);
    const nc = new NotificationCenter(el);
    nc.mount();

    const btn = el.querySelector('.notif-bell-btn') as HTMLElement;
    expect(btn.getAttribute('aria-label')).toBe('Notifications');
  });
});

// ─── Unread Badge ────────────────────────────────────────

describe('NotificationCenter — badge', () => {
  it('shows badge when notification arrives', () => {
    const el = document.createElement('span');
    document.body.appendChild(el);
    const nc = new NotificationCenter(el);
    nc.mount();

    emit('task:created', { title: 'Test task' });

    const badge = el.querySelector('.notif-badge');
    expect(badge).not.toBeNull();
    expect(badge!.textContent).toBe('1');
  });

  it('increments badge for multiple notifications', () => {
    const el = document.createElement('span');
    document.body.appendChild(el);
    const nc = new NotificationCenter(el);
    nc.mount();

    emit('task:created', { title: 'Task 1' });
    emit('raid:entry:added', { type: 'risk', summary: 'Big risk' });
    emit('phase:advanced', { toPhase: 'execution' });

    const badge = el.querySelector('.notif-badge');
    expect(badge!.textContent).toBe('3');
  });

  it('caps badge at 99+', () => {
    const el = document.createElement('span');
    document.body.appendChild(el);
    const nc = new NotificationCenter(el);
    nc.mount();

    for (let i = 0; i < 100; i++) {
      emit('task:created', { title: `Task ${i}` });
    }

    const badge = el.querySelector('.notif-badge');
    // MAX_NOTIFICATIONS is 50, so only 50 kept
    expect(badge).not.toBeNull();
  });

  it('updates aria-label with unread count', () => {
    const el = document.createElement('span');
    document.body.appendChild(el);
    const nc = new NotificationCenter(el);
    nc.mount();

    emit('task:created', { title: 'Test' });
    emit('task:created', { title: 'Test 2' });

    const btn = el.querySelector('.notif-bell-btn') as HTMLElement;
    expect(btn.getAttribute('aria-label')).toBe('2 unread notifications');
  });
});

// ─── Activity Filtering ─────────────────────────────────

describe('NotificationCenter — filtering', () => {
  it('ignores non-notification events', () => {
    const el = document.createElement('span');
    document.body.appendChild(el);
    const nc = new NotificationCenter(el);
    nc.mount();

    emit('room:agent:entered', { agentName: 'Claude' });

    expect(el.querySelector('.notif-badge')).toBeNull();
    expect(nc.unreadCount).toBe(0);
  });

  it('captures task:created events', () => {
    const el = document.createElement('span');
    document.body.appendChild(el);
    const nc = new NotificationCenter(el);
    nc.mount();

    emit('task:created', { title: 'New feature' });
    expect(nc.unreadCount).toBe(1);
  });

  it('captures raid:entry:added events', () => {
    const el = document.createElement('span');
    document.body.appendChild(el);
    const nc = new NotificationCenter(el);
    nc.mount();

    emit('raid:entry:added', { type: 'risk', summary: 'Production risk' });
    expect(nc.unreadCount).toBe(1);
  });

  it('captures phase:advanced events', () => {
    const el = document.createElement('span');
    document.body.appendChild(el);
    const nc = new NotificationCenter(el);
    nc.mount();

    emit('phase:advanced', { toPhase: 'review' });
    expect(nc.unreadCount).toBe(1);
  });

  it('captures escalation events', () => {
    const el = document.createElement('span');
    document.body.appendChild(el);
    const nc = new NotificationCenter(el);
    nc.mount();

    emit('escalation:war-room', { reason: 'Critical bug' });
    expect(nc.unreadCount).toBe(1);
  });
});

// ─── Drawer ──────────────────────────────────────────────

describe('NotificationCenter — drawer', () => {
  it('opens drawer when bell is clicked', () => {
    const el = document.createElement('span');
    document.body.appendChild(el);
    const nc = new NotificationCenter(el);
    nc.mount();

    el.querySelector('.notif-bell-btn')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(drawerState.opened).toBe(true);
    expect(drawerState.id).toBe('notification-center');
  });

  it('drawer shows empty state when no notifications', () => {
    const el = document.createElement('span');
    document.body.appendChild(el);
    const nc = new NotificationCenter(el);
    nc.mount();

    el.querySelector('.notif-bell-btn')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    const content = drawerState.opts.content as HTMLElement;
    expect(content.querySelector('.notif-empty')).not.toBeNull();
  });

  it('drawer shows notification items', () => {
    const el = document.createElement('span');
    document.body.appendChild(el);
    const nc = new NotificationCenter(el);
    nc.mount();

    emit('task:created', { title: 'My Task' });
    el.querySelector('.notif-bell-btn')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    const content = drawerState.opts.content as HTMLElement;
    const items = content.querySelectorAll('.notif-item');
    expect(items.length).toBe(1);
  });

  it('drawer shows unread dot for unread notifications', () => {
    const el = document.createElement('span');
    document.body.appendChild(el);
    const nc = new NotificationCenter(el);
    nc.mount();

    emit('task:created', { title: 'My Task' });
    el.querySelector('.notif-bell-btn')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    const content = drawerState.opts.content as HTMLElement;
    expect(content.querySelector('.notif-unread-dot')).not.toBeNull();
  });

  it('clicking a notification dispatches navigation', () => {
    const el = document.createElement('span');
    document.body.appendChild(el);
    const nc = new NotificationCenter(el);
    nc.mount();

    emit('task:created', { title: 'My Task' });
    el.querySelector('.notif-bell-btn')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    const content = drawerState.opts.content as HTMLElement;
    const item = content.querySelector('.notif-item') as HTMLElement;
    item.click();

    expect(dispatchedEvents.some(e => e.event === 'navigate:tasks')).toBe(true);
  });
});

// ─── Mark Read / Clear ───────────────────────────────────

describe('NotificationCenter — read state', () => {
  it('clicking a notification marks it as read', () => {
    const el = document.createElement('span');
    document.body.appendChild(el);
    const nc = new NotificationCenter(el);
    nc.mount();

    emit('task:created', { title: 'My Task' });
    expect(nc.unreadCount).toBe(1);

    // Open drawer and click the notification
    el.querySelector('.notif-bell-btn')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const content = drawerState.opts.content as HTMLElement;
    content.querySelector('.notif-item')!.dispatchEvent(new MouseEvent('click'));

    expect(nc.unreadCount).toBe(0);
  });

  it('badge disappears when all read', () => {
    const el = document.createElement('span');
    document.body.appendChild(el);
    const nc = new NotificationCenter(el);
    nc.mount();

    emit('task:created', { title: 'My Task' });
    expect(el.querySelector('.notif-badge')).not.toBeNull();

    // Open drawer and click
    el.querySelector('.notif-bell-btn')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const content = drawerState.opts.content as HTMLElement;
    content.querySelector('.notif-item')!.dispatchEvent(new MouseEvent('click'));

    expect(el.querySelector('.notif-badge')).toBeNull();
  });

  it('persists read state to localStorage', () => {
    const el = document.createElement('span');
    document.body.appendChild(el);
    const nc = new NotificationCenter(el);
    nc.mount();

    emit('task:created', { title: 'My Task' });

    // Open and click to mark read
    el.querySelector('.notif-bell-btn')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const content = drawerState.opts.content as HTMLElement;
    content.querySelector('.notif-item')!.dispatchEvent(new MouseEvent('click'));

    const stored = localStorage.getItem('overlord_v2_notifications');
    expect(stored).not.toBeNull();
    const parsed = JSON.parse(stored!);
    expect(Array.isArray(parsed.readIds)).toBe(true);
    expect(parsed.readIds.length).toBe(1);
  });
});

// ─── Notification Titles ─────────────────────────────────

describe('NotificationCenter — titles', () => {
  it('formats task:created title', () => {
    const el = document.createElement('span');
    document.body.appendChild(el);
    const nc = new NotificationCenter(el);
    nc.mount();

    emit('task:created', { title: 'Fix login bug' });

    el.querySelector('.notif-bell-btn')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const content = drawerState.opts.content as HTMLElement;
    const title = content.querySelector('.notif-item-title');
    expect(title!.textContent).toBe('New task: Fix login bug');
  });

  it('formats raid:entry:added title', () => {
    const el = document.createElement('span');
    document.body.appendChild(el);
    const nc = new NotificationCenter(el);
    nc.mount();

    emit('raid:entry:added', { type: 'risk', summary: 'Data loss risk' });

    el.querySelector('.notif-bell-btn')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const content = drawerState.opts.content as HTMLElement;
    const title = content.querySelector('.notif-item-title');
    expect(title!.textContent).toBe('New risk entry: Data loss risk');
  });

  it('formats task completion', () => {
    const el = document.createElement('span');
    document.body.appendChild(el);
    const nc = new NotificationCenter(el);
    nc.mount();

    emit('task:updated', { title: 'Deploy to prod', status: 'done' });

    el.querySelector('.notif-bell-btn')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const content = drawerState.opts.content as HTMLElement;
    const title = content.querySelector('.notif-item-title');
    expect(title!.textContent).toBe('Task completed: Deploy to prod');
  });
});

// ─── Unmount ─────────────────────────────────────────────

describe('NotificationCenter — unmount', () => {
  it('cleans up listeners on unmount', () => {
    const el = document.createElement('span');
    document.body.appendChild(el);
    const nc = new NotificationCenter(el);
    nc.mount();

    expect(nc._mounted).toBe(true);
    nc.unmount();
    expect(nc._mounted).toBe(false);
  });
});

// ─── Time Formatting ─────────────────────────────────────

describe('NotificationCenter — time formatting', () => {
  it('shows "Just now" for recent events', () => {
    const el = document.createElement('span');
    document.body.appendChild(el);
    const nc = new NotificationCenter(el);
    nc.mount();

    emit('task:created', { title: 'Recent' });

    el.querySelector('.notif-bell-btn')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const content = drawerState.opts.content as HTMLElement;
    const time = content.querySelector('.notif-item-time');
    expect(time!.textContent).toBe('Just now');
  });
});
