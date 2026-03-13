/**
 * Provider Hub Tools
 *
 * Tools for the Provider Hub room on the Integration Floor.
 * Manages AI provider orchestration, comparison, and fallback configuration.
 *
 * Tools:
 *   switch_provider     — Change the active AI provider for a room type
 *   compare_models      — Run a prompt against multiple providers and compare
 *   configure_fallback  — Set up fallback chains for provider resilience
 *   test_provider       — Test connectivity and response from a provider
 */

import { logger } from '../../core/logger.js';

const log = logger.child({ module: 'tool:provider-hub' });

// In-memory fallback chain store (persists for server lifetime)
const fallbackChains = new Map<string, FallbackChain>();

// ── switch_provider ────────────────────────────────────────

export interface SwitchProviderParams {
  roomType: string;
  provider: string;
}

export interface SwitchProviderResult {
  roomType: string;
  previousProvider: string;
  newProvider: string;
  status: 'switched' | 'already-active';
}

const VALID_PROVIDERS = ['anthropic', 'minimax', 'openai', 'ollama'];

// Room → provider override map (in-memory, server lifetime)
const providerOverrides = new Map<string, string>();

export function switchProvider(params: SwitchProviderParams): SwitchProviderResult {
  const { roomType, provider } = params;

  if (!VALID_PROVIDERS.includes(provider)) {
    throw new Error(`Invalid provider "${provider}". Valid: ${VALID_PROVIDERS.join(', ')}`);
  }

  const previous = providerOverrides.get(roomType) || getDefaultProviderForRoom(roomType);

  if (previous === provider) {
    return { roomType, previousProvider: previous, newProvider: provider, status: 'already-active' };
  }

  providerOverrides.set(roomType, provider);
  log.info({ roomType, previous, provider }, 'Provider switched');

  return { roomType, previousProvider: previous, newProvider: provider, status: 'switched' };
}

// ── compare_models ─────────────────────────────────────────

export interface CompareModelsParams {
  prompt: string;
  providers: string[];
  maxTokens?: number;
}

export interface ModelComparison {
  provider: string;
  model: string;
  responseTime: number;
  outputLength: number;
  output: string;
  error?: string;
}

export interface CompareModelsResult {
  prompt: string;
  comparisons: ModelComparison[];
  fastest: string;
  longestOutput: string;
}

