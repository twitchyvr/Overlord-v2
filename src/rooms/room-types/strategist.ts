/**
 * Strategist Office
 *
 * Strategy Floor — Phase Zero.
 * "What are you trying to build? What does success look like?"
 * Consultative setup of the entire building.
 *
 * Active behavior:
 * - validateExitDocumentValues: rejects empty goals/criteria/phases
 * - Quick Start templates: predefined building configs for common project types
 * - Escalation: onComplete → discovery (Phase Zero → Discovery transition)
 */

import { BaseRoom } from './base-room.js';
import { ok, err } from '../../core/contracts.js';
import type { Result, RoomContract } from '../../core/contracts.js';

// ─── Quick Start Templates ───

export interface BuildingTemplate {
  id: string;
  name: string;
  description: string;
  floorsNeeded: string[];
  roomConfig: Array<{ floor: string; rooms: string[] }>;
  agentRoster: Array<{ name: string; role: string; rooms: string[] }>;
  estimatedPhases: string[];
}

export const QUICK_START_TEMPLATES: ReadonlyArray<BuildingTemplate> = [
  {
    id: 'web-app',
    name: 'Web Application',
    description: 'Full-stack web app with frontend, backend, and deployment',
    floorsNeeded: ['strategy', 'collaboration', 'execution', 'governance', 'operations'],
    roomConfig: [
      { floor: 'collaboration', rooms: ['discovery', 'architecture'] },
      { floor: 'execution', rooms: ['code-lab', 'testing-lab'] },
      { floor: 'governance', rooms: ['review'] },
      { floor: 'operations', rooms: ['deploy'] },
    ],
    agentRoster: [
      { name: 'Lead Developer', role: 'developer', rooms: ['code-lab', 'testing-lab', 'architecture'] },
      { name: 'QA Engineer', role: 'tester', rooms: ['testing-lab', 'review'] },
      { name: 'DevOps Engineer', role: 'operator', rooms: ['deploy'] },
    ],
    estimatedPhases: ['discovery', 'architecture', 'execution', 'review', 'deploy'],
  },
  {
    id: 'microservices',
    name: 'Microservices Architecture',
    description: 'Distributed system with multiple services and integration testing',
    floorsNeeded: ['strategy', 'collaboration', 'execution', 'governance', 'operations', 'integration'],
    roomConfig: [
      { floor: 'collaboration', rooms: ['discovery', 'architecture'] },
      { floor: 'execution', rooms: ['code-lab', 'testing-lab'] },
      { floor: 'governance', rooms: ['review'] },
      { floor: 'operations', rooms: ['deploy'] },
      { floor: 'integration', rooms: ['testing-lab'] },
    ],
    agentRoster: [
      { name: 'System Architect', role: 'architect', rooms: ['architecture', 'discovery'] },
      { name: 'Backend Developer', role: 'developer', rooms: ['code-lab', 'testing-lab'] },
      { name: 'Integration Tester', role: 'tester', rooms: ['testing-lab', 'review'] },
      { name: 'Platform Engineer', role: 'operator', rooms: ['deploy', 'architecture'] },
    ],
    estimatedPhases: ['discovery', 'architecture', 'execution', 'review', 'deploy'],
  },
  {
    id: 'data-pipeline',
    name: 'Data Pipeline',
    description: 'ETL/data processing pipeline with validation and monitoring',
    floorsNeeded: ['strategy', 'collaboration', 'execution', 'governance', 'operations'],
    roomConfig: [
      { floor: 'collaboration', rooms: ['discovery', 'architecture'] },
      { floor: 'execution', rooms: ['code-lab', 'testing-lab'] },
      { floor: 'governance', rooms: ['review'] },
      { floor: 'operations', rooms: ['deploy'] },
    ],
    agentRoster: [
      { name: 'Data Engineer', role: 'developer', rooms: ['code-lab', 'architecture'] },
      { name: 'Data Analyst', role: 'analyst', rooms: ['discovery', 'testing-lab', 'review'] },
      { name: 'DevOps Engineer', role: 'operator', rooms: ['deploy'] },
    ],
    estimatedPhases: ['discovery', 'architecture', 'execution', 'review', 'deploy'],
  },
  {
    id: 'cli-tool',
    name: 'CLI Tool',
    description: 'Command-line application with focused scope',
    floorsNeeded: ['strategy', 'collaboration', 'execution', 'governance'],
    roomConfig: [
      { floor: 'collaboration', rooms: ['discovery', 'architecture'] },
      { floor: 'execution', rooms: ['code-lab', 'testing-lab'] },
      { floor: 'governance', rooms: ['review'] },
    ],
    agentRoster: [
      { name: 'Developer', role: 'developer', rooms: ['code-lab', 'testing-lab', 'architecture', 'discovery'] },
    ],
    estimatedPhases: ['discovery', 'architecture', 'execution', 'review'],
  },
  {
    id: 'api-service',
    name: 'API Service',
    description: 'REST/GraphQL API with authentication and documentation',
    floorsNeeded: ['strategy', 'collaboration', 'execution', 'governance', 'operations'],
    roomConfig: [
      { floor: 'collaboration', rooms: ['discovery', 'architecture'] },
      { floor: 'execution', rooms: ['code-lab', 'testing-lab'] },
      { floor: 'governance', rooms: ['review'] },
      { floor: 'operations', rooms: ['deploy'] },
    ],
    agentRoster: [
      { name: 'API Developer', role: 'developer', rooms: ['code-lab', 'testing-lab', 'architecture'] },
      { name: 'Security Reviewer', role: 'reviewer', rooms: ['review', 'testing-lab'] },
      { name: 'DevOps Engineer', role: 'operator', rooms: ['deploy'] },
    ],
    estimatedPhases: ['discovery', 'architecture', 'execution', 'review', 'deploy'],
  },
];

