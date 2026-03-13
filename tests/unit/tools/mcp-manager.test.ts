/**
 * MCP Manager Tests
 *
 * Tests the MCP manager module — server presets, config loading/saving,
 * server lifecycle (enable/disable/add/remove), tool registration,
 * bus event handlers, and callServerTool routing.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'eventemitter3';

// ─── Mocks ───

// Track registered tools
const registeredTools = new Map<string, { name: string; description: string; execute: (...args: unknown[]) => unknown }>();

const mockToolRegistry = {
  registerTool: vi.fn((def: { name: string; description: string }) => {
    registeredTools.set(def.name, def as any);
  }),
  getTool: vi.fn((name: string) => registeredTools.get(name) || null),
  getToolsForRoom: vi.fn(() => []),
  executeInRoom: vi.fn(),
};

// Mock McpServerConnection
const mockConnections = new Map<string, any>();
let nextStartShouldFail = false;

function createMockConnection(cfg: any, _timeout?: number) {
  const shouldFail = nextStartShouldFail;
  nextStartShouldFail = false;

  const conn = {
    config: { ...cfg },
    _ready: false,
    _status: 'disconnected' as string,
    _tools: [] as any[],
    maxReconnects: 3,
    get status() { return this._status; },
    get isReady() { return this._ready; },
    get tools() { return [...this._tools]; },
    getInfo: vi.fn(function (this: any) {
      return {
        name: this.config.name,
        description: this.config.description || '',
        status: this._status,
        tools: this._tools.map((t: any) => t.name),
        toolCount: this._tools.length,
        lastError: null,
        enabled: this.config.enabled,
        builtin: this.config.builtin,
      };
    }),
    start: shouldFail
      ? vi.fn(async () => ({
          ok: false as const,
          error: { code: 'MCP_START_FAILED', message: 'Connection refused', retryable: false },
        }))
      : vi.fn(async function (this: any) {
          this._status = 'connected';
          this._ready = true;
          this._tools = [
            { name: 'tool_a', description: 'Tool A', inputSchema: { type: 'object', properties: {} } },
            { name: 'tool_b', description: 'Tool B' },
          ];
          return { ok: true, data: { name: this.config.name, tools: ['tool_a', 'tool_b'] } };
        }),
    callTool: vi.fn(async (_toolName: string, _args: any) => {
      return { ok: true, data: 'mock result' };
    }),
    destroy: vi.fn(function (this: any) {
      this._status = 'disconnected';
      this._ready = false;
    }),
  };
  mockConnections.set(cfg.name, conn);
  return conn;
}

vi.mock('../../../src/tools/mcp-client.js', () => ({
  McpServerConnection: vi.fn((cfg: any, timeout?: number) => createMockConnection(cfg, timeout)),
}));

vi.mock('../../../src/core/logger.js', () => {
  const child = () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  });
  return { logger: { child } };
});

// Mock config
const mockConfigValues: Record<string, unknown> = {
  ENABLE_MCP: true,
  MCP_TIMEOUT_MS: 60000,
  MCP_SERVERS_CONFIG: '/tmp/test-mcp-servers.json',
};

vi.mock('../../../src/core/config.js', () => ({
  config: {
    get: vi.fn((key: string) => mockConfigValues[key]),
  },
}));

// Mock fs
const mockFsState: { files: Record<string, string>; exists: Record<string, boolean> } = {
  files: {},
  exists: {},
};

vi.mock('node:fs', () => ({
  existsSync: vi.fn((p: string) => mockFsState.exists[p] ?? false),
  readFileSync: vi.fn((p: string) => {
    if (mockFsState.files[p] !== undefined) return mockFsState.files[p];
    throw new Error(`ENOENT: no such file: ${p}`);
  }),
  writeFileSync: vi.fn((p: string, data: string) => {
    mockFsState.files[p] = data;
  }),
  mkdirSync: vi.fn(),
}));

vi.mock('node:path', async () => {
  const actual = await vi.importActual<typeof import('node:path')>('node:path');
  return {
    ...actual,
    resolve: vi.fn((p: string) => p),
  };
});

// Import after mocks
import {
  SERVER_PRESETS,
  loadServerConfig,
  listServers,
  enableServer,
  disableServer,
  addServer,
  removeServer,
  getServer,
  callServerTool,
  initMcp,
} from '../../../src/tools/mcp-manager.js';

// Create a mock bus
function createMockBus() {
  const emitter = new EventEmitter();
  const bus = {
    on: vi.fn((event: string, handler: (...args: unknown[]) => unknown) => {
      emitter.on(event, handler as any);
    }),
    emit: vi.fn((event: string, data?: any) => {
      emitter.emit(event, data);
    }),
    off: vi.fn(),
  };
  return bus;
}

describe('MCP Manager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConnections.clear();
    registeredTools.clear();
    mockFsState.files = {};
    mockFsState.exists = {};
    mockConfigValues.ENABLE_MCP = true;
    nextStartShouldFail = false;
  });

  // ─── SERVER_PRESETS ───

  describe('SERVER_PRESETS', () => {
    it('includes github preset', () => {
      expect(SERVER_PRESETS.github).toBeDefined();
      expect(SERVER_PRESETS.github.name).toBe('github');
      expect(SERVER_PRESETS.github.builtin).toBe(true);
      expect(SERVER_PRESETS.github.enabled).toBe(false);
    });

    it('includes filesystem preset', () => {
      expect(SERVER_PRESETS.filesystem).toBeDefined();
      expect(SERVER_PRESETS.filesystem.command).toBe('npx');
    });

    it('includes sequential_thinking preset', () => {
      expect(SERVER_PRESETS.sequential_thinking).toBeDefined();
    });

    it('includes obsidian preset', () => {
      expect(SERVER_PRESETS.obsidian).toBeDefined();
      expect(SERVER_PRESETS.obsidian.env).toHaveProperty('OBSIDIAN_API_KEY');
    });

    it('all presets are disabled by default', () => {
      for (const preset of Object.values(SERVER_PRESETS)) {
        expect(preset.enabled).toBe(false);
      }
    });

    it('all presets are marked builtin', () => {
      for (const preset of Object.values(SERVER_PRESETS)) {
        expect(preset.builtin).toBe(true);
      }
    });
  });

  // ─── loadServerConfig ───

  describe('loadServerConfig', () => {
    it('returns presets when config file does not exist', () => {
      mockFsState.exists['/tmp/test-mcp-servers.json'] = false;
      const configs = loadServerConfig();
      expect(configs).toEqual(Object.values(SERVER_PRESETS));
    });

    it('reads from config file when it exists', () => {
      const customConfig = [
        { name: 'custom', description: 'Custom server', command: 'node', args: ['server.js'], env: {}, enabled: true, builtin: false },
      ];
      mockFsState.exists['/tmp/test-mcp-servers.json'] = true;
      mockFsState.files['/tmp/test-mcp-servers.json'] = JSON.stringify(customConfig);

      const configs = loadServerConfig();
      expect(configs).toHaveLength(1);
      expect(configs[0].name).toBe('custom');
    });

    it('falls back to presets on invalid JSON', () => {
      mockFsState.exists['/tmp/test-mcp-servers.json'] = true;
      mockFsState.files['/tmp/test-mcp-servers.json'] = 'not json {{{';

      const configs = loadServerConfig();
      expect(configs).toEqual(Object.values(SERVER_PRESETS));
    });

    it('falls back to presets when config is not an array', () => {
      mockFsState.exists['/tmp/test-mcp-servers.json'] = true;
      mockFsState.files['/tmp/test-mcp-servers.json'] = JSON.stringify({ not: 'array' });

      const configs = loadServerConfig();
      expect(configs).toEqual(Object.values(SERVER_PRESETS));
    });
  });

  // ─── listServers ───

  describe('listServers', () => {
    it('returns all preset servers with disconnected status', () => {
      mockFsState.exists['/tmp/test-mcp-servers.json'] = false;
      const servers = listServers();
      expect(servers.length).toBe(Object.keys(SERVER_PRESETS).length);
      for (const srv of servers) {
        expect(srv.status).toBe('disconnected');
        expect(srv.tools).toEqual([]);
      }
    });
  });

  // ─── enableServer ───

  describe('enableServer', () => {
    it('returns error for unknown server name', async () => {
      mockFsState.exists['/tmp/test-mcp-servers.json'] = false;
      const result = await enableServer('nonexistent');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('MCP_UNKNOWN_SERVER');
      }
    });

    it('enables a preset server by name', async () => {
      mockFsState.exists['/tmp/test-mcp-servers.json'] = false;
      const result = await enableServer('github');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.name).toBe('github');
        expect(result.data.enabled).toBe(true);
      }
    });

    it('registers tools on enable', async () => {
      mockFsState.exists['/tmp/test-mcp-servers.json'] = false;
      // Must init the module to set toolRegistry
      const bus = createMockBus();
      await initMcp({ bus: bus as any, tools: mockToolRegistry as any });

      await enableServer('filesystem');
      expect(mockToolRegistry.registerTool).toHaveBeenCalled();
      expect(registeredTools.has('mcp_filesystem_tool_a')).toBe(true);
      expect(registeredTools.has('mcp_filesystem_tool_b')).toBe(true);
    });

    it('applies env overrides', async () => {
      mockFsState.exists['/tmp/test-mcp-servers.json'] = false;
      await enableServer('obsidian', { OBSIDIAN_API_KEY: 'key_test123' });
      const conn = mockConnections.get('obsidian');
      expect(conn).toBeDefined();
      expect(conn.config.env.OBSIDIAN_API_KEY).toBe('key_test123');
    });

    it('returns error when start fails', async () => {
      // Use a custom config entry so we get a fresh server not already in module state
      const customConfig = [
        { name: 'fail_enable', description: '', command: 'node', args: [], env: {}, enabled: false, builtin: false },
      ];
      mockFsState.exists['/tmp/test-mcp-servers.json'] = true;
      mockFsState.files['/tmp/test-mcp-servers.json'] = JSON.stringify(customConfig);
      nextStartShouldFail = true;

      const result = await enableServer('fail_enable');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('MCP_START_FAILED');
      }
    });
  });

  // ─── disableServer ───

  describe('disableServer', () => {
    it('returns error when server is not loaded', () => {
      const result = disableServer('not_loaded');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('MCP_SERVER_NOT_FOUND');
      }
    });

    it('disables a running server', async () => {
      mockFsState.exists['/tmp/test-mcp-servers.json'] = false;
      await enableServer('sequential_thinking');

      const conn = mockConnections.get('sequential_thinking');
      expect(conn).toBeDefined();

      const result = disableServer('sequential_thinking');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.enabled).toBe(false);
      }
      expect(conn.destroy).toHaveBeenCalled();
    });
  });

  // ─── addServer ───

  describe('addServer', () => {
    it('rejects config without name', async () => {
      const result = await addServer({
        name: '',
        command: 'node',
        description: '',
        args: [],
        env: {},
        enabled: false,
        builtin: false,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('MCP_INVALID_CONFIG');
      }
    });

    it('rejects config without command', async () => {
      const result = await addServer({
        name: 'test',
        command: '',
        description: '',
        args: [],
        env: {},
        enabled: false,
        builtin: false,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('MCP_INVALID_CONFIG');
      }
    });

    it('adds and starts a custom server', async () => {
      const result = await addServer({
        name: 'custom_server',
        command: 'node',
        description: 'My custom MCP server',
        args: ['custom.js'],
        env: { KEY: 'val' },
        enabled: false,
        builtin: true,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.name).toBe('custom_server');
        // addServer forces enabled=true and builtin=false
        expect(result.data.enabled).toBe(true);
        expect(result.data.builtin).toBe(false);
      }
    });

    it('rejects duplicate server name', async () => {
      await addServer({
        name: 'dup_server',
        command: 'node',
        description: '',
        args: [],
        env: {},
        enabled: false,
        builtin: false,
      });

      const result = await addServer({
        name: 'dup_server',
        command: 'node',
        description: '',
        args: [],
        env: {},
        enabled: false,
        builtin: false,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('MCP_DUPLICATE');
      }
    });

    it('removes server from map when start fails', async () => {
      nextStartShouldFail = true;

      const result = await addServer({
        name: 'fail_server',
        command: 'bad_command',
        description: '',
        args: [],
        env: {},
        enabled: false,
        builtin: false,
      });

      expect(result.ok).toBe(false);
      expect(getServer('fail_server')).toBeUndefined();
    });
  });

  // ─── removeServer ───

  describe('removeServer', () => {
    it('removes an existing server', async () => {
      await addServer({
        name: 'removable',
        command: 'node',
        description: '',
        args: [],
        env: {},
        enabled: false,
        builtin: false,
      });
      expect(getServer('removable')).toBeDefined();

      const result = removeServer('removable');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data).toEqual({ name: 'removable', status: 'removed' });
      }
      expect(getServer('removable')).toBeUndefined();
    });

    it('succeeds even if server was not loaded', () => {
      const result = removeServer('never_existed');
      expect(result.ok).toBe(true);
    });
  });

  // ─── getServer ───

  describe('getServer', () => {
    it('returns undefined for unknown server', () => {
      expect(getServer('nope')).toBeUndefined();
    });

    it('returns connection for known server', async () => {
      await addServer({
        name: 'get_test',
        command: 'node',
        description: '',
        args: [],
        env: {},
        enabled: false,
        builtin: false,
      });
      expect(getServer('get_test')).toBeDefined();
    });
  });

  // ─── callServerTool ───

  describe('callServerTool', () => {
    it('returns error for unknown server', async () => {
      const result = await callServerTool('unknown', 'tool', {});
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('MCP_SERVER_NOT_FOUND');
      }
    });

    it('routes tool call to the correct server', async () => {
      await addServer({
        name: 'routed',
        command: 'node',
        description: '',
        args: [],
        env: {},
        enabled: false,
        builtin: false,
      });

      const result = await callServerTool('routed', 'search', { query: 'test' });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data).toBe('mock result');
      }

      const conn = mockConnections.get('routed');
      expect(conn.callTool).toHaveBeenCalledWith('search', { query: 'test' });
    });
  });

  // ─── initMcp ───

  describe('initMcp', () => {
    it('skips initialization when ENABLE_MCP is false', async () => {
      mockConfigValues.ENABLE_MCP = false;
      const bus = createMockBus();

      await initMcp({ bus: bus as any, tools: mockToolRegistry as any });

      // Bus handlers should NOT be wired
      expect(bus.on).not.toHaveBeenCalled();
    });

    it('wires bus handlers when enabled', async () => {
      mockConfigValues.ENABLE_MCP = true;
      mockFsState.exists['/tmp/test-mcp-servers.json'] = false;
      const bus = createMockBus();

      await initMcp({ bus: bus as any, tools: mockToolRegistry as any });

      // Should have registered handlers for mcp events + server:shutdown
      const registeredEvents = bus.on.mock.calls.map((c: any) => c[0]);
      expect(registeredEvents).toContain('server:shutdown');
      expect(registeredEvents).toContain('mcp:list-servers');
      expect(registeredEvents).toContain('mcp:enable-server');
      expect(registeredEvents).toContain('mcp:disable-server');
      expect(registeredEvents).toContain('mcp:add-server');
      expect(registeredEvents).toContain('mcp:remove-server');
    });
  });

  // ─── Tool Registration ───

  describe('tool registration', () => {
    it('registers tools with mcp_ prefix', async () => {
      mockFsState.exists['/tmp/test-mcp-servers.json'] = false;
      await enableServer('filesystem');

      // Mock tools are tool_a and tool_b
      expect(registeredTools.has('mcp_filesystem_tool_a')).toBe(true);
      expect(registeredTools.has('mcp_filesystem_tool_b')).toBe(true);
    });

    it('tool description includes MCP server name', async () => {
      mockFsState.exists['/tmp/test-mcp-servers.json'] = false;
      await enableServer('filesystem');

      const tool = registeredTools.get('mcp_filesystem_tool_a');
      expect(tool).toBeDefined();
      expect(tool!.description).toContain('[MCP:filesystem]');
      expect(tool!.description).toContain('Tool A');
    });
  });
});
