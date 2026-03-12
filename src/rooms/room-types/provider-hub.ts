/**
 * Provider Hub Room
 *
 * Integration Floor — Multi-provider AI orchestration, model comparison,
 * and fallback chain configuration. Manages the relationship between
 * the system and its AI providers.
 *
 * Active behavior:
 * - validateExitDocumentValues: rejects empty activeProviders/fallbackChains
 * - onAfterToolCall: detects provider failures and suggests escalation
 */

import { BaseRoom } from './base-room.js';
import { ok, err } from '../../core/contracts.js';
import type { Result, RoomContract } from '../../core/contracts.js';

export class ProviderHubRoom extends BaseRoom {
  static override contract: RoomContract = {
    roomType: 'provider-hub',
    floor: 'integration',
    tables: {
      orchestration: { chairs: 2, description: 'Provider routing and orchestration' },
      comparison: { chairs: 4, description: 'Model comparison and benchmarking' },
      configuration: { chairs: 2, description: 'Provider configuration and credential management' },
    },
    tools: [
      'switch_provider',
      'compare_models',
      'configure_fallback',
      'test_provider',
    ],
    fileScope: 'assigned',
    exitRequired: {
      type: 'provider-configuration-summary',
      fields: [
        'activeProviders',
        'fallbackChains',
        'comparisonResults',
        'configurationChanges',
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
      'You are in the Provider Hub. Manage AI provider orchestration.',
      'Test provider connections before activating them.',
      'Configure fallback chains to ensure system resilience.',
      'Document comparison results with measurable metrics.',
      'If a provider is consistently failing, escalate to War Room.',
      'Your exit document must summarize active providers, fallback chains, comparison results, and configuration changes.',
    ];
  }

  override getOutputFormat(): Record<string, unknown> {
    return {
      activeProviders: [{ name: 'string', model: 'string', status: 'string' }],
      fallbackChains: [{ primary: 'string', fallbacks: ['string'], priority: 'number' }],
      comparisonResults: [{ model: 'string', latency: 'number', quality: 'string', cost: 'string' }],
      configurationChanges: [{ provider: 'string', setting: 'string', oldValue: 'string', newValue: 'string' }],
    };
  }

  /**
   * Value validation for provider configuration summaries.
   * - activeProviders must be a non-empty array
   * - fallbackChains must be an array (can be empty if single-provider)
   * - comparisonResults must be an array
   * - configurationChanges must be an array
   */
  override validateExitDocumentValues(document: Record<string, unknown>): Result {
    const activeProviders = document.activeProviders as unknown[];
    const fallbackChains = document.fallbackChains;
    const comparisonResults = document.comparisonResults;
    const configurationChanges = document.configurationChanges;

    if (!Array.isArray(activeProviders) || activeProviders.length === 0) {
      return err('EXIT_DOC_INVALID', 'activeProviders must be a non-empty array');
    }
    if (!Array.isArray(fallbackChains)) {
      return err('EXIT_DOC_INVALID', 'fallbackChains must be an array');
    }
    if (!Array.isArray(comparisonResults)) {
      return err('EXIT_DOC_INVALID', 'comparisonResults must be an array');
    }
    if (!Array.isArray(configurationChanges)) {
      return err('EXIT_DOC_INVALID', 'configurationChanges must be an array');
    }

    return ok(document);
  }

  /**
   * After tool call: detect provider failures and suggest escalation.
   */
  override onAfterToolCall(toolName: string, agentId: string, result: Result): void {
    if (toolName === 'test_provider' && !result.ok) {
      this.bus?.emit('room:escalation:suggested', {
        roomId: this.id,
        roomType: this.type,
        agentId,
        condition: 'onError',
        targetRoom: this.escalation.onError || 'war-room',
        reason: `Provider test failed: ${result.error.message}`,
      });
    }
    if (toolName === 'switch_provider' && !result.ok) {
      this.bus?.emit('room:escalation:suggested', {
        roomId: this.id,
        roomType: this.type,
        agentId,
        condition: 'onError',
        targetRoom: this.escalation.onError || 'war-room',
        reason: `Provider switch failed: ${result.error.message}`,
      });
    }
  }
}
