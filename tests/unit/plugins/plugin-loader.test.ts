/**
 * Plugin Loader Tests
 *
 * Tests plugin discovery, manifest validation, loading, unloading,
 * hook broadcasting, and accessors. All filesystem and sandbox
 * interactions are mocked.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ─── Mocks ───

vi.mock('../../../src/core/logger.js', () => ({
  logger: {
    child: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  },
}));

const mockCreateSandbox = vi.fn();
vi.mock('../../../src/plugins/plugin-sandbox.js', () => ({
  createSandbox: async (...args: unknown[]) => mockCreateSandbox(...args),
}));

const mockFs = {
  existsSync: vi.fn(),
  readdirSync: vi.fn(),
  readFileSync: vi.fn(),
};
vi.mock('node:fs', () => mockFs);

// ─── Helpers ───

function validManifestJSON(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    id: 'test-plugin',
    name: 'Test Plugin',
    version: '1.0.0',
    description: 'A test plugin',
    engine: 'js',
    entrypoint: 'main.js',
    permissions: [],
    ...overrides,
  });
}

function makeMockSandbox(hooks: Record<string, unknown> = {}) {
  return {
    execute: vi.fn(() => ({ ok: true, data: { pluginId: 'test-plugin', hooks: Object.keys(hooks) } })),
    callHook: vi.fn(async () => ({ ok: true, data: { pluginId: 'test-plugin' } })),
    getHooks: vi.fn(() => ({ ...hooks })),
    destroy: vi.fn(),
  };
}

function makeSystemAPIs() {
  return {
    bus: { emit: vi.fn(), on: vi.fn(), off: vi.fn() },
    rooms: { registerRoomType: vi.fn(), listRooms: vi.fn(() => []), getRoom: vi.fn() },
    agents: { listAgents: vi.fn(() => []), getAgent: vi.fn() },
    tools: {
      registerTool: vi.fn(),
      getTool: vi.fn(),
      executeInRoom: vi.fn(async () => ({ ok: true, data: null })),
    },
  };
}

// Re-import module on each test to reset module-level state
let initPluginLoader: typeof import('../../../src/plugins/plugin-loader.js').initPluginLoader;
let discoverPlugins: typeof import('../../../src/plugins/plugin-loader.js').discoverPlugins;
let loadPlugin: typeof import('../../../src/plugins/plugin-loader.js').loadPlugin;
let unloadPlugin: typeof import('../../../src/plugins/plugin-loader.js').unloadPlugin;
let getPlugin: typeof import('../../../src/plugins/plugin-loader.js').getPlugin;
let listPlugins: typeof import('../../../src/plugins/plugin-loader.js').listPlugins;
let broadcastHook: typeof import('../../../src/plugins/plugin-loader.js').broadcastHook;

describe('Plugin Loader', () => {
  beforeEach(async () => {
    vi.resetModules();
    mockFs.existsSync.mockReset();
    mockFs.readdirSync.mockReset();
    mockFs.readFileSync.mockReset();
    mockCreateSandbox.mockReset();

    const mod = await import('../../../src/plugins/plugin-loader.js');
    initPluginLoader = mod.initPluginLoader;
    discoverPlugins = mod.discoverPlugins;
    loadPlugin = mod.loadPlugin;
    unloadPlugin = mod.unloadPlugin;
    getPlugin = mod.getPlugin;
    listPlugins = mod.listPlugins;
    broadcastHook = mod.broadcastHook;
  });

  // ─── initPluginLoader ───

  describe('initPluginLoader', () => {
    it('initializes without error', () => {
      expect(() => initPluginLoader(makeSystemAPIs() as never)).not.toThrow();
    });
  });

  // ─── discoverPlugins ───

  describe('discoverPlugins', () => {
    it('returns empty array when plugin dir does not exist', () => {
      mockFs.existsSync.mockReturnValue(false);
      const manifests = discoverPlugins('/plugins');
      expect(manifests).toEqual([]);
    });

    it('returns empty array when dir is empty', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readdirSync.mockReturnValue([]);
      const manifests = discoverPlugins('/plugins');
      expect(manifests).toEqual([]);
    });

    it('discovers valid plugin manifests', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readdirSync.mockReturnValue([
        { name: 'my-plugin', isDirectory: () => true },
      ]);
      mockFs.readFileSync.mockReturnValue(validManifestJSON({ id: 'my-plugin' }));

      const manifests = discoverPlugins('/plugins');
      expect(manifests).toHaveLength(1);
      expect(manifests[0].id).toBe('my-plugin');
    });

    it('skips non-directory entries', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readdirSync.mockReturnValue([
        { name: 'README.md', isDirectory: () => false },
      ]);

      const manifests = discoverPlugins('/plugins');
      expect(manifests).toEqual([]);
    });

    it('skips directories without plugin.json', () => {
      mockFs.existsSync.mockImplementation((p: string) => {
        if (p.endsWith('plugin.json')) return false;
        return true;
      });
      mockFs.readdirSync.mockReturnValue([
        { name: 'some-dir', isDirectory: () => true },
      ]);

      const manifests = discoverPlugins('/plugins');
      expect(manifests).toEqual([]);
    });

    it('skips invalid manifests and continues', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readdirSync.mockReturnValue([
        { name: 'bad-plugin', isDirectory: () => true },
        { name: 'good-plugin', isDirectory: () => true },
      ]);
      mockFs.readFileSync.mockImplementation((filePath: string) => {
        if (filePath.includes('bad-plugin')) return '{ invalid json }';
        return validManifestJSON({ id: 'good-plugin' });
      });

      const manifests = discoverPlugins('/plugins');
      // Only the valid plugin should be returned
      expect(manifests).toHaveLength(1);
      expect(manifests[0].id).toBe('good-plugin');
    });

    it('returns empty when readdirSync throws', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readdirSync.mockImplementation(() => { throw new Error('EPERM'); });

      const manifests = discoverPlugins('/plugins');
      expect(manifests).toEqual([]);
    });
  });

  // ─── Manifest Validation (via discoverPlugins) ───

  describe('manifest validation', () => {
    function discoverWithManifest(manifestJSON: string) {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readdirSync.mockReturnValue([
        { name: 'test-plugin', isDirectory: () => true },
      ]);
      mockFs.readFileSync.mockReturnValue(manifestJSON);
      return discoverPlugins('/plugins');
    }

    it('rejects non-kebab-case id', () => {
      const manifests = discoverWithManifest(validManifestJSON({ id: 'Bad_Plugin' }));
      expect(manifests).toHaveLength(0);
    });

    it('rejects empty name', () => {
      const manifests = discoverWithManifest(validManifestJSON({ name: '' }));
      expect(manifests).toHaveLength(0);
    });

    it('rejects invalid semver version', () => {
      const manifests = discoverWithManifest(validManifestJSON({ version: 'not-semver' }));
      expect(manifests).toHaveLength(0);
    });

    it('accepts valid semver with prerelease', () => {
      const manifests = discoverWithManifest(validManifestJSON({ version: '1.0.0-beta.1' }));
      expect(manifests).toHaveLength(1);
    });

    it('rejects empty description', () => {
      const manifests = discoverWithManifest(validManifestJSON({ description: '' }));
      expect(manifests).toHaveLength(0);
    });

    it('rejects invalid engine', () => {
      const manifests = discoverWithManifest(validManifestJSON({ engine: 'python' }));
      expect(manifests).toHaveLength(0);
    });

    it('accepts lua engine', () => {
      const manifests = discoverWithManifest(validManifestJSON({ engine: 'lua' }));
      expect(manifests).toHaveLength(1);
    });

    it('rejects empty entrypoint', () => {
      const manifests = discoverWithManifest(validManifestJSON({ entrypoint: '' }));
      expect(manifests).toHaveLength(0);
    });

    it('rejects invalid permissions', () => {
      const manifests = discoverWithManifest(validManifestJSON({ permissions: ['hack:the-planet'] }));
      expect(manifests).toHaveLength(0);
    });

    it('accepts valid permissions', () => {
      const manifests = discoverWithManifest(
        validManifestJSON({ permissions: ['room:read', 'bus:emit', 'storage:write'] }),
      );
      expect(manifests).toHaveLength(1);
    });

    it('rejects non-array permissions', () => {
      const manifests = discoverWithManifest(validManifestJSON({ permissions: 'room:read' }));
      expect(manifests).toHaveLength(0);
    });

    it('rejects non-object provides', () => {
      const manifests = discoverWithManifest(validManifestJSON({ provides: 'rooms' }));
      expect(manifests).toHaveLength(0);
    });

    it('rejects provides.roomTypes as non-string-array', () => {
      const manifests = discoverWithManifest(
        validManifestJSON({ provides: { roomTypes: [123] } }),
      );
      expect(manifests).toHaveLength(0);
    });

    it('accepts valid provides', () => {
      const manifests = discoverWithManifest(
        validManifestJSON({ provides: { roomTypes: ['custom-room'], tools: ['my-tool'] } }),
      );
      expect(manifests).toHaveLength(1);
    });

    it('rejects non-string author', () => {
      const manifests = discoverWithManifest(validManifestJSON({ author: 42 }));
      expect(manifests).toHaveLength(0);
    });

    it('accepts string author', () => {
      const manifests = discoverWithManifest(validManifestJSON({ author: 'Matt Rogers' }));
      expect(manifests).toHaveLength(1);
    });
  });

  // ─── loadPlugin ───

  describe('loadPlugin', () => {
    const manifest = {
      id: 'test-plugin',
      name: 'Test Plugin',
      version: '1.0.0',
      description: 'A test plugin',
      engine: 'js' as const,
      entrypoint: 'main.js',
      permissions: [] as string[],
    };

    it('fails when plugin loader not initialized', async () => {
      const result = await loadPlugin(manifest as never, '/plugins/test-plugin');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('PLUGIN_NOT_INITIALIZED');
      }
    });

    it('loads a plugin successfully', async () => {
      initPluginLoader(makeSystemAPIs() as never);
      mockFs.readFileSync.mockReturnValue('// plugin code');
      mockCreateSandbox.mockReturnValue(makeMockSandbox());

      const result = await loadPlugin(manifest as never, '/plugins/test-plugin');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.manifest.id).toBe('test-plugin');
        expect(result.data.status).toBe('active');
      }
    });

    it('stores plugin in registry after loading', async () => {
      initPluginLoader(makeSystemAPIs() as never);
      mockFs.readFileSync.mockReturnValue('// code');
      mockCreateSandbox.mockReturnValue(makeMockSandbox());

      await loadPlugin(manifest as never, '/plugins/test-plugin');
      expect(getPlugin('test-plugin')).toBeDefined();
      expect(listPlugins()).toHaveLength(1);
    });

    it('rejects duplicate plugin load', async () => {
      initPluginLoader(makeSystemAPIs() as never);
      mockFs.readFileSync.mockReturnValue('// code');
      mockCreateSandbox.mockReturnValue(makeMockSandbox());

      await loadPlugin(manifest as never, '/plugins/test-plugin');
      const result = await loadPlugin(manifest as never, '/plugins/test-plugin');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('PLUGIN_DUPLICATE');
      }
    });

    it('returns error when entrypoint cannot be read', async () => {
      initPluginLoader(makeSystemAPIs() as never);
      mockFs.readFileSync.mockImplementation(() => { throw new Error('ENOENT'); });
      mockCreateSandbox.mockReturnValue(makeMockSandbox());

      const result = await loadPlugin(manifest as never, '/plugins/test-plugin');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('PLUGIN_LOAD_ERROR');
      }
    });

    it('returns error when sandbox execution fails', async () => {
      initPluginLoader(makeSystemAPIs() as never);
      mockFs.readFileSync.mockReturnValue('invalid code;');
      const sandbox = makeMockSandbox();
      sandbox.execute.mockReturnValue({
        ok: false,
        error: { code: 'PLUGIN_EXECUTION_ERROR', message: 'SyntaxError', retryable: false },
      });
      mockCreateSandbox.mockReturnValue(sandbox);

      const result = await loadPlugin(manifest as never, '/plugins/test-plugin');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('PLUGIN_LOAD_ERROR');
      }
      // Sandbox should be destroyed on failure
      expect(sandbox.destroy).toHaveBeenCalled();
    });

    it('fires onLoad hook after loading', async () => {
      initPluginLoader(makeSystemAPIs() as never);
      mockFs.readFileSync.mockReturnValue('// code');
      const onLoadHandler = vi.fn();
      const sandbox = makeMockSandbox({ onLoad: onLoadHandler });
      mockCreateSandbox.mockReturnValue(sandbox);

      const result = await loadPlugin(manifest as never, '/plugins/test-plugin');
      expect(result.ok).toBe(true);
      expect(onLoadHandler).toHaveBeenCalledWith(
        expect.objectContaining({ hook: 'onLoad', pluginId: 'test-plugin' }),
      );
    });

    it('does not fail load when onLoad hook throws', async () => {
      initPluginLoader(makeSystemAPIs() as never);
      mockFs.readFileSync.mockReturnValue('// code');
      const onLoadHandler = vi.fn(() => { throw new Error('hook error'); });
      const sandbox = makeMockSandbox({ onLoad: onLoadHandler });
      mockCreateSandbox.mockReturnValue(sandbox);

      const result = await loadPlugin(manifest as never, '/plugins/test-plugin');
      expect(result.ok).toBe(true); // load succeeds despite hook failure
    });
  });

  // ─── unloadPlugin ───

  describe('unloadPlugin', () => {
    const manifest = {
      id: 'to-unload',
      name: 'Unload Me',
      version: '1.0.0',
      description: 'Test unload',
      engine: 'js' as const,
      entrypoint: 'main.js',
      permissions: [] as string[],
    };

    it('unloads a loaded plugin', async () => {
      initPluginLoader(makeSystemAPIs() as never);
      mockFs.readFileSync.mockReturnValue('// code');
      mockCreateSandbox.mockReturnValue(makeMockSandbox());
      await loadPlugin(manifest as never, '/plugins/to-unload');

      const result = unloadPlugin('to-unload');
      expect(result.ok).toBe(true);
      expect(getPlugin('to-unload')).toBeUndefined();
    });

    it('returns error for unknown plugin', () => {
      initPluginLoader(makeSystemAPIs() as never);
      const result = unloadPlugin('nonexistent');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('PLUGIN_NOT_FOUND');
      }
    });

    it('calls onUnload hook before cleanup', async () => {
      initPluginLoader(makeSystemAPIs() as never);
      mockFs.readFileSync.mockReturnValue('// code');
      const onUnloadHandler = vi.fn();
      const sandbox = makeMockSandbox({ onUnload: onUnloadHandler });
      mockCreateSandbox.mockReturnValue(sandbox);
      await loadPlugin(manifest as never, '/plugins/to-unload');

      unloadPlugin('to-unload');
      expect(onUnloadHandler).toHaveBeenCalled();
    });

    it('destroys sandbox on unload', async () => {
      initPluginLoader(makeSystemAPIs() as never);
      mockFs.readFileSync.mockReturnValue('// code');
      const sandbox = makeMockSandbox();
      mockCreateSandbox.mockReturnValue(sandbox);
      await loadPlugin(manifest as never, '/plugins/to-unload');

      unloadPlugin('to-unload');
      expect(sandbox.destroy).toHaveBeenCalled();
    });

    it('continues unload even if onUnload hook throws', async () => {
      initPluginLoader(makeSystemAPIs() as never);
      mockFs.readFileSync.mockReturnValue('// code');
      const onUnloadHandler = vi.fn(() => { throw new Error('cleanup failed'); });
      const sandbox = makeMockSandbox({ onUnload: onUnloadHandler });
      mockCreateSandbox.mockReturnValue(sandbox);
      await loadPlugin(manifest as never, '/plugins/to-unload');

      const result = unloadPlugin('to-unload');
      expect(result.ok).toBe(true);
      expect(getPlugin('to-unload')).toBeUndefined();
    });
  });

  // ─── getPlugin / listPlugins ───

  describe('getPlugin and listPlugins', () => {
    it('getPlugin returns undefined for unknown plugin', () => {
      expect(getPlugin('nope')).toBeUndefined();
    });

    it('listPlugins returns empty when no plugins loaded', () => {
      expect(listPlugins()).toEqual([]);
    });

    it('listPlugins returns all loaded plugins', async () => {
      initPluginLoader(makeSystemAPIs() as never);
      mockFs.readFileSync.mockReturnValue('// code');

      const manifests = [
        { id: 'plugin-a', name: 'A', version: '1.0.0', description: 'A', engine: 'js' as const, entrypoint: 'a.js', permissions: [] },
        { id: 'plugin-b', name: 'B', version: '1.0.0', description: 'B', engine: 'js' as const, entrypoint: 'b.js', permissions: [] },
      ];

      for (const m of manifests) {
        mockCreateSandbox.mockReturnValue(makeMockSandbox());
        await loadPlugin(m as never, '/plugins/' + m.id);
      }

      expect(listPlugins()).toHaveLength(2);
    });
  });

  // ─── broadcastHook ───

  describe('broadcastHook', () => {
    it('calls hook on all active plugins', async () => {
      initPluginLoader(makeSystemAPIs() as never);
      mockFs.readFileSync.mockReturnValue('// code');

      const sandbox1 = makeMockSandbox({ onRoomEnter: vi.fn() });
      const sandbox2 = makeMockSandbox({ onRoomEnter: vi.fn() });

      mockCreateSandbox.mockReturnValueOnce(sandbox1);
      await loadPlugin(
        { id: 'p1', name: 'P1', version: '1.0.0', description: 'P1', engine: 'js', entrypoint: 'a.js', permissions: [] } as never,
        '/plugins/p1',
      );

      mockCreateSandbox.mockReturnValueOnce(sandbox2);
      await loadPlugin(
        { id: 'p2', name: 'P2', version: '1.0.0', description: 'P2', engine: 'js', entrypoint: 'b.js', permissions: [] } as never,
        '/plugins/p2',
      );

      await broadcastHook('onRoomEnter', { agentId: 'a1', roomId: 'r1' });

      expect(sandbox1.callHook).toHaveBeenCalledWith('onRoomEnter', expect.objectContaining({
        hook: 'onRoomEnter',
        agentId: 'a1',
        roomId: 'r1',
      }));
      expect(sandbox2.callHook).toHaveBeenCalledWith('onRoomEnter', expect.objectContaining({
        hook: 'onRoomEnter',
      }));
    });

    it('skips plugins without the specified hook', async () => {
      initPluginLoader(makeSystemAPIs() as never);
      mockFs.readFileSync.mockReturnValue('// code');

      // Plugin has onLoad but NOT onRoomEnter
      const sandbox = makeMockSandbox({ onLoad: vi.fn() });
      mockCreateSandbox.mockReturnValue(sandbox);
      await loadPlugin(
        { id: 'no-hook', name: 'NH', version: '1.0.0', description: 'NH', engine: 'js', entrypoint: 'a.js', permissions: [] } as never,
        '/plugins/no-hook',
      );

      await broadcastHook('onRoomEnter', {});
      expect(sandbox.callHook).not.toHaveBeenCalled();
    });

    it('continues broadcasting even if one plugin hook errors', async () => {
      initPluginLoader(makeSystemAPIs() as never);
      mockFs.readFileSync.mockReturnValue('// code');

      const failSandbox = makeMockSandbox({ onToolExecute: vi.fn() });
      failSandbox.callHook.mockResolvedValue({
        ok: false,
        error: { code: 'PLUGIN_HOOK_ERROR', message: 'failed', retryable: false },
      });

      const successSandbox = makeMockSandbox({ onToolExecute: vi.fn() });
      successSandbox.callHook.mockResolvedValue({ ok: true, data: {} });

      mockCreateSandbox.mockReturnValueOnce(failSandbox);
      await loadPlugin(
        { id: 'fail-p', name: 'FP', version: '1.0.0', description: 'FP', engine: 'js', entrypoint: 'a.js', permissions: [] } as never,
        '/plugins/fail-p',
      );

      mockCreateSandbox.mockReturnValueOnce(successSandbox);
      await loadPlugin(
        { id: 'ok-p', name: 'OP', version: '1.0.0', description: 'OP', engine: 'js', entrypoint: 'b.js', permissions: [] } as never,
        '/plugins/ok-p',
      );

      await broadcastHook('onToolExecute', { toolName: 'test-tool' });

      // Both should have been called despite the first failing
      expect(failSandbox.callHook).toHaveBeenCalled();
      expect(successSandbox.callHook).toHaveBeenCalled();
    });
  });
});
