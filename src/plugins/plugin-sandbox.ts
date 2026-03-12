/**
 * Plugin Sandbox
 *
 * Provides a sandboxed execution environment for plugins.
 * JS plugins run inside Node.js `vm` contexts with limited globals.
 * Lua plugins are stubbed — requires optional runtime dependency.
 *
 * Security model:
 * - No access to `process`, `require`, `fs`, `child_process`, or any Node.js APIs
 * - Only the PluginContext API methods are exposed, filtered by declared permissions
 * - Script execution has a configurable timeout (default 5 seconds)
 * - All errors are caught and logged — a plugin crash never takes down the server
 */

import * as vm from 'node:vm';
import { logger } from '../core/logger.js';
import { ok, err } from '../core/contracts.js';
import type { Result } from '../core/contracts.js';
import type {
  PluginManifest,
  PluginContext,
  PluginSandbox,
  PluginHook,
  PluginHookData,
  PluginHookHandler,
  PluginPermission,
} from './contracts.js';
import { createLuaSandbox } from './lua-sandbox.js';

const log = logger.child({ module: 'plugin-sandbox' });

/** Default timeout for script execution in milliseconds */
const DEFAULT_TIMEOUT_MS = 5_000;

/** Globals that are NEVER exposed to plugin code */
const BLOCKED_GLOBALS = [
  'process',
  'require',
  'module',
  'exports',
  '__filename',
  '__dirname',
  'globalThis',
  'global',
  'Buffer',
  'queueMicrotask',
  'setImmediate',
  'clearImmediate',
] as const;

/**
 * Create a sandboxed execution environment for a plugin.
 *
 * For JS plugins: uses Node.js `vm.createContext()` with a restricted global set.
 * For Lua plugins: uses wasmoon (Lua 5.4 via WASM) if ENABLE_LUA_SCRIPTING is true,
 * otherwise returns a stub that rejects all execution.
 */
export async function createSandbox(manifest: PluginManifest, context: PluginContext): Promise<PluginSandbox> {
  if (manifest.engine === 'lua') {
    if (process.env.ENABLE_LUA_SCRIPTING === 'true') {
      return createLuaSandbox(manifest, context);
    }
    return createLuaStub(manifest);
  }
  return createJsSandbox(manifest, context);
}

// ─── JS Sandbox Implementation ───

