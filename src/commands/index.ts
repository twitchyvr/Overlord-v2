/**
 * Command System — Public API
 *
 * Entry point for the Overlord v2 command parser.
 * Initializes all subsystems: command registry, built-in commands,
 * mention handler, and reference resolver.
 */

import { logger } from '../core/logger.js';
import type { Bus } from '../core/bus.js';
import type { RoomManagerAPI, AgentRegistryAPI, ToolRegistryAPI } from '../core/contracts.js';
import { registerBuiltinCommands } from './builtin-commands.js';
import { initMentionHandler } from './mention-handler.js';
import { initReferenceResolver } from './reference-resolver.js';

const log = logger.child({ module: 'commands' });

// Re-export types
export type {
  CommandDefinition,
  CommandContext,
  CommandResult,
  ParsedToken,
  MentionResult,
  ReferenceResult,
} from './contracts.js';

// Re-export registry functions
export {
  registerCommand,
  getCommand,
  listCommands,
  parseCommandText,
  dispatchCommand,
} from './command-registry.js';

// Re-export handlers
export { handleMention } from './mention-handler.js';
export { resolveReference } from './reference-resolver.js';

interface InitCommandsParams {
  bus: Bus;
  rooms: RoomManagerAPI;
  agents: AgentRegistryAPI;
  tools: ToolRegistryAPI;
}

/**
 * Initialize the entire command system.
 *
 * 1. Registers all built-in slash commands
 * 2. Initializes the @mention handler with the agent registry
 * 3. Initializes the #reference resolver with the room manager
 */
export function initCommands({ bus: _bus, rooms, agents, tools: _tools }: InitCommandsParams): void {
  try {
    // Register built-in /commands
    registerBuiltinCommands(rooms, agents);

    // Initialize @mention handling
    initMentionHandler(agents);

    // Initialize #reference resolving
    initReferenceResolver(rooms);

    log.info('Command system initialized');
  } catch (error) {
    log.error({ error }, 'Failed to initialize command system');
    throw error;
  }
}
