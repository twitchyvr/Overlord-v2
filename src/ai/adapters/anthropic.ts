/**
 * Anthropic Adapter
 *
 * Internal format = Anthropic-native. No translation needed.
 * Handles tool_use and tool_result blocks, streaming optional.
 */

import Anthropic from '@anthropic-ai/sdk';
import { logger } from '../../core/logger.js';
import type { AIAdapter, ToolDefinition, Config } from '../../core/contracts.js';

const log = logger.child({ module: 'ai:anthropic' });

interface AnthropicTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | AnthropicContentBlock[];
}

interface AnthropicContentBlock {
  type: 'text' | 'tool_use' | 'tool_result';
  text?: string;
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
  usage: { input_tokens: number; output_tokens: number };
}

export function createAnthropicAdapter(cfg: Config): AIAdapter {
  let client: Anthropic | null = null;

  function getClient(): Anthropic {
    if (!client) {
      const apiKey = cfg.get('ANTHROPIC_API_KEY');
      if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not configured');
      client = new Anthropic({ apiKey });
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

      const requestParams: Anthropic.MessageCreateParams = {
        model,
        max_tokens: (options.max_tokens as number) || 4096,
        messages: messages as Anthropic.MessageParam[],
        ...(anthropicTools.length > 0 ? { tools: anthropicTools as Anthropic.Tool[] } : {}),
        ...(options.system ? { system: options.system as string } : {}),
        ...(options.temperature !== undefined ? { temperature: options.temperature as number } : {}),
      };

      log.info(
        { model, messageCount: messages.length, toolCount: tools.length },
        'Sending Anthropic request',
      );

      const response = await anthropic.messages.create(requestParams) as Anthropic.Message;

      log.info(
        {
          id: response.id,
          stopReason: response.stop_reason,
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
        },
        'Anthropic response received',
      );

      return {
        id: response.id,
        role: response.role,
        content: response.content as AnthropicContentBlock[],
        model: response.model,
        stop_reason: response.stop_reason,
        usage: response.usage,
      };
    },

    validateConfig: () => !!cfg.get('ANTHROPIC_API_KEY'),
  };
}
