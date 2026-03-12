/**
 * Lua Sandbox Tests
 *
 * Tests the wasmoon-based Lua 5.4 sandbox for Lua plugins.
 * Covers sandbox creation, script execution, security boundaries,
 * hook registration, permission filtering, and cleanup.
 *
 * These tests use the real wasmoon engine (Lua compiled to WASM) —
 * no mocking of the Lua runtime. This validates the full stack from
 * JS → Lua VM → sandboxed API → back to JS.
 *
 * SECURITY NOTE: Tests in the "blocked globals" section intentionally
 * reference dangerous Lua standard libraries (os, io, etc.) to verify
 * they are correctly removed from the sandbox.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createLuaSandbox } from '../../../src/plugins/lua-sandbox.js';
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
    id: overrides.id ?? 'lua-test-plugin',
    name: overrides.name ?? 'Lua Test Plugin',
    version: overrides.version ?? '1.0.0',
    description: overrides.description ?? 'A test Lua plugin',
    engine: 'lua',
    entrypoint: overrides.entrypoint ?? 'main.lua',
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

describe('Lua Sandbox', () => {
  let manifest: PluginManifest;
  let context: PluginContext;

  beforeEach(() => {
    manifest = makeManifest();
    context = makeContext();
  });

  // ─── Sandbox creation ───

  describe('createLuaSandbox', () => {
    it('creates a Lua sandbox with all interface methods', async () => {
      const sandbox = await createLuaSandbox(manifest, context);
      expect(sandbox).toBeDefined();
      expect(typeof sandbox.execute).toBe('function');
      expect(typeof sandbox.callHook).toBe('function');
      expect(typeof sandbox.getHooks).toBe('function');
      expect(typeof sandbox.destroy).toBe('function');
      sandbox.destroy();
    });

    it('starts with no hooks registered', async () => {
      const sandbox = await createLuaSandbox(manifest, context);
      expect(sandbox.getHooks()).toEqual({});
      sandbox.destroy();
    });
  });

  // ─── Script execution ───

  describe('execute', () => {
    it('executes valid Lua code successfully', async () => {
      const sandbox = await createLuaSandbox(manifest, context);
      const result = sandbox.execute('local x = 1 + 1');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.pluginId).toBe('lua-test-plugin');
      }
      sandbox.destroy();
    });

    it('returns registered hook names after execution', async () => {
      const sandbox = await createLuaSandbox(manifest, context);
      const result = sandbox.execute([
        'registerHook("onLoad", function(data) end)',
        'registerHook("onRoomEnter", function(data) end)',
      ].join('\n'));
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.hooks).toContain('onLoad');
        expect(result.data.hooks).toContain('onRoomEnter');
      }
      sandbox.destroy();
    });

    it('returns error for Lua syntax errors', async () => {
      const sandbox = await createLuaSandbox(manifest, context);
      const result = sandbox.execute('function ??? invalid end');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('PLUGIN_EXECUTION_ERROR');
      }
      sandbox.destroy();
    });

    it('returns error for Lua runtime errors', async () => {
      const sandbox = await createLuaSandbox(manifest, context);
      const result = sandbox.execute('error("plugin crashed")');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('PLUGIN_EXECUTION_ERROR');
        expect(result.error.message).toContain('plugin crashed');
      }
      sandbox.destroy();
    });

    it('returns error after sandbox is destroyed', async () => {
      const sandbox = await createLuaSandbox(manifest, context);
      sandbox.destroy();
      const result = sandbox.execute('local x = 1');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('SANDBOX_DESTROYED');
      }
    });

    it('handles multiple sequential executions', async () => {
      const sandbox = await createLuaSandbox(manifest, context);
      const r1 = sandbox.execute('x = 10');
      const r2 = sandbox.execute('x = x + 5');
      expect(r1.ok).toBe(true);
      expect(r2.ok).toBe(true);
      sandbox.destroy();
    });

    it('preserves state across executions in same sandbox', async () => {
      const logFn = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
      const ctx = makeContext({ log: logFn });
      const sandbox = await createLuaSandbox(manifest, ctx);
      sandbox.execute('my_var = 42');
      sandbox.execute('overlord.log.info(tostring(my_var))');
      expect(logFn.info).toHaveBeenCalledWith('42', undefined);
      sandbox.destroy();
    });
  });

  // ─── Security: blocked globals ───
  // These tests intentionally reference dangerous Lua standard libraries
  // to verify they are correctly removed from the sandbox.

  describe('blocked globals', () => {
    it('blocks access to os library', async () => {
      const sandbox = await createLuaSandbox(manifest, context);
      const result = sandbox.execute('if os ~= nil then error("os is accessible") end');
      expect(result.ok).toBe(true);
      sandbox.destroy();
    });

    it('blocks access to io library', async () => {
      const sandbox = await createLuaSandbox(manifest, context);
      const result = sandbox.execute('if io ~= nil then error("io is accessible") end');
      expect(result.ok).toBe(true);
      sandbox.destroy();
    });

    it('blocks access to loadfile', async () => {
      const sandbox = await createLuaSandbox(manifest, context);
      const result = sandbox.execute('if loadfile ~= nil then error("loadfile is accessible") end');
      expect(result.ok).toBe(true);
      sandbox.destroy();
    });

    it('blocks access to dofile', async () => {
      const sandbox = await createLuaSandbox(manifest, context);
      const result = sandbox.execute('if dofile ~= nil then error("dofile is accessible") end');
      expect(result.ok).toBe(true);
      sandbox.destroy();
    });

    it('blocks access to require', async () => {
      const sandbox = await createLuaSandbox(manifest, context);
      const result = sandbox.execute('if require ~= nil then error("require is accessible") end');
      expect(result.ok).toBe(true);
      sandbox.destroy();
    });

    it('blocks access to package', async () => {
      const sandbox = await createLuaSandbox(manifest, context);
      const result = sandbox.execute('if package ~= nil then error("package is accessible") end');
      expect(result.ok).toBe(true);
      sandbox.destroy();
    });

    it('blocks access to debug library', async () => {
      const sandbox = await createLuaSandbox(manifest, context);
      const result = sandbox.execute('if debug ~= nil then error("debug is accessible") end');
      expect(result.ok).toBe(true);
      sandbox.destroy();
    });

    it('blocks access to collectgarbage', async () => {
      const sandbox = await createLuaSandbox(manifest, context);
      const result = sandbox.execute('if collectgarbage ~= nil then error("collectgarbage is accessible") end');
      expect(result.ok).toBe(true);
      sandbox.destroy();
    });
  });

  // ─── Safe Lua globals remain available ───

  describe('safe globals', () => {
    it('provides standard Lua functions (string, table, math)', async () => {
      const sandbox = await createLuaSandbox(manifest, context);
      const result = sandbox.execute([
        'local s = string.upper("hello")',
        'local t = {1, 2, 3}',
        'table.insert(t, 4)',
        'local n = math.max(1, 2)',
      ].join('\n'));
      expect(result.ok).toBe(true);
      sandbox.destroy();
    });

    it('provides tostring and tonumber', async () => {
      const sandbox = await createLuaSandbox(manifest, context);
      const result = sandbox.execute([
        'local s = tostring(42)',
        'local n = tonumber("42")',
      ].join('\n'));
      expect(result.ok).toBe(true);
      sandbox.destroy();
    });

    it('provides type and pairs/ipairs', async () => {
      const sandbox = await createLuaSandbox(manifest, context);
      const result = sandbox.execute([
        'local t = type("hello")',
        'for k, v in pairs({a = 1}) do end',
        'for i, v in ipairs({1, 2, 3}) do end',
      ].join('\n'));
      expect(result.ok).toBe(true);
      sandbox.destroy();
    });

    it('provides pcall for error handling', async () => {
      const sandbox = await createLuaSandbox(manifest, context);
      const result = sandbox.execute([
        'local ok, err = pcall(function() error("test") end)',
        'if ok then error("pcall should have caught the error") end',
      ].join('\n'));
      expect(result.ok).toBe(true);
      sandbox.destroy();
    });
  });

  // ─── Overlord API injection ───

  describe('overlord API', () => {
    it('exposes manifest info', async () => {
      const sandbox = await createLuaSandbox(manifest, context);
      const result = sandbox.execute([
        'if overlord.manifest.id ~= "lua-test-plugin" then error("wrong id: " .. tostring(overlord.manifest.id)) end',
        'if overlord.manifest.name ~= "Lua Test Plugin" then error("wrong name") end',
        'if overlord.manifest.version ~= "1.0.0" then error("wrong version") end',
        'if overlord.manifest.engine ~= "lua" then error("wrong engine") end',
      ].join('\n'));
      expect(result.ok).toBe(true);
      sandbox.destroy();
    });

    it('routes overlord.log calls to context.log', async () => {
      const logFn = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
      const ctx = makeContext({ log: logFn });
      const sandbox = await createLuaSandbox(manifest, ctx);
      sandbox.execute([
        'overlord.log.info("info message")',
        'overlord.log.warn("warn message")',
        'overlord.log.error("error message")',
        'overlord.log.debug("debug message")',
      ].join('\n'));
      expect(logFn.info).toHaveBeenCalledWith('info message', undefined);
      expect(logFn.warn).toHaveBeenCalledWith('warn message', undefined);
      expect(logFn.error).toHaveBeenCalledWith('error message', undefined);
      expect(logFn.debug).toHaveBeenCalledWith('debug message', undefined);
      sandbox.destroy();
    });

    it('coerces non-string log messages to string', async () => {
      const logFn = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
      const ctx = makeContext({ log: logFn });
      const sandbox = await createLuaSandbox(manifest, ctx);
      sandbox.execute('overlord.log.info(42)');
      expect(logFn.info).toHaveBeenCalledWith('42', undefined);
      sandbox.destroy();
    });
  });

  // ─── Hook registration ───

  describe('hook registration', () => {
    it('registers valid hooks via registerHook', async () => {
      const sandbox = await createLuaSandbox(manifest, context);
      sandbox.execute('registerHook("onLoad", function(data) end)');
      const hooks = sandbox.getHooks();
      expect(hooks.onLoad).toBeDefined();
      sandbox.destroy();
    });

    it('rejects invalid hook names', async () => {
      const sandbox = await createLuaSandbox(manifest, context);
      sandbox.execute('registerHook("onFoo", function(data) end)');
      const hooks = sandbox.getHooks();
      expect(Object.keys(hooks)).toHaveLength(0);
      sandbox.destroy();
    });

    it('rejects non-function hook handlers', async () => {
      const sandbox = await createLuaSandbox(manifest, context);
      sandbox.execute('registerHook("onLoad", "not a function")');
      const hooks = sandbox.getHooks();
      expect(hooks.onLoad).toBeUndefined();
      sandbox.destroy();
    });

    it('allows all valid hook types', async () => {
      const sandbox = await createLuaSandbox(manifest, context);
      sandbox.execute([
        'registerHook("onLoad", function(d) end)',
        'registerHook("onUnload", function(d) end)',
        'registerHook("onRoomEnter", function(d) end)',
        'registerHook("onRoomExit", function(d) end)',
        'registerHook("onToolExecute", function(d) end)',
        'registerHook("onPhaseAdvance", function(d) end)',
      ].join('\n'));
      const hooks = sandbox.getHooks();
      expect(Object.keys(hooks)).toHaveLength(6);
      sandbox.destroy();
    });

    it('overwrites previous handler for same hook', async () => {
      const logFn = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
      const ctx = makeContext({ log: logFn });
      const sandbox = await createLuaSandbox(manifest, ctx);
      sandbox.execute([
        'registerHook("onLoad", function(data) overlord.log.info("first") end)',
        'registerHook("onLoad", function(data) overlord.log.info("second") end)',
      ].join('\n'));
      const hooks = sandbox.getHooks();
      expect(Object.keys(hooks)).toHaveLength(1);
      sandbox.destroy();
    });
  });

  // ─── callHook ───

  describe('callHook', () => {
    it('calls a registered hook', async () => {
      const logFn = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
      const ctx = makeContext({ log: logFn });
      const sandbox = await createLuaSandbox(manifest, ctx);
      sandbox.execute('registerHook("onLoad", function(data) overlord.log.info("hook called") end)');

      const result = await sandbox.callHook('onLoad', { hook: 'onLoad' });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.hook).toBe('onLoad');
        expect(result.data.pluginId).toBe('lua-test-plugin');
      }
      expect(logFn.info).toHaveBeenCalledWith('hook called', undefined);
      sandbox.destroy();
    });

    it('skips unregistered hooks', async () => {
      const sandbox = await createLuaSandbox(manifest, context);
      const result = await sandbox.callHook('onLoad', { hook: 'onLoad' });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.skipped).toBe(true);
      }
      sandbox.destroy();
    });

    it('catches hook errors without crashing', async () => {
      const sandbox = await createLuaSandbox(manifest, context);
      sandbox.execute('registerHook("onRoomEnter", function(data) error("hook exploded") end)');

      const result = await sandbox.callHook('onRoomEnter', { hook: 'onRoomEnter' });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('PLUGIN_HOOK_ERROR');
        expect(result.error.message).toContain('hook exploded');
      }
      sandbox.destroy();
    });

    it('returns error after sandbox is destroyed', async () => {
      const sandbox = await createLuaSandbox(manifest, context);
      sandbox.execute('registerHook("onLoad", function(data) end)');
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
    it('blocks bus:emit when permission not granted', async () => {
      const bus = { emit: vi.fn(), on: vi.fn(), off: vi.fn() };
      const ctx = makeContext({ bus });
      const sandbox = await createLuaSandbox(makeManifest({ permissions: [] }), ctx);
      sandbox.execute('overlord.bus.emit("my-event", {})');
      expect(bus.emit).not.toHaveBeenCalled();
      sandbox.destroy();
    });

    it('allows bus:emit when permission granted', async () => {
      const bus = { emit: vi.fn(), on: vi.fn(), off: vi.fn() };
      const ctx = makeContext({ bus });
      const sandbox = await createLuaSandbox(makeManifest({ permissions: ['bus:emit'] }), ctx);
      sandbox.execute('overlord.bus.emit("my-event")');
      expect(bus.emit).toHaveBeenCalledWith('my-event', undefined);
      sandbox.destroy();
    });

    it('blocks room:read when permission not granted', async () => {
      const rooms = { listRooms: vi.fn(), getRoom: vi.fn(), registerRoomType: vi.fn() };
      const ctx = makeContext({ rooms });
      const sandbox = await createLuaSandbox(makeManifest({ permissions: [] }), ctx);
      sandbox.execute('overlord.rooms.list()');
      expect(rooms.listRooms).not.toHaveBeenCalled();
      sandbox.destroy();
    });

    it('allows room:read when permission granted', async () => {
      const rooms = { listRooms: vi.fn(() => []), getRoom: vi.fn(), registerRoomType: vi.fn() };
      const ctx = makeContext({ rooms });
      const sandbox = await createLuaSandbox(makeManifest({ permissions: ['room:read'] }), ctx);
      sandbox.execute('overlord.rooms.list()');
      expect(rooms.listRooms).toHaveBeenCalled();
      sandbox.destroy();
    });

    it('allows room:read get with roomId', async () => {
      const rooms = { listRooms: vi.fn(), getRoom: vi.fn(() => null), registerRoomType: vi.fn() };
      const ctx = makeContext({ rooms });
      const sandbox = await createLuaSandbox(makeManifest({ permissions: ['room:read'] }), ctx);
      sandbox.execute('overlord.rooms.get("room_123")');
      expect(rooms.getRoom).toHaveBeenCalledWith('room_123');
      sandbox.destroy();
    });

    it('blocks agent:read when permission not granted', async () => {
      const agents = { listAgents: vi.fn(), getAgent: vi.fn() };
      const ctx = makeContext({ agents });
      const sandbox = await createLuaSandbox(makeManifest({ permissions: [] }), ctx);
      sandbox.execute('overlord.agents.list()');
      expect(agents.listAgents).not.toHaveBeenCalled();
      sandbox.destroy();
    });

    it('allows agent:read when permission granted', async () => {
      const agents = { listAgents: vi.fn(() => []), getAgent: vi.fn() };
      const ctx = makeContext({ agents });
      const sandbox = await createLuaSandbox(makeManifest({ permissions: ['agent:read'] }), ctx);
      sandbox.execute('overlord.agents.list()');
      expect(agents.listAgents).toHaveBeenCalled();
      sandbox.destroy();
    });

    it('allows agent:read get with agentId', async () => {
      const agents = { listAgents: vi.fn(), getAgent: vi.fn(() => null) };
      const ctx = makeContext({ agents });
      const sandbox = await createLuaSandbox(makeManifest({ permissions: ['agent:read'] }), ctx);
      sandbox.execute('overlord.agents.get("agent_456")');
      expect(agents.getAgent).toHaveBeenCalledWith('agent_456');
      sandbox.destroy();
    });

    it('blocks storage:write when only storage:read granted', async () => {
      const storage = { get: vi.fn(), set: vi.fn(), delete: vi.fn(), keys: vi.fn(() => []) };
      const ctx = makeContext({ storage });
      const sandbox = await createLuaSandbox(makeManifest({ permissions: ['storage:read'] }), ctx);
      sandbox.execute('overlord.storage.set("key", "value")');
      expect(storage.set).not.toHaveBeenCalled();
      sandbox.destroy();
    });

    it('blocks storage:read when only storage:write granted', async () => {
      const storage = { get: vi.fn(), set: vi.fn(), delete: vi.fn(), keys: vi.fn(() => []) };
      const ctx = makeContext({ storage });
      const sandbox = await createLuaSandbox(makeManifest({ permissions: ['storage:write'] }), ctx);
      sandbox.execute('overlord.storage.get("key")');
      expect(storage.get).not.toHaveBeenCalled();
      sandbox.destroy();
    });

    it('allows storage:read and :write when both granted', async () => {
      const storage = { get: vi.fn(() => 'val'), set: vi.fn(), delete: vi.fn(() => true), keys: vi.fn(() => ['k']) };
      const ctx = makeContext({ storage });
      const sandbox = await createLuaSandbox(
        makeManifest({ permissions: ['storage:read', 'storage:write'] }),
        ctx,
      );
      sandbox.execute([
        'overlord.storage.get("key")',
        'overlord.storage.set("key", "value")',
        'overlord.storage.keys()',
        'overlord.storage.delete("key")',
      ].join('\n'));
      expect(storage.get).toHaveBeenCalledWith('key');
      expect(storage.set).toHaveBeenCalledWith('key', 'value');
      expect(storage.keys).toHaveBeenCalled();
      expect(storage.delete).toHaveBeenCalledWith('key');
      sandbox.destroy();
    });
  });

  // ─── Sandbox isolation ───

  describe('isolation', () => {
    it('separate sandboxes have independent state', async () => {
      const logA = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
      const logB = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
      const ctxA = makeContext({ log: logA });
      const ctxB = makeContext({ log: logB });

      const sandboxA = await createLuaSandbox(makeManifest({ id: 'plugin-a' }), ctxA);
      const sandboxB = await createLuaSandbox(makeManifest({ id: 'plugin-b' }), ctxB);

      sandboxA.execute('my_state = "A"');
      sandboxB.execute('my_state = "B"');

      // Each sandbox should have its own state
      sandboxA.execute('overlord.log.info(my_state)');
      sandboxB.execute('overlord.log.info(my_state)');

      expect(logA.info).toHaveBeenCalledWith('A', undefined);
      expect(logB.info).toHaveBeenCalledWith('B', undefined);

      sandboxA.destroy();
      sandboxB.destroy();
    });

    it('destroying one sandbox does not affect another', async () => {
      const sandboxA = await createLuaSandbox(makeManifest({ id: 'plugin-a' }), context);
      const sandboxB = await createLuaSandbox(makeManifest({ id: 'plugin-b' }), makeContext());

      sandboxA.destroy();

      // sandboxB should still work
      const result = sandboxB.execute('local x = 1 + 1');
      expect(result.ok).toBe(true);
      sandboxB.destroy();
    });
  });

  // ─── Sandbox destroy ───

  describe('destroy', () => {
    it('clears all hooks on destroy', async () => {
      const sandbox = await createLuaSandbox(manifest, context);
      sandbox.execute([
        'registerHook("onLoad", function(d) end)',
        'registerHook("onUnload", function(d) end)',
      ].join('\n'));
      expect(Object.keys(sandbox.getHooks())).toHaveLength(2);

      sandbox.destroy();
      expect(Object.keys(sandbox.getHooks())).toHaveLength(0);
    });

    it('is idempotent (double destroy is safe)', async () => {
      const sandbox = await createLuaSandbox(manifest, context);
      sandbox.destroy();
      sandbox.destroy(); // should not throw
    });

    it('blocks execute after destroy', async () => {
      const sandbox = await createLuaSandbox(manifest, context);
      sandbox.destroy();
      const result = sandbox.execute('local x = 1');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('SANDBOX_DESTROYED');
      }
    });

    it('blocks callHook after destroy', async () => {
      const sandbox = await createLuaSandbox(manifest, context);
      sandbox.execute('registerHook("onLoad", function(d) end)');
      sandbox.destroy();
      const result = await sandbox.callHook('onLoad', { hook: 'onLoad' });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('SANDBOX_DESTROYED');
      }
    });
  });
});
