import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getQualityConfig, shouldRunCheck } from '../../../src/tools/quality-defaults.js';
describe('Quality Defaults', () => {
  const savedEnv: Record<string, string | undefined> = {};
  beforeEach(() => { for (const key of ['QUALITY_AUTO_LINT', 'QUALITY_AUTO_TYPECHECK', 'QUALITY_AUTO_TEST', 'QUALITY_AUTO_SECURITY_SCAN', 'QUALITY_MIN_COVERAGE']) { savedEnv[key] = process.env[key]; delete process.env[key]; } });
  afterEach(() => { for (const [key, val] of Object.entries(savedEnv)) { if (val === undefined) delete process.env[key]; else process.env[key] = val; } });
  describe('getQualityConfig', () => {
    it('defaults', () => { const cfg = getQualityConfig(); expect(cfg.autoLint).toBe(true); expect(cfg.autoTypecheck).toBe(true); expect(cfg.autoTest).toBe(true); expect(cfg.autoSecurityScan).toBe(false); expect(cfg.minCoverage).toBe(0); });
    it('lint false', () => { process.env.QUALITY_AUTO_LINT = 'false'; expect(getQualityConfig().autoLint).toBe(false); });
    it('security true', () => { process.env.QUALITY_AUTO_SECURITY_SCAN = 'true'; expect(getQualityConfig().autoSecurityScan).toBe(true); });
    it('coverage 80', () => { process.env.QUALITY_MIN_COVERAGE = '80'; expect(getQualityConfig().minCoverage).toBe(80); });
  });
  describe('shouldRunCheck', () => {
    it('lint true', () => { expect(shouldRunCheck('lint')).toBe(true); });
    it('typecheck true', () => { expect(shouldRunCheck('typecheck')).toBe(true); });
    it('test true', () => { expect(shouldRunCheck('test')).toBe(true); });
    it('security false', () => { expect(shouldRunCheck('security')).toBe(false); });
    it('lint disabled', () => { process.env.QUALITY_AUTO_LINT = 'false'; expect(shouldRunCheck('lint')).toBe(false); });
    it('security enabled', () => { process.env.QUALITY_AUTO_SECURITY_SCAN = 'true'; expect(shouldRunCheck('security')).toBe(true); });
  });
});
