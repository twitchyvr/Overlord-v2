/**
 * Static Analysis Tool Provider
 * Auto-detects project type and runs appropriate lint/type-check.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { ok, err } from '../../core/contracts.js';
import { executeShell } from './shell.js';
import type { Result } from '../../core/contracts.js';

export interface StaticAnalysisResult {
  projectType: string;
  lintErrors: number;
  typeErrors: number;
  warnings: number;
  details: string;
  summary: string;
}

type ProjectType = 'node' | 'rust' | 'python' | 'go' | 'unknown';

function detectProjectType(projectDir: string): ProjectType {
  if (fs.existsSync(path.join(projectDir, 'package.json'))) return 'node';
  if (fs.existsSync(path.join(projectDir, 'Cargo.toml'))) return 'rust';
  if (fs.existsSync(path.join(projectDir, 'pyproject.toml'))) return 'python';
  if (fs.existsSync(path.join(projectDir, 'requirements.txt'))) return 'python';
  if (fs.existsSync(path.join(projectDir, 'go.mod'))) return 'go';
  return 'unknown';
}

async function runNodeAnalysis(projectDir: string, checks: string[]): Promise<StaticAnalysisResult> {
  let lintErrors = 0;
  let typeErrors = 0;
  let warnings = 0;
  const details: string[] = [];

  if (checks.includes('lint')) {
    const lintResult = await executeShell({
      command: 'npx eslint . --format json 2>&1',
      cwd: projectDir,
      timeout: 120_000,
    });
    details.push('[lint] exit=' + lintResult.exitCode);
    if (lintResult.exitCode !== 0) {
      try {
        const parsed = JSON.parse(lintResult.stdout);
        if (Array.isArray(parsed)) {
          for (const file of parsed) {
            if (file.errorCount) lintErrors += file.errorCount;
            if (file.warningCount) warnings += file.warningCount;
          }
        }
      } catch {
        lintErrors += 1;
        details.push(lintResult.stdout.slice(0, 500));
      }
    }
  }

  if (checks.includes('typecheck')) {
    const tscResult = await executeShell({
      command: 'npx tsc --noEmit 2>&1',
      cwd: projectDir,
      timeout: 120_000,
    });
    details.push('[typecheck] exit=' + tscResult.exitCode);
    if (tscResult.exitCode !== 0) {
      const lines = tscResult.stdout.split('\n').filter(l => l.includes('error TS'));
      typeErrors = lines.length || 1;
      details.push(tscResult.stdout.slice(0, 500));
    }
  }

  const total = lintErrors + typeErrors + warnings;
  return {
    projectType: 'node',
    lintErrors,
    typeErrors,
    warnings,
    details: details.join('\n'),
    summary: total === 0
      ? 'No issues found'
      : lintErrors + ' lint error(s), ' + typeErrors + ' type error(s), ' + warnings + ' warning(s)',
  };
}

async function runRustAnalysis(projectDir: string, checks: string[]): Promise<StaticAnalysisResult> {
  let lintErrors = 0;
  let typeErrors = 0;
  let warnings = 0;
  const details: string[] = [];

  if (checks.includes('lint') || checks.includes('typecheck')) {
    const clippyResult = await executeShell({
      command: 'cargo clippy --message-format json 2>&1',
      cwd: projectDir,
      timeout: 300_000,
    });
    details.push('[clippy] exit=' + clippyResult.exitCode);
    if (clippyResult.exitCode !== 0) {
      const lines = clippyResult.stdout.split('\n');
      for (const line of lines) {
        try {
          const msg = JSON.parse(line);
          if (msg.reason === 'compiler-message' && msg.message) {
            if (msg.message.level === 'error') lintErrors++;
            else if (msg.message.level === 'warning') warnings++;
          }
        } catch {
          // not JSON, skip
        }
      }
      if (lintErrors === 0 && warnings === 0) lintErrors = 1;
      details.push(clippyResult.stdout.slice(0, 500));
    }
  }

  const total = lintErrors + typeErrors + warnings;
  return {
    projectType: 'rust',
    lintErrors,
    typeErrors,
    warnings,
    details: details.join('\n'),
    summary: total === 0
      ? 'No issues found'
      : lintErrors + ' lint error(s), ' + typeErrors + ' type error(s), ' + warnings + ' warning(s)',
  };
}

async function runPythonAnalysis(projectDir: string, checks: string[]): Promise<StaticAnalysisResult> {
  let lintErrors = 0;
  let typeErrors = 0;
  let warnings = 0;
  const details: string[] = [];

  if (checks.includes('lint') || checks.includes('typecheck')) {
    const pylintResult = await executeShell({
      command: 'python3 -m pylint --output-format=json . 2>&1',
      cwd: projectDir,
      timeout: 120_000,
    });
    details.push('[pylint] exit=' + pylintResult.exitCode);
    if (pylintResult.exitCode !== 0) {
      try {
        const parsed = JSON.parse(pylintResult.stdout);
        if (Array.isArray(parsed)) {
          for (const msg of parsed) {
            if (msg.type === 'error' || msg.type === 'fatal') lintErrors++;
            else if (msg.type === 'warning') warnings++;
          }
        }
      } catch {
        lintErrors += 1;
        details.push(pylintResult.stdout.slice(0, 500));
      }
    }
  }

  const total = lintErrors + typeErrors + warnings;
  return {
    projectType: 'python',
    lintErrors,
    typeErrors,
    warnings,
    details: details.join('\n'),
    summary: total === 0
      ? 'No issues found'
      : lintErrors + ' lint error(s), ' + typeErrors + ' type error(s), ' + warnings + ' warning(s)',
  };
}

async function runGoAnalysis(projectDir: string, checks: string[]): Promise<StaticAnalysisResult> {
  let lintErrors = 0;
  let typeErrors = 0;
  let warnings = 0;
  const details: string[] = [];

  if (checks.includes('lint') || checks.includes('typecheck')) {
    const vetResult = await executeShell({
      command: 'go vet ./... 2>&1',
      cwd: projectDir,
      timeout: 120_000,
    });
    details.push('[go vet] exit=' + vetResult.exitCode);
    if (vetResult.exitCode !== 0) {
      const lines = vetResult.stdout.split('\n').filter(l => l.trim().length > 0);
      lintErrors = lines.length || 1;
      details.push(vetResult.stdout.slice(0, 500));
    }
  }

  const total = lintErrors + typeErrors + warnings;
  return {
    projectType: 'go',
    lintErrors,
    typeErrors,
    warnings,
    details: details.join('\n'),
    summary: total === 0
      ? 'No issues found'
      : lintErrors + ' lint error(s), ' + typeErrors + ' type error(s), ' + warnings + ' warning(s)',
  };
}

export async function executeStaticAnalysis(params: {
  projectDir: string;
  checks?: string[];
}): Promise<Result<StaticAnalysisResult>> {
  const { projectDir, checks = ['lint', 'typecheck'] } = params;

  if (!fs.existsSync(projectDir)) {
    return err('NOT_FOUND', 'Project directory does not exist: ' + projectDir, { retryable: false });
  }

  const projectType = detectProjectType(projectDir);

  try {
    let result: StaticAnalysisResult;

    switch (projectType) {
      case 'node':
        result = await runNodeAnalysis(projectDir, checks);
        break;
      case 'rust':
        result = await runRustAnalysis(projectDir, checks);
        break;
      case 'python':
        result = await runPythonAnalysis(projectDir, checks);
        break;
      case 'go':
        result = await runGoAnalysis(projectDir, checks);
        break;
      default:
        result = {
          projectType: 'unknown',
          lintErrors: 0,
          typeErrors: 0,
          warnings: 0,
          details: '',
          summary: 'No lint tools detected',
        };
    }

    return ok(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return err('ANALYSIS_ERROR', 'Static analysis failed: ' + message, { retryable: true });
  }
}
