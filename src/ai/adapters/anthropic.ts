/**
 * Anthropic Adapter
 *
 * Internal format = Anthropic-native. No translation needed.
 * Handles tool_use and tool_result blocks, streaming optional.
 */

import Anthropic from '@anthropic-ai/sdk';
import { logger } from '../../core/logger.js';
import { buildCachedSystemPrompt } from '../prompt-cache.js';
import type { AIAdapter, ToolDefinition, Config } from '../../core/contracts.js';

const log = logger.child({ module: 'ai:anthropic' });

interface AnthropicTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

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

export interface AnthropicResponse {
  id: string;
  role: 'assistant';
  content: AnthropicContentBlock[];
  model: string;
  stop_reason: 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence' | null;
  usage: { input_tokens: number; output_tokens: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number };
}

export function createAnthropicAdapter(cfg: Config): AIAdapter {
  let client: Anthropic | null = null;

  function getClient(): Anthropic {
    if (!client) {
      const apiKey = cfg.get('ANTHROPIC_API_KEY');
      if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not configured');

      const baseURL = cfg.get('ANTHROPIC_BASE_URL');
      const timeoutMs = cfg.get('AI_REQUEST_TIMEOUT_MS');
      client = new Anthropic({
        apiKey,
        timeout: timeoutMs,
        ...(baseURL ? { baseURL } : {}),
      });
    }
    return client;
  }

  return {
    name: 'anthropic',

    async sendMessage(
      messages: unknown[],
      tools: ToolDefinition[],
      options: Record<string, unknown>,
    ): Promise<AnthropicResponse> {
      const anthropic = getClient();
      const model = (options.model as string) || cfg.get('ANTHROPIC_MODEL');

      // Convert tool definitions to Anthropic format
      const anthropicTools: AnthropicTool[] = tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.inputSchema,
      }));

      // Build system prompt with cache_control if caching is available
      const rawSystem = options.system as string | undefined;
      const systemPayload = rawSystem
        ? buildCachedSystemPrompt(rawSystem, 'anthropic')
        : undefined;

      const requestParams: Anthropic.MessageCreateParams = {
        model,
        max_tokens: (options.max_tokens as number) || 4096,
        messages: messages as Anthropic.MessageParam[],
        ...(anthropicTools.length > 0 ? { tools: anthropicTools as Anthropic.Tool[] } : {}),
        ...(systemPayload ? { system: systemPayload as Anthropic.MessageCreateParams['system'] } : {}),
        ...(options.temperature !== undefined ? { temperature: options.temperature as number } : {}),
      };

      const baseURL = cfg.get('ANTHROPIC_BASE_URL');
      log.info(
        { model, messageCount: messages.length, toolCount: tools.length, ...(baseURL ? { baseURL } : {}) },
        'Sending Anthropic request',
      );

      const response = await anthropic.messages.create(requestParams) as Anthropic.Message;

      // Extract cache usage if present (Anthropic + compatible providers like MiniMax)
      const usage: AnthropicResponse['usage'] = {
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
        'Anthropic response received',
      );

      return {
        id: response.id,
        role: response.role,
        content: response.content as AnthropicContentBlock[],
        model: response.model,
        stop_reason: response.stop_reason,
        usage,
      };
    },

    validateConfig: () => !!cfg.get('ANTHROPIC_API_KEY'),
  };
}
