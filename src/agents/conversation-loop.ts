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
import { AgentSession } from './agent-session.js';
import type { Bus } from '../core/bus.js';
import type {
  Result,
  AIProviderAPI,
  ToolRegistryAPI,
  BaseRoomLike,
} from '../core/contracts.js';

const log = logger.child({ module: 'conversation-loop' });

const MAX_TOOL_ITERATIONS = 20;
const TOOL_TIMEOUT_MS = 60_000; // 60 seconds per tool execution
const AI_MAX_RETRIES = 2;
const AI_RETRY_DELAY_MS = 1_000; // 1 second base delay (doubles each retry)

interface ContentBlock {
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
  thinking: string[];
  toolCalls: { name: string; input: Record<string, unknown>; result: unknown }[];
  totalTokens: { input: number; output: number };
  iterations: number;
  sessionId: string;
  maxIterationsReached?: boolean;
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
  /** Building's project working directory — scopes file/shell tools */
  workingDirectory?: string;
}

/**
 * Wrap a promise with a timeout — rejects with a descriptive error if the
 * promise doesn't settle within `ms` milliseconds.
 */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (val) => { clearTimeout(timer); resolve(val); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}

/**
 * Determine if an AI error is likely transient (worth retrying).
 */
function isTransientError(error: { code?: string; message?: string; retryable?: boolean }): boolean {
  if (error.retryable) return true;
  const msg = (error.message || '').toLowerCase();
  return msg.includes('rate limit') || msg.includes('timeout') || msg.includes('econnreset')
    || msg.includes('econnrefused') || msg.includes('529') || msg.includes('overloaded');
}

/**
 * Run a conversation loop: send → (tool_use → execute → result)* → done
 */
