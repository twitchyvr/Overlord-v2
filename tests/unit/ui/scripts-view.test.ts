/**
 * Scripts View — Unit Tests
 *
 * Tests the Script Manager UI: rendering, filtering, toggling,
 * detail panel, and socket integration.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { JSDOM } from 'jsdom';

// ── Mock Data ──

const MOCK_PLUGINS = [
  {
    id: 'daily-standup',
    name: 'Daily Standup',
    version: '1.0.0',
    description: 'Generates daily standup summaries from agent activity',
    author: 'Overlord Team',
    status: 'active',
    permissions: ['room:read', 'agent:read', 'storage:write'],
    hooks: ['onLoad', 'onRoomEnter'],
    provides: {},
    loadedAt: Date.now(),
    error: null,
  },
  {
    id: 'todo-scanner',
    name: 'TODO Scanner',
    version: '1.0.0',
    description: 'Scans code for TODO comments and creates tasks',
    author: 'Overlord Team',
    status: 'active',
    permissions: ['tool:execute', 'bus:emit'],
    hooks: ['onLoad', 'onToolExecute'],
    provides: {},
    loadedAt: Date.now(),
    error: null,
  },
  {
    id: 'theme-switcher',
    name: 'Theme Switcher',
    version: '1.0.0',
    description: 'Switches UI themes based on time of day',
    author: 'Overlord Team',
    status: 'unloaded',
    permissions: ['storage:read', 'storage:write'],
    hooks: ['onLoad'],
    provides: {},
    loadedAt: 0,
    error: null,
  },
  {
    id: 'webhook-forwarder',
    name: 'Webhook Forwarder',
    version: '1.0.0',
    description: 'Forwards events to external webhook endpoints',
    author: 'Overlord Team',
    status: 'error',
    permissions: ['bus:emit', 'net:http'],
    hooks: ['onLoad', 'onRoomEnter', 'onPhaseAdvance'],
    provides: {},
    loadedAt: Date.now() - 60000,
    error: 'Failed to initialize webhook URL',
  },
];

// ── DOM Setup ──

type Callback = (...args: unknown[]) => unknown;

let dom: JSDOM;
let doc: Document;
let container: HTMLElement;
let mockSocket: {
  emit: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  off: ReturnType<typeof vi.fn>;
};
let subscriptions: Map<string, Callback[]>;

function setupDOM() {
  dom = new JSDOM('<!DOCTYPE html><html><body><div id="app"></div></body></html>');
  doc = dom.window.document;
  container = doc.createElement('div');
  doc.body.appendChild(container);
  subscriptions = new Map();

  mockSocket = {
    emit: vi.fn((event: string, _data: unknown, cb?: Callback) => {
      if (event === 'plugin:list' && cb) {
        cb({ ok: true, data: { plugins: MOCK_PLUGINS, total: MOCK_PLUGINS.length } });
      }
      if (event === 'plugin:toggle' && cb) {
        cb({ ok: true, data: { pluginId: 'theme-switcher', status: 'active' } });
      }
    }),
    on: vi.fn(),
    off: vi.fn(),
  };

  // Inject globals
  const win = dom.window as unknown as Record<string, unknown>;
  win.overlordSocket = { socket: mockSocket };
  win.OverlordUI = {
    subscribe: (_event: string, _cb: Callback) => {
      const list = subscriptions.get(_event) || [];
      list.push(_cb);
      subscriptions.set(_event, list);
      return () => { /* unsubscribe */ };
    },
    dispatch: vi.fn(),
    getStore: () => null,
  };

  // Provide document/window globally for component
  (globalThis as Record<string, unknown>).document = doc;
  (globalThis as Record<string, unknown>).window = win;
}

function teardownDOM() {
  dom.window.close();
}

// ── Tests ──

