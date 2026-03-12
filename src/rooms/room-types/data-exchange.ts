/**
 * Data Exchange Room
 *
 * Integration Floor — External data ingestion, transformation, and export.
 * Handles data flow from external sources through transformation pipelines
 * and out to target systems. Schema validation ensures data integrity.
 *
 * Active behavior:
 * - validateExitDocumentValues: rejects empty sources/transformations/outputs
 * - onAfterToolCall: detects data validation failures and suggests escalation
 */

import { BaseRoom } from './base-room.js';
import { ok, err } from '../../core/contracts.js';
import type { Result, RoomContract } from '../../core/contracts.js';

export class DataExchangeRoom extends BaseRoom {
  static override contract: RoomContract = {
    roomType: 'data-exchange',
    floor: 'integration',
    tables: {
      ingestion: { chairs: 2, description: 'Data source ingestion and normalization' },
      transformation: { chairs: 4, description: 'Data transformation and mapping pipelines' },
      export: { chairs: 2, description: 'Data export and delivery to targets' },
    },
    tools: [
      'fetch_url',
      'transform_data',
      'export_data',
      'validate_schema',
    ],
    fileScope: 'assigned',
    exitRequired: {
      type: 'data-flow-summary',
      fields: [
        'sources',
        'transformationsApplied',
        'outputs',
        'validationResults',
      ],
    },
    escalation: {
      onError: 'war-room',
      onScopeChange: 'discovery',
    },
    provider: 'configurable',
  };

  override getRules(): string[] {
    return [
      'You are in the Data Exchange room. Manage external data flows.',
      'Validate all incoming data against schemas before processing.',
      'Apply transformations in documented, reproducible steps.',
      'Verify output data integrity before export.',
      'If schema validation fails repeatedly, escalate to War Room.',
      'Your exit document must summarize all sources, transformations, outputs, and validation results.',
    ];
  }

  override getOutputFormat(): Record<string, unknown> {
    return {
      sources: [{ name: 'string', type: 'string', recordCount: 'number' }],
      transformationsApplied: [{ step: 'string', description: 'string', recordsAffected: 'number' }],
      outputs: [{ target: 'string', format: 'string', recordCount: 'number' }],
      validationResults: { passed: 'number', failed: 'number', errors: ['string'] },
    };
  }

  /**
   * Value validation for data flow summaries.
   * - sources must be a non-empty array
   * - transformationsApplied must be an array (can be empty for pass-through)
   * - outputs must be a non-empty array
   * - validationResults must be an object with passed/failed counts
   */
  override validateExitDocumentValues(document: Record<string, unknown>): Result {
    const sources = document.sources as unknown[];
    const transformationsApplied = document.transformationsApplied;
    const outputs = document.outputs as unknown[];
    const validationResults = document.validationResults as Record<string, unknown> | undefined;

    if (!Array.isArray(sources) || sources.length === 0) {
      return err('EXIT_DOC_INVALID', 'sources must be a non-empty array');
    }
    if (!Array.isArray(transformationsApplied)) {
      return err('EXIT_DOC_INVALID', 'transformationsApplied must be an array');
    }
    if (!Array.isArray(outputs) || outputs.length === 0) {
      return err('EXIT_DOC_INVALID', 'outputs must be a non-empty array');
    }
    if (!validationResults || typeof validationResults !== 'object') {
      return err('EXIT_DOC_INVALID', 'validationResults must be an object with passed and failed counts');
    }
    if (typeof validationResults.passed !== 'number' || typeof validationResults.failed !== 'number') {
      return err('EXIT_DOC_INVALID', 'validationResults must include numeric passed and failed counts');
    }

    return ok(document);
  }

  /**
   * After tool call: detect data validation failures and suggest escalation.
   */
  override onAfterToolCall(toolName: string, agentId: string, result: Result): void {
    if (toolName === 'validate_schema' && !result.ok) {
      this.bus?.emit('room:escalation:suggested', {
        roomId: this.id,
        roomType: this.type,
        agentId,
        condition: 'onError',
        targetRoom: this.escalation.onError || 'war-room',
        reason: `Schema validation failed: ${result.error.message}`,
      });
    }
    if (toolName === 'fetch_url' && !result.ok) {
      this.bus?.emit('room:escalation:suggested', {
        roomId: this.id,
        roomType: this.type,
        agentId,
        condition: 'onError',
        targetRoom: this.escalation.onError || 'war-room',
        reason: `Data fetch failed: ${result.error.message}`,
      });
    }
  }
}
