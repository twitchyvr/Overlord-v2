/**
 * Perception Builder — PTA (Perception-Thinking-Action) Loop Support
 *
 * Before each AI call in the conversation loop, builds a structured
 * "perception" summary that gives the AI a clear picture of:
 *   - What room it's in and what tools are available
 *   - What tool results came back in the last iteration
 *   - What iteration count and remaining budget look like
 *
 * This perception injection improves reasoning quality by grounding
 * the AI's next response in concrete context rather than relying
 * on implicit understanding from the full message history.
 *
 * Layer: Agents (depends on Core only)
 *
 * @see Issue #362
 */

import { logger } from '../core/logger.js';

const log = logger.child({ module: 'perception-builder' });

// ─── Types ───

export interface RoomContext {
  roomId: string;
  roomType: string;
  allowedTools: string[];
  fileScope: string;
  rules?: string[];
}

export interface ToolResultEntry {
  name: string;
  success: boolean;
  summary: string;
}

export interface PerceptionInput {
  roomContext: RoomContext;
  toolResults: ToolResultEntry[];
  iteration: number;
  maxIterations: number;
  goal?: string;
}

// ─── Builder ───

/**
 * Build a perception summary that grounds the AI before each call.
 *
 * The perception is injected as a system-level context message so the AI
 * has an up-to-date snapshot of the current state before generating its
 * next response.
 *
 * @param roomContext - Current room configuration and tool access
 * @param toolResults - Results from the most recent tool executions
 * @param iteration - Current loop iteration (1-based)
 * @param maxIterations - Maximum allowed iterations
 * @param goal - Optional goal/objective description
 * @returns A formatted perception string for system-level injection
 */
export function buildPerception(
  roomContext: RoomContext,
  toolResults: ToolResultEntry[],
  iteration: number,
  maxIterations: number,
  goal?: string,
): string {
  const sections: string[] = [];

  // Section 1: Current state header
  sections.push('## Current Perception State');
  sections.push(`Room: ${roomContext.roomType} (${roomContext.roomId})`);
  sections.push(`File access: ${roomContext.fileScope}`);
  sections.push(`Iteration: ${iteration} of ${maxIterations}`);

  const remaining = maxIterations - iteration;
  if (remaining <= 3) {
    sections.push(`WARNING: Only ${remaining} iteration(s) remaining. Prioritize producing a final response or exit document.`);
  }

  // Section 2: Available tools
  if (roomContext.allowedTools.length > 0) {
    sections.push('');
    sections.push(`Available tools (${roomContext.allowedTools.length}): ${roomContext.allowedTools.join(', ')}`);
  }

  // Section 3: Recent tool results
  if (toolResults.length > 0) {
    sections.push('');
    sections.push('## Recent Tool Results');
    for (const result of toolResults) {
      const status = result.success ? 'OK' : 'ERROR';
      // Truncate long summaries to avoid bloating the context
      const summary = result.summary.length > 500
        ? result.summary.slice(0, 500) + '... [truncated]'
        : result.summary;
      sections.push(`- [${status}] ${result.name}: ${summary}`);
    }
  }

  // Section 4: Goal reminder (if provided)
  if (goal) {
    sections.push('');
    sections.push(`## Goal`);
    sections.push(goal);
  }

  const perception = sections.join('\n');

  log.debug(
    { iteration, toolResultCount: toolResults.length, perceptionLength: perception.length },
    'Perception built',
  );

  return perception;
}

/**
 * Extract tool result summaries from the raw tool call log entries.
 *
 * Transforms the conversation loop's internal tool call records into
 * the simplified ToolResultEntry format used by the perception builder.
 */
export function extractToolResults(
  toolCalls: Array<{ name: string; input: Record<string, unknown>; result: unknown }>,
): ToolResultEntry[] {
  return toolCalls.map((call) => {
    const isError = call.result != null
      && typeof call.result === 'object'
      && 'error' in call.result;

    let summary: string;
    if (isError) {
      const errorObj = call.result as { error: string };
      summary = errorObj.error;
    } else {
      try {
        const resultStr = JSON.stringify(call.result);
        summary = resultStr.length > 300
          ? resultStr.slice(0, 300) + '...'
          : resultStr;
      } catch {
        summary = String(call.result);
      }
    }

    return {
      name: call.name,
      success: !isError,
      summary,
    };
  });
}
