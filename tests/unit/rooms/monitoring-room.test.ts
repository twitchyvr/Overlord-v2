import { describe, it, expect } from 'vitest';
import { MonitoringRoom } from '../../../src/rooms/room-types/monitoring.js';

describe('MonitoringRoom', () => {
  it('has correct room type and floor', () => { const c = MonitoringRoom.contract; expect(c.roomType).toBe('monitoring'); expect(c.floor).toBe('operations'); });
  it('has assigned file scope', () => { expect(MonitoringRoom.contract.fileScope).toBe('assigned'); });
  it('has 7 tools including bash and write', () => { const t = MonitoringRoom.contract.tools; expect(t).toHaveLength(7); expect(t).toContain('bash'); expect(t).toContain('write_file'); });
  it('requires monitoring-report with 4 fields', () => { const e = MonitoringRoom.contract.exitRequired; expect(e.type).toBe('monitoring-report'); expect(e.fields).toEqual(['metricsConfigured', 'alertsCreated', 'dashboardsSetup', 'recommendations']); });
  it('escalates to code-lab on failure', () => { expect(MonitoringRoom.contract.escalation).toEqual({ onFailure: 'code-lab' }); });
  it('getRules returns non-empty array', () => { expect(new MonitoringRoom('r1').getRules().length).toBeGreaterThan(0); });
  it('getRules mentions health checks', () => { expect(new MonitoringRoom('r1').getRules().some(r => r.includes('health checks'))).toBe(true); });
  it('getOutputFormat has expected fields', () => { const f = new MonitoringRoom('r1').getOutputFormat() as Record<string, unknown>; expect(f).toHaveProperty('metricsConfigured'); expect(f).toHaveProperty('alertsCreated'); expect(f).toHaveProperty('dashboardsSetup'); expect(f).toHaveProperty('recommendations'); });
  it('validates valid exit doc', () => { const r = new MonitoringRoom('r1').validateExitDocument({ metricsConfigured: [{n:'cpu'}], alertsCreated: [], dashboardsSetup: [], recommendations: ['x'] }); expect(r.ok).toBe(true); });
  it('rejects empty metricsConfigured', () => { const r = new MonitoringRoom('r1').validateExitDocument({ metricsConfigured: [], alertsCreated: [], dashboardsSetup: [], recommendations: [] }); expect(r.ok).toBe(false); });
  it('rejects missing fields', () => { const r = new MonitoringRoom('r1').validateExitDocument({ metricsConfigured: [{n:'x'}] }); expect(r.ok).toBe(false); });
});
