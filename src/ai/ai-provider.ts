/**
 * AI Provider — Provider-Agnostic Adapter Layer
 *
 * Internal format = Anthropic-native. Adapters translate at the boundary.
 * Swap provider = swap one adapter file. All quirks contained in the adapter.
 * Different models for different rooms.
 */

import { logger } from '../core/logger.js';
import { ok, err } from '../core/contracts.js';
import { createAnthropicAdapter } from './adapters/anthropic.js';
import { createOpenAIAdapter } from './adapters/openai.js';
import { createMinimaxAdapter } from './adapters/minimax.js';
import { createOllamaAdapter } from './adapters/ollama.js';
import type { Result, AIAdapter, AIProviderAPI, ToolDefinition, Config } from '../core/contracts.js';

const log = logger.child({ module: 'ai-provider' });

const adapters = new Map<string, AIAdapter>();

export function initAI(cfg: Config): AIProviderAPI {
  registerAdapter('anthropic', createAnthropicAdapter(cfg));
  registerAdapter('minimax', createMinimaxAdapter(cfg));
  registerAdapter('openai', createOpenAIAdapter(cfg));
  registerAdapter('ollama', createOllamaAdapter(cfg));

  log.info({ adapters: [...adapters.keys()] }, 'AI provider layer initialized');
  return { getAdapter, sendMessage, registerAdapter };
}

export function registerAdapter(name: string, adapter: AIAdapter): void {
  adapters.set(name, adapter);
}

export function getAdapter(name: string): AIAdapter | null {
  return adapters.get(name) || null;
}

export async function sendMessage(params: {
  provider: string;
  messages: unknown[];
  tools?: ToolDefinition[];
  options?: Record<string, unknown>;
}): Promise<Result> {
  const adapter = adapters.get(params.provider);
  if (!adapter) {
    return err('UNKNOWN_PROVIDER', `AI provider "${params.provider}" is not registered`);
  }

  try {
    const response = await adapter.sendMessage(
      params.messages,
      params.tools || [],
      params.options || {},
    );
    return ok(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return err('AI_ERROR', message, { retryable: true, context: { provider: params.provider } });
  }
}
