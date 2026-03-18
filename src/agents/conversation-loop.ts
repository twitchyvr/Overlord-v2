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
import { config } from '../core/config.js';
import { AgentSession } from './agent-session.js';
import { estimateTokens, allocateBudget, pruneMessages, getContextMetrics } from './context-manager.js';
import { buildScratchpadInjection } from '../tools/providers/session-notes.js';
import { acquireSlot, releaseSlot } from '../ai/rate-limiter.js';
import { buildPerception, extractToolResults } from './perception-builder.js';
import { selectToolsForTask } from './tool-selector.js';
import type { Bus } from '../core/bus.js';
import type {
  Result,
  AIProviderAPI,
  ToolRegistryAPI,
  BaseRoomLike,
  RepoContextEntry,
  FileOriginEntry,
} from '../core/contracts.js';

const log = logger.child({ module: 'conversation-loop' });

// ─── Exit Document Auto-Detection (#524) ───

/**
 * Known exit document field sets by room type.
 * If an AI response contains a JSON object with fields matching one of these
 * sets, it's treated as an exit document and auto-submitted.
 */
const EXIT_DOC_FIELD_SETS: Record<string, string[]> = {
  'building-blueprint': ['effortLevel', 'projectGoals', 'successCriteria', 'floorsNeeded', 'roomConfig', 'agentRoster', 'estimatedPhases'],
  'requirements-document': ['businessOutcomes', 'constraints', 'unknowns', 'gapAnalysis', 'riskAssessment', 'acceptanceCriteria'],
  'architecture-document': ['milestones', 'taskBreakdown', 'dependencyGraph', 'techDecisions', 'fileAssignments'],
  'implementation-report': ['filesModified', 'testsAdded', 'changesDescription', 'riskAssessment'],
  'test-report': ['testsPassed', 'testsFailed', 'coverage', 'blockers'],
  'gate-review': ['verdict', 'evidence', 'conditions', 'riskQuestionnaire'],
  'deployment-report': ['environment', 'version', 'deployedAt', 'healthCheck', 'rollbackPlan'],
  'incident-report': ['incidentSummary', 'rootCause', 'resolution', 'preventionPlan', 'timeToResolve'],
  'research-report': ['findings', 'sources', 'recommendations', 'gaps'],
  'security-report': ['vulnerabilities', 'riskLevel', 'recommendations', 'dependencyAudit', 'complianceChecks'],
  'documentation-report': ['documentsWritten', 'documentsUpdated', 'coverageAreas', 'remainingGaps'],
  'monitoring-report': ['metricsConfigured', 'alertsCreated', 'dashboardsSetup', 'recommendations'],
};

/**
 * Extract JSON blocks from AI response text.
 * Looks for ```json ... ``` fenced blocks and bare JSON objects.
 */
