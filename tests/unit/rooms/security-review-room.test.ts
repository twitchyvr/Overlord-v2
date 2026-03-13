import { describe, it, expect } from 'vitest';
import { SecurityReviewRoom } from '../../../src/rooms/room-types/security-review.js';

describe('SecurityReviewRoom', () => {
  it('has correct room type and floor', () => { const c = SecurityReviewRoom.contract; expect(c.roomType).toBe('security-review'); expect(c.floor).toBe('governance'); });
  it('has read-only file scope', () => { expect(SecurityReviewRoom.contract.fileScope).toBe('read-only'); });
  it('has 6 tools, no write tools', () => { const t = SecurityReviewRoom.contract.tools; expect(t).toHaveLength(6); expect(t).toContain('bash'); expect(t).not.toContain('write_file'); expect(t).not.toContain('patch_file'); });
  it('requires security-report with 5 fields', () => { const e = SecurityReviewRoom.contract.exitRequired; expect(e.type).toBe('security-report'); expect(e.fields).toEqual(['vulnerabilities', 'riskLevel', 'recommendations', 'dependencyAudit', 'complianceChecks']); });
  it('escalates to war-room on critical, deploy on complete', () => { expect(SecurityReviewRoom.contract.escalation).toEqual({ onCritical: 'war-room', onComplete: 'deploy' }); });
  it('getRules returns non-empty array', () => { expect(new SecurityReviewRoom('r1').getRules().length).toBeGreaterThan(0); });
  it('getRules mentions OWASP', () => { expect(new SecurityReviewRoom('r1').getRules().some(r => r.includes('OWASP'))).toBe(true); });
  it('getOutputFormat has expected fields', () => { const f = new SecurityReviewRoom('r1').getOutputFormat() as Record<string, unknown>; expect(f).toHaveProperty('vulnerabilities'); expect(f).toHaveProperty('riskLevel'); expect(f).toHaveProperty('recommendations'); expect(f).toHaveProperty('dependencyAudit'); expect(f).toHaveProperty('complianceChecks'); });
  it('validates valid exit doc', () => { const r = new SecurityReviewRoom('r1').validateExitDocument({ vulnerabilities: [{id:'CVE'}], riskLevel: 'high', recommendations: [{a:'x'}], dependencyAudit: {}, complianceChecks: [] }); expect(r.ok).toBe(true); });
  it('accepts empty vulnerabilities (clean scan)', () => { const r = new SecurityReviewRoom('r1').validateExitDocument({ vulnerabilities: [], riskLevel: 'low', recommendations: [{a:'scan'}], dependencyAudit: {}, complianceChecks: [] }); expect(r.ok).toBe(true); });
  it('rejects non-array vulnerabilities', () => { const r = new SecurityReviewRoom('r1').validateExitDocument({ vulnerabilities: 'none', riskLevel: 'low', recommendations: [{a:'x'}], dependencyAudit: {}, complianceChecks: [] }); expect(r.ok).toBe(false); });
  it('rejects empty riskLevel', () => { const r = new SecurityReviewRoom('r1').validateExitDocument({ vulnerabilities: [], riskLevel: '', recommendations: [{a:'x'}], dependencyAudit: {}, complianceChecks: [] }); expect(r.ok).toBe(false); });
  it('rejects empty recommendations', () => { const r = new SecurityReviewRoom('r1').validateExitDocument({ vulnerabilities: [], riskLevel: 'low', recommendations: [], dependencyAudit: {}, complianceChecks: [] }); expect(r.ok).toBe(false); });
  it('blocks write_file', () => { expect(new SecurityReviewRoom('r1').onBeforeToolCall('write_file', 'a1', {}).ok).toBe(false); });
  it('blocks patch_file', () => { expect(new SecurityReviewRoom('r1').onBeforeToolCall('patch_file', 'a1', {}).ok).toBe(false); });
  it('allows bash', () => { expect(new SecurityReviewRoom('r1').onBeforeToolCall('bash', 'a1', {}).ok).toBe(true); });
  it('allows read_file', () => { expect(new SecurityReviewRoom('r1').onBeforeToolCall('read_file', 'a1', {}).ok).toBe(true); });
});
