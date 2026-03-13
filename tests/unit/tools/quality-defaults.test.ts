/**
 * Quality Defaults Configuration Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getQualityConfig, shouldRunCheck } from '../../../src/tools/quality-defaults.js';

describe('Quality Defaults', () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of ['QUALITY_AUTO_LINT', 'QUALITY_AUTO_TYPECHECK', 'QUALITY_AUTO_TEST', 'QUALITY_AUTO_SECURITY_SCAN', 'QUALITY_MIN_COVERAGE']) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const [key, val] of Object.entries(savedEnv)) {
      if (val === undefined) delete process.env[key];
      else process.env[key] = val;
    }
  });

  describe('getQualityConfig', () => {
    it('returns correct default values', () => {
      const cfg = getQualityConfig();
      expect(cfg.autoLint).toBe(true);
      expect(cfg.autoTypecheck).toBe(true);
      expect(cfg.autoTest).toBe(true);
      expect(cfg.autoSecurityScan).toBe(false);
      expect(cfg.minCoverage).toBe(0);
    });

    it('reflects changed env values for lint', () => {
      process.env.QUALITY_AUTO_LINT = 'false';
      const cfg = getQualityConfig();
      expect(cfg.autoLint).toBe(false);
    });

    it('reflects changed env values for security scan', () => {
      process.env.QUALITY_AUTO_SECURITY_SCAN = 'true';
      const cfg = getQualityConfig();
      expect(cfg.autoSecurityScan).toBe(true);
    });

    it('reflects changed env values for min coverage', () => {
      process.env.QUALITY_MIN_COVERAGE = '80';
      const cfg = getQualityConfig();
      expect(cfg.minCoverage).toBe(80);
    });
  });

  describe('shouldRunCheck', () => {
    it('returns true for enabled lint check', () => {
      expect(shouldRunCheck('lint')).toBe(true);
    });

    it('returns true for enabled typecheck', () => {
      expect(shouldRunCheck('typecheck')).toBe(true);
    });

    it('returns true for enabled test check', () => {
      expect(shouldRunCheck('test')).toBe(true);
    });

    it('returns false for disabled security check by default', () => {
      expect(shouldRunCheck('security')).toBe(false);
    });

    it('returns false when lint is disabled', () => {
      process.env.QUALITY_AUTO_LINT = 'false';
      expect(shouldRunCheck('lint')).toBe(false);
    });

    it('returns true when security is enabled', () => {
      process.env.QUALITY_AUTO_SECURITY_SCAN = 'true';
      expect(shouldRunCheck('security')).toBe(true);
    });
  });
});
