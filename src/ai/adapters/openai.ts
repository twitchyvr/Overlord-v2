/**
 * OpenAI Adapter
 *
 * Translates Anthropic-native format ↔ OpenAI Chat Completions format.
 * Handles function calling / tool_use translation.
 */

import OpenAI from 'openai';
import { logger } from '../../core/logger.js';
import type { AIAdapter, ToolDefinition, Config } from '../../core/contracts.js';

const log = logger.child({ module: 'ai:openai' });

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

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | AnthropicContentBlock[];
}

/**
 * Translate Anthropic messages → OpenAI messages
 */
function toOpenAIMessages(messages: AnthropicMessage[], system?: string): OpenAI.ChatCompletionMessageParam[] {
  const result: OpenAI.ChatCompletionMessageParam[] = [];

  if (system) {
    result.push({ role: 'system', content: system });
  }

  for (const msg of messages) {
    if (typeof msg.content === 'string') {
      result.push({ role: msg.role, content: msg.content });
      continue;
    }

    // Handle content block arrays — batch text blocks from same message
    const textParts: string[] = [];
    const toolUseCalls: OpenAI.ChatCompletionMessageParam[] = [];
    const toolResults: OpenAI.ChatCompletionMessageParam[] = [];

    for (const block of msg.content) {
      if (block.type === 'text') {
        textParts.push(block.text || '');
      } else if (block.type === 'tool_use' && msg.role === 'assistant') {
        toolUseCalls.push({
          role: 'assistant',
          content: null,
          tool_calls: [{
            id: block.id || '',
            type: 'function' as const,
            function: {
              name: block.name || '',
              arguments: JSON.stringify(block.input || {}),
            },
          }],
        });
      } else if (block.type === 'tool_result') {
        toolResults.push({
          role: 'tool',
          tool_call_id: block.tool_use_id || '',
          content: typeof block.content === 'string' ? block.content : JSON.stringify(block.content),
        });
      }
    }

    // Emit batched text as a single message (avoids consecutive same-role messages)
    if (textParts.length > 0) {
      result.push({ role: msg.role, content: textParts.join('\n') });
    }
    // Then tool calls and results (each must be their own message per OpenAI spec)
    result.push(...toolUseCalls, ...toolResults);
  }

  return result;
}

/**
 * Translate OpenAI response → Anthropic format
 */
function fromOpenAIResponse(choice: OpenAI.ChatCompletion.Choice): {
  content: AnthropicContentBlock[];
  stop_reason: 'end_turn' | 'tool_use' | 'max_tokens' | null;
} {
  const content: AnthropicContentBlock[] = [];

  if (choice.message.content) {
    content.push({ type: 'text', text: choice.message.content });
  }

  if (choice.message.tool_calls) {
    for (const tc of choice.message.tool_calls) {
      if ('function' in tc) {
        const fn = tc.function as { name: string; arguments: string };
        content.push({
          type: 'tool_use',
          id: tc.id,
          name: fn.name,
          input: JSON.parse(fn.arguments || '{}'),
        });
      }
    }
  }

  const stopMap: Record<string, 'end_turn' | 'tool_use' | 'max_tokens'> = {
    stop: 'end_turn',
    tool_calls: 'tool_use',
    length: 'max_tokens',
  };

  return {
    content,
    stop_reason: stopMap[choice.finish_reason || ''] || null,
  };
}

export function createOpenAIAdapter(cfg: Config): AIAdapter {
  let client: OpenAI | null = null;

  function getClient(): OpenAI {
    if (!client) {
      const apiKey = cfg.get('OPENAI_API_KEY');
      if (!apiKey) throw new Error('OPENAI_API_KEY is not configured');
      client = new OpenAI({ apiKey });
    }
    return client;
  }

  return {
    name: 'openai',

    async sendMessage(
      messages: unknown[],
      tools: ToolDefinition[],
      options: Record<string, unknown>,
    ): Promise<unknown> {
      const openai = getClient();
      const model = (options.model as string) || cfg.get('OPENAI_MODEL');

      const openAIMessages = toOpenAIMessages(
        messages as AnthropicMessage[],
        options.system as string | undefined,
      );

      const openAITools: OpenAI.ChatCompletionTool[] = tools.map((t) => ({
        type: 'function' as const,
        function: {
          name: t.name,
          description: t.description,
          parameters: t.inputSchema,
        },
      }));

      log.info({ model, messageCount: messages.length, toolCount: tools.length }, 'Sending OpenAI request');

      const response = await openai.chat.completions.create({
        model,
        messages: openAIMessages,
        ...(openAITools.length > 0 ? { tools: openAITools } : {}),
        ...(options.temperature !== undefined ? { temperature: options.temperature as number } : {}),
        max_tokens: (options.max_tokens as number) || 4096,
      });

      const choice = response.choices[0];
      const translated = fromOpenAIResponse(choice);

      log.info(
        {
          id: response.id,
          stopReason: translated.stop_reason,
          inputTokens: response.usage?.prompt_tokens,
          outputTokens: response.usage?.completion_tokens,
        },
        'OpenAI response received',
      );

      return {
        id: response.id,
        role: 'assistant',
        content: translated.content,
        model: response.model,
        stop_reason: translated.stop_reason,
        usage: {
          input_tokens: response.usage?.prompt_tokens || 0,
          output_tokens: response.usage?.completion_tokens || 0,
        },
      };
    },

    validateConfig: () => !!cfg.get('OPENAI_API_KEY'),
  };
}
