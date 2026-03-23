/**
 * Documentation Validator Tests (#815)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { validateDocumentation } from '../../../src/tools/providers/doc-validator.js';

let testDir: string;

describe('Documentation Validator (#815)', () => {
  beforeEach(() => {
    testDir = join(tmpdir(), `overlord-doc-validator-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
    mkdirSync(testDir, { recursive: true, mode: 0o700 });
  });

  afterEach(() => {
    try { rmSync(testDir, { recursive: true, force: true }); } catch { /* cleanup */ }
  });

  it('returns error for non-existent directory', () => {
    const result = validateDocumentation({ workingDirectory: '/nonexistent/path' });
    expect(result.ok).toBe(false);
  });

  it('reports missing README and CHANGELOG', () => {
    const result = validateDocumentation({ workingDirectory: testDir });
    expect(result.ok).toBe(true);
    expect(result.data.completeness.status).toBe('fail');
    expect(result.data.issues).toContain('Missing README.md');
    expect(result.data.issues).toContain('Missing CHANGELOG.md');
  });

  it('passes completeness when README and CHANGELOG exist with correct format', () => {
    writeFileSync(join(testDir, 'README.md'), `# My Project

## Installation

Run npm install.

## Usage

Import and use.
`);
    writeFileSync(join(testDir, 'CHANGELOG.md'), `# Changelog

## [Unreleased]

### Added
- Initial release
`);

    const result = validateDocumentation({ workingDirectory: testDir });
    expect(result.ok).toBe(true);
    expect(result.data.completeness.status).toBe('pass');
  });

  it('warns when README is missing Installation section', () => {
    writeFileSync(join(testDir, 'README.md'), `# My Project

A simple project description with no onboarding information.

## Features

- Feature A
- Feature B
`);
    writeFileSync(join(testDir, 'CHANGELOG.md'), `## [Unreleased]\n`);

    const result = validateDocumentation({ workingDirectory: testDir });
    expect(result.ok).toBe(true);
    const installIssue = result.data.issues.find((i: string) => i.includes('Installation'));
    expect(installIssue).toBeDefined();
  });

  it('detects CHANGELOG missing current package version', () => {
    writeFileSync(join(testDir, 'package.json'), JSON.stringify({ name: 'test', version: '2.5.0' }));
    writeFileSync(join(testDir, 'CHANGELOG.md'), `# Changelog\n\n## [1.0.0]\n- Old stuff\n`);
    writeFileSync(join(testDir, 'README.md'), `# Test\n\n## Installation\n\nnpm install\n\n## Usage\n\nuse it\n`);

    const result = validateDocumentation({ workingDirectory: testDir });
    expect(result.ok).toBe(true);
    const versionIssue = result.data.issues.find((i: string) => i.includes('2.5.0'));
    expect(versionIssue).toBeDefined();
  });

  it('detects TODO markers in README as consistency issue', () => {
    mkdirSync(join(testDir, 'src'), { recursive: true });
    writeFileSync(join(testDir, 'src', 'index.ts'), 'export const x = 1;');
    writeFileSync(join(testDir, 'README.md'), `# Project\n\n## Installation\n\nTODO: write install instructions\n\n## Usage\n\nTODO\n`);
    writeFileSync(join(testDir, 'CHANGELOG.md'), `## [Unreleased]\n`);

    const result = validateDocumentation({ workingDirectory: testDir });
    expect(result.ok).toBe(true);
    expect(result.data.consistency.status).toBe('warn');
    const todoIssue = result.data.issues.find((i: string) => i.includes('TODO'));
    expect(todoIssue).toBeDefined();
  });

  it('passes all checks for well-documented project', () => {
    writeFileSync(join(testDir, 'package.json'), JSON.stringify({ name: 'good-project', version: '1.0.0' }));
    writeFileSync(join(testDir, 'README.md'), `# Good Project v1.0.0

A well-documented project.

## Installation

npm install good-project

## Usage

Import and use the module.
`);
    writeFileSync(join(testDir, 'CHANGELOG.md'), `# Changelog

## [Unreleased]

## [1.0.0] - 2026-03-22

### Added
- Initial release
`);

    const result = validateDocumentation({ workingDirectory: testDir });
    expect(result.ok).toBe(true);
    expect(result.data.freshness.status).toBe('pass');
    expect(result.data.completeness.status).toBe('pass');
    expect(result.data.consistency.status).toBe('pass');
  });
});
