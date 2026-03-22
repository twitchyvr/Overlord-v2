import { describe, it, expect } from 'vitest';
import { DocumentationRoom } from '../../../src/rooms/room-types/documentation.js';

describe('DocumentationRoom', () => {
  it('has correct room type and floor', () => { const c = DocumentationRoom.contract; expect(c.roomType).toBe('documentation'); expect(c.floor).toBe('execution'); });
  it('has assigned file scope', () => { expect(DocumentationRoom.contract.fileScope).toBe('assigned'); });
  it('has documentation tools including write access and library tools (#815)', () => {
    const t = DocumentationRoom.contract.tools;
    expect(t).toContain('write_file');
    expect(t).toContain('patch_file');
    expect(t).toContain('search_library');
    expect(t).toContain('get_document_toc');
    expect(t).toContain('validate_documentation');
    expect(t).not.toContain('bash');
    expect(t.length).toBeGreaterThanOrEqual(12);
  });
  it('requires documentation-report with enhanced fields (#815)', () => {
    const e = DocumentationRoom.contract.exitRequired;
    expect(e.type).toBe('documentation-report');
    expect(e.fields).toContain('documentsWritten');
    expect(e.fields).toContain('documentsUpdated');
    expect(e.fields).toContain('coverageAreas');
    expect(e.fields).toContain('remainingGaps');
    expect(e.fields).toContain('changelogEntries');
    expect(e.fields).toContain('readmeSectionsUpdated');
    expect(e.fields).toContain('validationResults');
  });
  it('escalates to review', () => { expect(DocumentationRoom.contract.escalation).toEqual({ onComplete: 'review' }); });
  it('getRules returns documentation specialist rules (#815)', () => {
    const rules = new DocumentationRoom('r1').getRules();
    expect(rules.length).toBeGreaterThan(5);
    expect(rules.some(r => r.includes('Documentation Specialist'))).toBe(true);
    expect(rules.some(r => r.includes('Keep a Changelog'))).toBe(true);
    expect(rules.some(r => r.includes('validate_documentation'))).toBe(true);
  });
  it('getRules mentions NON-TECHNICAL', () => { expect(new DocumentationRoom('r1').getRules().some(r => r.includes('NON-TECHNICAL'))).toBe(true); });
  it('getOutputFormat has enhanced fields (#815)', () => {
    const f = new DocumentationRoom('r1').getOutputFormat() as Record<string, unknown>;
    expect(f).toHaveProperty('documentsWritten');
    expect(f).toHaveProperty('documentsUpdated');
    expect(f).toHaveProperty('coverageAreas');
    expect(f).toHaveProperty('remainingGaps');
    expect(f).toHaveProperty('changelogEntries');
    expect(f).toHaveProperty('readmeSectionsUpdated');
    expect(f).toHaveProperty('validationResults');
  });
  it('validates exit doc with documents written', () => { const r = new DocumentationRoom('r1').validateExitDocument({ documentsWritten: [{p:'a'}], documentsUpdated: [], coverageAreas: ['x'], remainingGaps: [], changelogEntries: [], readmeSectionsUpdated: [], validationResults: {} }); expect(r.ok).toBe(true); });
  it('validates exit doc with documents updated only (#815)', () => { const r = new DocumentationRoom('r1').validateExitDocument({ documentsWritten: [], documentsUpdated: [{p:'a', changes:'updated'}], coverageAreas: ['x'], remainingGaps: [], changelogEntries: [], readmeSectionsUpdated: [], validationResults: {} }); expect(r.ok).toBe(true); });
  it('rejects exit doc with no writes and no updates', () => { const r = new DocumentationRoom('r1').validateExitDocument({ documentsWritten: [], documentsUpdated: [], coverageAreas: [], remainingGaps: [], changelogEntries: [], readmeSectionsUpdated: [], validationResults: {} }); expect(r.ok).toBe(false); });
  it('rejects missing fields', () => { const r = new DocumentationRoom('r1').validateExitDocument({ documentsWritten: [{p:'a'}] }); expect(r.ok).toBe(false); });
});
