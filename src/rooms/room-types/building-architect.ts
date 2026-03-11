/**
 * Building Architect
 *
 * Strategy Floor — Phase Zero (Advanced mode).
 * "Let's design your building from scratch."
 * Custom building layout instead of accepting a Quick Start template.
 *
 * Receives the Strategist exit doc as context — project goals, success criteria,
 * and constraints are already defined. The Building Architect translates those
 * into a concrete floor plan, room assignments, agent definitions, tool
 * overrides, and phase execution order.
 *
 * Active behavior:
 * - validateExitDocumentValues: rejects empty/malformed floors, room
 *   assignments, agent definitions, and phase config
 */

import { BaseRoom } from './base-room.js';
import { ok, err } from '../../core/contracts.js';
import type { Result, RoomContract } from '../../core/contracts.js';

export class BuildingArchitect extends BaseRoom {
  static override contract: RoomContract = {
    roomType: 'building-architect',
    floor: 'strategy',
    tables: {
      workshop: { chairs: 3, description: 'Architect + User + Advisor' },
    },
    tools: [
      'web_search',
      'record_note',
      'recall_notes',
      'list_dir',
      'read_file',
    ],
    fileScope: 'read-only',
    exitRequired: {
      type: 'custom-building-plan',
      fields: [
        'floors',
        'roomAssignments',
        'agentDefinitions',
        'toolOverrides',
        'phaseConfig',
      ],
    },
    escalation: {
      onComplete: 'discovery',
    },
    provider: 'configurable',
  };

  override getRules(): string[] {
    return [
      'You are the Building Architect. Design a custom building layout for the project.',
      'Review the Strategist exit document for project goals, success criteria, and constraints.',
      'Suggest custom floor configurations — each floor has a type and descriptive name.',
      'Define room assignments per floor: which room types go where, with optional config.',
      'Create agent role definitions: name, role, capabilities, and room access permissions.',
      'Configure per-room tool overrides when the defaults need adjustment.',
      'Set up the phase execution order — which phases to include and in what sequence.',
      'Your exit document becomes the custom building plan used to bootstrap the entire building.',
    ];
  }

  override getOutputFormat(): Record<string, unknown> {
    return {
      floors: [{ type: 'string', name: 'string' }],
      roomAssignments: [{ floor: 'string', roomType: 'string', roomName: 'string', config: 'object | undefined' }],
      agentDefinitions: [{ name: 'string', role: 'string', capabilities: ['string'], roomAccess: ['string'] }],
      toolOverrides: [{ roomName: 'string', add: ['string'], remove: ['string'] }],
      phaseConfig: ['string'],
    };
  }

  override validateExitDocumentValues(document: Record<string, unknown>): Result {
    // ── floors ──
    const floors = document.floors as unknown[];
    if (!Array.isArray(floors) || floors.length === 0) {
      return err('EXIT_DOC_INVALID', 'floors must be a non-empty array');
    }
    for (let i = 0; i < floors.length; i++) {
      const floor = floors[i] as Record<string, unknown> | undefined;
      if (!floor || typeof floor.type !== 'string' || typeof floor.name !== 'string') {
        return err('EXIT_DOC_INVALID', `floors[${i}] must have 'type' (string) and 'name' (string)`);
      }
    }

    // ── roomAssignments ──
    const roomAssignments = document.roomAssignments as unknown[];
    if (!Array.isArray(roomAssignments) || roomAssignments.length === 0) {
      return err('EXIT_DOC_INVALID', 'roomAssignments must be a non-empty array');
    }
    for (let i = 0; i < roomAssignments.length; i++) {
      const ra = roomAssignments[i] as Record<string, unknown> | undefined;
      if (
        !ra ||
        typeof ra.floor !== 'string' ||
        typeof ra.roomType !== 'string' ||
        typeof ra.roomName !== 'string'
      ) {
        return err(
          'EXIT_DOC_INVALID',
          `roomAssignments[${i}] must have 'floor' (string), 'roomType' (string), and 'roomName' (string)`,
        );
      }
    }

    // ── agentDefinitions ──
    const agentDefinitions = document.agentDefinitions as unknown[];
    if (!Array.isArray(agentDefinitions) || agentDefinitions.length === 0) {
      return err('EXIT_DOC_INVALID', 'agentDefinitions must be a non-empty array');
    }
    for (let i = 0; i < agentDefinitions.length; i++) {
      const agent = agentDefinitions[i] as Record<string, unknown> | undefined;
      if (!agent || typeof agent.name !== 'string' || typeof agent.role !== 'string') {
        return err(
          'EXIT_DOC_INVALID',
          `agentDefinitions[${i}] must have 'name' (string) and 'role' (string)`,
        );
      }
    }

    // ── toolOverrides ──
    const toolOverrides = document.toolOverrides as unknown[];
    if (!Array.isArray(toolOverrides)) {
      return err('EXIT_DOC_INVALID', 'toolOverrides must be an array (can be empty)');
    }
    for (let i = 0; i < toolOverrides.length; i++) {
      const ov = toolOverrides[i] as Record<string, unknown> | undefined;
      if (
        !ov ||
        typeof ov.roomName !== 'string' ||
        !Array.isArray(ov.add) ||
        !Array.isArray(ov.remove)
      ) {
        return err(
          'EXIT_DOC_INVALID',
          `toolOverrides[${i}] must have 'roomName' (string), 'add' (array), and 'remove' (array)`,
        );
      }
    }

    // ── phaseConfig ──
    const phaseConfig = document.phaseConfig as unknown[];
    if (!Array.isArray(phaseConfig) || phaseConfig.length === 0) {
      return err('EXIT_DOC_INVALID', 'phaseConfig must be a non-empty array');
    }
    for (let i = 0; i < phaseConfig.length; i++) {
      if (typeof phaseConfig[i] !== 'string' || (phaseConfig[i] as string).length === 0) {
        return err('EXIT_DOC_INVALID', `phaseConfig[${i}] must be a non-empty string`);
      }
    }

    return ok(document);
  }
}
