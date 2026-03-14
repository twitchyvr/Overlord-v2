/**
 * Plugin System — Public API
 *
 * Discovers, loads, and manages plugins in a sandboxed environment.
 * Plugins can extend Overlord v2 with custom room types, tools,
 * commands, and lifecycle hooks.
 *
 * Usage from server.ts:
 *   import { initPlugins } from './plugins/index.js';
 *   await initPlugins({ bus, rooms, agents, tools });
 *
 * Plugin directory structure:
 *   plugins/
 *     built-in/                  ← ships with Overlord
 *       daily-standup/
 *         plugin.json
 *         main.lua
 *         README.md
 *     my-plugin/                 ← user plugins (can override built-in by ID)
 *       plugin.json
 *       main.lua
 */

import * as path from 'node:path';
import { config } from '../core/config.js';
import { logger } from '../core/logger.js';
import {
  initPluginLoader,
  discoverPlugins,
  loadPlugin,
  broadcastHook,
  queryHook,
} from './plugin-loader.js';
import type { InitPluginsParams } from './contracts.js';

const log = logger.child({ module: 'plugins' });

/**
 * Initialize the plugin system.
 *
 * 1. Checks if plugins are enabled via config (ENABLE_PLUGINS)
 * 2. Initializes the plugin loader with system API references
 * 3. Discovers all plugins in the configured PLUGIN_DIR
 * 4. Loads each discovered plugin in a sandbox
 * 5. Wires bus event listeners to broadcast hooks to active plugins
 *
 * Safe to call even if plugins are disabled — just logs and returns.
 */
export async function initPlugins(params: InitPluginsParams): Promise<void> {
  const enabled = config.get('ENABLE_PLUGINS');
  if (!enabled) {
    log.info('Plugin system disabled (ENABLE_PLUGINS=false)');
    return;
  }

  const pluginDir = config.get('PLUGIN_DIR');
  const resolvedDir = path.resolve(pluginDir);
  log.info({ pluginDir: resolvedDir }, 'Initializing plugin system...');

  // Initialize the loader with system API references
  initPluginLoader(params);

  // Discover plugins from user directory and built-in directory
  const userManifests = discoverPlugins(resolvedDir);
  const builtInDir = path.join(resolvedDir, 'built-in');
  const builtInManifests = discoverPlugins(builtInDir);

  // Merge: built-in first, user plugins can override by matching ID
  const pluginMap = new Map<string, { manifest: typeof userManifests[0]; dir: string }>();
  for (const m of builtInManifests) {
    pluginMap.set(m.id, { manifest: m, dir: path.join(builtInDir, m.id) });
  }
  for (const m of userManifests) {
    pluginMap.set(m.id, { manifest: m, dir: path.join(resolvedDir, m.id) });
  }

  if (pluginMap.size === 0) {
    log.info('No plugins found');
    return;
  }

  log.info(
    { builtIn: builtInManifests.length, user: userManifests.length, total: pluginMap.size },
    'Plugins discovered',
  );

  // Load each discovered plugin
  let loaded = 0;
  let failed = 0;

  for (const [, { manifest, dir }] of pluginMap) {
    const result = await loadPlugin(manifest, dir);
    if (result.ok) {
      loaded++;
    } else {
      failed++;
      log.error(
        { pluginId: manifest.id, error: result.error.message },
        'Failed to load plugin',
      );
    }
  }

  // Wire bus events to broadcast lifecycle hooks to plugins
  wireBusHooks(params);

  log.info(
    { total: pluginMap.size, loaded, failed },
    'Plugin system initialized',
  );
}

/**
 * Wire bus event listeners that broadcast lifecycle hooks to all active plugins.
 * This connects the Overlord event bus to the plugin hook system.
 */
function wireBusHooks(params: InitPluginsParams): void {
  const { bus } = params;

  // Room lifecycle → plugin hooks
  bus.on('room:agent:entered', (data: Record<string, unknown>) => {
    broadcastHook('onRoomEnter', {
      roomId: data.roomId as string,
      roomType: data.roomType as string,
      agentId: data.agentId as string,
      tableType: data.tableType as string,
    }).catch((error: unknown) => {
      const msg = error instanceof Error ? error.message : String(error);
      log.error({ error: msg }, 'Failed to broadcast onRoomEnter hook');
    });
  });

  bus.on('room:agent:exited', (data: Record<string, unknown>) => {
    broadcastHook('onRoomExit', {
      roomId: data.roomId as string,
      roomType: data.roomType as string,
      agentId: data.agentId as string,
    }).catch((error: unknown) => {
      const msg = error instanceof Error ? error.message : String(error);
      log.error({ error: msg }, 'Failed to broadcast onRoomExit hook');
    });
  });

  // Tool execution → plugin hooks
  bus.on('tool:executed', (data: Record<string, unknown>) => {
    broadcastHook('onToolExecute', {
      toolName: data.toolName as string,
      agentId: data.agentId as string,
      roomId: data.roomId as string,
      result: data.result,
    }).catch((error: unknown) => {
      const msg = error instanceof Error ? error.message : String(error);
      log.error({ error: msg }, 'Failed to broadcast onToolExecute hook');
    });
  });

  // Phase advancement → plugin hooks
  bus.on('phase:advanced', (data: Record<string, unknown>) => {
    broadcastHook('onPhaseAdvance', {
      buildingId: data.buildingId as string,
      fromPhase: data.fromPhase as string,
      toPhase: data.toPhase as string,
    }).catch((error: unknown) => {
      const msg = error instanceof Error ? error.message : String(error);
      log.error({ error: msg }, 'Failed to broadcast onPhaseAdvance hook');
    });
  });

  // Building creation → plugin hooks
  bus.on('building:created', (data: Record<string, unknown>) => {
    broadcastHook('onBuildingCreate', {
      buildingId: data.buildingId as string,
      name: data.name as string,
    }).catch((error: unknown) => {
      const msg = error instanceof Error ? error.message : String(error);
      log.error({ error: msg }, 'Failed to broadcast onBuildingCreate hook');
    });
  });

  // Phase gate evaluation → queryable hook (handled by queryHook in rooms layer)
  // Agent assignment → queryable hook (handled by queryHook in rooms layer)
  // Exit doc validation → queryable hook (handled by queryHook in rooms layer)
  // Notification rules → queryable hook (handled by queryHook in rooms layer)
  // These are invoked directly by the TypeScript code via queryHook() rather than bus events,
  // because they need to return values to influence behavior.

  log.debug('Bus hooks wired for plugin lifecycle events');
}

// ─── Re-exports ───

export {
  discoverPlugins, loadPlugin, unloadPlugin, getPlugin, listPlugins, broadcastHook,
  queryHook, reloadPlugin, getPluginDir, getPluginLogs,
} from './plugin-loader.js';
export { createSandbox } from './plugin-sandbox.js';
export { validateLuaSyntax } from './lua-validator.js';
export { exportBundle, importBundle } from './plugin-bundler.js';

// Re-export all types
export type {
  PluginManifest,
  PluginPermission,
  PluginHook,
  PluginHookData,
  PluginHookHandler,
  PluginContext,
  PluginInstance,
  PluginLogEntry,
  PluginSandbox,
  PluginStatus,
  PluginProvides,
  PluginLogger,
  PluginBusAPI,
  PluginRoomAPI,
  PluginAgentAPI,
  PluginToolAPI,
  PluginStorageAPI,
  InitPluginsParams,
} from './contracts.js';
