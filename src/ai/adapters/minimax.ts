/**
 * MiniMax Adapter — Anthropic-Compatible API
 *
 * MiniMax M2.5 exposes an Anthropic-compatible endpoint at:
 *   https://api.minimax.io/anthropic
 *
 * This means we use the Anthropic SDK directly with a baseURL override.
 * No format translation needed — MiniMax speaks Anthropic-native.
 *
 * Features:
 * - 204,800 token context window
 * - ~60 tokens/sec output
 * - Tool use (Anthropic-native format)
 * - Interleaved thinking (extended thinking support)
 * - Prompt caching via cache_control (Anthropic-style)
 * - Streaming support
 */

import Anthropic from '@anthropic-ai/sdk';
import { logger } from '../../core/logger.js';
import { buildCachedSystemPrompt } from '../prompt-cache.js';
import type { AIAdapter, ToolDefinition, Config } from '../../core/contracts.js';

const log = logger.child({ module: 'ai:minimax' });

interface AnthropicContentBlock {
  type: 'text' | 'thinking' | 'tool_use' | 'tool_result';
  text?: string;
  thinking?: string;
  signature?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: string;
  is_error?: boolean;
}

export interface MinimaxResponse {
  id: string;
  role: 'assistant';
  content: AnthropicContentBlock[];
  model: string;
  stop_reason: 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence' | null;
  usage: { input_tokens: number; output_tokens: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number };
  thinking?: string;
}

export function createMinimaxAdapter(cfg: Config): AIAdapter {
  let client: Anthropic | null = null;

  function getClient(): Anthropic {
    if (!client) {
      const apiKey = cfg.get('MINIMAX_API_KEY');
      if (!apiKey) throw new Error('MINIMAX_API_KEY is not configured');

      const baseURL = cfg.get('MINIMAX_BASE_URL');
      const timeoutMs = cfg.get('AI_REQUEST_TIMEOUT_MS');

      client = new Anthropic({
        apiKey,
        timeout: timeoutMs,
        baseURL,
      });
    }
    return client;
  }

  return {
    name: 'minimax',

    async sendMessage(
      messages: unknown[],
      tools: ToolDefinition[],
      options: Record<string, unknown>,
    ): Promise<MinimaxResponse> {
      const anthropic = getClient();
      const useHighspeed = cfg.get('MINIMAX_USE_HIGHSPEED');
      const baseModel = (options.model as string) || cfg.get('MINIMAX_MODEL');
      const model = useHighspeed ? `${baseModel}-highspeed` : baseModel;

      // Convert tool definitions to Anthropic format
      const anthropicTools: Anthropic.Tool[] = tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
      }));

      // Clamp temperature for MiniMax: must be strictly (0.0, 1.0]
      // Anthropic allows 0.0, but MiniMax rejects it.
      let temperature = options.temperature as number | undefined;
      if (temperature !== undefined) {
        if (temperature <= 0) temperature = 0.01;
        if (temperature > 1) temperature = 1.0;
      }

      // Build system prompt with cache_control if caching is available
      const rawSystem = options.system as string | undefined;
      const systemPayload = rawSystem
        ? buildCachedSystemPrompt(rawSystem, 'minimax')
        : undefined;

      // Build request — identical to Anthropic adapter since MiniMax is Anthropic-compatible
      const requestParams: Anthropic.MessageCreateParams = {
        model,
        max_tokens: (options.max_tokens as number) || 8192,
        messages: messages as Anthropic.MessageParam[],
        ...(anthropicTools.length > 0 ? { tools: anthropicTools } : {}),
        ...(systemPayload ? { system: systemPayload as Anthropic.MessageCreateParams['system'] } : {}),
        ...(temperature !== undefined ? { temperature } : {}),
      };

      log.info(
        { model, messageCount: messages.length, toolCount: tools.length },
        'Sending MiniMax request via Anthropic-compatible API',
      );

      const response = await anthropic.messages.create(requestParams) as Anthropic.Message;

      // Extract cache usage if present (MiniMax supports Anthropic-style prompt caching)
      const usage: MinimaxResponse['usage'] = {
        input_tokens: response.usage.input_tokens,
        output_tokens: response.usage.output_tokens,
      };

      const extUsage = response.usage as unknown as Record<string, unknown>;
      if (extUsage.cache_creation_input_tokens) {
        usage.cache_creation_input_tokens = extUsage.cache_creation_input_tokens as number;
      }
      if (extUsage.cache_read_input_tokens) {
        usage.cache_read_input_tokens = extUsage.cache_read_input_tokens as number;
      }

      log.info(
        {
          id: response.id,
          stopReason: response.stop_reason,
          inputTokens: usage.input_tokens,
          outputTokens: usage.output_tokens,
          ...(usage.cache_creation_input_tokens ? { cacheCreated: usage.cache_creation_input_tokens } : {}),
          ...(usage.cache_read_input_tokens ? { cacheRead: usage.cache_read_input_tokens } : {}),
        },
        'MiniMax response received',
      );

      // Normalize content: separate thinking blocks from text/tool_use blocks.
      // MiniMax may return { type: 'thinking' } blocks (extended thinking) which
      // consumers don't expect in the content array.
      const rawContent = response.content as AnthropicContentBlock[];
      const thinkingBlocks = rawContent.filter((b) => b.type === 'thinking');
      const normalizedContent = rawContent.filter((b) => b.type !== 'thinking');

      // Combine thinking text for consumers that want it
      const thinkingText = thinkingBlocks
        .map((b) => b.thinking || b.text || '')
        .filter(Boolean)
        .join('\n\n');

      // If only thinking blocks remain (max_tokens exhausted on thinking),
      // synthesize a text block from the thinking content
      let finalContent = normalizedContent;
      if (finalContent.length === 0 && thinkingText) {
        finalContent = [{ type: 'text' as const, text: thinkingText }];
      } else if (finalContent.length === 0) {
        finalContent = rawContent;
      }

      return {
        id: response.id,
        role: response.role,
        content: finalContent,
        model: response.model,
        stop_reason: response.stop_reason,
        usage,
        ...(thinkingText ? { thinking: thinkingText } : {}),
      };
    },

    validateConfig: () => !!cfg.get('MINIMAX_API_KEY'),
  };
}
