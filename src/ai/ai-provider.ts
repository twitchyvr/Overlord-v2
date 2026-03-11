/**
 * AI Provider — Provider-Agnostic Adapter Layer
 *
 * Internal format = Anthropic-native. Adapters translate at the boundary.
 * Swap provider = swap one adapter file. All quirks contained in the adapter.
 * Different models for different rooms.
 */

import { logger } from '../core/logger.js';
import { ok, err } from '../core/contracts.js';
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

// ─── Adapter Factories ───

function createAnthropicAdapter(cfg: Config): AIAdapter {
  return {
    name: 'anthropic',
    async sendMessage(messages, tools, options) {
      log.debug({ model: cfg.get('ANTHROPIC_MODEL') }, 'Anthropic request');
      return { provider: 'anthropic', status: 'stub' };
    },
    validateConfig: () => !!cfg.get('ANTHROPIC_API_KEY'),
  };
}

function createMinimaxAdapter(cfg: Config): AIAdapter {
  return {
    name: 'minimax',
    async sendMessage(messages, tools, options) {
      log.debug({ model: cfg.get('MINIMAX_MODEL') }, 'MiniMax request');
      return { provider: 'minimax', status: 'stub' };
    },
    validateConfig: () => !!cfg.get('MINIMAX_API_KEY'),
  };
}

function createOpenAIAdapter(cfg: Config): AIAdapter {
  return {
    name: 'openai',
    async sendMessage(messages, tools, options) {
      log.debug({ model: cfg.get('OPENAI_MODEL') }, 'OpenAI request');
      return { provider: 'openai', status: 'stub' };
    },
    validateConfig: () => !!cfg.get('OPENAI_API_KEY'),
  };
}

function createOllamaAdapter(cfg: Config): AIAdapter {
  return {
    name: 'ollama',
    async sendMessage(messages, tools, options) {
      log.debug({ model: cfg.get('OLLAMA_MODEL'), url: cfg.get('OLLAMA_BASE_URL') }, 'Ollama request');
      return { provider: 'ollama', status: 'stub' };
    },
    validateConfig: () => true,
  };
}
