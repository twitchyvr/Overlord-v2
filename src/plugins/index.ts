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
 *     my-plugin/
 *       plugin.json    ← manifest (id, name, version, engine, entrypoint, permissions)
 *       main.js        ← entrypoint script
 */

import * as path from 'node:path';
import { config } from '../core/config.js';
import { logger } from '../core/logger.js';
import {
  initPluginLoader,
  discoverPlugins,
  loadPlugin,
  broadcastHook,
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

  // Discover plugins
  const manifests = discoverPlugins(resolvedDir);
  if (manifests.length === 0) {
    log.info('No plugins found');
    return;
  }

  // Load each discovered plugin
  let loaded = 0;
  let failed = 0;

  for (const manifest of manifests) {
    const pluginPath = path.join(resolvedDir, manifest.id);
    const result = loadPlugin(manifest, pluginPath);
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
    { total: manifests.length, loaded, failed },
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

  log.debug('Bus hooks wired for plugin lifecycle events');
}

// ─── Re-exports ───

export { discoverPlugins, loadPlugin, unloadPlugin, getPlugin, listPlugins, broadcastHook } from './plugin-loader.js';
export { createSandbox } from './plugin-sandbox.js';

// Re-export all types
export type {
  PluginManifest,
  PluginPermission,
  PluginHook,
  PluginHookData,
  PluginHookHandler,
  PluginContext,
  PluginInstance,
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
