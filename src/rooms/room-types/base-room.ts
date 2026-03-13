/**
 * Base Room
 *
 * Abstract base class for all room types.
 * Rooms define: allowed tools, file scope, exit document template,
 * escalation rules, and table configurations.
 *
 * Key invariant: if a tool isn't in allowedTools, it does NOT EXIST
 * for any agent in this room. Structural enforcement, not instructional.
 *
 * Rooms are ACTIVE participants in agent work via lifecycle hooks:
 * - onAgentEnter / onAgentExit — react to agent movement
 * - onBeforeToolCall — can block tool execution (room-level guardrails)
 * - onAfterToolCall — observe results, trigger escalation suggestions
 * - onMessage — observe conversation turns
 *
 * All hooks have no-op defaults. Subclasses override what they need.
 */

import { ok, err } from '../../core/contracts.js';
import type { Result, RoomContract, FileScope, ExitTemplate } from '../../core/contracts.js';
import type { Bus } from '../../core/bus.js';

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
  protected bus: Bus | null = null;

  constructor(id: string, config: Partial<RoomContract> = {}) {
    this.id = id;
    this.type = (this.constructor as typeof BaseRoom).contract.roomType;
    this.config = { ...(this.constructor as typeof BaseRoom).contract, ...config };
    this.agents = new Set();
  }

  /**
   * Inject the event bus so rooms can emit events.
   * Called by room-manager after construction.
   */
  setBus(bus: Bus): void {
    this.bus = bus;
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

  get escalation(): Record<string, string> {
    return this.config.escalation || {};
  }

  get tables(): Record<string, { chairs: number; description: string }> {
    return this.config.tables;
  }

  // ─── Exit Document Validation (two-phase: presence then values) ───

  /**
   * Validate an exit document against the room's required template.
   * Phase 1: check all required fields are present.
   * Phase 2: check field VALUES are meaningful (delegated to subclass).
   */
  validateExitDocument(document: Record<string, unknown>): Result {
    const required = this.config.exitRequired;
    if (!required || !required.fields?.length) {
      return ok(document);
    }

    // Phase 1: presence check
    const missing = required.fields.filter((field) => !(field in document));
    if (missing.length > 0) {
      return err(
        'EXIT_DOC_INCOMPLETE',
        `Missing required fields: ${missing.join(', ')}`,
        { context: { required: required.fields, provided: Object.keys(document) } },
      );
    }

    // Phase 2: value validation (subclasses override validateExitDocumentValues)
    return this.validateExitDocumentValues(document);
  }

  /**
   * Override in subclasses to validate exit document field VALUES.
   * Called after presence check passes. Return err() to reject.
   */
  validateExitDocumentValues(_document: Record<string, unknown>): Result {
    return ok(_document);
  }

  // ─── Context Injection ───

  /**
   * Build the context injection for an agent entering this room.
   * Includes escalation rules so the AI knows where to route problems.
   */
  buildContextInjection(): Record<string, unknown> {
    return {
      roomType: this.type,
      rules: this.getRules(),
      tools: this.getAllowedTools(),
      fileScope: this.fileScope,
      exitTemplate: this.exitRequired,
      outputFormat: this.getOutputFormat(),
      escalation: this.escalation,
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

  // ─── Lifecycle Hooks (override in subclasses) ───

  /**
   * Called when an agent enters this room.
   * Override to add entry validation, track agents, emit events.
   */
  onAgentEnter(agentId: string, _tableType: string): Result {
    this.agents.add(agentId);
    this.bus?.emit('room:agent:entered', { roomId: this.id, roomType: this.type, agentId, tableType: _tableType });
    this.bus?.emit('agent:status-changed', { agentId, status: 'active', roomId: this.id, roomType: this.type });
    return ok({ roomId: this.id, agentId });
  }

  /**
   * Called when an agent exits this room.
   * Override to add exit validation, cleanup, emit events.
   */
  onAgentExit(agentId: string): Result {
    this.agents.delete(agentId);
    this.bus?.emit('room:agent:exited', { roomId: this.id, roomType: this.type, agentId });
    this.bus?.emit('agent:status-changed', { agentId, status: 'idle', roomId: this.id, roomType: this.type });
    return ok({ roomId: this.id, agentId });
  }

  /**
   * Called BEFORE a tool executes. Return err() to BLOCK the call.
   * This is the room-level guardrail — beyond structural tool lists.
   * Example: CodeLab blocks write_file to paths outside assigned scope.
   */
  onBeforeToolCall(_toolName: string, _agentId: string, _input: Record<string, unknown>): Result {
    return ok(null);
  }

  /**
   * Called AFTER a tool executes. Observe results, suggest escalation.
   * Override to detect conditions (test failures, errors) and emit events.
   */
  onAfterToolCall(_toolName: string, _agentId: string, _result: Result): void {
    // No-op default
  }

  /**
   * Called for each conversation message (user or assistant turn).
   * Override to track conversation state or detect patterns.
   */
  onMessage(_agentId: string, _content: string, _role: 'user' | 'assistant'): void {
    // No-op default
  }
}
