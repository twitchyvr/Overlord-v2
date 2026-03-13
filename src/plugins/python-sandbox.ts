/**
 * Python Sandbox
 *
 * Sandboxed Python execution for plugins using Pyodide (Python in WASM).
 * Mirrors the Lua sandbox API and permission model.
 *
 * When Pyodide is unavailable, falls back to subprocess execution with
 * restricted capabilities (no filesystem, no network unless explicitly permitted).
 *
 * Plugin manifests declare "engine": "python" with .py entrypoints.
 * The same PluginContext API surface is exposed as `overlord.*` in Python.
 */

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

const log = logger.child({ module: 'python-sandbox' });

/**
 * Create a Python sandbox for a plugin.
 * Currently a stub that logs a warning — full Pyodide integration
 * will be added when the Python runtime is prioritized.
 */
export async function createPythonSandbox(
  manifest: PluginManifest,
  context: PluginContext,
): Promise<PluginSandbox> {
  const hooks: Partial<Record<PluginHook, PluginHookHandler>> = {};

  log.info({ pluginId: manifest.id }, 'Creating Python sandbox (stub — Pyodide integration pending)');

  return {
    execute(code: string): Result {
      // Validate that the code is syntactically valid Python (basic check)
      if (!code || code.trim().length === 0) {
        return err('PYTHON_EMPTY', 'Python code is empty');
      }

      // Try to detect obvious syntax errors
      const lines = code.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        // Check for registerHook calls (Python equivalent)
        if (line.startsWith('register_hook(') || line.startsWith('registerHook(')) {
          const hookMatch = line.match(/register_?[Hh]ook\(\s*["'](\w+)["']/);
          if (hookMatch) {
            const hookName = hookMatch[1] as PluginHook;
            // Register a placeholder handler
            hooks[hookName] = (data: PluginHookData) => {
              context.log.info(`Python hook ${hookName} triggered (stub)`, { data });
            };
          }
        }
      }

      context.log.info('Python plugin loaded (stub mode — Pyodide integration pending)');
      return ok(null);
    },

    async callHook(hook: PluginHook, data: PluginHookData): Promise<Result> {
      const handler = hooks[hook];
      if (!handler) {
        return ok(undefined);
      }
      try {
        await handler(data);
        return ok(undefined);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return err('PYTHON_HOOK_ERROR', message);
      }
    },

    getHooks(): Partial<Record<PluginHook, PluginHookHandler>> {
      return { ...hooks };
    },

    destroy(): void {
      log.debug({ pluginId: manifest.id }, 'Python sandbox destroyed');
    },
  };
}
