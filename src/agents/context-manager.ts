/**
 * Context Manager
 *
 * Intelligent context window management for AI conversations.
 * Estimates token usage, allocates budgets, and prunes messages
 * to fit within provider-specific context windows.
 */

import { logger } from '../core/logger.js';
import { config } from '../core/config.js';

const log = logger.child({ module: 'context-manager' });

// ── Token Estimation ─────────────────────────────────────────────────────

/**
 * Fast token estimation using character count heuristic.
 * ~4 characters per token for English text (conservative estimate).
 * For JSON/code content, uses ~3.5 chars per token.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  // JSON and code tend to be more token-dense
  const isStructured = text.startsWith('{') || text.startsWith('[') || text.includes('function ');
  const charsPerToken = isStructured ? 3.5 : 4;
  return Math.ceil(text.length / charsPerToken);
}

/**
 * Estimate tokens for a content block array (assistant messages with mixed content).
 */
export function estimateContentBlockTokens(content: ContentBlock[]): number {
  let total = 0;
  for (const block of content) {
    if (block.type === 'text' && block.text) {
      total += estimateTokens(block.text);
    } else if (block.type === 'thinking' && block.thinking) {
      total += estimateTokens(block.thinking);
    } else if (block.type === 'tool_use' && block.input) {
      total += estimateTokens(JSON.stringify(block.input)) + 20; // overhead for tool structure
    } else if (block.type === 'tool_result' && block.content) {
      total += estimateTokens(block.content);
    }
  }
  return total;
}

/**
 * Estimate tokens for a single message.
 */
export function estimateMessageTokens(message: Message): number {
  if (typeof message.content === 'string') {
    return estimateTokens(message.content) + 4; // role overhead
  }
  return estimateContentBlockTokens(message.content) + 4;
}

// ── Types ────────────────────────────────────────────────────────────────

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

interface Message {
  role: 'user' | 'assistant';
  content: string | ContentBlock[];
}

// ── Provider Context Windows ─────────────────────────────────────────────

/** Maximum context window tokens per provider. */
const PROVIDER_CONTEXT_WINDOWS: Record<string, number> = {
  anthropic: 200_000,
  minimax:   204_800,
  openai:    128_000,
  ollama:    8_000,  // Conservative default; varies by model
};

/**
 * Get the context window size for a provider.
 */
export function getProviderContextWindow(provider: string): number {
  return PROVIDER_CONTEXT_WINDOWS[provider] || 128_000;
}

// ── Context Budget ───────────────────────────────────────────────────────

export interface ContextBudget {
  total: number;           // Total tokens available
  systemPrompt: number;    // Reserved for system prompt
  history: number;         // Available for conversation history
  toolResults: number;     // Reserved for tool result overhead
  reserved: number;        // Safety margin (response tokens + overhead)
}

/**
 * Allocate a context budget for a conversation.
 *
 * Reserves space for:
 *  - System prompt (measured)
 *  - Response generation (configurable, default 4096)
 *  - Safety margin (5% of total)
 *  - Remaining split: 80% history, 20% tool results
 */
export function allocateBudget(
  provider: string,
  systemPromptTokens: number,
  responseReserve = 4096,
): ContextBudget {
  const total = getProviderContextWindow(provider);
  const reserved = responseReserve + Math.ceil(total * 0.05);
  const available = total - systemPromptTokens - reserved;

  const history = Math.floor(available * 0.8);
  const toolResults = available - history;

  return {
    total,
    systemPrompt: systemPromptTokens,
    history: Math.max(history, 1000), // Minimum 1000 tokens for history
    toolResults: Math.max(toolResults, 500),
    reserved,
  };
}

// ── Message Pruning ──────────────────────────────────────────────────────

/** Tags for messages that should NEVER be pruned. */
const ANCHOR_MARKERS = ['[EXIT DOCUMENT]', '[PHASE GATE]', '[MILESTONE]', '[KEY DECISION]'] as const;

/**
 * Check if a message contains an anchor marker that prevents pruning.
 */
function isAnchoredMessage(message: Message): boolean {
  const text = typeof message.content === 'string'
    ? message.content
    : message.content
        .filter(b => b.type === 'text')
        .map(b => b.text || '')
        .join('\n');

  return ANCHOR_MARKERS.some(marker => text.includes(marker));
}

/**
 * Check if a message is a tool result.
 */
function isToolResultMessage(message: Message): boolean {
  if (typeof message.content === 'string') return false;
  return message.content.some(b => b.type === 'tool_result');
}

/**
 * Truncate a tool result's content to a maximum token budget.
 */
function truncateToolResult(block: ContentBlock, maxTokens: number): ContentBlock {
  if (block.type !== 'tool_result' || !block.content) return block;

  const currentTokens = estimateTokens(block.content);
  if (currentTokens <= maxTokens) return block;

  // Truncate content and add indicator
  const maxChars = maxTokens * 4;
  const truncated = block.content.slice(0, maxChars);
  return {
    ...block,
    content: truncated + '\n\n[... output truncated — ' + (currentTokens - maxTokens) + ' tokens omitted]',
  };
}