export async function compareModels(
  params: CompareModelsParams,
  aiProvider?: { chat: (provider: string, messages: Array<{ role: string; content: string }>, options?: Record<string, unknown>) => Promise<{ ok: boolean; data?: { content: Array<{ type: string; text?: string }> }; error?: { message: string } }> },
): Promise<CompareModelsResult> {
  const { prompt, providers, maxTokens = 200 } = params;

  const comparisons: ModelComparison[] = [];

  for (const provider of providers) {
    if (!VALID_PROVIDERS.includes(provider)) {
      comparisons.push({
        provider,
        model: 'unknown',
        responseTime: 0,
        outputLength: 0,
        output: '',
        error: `Invalid provider: ${provider}`,
      });
      continue;
    }

    const model = getModelForProvider(provider);
    const start = Date.now();

    try {
      if (!aiProvider) {
        throw new Error('AI provider not available in tool context');
      }

      const result = await aiProvider.chat(provider, [{ role: 'user', content: prompt }], { max_tokens: maxTokens });

      const elapsed = Date.now() - start;
      if (result.ok && result.data) {
        const text = result.data.content
          .filter((b) => b.type === 'text' && b.text)
          .map((b) => b.text!)
          .join('');
        comparisons.push({
          provider,
          model,
          responseTime: elapsed,
          outputLength: text.length,
          output: text.slice(0, 500),
        });
      } else {
        comparisons.push({
          provider,
          model,
          responseTime: elapsed,
          outputLength: 0,
          output: '',
          error: result.error?.message || 'Unknown error',
        });
      }
    } catch (error) {
      comparisons.push({
        provider,
        model,
        responseTime: Date.now() - start,
        outputLength: 0,
        output: '',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const successful = comparisons.filter((c) => !c.error);
  const fastest = successful.length > 0
    ? successful.reduce((a, b) => (a.responseTime < b.responseTime ? a : b)).provider
    : 'none';
  const longestOutput = successful.length > 0
    ? successful.reduce((a, b) => (a.outputLength > b.outputLength ? a : b)).provider
    : 'none';

  return { prompt, comparisons, fastest, longestOutput };
}

// ── configure_fallback ─────────────────────────────────────

export interface FallbackChain {
  primary: string;
  fallbacks: string[];
  priority: number;
}

export interface ConfigureFallbackParams {
  roomType: string;
  primary: string;
  fallbacks: string[];
  priority?: number;
}

export interface ConfigureFallbackResult {
  roomType: string;
  chain: FallbackChain;
  status: 'created' | 'updated';
}

export function configureFallback(params: ConfigureFallbackParams): ConfigureFallbackResult {
  const { roomType, primary, fallbacks, priority = 1 } = params;

  if (!VALID_PROVIDERS.includes(primary)) {
    throw new Error(`Invalid primary provider "${primary}"`);
  }
  for (const fb of fallbacks) {
    if (!VALID_PROVIDERS.includes(fb)) {
      throw new Error(`Invalid fallback provider "${fb}"`);
    }
  }
  if (fallbacks.includes(primary)) {
    throw new Error(`Primary provider "${primary}" cannot be in its own fallback list`);
  }

  const existing = fallbackChains.has(roomType);
  const chain: FallbackChain = { primary, fallbacks, priority };
  fallbackChains.set(roomType, chain);

  log.info({ roomType, chain }, existing ? 'Fallback chain updated' : 'Fallback chain created');

  return {
    roomType,
    chain,
    status: existing ? 'updated' : 'created',
  };
}

// ── test_provider ──────────────────────────────────────────

export interface TestProviderParams {
  provider: string;
}

export interface TestProviderResult {
  provider: string;
  model: string;
  configured: boolean;
  reachable: boolean;
  responseTime: number;
  error?: string;
}

export async function testProvider(
  params: TestProviderParams,
  aiProvider?: { chat: (provider: string, messages: Array<{ role: string; content: string }>, options?: Record<string, unknown>) => Promise<{ ok: boolean; data?: unknown; error?: { message: string } }> },
): Promise<TestProviderResult> {
  const { provider } = params;

  if (!VALID_PROVIDERS.includes(provider)) {
    throw new Error(`Invalid provider "${provider}". Valid: ${VALID_PROVIDERS.join(', ')}`);
  }

  const model = getModelForProvider(provider);
  const configured = isProviderConfigured(provider);

  if (!configured) {
    return {
      provider,
      model,
      configured: false,
      reachable: false,
      responseTime: 0,
      error: `Provider "${provider}" is not configured (missing API key or base URL)`,
    };
  }

  const start = Date.now();
  try {
    if (!aiProvider) {
      throw new Error('AI provider not available in tool context');
    }

    const result = await aiProvider.chat(provider, [{ role: 'user', content: 'Say "OK" and nothing else.' }], { max_tokens: 10 });
    const elapsed = Date.now() - start;

    return {
      provider,
      model,
      configured: true,
      reachable: result.ok,
      responseTime: elapsed,
      error: result.ok ? undefined : result.error?.message,
    };
  } catch (error) {
    return {
      provider,
      model,
      configured: true,
      reachable: false,
      responseTime: Date.now() - start,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// ── Helpers ────────────────────────────────────────────────

function getDefaultProviderForRoom(roomType: string): string {
  // Check env directly for room-specific overrides (PROVIDER_CODE_LAB, etc.)
  const envKey = `PROVIDER_${roomType.replace(/-/g, '_').toUpperCase()}`;
  return process.env[envKey] || 'minimax';
}

function getModelForProvider(provider: string): string {
  switch (provider) {
    case 'anthropic': return process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514';
    case 'minimax': return process.env.MINIMAX_MODEL || 'MiniMax-M2.5';
    case 'openai': return process.env.OPENAI_MODEL || 'gpt-4o';
    case 'ollama': return process.env.OLLAMA_MODEL || 'llama3';
    default: return 'unknown';
  }
}

function isProviderConfigured(provider: string): boolean {
  switch (provider) {
    case 'anthropic': return !!process.env.ANTHROPIC_API_KEY;
    case 'minimax': return !!process.env.MINIMAX_API_KEY;
    case 'openai': return !!process.env.OPENAI_API_KEY;
    case 'ollama': return true; // Ollama doesn't need an API key
    default: return false;
  }
}

// ── Exports for fallback chain queries ─────────────────────

export function getFallbackChain(roomType: string): FallbackChain | null {
  return fallbackChains.get(roomType) || null;
}

export function getAllFallbackChains(): Map<string, FallbackChain> {
  return new Map(fallbackChains);
}
