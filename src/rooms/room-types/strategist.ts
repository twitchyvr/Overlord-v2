/**
 * Strategist Office
 *
 * Strategy Floor — Phase Zero.
 * "What are you trying to build? What does success look like?"
 * Consultative setup of the entire building.
 *
 * Active behavior:
 * - validateExitDocumentValues: rejects empty goals/criteria/phases
 */

import { BaseRoom } from './base-room.js';
import { ok, err } from '../../core/contracts.js';
import type { Result, RoomContract } from '../../core/contracts.js';

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
    escalation: {},
    provider: 'configurable',
  };

  modes = {
    quickStart: 'Accept suggested template',
    advanced: 'Drag-and-drop rooms into floors, custom agents',
  };

  override getRules(): string[] {
    return [
      'You are the Strategist. Guide the user through project setup.',
      'Ask consultative questions: goals, success criteria, constraints.',
      'Suggest a building layout based on answers.',
      'Offer Quick Start (template) or Advanced (custom) mode.',
      'Your exit document configures the entire building.',
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
    };
  }

  override validateExitDocumentValues(document: Record<string, unknown>): Result {
    const projectGoals = document.projectGoals as unknown[];
    const successCriteria = document.successCriteria as unknown[];
    const floorsNeeded = document.floorsNeeded as unknown[];
    const roomConfig = document.roomConfig as unknown[];
    const agentRoster = document.agentRoster as unknown[];
    const estimatedPhases = document.estimatedPhases as unknown[];

    if (!Array.isArray(projectGoals) || projectGoals.length === 0) {
      return err('EXIT_DOC_INVALID', 'projectGoals must be a non-empty array');
    }
    if (!Array.isArray(successCriteria) || successCriteria.length === 0) {
      return err('EXIT_DOC_INVALID', 'successCriteria must be a non-empty array');
    }
    if (!Array.isArray(floorsNeeded) || floorsNeeded.length === 0) {
      return err('EXIT_DOC_INVALID', 'floorsNeeded must be a non-empty array');
    }
    if (!Array.isArray(roomConfig) || roomConfig.length === 0) {
      return err('EXIT_DOC_INVALID', 'roomConfig must be a non-empty array');
    }
    if (!Array.isArray(agentRoster) || agentRoster.length === 0) {
      return err('EXIT_DOC_INVALID', 'agentRoster must be a non-empty array');
    }
    if (!Array.isArray(estimatedPhases) || estimatedPhases.length === 0) {
      return err('EXIT_DOC_INVALID', 'estimatedPhases must be a non-empty array');
    }

    return ok(document);
  }
}
