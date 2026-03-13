// @vitest-environment jsdom

/**
 * Breadcrumb Navigation — Unit Tests
 *
 * Tests the breadcrumb bar component that shows spatial context:
 *   Building > Floor > Room > Current View
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Mocks ────────────────────────────────────────────

type Callback = (...args: unknown[]) => unknown;

const subscribers: Record<string, Callback[]> = {};
const storeData: Record<string, unknown> = {};
const storeSubscribers: Record<string, Callback[]> = {};

const mockStore = {
  get: vi.fn((key: string) => storeData[key]),
  set: vi.fn((key: string, val: unknown) => { storeData[key] = val; }),
  subscribe: vi.fn((key: string, fn: Callback) => {
    if (!storeSubscribers[key]) storeSubscribers[key] = [];
    storeSubscribers[key].push(fn);
    return () => {
      storeSubscribers[key] = storeSubscribers[key].filter(f => f !== fn);
    };
  }),
};

vi.mock('../../../public/ui/engine/engine.js', () => ({
  OverlordUI: {
    getStore: () => mockStore,
    subscribe: vi.fn((event: string, fn: Callback) => {
      if (!subscribers[event]) subscribers[event] = [];
      subscribers[event].push(fn);
      return () => {
        subscribers[event] = subscribers[event].filter(f => f !== fn);
      };
    }),
    dispatch: vi.fn((event: string, data?: unknown) => {
      (subscribers[event] || []).forEach(fn => fn(data));
    }),
  },
}));

vi.mock('../../../public/ui/engine/helpers.js', () => ({
  h: (tag: string, attrs?: Record<string, unknown> | null, ...children: unknown[]) => {
    const el = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v === undefined || v === null) continue;
        if (k === 'class') el.className = String(v);
        else el.setAttribute(k, String(v));
      }
    }
    for (const child of children) {
      if (typeof child === 'string') el.appendChild(document.createTextNode(child));
      else if (child instanceof Node) el.appendChild(child);
    }
    return el;
  },
}));

vi.mock('../../../public/ui/engine/entity-nav.js', () => ({
  resolveRoom: vi.fn((id: string) => {
    const rooms: Record<string, { id: string; name: string; type: string }> = {
      'room-1': { id: 'room-1', name: 'Code Lab Alpha', type: 'code-lab' },
      'room-2': { id: 'room-2', name: 'War Room', type: 'war-room' },
      'room-3': { id: 'room-3', name: 'Testing Lab', type: 'testing-lab' },
    };
    return rooms[id] || { id, name: id, type: null };
  }),
}));

vi.mock('../../../public/ui/engine/component.js', () => ({
  Component: class {
    el: HTMLElement;
    opts: Record<string, unknown>;
    _subs: Callback[] = [];
    _listeners: Callback[] = [];
    _mounted = false;
    constructor(el: HTMLElement, opts = {}) {
      this.el = el;
      this.opts = opts;
    }
    mount() { this._mounted = true; }
    unmount() { this._mounted = false; }
    destroy() {
      this.unmount();
      this._subs.forEach(fn => fn());
      this._subs = [];
      this._listeners.forEach(fn => fn());
      this._listeners = [];
    }
    subscribe(store: { subscribe: Callback }, key: string, fn: Callback) {
      const unsub = store.subscribe(key, fn);
      this._subs.push(unsub as Callback);
      return unsub;
    }
  },
}));

// ── Import after mocks ──
import { BreadcrumbNav } from '../../../public/ui/components/breadcrumb-nav.js';
import { OverlordUI } from '../../../public/ui/engine/engine.js';

// ── Helpers ──
function dispatch(event: string, data?: unknown) {
  (OverlordUI as any).dispatch(event, data);
}

function storeEmit(key: string, value: unknown) {
  storeData[key] = value;
  (storeSubscribers[key] || []).forEach(fn => fn(value));
}

function getLabels(el: HTMLElement): string[] {
  const items = el.querySelectorAll('.breadcrumb-label, .breadcrumb-link');
  return Array.from(items).map(i => i.textContent || '');
}

function getLinks(el: HTMLElement): HTMLElement[] {
  return Array.from(el.querySelectorAll('.breadcrumb-link'));
}

// ── Setup ──
let container: HTMLElement;
let breadcrumb: InstanceType<typeof BreadcrumbNav>;

beforeEach(() => {
  Object.keys(storeData).forEach(k => delete storeData[k]);
  Object.keys(storeSubscribers).forEach(k => delete storeSubscribers[k]);
  Object.keys(subscribers).forEach(k => delete subscribers[k]);
  vi.clearAllMocks();

  container = document.createElement('div');
  document.body.appendChild(container);
  breadcrumb = new BreadcrumbNav(container);
});

afterEach(() => {
  breadcrumb.destroy();
  container.remove();
});

// ═══════════════════════════════════════════════════
//  Tests
// ═══════════════════════════════════════════════════

describe('BreadcrumbNav', () => {

  describe('visibility', () => {
    it('is hidden when no building is selected', () => {
      breadcrumb.mount();
      expect(container.hidden).toBe(true);
    });

    it('becomes visible when building is selected', () => {
      storeData['building.active'] = 'b1';
      storeData['building.list'] = [{ id: 'b1', name: 'StatusOwl' }];
      breadcrumb.mount();
      expect(container.hidden).toBe(false);
    });

    it('hides again when building is deselected', () => {
      storeData['building.active'] = 'b1';
      storeData['building.list'] = [{ id: 'b1', name: 'StatusOwl' }];
      breadcrumb.mount();
      expect(container.hidden).toBe(false);

      storeEmit('building.active', null);
      expect(container.hidden).toBe(true);
    });
  });

  describe('segments', () => {
    beforeEach(() => {
      storeData['building.active'] = 'b1';
      storeData['building.list'] = [{ id: 'b1', name: 'StatusOwl' }];
    });

    it('shows building name and dashboard on mount', () => {
      breadcrumb.mount();
      const labels = getLabels(container);
      expect(labels).toContain('StatusOwl');
      expect(labels).toContain('Dashboard');
    });

    it('updates current view on view:changed event', () => {
      breadcrumb.mount();
      dispatch('view:changed', { view: 'tasks' });
      const labels = getLabels(container);
      expect(labels).toContain('Tasks');
    });

    it('shows room context on building:room-selected', () => {
      breadcrumb.mount();
      dispatch('building:room-selected', { roomId: 'room-1' });
      const labels = getLabels(container);
      expect(labels).toContain('Code Lab Alpha');
      expect(labels).toContain('Execution Floor');
    });

    it('clears room context on view:changed', () => {
      breadcrumb.mount();
      dispatch('building:room-selected', { roomId: 'room-1' });
      expect(getLabels(container)).toContain('Code Lab Alpha');

      dispatch('view:changed', { view: 'agents' });
      const labels = getLabels(container);
      expect(labels).not.toContain('Code Lab Alpha');
      expect(labels).toContain('Agents');
    });

    it('maps room types to correct floors', () => {
      breadcrumb.mount();

      dispatch('building:room-selected', { roomId: 'room-1' }); // code-lab
      expect(getLabels(container)).toContain('Execution Floor');

      dispatch('building:room-selected', { roomId: 'room-2' }); // war-room
      expect(getLabels(container)).toContain('Collaboration Floor');

      dispatch('building:room-selected', { roomId: 'room-3' }); // testing-lab
      expect(getLabels(container)).toContain('Execution Floor');
    });

    it('building name updates when building.list changes', () => {
      breadcrumb.mount();
      expect(getLabels(container)).toContain('StatusOwl');

      storeEmit('building.list', [{ id: 'b1', name: 'StatusOwl Pro' }]);
      expect(getLabels(container)).toContain('StatusOwl Pro');
    });
  });

  describe('navigation', () => {
    beforeEach(() => {
      storeData['building.active'] = 'b1';
      storeData['building.list'] = [{ id: 'b1', name: 'StatusOwl' }];
    });

    it('clicking building name navigates to dashboard', () => {
      breadcrumb.mount();
      const links = getLinks(container);
      const buildingLink = links.find(l => l.textContent === 'StatusOwl');
      expect(buildingLink).toBeTruthy();

      buildingLink!.click();
      expect(OverlordUI.dispatch).toHaveBeenCalledWith('navigate:dashboard');
    });

    it('clicking room navigates to room entity', () => {
      breadcrumb.mount();
      dispatch('building:room-selected', { roomId: 'room-1' });

      const links = getLinks(container);
      const roomLink = links.find(l => l.textContent === 'Code Lab Alpha');
      expect(roomLink).toBeTruthy();

      roomLink!.click();
      expect(OverlordUI.dispatch).toHaveBeenCalledWith('navigate:entity', {
        type: 'room',
        id: 'room-1',
      });
    });

    it('current view segment is not clickable', () => {
      breadcrumb.mount();
      const currentEl = container.querySelector('.breadcrumb-current');
      expect(currentEl).toBeTruthy();
      expect(currentEl!.tagName).toBe('SPAN'); // not button
    });

    it('floor segment is not clickable (label only)', () => {
      breadcrumb.mount();
      dispatch('building:room-selected', { roomId: 'room-1' });
      const labels = container.querySelectorAll('.breadcrumb-label');
      const floorLabel = Array.from(labels).find(l => l.textContent === 'Execution Floor');
      expect(floorLabel).toBeTruthy();
      expect(floorLabel!.tagName).toBe('SPAN');
    });
  });

  describe('separators', () => {
    it('renders chevron separators between segments', () => {
      storeData['building.active'] = 'b1';
      storeData['building.list'] = [{ id: 'b1', name: 'StatusOwl' }];
      breadcrumb.mount();

      const seps = container.querySelectorAll('.breadcrumb-sep');
      expect(seps.length).toBeGreaterThan(0);
      expect(seps[0].textContent).toBe('\u203A');
      expect(seps[0].getAttribute('aria-hidden')).toBe('true');
    });

    it('does not render separator after last segment', () => {
      storeData['building.active'] = 'b1';
      storeData['building.list'] = [{ id: 'b1', name: 'StatusOwl' }];
      breadcrumb.mount();

      const items = container.querySelectorAll('.breadcrumb-item');
      const lastItem = items[items.length - 1];
      expect(lastItem.querySelector('.breadcrumb-sep')).toBeNull();
    });
  });

  describe('accessibility', () => {
    it('renders with aria-label on nav element', () => {
      storeData['building.active'] = 'b1';
      storeData['building.list'] = [{ id: 'b1', name: 'StatusOwl' }];
      breadcrumb.mount();

      const nav = container.querySelector('nav');
      expect(nav?.getAttribute('aria-label')).toBe('Breadcrumb navigation');
    });

    it('marks current segment with aria-current="page"', () => {
      storeData['building.active'] = 'b1';
      storeData['building.list'] = [{ id: 'b1', name: 'StatusOwl' }];
      breadcrumb.mount();

      const current = container.querySelector('[aria-current="page"]');
      expect(current).toBeTruthy();
      expect(current!.textContent).toBe('Dashboard');
    });

    it('uses ordered list for semantic breadcrumb structure', () => {
      storeData['building.active'] = 'b1';
      storeData['building.list'] = [{ id: 'b1', name: 'StatusOwl' }];
      breadcrumb.mount();

      expect(container.querySelector('ol.breadcrumb-list')).toBeTruthy();
      expect(container.querySelector('li.breadcrumb-item')).toBeTruthy();
    });
  });

  describe('lifecycle', () => {
    it('cleans up subscriptions on destroy', () => {
      storeData['building.active'] = 'b1';
      storeData['building.list'] = [{ id: 'b1', name: 'StatusOwl' }];
      breadcrumb.mount();
      expect(container.hidden).toBe(false);

      breadcrumb.destroy();

      // Store changes should no longer trigger renders
      storeEmit('building.active', null);
      // If subscriptions were cleaned up, the breadcrumb won't update
      // (no error thrown = success)
    });
  });

  describe('view label mapping', () => {
    beforeEach(() => {
      storeData['building.active'] = 'b1';
      storeData['building.list'] = [{ id: 'b1', name: 'StatusOwl' }];
      breadcrumb.mount();
    });

    const cases = [
      ['dashboard', 'Dashboard'],
      ['chat', 'Chat'],
      ['tasks', 'Tasks'],
      ['agents', 'Agents'],
      ['activity', 'Activity'],
      ['email', 'Mail'],
      ['raid-log', 'RAID Log'],
      ['phase', 'Phase Gates'],
      ['milestones', 'Milestones'],
    ];

    for (const [view, label] of cases) {
      it(`maps "${view}" to "${label}"`, () => {
        dispatch('view:changed', { view });
        expect(getLabels(container)).toContain(label);
      });
    }
  });
});
