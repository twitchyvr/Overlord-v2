/**
 * E2E Testing Tool Provider
 * Auto-detects test framework and runs end-to-end tests.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { ok, err } from '../../core/contracts.js';
import { executeShell } from './shell.js';
import type { Result } from '../../core/contracts.js';

export interface E2ETestResult {
  framework: string;
  testsRun: number;
  passed: number;
  failed: number;
  duration: number;
  output: string;
}

interface FrameworkDetection {
  name: string;
  configFiles: string[];
  defaultCommand: string;
}

const FRAMEWORKS: FrameworkDetection[] = [
  { name: 'playwright', configFiles: ['playwright.config.ts', 'playwright.config.js'], defaultCommand: 'npx playwright test' },
  { name: 'cypress', configFiles: ['cypress.config.ts', 'cypress.config.js', 'cypress.json'], defaultCommand: 'npx cypress run' },
  { name: 'jest', configFiles: ['jest.config.ts', 'jest.config.js', 'jest.config.json'], defaultCommand: 'npx jest' },
  { name: 'vitest', configFiles: ['vitest.config.ts', 'vitest.config.js', 'vite.config.ts'], defaultCommand: 'npx vitest run' },
  { name: 'mocha', configFiles: ['.mocharc.yml', '.mocharc.json', '.mocharc.js'], defaultCommand: 'npx mocha' },
];

function detectFramework(projectDir: string): FrameworkDetection | null {
  for (const fw of FRAMEWORKS) {
    for (const configFile of fw.configFiles) {
      if (fs.existsSync(path.join(projectDir, configFile))) {
        return fw;
      }
    }
  }
  return null;
}

/**
 * Parse test output to extract counts. Uses common patterns across frameworks.
 */
function parseTestOutput(output: string, framework: string): { testsRun: number; passed: number; failed: number } {
  let testsRun = 0;
  let passed = 0;
  let failed = 0;

  if (framework === 'playwright') {
    // Playwright: "X passed", "Y failed", "Z total"
    const passedMatch = output.match(/(\d+)\s+passed/);
    const failedMatch = output.match(/(\d+)\s+failed/);
    if (passedMatch) passed = parseInt(passedMatch[1], 10);
    if (failedMatch) failed = parseInt(failedMatch[1], 10);
    testsRun = passed + failed;
  } else if (framework === 'cypress') {
    // Cypress: "Tests: X", "Passing: Y", "Failing: Z"
    const passingMatch = output.match(/Passing:\s*(\d+)/);
    const failingMatch = output.match(/Failing:\s*(\d+)/);
    if (passingMatch) passed = parseInt(passingMatch[1], 10);
    if (failingMatch) failed = parseInt(failingMatch[1], 10);
    testsRun = passed + failed;
  } else if (framework === 'jest') {
    // Jest: "Tests: X passed, Y failed, Z total"
    const testsLine = output.match(/Tests:\s+.*?(\d+)\s+total/);
    const passedMatch = output.match(/(\d+)\s+passed/);
    const failedMatch = output.match(/(\d+)\s+failed/);
    if (testsLine) testsRun = parseInt(testsLine[1], 10);
    if (passedMatch) passed = parseInt(passedMatch[1], 10);
    if (failedMatch) failed = parseInt(failedMatch[1], 10);
    if (testsRun === 0) testsRun = passed + failed;
  } else if (framework === 'vitest') {
    // Vitest: "Tests X passed | Y failed"
    const passedMatch = output.match(/(\d+)\s+passed/);
    const failedMatch = output.match(/(\d+)\s+failed/);
    if (passedMatch) passed = parseInt(passedMatch[1], 10);
    if (failedMatch) failed = parseInt(failedMatch[1], 10);
    testsRun = passed + failed;
  } else {
    // Generic: look for common patterns
    const passedMatch = output.match(/(\d+)\s+pass(?:ed|ing)/i);
    const failedMatch = output.match(/(\d+)\s+fail(?:ed|ing|ure)/i);
    if (passedMatch) passed = parseInt(passedMatch[1], 10);
    if (failedMatch) failed = parseInt(failedMatch[1], 10);
    testsRun = passed + failed;
  }

  return { testsRun, passed, failed };
}

export async function executeE2ETest(params: {
  projectDir: string;
  testCommand?: string;
  framework?: string;
}): Promise<Result<E2ETestResult>> {
  const { projectDir, testCommand, framework: explicitFramework } = params;

  if (!fs.existsSync(projectDir)) {
    return err('NOT_FOUND', 'Project directory does not exist: ' + projectDir, { retryable: false });
  }

  try {
    // Determine framework and command
    let command: string;
    let frameworkName: string;

    const detected = detectFramework(projectDir);

    if (testCommand) {
      command = testCommand;
      frameworkName = explicitFramework || (detected?.name ?? 'custom');
    } else if (detected) {
      command = detected.defaultCommand;
      frameworkName = detected.name;
    } else {
      command = 'npm test';
      frameworkName = explicitFramework || 'npm';
    }

    const startTime = Date.now();

    const result = await executeShell({
      command,
      cwd: projectDir,
      timeout: 300_000,
    });

    const duration = Date.now() - startTime;
    const combinedOutput = result.stdout + (result.stderr ? '\n' + result.stderr : '');

    const { testsRun, passed, failed } = parseTestOutput(combinedOutput, frameworkName);

    return ok({
      framework: frameworkName,
      testsRun,
      passed,
      failed,
      duration,
      output: combinedOutput.slice(0, 5000),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return err('E2E_ERROR', 'E2E test execution failed: ' + message, { retryable: true });
  }
}
