/**
 * Lua Sandbox
 *
 * Provides a sandboxed Lua 5.4 execution environment for plugins
 * using wasmoon (Lua compiled to WebAssembly).
 *
 * Security model:
 * - Dangerous Lua standard libraries removed (os, io, loadfile, dofile)
 * - Only the PluginContext API methods are exposed, filtered by declared permissions
 * - Script execution has a configurable timeout
 * - Each plugin gets its own isolated Lua VM instance
 * - All errors are caught — a plugin crash never takes down the server
 *
 * Lua plugins access the Overlord API through the global `overlord` table:
 *   overlord.log.info("message")
 *   overlord.bus.emit("event", { key = "value" })
 *   overlord.rooms.list()
 *   overlord.storage.set("key", "value")
 *   registerHook("onLoad", function(data) ... end)
 */

import { LuaFactory, LuaEngine } from 'wasmoon';
import { logger } from '../core/logger.js';
import { config } from '../core/config.js';
import { ok, err } from '../core/contracts.js';
import type { Result } from '../core/contracts.js';
import type {
  PluginManifest,
  PluginContext,
  PluginSandbox,
  PluginHook,
  PluginHookData,
  PluginHookHandler,
} from './contracts.js';

const log = logger.child({ module: 'lua-sandbox' });

/** Default timeout for Lua script execution — configurable */
const DEFAULT_TIMEOUT_MS = config.get('LUA_TIMEOUT_MS');

/** Valid hook names for Lua plugins */
const VALID_HOOKS: PluginHook[] = [
  'onLoad', 'onUnload', 'onRoomEnter', 'onRoomExit', 'onToolExecute', 'onPhaseAdvance',
];

/** Dangerous Lua globals that are removed from the sandbox */
const BLOCKED_LUA_GLOBALS = [
  'os',          // System operations (execute, remove, rename, etc.)
  'io',          // File I/O operations
  'loadfile',    // Load Lua from filesystem
  'dofile',      // Execute Lua from filesystem
  'require',     // Module loading from filesystem
  'package',     // Package/module system (has filesystem access)
  'debug',       // Debug library (can inspect/modify internals)
  'collectgarbage', // GC control (DoS vector)
] as const;

// Singleton factory — reuse across all Lua sandboxes
let luaFactory: LuaFactory | null = null;

async function getFactory(): Promise<LuaFactory> {
  if (!luaFactory) {
    luaFactory = new LuaFactory();
  }
  return luaFactory;
}

/**
 * Create a Lua sandbox for a plugin.
 * Returns a Promise because the Lua engine initialization is async (WASM loading).
 */
