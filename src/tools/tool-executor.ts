/**
 * Tool Executor
 *
 * Room-scoped tool execution. Validates tool access structurally
 * before executing. No tier system, no confidence scores.
 *
 * Binary: tool is in room's list → execute. Not in list → doesn't exist.
 */

import { logger } from '../core/logger.js';
import { ok, err } from '../core/contracts.js';
import { executeInRoom } from './tool-registry.js';

const log = logger.child({ module: 'tool-executor' });

/**
 * Execute a tool call from an AI response within a room context
 */
export async function executeTool({ toolCall, room, agent, bus }) {
  const { name, input } = toolCall;
  const allowedTools = room.getAllowedTools();

  log.info({ tool: name, agent: agent.id, room: room.id }, 'Executing tool');

  const result = await executeInRoom({
    toolName: name,
    params: input,
    roomAllowedTools: allowedTools,
    context: {
      roomId: room.id,
      roomType: room.type,
      agentId: agent.id,
      fileScope: room.fileScope,
    },
  });

  // Emit tool execution event
  bus.emit('tool:executed', {
    toolName: name,
    roomId: room.id,
    agentId: agent.id,
    success: result.ok,
  });

  return result;
}
