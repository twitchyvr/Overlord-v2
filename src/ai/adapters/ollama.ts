/**
 * Ollama Adapter
 *
 * Calls local Ollama endpoint via HTTP.
 * Translates Anthropic-native format ↔ Ollama chat format.
 * No API key needed — runs locally.
 */

import { logger } from '../../core/logger.js';
import type { AIAdapter, ToolDefinition, Config } from '../../core/contracts.js';

const log = logger.child({ module: 'ai:ollama' });

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

interface OllamaMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
}

function toOllamaMessages(
  messages: { role: string; content: string | AnthropicContentBlock[] }[],
  system?: string,
): OllamaMessage[] {
  const result: OllamaMessage[] = [];

  if (system) {
    result.push({ role: 'system', content: system });
  }

  for (const msg of messages) {
    if (typeof msg.content === 'string') {
      result.push({ role: msg.role as OllamaMessage['role'], content: msg.content });
      continue;
    }

    // Flatten content blocks into text for Ollama (limited tool support)
    const parts: string[] = [];
    for (const block of msg.content) {
      if (block.type === 'text') {
        parts.push(block.text || '');
      } else if (block.type === 'tool_use') {
        parts.push(`[Tool Call: ${block.name}(${JSON.stringify(block.input)})]`);
      } else if (block.type === 'tool_result') {
        parts.push(`[Tool Result: ${block.content}]`);
      }
    }
    if (parts.length > 0) {
      result.push({ role: msg.role as OllamaMessage['role'], content: parts.join('\n') });
    }
  }

  return result;
}

export function createOllamaAdapter(cfg: Config): AIAdapter {
  return {
    name: 'ollama',

    async sendMessage(
      messages: unknown[],
      tools: ToolDefinition[],
      options: Record<string, unknown>,
    ): Promise<unknown> {
      const baseUrl = cfg.get('OLLAMA_BASE_URL');
      const model = (options.model as string) || cfg.get('OLLAMA_MODEL');

      const ollamaMessages = toOllamaMessages(
        messages as { role: string; content: string | AnthropicContentBlock[] }[],
        options.system as string | undefined,
      );

      // If tools are available, inject them into the system prompt
      // (Ollama has limited native tool support depending on model)
      if (tools.length > 0 && !options.system) {
        const toolDesc = tools.map((t) => `- ${t.name}: ${t.description}`).join('\n');
        ollamaMessages.unshift({
          role: 'system',
          content: `Available tools:\n${toolDesc}\n\nTo use a tool, respond with JSON: {"tool": "name", "input": {...}}`,
        });
      }

      log.info({ model, baseUrl, messageCount: messages.length }, 'Sending Ollama request');

      const response = await fetch(`${baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: ollamaMessages,
          stream: false,
          options: {
            ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
          },
        }),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Ollama API error ${response.status}: ${text}`);
      }

      const data = await response.json() as {
        model: string;
        message: { role: string; content: string };
        done: boolean;
        total_duration?: number;
        eval_count?: number;
        prompt_eval_count?: number;
      };

      const content: AnthropicContentBlock[] = [
        { type: 'text', text: data.message.content },
      ];

      // Try to parse tool calls from response (best-effort)
      try {
        const parsed = JSON.parse(data.message.content);
        if (parsed.tool && typeof parsed.tool === 'string') {
          return {
            id: `ollama_${Date.now()}`,
            role: 'assistant',
            content: [{
              type: 'tool_use' as const,
              id: `tc_${Date.now()}`,
              name: parsed.tool,
              input: parsed.input || {},
            }],
            model: data.model,
            stop_reason: 'tool_use',
            usage: {
              input_tokens: data.prompt_eval_count || 0,
              output_tokens: data.eval_count || 0,
            },
          };
        }
      } catch {
        // Not a tool call — that's fine
      }

      log.info(
        {
          model: data.model,
          evalTokens: data.eval_count,
          promptTokens: data.prompt_eval_count,
        },
        'Ollama response received',
      );

      return {
        id: `ollama_${Date.now()}`,
        role: 'assistant',
        content,
        model: data.model,
        stop_reason: 'end_turn',
        usage: {
          input_tokens: data.prompt_eval_count || 0,
          output_tokens: data.eval_count || 0,
        },
      };
    },

    validateConfig: () => true, // No API key needed
  };
}