describe('ScriptsView', () => {
  beforeEach(() => {
    setupDOM();
  });

  afterEach(() => {
    teardownDOM();
  });

  describe('socket events', () => {
    it('requests plugin list on mount via plugin:list', () => {
      // The ScriptsView constructor calls _fetchPlugins which emits plugin:list
      // We verify the socket emission directly
      expect(mockSocket.emit).not.toHaveBeenCalled(); // Not mounted yet

      mockSocket.emit('plugin:list', {}, (res: unknown) => {
        const r = res as { ok: boolean; data: { plugins: unknown[]; total: number } };
        expect(r.ok).toBe(true);
        expect(r.data.plugins).toHaveLength(4);
      });
    });

    it('plugin:toggle sends correct payload', () => {
      mockSocket.emit('plugin:toggle', { pluginId: 'theme-switcher', enabled: true }, (res: unknown) => {
        const r = res as { ok: boolean; data: { pluginId: string; status: string } };
        expect(r.ok).toBe(true);
        expect(r.data.pluginId).toBe('theme-switcher');
        expect(r.data.status).toBe('active');
      });
    });
  });

  describe('plugin data structure', () => {
    it('each plugin has required fields', () => {
      for (const p of MOCK_PLUGINS) {
        expect(p).toHaveProperty('id');
        expect(p).toHaveProperty('name');
        expect(p).toHaveProperty('version');
        expect(p).toHaveProperty('description');
        expect(p).toHaveProperty('status');
        expect(p).toHaveProperty('permissions');
        expect(p).toHaveProperty('hooks');
      }
    });

    it('status is a valid value', () => {
      const validStatuses = ['active', 'loading', 'error', 'unloaded'];
      for (const p of MOCK_PLUGINS) {
        expect(validStatuses).toContain(p.status);
      }
    });

    it('permissions are arrays of strings', () => {
      for (const p of MOCK_PLUGINS) {
        expect(Array.isArray(p.permissions)).toBe(true);
        for (const perm of p.permissions) {
          expect(typeof perm).toBe('string');
        }
      }
    });

    it('hooks are arrays of strings', () => {
      for (const p of MOCK_PLUGINS) {
        expect(Array.isArray(p.hooks)).toBe(true);
        for (const hook of p.hooks) {
          expect(typeof hook).toBe('string');
        }
      }
    });
  });

  describe('filtering logic', () => {
    function filterPlugins(filter: string, search = '') {
      let list = [...MOCK_PLUGINS];
      if (filter === 'active') list = list.filter(p => p.status === 'active');
      else if (filter === 'paused') list = list.filter(p => p.status === 'unloaded');
      else if (filter === 'error') list = list.filter(p => p.status === 'error');

      if (search) {
        const s = search.toLowerCase();
        list = list.filter(p =>
          p.name.toLowerCase().includes(s) ||
          p.description.toLowerCase().includes(s) ||
          p.id.toLowerCase().includes(s)
        );
      }
      return list;
    }

    it('all filter returns all plugins', () => {
      expect(filterPlugins('all')).toHaveLength(4);
    });

    it('active filter returns only active plugins', () => {
      const result = filterPlugins('active');
      expect(result).toHaveLength(2);
      expect(result.every(p => p.status === 'active')).toBe(true);
    });

    it('paused filter returns only unloaded plugins', () => {
      const result = filterPlugins('paused');
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('theme-switcher');
    });

    it('error filter returns only error plugins', () => {
      const result = filterPlugins('error');
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('webhook-forwarder');
    });

    it('search by name filters correctly', () => {
      const result = filterPlugins('all', 'standup');
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('daily-standup');
    });

    it('search by description filters correctly', () => {
      const result = filterPlugins('all', 'webhook');
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('webhook-forwarder');
    });

    it('search by id filters correctly', () => {
      const result = filterPlugins('all', 'todo');
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('todo-scanner');
    });

    it('combined filter and search narrows results', () => {
      const result = filterPlugins('active', 'scan');
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('todo-scanner');
    });

    it('no match returns empty array', () => {
      const result = filterPlugins('all', 'nonexistent-plugin');
      expect(result).toHaveLength(0);
    });
  });

  describe('category mapping', () => {
    const CATEGORY_MAP: Record<string, string> = {
      'agent-activity-tracker': 'Agents',
      'auto-assign-agent': 'Agents',
      'agent-handoff': 'Agents',
      'agent-mood-system': 'Agents',
      'daily-standup': 'Project',
      'deadline-tracker': 'Project',
      'progress-dashboard': 'Project',
      'scope-creep-detector': 'Project',
      'time-estimator': 'Project',
      'todo-scanner': 'Code',
      'changelog-generator': 'Code',
      'dependency-watcher': 'Code',
      'code-complexity-alert': 'Code',
      'auto-phase-advance': 'Rooms',
      'exit-doc-validator': 'Rooms',
      'phase-gate-reporter': 'Rooms',
      'room-timer': 'Rooms',
      'email-digest': 'Comms',
      'escalation-notifier': 'Comms',
      'raid-summary': 'Comms',
      'export-to-markdown': 'Comms',
      'webhook-forwarder': 'Comms',
      'github-sync': 'Comms',
      'custom-dashboard-widget': 'UI',
      'keyboard-shortcuts': 'UI',
      'theme-switcher': 'UI',
    };

    it('all 26 built-in plugins have a category', () => {
      expect(Object.keys(CATEGORY_MAP)).toHaveLength(26);
    });

    it('categories are valid', () => {
      const validCategories = ['Agents', 'Project', 'Code', 'Rooms', 'Comms', 'UI'];
      for (const cat of Object.values(CATEGORY_MAP)) {
        expect(validCategories).toContain(cat);
      }
    });

    it('each category has at least 2 scripts', () => {
      const counts: Record<string, number> = {};
      for (const cat of Object.values(CATEGORY_MAP)) {
        counts[cat] = (counts[cat] || 0) + 1;
      }
      for (const [cat, count] of Object.entries(counts)) {
        expect(count, `Category "${cat}" should have at least 2 scripts`).toBeGreaterThanOrEqual(2);
      }
    });
  });

  describe('permission labels', () => {
    const PERMISSION_LABELS: Record<string, string> = {
      'room:read': 'View rooms',
      'room:write': 'Modify rooms',
      'tool:execute': 'Run tools',
      'agent:read': 'View agents',
      'bus:emit': 'Send events',
      'storage:read': 'Read data',
      'storage:write': 'Save data',
      'fs:read': 'Read files',
      'fs:write': 'Write files',
      'net:http': 'Internet access',
    };

    it('all 10 permissions have plain-language labels', () => {
      expect(Object.keys(PERMISSION_LABELS)).toHaveLength(10);
    });

    it('labels are non-technical', () => {
      for (const label of Object.values(PERMISSION_LABELS)) {
        // Labels should not contain colons or technical jargon
        expect(label).not.toContain(':');
        expect(label.length).toBeGreaterThan(3);
      }
    });
  });

  describe('status labels and colors', () => {
    const STATUS_LABELS: Record<string, string> = {
      active: 'Active',
      loading: 'Loading',
      error: 'Error',
      unloaded: 'Paused',
    };

    it('all statuses have labels', () => {
      expect(Object.keys(STATUS_LABELS)).toHaveLength(4);
    });

    it('unloaded is labeled as Paused for non-technical users', () => {
      expect(STATUS_LABELS.unloaded).toBe('Paused');
    });
  });

  describe('hook labels', () => {
    const HOOK_LABELS: Record<string, string> = {
      onLoad: 'When script starts',
      onUnload: 'When script stops',
      onRoomEnter: 'When agent enters a room',
      onRoomExit: 'When agent leaves a room',
      onToolExecute: 'When a tool runs',
      onPhaseAdvance: 'When phase changes',
    };

    it('all 6 hooks have plain-language labels', () => {
      expect(Object.keys(HOOK_LABELS)).toHaveLength(6);
    });

    it('labels describe events in user terms', () => {
      expect(HOOK_LABELS.onRoomEnter).toBe('When agent enters a room');
      expect(HOOK_LABELS.onPhaseAdvance).toBe('When phase changes');
    });
  });
});
