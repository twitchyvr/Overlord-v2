// @vitest-environment jsdom
/**
 * Tests for public/ui/components/agent-activity-tracker.js
 *
 * Covers: mount/unmount lifecycle, event subscriptions mapping to animation
 * states, DOM class application, auto-reset timers, state queries, and
 * multi-element targeting via data-agent-id.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Mock engine ─────────────────────────────────────────────
type SubscribeFn = (data: any) => void;
const subscribers: Map<string, SubscribeFn[]> = new Map();

vi.mock('../../../public/ui/engine/engine.js', () => ({
  OverlordUI: {
    subscribe(event: string, cb: SubscribeFn) {
      if (!subscribers.has(event)) subscribers.set(event, []);
      subscribers.get(event)!.push(cb);
      return () => {
        const arr = subscribers.get(event);
        if (arr) {
          const idx = arr.indexOf(cb);
          if (idx !== -1) arr.splice(idx, 1);
        }
      };
    },
    dispatch(event: string, data?: any) {
      const cbs = subscribers.get(event);
      if (cbs) cbs.forEach(fn => fn(data));
    }
  }
}));

// ── Mock component base ─────────────────────────────────────
vi.mock('../../../public/ui/engine/component.js', () => ({
  Component: class {
    el: HTMLElement;
    opts: any;
    _subs: any[];
    _listeners: any[];
    _mounted: boolean;
    constructor(el: HTMLElement, opts: any = {}) {
      this.el = el;
      this.opts = opts;
      this._subs = [];
      this._listeners = [];
      this._mounted = false;
    }
    mount() { this._mounted = true; }
    unmount() { this._mounted = false; }
    destroy() {
      this.unmount();
      this._subs.forEach((fn: any) => fn());
      this._subs = [];
      this._listeners.forEach((fn: any) => fn());
      this._listeners = [];
    }
  }
}));

// ── Mock helpers ────────────────────────────────────────────
vi.mock('../../../public/ui/engine/helpers.js', () => ({
  $: (sel: string, ctx?: HTMLElement) => (ctx || document).querySelector(sel),
  $$: (sel: string, ctx?: HTMLElement) => (ctx || document).querySelectorAll(sel),
  h: (tag: string, attrs: any = {}, ...children: any[]) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === 'style' && typeof v === 'object') {
        for (const [sk, sv] of Object.entries(v as Record<string, string>)) {
          (el.style as any)[sk] = sv;
        }
      } else {
        el.setAttribute(k, String(v));
      }
    }
    for (const child of children) {
      if (typeof child === 'string') el.appendChild(document.createTextNode(child));
      else if (child instanceof HTMLElement) el.appendChild(child);
    }
    return el;
  },
  setContent: () => {}
}));

const trackerPath = '../../../public/ui/components/agent-activity-tracker.js';
let AgentActivityTracker: any;
let tracker: any;
let el: HTMLElement;

beforeEach(async () => {
  vi.useFakeTimers();
  subscribers.clear();
  while (document.body.firstChild) document.body.removeChild(document.body.firstChild);

  vi.resetModules();
  const mod = await import(trackerPath);
  AgentActivityTracker = mod.AgentActivityTracker;
  el = document.createElement('div');
  tracker = new AgentActivityTracker(el);
});

afterEach(() => {
  vi.useRealTimers();
});

// ── Helpers ──────────────────────────────────────────────────
function createAgentCard(agentId: string): HTMLElement {
  const card = document.createElement('div');
  card.setAttribute('data-agent-id', agentId);
  card.classList.add('agents-view-card');

  const avatar = document.createElement('div');
  avatar.classList.add('agents-view-card-avatar');
  card.appendChild(avatar);

  const dot = document.createElement('div');
  dot.classList.add('agents-view-status-dot');
  card.appendChild(dot);

  document.body.appendChild(card);
  return card;
}

function emit(event: string, data: any) {
  const cbs = subscribers.get(event);
  if (cbs) cbs.forEach(fn => fn(data));
}

function hasClass(element: HTMLElement, cls: string): boolean {
  return element.classList.contains(cls);
}

// ── Test Suites ──────────────────────────────────────────────

describe('AgentActivityTracker — lifecycle', () => {
  it('subscribes to engine events on mount', () => {
    tracker.mount();
    const expectedEvents = [
      'chat:stream-start', 'chat:stream-chunk', 'chat:response',
      'tool:executed', 'agent:status-changed',
      'room:agent:entered', 'room:agent:exited', 'agent:error'
    ];
    for (const event of expectedEvents) {
      expect(subscribers.has(event)).toBe(true);
      expect(subscribers.get(event)!.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('cleans up subscriptions and state on unmount', () => {
    tracker.mount();
    createAgentCard('agent-1');
    emit('chat:stream-start', { agentId: 'agent-1' });
    expect(tracker.getState('agent-1')).toBe('thinking');

    tracker.unmount();
    expect(tracker.getState('agent-1')).toBeNull();
  });
});

describe('AgentActivityTracker — event mapping', () => {
  beforeEach(() => {
    tracker.mount();
  });

  it('chat:stream-start → thinking', () => {
    createAgentCard('a1');
    emit('chat:stream-start', { agentId: 'a1' });
    expect(tracker.getState('a1')).toBe('thinking');
  });

  it('chat:stream-chunk → chatting', () => {
    createAgentCard('a1');
    emit('chat:stream-chunk', { agentId: 'a1' });
    expect(tracker.getState('a1')).toBe('chatting');
  });

  it('chat:response → idle', () => {
    createAgentCard('a1');
    emit('chat:stream-start', { agentId: 'a1' });
    emit('chat:response', { agentId: 'a1' });
    expect(tracker.getState('a1')).toBe('idle');
  });

  it('tool:executed → working', () => {
    createAgentCard('a1');
    emit('tool:executed', { agentId: 'a1' });
    expect(tracker.getState('a1')).toBe('working');
  });

  it('agent:error → error', () => {
    createAgentCard('a1');
    emit('agent:error', { agentId: 'a1' });
    expect(tracker.getState('a1')).toBe('error');
  });

  it('room:agent:entered → idle', () => {
    createAgentCard('a1');
    emit('room:agent:entered', { agentId: 'a1' });
    expect(tracker.getState('a1')).toBe('idle');
  });

  it('room:agent:exited → clears state', () => {
    createAgentCard('a1');
    emit('chat:stream-start', { agentId: 'a1' });
    emit('room:agent:exited', { agentId: 'a1' });
    expect(tracker.getState('a1')).toBeNull();
  });

  it('agent:status-changed maps server statuses', () => {
    createAgentCard('a1');
    const mapping: Record<string, string> = {
      active: 'idle',
      working: 'working',
      paused: 'waiting',
      idle: 'idle',
      error: 'error'
    };
    for (const [serverStatus, expectedState] of Object.entries(mapping)) {
      emit('agent:status-changed', { agentId: 'a1', status: serverStatus });
      expect(tracker.getState('a1')).toBe(expectedState);
    }
  });

  it('ignores events without agentId', () => {
    emit('chat:stream-start', {});
    emit('chat:stream-start', null);
    emit('tool:executed', { tool: 'write_file' });
    // No state should be set — no crash
    expect(tracker.getState(undefined as any)).toBeNull();
  });
});

describe('AgentActivityTracker — DOM class application', () => {
  beforeEach(() => {
    tracker.mount();
  });

  it('applies thinking class to card, avatar, and dot', () => {
    const card = createAgentCard('a1');
    const avatar = card.querySelector('.agents-view-card-avatar')!;
    const dot = card.querySelector('.agents-view-status-dot')!;

    emit('chat:stream-start', { agentId: 'a1' });

    expect(hasClass(card as HTMLElement, 'agent-activity-thinking')).toBe(true);
    expect(hasClass(avatar as HTMLElement, 'agent-activity-thinking')).toBe(true);
    expect(hasClass(dot as HTMLElement, 'agent-activity-thinking')).toBe(true);
  });

  it('removes previous state class when transitioning', () => {
    const card = createAgentCard('a1');

    emit('chat:stream-start', { agentId: 'a1' });
    expect(hasClass(card as HTMLElement, 'agent-activity-thinking')).toBe(true);

    emit('chat:stream-chunk', { agentId: 'a1' });
    expect(hasClass(card as HTMLElement, 'agent-activity-thinking')).toBe(false);
    expect(hasClass(card as HTMLElement, 'agent-activity-chatting')).toBe(true);
  });

  it('applies classes to multiple elements with same agent id', () => {
    const card1 = createAgentCard('a1');
    const card2 = createAgentCard('a1');

    emit('tool:executed', { agentId: 'a1' });

    expect(hasClass(card1 as HTMLElement, 'agent-activity-working')).toBe(true);
    expect(hasClass(card2 as HTMLElement, 'agent-activity-working')).toBe(true);
  });

  it('removes all classes on room exit', () => {
    const card = createAgentCard('a1');
    const avatar = card.querySelector('.agents-view-card-avatar')!;

    emit('chat:stream-start', { agentId: 'a1' });
    expect(hasClass(card as HTMLElement, 'agent-activity-thinking')).toBe(true);

    emit('room:agent:exited', { agentId: 'a1' });
    expect(hasClass(card as HTMLElement, 'agent-activity-thinking')).toBe(false);
    expect(hasClass(avatar as HTMLElement, 'agent-activity-thinking')).toBe(false);
  });

  it('applies error class with red indicators', () => {
    const card = createAgentCard('a1');
    const dot = card.querySelector('.agents-view-status-dot')!;

    emit('agent:error', { agentId: 'a1' });

    expect(hasClass(card as HTMLElement, 'agent-activity-error')).toBe(true);
    expect(hasClass(dot as HTMLElement, 'agent-activity-error')).toBe(true);
  });
});

describe('AgentActivityTracker — auto-reset timers', () => {
  beforeEach(() => {
    tracker.mount();
  });

  it('thinking auto-resets to idle after 30s', () => {
    createAgentCard('a1');
    emit('chat:stream-start', { agentId: 'a1' });
    expect(tracker.getState('a1')).toBe('thinking');

    vi.advanceTimersByTime(30000);
    expect(tracker.getState('a1')).toBe('idle');
  });

  it('working auto-resets to idle after 15s', () => {
    createAgentCard('a1');
    emit('tool:executed', { agentId: 'a1' });
    expect(tracker.getState('a1')).toBe('working');

    vi.advanceTimersByTime(15000);
    expect(tracker.getState('a1')).toBe('idle');
  });

  it('chatting auto-resets to idle after 5s', () => {
    createAgentCard('a1');
    emit('chat:stream-chunk', { agentId: 'a1' });
    expect(tracker.getState('a1')).toBe('chatting');

    vi.advanceTimersByTime(5000);
    expect(tracker.getState('a1')).toBe('idle');
  });

  it('new event cancels pending auto-reset timer', () => {
    createAgentCard('a1');
    emit('chat:stream-start', { agentId: 'a1' }); // 30s timer
    vi.advanceTimersByTime(15000); // halfway

    emit('tool:executed', { agentId: 'a1' }); // new 15s timer, cancels old
    expect(tracker.getState('a1')).toBe('working');

    vi.advanceTimersByTime(10000); // 10s in — old timer would have fired at 15s
    expect(tracker.getState('a1')).toBe('working'); // still working, not reset

    vi.advanceTimersByTime(5000); // now at 15s for working timer
    expect(tracker.getState('a1')).toBe('idle');
  });

  it('idle state does not set an auto-reset timer', () => {
    createAgentCard('a1');
    emit('chat:response', { agentId: 'a1' });
    expect(tracker.getState('a1')).toBe('idle');

    vi.advanceTimersByTime(60000);
    expect(tracker.getState('a1')).toBe('idle'); // unchanged
  });
});

describe('AgentActivityTracker — getState', () => {
  beforeEach(() => {
    tracker.mount();
  });

  it('returns null for unknown agent', () => {
    expect(tracker.getState('nonexistent')).toBeNull();
  });

  it('returns current state after event', () => {
    createAgentCard('a1');
    emit('tool:executed', { agentId: 'a1' });
    expect(tracker.getState('a1')).toBe('working');
  });

  it('tracks multiple agents independently', () => {
    createAgentCard('a1');
    createAgentCard('a2');
    emit('chat:stream-start', { agentId: 'a1' });
    emit('tool:executed', { agentId: 'a2' });

    expect(tracker.getState('a1')).toBe('thinking');
    expect(tracker.getState('a2')).toBe('working');
  });
});
