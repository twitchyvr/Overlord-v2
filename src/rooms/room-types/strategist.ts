/**
 * Strategist Office
 *
 * Strategy Floor — Phase Zero.
 * "What are you trying to build? What does success look like?"
 * Consultative setup of the entire building.
 */

import { BaseRoom } from './base-room.js';

export class StrategistOffice extends BaseRoom {
  static contract = {
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
    provider: 'smart',
  };

  modes = {
    quickStart: 'Accept suggested template',
    advanced: 'Drag-and-drop rooms into floors, custom agents',
  };

  getRules() {
    return [
      'You are the Strategist. Guide the user through project setup.',
      'Ask consultative questions: goals, success criteria, constraints.',
      'Suggest a building layout based on answers.',
      'Offer Quick Start (template) or Advanced (custom) mode.',
      'Your exit document configures the entire building.',
    ];
  }

  getOutputFormat() {
    return {
      projectGoals: ['string'],
      successCriteria: ['string'],
      floorsNeeded: ['string'],
      roomConfig: [{ floor: 'string', rooms: ['string'] }],
      agentRoster: [{ name: 'string', role: 'string', rooms: ['string'] }],
      estimatedPhases: ['string'],
    };
  }
}
