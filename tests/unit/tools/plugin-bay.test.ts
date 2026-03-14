/**
 * Plugin Bay Tool Provider Tests
 *
 * Tests install_plugin, uninstall_plugin, configure_plugin, test_plugin, list_plugins.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  installPlugin,
  uninstallPlugin,
  configurePlugin,
  testPlugin,
  listPlugins,
} from '../../../src/tools/providers/plugin-bay.js';

describe('Plugin Bay Tool Provider', () => {
  describe('installPlugin', () => {
    it('installs a plugin and returns metadata', async () => {
      const result = await installPlugin({
        name: 'test-plugin',
        source: 'builtin:noop',
        version: '1.0.0',
      });
      expect(result.name).toBe('test-plugin');
      expect(result.version).toBe('1.0.0');
      expect(result.status).toBe('installed');
      expect(result.pluginId).toMatch(/^plugin-/);
    });

    it('defaults version to 0.0.0', async () => {
      const result = await installPlugin({
        name: 'no-version',
        source: 'builtin:noop',
      });
      expect(result.version).toBe('0.0.0');
    });

    it('installs with plugin loader when available', async () => {
      const mockLoader = {
        loadPlugin: vi.fn().mockResolvedValue({
          ok: true,
          data: { pluginId: 'plugin-loaded', hooks: ['onLoad', 'onUnload'] },
        }),
      };

      const result = await installPlugin(
        { name: 'loaded-plugin', source: 'builtin:hello-world', version: '2.0.0' },
        mockLoader,
      );
      expect(result.pluginId).toBe('plugin-loaded');
      expect(result.hooks).toEqual(['onLoad', 'onUnload']);
      expect(mockLoader.loadPlugin).toHaveBeenCalledOnce();
    });

    it('throws when plugin loader fails', async () => {
      const mockLoader = {
        loadPlugin: vi.fn().mockResolvedValue({
          ok: false,
          error: { message: 'Manifest parse error' },
        }),
      };

      await expect(installPlugin(
        { name: 'bad-plugin', source: 'builtin:noop' },
        mockLoader,
      )).rejects.toThrow('Plugin installation failed');
    });
  });

  describe('uninstallPlugin', () => {
    it('uninstalls an installed plugin by name', async () => {
      await installPlugin({ name: 'to-remove', source: 'builtin:noop' });
      const result = await uninstallPlugin({ name: 'to-remove' });
      expect(result.status).toBe('uninstalled');
      expect(result.name).toBe('to-remove');
    });

    it('uninstalls by pluginId', async () => {
      const installed = await installPlugin({ name: 'by-id', source: 'builtin:noop' });
      const result = await uninstallPlugin({ pluginId: installed.pluginId });
      expect(result.status).toBe('uninstalled');
    });

    it('returns not-found for non-existent plugin', async () => {
      const result = await uninstallPlugin({ name: 'nonexistent-plugin-xyz' });
      expect(result.status).toBe('not-found');
    });

    it('delegates to plugin loader when available', async () => {
      await installPlugin({ name: 'loader-uninstall', source: 'builtin:noop' });
      const mockLoader = {
        unloadPlugin: vi.fn().mockResolvedValue({ ok: true }),
      };

      const result = await uninstallPlugin({ name: 'loader-uninstall' }, mockLoader);
      expect(result.status).toBe('uninstalled');
      expect(mockLoader.unloadPlugin).toHaveBeenCalledOnce();
    });
  });

  describe('configurePlugin', () => {
    it('updates plugin configuration', async () => {
      await installPlugin({ name: 'configurable', source: 'builtin:noop', config: { timeout: 30 } });
      const result = configurePlugin({ name: 'configurable', config: { timeout: 60, retries: 3 } });
      expect(result.name).toBe('configurable');
      expect(result.newConfig).toEqual({ timeout: 60, retries: 3 });
      expect(result.previousConfig).toEqual({ timeout: 30 });
    });

    it('throws for non-existent plugin', () => {
      expect(() => configurePlugin({ name: 'not-here-xyz', config: {} })).toThrow('Plugin not found');
    });

    it('merges config (does not replace)', async () => {
      await installPlugin({ name: 'merge-cfg', source: 'builtin:noop', config: { a: 1, b: 2 } });
      const result = configurePlugin({ name: 'merge-cfg', config: { b: 99, c: 3 } });
      expect(result.newConfig).toEqual({ a: 1, b: 99, c: 3 });
    });
  });

  describe('testPlugin', () => {
    it('passes basic test for registered plugin (no loader)', async () => {
      await installPlugin({ name: 'test-target', source: 'builtin:noop' });
      const result = await testPlugin({ name: 'test-target' });
      expect(result.passed).toBe(true);
      expect(result.name).toBe('test-target');
      expect(result.hookTested).toBe('onLoad');
      expect(result.responseTime).toBeGreaterThanOrEqual(0);
    });

    it('throws for non-existent plugin', async () => {
      await expect(testPlugin({ name: 'nonexistent-test-plugin-xyz' })).rejects.toThrow('Plugin not found');
    });

    it('tests specific hook with loader', async () => {
      await installPlugin({ name: 'hook-test', source: 'builtin:noop' });
      const mockLoader = {
        callHook: vi.fn().mockResolvedValue({ ok: true }),
      };

      const result = await testPlugin({ name: 'hook-test', hook: 'onMessage' }, mockLoader);
      expect(result.passed).toBe(true);
      expect(result.hookTested).toBe('onMessage');
      expect(mockLoader.callHook).toHaveBeenCalledOnce();
    });

    it('reports failure when loader hook fails', async () => {
      await installPlugin({ name: 'fail-hook', source: 'builtin:noop' });
      const mockLoader = {
        callHook: vi.fn().mockResolvedValue({ ok: false, error: { message: 'Hook error' } }),
      };

      const result = await testPlugin({ name: 'fail-hook' }, mockLoader);
      expect(result.passed).toBe(false);
      expect(result.details).toContain('Hook failed');
    });

    it('reports failure when loader hook throws', async () => {
      await installPlugin({ name: 'throw-hook', source: 'builtin:noop' });
      const mockLoader = {
        callHook: vi.fn().mockRejectedValue(new Error('Sandbox crash')),
      };

      const result = await testPlugin({ name: 'throw-hook' }, mockLoader);
      expect(result.passed).toBe(false);
      expect(result.details).toContain('Sandbox crash');
    });
  });

  describe('listPlugins', () => {
    it('returns plugin list with counts', async () => {
      // Install a few plugins first
      await installPlugin({ name: 'list-a', source: 'builtin:noop' });
      await installPlugin({ name: 'list-b', source: 'builtin:noop' });

      const result = listPlugins();
      expect(result.total).toBeGreaterThanOrEqual(2);
      expect(result.active).toBeGreaterThanOrEqual(2);
      expect(result.plugins.some((p) => p.name === 'list-a')).toBe(true);
      expect(result.plugins.some((p) => p.name === 'list-b')).toBe(true);
    });

    it('includes installedAt as ISO string', async () => {
      await installPlugin({ name: 'date-check', source: 'builtin:noop' });
      const result = listPlugins();
      const plugin = result.plugins.find((p) => p.name === 'date-check');
      expect(plugin).toBeDefined();
      expect(plugin!.installedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('includes test results after testing', async () => {
      await installPlugin({ name: 'tested-plugin', source: 'builtin:noop' });
      await testPlugin({ name: 'tested-plugin' });

      const result = listPlugins();
      const plugin = result.plugins.find((p) => p.name === 'tested-plugin');
      expect(plugin).toBeDefined();
      expect(plugin!.lastTestResult).toBe('pass');
      expect(plugin!.lastTested).toBeDefined();
    });
  });
});