export async function runConversationLoop(params: ConversationParams): Promise<Result<ConversationResult>> {
  const { provider, room, agentId, ai, tools, bus, options = {} } = params;
  const messages: Message[] = [...params.messages];
  const toolCallLog: ConversationResult['toolCalls'] = [];
  const thinkingLog: string[] = [];
  const totalTokens = { input: 0, output: 0 };

  // Create agent session for this conversation
  const session = new AgentSession({
    agentId,
    roomId: room.id,
    tableType: (options.tableType as string) || 'focus',
    tools: room.getAllowedTools(),
  });

  // Record initial user messages in the session + fire onMessage hooks
  for (const msg of params.messages) {
    const content = typeof msg.content === 'string'
      ? msg.content
      : msg.content.filter((b) => b.type === 'text').map((b) => b.text || '').join('\n');
    session.addMessage({ role: msg.role, content });
    room.onMessage(agentId, content, msg.role);
  }

  // Persist session to DB (initial save)
  try { session.save(); } catch (e) { log.warn({ err: e, sessionId: session.id }, 'Failed to save session'); }

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

    // Send to AI with retry for transient failures
    let aiResult: Result;
    let retries = 0;

    while (true) {
      aiResult = await ai.sendMessage({
        provider,
        messages,
        tools: roomTools,
        options: { ...options, system: systemPrompt },
      });

      if (aiResult.ok) break;

      const aiError = aiResult.error;
      if (retries < AI_MAX_RETRIES && isTransientError(aiError)) {
        retries++;
        const delay = AI_RETRY_DELAY_MS * Math.pow(2, retries - 1);
        log.warn({ error: aiError, retry: retries, delayMs: delay, agentId, roomId: room.id }, 'Retrying AI request after transient failure');
        bus.emit('chat:stream', { agentId, roomId: room.id, content: [{ type: 'text', text: `[Retrying AI request (attempt ${retries + 1})...]` }], iteration });
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }

      log.error({ error: aiError, agentId, roomId: room.id, retries }, 'AI request failed');
      // Don't emit chat:response here — the orchestrator handles error emission
      // to avoid duplicate error messages reaching the frontend
      return aiResult as Result<ConversationResult>;
    }

    const response = aiResult.data as AIResponse;
    totalTokens.input += response.usage.input_tokens;
    totalTokens.output += response.usage.output_tokens;

    // Capture any thinking blocks from the response (MiniMax M2.5 always-on thinking)
    const thinkingBlocks = response.content.filter((b) => b.type === 'thinking');
    for (const tb of thinkingBlocks) {
      if (tb.thinking) {
        thinkingLog.push(tb.thinking);
        log.debug({ agentId, roomId: room.id, thinkingLength: tb.thinking.length }, 'AI thinking block');
      }
    }

    // Add assistant response to message history (MUST include all blocks including thinking)
    messages.push({ role: 'assistant', content: response.content });

    // Record assistant response in session + fire onMessage hook
    const assistantText = response.content
      .filter((b: ContentBlock) => b.type === 'text')
      .map((b: ContentBlock) => b.text || '')
      .join('\n');
    if (assistantText) {
      session.addMessage({ role: 'assistant', content: assistantText });
      room.onMessage(agentId, assistantText, 'assistant');
    }

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

      // Guard: reject tool names not in the room's allowed list
      if (!allowedToolNames.includes(toolName)) {
        log.warn({ tool: toolName, agentId, roomId: room.id, allowedTools: allowedToolNames }, 'AI requested unknown/disallowed tool');
        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolUseId,
          content: `Error: Tool "${toolName}" is not available in this room. Available tools: ${allowedToolNames.join(', ')}`,
          is_error: true,
        });
        toolCallLog.push({
          name: toolName,
          input: toolInput,
          result: { error: `Tool "${toolName}" is not available` },
        });
        bus.emit('tool:guardrail-violation', {
          type: 'unknown_tool',
          toolName,
          agentId,
          roomId: room.id,
          allowedTools: allowedToolNames,
        });
        continue;
      }

      // Room-level guardrail: onBeforeToolCall can BLOCK execution
      const beforeResult = room.onBeforeToolCall(toolName, agentId, toolInput);
      if (!beforeResult.ok) {
        log.warn({ tool: toolName, agentId, reason: beforeResult.error.message }, 'Tool blocked by room');
        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolUseId,
          content: `Blocked by room: ${beforeResult.error.message}`,
          is_error: true,
        });
        toolCallLog.push({
          name: toolName,
          input: toolInput,
          result: beforeResult.error,
        });
        bus.emit('tool:blocked', { toolName, agentId, roomId: room.id, reason: beforeResult.error.message });
        continue;
      }

      bus.emit('tool:executing', {
        toolName,
        agentId,
        roomId: room.id,
        input: toolInput,
      });

      // Execute through the tool registry with timeout
      let toolResult: Result;
      try {
        toolResult = await withTimeout(
          tools.executeInRoom({
            toolName,
            params: toolInput,
            roomAllowedTools: allowedToolNames,
            context: {
              roomId: room.id,
              roomType: room.type,
              agentId,
              fileScope: room.fileScope,
              workingDirectory: params.workingDirectory,
            },
          }),
          TOOL_TIMEOUT_MS,
          `Tool "${toolName}"`,
        );
      } catch (toolError) {
        const errorMsg = toolError instanceof Error ? toolError.message : String(toolError);
        log.error({ tool: toolName, agentId, roomId: room.id, error: errorMsg }, 'Tool execution failed');
        bus.emit('tool:executed', { toolName, roomId: room.id, agentId, success: false, error: errorMsg });

        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolUseId,
          content: `Error: ${errorMsg}`,
          is_error: true,
        });
        toolCallLog.push({ name: toolName, input: toolInput, result: { error: errorMsg } });
        continue;
      }

      // Room-level observation: onAfterToolCall can trigger escalation
      room.onAfterToolCall(toolName, agentId, toolResult);

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
    // Don't emit chat:response here — the orchestrator handles all response emission
    // to avoid double-sending messages to the frontend
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

  // End session and persist final state
  session.end();
  try { session.save(); } catch (e) { log.warn({ err: e, sessionId: session.id }, 'Failed to save session'); }

  return {
    ok: true,
    data: {
      messages,
      finalText,
      thinking: thinkingLog,
      toolCalls: toolCallLog,
      totalTokens,
      iterations: iteration,
      sessionId: session.id,
      maxIterationsReached: iteration >= MAX_TOOL_ITERATIONS,
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
  const outputFormat = context.outputFormat as Record<string, unknown> | null;
  const escalation = context.escalation as Record<string, string> | undefined;

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
    'Only these tools are available. Do not attempt to call any tool not in this list.',
  ];

  if (exitTemplate && exitTemplate.fields.length > 0) {
    sections.push('', '## Exit Document Required');
    sections.push(`Type: ${exitTemplate.type}`);
    sections.push(`Required fields: ${exitTemplate.fields.join(', ')}`);
    sections.push('You MUST submit a valid exit document before leaving this room.');
  }

  if (outputFormat && typeof outputFormat === 'object') {
    sections.push('', '## Expected Output Format');
    sections.push('Your exit document should match this schema:');
    sections.push('```json');
    sections.push(JSON.stringify(outputFormat, null, 2));
    sections.push('```');
  }

  if (escalation && Object.keys(escalation).length > 0) {
    sections.push('', '## Escalation Rules');
    for (const [condition, target] of Object.entries(escalation)) {
      sections.push(`- ${condition}: escalate to **${target}** room`);
    }
    sections.push('When an escalation condition is met, report it clearly and request escalation.');
  }

  return sections.join('\n');
}
