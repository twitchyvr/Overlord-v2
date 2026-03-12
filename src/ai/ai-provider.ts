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
import type { Bus } from '../core/bus.js';

const log = logger.child({ module: 'ai-provider' });

const adapters = new Map<string, AIAdapter>();
let _bus: Bus | null = null;

/**
 * Detect whether an error is a timeout from any of the supported SDKs.
 * Anthropic SDK: APIConnectionTimeoutError (name or message contains 'timeout')
 * OpenAI SDK: APIConnectionTimeoutError (same pattern)
 * Fetch (Ollama): AbortError
 */
function isTimeoutError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const name = error.name.toLowerCase();
  const msg = error.message.toLowerCase();
  return name.includes('timeout') || msg.includes('timed out') || msg.includes('timeout')
    || name === 'aborterror';
}

export function initAI(cfg: Config, bus?: Bus): AIProviderAPI {
  _bus = bus || null;

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

    if (isTimeoutError(error)) {
      log.warn({ provider: params.provider }, 'AI request timed out');
      if (_bus) {
        _bus.emit('ai:timeout', { provider: params.provider });
      }
      return err('AI_TIMEOUT', `AI provider "${params.provider}" request timed out`, {
        retryable: true,
        context: { provider: params.provider, timeout: true },
      });
    }

    return err('AI_ERROR', message, { retryable: true, context: { provider: params.provider } });
  }
}
