/**
 * Base Room
 *
 * Abstract base class for all room types.
 * Rooms define: allowed tools, file scope, exit document template,
 * escalation rules, and table configurations.
 *
 * Key invariant: if a tool isn't in allowedTools, it does NOT EXIST
 * for any agent in this room. Structural enforcement, not instructional.
 */

import { ok, err } from '../../core/contracts.js';
import type { Result, RoomContract, FileScope, ExitTemplate } from '../../core/contracts.js';

export class BaseRoom {
  static contract: RoomContract = {
    roomType: 'base',
    floor: 'none',
    tables: { focus: { chairs: 1, description: 'Solo work' } },
    tools: [],
    fileScope: 'read-only',
    exitRequired: { type: 'generic', fields: [] },
    escalation: {},
    provider: 'configurable',
  };

  id: string;
  type: string;
  config: RoomContract;
  agents: Set<string>;

  constructor(id: string, config: Partial<RoomContract> = {}) {
    this.id = id;
    this.type = (this.constructor as typeof BaseRoom).contract.roomType;
    this.config = { ...(this.constructor as typeof BaseRoom).contract, ...config };
    this.agents = new Set();
  }

  /**
   * Get the tools available in this room.
   * This is THE access control mechanism — tools not in this list don't exist.
   */
  getAllowedTools(): string[] {
    return [...this.config.tools];
  }

  /**
   * Check if a specific tool is available in this room
   */
  hasTool(toolName: string): boolean {
    return this.config.tools.includes(toolName);
  }

  get fileScope(): FileScope {
    return this.config.fileScope;
  }

  get exitRequired(): ExitTemplate {
    return this.config.exitRequired;
  }

  get tables(): Record<string, { chairs: number; description: string }> {
    return this.config.tables;
  }

  /**
   * Validate an exit document against the room's required template
   */
  validateExitDocument(document: Record<string, unknown>): Result {
    const required = this.config.exitRequired;
    if (!required || !required.fields?.length) {
      return ok(document);
    }

    const missing = required.fields.filter((field) => !(field in document));
    if (missing.length > 0) {
      return err(
        'EXIT_DOC_INCOMPLETE',
        `Missing required fields: ${missing.join(', ')}`,
        { context: { required: required.fields, provided: Object.keys(document) } },
      );
    }

    return ok(document);
  }

  /**
   * Build the context injection for an agent entering this room.
   * This replaces v1's 200-line agent system prompts.
   */
  buildContextInjection(): Record<string, unknown> {
    return {
      roomType: this.type,
      rules: this.getRules(),
      tools: this.getAllowedTools(),
      fileScope: this.fileScope,
      exitTemplate: this.exitRequired,
      outputFormat: this.getOutputFormat(),
    };
  }

  /**
   * Override in subclasses to provide room-specific rules
   */
  getRules(): string[] {
    return [];
  }

  /**
   * Override in subclasses to provide structured output format
   */
  getOutputFormat(): unknown {
    return null;
  }
}
