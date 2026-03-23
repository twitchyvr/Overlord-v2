/**
 * MiniMax Adapter — Anthropic-Compatible API
 *
 * MiniMax M2.7 (and M2.5) exposes an Anthropic-compatible endpoint at:
 *   https://api.minimax.io/anthropic
 *
 * This means we use the Anthropic SDK directly with a baseURL override.
 * No format translation needed — MiniMax speaks Anthropic-native.
 *
 * M2.7 improvements over M2.5:
 * - Full-trajectory perturbation training for better agentic reasoning
 * - Interleaved thinking between tool calls (not just at start)
 * - Agent Teams: native multi-agent collaboration
 * - SOTA on SWE-Pro (56.22%), TerminalBench2 (57.0%), SWE-Multilingual (76.5%)
 *
 * Features:
 * - 204,800 token context window (API limit)
 * - ~60 tokens/sec output (~100 tokens/sec highspeed)
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
  stop_reason: string | null;
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
      const model = useHighspeed && !baseModel.endsWith('-highspeed')
        ? `${baseModel}-highspeed`
        : baseModel;

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

      // M2.7 interleaved thinking: preserve ALL content blocks including thinking.
      // Per MiniMax docs: "the complete model response must be appended to the
      // conversation history to maintain the continuity of the reasoning chain."
      // The conversation loop at line 555 pushes response.content directly to
      // messages[], so we must NOT strip thinking blocks here.
      const rawContent = response.content as AnthropicContentBlock[];

      // Extract thinking text for the separate `thinking` field (UI display)
      const thinkingText = rawContent
        .filter((b) => b.type === 'thinking')
        .map((b) => b.thinking || b.text || '')
        .filter(Boolean)
        .join('\n\n');

      // If response contains ONLY thinking blocks (max_tokens exhausted on thinking),
      // synthesize a text block so consumers always have at least one text block.
      let finalContent = rawContent;
      const hasNonThinking = rawContent.some((b) => b.type !== 'thinking');
      if (!hasNonThinking && thinkingText) {
        finalContent = [...rawContent, { type: 'text' as const, text: thinkingText }];
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
