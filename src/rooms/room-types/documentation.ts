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
    tools: [
      'read_file', 'write_file', 'patch_file', 'list_dir',
      'web_search', 'fetch_webpage', 'session_note',
      // Documentation library tools (#814)
      'search_library', 'get_document', 'list_library',
      'get_document_toc', 'get_library_manifest',
      // Document format tools (#812)
      'read_pdf', 'read_docx',
      // Documentation specialist tools (#815)
      'validate_documentation',
    ],
    fileScope: 'assigned',
    exitRequired: {
      type: 'documentation-report',
      fields: [
        'documentsWritten', 'documentsUpdated', 'coverageAreas', 'remainingGaps',
        // Enhanced fields (#815)
        'changelogEntries', 'readmeSectionsUpdated', 'validationResults',
      ],
    },
    escalation: { onComplete: 'review' },
    provider: 'configurable',
  };

  override getRules(): string[] {
    return [
      'You are a Documentation Specialist in the Documentation Room.',
      'Your primary job is keeping all project documentation accurate, complete, and in sync with the codebase.',
      'Target audience is NON-TECHNICAL users unless the building config specifies otherwise.',
      // Documentation workflow rules (#815)
      'ALWAYS check the current code state before writing or updating documentation.',
      'Cross-reference CHANGELOG with recent git activity to ensure accuracy.',
      'Validate all code examples — they must reflect the current API and behavior.',
      'Ensure version numbers are consistent across README, CHANGELOG, and package files.',
      'Follow Keep a Changelog format for CHANGELOG.md: Added, Changed, Fixed, Removed, Security.',
      'When updating README: maintain existing structure, update version badges, keep examples current.',
      'When writing new docs: include practical examples, step-by-step instructions, and links to related docs.',
      'Use consistent formatting: headings, bullet points, code blocks with language tags.',
      'Your exit document must include validation results from the validate_documentation tool.',
    ];
  }

  override getOutputFormat(): Record<string, unknown> {
    return {
      documentsWritten: [{ path: 'string', description: 'string' }],
      documentsUpdated: [{ path: 'string', changesDescription: 'string' }],
      coverageAreas: ['string'],
      remainingGaps: ['string'],
      changelogEntries: [{ version: 'string', section: 'string', entry: 'string' }],
      readmeSectionsUpdated: ['string'],
      validationResults: {
        freshness: 'pass | warn | fail',
        completeness: 'pass | warn | fail',
        consistency: 'pass | warn | fail',
        details: ['string'],
      },
    };
  }

  override validateExitDocumentValues(document: Record<string, unknown>): Result {
    const documentsWritten = document.documentsWritten as unknown[];
    const documentsUpdated = document.documentsUpdated as unknown[];
    // At least one document must be written or updated
    const hasWritten = Array.isArray(documentsWritten) && documentsWritten.length > 0;
    const hasUpdated = Array.isArray(documentsUpdated) && documentsUpdated.length > 0;
    if (!hasWritten && !hasUpdated) {
      return err('EXIT_DOC_INVALID', 'At least one document must be written or updated (documentsWritten or documentsUpdated)');
    }
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
