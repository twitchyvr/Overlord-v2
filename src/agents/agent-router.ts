/**
 * Agent Router
 *
 * Routes user messages and tasks to the appropriate room and agent.
 * Replaces v1's delegate_to_agent with room-based routing.
 * The orchestrator decides which room handles a request based on phase + intent.
 */

import { logger } from '../core/logger.js';
import { ok } from '../core/contracts.js';
import type { Result } from '../core/contracts.js';

const log = logger.child({ module: 'agent-router' });

interface RouteMessageParams {
  buildingId: string;
  message: string;
  currentPhase: string;
  rooms: unknown;
  agents: unknown;
}

interface RouteMentionParams {
  agentName: string;
  roomId: string;
}

const phaseRoomMap: Record<string, string> = {
  strategy: 'strategist',
  discovery: 'discovery',
  architecture: 'architecture',
  execution: 'code-lab',
  review: 'review',
  deploy: 'deploy',
};

/**
 * Route a user message to the appropriate room
 */
export function routeMessage({ buildingId, message: _message, currentPhase }: RouteMessageParams): Result {
  const targetRoomType = phaseRoomMap[currentPhase] || 'code-lab';
  log.info({ buildingId, phase: currentPhase, targetRoom: targetRoomType }, 'Routing message');

  return ok({ roomType: targetRoomType, phase: currentPhase });
}

/**
 * Handle @-mention routing — page an agent to a room
 */
export function routeMention({ agentName, roomId }: RouteMentionParams): Result {
  log.info({ agentName, roomId }, 'Agent mentioned — routing to room');
  return ok({ agentName, roomId });
}

/**
 * Handle #room-reference — cross-room citations
 */
export function resolveReference(reference: string): Result {
  // Format: #room-name or #room-name:messageId or #raid:entryId
  const parts = reference.replace('#', '').split(':');
  const target = parts[0];
  const messageId = parts[1] || null;

  return ok({ target, messageId });
}