function extractJsonBlocks(text: string): unknown[] {
  const results: unknown[] = [];

  // Match ```json ... ``` fenced code blocks
  const fencedPattern = /```(?:json)?\s*\n?([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  while ((match = fencedPattern.exec(text)) !== null) {
    try {
      results.push(JSON.parse(match[1].trim()));
    } catch {
      // Not valid JSON — skip
    }
  }

  // If no fenced blocks found, try to find bare JSON objects
  if (results.length === 0) {
    // Look for top-level { ... } that span substantial content
    const barePattern = /\{[\s\S]{20,}\}/g;
    while ((match = barePattern.exec(text)) !== null) {
      try {
        results.push(JSON.parse(match[0]));
      } catch {
        // Not valid JSON — skip
      }
    }
  }

  return results;
}

/**
 * Check if a parsed object matches any known exit document field set,
 * optionally narrowed to a specific room's exit template.
 *
 * Returns the matching field set type or null.
 */
function matchesExitDocFields(
  obj: Record<string, unknown>,
  roomExitTemplate?: { type: string; fields: string[] },
): string | null {
  // If room has a specific exit template, check that first
  if (roomExitTemplate && roomExitTemplate.fields.length > 0) {
    const matchCount = roomExitTemplate.fields.filter((f) => f in obj).length;
    // Require at least half the fields to match (AI may not fill every field)
    if (matchCount >= Math.ceil(roomExitTemplate.fields.length / 2)) {
      return roomExitTemplate.type;
    }
  }

  // Fallback: check against all known field sets
  for (const [type, fields] of Object.entries(EXIT_DOC_FIELD_SETS)) {
    const matchCount = fields.filter((f) => f in obj).length;
    if (matchCount >= Math.ceil(fields.length / 2)) {
      return type;
    }
  }

  return null;
}

/**
 * Detect if an AI response contains an exit document and auto-submit it.
 *
 * The Strategist (and other rooms) often generate the exit document as JSON
 * in their text response but never call the submission tool. This function
 * catches that case and emits `exit-doc:auto-submit` on the bus.
 *
 * @returns true if an exit doc was detected and submitted
 */
export function detectAndSubmitExitDoc(
  responseText: string,
  roomId: string,
  agentId: string,
  bus: Bus,
  roomExitTemplate?: { type: string; fields: string[] },
): boolean {
  if (!responseText || responseText.length < 30) return false;

  const jsonBlocks = extractJsonBlocks(responseText);
  if (jsonBlocks.length === 0) return false;

  for (const block of jsonBlocks) {
    if (!block || typeof block !== 'object' || Array.isArray(block)) continue;

    const obj = block as Record<string, unknown>;
    const matchedType = matchesExitDocFields(obj, roomExitTemplate);

    if (matchedType) {
      log.info(
        { roomId, agentId, exitDocType: matchedType, fieldCount: Object.keys(obj).length },
        'Auto-detected exit document in AI response',
      );

      bus.emit('exit-doc:auto-submit', {
        roomId,
        agentId,
        document: obj,
        exitDocType: matchedType,
      });

      return true;
    }
  }

  return false;
}

/** All limits are user-configurable via environment variables / config */
const MAX_TOOL_ITERATIONS = config.get('MAX_TOOL_ITERATIONS');
const TOOL_TIMEOUT_MS = config.get('TOOL_TIMEOUT_MS');
const AI_MAX_RETRIES = config.get('AI_MAX_RETRIES');
const AI_RETRY_DELAY_MS = config.get('AI_RETRY_DELAY_MS');
const PARALLEL_TOOL_EXECUTION = config.get('PARALLEL_TOOL_EXECUTION');

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
  /** Additional paths the building has been granted access to */
  allowedPaths?: string[];
  /** Linked repositories and file origin data for context injection */
  repoContext?: {
    repos: RepoContextEntry[];
    fileOrigins: FileOriginEntry[];
    truncatedOrigins?: boolean;
  };
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
  const buildingId = (options.buildingId as string) || ''; // For scoped event delivery (#593)
  const messages: Message[] = [...params.messages];
  const toolCallLog: ConversationResult['toolCalls'] = [];
  const thinkingLog: string[] = [];
  const totalTokens = { input: 0, output: 0 };
  const allTextParts: string[] = []; // Accumulate text from ALL iterations (#532)

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
  const allRoomTools = tools.getToolsForRoom(allowedToolNames);

  // Intelligent tool selection (#654): filter to task-relevant tools
  const usedToolNames = new Set<string>();
  const lastUserMsg = messages.filter(m => m.role === 'user').pop();
  const userMsgText = typeof lastUserMsg?.content === 'string'
    ? lastUserMsg.content
    : Array.isArray(lastUserMsg?.content)
      ? lastUserMsg.content.filter((b: { type: string; text?: string }) => b.type === 'text').map((b: { type: string; text?: string }) => b.text || '').join(' ')
      : '';
  let roomTools = selectToolsForTask(allRoomTools, userMsgText, usedToolNames);

  // Build system prompt from room context + agent scratchpad
  const roomContext = room.buildContextInjection();
  const baseSystemPrompt = buildSystemPrompt(roomContext, room, params.repoContext);
  let scratchpad = '';
  try { scratchpad = buildScratchpadInjection(agentId); } catch { /* DB not ready yet — scratchpad is optional */ }
  const systemPrompt = scratchpad
    ? `${baseSystemPrompt}\n\n${scratchpad}`
    : baseSystemPrompt;

  // Pre-compute context budget for pruning
  const systemPromptTokens = estimateTokens(systemPrompt);
  const contextBudget = allocateBudget(provider, systemPromptTokens);

  let iteration = 0;

  while (iteration < MAX_TOOL_ITERATIONS) {
    iteration++;

    // Prune messages if history exceeds budget
    const pruneResult = pruneMessages(messages, contextBudget);
    if (pruneResult.prunedCount > 0) {
      log.info(
        { prunedCount: pruneResult.prunedCount, totalTokens: pruneResult.totalTokens, budgetUsed: pruneResult.budgetUsed },
        'Context pruning applied',
      );
      messages.length = 0;
      messages.push(...pruneResult.messages);

      // Emit context metrics for UI
      const metrics = getContextMetrics(provider, systemPrompt, messages, pruneResult);
      bus.emit('context:metrics', { agentId, roomId: room.id, ...metrics });
    }

    log.info(
      { iteration, provider, agentId, roomId: room.id, messageCount: messages.length },
      'Conversation loop iteration',
    );

    // On iteration 2+, expand to full tool set (#654). The token savings from
    // iteration 1 (often the longest turn) are already captured. Subsequent
    // iterations are shorter tool-call rounds that may need any room tool.
    if (iteration > 1) {
      roomTools = allRoomTools;
    }

    // PTA: Inject perception context after the first iteration (#362)
    // On iteration 2+, the AI gets a structured snapshot of what just happened
    if (iteration > 1 && toolCallLog.length > 0) {
      // Extract results from the most recent batch of tool calls
      const recentResults = extractToolResults(toolCallLog.slice(-10));
      const perception = buildPerception(
        {
          roomId: room.id,
          roomType: room.type,
          allowedTools: allowedToolNames,
          fileScope: String(room.fileScope),
          rules: room.getRules(),
        },
        recentResults,
        iteration,
        MAX_TOOL_ITERATIONS,
      );

      // Inject perception as a system-level user message so the AI sees it
      messages.push({
        role: 'user',
        content: `[Perception Update]\n${perception}`,
      });
    }

    // Send to AI with retry for transient failures
    let aiResult: Result;
    let retries = 0;

    while (true) {
      // Rate limiting: acquire a slot before sending (#381)
      await acquireSlot(provider);

      aiResult = await ai.sendMessage({
        provider,
        messages,
        tools: roomTools,
        options: { ...options, system: systemPrompt },
      });

      releaseSlot(provider);

      if (aiResult.ok) break;

      const aiError = aiResult.error;
      if (retries < AI_MAX_RETRIES && isTransientError(aiError)) {
        retries++;
        const delay = AI_RETRY_DELAY_MS * Math.pow(2, retries - 1);
        log.warn({ error: aiError, retry: retries, delayMs: delay, agentId, roomId: room.id }, 'Retrying AI request after transient failure');
        bus.emit('chat:stream', { agentId, buildingId, roomId: room.id, content: [{ type: 'text', text: `[Retrying AI request (attempt ${retries + 1})...]` }], iteration });
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
      allTextParts.push(assistantText); // Accumulate across iterations (#532)
      session.addMessage({ role: 'assistant', content: assistantText });
      room.onMessage(agentId, assistantText, 'assistant');

      // Auto-detect exit documents embedded in AI text responses (#524)
      // The AI sometimes generates exit doc JSON in prose instead of calling the tool
      const exitTemplate = room.exitRequired;
      if (exitTemplate && exitTemplate.fields.length > 0) {
        detectAndSubmitExitDoc(assistantText, room.id, agentId, bus, exitTemplate);
      }
    }

    // Forward thinking blocks explicitly for the UI to display AI reasoning
    const streamThinking = thinkingBlocks
      .filter((b) => b.thinking)
      .map((b) => b.thinking as string);

    bus.emit('chat:stream', {
      agentId,
      buildingId,
      roomId: room.id,
      content: response.content,
      thinking: streamThinking.length > 0 ? streamThinking : undefined,
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

    // Extract tool_use blocks and execute (parallel or sequential per config #365)
    const toolUseBlocks = response.content.filter((b) => b.type === 'tool_use');
    const toolResults: ContentBlock[] = [];

    /**
     * Execute a single tool block and return its result.
     * Extracted to enable both sequential and parallel execution paths.
     */
    const executeSingleTool = async (toolBlock: ContentBlock): Promise<{
      result: ContentBlock;
      logEntry: { name: string; input: Record<string, unknown>; result: unknown };
    }> => {
      const toolName = toolBlock.name || '';
      const toolInput = toolBlock.input || {};
      const toolUseId = toolBlock.id || '';

      log.info({ tool: toolName, agentId, roomId: room.id }, 'Executing tool');

      // Guard: reject tool names not in the room's allowed list
      if (!allowedToolNames.includes(toolName)) {
        log.warn({ tool: toolName, agentId, roomId: room.id, allowedTools: allowedToolNames }, 'AI requested unknown/disallowed tool');
        bus.emit('tool:guardrail-violation', {
          type: 'unknown_tool',
          toolName,
          agentId,
          roomId: room.id,
          allowedTools: allowedToolNames,
        });
        return {
          result: {
            type: 'tool_result',
            tool_use_id: toolUseId,
            content: `Error: Tool "${toolName}" is not available in this room. Available tools: ${allowedToolNames.join(', ')}`,
            is_error: true,
          },
          logEntry: { name: toolName, input: toolInput, result: { error: `Tool "${toolName}" is not available` } },
        };
      }

      // Room-level guardrail: onBeforeToolCall can BLOCK execution
      const beforeResult = room.onBeforeToolCall(toolName, agentId, toolInput);
      if (!beforeResult.ok) {
        log.warn({ tool: toolName, agentId, reason: beforeResult.error.message }, 'Tool blocked by room');
        bus.emit('tool:blocked', { toolName, agentId, roomId: room.id, reason: beforeResult.error.message });
        return {
          result: {
            type: 'tool_result',
            tool_use_id: toolUseId,
            content: `Blocked by room: ${beforeResult.error.message}`,
            is_error: true,
          },
          logEntry: { name: toolName, input: toolInput, result: beforeResult.error },
        };
      }

      bus.emit('tool:executing', {
        toolName,
        agentId,
        roomId: room.id,
        input: toolInput,
      });

      // Stream tool progress to the client so the UI shows what's happening
      bus.emit('chat:stream', {
        agentId,
        buildingId,
        roomId: room.id,
        content: [{ type: 'text', text: '' }],
        status: 'tool',
        toolName,
        iteration,
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
              allowedPaths: params.allowedPaths,
              repoContext: params.repoContext,
              buildingId: (params.options?.buildingId as string) || '',
            },
          }),
          TOOL_TIMEOUT_MS,
          `Tool "${toolName}"`,
        );
      } catch (toolError) {
        const errorMsg = toolError instanceof Error ? toolError.message : String(toolError);
        log.error({ tool: toolName, agentId, roomId: room.id, error: errorMsg }, 'Tool execution failed');
        bus.emit('tool:executed', { toolName, roomId: room.id, agentId, success: false, error: errorMsg });

        return {
          result: {
            type: 'tool_result',
            tool_use_id: toolUseId,
            content: `Error: ${errorMsg}`,
            is_error: true,
          },
          logEntry: { name: toolName, input: toolInput, result: { error: errorMsg } },
        };
      }

      // Track tool usage for intelligent tool selection (#654)
      usedToolNames.add(toolName);

      // Room-level observation: onAfterToolCall can trigger escalation
      room.onAfterToolCall(toolName, agentId, toolResult);

      const resultContent = toolResult.ok
        ? JSON.stringify(toolResult.data)
        : `Error: ${toolResult.error.message}`;

      bus.emit('tool:executed', {
        toolName,
        roomId: room.id,
        agentId,
        success: toolResult.ok,
      });

      return {
        result: {
          type: 'tool_result',
          tool_use_id: toolUseId,
          content: resultContent,
          is_error: !toolResult.ok,
        },
        logEntry: {
          name: toolName,
          input: toolInput,
          result: toolResult.ok ? toolResult.data : toolResult.error,
        },
      };
    };

    // Execute tools: parallel if enabled and multiple tools, otherwise sequential (#365)
    if (PARALLEL_TOOL_EXECUTION && toolUseBlocks.length > 1) {
      log.info(
        { toolCount: toolUseBlocks.length, agentId, roomId: room.id },
        'Executing tools in parallel',
      );
      const outcomes = await Promise.all(toolUseBlocks.map(executeSingleTool));
      for (const outcome of outcomes) {
        toolResults.push(outcome.result);
        toolCallLog.push(outcome.logEntry);
      }
    } else {
      for (const toolBlock of toolUseBlocks) {
        const outcome = await executeSingleTool(toolBlock);
        toolResults.push(outcome.result);
        toolCallLog.push(outcome.logEntry);
      }
    }

    // Add tool results as user message
    messages.push({ role: 'user', content: toolResults });
  }

  if (iteration >= MAX_TOOL_ITERATIONS) {
    log.warn({ iterations: iteration, agentId, roomId: room.id }, 'Max tool iterations reached');
    // Don't emit chat:response here — the orchestrator handles all response emission
    // to avoid double-sending messages to the frontend
  }

  // Use accumulated text from ALL iterations so intermediate text
  // (e.g. explanation before tool calls) isn't lost (#532)
  let finalText = allTextParts.join('\n\n');
  if (!finalText) {
    // Fallback: extract from last assistant message
    const lastAssistant = messages.filter((m) => m.role === 'assistant').pop();
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
  repoContext?: { repos: RepoContextEntry[]; fileOrigins: FileOriginEntry[]; truncatedOrigins?: boolean },
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

  // Inject linked repository context (#644)
  if (repoContext && repoContext.repos.length > 0) {
    sections.push('', '## Repository Context');
    sections.push('This project has the following linked repositories:');
    sections.push('');
    for (const repo of repoContext.repos) {
      const pathNote = repo.localPath ? ` (local: ${repo.localPath})` : '';
      const branchNote = repo.branch && repo.branch !== 'main' ? ` [branch: ${repo.branch}]` : '';
      sections.push(`- **${repo.name}** — ${repo.relationship}${branchNote}${pathNote}`);
      sections.push(`  URL: ${repo.url}`);
    }

    // File origins — show which local files came from which repos
    if (repoContext.fileOrigins.length > 0) {
      sections.push('', '### File Origins');
      const truncNote = repoContext.truncatedOrigins ? ' (showing first 100)' : '';
      sections.push(`These local files originated from linked repos${truncNote}:`);
      for (const origin of repoContext.fileOrigins) {
        const modified = origin.modifiedLocally ? ' (modified locally)' : '';
        const source = origin.sourceFilePath ? ` ← ${origin.sourceFilePath}` : '';
        sections.push(`- \`${origin.filePath}\` from **${origin.repoName}**${source}${modified}`);
      }
    }
  }

  return sections.join('\n');
}