export interface PruneResult {
  messages: Message[];
  prunedCount: number;
  totalTokens: number;
  budgetUsed: number;
}

/**
 * Prune a message history to fit within the allocated budget.
 *
 * Strategy:
 * 1. Always keep the most recent N messages (configurable, default 10)
 * 2. Never prune anchored messages (exit docs, phase gates, milestones)
 * 3. Truncate large tool results before removing messages
 * 4. Remove oldest non-anchored messages first
 * 5. Preserve user messages longer than assistant messages
 *
 * @param messages     - Full message history
 * @param budget       - Context budget (from allocateBudget)
 * @param keepRecent   - Number of recent messages to always keep (default from config)
 * @returns Pruned message array and metrics
 */
export function pruneMessages(
  messages: Message[],
  budget: ContextBudget,
  keepRecent?: number,
): PruneResult {
  const preserveCount = keepRecent ?? config.get('CONTEXT_PRESERVE_RECENT');
  const maxHistoryTokens = budget.history;
  const maxToolResultTokens = Math.floor(budget.toolResults / Math.max(1, messages.filter(isToolResultMessage).length));

  // Phase 1: Truncate large tool results
  const truncated = messages.map(msg => {
    if (typeof msg.content === 'string') return msg;
    const newContent = msg.content.map(block =>
      block.type === 'tool_result' ? truncateToolResult(block, maxToolResultTokens) : block,
    );
    return { ...msg, content: newContent };
  });

  // Calculate current total
  let totalTokens = truncated.reduce((sum, msg) => sum + estimateMessageTokens(msg), 0);

  // If under budget, return as-is
  if (totalTokens <= maxHistoryTokens) {
    return { messages: truncated, prunedCount: 0, totalTokens, budgetUsed: totalTokens / maxHistoryTokens };
  }

  // Phase 2: Mark messages for pruning
  // Split into "must keep" (recent + anchored) and "can prune" (older, non-anchored)
  const recentStart = Math.max(0, truncated.length - preserveCount);
  const result: Message[] = [];
  let prunedCount = 0;

  for (let i = 0; i < truncated.length; i++) {
    const msg = truncated[i];
    const isRecent = i >= recentStart;
    const isAnchored = isAnchoredMessage(msg);

    if (isRecent || isAnchored) {
      result.push(msg);
    } else {
      // Check if we still need to prune
      const remainingTokens = truncated.slice(i + 1).reduce((sum, m) => sum + estimateMessageTokens(m), 0)
        + result.reduce((sum, m) => sum + estimateMessageTokens(m), 0);

      if (remainingTokens > maxHistoryTokens) {
        prunedCount++;
        // Insert pruning marker if this is the first pruned message or a batch boundary
        if (prunedCount === 1 || prunedCount % 10 === 0) {
          // We'll add a single summary marker after pruning
        }
      } else {
        result.push(msg);
      }
    }
  }

  // Add pruning notice if messages were removed
  if (prunedCount > 0 && result.length > 0 && result[0].role !== 'user') {
    // Insert a notice at the beginning
    result.unshift({
      role: 'user',
      content: `[Context pruned: ${prunedCount} older messages removed to stay within token budget. Key decisions and milestones were preserved.]`,
    });
  } else if (prunedCount > 0) {
    // Add notice after first user message
    const firstUserIdx = result.findIndex(m => m.role === 'user');
    if (firstUserIdx >= 0) {
      result.splice(firstUserIdx + 1, 0, {
        role: 'assistant',
        content: `[Context note: ${prunedCount} older messages were pruned from history. Anchored decisions and recent context preserved.]`,
      });
    }
  }

  totalTokens = result.reduce((sum, msg) => sum + estimateMessageTokens(msg), 0);

  log.info(
    { prunedCount, totalTokens, budget: maxHistoryTokens, messageCount: result.length },
    'Message history pruned',
  );

  return {
    messages: result,
    prunedCount,
    totalTokens,
    budgetUsed: totalTokens / maxHistoryTokens,
  };
}

// ── Context Metrics ──────────────────────────────────────────────────────

export interface ContextMetrics {
  provider: string;
  windowSize: number;
  systemPromptTokens: number;
  historyTokens: number;
  messageCount: number;
  budgetUsed: number;      // 0.0 - 1.0
  pruningActive: boolean;
  prunedMessageCount: number;
}

/**
 * Calculate context metrics for a conversation state.
 */
export function getContextMetrics(
  provider: string,
  systemPrompt: string,
  messages: Message[],
  pruneResult?: PruneResult,
): ContextMetrics {
  const windowSize = getProviderContextWindow(provider);
  const systemPromptTokens = estimateTokens(systemPrompt);
  const historyTokens = messages.reduce((sum, msg) => sum + estimateMessageTokens(msg), 0);

  return {
    provider,
    windowSize,
    systemPromptTokens,
    historyTokens,
    messageCount: messages.length,
    budgetUsed: (systemPromptTokens + historyTokens) / windowSize,
    pruningActive: (pruneResult?.prunedCount ?? 0) > 0,
    prunedMessageCount: pruneResult?.prunedCount ?? 0,
  };
}
