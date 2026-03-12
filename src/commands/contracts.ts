/**
 * Command System — Type Definitions
 *
 * Contracts for slash commands (/help), @mentions, and #references.
 * Frontend token-input.js sends tokens in chat:message payloads;
 * these types define how the server parses and dispatches them.
 */

import type { Bus } from '../core/bus.js';

// ─── Parsed Tokens (from frontend token-input.js) ───

export interface ParsedToken {
  type: 'command' | 'agent' | 'reference';
  char: string;         // '/', '@', '#'
  id: string;           // resolved ID or raw text
  label: string;        // display label
}

// ─── Command Definitions ───

export interface CommandContext {
  command: string;       // command name without slash
  args: string[];        // arguments after the command
  rawText: string;       // full original message text
  socketId: string;      // originating socket connection
  buildingId?: string;
  roomId?: string;
  agentId?: string;
  tokens: ParsedToken[];
  bus: Bus;              // for emitting events
}

export interface CommandResult {
  ok: boolean;
  response?: string;     // text to send back to user
  data?: unknown;
  silent?: boolean;      // don't send response to chat
}

export interface CommandDefinition {
  name: string;           // e.g. 'help', 'status', 'phase'
  description: string;
  usage: string;          // e.g. '/help [topic]'
  handler: (ctx: CommandContext) => CommandResult | Promise<CommandResult>;
  aliases?: string[];
  scope?: 'global' | 'room' | 'building';
}

// ─── Mention Results ───

export interface MentionResult {
  agentId: string;
  notified: boolean;
  response?: string;
}

// ─── Reference Results ───

export interface ReferenceResult {
  target: string;        // room name or entry ID
  resolved: boolean;
  content?: unknown;
}
