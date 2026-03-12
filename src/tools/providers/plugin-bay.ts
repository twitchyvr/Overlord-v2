/**
 * Plugin Bay Tools
 *
 * Tools for the Plugin Bay room on the Integration Floor.
 * Manages plugin lifecycle: installation, configuration, testing, and removal.
 *
 * These tools interact with the plugin system (src/plugins/) to manage
 * JavaScript plugins loaded into the VM sandbox.
 *
 * Tools:
 *   install_plugin     — Install/load a plugin from file or registry
 *   uninstall_plugin   — Remove/unload a plugin
 *   configure_plugin   — Update plugin configuration
 *   test_plugin        — Run a plugin's hook in a sandbox and verify output
 *   list_plugins       — List all installed plugins with status
 */

import { logger } from '../../core/logger.js';

const log = logger.child({ module: 'tool:plugin-bay' });

// In-memory plugin state (delegates to plugin system when available)
interface PluginEntry {
  id: string;
  name: string;
  version: string;
  status: 'active' | 'disabled' | 'error';
  config: Record<string, unknown>;
  hooks: string[];
  installedAt: number;
  lastTested?: number;
  lastTestResult?: 'pass' | 'fail';
}

// ── install_plugin ─────────────────────────────────────────

export interface InstallPluginParams {
  name: string;
  source: string; // file path or 'builtin:name'
  version?: string;
  config?: Record<string, unknown>;
}

export interface InstallPluginResult {
  pluginId: string;
  name: string;
  version: string;
  status: 'installed' | 'already-installed';
  hooks: string[];
}

export async function installPlugin(
  params: InstallPluginParams,
  pluginLoader?: {
    loadPlugin: (manifest: Record<string, unknown>, code: string) => Promise<{ ok: boolean; data?: { pluginId: string; hooks: string[] }; error?: { message: string } }>;
  },
): Promise<InstallPluginResult> {
  const { name, source, version = '0.0.0', config: pluginConfig = {} } = params;

  log.info({ name, source, version }, 'Installing plugin');

  // Check if plugin loader is available
  if (pluginLoader) {
    // Load from plugin system
    const manifest = {
      id: `plugin-${name}-${Date.now().toString(36)}`,
      name,
      version,
      permissions: ['room:read'],
      config: pluginConfig,
    };

    // Read source file if it's a path
    let code: string;
    if (source.startsWith('builtin:')) {
      code = getBuiltinPluginCode(source.replace('builtin:', ''));
    } else {
      const { readFileImpl } = await import('./filesystem.js');
      const file = await readFileImpl({ path: source });
      code = file.content;
    }

    const result = await pluginLoader.loadPlugin(manifest, code);
    if (!result.ok) {
      throw new Error(`Plugin installation failed: ${result.error?.message}`);
    }

    return {
      pluginId: result.data!.pluginId,
      name,
      version,
      status: 'installed',
      hooks: result.data!.hooks,
    };
  }

  // Fallback: register in memory without plugin system
  const pluginId = `plugin-${name}-${Date.now().toString(36)}`;
  pluginRegistry.set(pluginId, {
    id: pluginId,
    name,
    version,
    status: 'active',
    config: pluginConfig,
    hooks: [],
    installedAt: Date.now(),
  });

  return {
    pluginId,
    name,
    version,
    status: 'installed',
    hooks: [],
  };
}

// ── uninstall_plugin ───────────────────────────────────────

export interface UninstallPluginParams {
  name?: string;
  pluginId?: string;
}

export interface UninstallPluginResult {
  pluginId: string;
  name: string;
  status: 'uninstalled' | 'not-found';
}

export async function uninstallPlugin(
  params: UninstallPluginParams,
  pluginLoader?: {
    unloadPlugin: (pluginId: string) => Promise<{ ok: boolean; error?: { message: string } }>;
  },
): Promise<UninstallPluginResult> {
  const entry = findPlugin(params.pluginId, params.name);

  if (!entry) {
    return {
      pluginId: params.pluginId || '',
      name: params.name || '',
      status: 'not-found',
    };
  }

  log.info({ pluginId: entry.id, name: entry.name }, 'Uninstalling plugin');

  if (pluginLoader) {
    const result = await pluginLoader.unloadPlugin(entry.id);
    if (!result.ok) {
      throw new Error(`Plugin uninstall failed: ${result.error?.message}`);
    }
  }

  pluginRegistry.delete(entry.id);

  return {
    pluginId: entry.id,
    name: entry.name,
    status: 'uninstalled',
  };
}

// ── configure_plugin ───────────────────────────────────────

