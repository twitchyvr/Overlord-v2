/**
 * AI Model Registry (#556)
 *
 * Structured catalog of AI models across providers with capabilities,
 * context windows, pricing tiers, and recommended use cases.
 *
 * Layer: AI (depends on Core)
 */

import { logger } from '../core/logger.js';
import { ok, err } from '../core/contracts.js';
import type { Result } from '../core/contracts.js';

const log = logger.child({ module: 'model-registry' });

// ─── Types ───

export interface ModelInfo {
  id: string;
  name: string;
  provider: string;
  contextWindow: number;
  maxOutput: number;
  pricing: { input: number; output: number };  // per million tokens
  capabilities: string[];
  recommended: string[];  // room types this model is good for
  thinking: boolean;
  vision: boolean;
  toolUse: boolean;
  speed: 'fast' | 'standard' | 'slow';
}

// ─── Model Catalog ───

const MODELS: ModelInfo[] = [
  // Anthropic
  {
    id: 'claude-opus-4-6', name: 'Claude Opus 4.6', provider: 'anthropic',
    contextWindow: 200000, maxOutput: 32000,
    pricing: { input: 15.0, output: 75.0 },
    capabilities: ['reasoning', 'coding', 'analysis', 'extended-thinking'],
    recommended: ['strategist', 'architecture', 'review'],
    thinking: true, vision: true, toolUse: true, speed: 'standard',
  },
  {
    id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', provider: 'anthropic',
    contextWindow: 200000, maxOutput: 16000,
    pricing: { input: 3.0, output: 15.0 },
    capabilities: ['coding', 'analysis', 'fast-reasoning'],
    recommended: ['code-lab', 'testing-lab', 'discovery'],
    thinking: true, vision: true, toolUse: true, speed: 'fast',
  },
  {
    id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5', provider: 'anthropic',
    contextWindow: 200000, maxOutput: 8192,
    pricing: { input: 0.8, output: 4.0 },
    capabilities: ['fast-tasks', 'classification', 'extraction'],
    recommended: ['data-exchange', 'integration'],
    thinking: false, vision: true, toolUse: true, speed: 'fast',
  },

  // MiniMax
  {
    id: 'MiniMax-M2.7', name: 'MiniMax M2.7', provider: 'minimax',
    contextWindow: 1000000, maxOutput: 16384,
    pricing: { input: 1.1, output: 4.4 },
    capabilities: ['reasoning', 'coding', 'interleaved-thinking', 'long-context', 'agent-teams', 'self-evolution'],
    recommended: ['code-lab', 'discovery', 'architecture', 'testing-lab'],
    thinking: true, vision: false, toolUse: true, speed: 'fast',
  },
  {
    id: 'MiniMax-M2.5', name: 'MiniMax M2.5 (Legacy)', provider: 'minimax',
    contextWindow: 1000000, maxOutput: 16384,
    pricing: { input: 1.1, output: 4.4 },
    capabilities: ['reasoning', 'coding', 'interleaved-thinking', 'long-context'],
    recommended: ['code-lab', 'discovery'],
    thinking: true, vision: false, toolUse: true, speed: 'fast',
  },

  // OpenAI
  {
    id: 'gpt-4o', name: 'GPT-4o', provider: 'openai',
    contextWindow: 128000, maxOutput: 16384,
    pricing: { input: 2.5, output: 10.0 },
    capabilities: ['reasoning', 'coding', 'vision', 'audio'],
    recommended: ['code-lab', 'review'],
    thinking: false, vision: true, toolUse: true, speed: 'fast',
  },
  {
    id: 'o3', name: 'o3', provider: 'openai',
    contextWindow: 200000, maxOutput: 100000,
    pricing: { input: 10.0, output: 40.0 },
    capabilities: ['deep-reasoning', 'math', 'coding', 'science'],
    recommended: ['architecture', 'review'],
    thinking: true, vision: true, toolUse: true, speed: 'slow',
  },

  // Ollama (local)
  {
    id: 'llama3', name: 'Llama 3 (Local)', provider: 'ollama',
    contextWindow: 8192, maxOutput: 4096,
    pricing: { input: 0, output: 0 },
    capabilities: ['general', 'coding', 'offline'],
    recommended: ['code-lab'],
    thinking: false, vision: false, toolUse: false, speed: 'fast',
  },
];

// ─── Registry API ───

/**
 * Get all registered models.
 */
export function listModels(): Result {
  return ok(MODELS);
}

/**
 * Get models for a specific provider.
 */
export function getProviderModels(provider: string): Result {
  const models = MODELS.filter(m => m.provider === provider);
  return ok(models);
}

/**
 * Get the recommended model for a room type.
 */
export function getRecommendedModel(roomType: string, provider?: string): Result {
  let candidates = MODELS.filter(m => m.recommended.includes(roomType));
  if (provider) {
    candidates = candidates.filter(m => m.provider === provider);
  }
  if (candidates.length === 0) {
    // Fallback: any model from the provider, or the first model overall
    candidates = provider ? MODELS.filter(m => m.provider === provider) : [MODELS[0]];
  }
  // Sort by speed (fast first), then by cost (cheapest first)
  candidates.sort((a, b) => {
    const speedOrder = { fast: 0, standard: 1, slow: 2 };
    const speedDiff = speedOrder[a.speed] - speedOrder[b.speed];
    if (speedDiff !== 0) return speedDiff;
    return a.pricing.input - b.pricing.input;
  });
  return ok(candidates[0] || null);
}

/**
 * Get a model by ID.
 */
export function getModel(modelId: string): Result {
  const model = MODELS.find(m => m.id === modelId);
  if (!model) {
    log.warn({ modelId }, 'Model not found in registry');
    return err('NOT_FOUND', `Model ${modelId} not found in registry`);
  }
  return ok(model);
}

/**
 * Compare models side by side.
 */
export function compareModels(modelIds: string[]): Result {
  const models = modelIds.map(id => MODELS.find(m => m.id === id)).filter(Boolean);
  return ok(models);
}
