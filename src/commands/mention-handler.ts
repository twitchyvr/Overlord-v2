/**
 * Mention Handler — @agent Processing
 *
 * Resolves @mentions from chat tokens, looks up agents by ID or name,
 * and emits agent:mentioned events on the bus for routing.
 */

import { logger } from '../core/logger.js';
import type { ParsedToken, CommandContext, MentionResult } from './contracts.js';
import type { AgentRegistryAPI, ParsedAgent } from '../core/contracts.js';

const log = logger.child({ module: 'mention-handler' });

let agentAPI: AgentRegistryAPI | null = null;

/**
 * Initialize the mention handler with the agent registry.
 */
export function initMentionHandler(agents: AgentRegistryAPI): void {
  agentAPI = agents;
  log.info('Mention handler initialized');
}

/**
 * Handle a single @mention token.
 *
 * 1. Look up the agent by ID (token.id) or fall back to name search (token.label)
 * 2. Emit agent:mentioned on the bus
 * 3. Return confirmation
 */
export async function handleMention(token: ParsedToken, ctx: CommandContext): Promise<MentionResult> {
  try {
    if (!agentAPI) {
      log.error('Mention handler not initialized — missing agent registry');
      return { agentId: token.id, notified: false, response: 'Agent system not available.' };
    }

    // Try direct ID lookup first
    let agent: ParsedAgent | null = agentAPI.getAgent(token.id);

    // Fall back to name-based search if ID didn't match
    if (!agent) {
      const allAgents = agentAPI.listAgents();
      const nameSearch = token.label.toLowerCase();
      agent = allAgents.find(a => a.name.toLowerCase() === nameSearch) || null;

      // Try partial match if exact name didn't work
      if (!agent) {
        agent = allAgents.find(a => a.name.toLowerCase().includes(nameSearch)) || null;
      }
    }

    if (!agent) {
      log.warn({ tokenId: token.id, label: token.label }, 'Mentioned agent not found');
      return {
        agentId: token.id,
        notified: false,
        response: `Agent "${token.label}" not found.`,
      };
    }

    // Emit mention event on bus for the agent router to pick up
    ctx.bus.emit('agent:mentioned', {
      agentId: agent.id,
      agentName: agent.name,
      agentRole: agent.role,
      mentionedBy: ctx.socketId,
      roomId: ctx.roomId || null,
      buildingId: ctx.buildingId || null,
      rawText: ctx.rawText,
    });

    log.info({ agentId: agent.id, agentName: agent.name, socketId: ctx.socketId }, 'Agent mentioned');

    return {
      agentId: agent.id,
      notified: true,
      response: `Notified **${agent.name}** (${agent.role}).`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error({ error, tokenId: token.id }, 'Failed to handle mention');
    return {
      agentId: token.id,
      notified: false,
      response: `Failed to notify agent: ${message}`,
    };
  }
}
