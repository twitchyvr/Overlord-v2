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
import { getBuildingExecutionState } from '../core/execution-signal.js';
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

  // ── Execution guard (#968, #969) ──
  // Block AI API calls for buildings that are paused or stopped.
  // This is the last line of defense — even if the conversation loop has
  // a bug, the AI layer refuses to send requests for non-running buildings.
  const rawBuildingId = params.options?.buildingId;
  const buildingId = typeof rawBuildingId === 'string' ? rawBuildingId : undefined;
  if (buildingId) {
    const execState = getBuildingExecutionState(buildingId);
    if (execState === 'aborted' || execState === 'stopped') {
      log.info({ buildingId, provider: params.provider }, 'AI request blocked: building stopped');
      if (_bus) {
        _bus.emit('api:blocked', { buildingId, provider: params.provider, reason: 'stopped' });
      }
      return err('EXECUTION_BLOCKED', `Building ${buildingId} is stopped — no API calls allowed`, {
        retryable: false,
        context: { buildingId, executionState: execState },
      });
    }
    if (execState === 'paused') {
      log.info({ buildingId, provider: params.provider }, 'AI request blocked: building paused');
      if (_bus) {
        _bus.emit('api:blocked', { buildingId, provider: params.provider, reason: 'paused' });
      }
      return err('EXECUTION_PAUSED', `Building ${buildingId} is paused — no API calls allowed`, {
        retryable: false,
        context: { buildingId, executionState: execState },
      });
    }
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
