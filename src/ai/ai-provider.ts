/**
 * AI Provider — Provider-Agnostic Adapter Layer
 *
 * Internal format = Anthropic-native. Adapters translate at the boundary.
 * Swap provider = swap one adapter file. All quirks contained in the adapter.
 * Different models for different rooms.
 */

import { logger } from '../core/logger.js';
import { ok, err } from '../core/contracts.js';

const log = logger.child({ module: 'ai-provider' });

/** @type {Map<string, AIAdapter>} */
const adapters = new Map();

/**
 * @typedef {object} AIAdapter
 * @property {string} name
 * @property {Function} sendMessage - (messages, tools, options) => AsyncGenerator<chunk>
 * @property {Function} validateConfig - (config) => boolean
 */

export function initAI(config) {
  // Register built-in adapters
  registerAdapter('anthropic', createAnthropicAdapter(config));
  registerAdapter('minimax', createMinimaxAdapter(config));
  registerAdapter('openai', createOpenAIAdapter(config));
  registerAdapter('ollama', createOllamaAdapter(config));

  log.info({ adapters: [...adapters.keys()] }, 'AI provider layer initialized');
  return { getAdapter, sendMessage, registerAdapter };
}

/**
 * Register an AI provider adapter
 */
export function registerAdapter(name, adapter) {
  adapters.set(name, adapter);
}

/**
 * Get adapter by name
 */
export function getAdapter(name) {
  return adapters.get(name) || null;
}

/**
 * Send a message through the appropriate provider
 * Provider is determined by room configuration
 */
export async function sendMessage({ provider, messages, tools = [], options = {} }) {
  const adapter = adapters.get(provider);
  if (!adapter) {
    return err('UNKNOWN_PROVIDER', `AI provider "${provider}" is not registered`);
  }

  try {
    const response = await adapter.sendMessage(messages, tools, options);
    return ok(response);
  } catch (error) {
    return err('AI_ERROR', error.message, { retryable: true, context: { provider } });
  }
}

// ─── Adapter Factories ───

function createAnthropicAdapter(config) {
  return {
    name: 'anthropic',
    async sendMessage(messages, tools, options) {
      // Anthropic adapter — native format, no translation needed
      // Implementation will use @anthropic-ai/sdk
      log.debug({ model: config.get('ANTHROPIC_MODEL') }, 'Anthropic request');
      return { provider: 'anthropic', status: 'stub' };
    },
    validateConfig: () => !!config.get('ANTHROPIC_API_KEY'),
  };
}

function createMinimaxAdapter(config) {
  return {
    name: 'minimax',
    async sendMessage(messages, tools, options) {
      // MiniMax adapter — translates from Anthropic format
      // Contains ALL MiniMax-specific quirks (emoji stripping, unicode repair, etc.)
      log.debug({ model: config.get('MINIMAX_MODEL') }, 'MiniMax request');
      return { provider: 'minimax', status: 'stub' };
    },
    validateConfig: () => !!config.get('MINIMAX_API_KEY'),
  };
}

function createOpenAIAdapter(config) {
  return {
    name: 'openai',
    async sendMessage(messages, tools, options) {
      log.debug({ model: config.get('OPENAI_MODEL') }, 'OpenAI request');
      return { provider: 'openai', status: 'stub' };
    },
    validateConfig: () => !!config.get('OPENAI_API_KEY'),
  };
}

function createOllamaAdapter(config) {
  return {
    name: 'ollama',
    async sendMessage(messages, tools, options) {
      log.debug({ model: config.get('OLLAMA_MODEL'), url: config.get('OLLAMA_BASE_URL') }, 'Ollama request');
      return { provider: 'ollama', status: 'stub' };
    },
    validateConfig: () => true, // Local, always available
  };
}
