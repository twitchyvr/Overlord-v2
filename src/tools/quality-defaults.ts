/**
 * Quality Defaults Configuration
 *
 * Provides centralized quality gate configuration.
 * Reads directly from process.env so runtime changes (via socket handler)
 * take effect immediately without requiring config re-validation.
 */

export interface QualityConfig {
  autoLint: boolean;
  autoTypecheck: boolean;
  autoTest: boolean;
  autoSecurityScan: boolean;
  minCoverage: number;
}

function envBool(key: string, defaultVal: boolean): boolean {
  const val = process.env[key];
  if (val === undefined || val === '') return defaultVal;
  return val === 'true' || val === '1';
}

function envNumber(key: string, defaultVal: number): number {
  const val = process.env[key];
  if (val === undefined || val === '') return defaultVal;
  const num = Number(val);
  return Number.isNaN(num) ? defaultVal : num;
}

export function getQualityConfig(): QualityConfig {
  return {
    autoLint: envBool('QUALITY_AUTO_LINT', true),
    autoTypecheck: envBool('QUALITY_AUTO_TYPECHECK', true),
    autoTest: envBool('QUALITY_AUTO_TEST', true),
    autoSecurityScan: envBool('QUALITY_AUTO_SECURITY_SCAN', false),
    minCoverage: envNumber('QUALITY_MIN_COVERAGE', 0),
  };
}

export function shouldRunCheck(check: 'lint' | 'typecheck' | 'test' | 'security'): boolean {
  const cfg = getQualityConfig();
  switch (check) {
    case 'lint':
      return cfg.autoLint;
    case 'typecheck':
      return cfg.autoTypecheck;
    case 'test':
      return cfg.autoTest;
    case 'security':
      return cfg.autoSecurityScan;
    default:
      return false;
  }
}
