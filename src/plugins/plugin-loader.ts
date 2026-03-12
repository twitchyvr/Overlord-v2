/**
 * Plugin Loader
 *
 * Discovers, loads, and manages plugin lifecycle.
 * Scans the configured plugin directory for plugin.json manifests,
 * validates them, creates sandboxed contexts, and registers any
 * room types / tools / commands the plugins provide.
 *
 * Plugin directory structure:
 *   plugins/
 *     my-plugin/
 *       plugin.json        ← manifest
 *       main.js            ← entrypoint (referenced by manifest)
 *       ...
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { logger } from '../core/logger.js';
import { ok, err } from '../core/contracts.js';
import type { Result, ToolDefinition } from '../core/contracts.js';
import { createSandbox } from './plugin-sandbox.js';
import type {
  PluginManifest,
  PluginContext,
  PluginInstance,
  PluginHook,
  PluginHookData,
  PluginPermission,
  PluginLogger,
  PluginBusAPI,
  PluginRoomAPI,
  PluginAgentAPI,
  PluginToolAPI,
  PluginStorageAPI,
  PluginSandbox,
  InitPluginsParams,
} from './contracts.js';

const log = logger.child({ module: 'plugins' });

// ─── Plugin Registry ───

const plugins = new Map<string, PluginInstance>();
const sandboxes = new Map<string, PluginSandbox>();
const pluginStorage = new Map<string, Map<string, unknown>>();

// Module-scope references to system APIs — injected via initPluginLoader
let systemBus: InitPluginsParams['bus'] | null = null;
let systemRooms: InitPluginsParams['rooms'] | null = null;
let systemAgents: InitPluginsParams['agents'] | null = null;
let systemTools: InitPluginsParams['tools'] | null = null;

// ─── Valid Permissions ───

const VALID_PERMISSIONS: Set<PluginPermission> = new Set([
  'room:read', 'room:write', 'tool:execute', 'agent:read',
  'bus:emit', 'storage:read', 'storage:write', 'fs:read', 'fs:write', 'net:http',
]);

// ─── Valid Engines ───

const VALID_ENGINES = new Set(['js', 'lua']);

// ─── Kebab-Case Validation ───

const KEBAB_CASE_RE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

// ─── Semver Validation (loose) ───

const SEMVER_RE = /^\d+\.\d+\.\d+(-[a-zA-Z0-9.]+)?$/;

/**
 * Initialize the plugin loader with system API references.
 * Must be called before discoverPlugins or loadPlugin.
 */
export function initPluginLoader(params: InitPluginsParams): void {
  systemBus = params.bus;
  systemRooms = params.rooms;
  systemAgents = params.agents;
  systemTools = params.tools;
  log.info('Plugin loader initialized');
}

// ─── Discovery ───

/**
 * Scan a directory for plugin.json manifests and return validated manifests.
 * Each subdirectory is checked for a plugin.json file.
 * Invalid manifests are logged and skipped — one bad plugin doesn't block others.
 */
