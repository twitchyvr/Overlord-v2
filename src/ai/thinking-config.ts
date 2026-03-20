/**
 * Thinking Config — Unified Thinking Abstraction
 *
 * Provides a single interface for configuring "thinking" / "reasoning" mode
 * across different AI providers. Each provider has its own API shape for
 * extended thinking; this module normalizes the configuration.
 *
 * - Anthropic: extended thinking with `thinking` parameter
 * - MiniMax: `thinking: { type: 'enabled', budget_tokens }` in request
 * - Other providers: no thinking support (graceful no-op)
 *
 * @see Issue #364
 */

import { logger } from '../core/logger.js';

const log = logger.child({ module: 'thinking-config' });

export interface ThinkingConfig {
  enabled: boolean;
  budget?: number;
  model?: string;
}

/** Default thinking budgets per provider */
const PROVIDER_DEFAULTS: Record<string, ThinkingConfig> = {
  anthropic: {
    enabled: true,
    budget: 10000,
    model: 'claude-sonnet-4-20250514',
  },
  minimax: {
    enabled: true,
    budget: 8192,
    model: 'MiniMax-M2.7',
  },
};

/**
 * Get the thinking configuration for a given provider.
 * Returns a config with `enabled: false` for unsupported providers.
 */
export function getThinkingConfig(provider: string): ThinkingConfig {
  const config = PROVIDER_DEFAULTS[provider];
  if (config) {
    log.debug({ provider, enabled: config.enabled, budget: config.budget }, 'Thinking config resolved');
    return { ...config };
  }

  log.debug({ provider }, 'Thinking not supported for provider');
  return { enabled: false };
}

/**
 * Apply thinking configuration to a request options object.
 * Mutates the options in-place and returns them for chaining.
 *
 * Each provider has a different API shape:
 * - Anthropic: adds `thinking: { type: "enabled", budget_tokens: N }`
 * - MiniMax: adds `thinking: { type: "enabled", budget_tokens: N }`
 *   (MiniMax uses Anthropic-compatible API, same shape)
 * - Others: no-op
 */
export function applyThinkingToRequest(
  provider: string,
  options: Record<string, unknown>,
): Record<string, unknown> {
  const config = getThinkingConfig(provider);

  if (!config.enabled) {
    return options;
  }

  switch (provider) {
    case 'anthropic': {
      // Anthropic extended thinking
      options.thinking = {
        type: 'enabled',
        budget_tokens: config.budget || 10000,
      };
      log.debug({ provider, budget: config.budget }, 'Applied Anthropic thinking config');
      break;
    }

    case 'minimax': {
      // MiniMax uses Anthropic-compatible thinking format
      options.thinking = {
        type: 'enabled',
        budget_tokens: config.budget || 8192,
      };
      log.debug({ provider, budget: config.budget }, 'Applied MiniMax thinking config');
      break;
    }

    default:
      // No thinking support — no-op
      break;
  }

  return options;
}
