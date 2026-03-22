/**
 * Documentation Validator (#815)
 *
 * Validates project documentation for freshness, completeness, and consistency.
 * Checks CHANGELOG.md, README.md, and other doc files against code state.
 *
 * Layer: Tools (depends on Core)
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ok, err } from '../../core/contracts.js';
import type { Result } from '../../core/contracts.js';

interface ValidationCheck {
  status: 'pass' | 'warn' | 'fail';
  details: string;
}

interface ValidationReport {
  freshness: ValidationCheck;
  completeness: ValidationCheck;
  consistency: ValidationCheck;
  issues: string[];
  suggestions: string[];
}

export function validateDocumentation(params: {
  workingDirectory: string;
  allowedPaths?: string[];
}): Result<ValidationReport> {
  const dir = params.workingDirectory;

  if (!existsSync(dir)) {
    return err('DIR_NOT_FOUND', `Working directory not found: ${dir}`);
  }

  const issues: string[] = [];
  const suggestions: string[] = [];

  // ── Freshness Check ──
  const freshness = checkFreshness(dir, issues, suggestions);

  // ── Completeness Check ──
  const completeness = checkCompleteness(dir, issues, suggestions);

  // ── Consistency Check ──
  const consistency = checkConsistency(dir, issues, suggestions);

  return ok({
    freshness,
    completeness,
    consistency,
    issues,
    suggestions,
  });
}

function checkFreshness(dir: string, issues: string[], suggestions: string[]): ValidationCheck {
  const readmePath = join(dir, 'README.md');
  const changelogPath = join(dir, 'CHANGELOG.md');
  const pkgPath = join(dir, 'package.json');

  let staleCount = 0;

  // Check if README exists and is recent
  if (existsSync(readmePath)) {
    const readmeStat = statSync(readmePath);
    const daysSinceModified = (Date.now() - readmeStat.mtimeMs) / (1000 * 60 * 60 * 24);
    if (daysSinceModified > 30) {
      staleCount++;
      issues.push(`README.md last modified ${Math.floor(daysSinceModified)} days ago — may be stale`);
    }
  }

  // Check CHANGELOG freshness relative to package.json
  if (existsSync(changelogPath) && existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      const changelog = readFileSync(changelogPath, 'utf-8');
      const version = pkg.version as string;
      if (version && !changelog.includes(version)) {
        staleCount++;
        issues.push(`CHANGELOG.md does not mention current package version ${version}`);
      }
    } catch { /* parse error — skip */ }
  }

  if (staleCount === 0) return { status: 'pass', details: 'Documentation appears up to date' };
  if (staleCount === 1) return { status: 'warn', details: `${staleCount} freshness issue detected` };
  return { status: 'fail', details: `${staleCount} freshness issues detected` };
}

function checkCompleteness(dir: string, issues: string[], suggestions: string[]): ValidationCheck {
  let missingCount = 0;

  // Essential files
  const essentialFiles = [
    { path: 'README.md', suggestion: 'Create a README.md with project overview, installation, and usage instructions' },
    { path: 'CHANGELOG.md', suggestion: 'Create a CHANGELOG.md following Keep a Changelog format' },
  ];

  for (const file of essentialFiles) {
    if (!existsSync(join(dir, file.path))) {
      missingCount++;
      issues.push(`Missing ${file.path}`);
      suggestions.push(file.suggestion);
    }
  }

  // Check README sections if it exists
  const readmePath = join(dir, 'README.md');
  if (existsSync(readmePath)) {
    try {
      const readme = readFileSync(readmePath, 'utf-8').toLowerCase();
      const expectedSections = [
        { pattern: /install|setup|getting started/, name: 'Installation/Setup' },
        { pattern: /usage|how to|quick start/, name: 'Usage' },
      ];
      for (const section of expectedSections) {
        if (!section.pattern.test(readme)) {
          issues.push(`README.md missing "${section.name}" section`);
          suggestions.push(`Add a "${section.name}" section to README.md`);
          missingCount++;
        }
      }
    } catch { /* read error — skip */ }
  }

  // Check CHANGELOG format if it exists
  const changelogPath = join(dir, 'CHANGELOG.md');
  if (existsSync(changelogPath)) {
    try {
      const changelog = readFileSync(changelogPath, 'utf-8');
      if (!changelog.includes('[Unreleased]') && !changelog.includes('## [')) {
        issues.push('CHANGELOG.md does not follow Keep a Changelog format (missing version headers)');
        suggestions.push('Structure CHANGELOG.md with ## [Unreleased] and ## [vX.Y.Z] headers');
        missingCount++;
      }
    } catch { /* read error — skip */ }
  }

  if (missingCount === 0) return { status: 'pass', details: 'Essential documentation is present' };
  if (missingCount === 1) return { status: 'warn', details: `${missingCount} completeness issue found` };
  return { status: 'fail', details: `${missingCount} completeness issues — documentation needs attention` };
}

function checkConsistency(dir: string, issues: string[], _suggestions: string[]): ValidationCheck {
  let inconsistencyCount = 0;

  // Check version consistency across files
  const pkgPath = join(dir, 'package.json');
  const cargoPath = join(dir, 'Cargo.toml');
  const readmePath = join(dir, 'README.md');

  let projectVersion: string | null = null;

  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      projectVersion = pkg.version as string;
    } catch { /* parse error */ }
  } else if (existsSync(cargoPath)) {
    try {
      const cargo = readFileSync(cargoPath, 'utf-8');
      const match = cargo.match(/version\s*=\s*"([^"]+)"/);
      if (match) projectVersion = match[1];
    } catch { /* read error */ }
  }

  // Check if README mentions the version
  if (projectVersion && existsSync(readmePath)) {
    try {
      const readme = readFileSync(readmePath, 'utf-8');
      // Look for version badge or explicit version mention
      if (!readme.includes(projectVersion)) {
        // Not a hard fail — many READMEs don't include version
        // Just a suggestion
      }
    } catch { /* read error */ }
  }

  // Check for orphaned documentation (docs that reference files/APIs that no longer exist)
  // This is a lightweight heuristic — full validation would need AST parsing
  const srcDir = join(dir, 'src');
  if (existsSync(readmePath) && existsSync(srcDir)) {
    try {
      const readme = readFileSync(readmePath, 'utf-8');
      // Check for common stale patterns
      if (readme.includes('TODO') || readme.includes('FIXME') || readme.includes('TBD')) {
        issues.push('README.md contains TODO/FIXME/TBD markers — incomplete documentation');
        inconsistencyCount++;
      }
    } catch { /* read error */ }
  }

  if (inconsistencyCount === 0) return { status: 'pass', details: 'Documentation is internally consistent' };
  return { status: 'warn', details: `${inconsistencyCount} consistency issues found` };
}