// ─── Room Definition ───

export class StrategistOffice extends BaseRoom {
  static override contract: RoomContract = {
    roomType: 'strategist',
    floor: 'strategy',
    tables: {
      consultation: { chairs: 2, description: 'Strategist + User' },
    },
    tools: [
      'web_search',
      'record_note',
      'recall_notes',
      'list_dir',
    ],
    fileScope: 'read-only',
    exitRequired: {
      type: 'building-blueprint',
      fields: [
        'projectGoals',
        'successCriteria',
        'floorsNeeded',
        'roomConfig',
        'agentRoster',
        'estimatedPhases',
      ],
    },
    escalation: {
      onComplete: 'discovery',
    },
    provider: 'configurable',
  };

  /**
   * Available setup modes for Phase Zero.
   * Quick Start: select from predefined templates.
   * Advanced: route to Building Architect room for custom layout.
   */
  modes = {
    quickStart: 'Select a predefined template and customize details',
    advanced: 'Route to Building Architect room for custom floor/room layout',
  };

  /**
   * Get available Quick Start templates.
   * Templates provide pre-configured building layouts for common project types.
   */
  static getTemplates(): ReadonlyArray<BuildingTemplate> {
    return QUICK_START_TEMPLATES;
  }

  /**
   * Get a specific template by ID.
   */
  static getTemplate(templateId: string): BuildingTemplate | undefined {
    return QUICK_START_TEMPLATES.find((t) => t.id === templateId);
  }

  /**
   * Build a blueprint from a template, merging user-provided goals and criteria.
   */
  static buildBlueprintFromTemplate(
    templateId: string,
    overrides: { projectGoals: string[]; successCriteria: string[] },
  ): Record<string, unknown> | null {
    const template = StrategistOffice.getTemplate(templateId);
    if (!template) return null;

    return {
      projectGoals: overrides.projectGoals,
      successCriteria: overrides.successCriteria,
      floorsNeeded: template.floorsNeeded,
      roomConfig: template.roomConfig,
      agentRoster: template.agentRoster,
      estimatedPhases: template.estimatedPhases,
      templateId: template.id,
      mode: 'quickStart',
    };
  }

  /**
   * Block write operations — Strategist is read-only consultation.
   */
  override onBeforeToolCall(toolName: string, _agentId: string, _input: Record<string, unknown>): Result {
    const WRITE_TOOLS = ['write_file', 'patch_file', 'bash'];
    if (WRITE_TOOLS.includes(toolName)) {
      return err('TOOL_BLOCKED', `${toolName} is not allowed in the Strategist Office — consultation only, no code changes`);
    }
    return ok(null);
  }

