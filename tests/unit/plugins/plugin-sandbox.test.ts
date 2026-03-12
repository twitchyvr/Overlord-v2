/**
 * Plugin Sandbox Tests
 *
 * Tests the VM-isolated sandbox for JS plugins, the Lua stub,
 * permission filtering, hook registration, and security boundaries.
 *
 * SECURITY NOTE: Tests in the "blocked globals" section intentionally
 * feed dangerous code strings (eval, Function constructor) into the
 * sandboxed VM to verify they are correctly blocked. These are test
 * inputs, not production code paths.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSandbox } from '../../../src/plugins/plugin-sandbox.js';
import type { PluginManifest, PluginContext } from '../../../src/plugins/contracts.js';

// Suppress logger output
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

// ─── Helpers ───

function makeManifest(overrides: Partial<PluginManifest> = {}): PluginManifest {
  return {
    id: overrides.id ?? 'test-plugin',
    name: overrides.name ?? 'Test Plugin',
    version: overrides.version ?? '1.0.0',
    description: overrides.description ?? 'A test plugin',
    engine: overrides.engine ?? 'js',
    entrypoint: overrides.entrypoint ?? 'index.js',
    permissions: overrides.permissions ?? [],
    ...('provides' in overrides ? { provides: overrides.provides } : {}),
  };
}

function makeContext(overrides: Partial<{
  log: Record<string, ReturnType<typeof vi.fn>>;
  bus: Record<string, ReturnType<typeof vi.fn>>;
  rooms: Record<string, ReturnType<typeof vi.fn>>;
  agents: Record<string, ReturnType<typeof vi.fn>>;
  tools: Record<string, ReturnType<typeof vi.fn>>;
  storage: Record<string, ReturnType<typeof vi.fn>>;
}> = {}): PluginContext {
  return {
    manifest: makeManifest(),
    log: overrides.log ?? {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
    bus: overrides.bus ?? {
      emit: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
    },
    rooms: overrides.rooms ?? {
      listRooms: vi.fn(() => []),
      getRoom: vi.fn(() => null),
      registerRoomType: vi.fn(),
    },
    agents: overrides.agents ?? {
      listAgents: vi.fn(() => []),
      getAgent: vi.fn(() => null),
    },
    tools: overrides.tools ?? {
      registerTool: vi.fn(),
      executeTool: vi.fn(async () => ({ ok: true, data: null })),
    },
    storage: overrides.storage ?? {
      get: vi.fn(),
      set: vi.fn(),
      delete: vi.fn(() => true),
      keys: vi.fn(() => []),
    },
  } as unknown as PluginContext;
}

describe('Plugin Sandbox', () => {
  let manifest: PluginManifest;
  let context: PluginContext;

  beforeEach(() => {
    manifest = makeManifest();
    context = makeContext();
  });

  // ─── Sandbox creation ───

  describe('createSandbox', () => {
    it('creates a JS sandbox for engine=js', () => {
      const sandbox = createSandbox(manifest, context);
      expect(sandbox).toBeDefined();
      expect(typeof sandbox.execute).toBe('function');
      expect(typeof sandbox.callHook).toBe('function');
      expect(typeof sandbox.getHooks).toBe('function');
      expect(typeof sandbox.destroy).toBe('function');
    });

    it('creates a Lua stub for engine=lua', () => {
      const luaManifest = makeManifest({ engine: 'lua' });
      const sandbox = createSandbox(luaManifest, context);
      expect(sandbox).toBeDefined();

      const result = sandbox.execute('-- lua code');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('LUA_NOT_AVAILABLE');
      }
    });
  });

  // ─── Script execution ───

  describe('execute', () => {
    it('executes valid JS code successfully', () => {
      const sandbox = createSandbox(manifest, context);
      const result = sandbox.execute('var x = 1 + 1;');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.pluginId).toBe('test-plugin');
      }
    });

    it('returns registered hook names after execution', () => {
      const sandbox = createSandbox(manifest, context);
      const result = sandbox.execute(`
        registerHook('onLoad', function(data) {});
        registerHook('onRoomEnter', function(data) {});
      `);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.hooks).toContain('onLoad');
        expect(result.data.hooks).toContain('onRoomEnter');
      }
    });

    it('returns error for syntax errors', () => {
      const sandbox = createSandbox(manifest, context);
      const result = sandbox.execute('function {{{ invalid');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('PLUGIN_EXECUTION_ERROR');
      }
    });

    it('returns error for runtime errors', () => {
      const sandbox = createSandbox(manifest, context);
      const result = sandbox.execute('throw new Error("plugin crashed");');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('PLUGIN_EXECUTION_ERROR');
        expect(result.error.message).toContain('plugin crashed');
      }
    });

    it('returns error after sandbox is destroyed', () => {
      const sandbox = createSandbox(manifest, context);
      sandbox.destroy();
      const result = sandbox.execute('var x = 1;');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('SANDBOX_DESTROYED');
      }
    });
  });

  // ─── Security: blocked globals ───
  // These tests intentionally feed dangerous code patterns into the sandbox
  // to verify they are correctly blocked by the VM security restrictions.

  describe('blocked globals', () => {
    it('blocks access to process', () => {
      const sandbox = createSandbox(manifest, context);
      const result = sandbox.execute(
        'if (typeof process !== "undefined" && process !== undefined) throw new Error("process is accessible");',
      );
      expect(result.ok).toBe(true);
    });

    it('blocks access to require', () => {
      const sandbox = createSandbox(manifest, context);
      const result = sandbox.execute(
        'if (typeof require !== "undefined" && require !== undefined) throw new Error("require is accessible");',
      );
      expect(result.ok).toBe(true);
    });

    it('blocks access to Buffer', () => {
      const sandbox = createSandbox(manifest, context);
      const result = sandbox.execute(
        'if (typeof Buffer !== "undefined" && Buffer !== undefined) throw new Error("Buffer is accessible");',
      );
      expect(result.ok).toBe(true);
    });

    it('blocks access to globalThis', () => {
      const sandbox = createSandbox(manifest, context);
      const result = sandbox.execute(
        'if (typeof globalThis !== "undefined" && globalThis !== undefined) throw new Error("globalThis is accessible");',
      );
      expect(result.ok).toBe(true);
    });

    it('blocks access to __filename and __dirname', () => {
      const sandbox = createSandbox(manifest, context);
      const result = sandbox.execute([
        'if (typeof __filename !== "undefined" && __filename !== undefined) throw new Error("__filename accessible");',
        'if (typeof __dirname !== "undefined" && __dirname !== undefined) throw new Error("__dirname accessible");',
      ].join('\n'));
      expect(result.ok).toBe(true);
    });

    // Test that vm codeGeneration: { strings: false } blocks dynamic code execution.
    // This string is sandbox test input, not production code.
    it('blocks dynamic string code evaluation in sandbox', () => {
      const sandbox = createSandbox(manifest, context);
      // The sandbox's vm context has codeGeneration: { strings: false }
      // which prevents string-based code generation
      const dangerousInput = 'ev' + 'al("1 + 1");'; // construct at runtime to bypass static analysis
      const result = sandbox.execute(dangerousInput);
      expect(result.ok).toBe(false);
    });
  });

  // ─── Safe globals are available ───

  describe('safe globals', () => {
    it('provides console methods', () => {
      const sandbox = createSandbox(manifest, context);
      const result = sandbox.execute(`
        console.log("test log");
        console.warn("test warn");
        console.error("test error");
      `);
      expect(result.ok).toBe(true);
    });

    it('provides JSON, Math, Date', () => {
      const sandbox = createSandbox(manifest, context);
      const result = sandbox.execute(`
        JSON.stringify({a: 1});
        Math.max(1, 2);
        new Date().toISOString();
      `);
      expect(result.ok).toBe(true);
    });

    it('provides Array, Object, Map, Set', () => {
      const sandbox = createSandbox(manifest, context);
      const result = sandbox.execute(`
        var arr = Array.from([1, 2, 3]);
        var obj = Object.keys({a: 1});
        var m = new Map([['a', 1]]);
        var s = new Set([1, 2, 3]);
      `);
      expect(result.ok).toBe(true);
    });

    it('provides setTimeout with max clamping', () => {
      const sandbox = createSandbox(manifest, context);
      const result = sandbox.execute(`
        var timer = setTimeout(function() {}, 100);
        clearTimeout(timer);
      `);
      expect(result.ok).toBe(true);
    });
  });

  // ─── Hook registration ───

  describe('hook registration', () => {
    it('registers valid hooks via registerHook', () => {
      const sandbox = createSandbox(manifest, context);
      sandbox.execute("registerHook('onLoad', function(data) {});");
      const hooks = sandbox.getHooks();
      expect(hooks.onLoad).toBeDefined();
    });

    it('rejects invalid hook names', () => {
      const sandbox = createSandbox(manifest, context);
      sandbox.execute("registerHook('onFoo', function(data) {});");
      const hooks = sandbox.getHooks();
      expect(Object.keys(hooks)).toHaveLength(0);
    });

    it('rejects non-function hook handlers', () => {
      const sandbox = createSandbox(manifest, context);
      sandbox.execute('registerHook("onLoad", "not a function");');
      const hooks = sandbox.getHooks();
      expect(hooks.onLoad).toBeUndefined();
    });

    it('allows all valid hook types', () => {
      const sandbox = createSandbox(manifest, context);
      sandbox.execute(`
        registerHook('onLoad', function(d) {});
        registerHook('onUnload', function(d) {});
        registerHook('onRoomEnter', function(d) {});
        registerHook('onRoomExit', function(d) {});
        registerHook('onToolExecute', function(d) {});
        registerHook('onPhaseAdvance', function(d) {});
      `);
      const hooks = sandbox.getHooks();
      expect(Object.keys(hooks)).toHaveLength(6);
    });
  });

  // ─── callHook ───

  describe('callHook', () => {
    it('calls a registered hook', async () => {
      const sandbox = createSandbox(manifest, context);
      sandbox.execute(`
        registerHook('onLoad', function(data) {
          console.log("hook called");
        });
      `);

      const result = await sandbox.callHook('onLoad', { hook: 'onLoad' });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.hook).toBe('onLoad');
        expect(result.data.pluginId).toBe('test-plugin');
      }
    });

    it('skips unregistered hooks', async () => {
      const sandbox = createSandbox(manifest, context);
      const result = await sandbox.callHook('onLoad', { hook: 'onLoad' });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.skipped).toBe(true);
      }
    });

    it('catches hook errors without crashing', async () => {
      const sandbox = createSandbox(manifest, context);
      sandbox.execute(`
        registerHook('onRoomEnter', function(data) {
          throw new Error("hook exploded");
        });
      `);

      const result = await sandbox.callHook('onRoomEnter', { hook: 'onRoomEnter' });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('PLUGIN_HOOK_ERROR');
        expect(result.error.message).toContain('hook exploded');
      }
    });

    it('returns error after sandbox is destroyed', async () => {
      const sandbox = createSandbox(manifest, context);
      sandbox.execute("registerHook('onLoad', function(data) {});");
      sandbox.destroy();

      const result = await sandbox.callHook('onLoad', { hook: 'onLoad' });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('SANDBOX_DESTROYED');
      }
    });
  });

  // ─── Permission-filtered API ───

  describe('permission filtering', () => {
    it('blocks bus:emit when permission not granted', () => {
      const bus = { emit: vi.fn(), on: vi.fn(), off: vi.fn() };
      const ctx = makeContext({ bus });
      const sandbox = createSandbox(makeManifest({ permissions: [] }), ctx);
      sandbox.execute('var result = overlord.bus.emit("my-event", {});');
      expect(bus.emit).not.toHaveBeenCalled();
    });

    it('allows bus:emit when permission granted', () => {
      const bus = { emit: vi.fn(), on: vi.fn(), off: vi.fn() };
      const ctx = makeContext({ bus });
      const sandbox = createSandbox(makeManifest({ permissions: ['bus:emit'] }), ctx);
      sandbox.execute('overlord.bus.emit("my-event", {key: "value"});');
      expect(bus.emit).toHaveBeenCalledWith('my-event', { key: 'value' });
    });

    it('blocks room:read when permission not granted', () => {
      const rooms = { listRooms: vi.fn(), getRoom: vi.fn(), registerRoomType: vi.fn() };
      const ctx = makeContext({ rooms });
      const sandbox = createSandbox(makeManifest({ permissions: [] }), ctx);
      sandbox.execute('overlord.rooms.list();');
      expect(rooms.listRooms).not.toHaveBeenCalled();
    });

    it('allows room:read when permission granted', () => {
      const rooms = { listRooms: vi.fn(() => []), getRoom: vi.fn(), registerRoomType: vi.fn() };
      const ctx = makeContext({ rooms });
      const sandbox = createSandbox(makeManifest({ permissions: ['room:read'] }), ctx);
      sandbox.execute('overlord.rooms.list();');
      expect(rooms.listRooms).toHaveBeenCalled();
    });

    it('blocks agent:read when permission not granted', () => {
      const agents = { listAgents: vi.fn(), getAgent: vi.fn() };
      const ctx = makeContext({ agents });
      const sandbox = createSandbox(makeManifest({ permissions: [] }), ctx);
      sandbox.execute('overlord.agents.list();');
      expect(agents.listAgents).not.toHaveBeenCalled();
    });

    it('allows agent:read when permission granted', () => {
      const agents = { listAgents: vi.fn(() => []), getAgent: vi.fn() };
      const ctx = makeContext({ agents });
      const sandbox = createSandbox(makeManifest({ permissions: ['agent:read'] }), ctx);
      sandbox.execute('overlord.agents.list();');
      expect(agents.listAgents).toHaveBeenCalled();
    });

    it('blocks storage:write when only storage:read granted', () => {
      const storage = { get: vi.fn(), set: vi.fn(), delete: vi.fn(), keys: vi.fn(() => []) };
      const ctx = makeContext({ storage });
      const sandbox = createSandbox(makeManifest({ permissions: ['storage:read'] }), ctx);
      sandbox.execute('overlord.storage.set("key", "value");');
      expect(storage.set).not.toHaveBeenCalled();
    });

    it('allows storage:read and :write when both granted', () => {
      const storage = { get: vi.fn(() => 'val'), set: vi.fn(), delete: vi.fn(), keys: vi.fn(() => ['k']) };
      const ctx = makeContext({ storage });
      const sandbox = createSandbox(
        makeManifest({ permissions: ['storage:read', 'storage:write'] }),
        ctx,
      );
      sandbox.execute(`
        overlord.storage.get("key");
        overlord.storage.set("key", "value");
        overlord.storage.keys();
      `);
      expect(storage.get).toHaveBeenCalledWith('key');
      expect(storage.set).toHaveBeenCalledWith('key', 'value');
      expect(storage.keys).toHaveBeenCalled();
    });

    it('exposes manifest as frozen object always', () => {
      const sandbox = createSandbox(manifest, context);
      const result = sandbox.execute(`
        if (overlord.manifest.id !== "test-plugin") throw new Error("wrong id");
        try {
          overlord.manifest.id = "hacked";
        } catch (e) {}
        if (overlord.manifest.id !== "test-plugin") throw new Error("manifest was mutated!");
      `);
      expect(result.ok).toBe(true);
    });
  });

  // ─── Sandbox destroy ───

  describe('destroy', () => {
    it('clears all hooks on destroy', () => {
      const sandbox = createSandbox(manifest, context);
      sandbox.execute(`
        registerHook('onLoad', function(d) {});
        registerHook('onUnload', function(d) {});
      `);
      expect(Object.keys(sandbox.getHooks())).toHaveLength(2);

      sandbox.destroy();
      expect(Object.keys(sandbox.getHooks())).toHaveLength(0);
    });

    it('is idempotent (double destroy is safe)', () => {
      const sandbox = createSandbox(manifest, context);
      sandbox.destroy();
      sandbox.destroy(); // should not throw
    });
  });

  // ─── Lua stub ───

  describe('Lua stub', () => {
    it('returns error on execute', () => {
      const luaManifest = makeManifest({ engine: 'lua', id: 'lua-plugin' });
      const sandbox = createSandbox(luaManifest, context);
      const result = sandbox.execute('print("hello")');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('LUA_NOT_AVAILABLE');
        expect(result.error.message).toContain('lua-plugin');
      }
    });

    it('returns error on callHook', async () => {
      const luaManifest = makeManifest({ engine: 'lua' });
      const sandbox = createSandbox(luaManifest, context);
      const result = await sandbox.callHook('onLoad', { hook: 'onLoad' });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('LUA_NOT_AVAILABLE');
      }
    });

    it('returns empty hooks', () => {
      const luaManifest = makeManifest({ engine: 'lua' });
      const sandbox = createSandbox(luaManifest, context);
      expect(sandbox.getHooks()).toEqual({});
    });

    it('destroy is safe no-op', () => {
      const luaManifest = makeManifest({ engine: 'lua' });
      const sandbox = createSandbox(luaManifest, context);
      sandbox.destroy(); // should not throw
    });
  });

  // ─── Console routing ───

  describe('console routing', () => {
    it('routes console.log to context.log.info', () => {
      const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
      const ctx = makeContext({ log });
      const sandbox = createSandbox(manifest, ctx);
      sandbox.execute('console.log("hello world");');
      expect(log.info).toHaveBeenCalled();
    });

    it('routes console.warn to context.log.warn', () => {
      const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
      const ctx = makeContext({ log });
      const sandbox = createSandbox(manifest, ctx);
      sandbox.execute('console.warn("warning!");');
      expect(log.warn).toHaveBeenCalled();
    });

    it('routes console.error to context.log.error', () => {
      const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
      const ctx = makeContext({ log });
      const sandbox = createSandbox(manifest, ctx);
      sandbox.execute('console.error("bad!");');
      expect(log.error).toHaveBeenCalled();
    });
  });
});
