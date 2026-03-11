/**
 * MiniMax Adapter
 *
 * Translates Anthropic-native format ↔ MiniMax Chat format.
 * MiniMax uses an OpenAI-compatible API with some quirks.
 * Strips emoji, repairs unicode, contains MiniMax-specific workarounds.
 */

import { logger } from '../../core/logger.js';
import type { AIAdapter, ToolDefinition, Config } from '../../core/contracts.js';

const log = logger.child({ module: 'ai:minimax' });

const MINIMAX_BASE_URL = 'https://api.minimaxi.chat/v1';

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

interface MiniMaxMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string;
  name?: string;
  tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
}

/**
 * Strip emoji and fix unicode issues (MiniMax quirk)
 */
function sanitizeForMiniMax(text: string): string {
  // Strip emoji ranges
  return text.replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '');
}

function toMiniMaxMessages(
  messages: { role: string; content: string | AnthropicContentBlock[] }[],
  system?: string,
): MiniMaxMessage[] {
  const result: MiniMaxMessage[] = [];

  if (system) {
    result.push({ role: 'system', content: sanitizeForMiniMax(system) });
  }

  for (const msg of messages) {
    if (typeof msg.content === 'string') {
      result.push({ role: msg.role as MiniMaxMessage['role'], content: sanitizeForMiniMax(msg.content) });
      continue;
    }

    for (const block of msg.content) {
      if (block.type === 'text') {
        result.push({ role: msg.role as MiniMaxMessage['role'], content: sanitizeForMiniMax(block.text || '') });
      } else if (block.type === 'tool_use') {
        result.push({
          role: 'assistant',
          content: '',
          tool_calls: [{
            id: block.id || `call_${Date.now()}`,
            type: 'function',
            function: {
              name: block.name || '',
              arguments: JSON.stringify(block.input || {}),
            },
          }],
        });
      } else if (block.type === 'tool_result') {
        result.push({
          role: 'tool',
          tool_call_id: block.tool_use_id || '',
          content: typeof block.content === 'string' ? block.content : JSON.stringify(block.content),
        });
      }
    }
  }

  return result;
}

export function createMinimaxAdapter(cfg: Config): AIAdapter {
  return {
    name: 'minimax',

    async sendMessage(
      messages: unknown[],
      tools: ToolDefinition[],
      options: Record<string, unknown>,
    ): Promise<unknown> {
      const apiKey = cfg.get('MINIMAX_API_KEY');
      if (!apiKey) throw new Error('MINIMAX_API_KEY is not configured');

      const model = (options.model as string) || cfg.get('MINIMAX_MODEL');
      const mmMessages = toMiniMaxMessages(
        messages as { role: string; content: string | AnthropicContentBlock[] }[],
        options.system as string | undefined,
      );

      const mmTools = tools.map((t) => ({
        type: 'function' as const,
        function: {
          name: t.name,
          description: t.description,
          parameters: t.inputSchema,
        },
      }));

      log.info({ model, messageCount: messages.length, toolCount: tools.length }, 'Sending MiniMax request');

      const body: Record<string, unknown> = {
        model,
        messages: mmMessages,
        max_tokens: (options.max_tokens as number) || 4096,
      };
      if (mmTools.length > 0) body.tools = mmTools;
      if (options.temperature !== undefined) body.temperature = options.temperature;

      const response = await fetch(`${MINIMAX_BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`MiniMax API error ${response.status}: ${text}`);
      }

      const data = await response.json() as {
        id: string;
        model: string;
        choices: {
          message: { role: string; content?: string; tool_calls?: { id: string; function: { name: string; arguments: string } }[] };
          finish_reason: string;
        }[];
        usage: { prompt_tokens: number; completion_tokens: number };
      };

      const choice = data.choices[0];
      const content: AnthropicContentBlock[] = [];

      if (choice.message.content) {
        content.push({ type: 'text', text: choice.message.content });
      }
      if (choice.message.tool_calls) {
        for (const tc of choice.message.tool_calls) {
          content.push({
            type: 'tool_use',
            id: tc.id,
            name: tc.function.name,
            input: JSON.parse(tc.function.arguments || '{}'),
          });
        }
      }

      const stopMap: Record<string, string> = {
        stop: 'end_turn',
        tool_calls: 'tool_use',
        length: 'max_tokens',
      };

      log.info(
        {
          id: data.id,
          stopReason: stopMap[choice.finish_reason] || choice.finish_reason,
          inputTokens: data.usage.prompt_tokens,
          outputTokens: data.usage.completion_tokens,
        },
        'MiniMax response received',
      );

      return {
        id: data.id,
        role: 'assistant',
        content,
        model: data.model,
        stop_reason: stopMap[choice.finish_reason] || null,
        usage: {
          input_tokens: data.usage.prompt_tokens,
          output_tokens: data.usage.completion_tokens,
        },
      };
    },

    validateConfig: () => !!cfg.get('MINIMAX_API_KEY'),
  };
}