  override getRules(): string[] {
    return [
      'You are the Strategist. Guide the user through project setup.',
      'Ask consultative questions: goals, success criteria, constraints.',
      'Suggest a building layout based on answers.',
      'Offer Quick Start (template) or Advanced (custom) mode.',
      'Quick Start templates: web-app, microservices, data-pipeline, cli-tool, api-service.',
      'For Advanced mode, recommend routing to the Building Architect room.',
      'Your exit document configures the entire building.',
      'On completion, the system transitions to the Discovery phase.',
    ];
  }

  override getOutputFormat(): Record<string, unknown> {
    return {
      projectGoals: ['string'],
      successCriteria: ['string'],
      floorsNeeded: ['string'],
      roomConfig: [{ floor: 'string', rooms: ['string'] }],
      agentRoster: [{ name: 'string', role: 'string', rooms: ['string'] }],
      estimatedPhases: ['string'],
      templateId: 'string (optional — set if Quick Start was used)',
      mode: 'quickStart | advanced',
    };
  }

  override validateExitDocumentValues(document: Record<string, unknown>): Result {
    const projectGoals = document.projectGoals as unknown[];
    const successCriteria = document.successCriteria as unknown[];
    const floorsNeeded = document.floorsNeeded as unknown[];
    const roomConfig = document.roomConfig as unknown[];
    const agentRoster = document.agentRoster as unknown[];
    const estimatedPhases = document.estimatedPhases as unknown[];

    // ── projectGoals: non-empty array of strings ──
    if (!Array.isArray(projectGoals) || projectGoals.length === 0) {
      return err('EXIT_DOC_INVALID', 'projectGoals must be a non-empty array');
    }
    if (projectGoals.some((g) => typeof g !== 'string' || (g as string).length === 0)) {
      return err('EXIT_DOC_INVALID', 'Each projectGoal must be a non-empty string');
    }

    // ── successCriteria: non-empty array of strings ──
    if (!Array.isArray(successCriteria) || successCriteria.length === 0) {
      return err('EXIT_DOC_INVALID', 'successCriteria must be a non-empty array');
    }
    if (successCriteria.some((c) => typeof c !== 'string' || (c as string).length === 0)) {
      return err('EXIT_DOC_INVALID', 'Each successCriteria must be a non-empty string');
    }

    // ── floorsNeeded: non-empty array of strings ──
    if (!Array.isArray(floorsNeeded) || floorsNeeded.length === 0) {
      return err('EXIT_DOC_INVALID', 'floorsNeeded must be a non-empty array');
    }
    if (floorsNeeded.some((f) => typeof f !== 'string' || (f as string).length === 0)) {
      return err('EXIT_DOC_INVALID', 'Each floorsNeeded entry must be a non-empty string');
    }

    // ── roomConfig: non-empty array of { floor: string, rooms: string[] } ──
    if (!Array.isArray(roomConfig) || roomConfig.length === 0) {
      return err('EXIT_DOC_INVALID', 'roomConfig must be a non-empty array');
    }
    for (let i = 0; i < roomConfig.length; i++) {
      const rc = roomConfig[i] as Record<string, unknown> | undefined;
      if (!rc || typeof rc.floor !== 'string' || !Array.isArray(rc.rooms)) {
        return err('EXIT_DOC_INVALID', `roomConfig[${i}] must have 'floor' (string) and 'rooms' (array)`);
      }
    }

    // ── agentRoster: non-empty array of { name: string, role: string, rooms: string[] } ──
    if (!Array.isArray(agentRoster) || agentRoster.length === 0) {
      return err('EXIT_DOC_INVALID', 'agentRoster must be a non-empty array');
    }
    for (let i = 0; i < agentRoster.length; i++) {
      const agent = agentRoster[i] as Record<string, unknown> | undefined;
      if (!agent || typeof agent.name !== 'string' || typeof agent.role !== 'string' || !Array.isArray(agent.rooms)) {
        return err('EXIT_DOC_INVALID', `agentRoster[${i}] must have 'name' (string), 'role' (string), and 'rooms' (array)`);
      }
    }

    // ── estimatedPhases: non-empty array of strings ──
    if (!Array.isArray(estimatedPhases) || estimatedPhases.length === 0) {
      return err('EXIT_DOC_INVALID', 'estimatedPhases must be a non-empty array');
    }
    if (estimatedPhases.some((p) => typeof p !== 'string' || (p as string).length === 0)) {
      return err('EXIT_DOC_INVALID', 'Each estimatedPhases entry must be a non-empty string');
    }

    return ok(document);
  }
}
