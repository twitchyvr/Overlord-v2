import { describe, it, expect } from 'vitest';
import { DocumentationRoom } from '../../../src/rooms/room-types/documentation.js';

describe('DocumentationRoom', () => {
  it('has correct room type and floor', () => { const c = DocumentationRoom.contract; expect(c.roomType).toBe('documentation'); expect(c.floor).toBe('execution'); });
  it('has assigned file scope', () => { expect(DocumentationRoom.contract.fileScope).toBe('assigned'); });
  it('has 7 tools including write access', () => { const t = DocumentationRoom.contract.tools; expect(t).toHaveLength(7); expect(t).toContain('write_file'); expect(t).toContain('patch_file'); expect(t).not.toContain('bash'); });
  it('requires documentation-report with 4 fields', () => { const e = DocumentationRoom.contract.exitRequired; expect(e.type).toBe('documentation-report'); expect(e.fields).toEqual(['documentsWritten', 'documentsUpdated', 'coverageAreas', 'remainingGaps']); });
  it('escalates to review', () => { expect(DocumentationRoom.contract.escalation).toEqual({ onComplete: 'review' }); });
  it('getRules returns non-empty array', () => { expect(new DocumentationRoom('r1').getRules().length).toBeGreaterThan(0); });
  it('getRules mentions NON-TECHNICAL', () => { expect(new DocumentationRoom('r1').getRules().some(r => r.includes('NON-TECHNICAL'))).toBe(true); });
  it('getOutputFormat has expected fields', () => { const f = new DocumentationRoom('r1').getOutputFormat() as Record<string, unknown>; expect(f).toHaveProperty('documentsWritten'); expect(f).toHaveProperty('documentsUpdated'); expect(f).toHaveProperty('coverageAreas'); expect(f).toHaveProperty('remainingGaps'); });
  it('validates valid exit doc', () => { const r = new DocumentationRoom('r1').validateExitDocument({ documentsWritten: [{p:'a'}], documentsUpdated: [], coverageAreas: ['x'], remainingGaps: [] }); expect(r.ok).toBe(true); });
  it('rejects empty documentsWritten', () => { const r = new DocumentationRoom('r1').validateExitDocument({ documentsWritten: [], documentsUpdated: [], coverageAreas: [], remainingGaps: [] }); expect(r.ok).toBe(false); });
  it('rejects missing fields', () => { const r = new DocumentationRoom('r1').validateExitDocument({ documentsWritten: [{p:'a'}] }); expect(r.ok).toBe(false); });
});
