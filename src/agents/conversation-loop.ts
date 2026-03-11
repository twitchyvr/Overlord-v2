/**
 * Conversation Loop
 *
 * The engine that drives agent ↔ AI ↔ tool execution cycles.
 *
 * Flow:
 *   1. Build context injection from room (rules, tools, file scope)
 *   2. Send messages to AI provider
 *   3. If AI responds with tool_use → execute tool → feed result back
 *   4. Loop until AI returns end_turn or max iterations reached
 *   5. Return final response
 */

import { logger } from '../core/logger.js';
import type { Bus } from '../core/bus.js';
import type {
  Result,
  AIProviderAPI,
  ToolRegistryAPI,
  BaseRoomLike,
  ToolDefinition,
} from '../core/contracts.js';

const log = logger.child({ module: 'conversation-loop' });

const MAX_TOOL_ITERATIONS = 20;

interface ContentBlock {
  type: 'text' | 'tool_use' | 'tool_result';
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: string;
  is_error?: boolean;
}

interface AIResponse {
  id: string;
  role: 'assistant';
  content: ContentBlock[];
  model: string;
  stop_reason: 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence' | null;
  usage: { input_tokens: number; output_tokens: number };
}

interface Message {
  role: 'user' | 'assistant';
  content: string | ContentBlock[];
}

export interface ConversationResult {
  messages: Message[];
  finalText: string;
  toolCalls: { name: string; input: Record<string, unknown>; result: unknown }[];
  totalTokens: { input: number; output: number };
  iterations: number;
}

interface ConversationParams {
  provider: string;
  room: BaseRoomLike;
  agentId: string;
  messages: Message[];
  ai: AIProviderAPI;
  tools: ToolRegistryAPI;
  bus: Bus;
  options?: Record<string, unknown>;
}

/**
 * Run a conversation loop: send → (tool_use → execute → result)* → done
 */
export async function runConversationLoop(params: ConversationParams): Promise<Result<ConversationResult>> {
  const { provider, room, agentId, ai, tools, bus, options = {} } = params;
  const messages: Message[] = [...params.messages];
  const toolCallLog: ConversationResult['toolCalls'] = [];
  const totalTokens = { input: 0, output: 0 };

  // Get room's allowed tools as ToolDefinitions for the AI
  const allowedToolNames = room.getAllowedTools();
  const roomTools = tools.getToolsForRoom(allowedToolNames);

  // Build system prompt from room context
  const roomContext = room.buildContextInjection();
  const systemPrompt = buildSystemPrompt(roomContext, room);

  let iteration = 0;

  while (iteration < MAX_TOOL_ITERATIONS) {
    iteration++;

    log.info(
      { iteration, provider, agentId, roomId: room.id, messageCount: messages.length },
      'Conversation loop iteration',
    );

    // Send to AI
    const aiResult = await ai.sendMessage({
      provider,
      messages,
      tools: roomTools,
      options: { ...options, system: systemPrompt },
    });

    if (!aiResult.ok) {
      log.error({ error: aiResult.error }, 'AI request failed');
      return aiResult as Result<ConversationResult>;
    }

    const response = aiResult.data as AIResponse;
    totalTokens.input += response.usage.input_tokens;
    totalTokens.output += response.usage.output_tokens;

    // Add assistant response to message history
    messages.push({ role: 'assistant', content: response.content });

    bus.emit('chat:stream', {
      agentId,
      roomId: room.id,
      content: response.content,
      iteration,
    });

    // Check if we're done (no tool use)
    if (response.stop_reason !== 'tool_use') {
      log.info(
        { iterations: iteration, stopReason: response.stop_reason, totalTokens },
        'Conversation loop complete',
      );
      break;
    }

    // Extract tool_use blocks and execute each
    const toolUseBlocks = response.content.filter((b) => b.type === 'tool_use');
    const toolResults: ContentBlock[] = [];

    for (const toolBlock of toolUseBlocks) {
      const toolName = toolBlock.name || '';
      const toolInput = toolBlock.input || {};
      const toolUseId = toolBlock.id || '';

      log.info({ tool: toolName, agentId, roomId: room.id }, 'Executing tool');

      bus.emit('tool:executing', {
        toolName,
        agentId,
        roomId: room.id,
        input: toolInput,
      });

      // Execute through the tool registry (which enforces room access)
      const toolResult = await tools.executeInRoom({
        toolName,
        params: toolInput,
        roomAllowedTools: allowedToolNames,
        context: {
          roomId: room.id,
          roomType: room.type,
          agentId,
          fileScope: room.fileScope,
        },
      });

      const resultContent = toolResult.ok
        ? JSON.stringify(toolResult.data)
        : `Error: ${toolResult.error.message}`;

      toolResults.push({
        type: 'tool_result',
        tool_use_id: toolUseId,
        content: resultContent,
        is_error: !toolResult.ok,
      });

      toolCallLog.push({
        name: toolName,
        input: toolInput,
        result: toolResult.ok ? toolResult.data : toolResult.error,
      });

      bus.emit('tool:executed', {
        toolName,
        roomId: room.id,
        agentId,
        success: toolResult.ok,
      });
    }

    // Add tool results as user message
    messages.push({ role: 'user', content: toolResults });
  }

  if (iteration >= MAX_TOOL_ITERATIONS) {
    log.warn({ iterations: iteration, agentId, roomId: room.id }, 'Max tool iterations reached');
  }

  // Extract final text from last assistant message
  const lastAssistant = messages.filter((m) => m.role === 'assistant').pop();
  let finalText = '';
  if (lastAssistant) {
    if (typeof lastAssistant.content === 'string') {
      finalText = lastAssistant.content;
    } else {
      finalText = lastAssistant.content
        .filter((b) => b.type === 'text')
        .map((b) => b.text || '')
        .join('\n');
    }
  }

  return {
    ok: true,
    data: {
      messages,
      finalText,
      toolCalls: toolCallLog,
      totalTokens,
      iterations: iteration,
    },
  };
}

/**
 * Build a system prompt from room context injection
 */
function buildSystemPrompt(
  context: Record<string, unknown>,
  room: BaseRoomLike,
): string {
  const rules = context.rules as string[] || [];
  const tools = context.tools as string[] || [];
  const fileScope = context.fileScope as string || 'read-only';
  const exitTemplate = context.exitTemplate as { type: string; fields: string[] } | undefined;

  const sections = [
    `You are an AI agent working in the ${room.type} room.`,
    '',
    '## Rules',
    ...rules.map((r) => `- ${r}`),
    '',
    `## File Access: ${fileScope}`,
    '',
    '## Available Tools',
    ...tools.map((t) => `- ${t}`),
  ];

  if (exitTemplate && exitTemplate.fields.length > 0) {
    sections.push('', '## Exit Document Required');
    sections.push(`Type: ${exitTemplate.type}`);
    sections.push(`Required fields: ${exitTemplate.fields.join(', ')}`);
  }

  return sections.join('\n');
}
