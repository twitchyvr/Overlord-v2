import { describe, it, expect } from 'vitest';
import { ResearchRoom } from '../../../src/rooms/room-types/research.js';

describe('ResearchRoom', () => {
  it('has correct room type and floor', () => { const c = ResearchRoom.contract; expect(c.roomType).toBe('research'); expect(c.floor).toBe('collaboration'); });
  it('has read-only file scope', () => { expect(ResearchRoom.contract.fileScope).toBe('read-only'); });
  it('has 7 research tools, no write tools', () => { const t = ResearchRoom.contract.tools; expect(t).toHaveLength(7); expect(t).toContain('web_search'); expect(t).not.toContain('write_file'); expect(t).not.toContain('patch_file'); });
  it('requires research-report with 4 fields', () => { const e = ResearchRoom.contract.exitRequired; expect(e.type).toBe('research-report'); expect(e.fields).toEqual(['findings', 'sources', 'recommendations', 'gaps']); });
  it('escalates to architecture', () => { expect(ResearchRoom.contract.escalation).toEqual({ onComplete: 'architecture' }); });
  it('getRules returns non-empty array', () => { expect(new ResearchRoom('r1').getRules().length).toBeGreaterThan(0); });
  it('getOutputFormat has expected fields', () => { const f = new ResearchRoom('r1').getOutputFormat() as Record<string, unknown>; expect(f).toHaveProperty('findings'); expect(f).toHaveProperty('sources'); expect(f).toHaveProperty('recommendations'); expect(f).toHaveProperty('gaps'); });
  it('validates valid exit doc', () => { const r = new ResearchRoom('r1').validateExitDocument({ findings: [{t:'a'}], sources: [{t:'b'}], recommendations: ['c'], gaps: ['d'] }); expect(r.ok).toBe(true); });
  it('rejects empty findings', () => { const r = new ResearchRoom('r1').validateExitDocument({ findings: [], sources: [{t:'b'}], recommendations: ['c'], gaps: [] }); expect(r.ok).toBe(false); });
  it('rejects empty sources', () => { const r = new ResearchRoom('r1').validateExitDocument({ findings: [{t:'a'}], sources: [], recommendations: ['c'], gaps: [] }); expect(r.ok).toBe(false); });
  it('blocks write_file', () => { const r = new ResearchRoom('r1').onBeforeToolCall('write_file', 'a1', {}); expect(r.ok).toBe(false); });
  it('blocks patch_file', () => { const r = new ResearchRoom('r1').onBeforeToolCall('patch_file', 'a1', {}); expect(r.ok).toBe(false); });
  it('allows read_file', () => { const r = new ResearchRoom('r1').onBeforeToolCall('read_file', 'a1', {}); expect(r.ok).toBe(true); });
});
