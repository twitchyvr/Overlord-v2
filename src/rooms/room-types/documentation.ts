import { BaseRoom } from './base-room.js';
import { ok, err } from '../../core/contracts.js';
import type { Result, RoomContract } from '../../core/contracts.js';

export class DocumentationRoom extends BaseRoom {
  static override contract: RoomContract = {
    roomType: 'documentation',
    floor: 'execution',
    tables: {
      focus: { chairs: 1, description: 'Solo documentation authoring' },
      collab: { chairs: 4, description: 'Multi-author documentation collaboration' },
    },
    tools: ['read_file', 'write_file', 'patch_file', 'list_dir', 'web_search', 'fetch_webpage', 'session_note'],
    fileScope: 'assigned',
    exitRequired: {
      type: 'documentation-report',
      fields: ['documentsWritten', 'documentsUpdated', 'coverageAreas', 'remainingGaps'],
    },
    escalation: { onComplete: 'review' },
    provider: 'configurable',
  };

  override getRules(): string[] {
    return [
      'You are in the Documentation Room. Write clear, comprehensive documentation.',
      'Target audience is NON-TECHNICAL users. Avoid jargon and technical implementation details.',
      'Update existing documentation before creating new files — reduce duplication.',
      'Include practical examples in every document.',
      'Use consistent formatting: headings, bullet points, and step-by-step instructions.',
      'Your exit document must list all documents written and updated.',
    ];
  }

  override getOutputFormat(): Record<string, unknown> {
    return {
      documentsWritten: [{ path: 'string', description: 'string' }],
      documentsUpdated: [{ path: 'string', changesDescription: 'string' }],
      coverageAreas: ['string'],
      remainingGaps: ['string'],
    };
  }

  override validateExitDocumentValues(document: Record<string, unknown>): Result {
    const documentsWritten = document.documentsWritten as unknown[];
    if (!Array.isArray(documentsWritten) || documentsWritten.length === 0) return err('EXIT_DOC_INVALID', 'documentsWritten must be a non-empty array');
    return ok(document);
  }

  override onAfterToolCall(toolName: string, agentId: string, result: Result): void {
    if ((toolName === 'write_file' || toolName === 'patch_file') && !result.ok) {
      this.bus?.emit('room:escalation:suggested', {
        roomId: this.id, roomType: this.type, agentId,
        condition: 'onComplete', targetRoom: this.escalation.onComplete || 'review',
        reason: `Documentation write operation failed: ${result.error.message}`,
      });
    }
  }
}
