/**
 * Agent Router
 *
 * Routes user messages and tasks to the appropriate room and agent.
 * Replaces v1's delegate_to_agent with room-based routing.
 * The orchestrator decides which room handles a request based on phase + intent.
 */

import { logger } from '../core/logger.js';
import { ok, err } from '../core/contracts.js';

const log = logger.child({ module: 'agent-router' });

/**
 * Route a user message to the appropriate room
 * @param {object} params
 * @param {string} params.buildingId - Current building
 * @param {string} params.message - User's message
 * @param {string} params.currentPhase - Current project phase
 * @param {object} params.rooms - Room manager instance
 * @param {object} params.agents - Agent registry instance
 */
export function routeMessage({ buildingId, message, currentPhase, rooms, agents }) {
  // Phase → default room mapping
  const phaseRoomMap = {
    strategy: 'strategist',
    discovery: 'discovery',
    architecture: 'architecture',
    execution: 'code-lab',
    review: 'review',
    deploy: 'deploy',
  };

  const targetRoomType = phaseRoomMap[currentPhase] || 'code-lab';
  log.info({ buildingId, phase: currentPhase, targetRoom: targetRoomType }, 'Routing message');

  return ok({ roomType: targetRoomType, phase: currentPhase });
}

/**
 * Handle @-mention routing — page an agent to a room
 */
export function routeMention({ agentName, roomId }) {
  log.info({ agentName, roomId }, 'Agent mentioned — routing to room');
  return ok({ agentName, roomId });
}

/**
 * Handle #room-reference — cross-room citations
 */
export function resolveReference(reference) {
  // Format: #room-name or #room-name:messageId or #raid:entryId
  const parts = reference.replace('#', '').split(':');
  const target = parts[0];
  const messageId = parts[1] || null;

  return ok({ target, messageId });
}