function createJsSandbox(manifest: PluginManifest, context: PluginContext): PluginSandbox {
  const hooks: Partial<Record<PluginHook, PluginHookHandler>> = {};
  let destroyed = false;

  // Build the sandbox globals — only safe primitives + permission-filtered API
  const sandboxGlobals: Record<string, unknown> = {
    // Safe JS built-ins
    console: buildSandboxConsole(manifest.id, context),
    setTimeout: buildSafeTimeout(),
    clearTimeout,
    JSON,
    Math,
    Date,
    Array,
    Object,
    String,
    Number,
    Boolean,
    RegExp,
    Map,
    Set,
    WeakMap,
    WeakSet,
    Promise,
    Symbol,
    Error,
    TypeError,
    RangeError,
    SyntaxError,
    URIError,
    encodeURI,
    encodeURIComponent,
    decodeURI,
    decodeURIComponent,
    parseInt,
    parseFloat,
    isNaN,
    isFinite,

    // Plugin API — permission-filtered
    overlord: buildPluginAPI(manifest, context, hooks),

    // Hook registration function
    registerHook: (hook: string, handler: PluginHookHandler) => {
      const validHooks: PluginHook[] = [
        'onLoad', 'onUnload', 'onRoomEnter', 'onRoomExit', 'onToolExecute', 'onPhaseAdvance',
      ];
      if (!validHooks.includes(hook as PluginHook)) {
        context.log.warn(`Invalid hook name: "${hook}". Valid hooks: ${validHooks.join(', ')}`);
        return;
      }
      if (typeof handler !== 'function') {
        context.log.warn(`Hook handler for "${hook}" must be a function`);
        return;
      }
      hooks[hook as PluginHook] = handler;
      context.log.debug(`Hook registered: ${hook}`);
    },
  };

  // Explicitly block dangerous globals
  for (const blocked of BLOCKED_GLOBALS) {
    sandboxGlobals[blocked] = undefined;
  }

  const vmContext = vm.createContext(sandboxGlobals, {
    name: `plugin:${manifest.id}`,
    codeGeneration: { strings: false, wasm: false },
  });

  log.debug({ pluginId: manifest.id }, 'JS sandbox created');

  return {
    execute(code: string): Result {
      if (destroyed) {
        return err('SANDBOX_DESTROYED', `Sandbox for plugin "${manifest.id}" has been destroyed`);
      }

      try {
        const script = new vm.Script(code, {
          filename: `plugin:${manifest.id}/${manifest.entrypoint}`,
        });

        script.runInContext(vmContext, {
          timeout: DEFAULT_TIMEOUT_MS,
          breakOnSigint: true,
        });

        log.info({ pluginId: manifest.id }, 'Plugin script executed successfully');
        return ok({ pluginId: manifest.id, hooks: Object.keys(hooks) });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const isTimeout = message.includes('Script execution timed out');
        log.error(
          { pluginId: manifest.id, error: message },
          isTimeout ? 'Plugin script timed out' : 'Plugin script execution failed',
        );
        return err(
          isTimeout ? 'PLUGIN_TIMEOUT' : 'PLUGIN_EXECUTION_ERROR',
          `Plugin "${manifest.id}" execution failed: ${message}`,
          { retryable: false, context: { pluginId: manifest.id } },
        );
      }
    },

    async callHook(hook: PluginHook, data: PluginHookData): Promise<Result> {
      if (destroyed) {
        return err('SANDBOX_DESTROYED', `Sandbox for plugin "${manifest.id}" has been destroyed`);
      }

      const handler = hooks[hook];
      if (!handler) {
        return ok({ pluginId: manifest.id, hook, skipped: true });
      }

      try {
        await Promise.resolve(handler(data));
        return ok({ pluginId: manifest.id, hook });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log.error(
          { pluginId: manifest.id, hook, error: message },
          'Plugin hook execution failed',
        );
        return err(
          'PLUGIN_HOOK_ERROR',
          `Plugin "${manifest.id}" hook "${hook}" failed: ${message}`,
          { retryable: false, context: { pluginId: manifest.id, hook } },
        );
      }
    },

    getHooks(): Partial<Record<PluginHook, PluginHookHandler>> {
      return { ...hooks };
    },

    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      // Clear all hook references
      for (const key of Object.keys(hooks) as PluginHook[]) {
        delete hooks[key];
      }
      log.debug({ pluginId: manifest.id }, 'JS sandbox destroyed');
    },
  };
}

// ─── Lua Stub ───

function createLuaStub(manifest: PluginManifest): PluginSandbox {
  const message = `Lua runtime is not available. Plugin "${manifest.id}" requires engine "lua" ` +
    'but Lua scripting support is not installed. Set ENABLE_LUA_SCRIPTING=true and install ' +
    'the Lua runtime dependency to use Lua plugins.';

  log.warn({ pluginId: manifest.id }, 'Lua plugin cannot be loaded — runtime not available');

  return {
    execute(): Result {
      return err('LUA_NOT_AVAILABLE', message, {
        retryable: false,
        context: { pluginId: manifest.id, engine: 'lua' },
      });
    },

    async callHook(): Promise<Result> {
      return err('LUA_NOT_AVAILABLE', message, {
        retryable: false,
        context: { pluginId: manifest.id, engine: 'lua' },
      });
    },

    getHooks() {
      return {};
    },

    destroy() {
      // Nothing to clean up for stub
    },
  };
}

// ─── Permission Checking ───

function hasPermission(manifest: PluginManifest, permission: PluginPermission): boolean {
  return manifest.permissions.includes(permission);
}

/**
 * Wrap a function with a permission check. If the plugin lacks the required
 * permission, the call returns an error Result instead of executing.
 */
