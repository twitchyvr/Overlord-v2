/**
 * Code Review Tool Provider
 * Runs git diff on specified files and structures the output as a review document.
 */

import * as fs from 'node:fs';
import { ok, err } from '../../core/contracts.js';
import { executeShell } from './shell.js';
import type { Result } from '../../core/contracts.js';

export interface ReviewIssue {
  file: string;
  line: number;
  severity: 'error' | 'warning' | 'info';
  message: string;
}

export interface CodeReviewResult {
  filesReviewed: number;
  issues: ReviewIssue[];
  summary: string;
  approved: boolean;
}

type ReviewType = 'full' | 'security' | 'performance';

/**
 * Parse a unified diff to extract file-level change info and flag potential issues.
 */
function analyzeDiff(diff: string, reviewType: ReviewType): ReviewIssue[] {
  const issues: ReviewIssue[] = [];
  const lines = diff.split('\n');
  let currentFile = '';
  let currentLine = 0;

  for (const line of lines) {
    // Track which file we're in
    const fileMatch = line.match(/^\+\+\+ b\/(.+)$/);
    if (fileMatch) {
      currentFile = fileMatch[1];
      continue;
    }

    // Track line numbers from hunk headers
    const hunkMatch = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)/);
    if (hunkMatch) {
      currentLine = parseInt(hunkMatch[1], 10);
      continue;
    }

    // Only inspect added lines
    if (!line.startsWith('+') || line.startsWith('+++')) continue;

    const addedContent = line.slice(1);

    if (reviewType === 'full' || reviewType === 'security') {
      // Security checks
      if (/\b(eval|exec)\s*\(/.test(addedContent)) {
        issues.push({ file: currentFile, line: currentLine, severity: 'error', message: 'Potential unsafe eval/exec usage' });
      }
      if (/(?:password|secret|api_key|apikey|token)\s*[:=]\s*['"][^'"]+['"]/i.test(addedContent)) {
        issues.push({ file: currentFile, line: currentLine, severity: 'error', message: 'Potential hardcoded secret or credential' });
      }
      if (/\bany\b/.test(addedContent) && (currentFile.endsWith('.ts') || currentFile.endsWith('.tsx'))) {
        issues.push({ file: currentFile, line: currentLine, severity: 'warning', message: 'Usage of "any" type — consider stricter typing' });
      }
    }

    if (reviewType === 'full' || reviewType === 'performance') {
      // Performance checks
      if (/\.forEach\s*\(/.test(addedContent) && /\.map\s*\(/.test(addedContent)) {
        issues.push({ file: currentFile, line: currentLine, severity: 'info', message: 'Chained array operations — consider combining for performance' });
      }
      if (/console\.(log|debug|info)\s*\(/.test(addedContent)) {
        issues.push({ file: currentFile, line: currentLine, severity: 'warning', message: 'Console statement left in code' });
      }
    }

    if (line.startsWith('+')) {
      currentLine++;
    }
  }

  return issues;
}

export async function executeCodeReview(params: {
  files: string[];
  projectDir: string;
  reviewType?: ReviewType;
}): Promise<Result<CodeReviewResult>> {
  const { files, projectDir, reviewType = 'full' } = params;

  if (!fs.existsSync(projectDir)) {
    return err('NOT_FOUND', 'Project directory does not exist: ' + projectDir, { retryable: false });
  }

  if (!files || files.length === 0) {
    return err('INVALID_PARAMS', 'No files specified for review', { retryable: false });
  }

  try {
    const allIssues: ReviewIssue[] = [];
    let filesReviewed = 0;

    for (const file of files) {
      const diffResult = await executeShell({
        command: `git diff HEAD -- "${file}"`,
        cwd: projectDir,
        timeout: 30_000,
      });

      // If no diff from HEAD, try unstaged diff
      let diffOutput = diffResult.stdout;
      if (!diffOutput.trim()) {
        const cachedResult = await executeShell({
          command: `git diff --cached -- "${file}"`,
          cwd: projectDir,
          timeout: 30_000,
        });
        diffOutput = cachedResult.stdout;
      }

      if (diffOutput.trim()) {
        filesReviewed++;
        const fileIssues = analyzeDiff(diffOutput, reviewType);
        allIssues.push(...fileIssues);
      }
    }

    const errorCount = allIssues.filter(i => i.severity === 'error').length;
    const warningCount = allIssues.filter(i => i.severity === 'warning').length;
    const infoCount = allIssues.filter(i => i.severity === 'info').length;
    const approved = errorCount === 0;

    const summary = allIssues.length === 0
      ? `Reviewed ${filesReviewed} file(s) — no issues found`
      : `Reviewed ${filesReviewed} file(s) — ${errorCount} error(s), ${warningCount} warning(s), ${infoCount} info(s)`;

    return ok({ filesReviewed, issues: allIssues, summary, approved });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return err('REVIEW_ERROR', 'Code review failed: ' + message, { retryable: true });
  }
}