export interface ConfigurePluginParams {
  pluginId?: string;
  name?: string;
  config: Record<string, unknown>;
}

export interface ConfigurePluginResult {
  pluginId: string;
  name: string;
  previousConfig: Record<string, unknown>;
  newConfig: Record<string, unknown>;
}

export function configurePlugin(params: ConfigurePluginParams): ConfigurePluginResult {
  const entry = findPlugin(params.pluginId, params.name);
  if (!entry) {
    throw new Error(`Plugin not found: ${params.pluginId || params.name}`);
  }

  const previousConfig = { ...entry.config };
  entry.config = { ...entry.config, ...params.config };

  log.info({ pluginId: entry.id, name: entry.name }, 'Plugin configured');

  return {
    pluginId: entry.id,
    name: entry.name,
    previousConfig,
    newConfig: entry.config,
  };
}

// ── test_plugin ────────────────────────────────────────────

export interface TestPluginParams {
  pluginId?: string;
  name?: string;
  hook?: string;
}

export interface TestPluginResult {
  pluginId: string;
  name: string;
  hookTested: string;
  passed: boolean;
  details: string;
  responseTime: number;
}

export async function testPlugin(
  params: TestPluginParams,
  pluginLoader?: {
    callHook: (pluginId: string, hook: string, context: Record<string, unknown>) => Promise<{ ok: boolean; error?: { message: string } }>;
  },
): Promise<TestPluginResult> {
  const entry = findPlugin(params.pluginId, params.name);
  if (!entry) {
    throw new Error(`Plugin not found: ${params.pluginId || params.name}`);
  }

  const hook = params.hook || 'onLoad';
  const start = Date.now();

  if (pluginLoader) {
    try {
      const result = await pluginLoader.callHook(entry.id, hook, { test: true });
      const elapsed = Date.now() - start;

      entry.lastTested = Date.now();
      entry.lastTestResult = result.ok ? 'pass' : 'fail';

      return {
        pluginId: entry.id,
        name: entry.name,
        hookTested: hook,
        passed: result.ok,
        details: result.ok ? `Hook "${hook}" executed successfully` : `Hook failed: ${result.error?.message}`,
        responseTime: elapsed,
      };
    } catch (error) {
      const elapsed = Date.now() - start;
      entry.lastTested = Date.now();
      entry.lastTestResult = 'fail';

      return {
        pluginId: entry.id,
        name: entry.name,
        hookTested: hook,
        passed: false,
        details: `Hook threw exception: ${error instanceof Error ? error.message : String(error)}`,
        responseTime: elapsed,
      };
    }
  }

  // Without plugin loader, just verify the entry exists
  entry.lastTested = Date.now();
  entry.lastTestResult = 'pass';

  return {
    pluginId: entry.id,
    name: entry.name,
    hookTested: hook,
    passed: true,
    details: 'Plugin entry verified (plugin system not available for full hook test)',
    responseTime: Date.now() - start,
  };
}

// ── list_plugins ───────────────────────────────────────────

export interface ListPluginsResult {
  plugins: Array<{
    id: string;
    name: string;
    version: string;
    status: string;
    hooks: string[];
    installedAt: string;
    lastTested?: string;
    lastTestResult?: string;
  }>;
  total: number;
  active: number;
}

export function listPlugins(): ListPluginsResult {
  const plugins = Array.from(pluginRegistry.values()).map((p) => ({
    id: p.id,
    name: p.name,
    version: p.version,
    status: p.status,
    hooks: p.hooks,
    installedAt: new Date(p.installedAt).toISOString(),
    lastTested: p.lastTested ? new Date(p.lastTested).toISOString() : undefined,
    lastTestResult: p.lastTestResult,
  }));

  return {
    plugins,
    total: plugins.length,
    active: plugins.filter((p) => p.status === 'active').length,
  };
}

// ── Internal Registry ──────────────────────────────────────

const pluginRegistry = new Map<string, PluginEntry>();

function findPlugin(pluginId?: string, name?: string): PluginEntry | undefined {
  if (pluginId) return pluginRegistry.get(pluginId);
  if (name) {
    for (const entry of pluginRegistry.values()) {
      if (entry.name === name) return entry;
    }
  }
  return undefined;
}

function getBuiltinPluginCode(name: string): string {
  const builtins: Record<string, string> = {
    'hello-world': `
      module.exports = {
        onLoad: function(ctx) { ctx.log('Hello from builtin plugin!'); },
        onUnload: function(ctx) { ctx.log('Goodbye!'); }
      };
    `,
    'noop': `
      module.exports = {};
    `,
  };
  return builtins[name] || 'module.exports = {};';
}
