/**
 * Plugin Bay Room Tests
 *
 * Verifies the Plugin Bay room contract — Integration Floor.
 * Plugin lifecycle management: installation, configuration, testing, removal.
 * Destructive operation warnings, escalation on failures.
 */

import { describe, it, expect } from 'vitest';
import { EventEmitter } from 'eventemitter3';
import type { Bus } from '../../../src/core/bus.js';
import { ok, err } from '../../../src/core/contracts.js';
import { PluginBayRoom } from '../../../src/rooms/room-types/plugin-bay.js';

function createMockBus(): Bus & { _emissions: Array<{ event: string; data: unknown }> } {
  const ee = new EventEmitter();
  const emissions: Array<{ event: string; data: unknown }> = [];
  return {
    emit: (event: string | symbol, data?: Record<string, unknown>) => {
      emissions.push({ event: event as string, data });
      ee.emit(event, data);
      return true;
    },
    on: ee.on.bind(ee),
    onNamespace: () => {},
    _emissions: emissions,
  } as unknown as Bus & { _emissions: typeof emissions };
}

describe('PluginBayRoom', () => {
  describe('contract', () => {
    const contract = PluginBayRoom.contract;

    it('has correct room type and floor', () => {
      expect(contract.roomType).toBe('plugin-bay');
      expect(contract.floor).toBe('integration');
    });

    it('has 3 tables: management, testing, configuration', () => {
      expect(Object.keys(contract.tables)).toHaveLength(3);
      expect(contract.tables.management).toBeDefined();
      expect(contract.tables.management.chairs).toBe(2);
      expect(contract.tables.testing).toBeDefined();
      expect(contract.tables.testing.chairs).toBe(4);
      expect(contract.tables.configuration).toBeDefined();
      expect(contract.tables.configuration.chairs).toBe(2);
    });

    it('has assigned file scope', () => {
      expect(contract.fileScope).toBe('assigned');
    });

    it('provides 5 plugin lifecycle tools', () => {
      expect(contract.tools).toHaveLength(5);
      expect(contract.tools).toContain('install_plugin');
      expect(contract.tools).toContain('uninstall_plugin');
      expect(contract.tools).toContain('configure_plugin');
      expect(contract.tools).toContain('test_plugin');
      expect(contract.tools).toContain('list_plugins');
    });

    it('requires plugin-inventory exit template with 4 fields', () => {
      expect(contract.exitRequired.type).toBe('plugin-inventory');
      expect(contract.exitRequired.fields).toHaveLength(4);
      expect(contract.exitRequired.fields).toEqual([
        'installedPlugins',
        'configuredPlugins',
        'testResults',
        'removedPlugins',
      ]);
    });

    it('escalates to war-room on error and discovery on scope change', () => {
      expect(contract.escalation.onError).toBe('war-room');
      expect(contract.escalation.onScopeChange).toBe('discovery');
    });

    it('has configurable provider', () => {
      expect(contract.provider).toBe('configurable');
    });
  });

  describe('instance behavior', () => {
    it('creates instance with correct type', () => {
      const room = new PluginBayRoom('room_1');
      expect(room.type).toBe('plugin-bay');
    });

    it('getAllowedTools returns 5 tools', () => {
      const room = new PluginBayRoom('room_1');
      expect(room.getAllowedTools()).toHaveLength(5);
    });

    it('getRules mentions Plugin Bay and lifecycle', () => {
      const room = new PluginBayRoom('room_1');
      const rules = room.getRules();
      expect(rules.some((r) => r.includes('Plugin Bay'))).toBe(true);
      expect(rules.some((r) => r.includes('plugin'))).toBe(true);
    });

    it('getOutputFormat returns plugin inventory shape', () => {
      const room = new PluginBayRoom('room_1');
      const format = room.getOutputFormat() as Record<string, unknown>;
      expect(format).toHaveProperty('installedPlugins');
      expect(format).toHaveProperty('configuredPlugins');
      expect(format).toHaveProperty('testResults');
      expect(format).toHaveProperty('removedPlugins');
    });
  });

  describe('exit document validation', () => {
    it('accepts complete plugin inventory', () => {
      const room = new PluginBayRoom('room_1');
      const result = room.validateExitDocument({
        installedPlugins: [{ name: 'auth-plugin', version: '1.0.0', status: 'active' }],
        configuredPlugins: [{ name: 'auth-plugin', settings: { timeout: 30 } }],
        testResults: [{ plugin: 'auth-plugin', passed: true, details: 'All hooks verified' }],
        removedPlugins: [],
      });
      expect(result.ok).toBe(true);
    });

    it('accepts removal-only inventory', () => {
      const room = new PluginBayRoom('room_1');
      const result = room.validateExitDocument({
        installedPlugins: [],
        configuredPlugins: [],
        testResults: [],
        removedPlugins: [{ name: 'old-plugin', reason: 'Deprecated' }],
      });
      expect(result.ok).toBe(true);
    });

    it('rejects all-empty arrays (no actions performed)', () => {
      const room = new PluginBayRoom('room_1');
      const result = room.validateExitDocument({
        installedPlugins: [],
        configuredPlugins: [],
        testResults: [],
        removedPlugins: [],
      });
      expect(result.ok).toBe(false);
      expect(result.error.message).toContain('At least one plugin action');
    });

    it('rejects non-array installedPlugins', () => {
      const room = new PluginBayRoom('room_1');
      const result = room.validateExitDocument({
        installedPlugins: 'not an array',
        configuredPlugins: [],
        testResults: [],
        removedPlugins: [],
      });
      expect(result.ok).toBe(false);
      expect(result.error.message).toContain('installedPlugins');
    });

    it('rejects non-array configuredPlugins', () => {
      const room = new PluginBayRoom('room_1');
      const result = room.validateExitDocument({
        installedPlugins: [{ name: 'a' }],
        configuredPlugins: 'not an array',
        testResults: [],
        removedPlugins: [],
      });
      expect(result.ok).toBe(false);
      expect(result.error.message).toContain('configuredPlugins');
    });

    it('rejects non-array testResults', () => {
      const room = new PluginBayRoom('room_1');
      const result = room.validateExitDocument({
        installedPlugins: [{ name: 'a' }],
        configuredPlugins: [],
        testResults: 'not an array',
        removedPlugins: [],
      });
      expect(result.ok).toBe(false);
      expect(result.error.message).toContain('testResults');
    });

    it('rejects non-array removedPlugins', () => {
      const room = new PluginBayRoom('room_1');
      const result = room.validateExitDocument({
        installedPlugins: [{ name: 'a' }],
        configuredPlugins: [],
        testResults: [],
        removedPlugins: 'not an array',
      });
      expect(result.ok).toBe(false);
      expect(result.error.message).toContain('removedPlugins');
    });

    it('rejects document missing required fields (base validation)', () => {
      const room = new PluginBayRoom('room_1');
      const result = room.validateExitDocument({
        installedPlugins: [{ name: 'a' }],
      });
      expect(result.ok).toBe(false);
      expect(result.error.code).toBe('EXIT_DOC_INCOMPLETE');
    });
  });

  describe('onBeforeToolCall — destructive operation warning', () => {
    it('emits warning on uninstall_plugin', () => {
      const bus = createMockBus();
      const room = new PluginBayRoom('room_1');
      room.setBus(bus);

      room.onBeforeToolCall('uninstall_plugin', 'agent_1', { name: 'auth-plugin' });

      const warning = bus._emissions.find((e) => e.event === 'room:warning');
      expect(warning).toBeDefined();
      expect((warning!.data as Record<string, unknown>).warning).toContain('Destructive operation');
      expect((warning!.data as Record<string, unknown>).warning).toContain('auth-plugin');
    });

    it('uses plugin input name in warning', () => {
      const bus = createMockBus();
      const room = new PluginBayRoom('room_1');
      room.setBus(bus);

      room.onBeforeToolCall('uninstall_plugin', 'agent_1', { plugin: 'legacy-module' });

      const warning = bus._emissions.find((e) => e.event === 'room:warning');
      expect(warning).toBeDefined();
      expect((warning!.data as Record<string, unknown>).warning).toContain('legacy-module');
    });

    it('does not emit warning for non-destructive tools', () => {
      const bus = createMockBus();
      const room = new PluginBayRoom('room_1');
      room.setBus(bus);

      room.onBeforeToolCall('install_plugin', 'agent_1', { name: 'new-plugin' });

      const warning = bus._emissions.find((e) => e.event === 'room:warning');
      expect(warning).toBeUndefined();
    });

    it('always returns ok (does not block)', () => {
      const room = new PluginBayRoom('room_1');
      const result = room.onBeforeToolCall('uninstall_plugin', 'agent_1', { name: 'x' });
      expect(result.ok).toBe(true);
    });
  });

  describe('onAfterToolCall — escalation suggestions', () => {
    it('emits escalation on install_plugin failure', () => {
      const bus = createMockBus();
      const room = new PluginBayRoom('room_1');
      room.setBus(bus);

      room.onAfterToolCall('install_plugin', 'agent_1', err('INSTALL_FAILED', 'Manifest parse error'));

      const esc = bus._emissions.find((e) => e.event === 'room:escalation:suggested');
      expect(esc).toBeDefined();
      expect((esc!.data as Record<string, unknown>).condition).toBe('onError');
      expect((esc!.data as Record<string, unknown>).targetRoom).toBe('war-room');
      expect((esc!.data as Record<string, unknown>).reason).toContain('Plugin installation failed');
    });

    it('emits escalation on test_plugin failure', () => {
      const bus = createMockBus();
      const room = new PluginBayRoom('room_1');
      room.setBus(bus);

      room.onAfterToolCall('test_plugin', 'agent_1', err('TEST_FAILED', 'Hook threw exception'));

      const esc = bus._emissions.find((e) => e.event === 'room:escalation:suggested');
      expect(esc).toBeDefined();
      expect((esc!.data as Record<string, unknown>).reason).toContain('Plugin test failed');
    });

    it('does not emit escalation on successful install_plugin', () => {
      const bus = createMockBus();
      const room = new PluginBayRoom('room_1');
      room.setBus(bus);

      room.onAfterToolCall('install_plugin', 'agent_1', ok({ pluginId: 'p1' }));

      const esc = bus._emissions.find((e) => e.event === 'room:escalation:suggested');
      expect(esc).toBeUndefined();
    });

    it('does not emit escalation for other tool failures', () => {
      const bus = createMockBus();
      const room = new PluginBayRoom('room_1');
      room.setBus(bus);

      room.onAfterToolCall('configure_plugin', 'agent_1', err('CONFIG_FAILED', 'Invalid key'));

      const esc = bus._emissions.find((e) => e.event === 'room:escalation:suggested');
      expect(esc).toBeUndefined();
    });
  });
});
