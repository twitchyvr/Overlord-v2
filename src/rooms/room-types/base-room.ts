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

export class BaseRoom {
  /** @type {import('../../core/contracts.js').RoomContractSchema} */
  static contract = {
    roomType: 'base',
    floor: 'none',
    tables: { focus: { chairs: 1, description: 'Solo work' } },
    tools: [],
    fileScope: 'read-only',
    exitRequired: { type: 'generic', fields: [] },
    escalation: {},
    provider: 'configurable',
  };

  constructor(id, config = {}) {
    this.id = id;
    this.type = this.constructor.contract.roomType;
    this.config = { ...this.constructor.contract, ...config };
    this.agents = new Set();
  }

  /**
   * Get the tools available in this room.
   * This is THE access control mechanism — tools not in this list don't exist.
   */
  getAllowedTools() {
    return [...this.config.tools];
  }

  /**
   * Check if a specific tool is available in this room
   * @param {string} toolName
   */
  hasTool(toolName) {
    return this.config.tools.includes(toolName);
  }

  get fileScope() {
    return this.config.fileScope;
  }

  get exitRequired() {
    return this.config.exitRequired;
  }

  get tables() {
    return this.config.tables;
  }

  /**
   * Validate an exit document against the room's required template
   * @param {object} document
   */
  validateExitDocument(document) {
    const required = this.config.exitRequired;
    if (!required || !required.fields?.length) {
      return ok(document);
    }

    const missing = required.fields.filter((field) => !(field in document));
    if (missing.length > 0) {
      return err(
        'EXIT_DOC_INCOMPLETE',
        `Missing required fields: ${missing.join(', ')}`,
        { context: { required: required.fields, provided: Object.keys(document) } }
      );
    }

    return ok(document);
  }

  /**
   * Build the context injection for an agent entering this room.
   * This replaces v1's 200-line agent system prompts.
   */
  buildContextInjection() {
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
  getRules() {
    return [];
  }

  /**
   * Override in subclasses to provide structured output format
   */
  getOutputFormat() {
    return null;
  }
}
