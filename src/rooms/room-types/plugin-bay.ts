/**
 * Plugin Bay Room
 *
 * Integration Floor — Plugin lifecycle management.
 * Installation, configuration, testing, and removal of plugins
 * that extend Overlord's capabilities.
 *
 * Active behavior:
 * - validateExitDocumentValues: rejects empty installedPlugins
 * - onAfterToolCall: detects plugin installation/test failures and suggests escalation
 * - onBeforeToolCall: warns on uninstall operations (destructive)
 */

import { BaseRoom } from './base-room.js';
import { ok, err } from '../../core/contracts.js';
import type { Result, RoomContract } from '../../core/contracts.js';

export class PluginBayRoom extends BaseRoom {
  static override contract: RoomContract = {
    roomType: 'plugin-bay',
    floor: 'integration',
    tables: {
      management: { chairs: 2, description: 'Plugin installation and removal' },
      testing: { chairs: 4, description: 'Plugin testing and validation' },
      configuration: { chairs: 2, description: 'Plugin configuration and settings' },
    },
    tools: [
      'install_plugin',
      'uninstall_plugin',
      'configure_plugin',
      'test_plugin',
      'list_plugins',
    ],
    fileScope: 'assigned',
    exitRequired: {
      type: 'plugin-inventory',
      fields: [
        'installedPlugins',
        'configuredPlugins',
        'testResults',
        'removedPlugins',
      ],
    },
    escalation: {
      onError: 'war-room',
      onScopeChange: 'discovery',
    },
    provider: 'configurable',
  };

  override getRules(): string[] {
    return [
      'You are in the Plugin Bay. Manage plugin lifecycle.',
      'Test every plugin after installation before marking it configured.',
      'Document configuration changes for each plugin.',
      'Verify plugin compatibility before installation.',
      'If a plugin causes system instability, escalate to War Room.',
      'Your exit document must inventory all installed, configured, tested, and removed plugins.',
    ];
  }

  override getOutputFormat(): Record<string, unknown> {
    return {
      installedPlugins: [{ name: 'string', version: 'string', status: 'string' }],
      configuredPlugins: [{ name: 'string', settings: 'object' }],
      testResults: [{ plugin: 'string', passed: 'boolean', details: 'string' }],
      removedPlugins: [{ name: 'string', reason: 'string' }],
    };
  }

  /**
   * Value validation for plugin inventory.
   * - installedPlugins must be an array (can be empty if only removals)
   * - configuredPlugins must be an array
   * - testResults must be an array
   * - removedPlugins must be an array
   */
  override validateExitDocumentValues(document: Record<string, unknown>): Result {
    const installedPlugins = document.installedPlugins;
    const configuredPlugins = document.configuredPlugins;
    const testResults = document.testResults;
    const removedPlugins = document.removedPlugins;

    if (!Array.isArray(installedPlugins)) {
      return err('EXIT_DOC_INVALID', 'installedPlugins must be an array');
    }
    if (!Array.isArray(configuredPlugins)) {
      return err('EXIT_DOC_INVALID', 'configuredPlugins must be an array');
    }
    if (!Array.isArray(testResults)) {
      return err('EXIT_DOC_INVALID', 'testResults must be an array');
    }
    if (!Array.isArray(removedPlugins)) {
      return err('EXIT_DOC_INVALID', 'removedPlugins must be an array');
    }

    // At least one action must have been performed
    const totalActions = installedPlugins.length + configuredPlugins.length + testResults.length + removedPlugins.length;
    if (totalActions === 0) {
      return err('EXIT_DOC_INVALID', 'At least one plugin action (install, configure, test, or remove) must be documented');
    }

    return ok(document);
  }

  /**
   * Before tool call: emit warning on destructive uninstall operations.
   * Does not block — but notifies observers so the UI can warn the user.
   */
  override onBeforeToolCall(toolName: string, agentId: string, input: Record<string, unknown>): Result {
    if (toolName === 'uninstall_plugin') {
      const pluginName = (input.name || input.plugin || 'unknown') as string;
      this.bus?.emit('room:warning', {
        roomId: this.id,
        roomType: this.type,
        agentId,
        warning: `Destructive operation: uninstalling plugin "${pluginName}". This action may affect system stability.`,
      });
    }
    return ok(null);
  }

  /**
   * After tool call: detect plugin failures and suggest escalation.
   */
  override onAfterToolCall(toolName: string, agentId: string, result: Result): void {
    if (toolName === 'install_plugin' && !result.ok) {
      this.bus?.emit('room:escalation:suggested', {
        roomId: this.id,
        roomType: this.type,
        agentId,
        condition: 'onError',
        targetRoom: this.escalation.onError || 'war-room',
        reason: `Plugin installation failed: ${result.error.message}`,
      });
    }
    if (toolName === 'test_plugin' && !result.ok) {
      this.bus?.emit('room:escalation:suggested', {
        roomId: this.id,
        roomType: this.type,
        agentId,
        condition: 'onError',
        targetRoom: this.escalation.onError || 'war-room',
        reason: `Plugin test failed: ${result.error.message}`,
      });
    }
  }
}