function requirePermission<TArgs extends unknown[], TReturn>(
  manifest: PluginManifest,
  context: PluginContext,
  permission: PluginPermission,
  fn: (...args: TArgs) => TReturn,
): (...args: TArgs) => TReturn | Result {
  return (...args: TArgs) => {
    if (!hasPermission(manifest, permission)) {
      context.log.warn(
        `Permission denied: "${permission}" not granted to plugin "${manifest.id}"`,
      );
      return err(
        'PERMISSION_DENIED',
        `Plugin "${manifest.id}" does not have permission "${permission}"`,
        { retryable: false, context: { pluginId: manifest.id, permission } },
      );
    }
    return fn(...args);
  };
}

// ─── Build Permission-Filtered Plugin API ───

function buildPluginAPI(
  manifest: PluginManifest,
  context: PluginContext,
  _hooks: Partial<Record<PluginHook, PluginHookHandler>>,
): Record<string, unknown> {
  return {
    // Manifest info (always available)
    manifest: Object.freeze({ ...manifest }),

    // Logger (always available)
    log: context.log,

    // Bus API (requires bus:emit)
    bus: {
      emit: requirePermission(manifest, context, 'bus:emit', (event: string, data?: Record<string, unknown>) => {
        context.bus.emit(event, data);
      }),
      on: requirePermission(manifest, context, 'bus:emit', (event: string, handler: (data: Record<string, unknown>) => void) => {
        context.bus.on(event, handler);
      }),
      off: requirePermission(manifest, context, 'bus:emit', (event: string, handler: (data: Record<string, unknown>) => void) => {
        context.bus.off(event, handler);
      }),
    },

    // Room API
    rooms: {
      list: requirePermission(manifest, context, 'room:read', () => context.rooms.listRooms()),
      get: requirePermission(manifest, context, 'room:read', (roomId: string) => context.rooms.getRoom(roomId)),
      registerType: requirePermission(manifest, context, 'room:write', (type: string, factory: unknown) => {
        return context.rooms.registerRoomType(type, factory);
      }),
    },

    // Agent API
    agents: {
      list: requirePermission(manifest, context, 'agent:read', (filters?: { status?: string; roomId?: string }) => {
        return context.agents.listAgents(filters);
      }),
      get: requirePermission(manifest, context, 'agent:read', (agentId: string) => {
        return context.agents.getAgent(agentId);
      }),
    },

    // Tool API
    tools: {
      register: requirePermission(manifest, context, 'tool:execute', (definition: unknown) => {
        return context.tools.registerTool(definition as import('../core/contracts.js').ToolDefinition);
      }),
      execute: requirePermission(manifest, context, 'tool:execute', async (name: string, params: Record<string, unknown>) => {
        return context.tools.executeTool(name, params);
      }),
    },

    // Storage API
    storage: {
      get: requirePermission(manifest, context, 'storage:read', (key: string) => context.storage.get(key)),
      set: requirePermission(manifest, context, 'storage:write', (key: string, value: unknown) => context.storage.set(key, value)),
      delete: requirePermission(manifest, context, 'storage:write', (key: string) => context.storage.delete(key)),
      keys: requirePermission(manifest, context, 'storage:read', () => context.storage.keys()),
    },
  };
}

// ─── Safe Console (routes to plugin logger) ───

function buildSandboxConsole(pluginId: string, context: PluginContext): Record<string, unknown> {
  return {
    log: (msg: string, ...args: unknown[]) => context.log.info(String(msg), { args, pluginId }),
    info: (msg: string, ...args: unknown[]) => context.log.info(String(msg), { args, pluginId }),
    warn: (msg: string, ...args: unknown[]) => context.log.warn(String(msg), { args, pluginId }),
    error: (msg: string, ...args: unknown[]) => context.log.error(String(msg), { args, pluginId }),
    debug: (msg: string, ...args: unknown[]) => context.log.debug(String(msg), { args, pluginId }),
  };
}

// ─── Safe setTimeout (limited to prevent resource leaks) ───

function buildSafeTimeout(): (fn: () => void, ms?: number) => ReturnType<typeof setTimeout> {
  const MAX_TIMEOUT_MS = 30_000; // 30 second max for plugin timers
  return (fn: () => void, ms?: number) => {
    const clamped = Math.min(ms ?? 0, MAX_TIMEOUT_MS);
    return setTimeout(fn, clamped);
  };
}
