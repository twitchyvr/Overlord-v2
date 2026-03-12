/**
 * Tool Executor
 *
 * Room-scoped tool execution. Validates tool access structurally
 * before executing. No tier system, no confidence scores.
 *
 * Binary: tool is in room's list -> execute. Not in list -> doesn't exist.
 */

import { logger } from '../core/logger.js';
import { executeInRoom } from './tool-registry.js';
import type { Result, BaseRoomLike } from '../core/contracts.js';
import type { Bus } from '../core/bus.js';

const log = logger.child({ module: 'tool-executor' });

interface ToolCall {
  name: string;
  input: Record<string, unknown>;
}

interface AgentRef {
  id: string;
}

export async function executeTool(params: {
  toolCall: ToolCall;
  room: BaseRoomLike;
  agent: AgentRef;
  bus: Bus;
  /** Building's project working directory — scopes file/shell tools */
  workingDirectory?: string;
}): Promise<Result> {
  const { name, input } = params.toolCall;
  const allowedTools = params.room.getAllowedTools();

  log.info({ tool: name, agent: params.agent.id, room: params.room.id, cwd: params.workingDirectory }, 'Executing tool');

  const result = await executeInRoom({
    toolName: name,
    params: input,
    roomAllowedTools: allowedTools,
    context: {
      roomId: params.room.id,
      roomType: params.room.type,
      agentId: params.agent.id,
      fileScope: params.room.fileScope,
      workingDirectory: params.workingDirectory,
    },
  });

  params.bus.emit('tool:executed', {
    toolName: name,
    roomId: params.room.id,
    agentId: params.agent.id,
    success: result.ok,
  });

  return result;
}