export function discoverPlugins(pluginDir: string): PluginManifest[] {
  const resolvedDir = path.resolve(pluginDir);

  if (!fs.existsSync(resolvedDir)) {
    log.info({ pluginDir: resolvedDir }, 'Plugin directory does not exist — no plugins to discover');
    return [];
  }

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(resolvedDir, { withFileTypes: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error({ pluginDir: resolvedDir, error: message }, 'Failed to read plugin directory');
    return [];
  }

  const manifests: PluginManifest[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const manifestPath = path.join(resolvedDir, entry.name, 'plugin.json');
    if (!fs.existsSync(manifestPath)) {
      log.debug({ dir: entry.name }, 'No plugin.json found — skipping');
      continue;
    }

    const result = parseAndValidateManifest(manifestPath, path.join(resolvedDir, entry.name));
    if (result.ok) {
      manifests.push(result.data as PluginManifest);
      log.info(
        { pluginId: (result.data as PluginManifest).id, name: (result.data as PluginManifest).name },
        'Plugin manifest discovered',
      );
    } else {
      log.warn(
        { dir: entry.name, error: result.error.message },
        'Invalid plugin manifest — skipping',
      );
    }
  }

  log.info({ count: manifests.length, pluginDir: resolvedDir }, 'Plugin discovery complete');
  return manifests;
}

/**
 * Parse and validate a plugin.json manifest file.
 */
function parseAndValidateManifest(manifestPath: string, pluginDir: string): Result<PluginManifest> {
  let raw: string;
  try {
    raw = fs.readFileSync(manifestPath, 'utf-8');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return err('MANIFEST_READ_ERROR', `Failed to read manifest: ${message}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return err('MANIFEST_PARSE_ERROR', `Invalid JSON in plugin.json: ${message}`);
  }

  const manifest = parsed as Record<string, unknown>;

  // ─── Required fields ───

  if (typeof manifest.id !== 'string' || !KEBAB_CASE_RE.test(manifest.id)) {
    return err('MANIFEST_INVALID', `Plugin "id" must be a kebab-case string, got: "${manifest.id}"`);
  }

  if (typeof manifest.name !== 'string' || manifest.name.trim().length === 0) {
    return err('MANIFEST_INVALID', 'Plugin "name" is required and must be a non-empty string');
  }

  if (typeof manifest.version !== 'string' || !SEMVER_RE.test(manifest.version)) {
    return err('MANIFEST_INVALID', `Plugin "version" must be a valid semver string, got: "${manifest.version}"`);
  }

  if (typeof manifest.description !== 'string' || manifest.description.trim().length === 0) {
    return err('MANIFEST_INVALID', 'Plugin "description" is required and must be a non-empty string');
  }

  if (typeof manifest.engine !== 'string' || !VALID_ENGINES.has(manifest.engine)) {
    return err('MANIFEST_INVALID', `Plugin "engine" must be "js" or "lua", got: "${manifest.engine}"`);
  }

  if (typeof manifest.entrypoint !== 'string' || manifest.entrypoint.trim().length === 0) {
    return err('MANIFEST_INVALID', 'Plugin "entrypoint" is required and must be a non-empty string');
  }

  // Validate entrypoint file exists
  const entrypointPath = path.join(pluginDir, manifest.entrypoint);
  if (!fs.existsSync(entrypointPath)) {
    return err(
      'MANIFEST_INVALID',
      `Plugin entrypoint file not found: ${manifest.entrypoint} (resolved: ${entrypointPath})`,
    );
  }

  // ─── Permissions ───

  if (!Array.isArray(manifest.permissions)) {
    return err('MANIFEST_INVALID', 'Plugin "permissions" must be an array');
  }

  for (const perm of manifest.permissions) {
    if (typeof perm !== 'string' || !VALID_PERMISSIONS.has(perm as PluginPermission)) {
      return err('MANIFEST_INVALID', `Invalid permission: "${perm}". Valid permissions: ${[...VALID_PERMISSIONS].join(', ')}`);
    }
  }

  // ─── Optional: provides ───

  if (manifest.provides !== undefined) {
    if (typeof manifest.provides !== 'object' || manifest.provides === null || Array.isArray(manifest.provides)) {
      return err('MANIFEST_INVALID', '"provides" must be an object if specified');
    }
    const provides = manifest.provides as Record<string, unknown>;
    for (const key of ['roomTypes', 'tools', 'commands']) {
      if (provides[key] !== undefined) {
        if (!Array.isArray(provides[key]) || !(provides[key] as unknown[]).every((v) => typeof v === 'string')) {
          return err('MANIFEST_INVALID', `"provides.${key}" must be an array of strings`);
        }
      }
    }
  }

  // ─── Optional: author ───

  if (manifest.author !== undefined && typeof manifest.author !== 'string') {
    return err('MANIFEST_INVALID', '"author" must be a string if specified');
  }

  // Check for duplicate plugin ID
  if (plugins.has(manifest.id as string)) {
    return err('PLUGIN_DUPLICATE', `Plugin with ID "${manifest.id}" is already loaded`);
  }

  return ok(manifest as unknown as PluginManifest);
}

// ─── Loading ───

/**
 * Load a plugin from its validated manifest.
 * Creates the sandboxed context, executes the entrypoint, and registers
 * any room types / tools the plugin provides.
 */
export function loadPlugin(manifest: PluginManifest, pluginDir: string): Result<PluginInstance> {
  if (!systemBus || !systemRooms || !systemAgents || !systemTools) {
    return err('PLUGIN_NOT_INITIALIZED', 'Plugin loader not initialized. Call initPluginLoader() first.');
  }

  if (plugins.has(manifest.id)) {
    return err('PLUGIN_DUPLICATE', `Plugin "${manifest.id}" is already loaded`);
  }

  log.info({ pluginId: manifest.id, engine: manifest.engine }, 'Loading plugin...');

  // Build the plugin context (permission-filtered API surface)
  const context = buildPluginContext(manifest);

  // Create the sandbox
  const sandbox = createSandbox(manifest, context);

  // Read the entrypoint code
  const entrypointPath = path.join(pluginDir, manifest.entrypoint);
  let code: string;
  try {
    code = fs.readFileSync(entrypointPath, 'utf-8');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error({ pluginId: manifest.id, error: message }, 'Failed to read plugin entrypoint');
    sandbox.destroy();
    return err('PLUGIN_LOAD_ERROR', `Failed to read entrypoint: ${message}`);
  }

  // Execute the plugin code in the sandbox
  const execResult = sandbox.execute(code);
  if (!execResult.ok) {
    sandbox.destroy();
    const instance: PluginInstance = {
      manifest,
      status: 'error',
      error: execResult.error.message,
      hooks: {},
      context,
      loadedAt: Date.now(),
    };
    plugins.set(manifest.id, instance);
    return err('PLUGIN_LOAD_ERROR', execResult.error.message);
  }

  // Build the plugin instance
  const instance: PluginInstance = {
    manifest,
    status: 'active',
    hooks: sandbox.getHooks(),
    context,
    loadedAt: Date.now(),
  };

  plugins.set(manifest.id, instance);
  sandboxes.set(manifest.id, sandbox);

  // Register room types if the plugin provides any
  if (manifest.provides?.roomTypes) {
    for (const roomType of manifest.provides.roomTypes) {
      log.info({ pluginId: manifest.id, roomType }, 'Plugin room type declared (registration via plugin code)');
    }
  }

  // Register tools if the plugin provides any
  if (manifest.provides?.tools) {
    for (const toolName of manifest.provides.tools) {
      log.info({ pluginId: manifest.id, toolName }, 'Plugin tool declared (registration via plugin code)');
    }
  }

  // Fire the onLoad hook
  const loadHook = instance.hooks.onLoad;
  if (loadHook) {
    try {
      loadHook({ hook: 'onLoad', pluginId: manifest.id });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.error({ pluginId: manifest.id, error: message }, 'Plugin onLoad hook failed');
      // Don't fail the entire load — the plugin is active, just the hook errored
    }
  }

  log.info(
    {
      pluginId: manifest.id,
      name: manifest.name,
      version: manifest.version,
      hooks: Object.keys(instance.hooks),
      provides: manifest.provides,
    },
    'Plugin loaded successfully',
  );

  return ok(instance);
}

// ─── Unloading ───

/**
 * Unload a plugin by ID. Calls the onUnload hook, destroys the sandbox,
 * and removes the plugin from the registry.
 */
export function unloadPlugin(pluginId: string): Result {
  const instance = plugins.get(pluginId);
  if (!instance) {
    return err('PLUGIN_NOT_FOUND', `Plugin "${pluginId}" is not loaded`);
  }

  log.info({ pluginId }, 'Unloading plugin...');

  // Fire the onUnload hook
  const sandbox = sandboxes.get(pluginId);
  if (sandbox && instance.hooks.onUnload) {
    try {
      instance.hooks.onUnload({ hook: 'onUnload', pluginId });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.warn({ pluginId, error: message }, 'Plugin onUnload hook failed (continuing unload)');
    }
  }

  // Destroy the sandbox
  if (sandbox) {
    sandbox.destroy();
    sandboxes.delete(pluginId);
  }

  // Clean up storage
  pluginStorage.delete(pluginId);

  // Update instance status and remove from registry
  instance.status = 'unloaded';
  plugins.delete(pluginId);

  log.info({ pluginId }, 'Plugin unloaded');
  return ok({ pluginId });
}

// ─── Accessors ───

/**
 * Get a loaded plugin by ID.
 */
export function getPlugin(pluginId: string): PluginInstance | undefined {
  return plugins.get(pluginId);
}

/**
 * List all loaded plugins.
 */
export function listPlugins(): PluginInstance[] {
  return [...plugins.values()];
}

// ─── Hook Broadcasting ───

/**
 * Broadcast a lifecycle hook to all active plugins.
 * Errors in individual plugins are caught and logged — they don't affect other plugins.
 */
export async function broadcastHook(hook: PluginHook, data: Omit<PluginHookData, 'hook'>): Promise<void> {
  const hookData: PluginHookData = { ...data, hook };

  for (const [pluginId, sandbox] of sandboxes) {
    const instance = plugins.get(pluginId);
    if (!instance || instance.status !== 'active') continue;
    if (!instance.hooks[hook]) continue;

    try {
      const result = await sandbox.callHook(hook, hookData);
      if (!result.ok) {
        log.warn(
          { pluginId, hook, error: result.error.message },
          'Plugin hook returned error',
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.error({ pluginId, hook, error: message }, 'Plugin hook threw exception');
    }
  }
}

// ─── Plugin Context Builder ───

/**
 * Build the PluginContext for a plugin. This is the API surface exposed
 * inside the sandbox. All methods are filtered by the plugin's declared permissions.
 */
function buildPluginContext(manifest: PluginManifest): PluginContext {
  const pluginLog = buildPluginLogger(manifest.id);
  const busAPI = buildBusAPI(manifest);
  const roomAPI = buildRoomAPI(manifest);
  const agentAPI = buildAgentAPI(manifest);
  const toolAPI = buildToolAPI(manifest);
  const storageAPI = buildStorageAPI(manifest);

  return {
    manifest: Object.freeze({ ...manifest }),
    log: pluginLog,
    bus: busAPI,
    rooms: roomAPI,
    agents: agentAPI,
    tools: toolAPI,
    storage: storageAPI,
  };
}

function buildPluginLogger(pluginId: string): PluginLogger {
  const pluginLog = logger.child({ module: 'plugins', pluginId });
  return {
    info: (msg: string, data?: Record<string, unknown>) => pluginLog.info(data || {}, msg),
    warn: (msg: string, data?: Record<string, unknown>) => pluginLog.warn(data || {}, msg),
    error: (msg: string, data?: Record<string, unknown>) => pluginLog.error(data || {}, msg),
    debug: (msg: string, data?: Record<string, unknown>) => pluginLog.debug(data || {}, msg),
  };
}

function buildBusAPI(manifest: PluginManifest): PluginBusAPI {
  const hasEmit = manifest.permissions.includes('bus:emit');

  return {
    emit(event: string, data?: Record<string, unknown>) {
      if (!hasEmit) {
        log.warn({ pluginId: manifest.id }, 'bus:emit permission denied');
        return;
      }
      // Namespace all plugin events to prevent collisions
      systemBus!.emit(`plugin:${manifest.id}:${event}`, data);
    },

    on(event: string, handler: (data: Record<string, unknown>) => void) {
      if (!hasEmit) {
        log.warn({ pluginId: manifest.id }, 'bus:emit permission denied (on)');
        return;
      }
      systemBus!.on(`plugin:${manifest.id}:${event}`, handler);
    },

    off(event: string, handler: (data: Record<string, unknown>) => void) {
      if (!hasEmit) {
        log.warn({ pluginId: manifest.id }, 'bus:emit permission denied (off)');
        return;
      }
      systemBus!.off(`plugin:${manifest.id}:${event}`, handler);
    },
  };
}

function buildRoomAPI(manifest: PluginManifest): PluginRoomAPI {
  const hasRead = manifest.permissions.includes('room:read');
  const hasWrite = manifest.permissions.includes('room:write');

  return {
    listRooms(): Result {
      if (!hasRead) {
        return err('PERMISSION_DENIED', `Plugin "${manifest.id}" lacks "room:read" permission`);
      }
      return ok(systemRooms!.listRooms());
    },

    getRoom(roomId: string): Result {
      if (!hasRead) {
        return err('PERMISSION_DENIED', `Plugin "${manifest.id}" lacks "room:read" permission`);
      }
      const room = systemRooms!.getRoom(roomId);
      if (!room) {
        return err('ROOM_NOT_FOUND', `Room "${roomId}" not found`);
      }
      return ok(room);
    },

    registerRoomType(type: string, factory: unknown): Result {
      if (!hasWrite) {
        return err('PERMISSION_DENIED', `Plugin "${manifest.id}" lacks "room:write" permission`);
      }
      try {
        systemRooms!.registerRoomType(type, factory);
        log.info({ pluginId: manifest.id, roomType: type }, 'Plugin registered room type');
        return ok({ type });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return err('ROOM_TYPE_REGISTER_ERROR', `Failed to register room type: ${message}`);
      }
    },
  };
}

function buildAgentAPI(manifest: PluginManifest): PluginAgentAPI {
  const hasRead = manifest.permissions.includes('agent:read');

  return {
    listAgents(filters?: { status?: string; roomId?: string }): Result {
      if (!hasRead) {
        return err('PERMISSION_DENIED', `Plugin "${manifest.id}" lacks "agent:read" permission`);
      }
      return ok(systemAgents!.listAgents(filters));
    },

    getAgent(agentId: string): Result {
      if (!hasRead) {
        return err('PERMISSION_DENIED', `Plugin "${manifest.id}" lacks "agent:read" permission`);
      }
      const agent = systemAgents!.getAgent(agentId);
      if (!agent) {
        return err('AGENT_NOT_FOUND', `Agent "${agentId}" not found`);
      }
      return ok(agent);
    },
  };
}

function buildToolAPI(manifest: PluginManifest): PluginToolAPI {
  const hasExecute = manifest.permissions.includes('tool:execute');

  return {
    registerTool(definition: ToolDefinition): Result {
      if (!hasExecute) {
        return err('PERMISSION_DENIED', `Plugin "${manifest.id}" lacks "tool:execute" permission`);
      }
      try {
        systemTools!.registerTool(definition);
        log.info({ pluginId: manifest.id, toolName: definition.name }, 'Plugin registered tool');
        return ok({ name: definition.name });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return err('TOOL_REGISTER_ERROR', `Failed to register tool: ${message}`);
      }
    },

    async executeTool(name: string, params: Record<string, unknown>): Promise<Result> {
      if (!hasExecute) {
        return err('PERMISSION_DENIED', `Plugin "${manifest.id}" lacks "tool:execute" permission`);
      }
      const tool = systemTools!.getTool(name);
      if (!tool) {
        return err('TOOL_NOT_FOUND', `Tool "${name}" not found`);
      }
      // Execute with a plugin-scoped context
      return systemTools!.executeInRoom({
        toolName: name,
        params,
        roomAllowedTools: [name], // Plugin tools bypass room scoping
        context: {
          roomId: `plugin:${manifest.id}`,
          roomType: 'plugin',
          agentId: `plugin:${manifest.id}`,
          fileScope: 'read-only',
        },
      });
    },
  };
}

function buildStorageAPI(manifest: PluginManifest): PluginStorageAPI {
  const hasRead = manifest.permissions.includes('storage:read');
  const hasWrite = manifest.permissions.includes('storage:write');

  // Ensure plugin has its own storage namespace
  if (!pluginStorage.has(manifest.id)) {
    pluginStorage.set(manifest.id, new Map());
  }
  const storage = pluginStorage.get(manifest.id)!;

  return {
    get(key: string): unknown {
      if (!hasRead) {
        log.warn({ pluginId: manifest.id }, 'storage:read permission denied');
        return undefined;
      }
      return storage.get(key);
    },

    set(key: string, value: unknown): void {
      if (!hasWrite) {
        log.warn({ pluginId: manifest.id }, 'storage:write permission denied');
        return;
      }
      storage.set(key, value);
    },

    delete(key: string): boolean {
      if (!hasWrite) {
        log.warn({ pluginId: manifest.id }, 'storage:write permission denied');
        return false;
      }
      return storage.delete(key);
    },

    keys(): string[] {
      if (!hasRead) {
        log.warn({ pluginId: manifest.id }, 'storage:read permission denied');
        return [];
      }
      return [...storage.keys()];
    },
  };
}
