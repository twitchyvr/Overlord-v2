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

// ─── Security Event Store (#873) ───

import type { SecurityEvent } from './contracts.js';

/**
 * In-memory security event log — shared across all plugins.
 * NOTE: Events are NOT persisted to disk. They are lost on server restart.
 * For auditability, wire security:blocked / security:warning bus events to
 * the storage layer in a future iteration (#890).
 */
const securityEvents: SecurityEvent[] = [];
const MAX_SECURITY_EVENTS = 1000;

/** Bus reference for emitting security events to transport layer (#890) */
let _securityBus: { emit: (event: string, data: Record<string, unknown>) => boolean } | null = null;

/** Set the bus reference so security events can be broadcast */
export function setSecurityBus(bus: { emit: (event: string, data: Record<string, unknown>) => boolean }): void {
  _securityBus = bus;
}

/** Log a security event (called from Lua plugins via overlord.security.logEvent) */
export function logSecurityEvent(event: Omit<SecurityEvent, 'timestamp'>): void {
  const entry: SecurityEvent = { ...event, timestamp: Date.now() };
  securityEvents.push(entry);
  if (securityEvents.length > MAX_SECURITY_EVENTS) {
    securityEvents.splice(0, securityEvents.length - MAX_SECURITY_EVENTS);
  }
  // Broadcast to transport layer for real-time UI updates (#890)
  if (_securityBus) {
    _securityBus.emit('security:event-logged', { ...entry });
  }
}

/** Get security events, optionally filtered */
export function getSecurityEvents(filter?: { type?: string; action?: string; limit?: number }): SecurityEvent[] {
  let events = [...securityEvents];
  if (filter?.type) events = events.filter(e => e.type === filter.type);
  if (filter?.action) events = events.filter(e => e.action === filter.action);
  events.reverse(); // Most recent first
  if (filter?.limit) events = events.slice(0, filter.limit);
  return events;
}

/** Get security event counts */
export function getSecurityStats(): { total: number; blocked: number; warned: number; allowed: number } {
  return {
    total: securityEvents.length,
    blocked: securityEvents.filter(e => e.action === 'block').length,
    warned: securityEvents.filter(e => e.action === 'warn').length,
    allowed: securityEvents.filter(e => e.action === 'allow').length,
  };
}
/** Valid hook names for Lua plugins */
const VALID_HOOKS: PluginHook[] = [
  'onLoad', 'onUnload', 'onRoomEnter', 'onRoomExit', 'onToolExecute', 'onPhaseAdvance',
  'onPreToolUse', 'onPostToolUse', 'onSecurityEvent',
  'onPhaseGateEvaluate', 'onExitDocValidate', 'onAgentAssign',
  'onNotificationRule', 'onProgressReport', 'onBuildingCreate',
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

      // Queryable hooks return handler values; fire-and-forget hooks discard them
      const QUERYABLE_HOOKS: PluginHook[] = [
        'onPreToolUse', 'onPostToolUse',
        'onPhaseGateEvaluate', 'onExitDocValidate', 'onAgentAssign',
        'onNotificationRule', 'onProgressReport',
      ];

      try {
        const handlerResult = await Promise.resolve(handler(data));
        // Only pass through return values for queryable hooks (#873)
        // Fire-and-forget hooks always return the standard ok shape
        if (QUERYABLE_HOOKS.includes(hook) && handlerResult !== undefined && handlerResult !== null) {
          return ok(handlerResult);
        }
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

    // Security API (#873) — requires security:read and/or security:write
    security: {
      logEvent: (event: Record<string, unknown>) => {
        if (!manifest.permissions.includes('security:write')) {
          context.log.warn('security:write permission denied');
          return;
        }
        logSecurityEvent({
          type: String(event.type || 'unknown'),
          action: (event.action as SecurityEvent['action']) || 'warn',
          toolName: event.toolName ? String(event.toolName) : undefined,
          agentId: event.agentId ? String(event.agentId) : undefined,
          roomId: event.roomId ? String(event.roomId) : undefined,
          buildingId: event.buildingId ? String(event.buildingId) : undefined,
          message: String(event.message || ''),
          pluginId: manifest.id,
          details: event as Record<string, unknown>,
        });
      },

      getEvents: (filter?: Record<string, unknown>) => {
        if (!manifest.permissions.includes('security:read')) {
          context.log.warn('security:read permission denied');
          return [];
        }
        return getSecurityEvents(filter as { type?: string; action?: string; limit?: number });
      },

      getStats: () => {
        if (!manifest.permissions.includes('security:read')) {
          context.log.warn('security:read permission denied');
          return null;
        }
        return getSecurityStats();
      },

      /** Simple pattern matching helper for Lua scripts.
       * NOTE: Accepts regex strings from plugin code. Built-in plugins use
       * Lua string.match() (Lua patterns, not regex). Custom plugins that use
       * this function should avoid pathological patterns (e.g. (a+)+$) to
       * prevent ReDoS. The try/catch prevents crashes but not CPU hangs. */
      matchPattern: (text: string, pattern: string) => {
        try {
          return new RegExp(pattern, 'i').test(String(text));
        } catch {
          return false;
        }
      },

      /** Match text against multiple patterns — returns first matching pattern or null */
      matchAny: (text: string, patterns: string[]) => {
        const textStr = String(text);
        if (!Array.isArray(patterns)) return null;
        for (const p of patterns) {
          try {
            if (new RegExp(String(p), 'i').test(textStr)) return String(p);
          } catch {
            continue;
          }
        }
        return null;
      },

      /** Redact sensitive content by replacing matches with [REDACTED] */
      redact: (text: string, patterns: string[]) => {
        let result = String(text);
        if (!Array.isArray(patterns)) return result;
        for (const p of patterns) {
          try {
            result = result.replace(new RegExp(String(p), 'gi'), '[REDACTED]');
          } catch {
            continue;
          }
        }
        return result;
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
  engine.global.set('registerHook', (hookName: string, handler: (...args: unknown[]) => unknown) => {
    if (!VALID_HOOKS.includes(hookName as PluginHook)) {
      context.log.warn(`Invalid hook name: "${hookName}". Valid hooks: ${VALID_HOOKS.join(', ')}`);
      return;
    }
    if (typeof handler !== 'function') {
      context.log.warn(`Hook handler for "${hookName}" must be a function`);
      return;
    }

    // Wrap the Lua function as a JS PluginHookHandler that captures return values.
    // For queryable hooks (onPreToolUse, onPostToolUse, etc.), Lua functions
    // return a table like { action = "block", message = "..." } which wasmoon
    // converts to a JS object.
    hooks[hookName as PluginHook] = ((data: PluginHookData) => {
      try {
        const result = handler(data);
        return result; // Return Lua table → JS object for queryable hooks
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        context.log.error(`Hook "${hookName}" threw: ${message}`);
        throw error;
      }
    }) as PluginHookHandler;

    context.log.debug(`Hook registered: ${hookName}`);
  });
}
