/**
 * Command Registry — Registration + Dispatch
 *
 * Central registry for all slash commands. Supports name and alias lookup,
 * listing, and dispatching commands to their handlers with error boundaries.
 */

import { logger } from '../core/logger.js';
import type { CommandDefinition, CommandContext, CommandResult } from './contracts.js';

const log = logger.child({ module: 'command-registry' });

/** Map of command name → definition (includes aliases as keys) */
const commands = new Map<string, CommandDefinition>();

/** Canonical definitions only (no alias duplicates) */
const definitions: CommandDefinition[] = [];

/**
 * Register a command definition.
 * Registers the primary name and all aliases.
 */
export function registerCommand(def: CommandDefinition): void {
  try {
    const name = def.name.toLowerCase();

    if (commands.has(name)) {
      log.warn({ name }, 'Command already registered — overwriting');
    }

    commands.set(name, def);
    definitions.push(def);

    if (def.aliases) {
      for (const alias of def.aliases) {
        const aliasLower = alias.toLowerCase();
        if (commands.has(aliasLower)) {
          log.warn({ alias: aliasLower, command: name }, 'Alias collides with existing command — overwriting');
        }
        commands.set(aliasLower, def);
      }
    }

    log.info({ name, aliases: def.aliases || [] }, 'Command registered');
  } catch (error) {
    log.error({ error, name: def.name }, 'Failed to register command');
  }
}

/**
 * Look up a command by name or alias.
 */
export function getCommand(name: string): CommandDefinition | undefined {
  try {
    return commands.get(name.toLowerCase());
  } catch (error) {
    log.error({ error, name }, 'Failed to look up command');
    return undefined;
  }
}

/**
 * List all registered command definitions (canonical only, no alias dupes).
 */
export function listCommands(): CommandDefinition[] {
  return [...definitions];
}

/**
 * Parse command text into command name and arguments.
 * Returns null if the text doesn't start with '/'.
 *
 * Examples:
 *   '/help'           → { command: 'help', args: [] }
 *   '/raid risk'      → { command: 'raid', args: ['risk'] }
 *   '/status --json'  → { command: 'status', args: ['--json'] }
 *   'hello world'     → null
 */
export function parseCommandText(text: string): { command: string; args: string[] } | null {
  try {
    const trimmed = text.trim();
    if (!trimmed.startsWith('/')) return null;

    const parts = trimmed.slice(1).split(/\s+/).filter(Boolean);
    if (parts.length === 0) return null;

    const command = parts[0].toLowerCase();
    const args = parts.slice(1);

    return { command, args };
  } catch (error) {
    log.error({ error, text }, 'Failed to parse command text');
    return null;
  }
}

/**
 * Dispatch a command: look up handler by name, execute, return result.
 * Returns an error CommandResult if the command is not found or the handler throws.
 */
export async function dispatchCommand(ctx: CommandContext): Promise<CommandResult> {
  try {
    const def = getCommand(ctx.command);

    if (!def) {
      log.warn({ command: ctx.command, socketId: ctx.socketId }, 'Unknown command');
      return {
        ok: false,
        response: `Unknown command: /${ctx.command}. Type /help to see available commands.`,
      };
    }

    log.info({ command: ctx.command, args: ctx.args, socketId: ctx.socketId }, 'Dispatching command');
    const result = await def.handler(ctx);
    log.info({ command: ctx.command, ok: result.ok }, 'Command completed');

    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error({ error, command: ctx.command, socketId: ctx.socketId }, 'Command handler threw');
    return {
      ok: false,
      response: `Command /${ctx.command} failed: ${message}`,
    };
  }
}