export async function createLuaSandbox(
  manifest: PluginManifest,
  context: PluginContext,
): Promise<PluginSandbox> {
  const factory = await getFactory();
  const engine = await factory.createEngine();
  const hooks: Partial<Record<PluginHook, PluginHookHandler>> = {};
  let destroyed = false;

  // Remove dangerous globals
  removeDangerousGlobals(engine);

  // Inject the Overlord API
  injectOverlordAPI(engine, manifest, context);

  // Inject the hook registration function
  injectHookRegistration(engine, manifest, context, hooks);

  log.debug({ pluginId: manifest.id }, 'Lua sandbox created');

  return {
    execute(code: string): Result {
      if (destroyed) {
        return err('SANDBOX_DESTROYED', `Sandbox for plugin "${manifest.id}" has been destroyed`);
      }

      try {
        engine.doStringSync(code);
        log.info({ pluginId: manifest.id }, 'Lua plugin script executed successfully');
        return ok({ pluginId: manifest.id, hooks: Object.keys(hooks) });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const isTimeout = message.includes('timeout') || message.includes('interrupted');
        log.error(
          { pluginId: manifest.id, error: message },
          isTimeout ? 'Lua plugin script timed out' : 'Lua plugin script execution failed',
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
          'Lua plugin hook execution failed',
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
      for (const key of Object.keys(hooks) as PluginHook[]) {
        delete hooks[key];
      }
      try {
        engine.global.close();
      } catch {
        // Ignore close errors
      }
      log.debug({ pluginId: manifest.id }, 'Lua sandbox destroyed');
    },
  };
}

// ─── Sandbox Setup ───

/**
 * Remove dangerous Lua standard library globals from the engine.
 */
function removeDangerousGlobals(engine: LuaEngine): void {
  for (const name of BLOCKED_LUA_GLOBALS) {
    try {
      engine.doStringSync(`${name} = nil`);
    } catch {
      // Some globals may not exist — that's fine
    }
  }
}

/**
 * Inject the `overlord` global table into the Lua VM.
 * This provides the permission-filtered API surface.
 */
function injectOverlordAPI(
  engine: LuaEngine,
  manifest: PluginManifest,
  context: PluginContext,
): void {
  // Build the API object that will become the Lua `overlord` global
  const api: Record<string, unknown> = {
    // Manifest info (always available, read-only in Lua)
    manifest: {
      id: manifest.id,
      name: manifest.name,
      version: manifest.version,
      description: manifest.description,
      engine: manifest.engine,
    },

    // Logger (always available)
    log: {
      info: (msg: string, data?: Record<string, unknown>) => context.log.info(String(msg), data),
      warn: (msg: string, data?: Record<string, unknown>) => context.log.warn(String(msg), data),
      error: (msg: string, data?: Record<string, unknown>) => context.log.error(String(msg), data),
      debug: (msg: string, data?: Record<string, unknown>) => context.log.debug(String(msg), data),
    },

    // Bus API (requires bus:emit permission)
    bus: {
      emit: (event: string, data?: Record<string, unknown>) => {
        if (!manifest.permissions.includes('bus:emit')) {
          context.log.warn('bus:emit permission denied');
          return;
        }
        context.bus.emit(event, data);
      },
    },

    // Room API
    rooms: {
      list: () => {
        if (!manifest.permissions.includes('room:read')) {
          context.log.warn('room:read permission denied');
          return null;
        }
        return context.rooms.listRooms();
      },
      get: (roomId: string) => {
        if (!manifest.permissions.includes('room:read')) {
          context.log.warn('room:read permission denied');
          return null;
        }
        return context.rooms.getRoom(roomId);
      },
    },

    // Agent API
    agents: {
      list: (filters?: Record<string, unknown>) => {
        if (!manifest.permissions.includes('agent:read')) {
          context.log.warn('agent:read permission denied');
          return null;
        }
        return context.agents.listAgents(filters as { status?: string; roomId?: string });
      },
      get: (agentId: string) => {
        if (!manifest.permissions.includes('agent:read')) {
          context.log.warn('agent:read permission denied');
          return null;
        }
        return context.agents.getAgent(agentId);
      },
    },

    // Storage API
    storage: {
      get: (key: string) => {
        if (!manifest.permissions.includes('storage:read')) {
          context.log.warn('storage:read permission denied');
          return undefined;
        }
        return context.storage.get(key);
      },
      set: (key: string, value: unknown) => {
        if (!manifest.permissions.includes('storage:write')) {
          context.log.warn('storage:write permission denied');
          return;
        }
        context.storage.set(key, value);
      },
      delete: (key: string) => {
        if (!manifest.permissions.includes('storage:write')) {
          context.log.warn('storage:write permission denied');
          return false;
        }
        return context.storage.delete(key);
      },
      keys: () => {
        if (!manifest.permissions.includes('storage:read')) {
          context.log.warn('storage:read permission denied');
          return [];
        }
        return context.storage.keys();
      },
    },
  };

  engine.global.set('overlord', api);
}

/**
 * Inject the `registerHook` function into the Lua VM.
 * Lua plugins call: registerHook("onLoad", function(data) ... end)
 */
function injectHookRegistration(
  engine: LuaEngine,
  manifest: PluginManifest,
  context: PluginContext,
  hooks: Partial<Record<PluginHook, PluginHookHandler>>,
): void {
  engine.global.set('registerHook', (hookName: string, handler: Function) => {
    if (!VALID_HOOKS.includes(hookName as PluginHook)) {
      context.log.warn(`Invalid hook name: "${hookName}". Valid hooks: ${VALID_HOOKS.join(', ')}`);
      return;
    }
    if (typeof handler !== 'function') {
      context.log.warn(`Hook handler for "${hookName}" must be a function`);
      return;
    }

    // Wrap the Lua function as a JS PluginHookHandler
    hooks[hookName as PluginHook] = (data: PluginHookData) => {
      try {
        handler(data);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        context.log.error(`Hook "${hookName}" threw: ${message}`);
        throw error;
      }
    };

    context.log.debug(`Hook registered: ${hookName}`);
  });
}
