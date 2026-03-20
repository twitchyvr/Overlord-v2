#!/usr/bin/env npx tsx
/**
 * Overlord v2 — E2E Test Scaffolding Script
 *
 * Generates a new Playwright E2E spec file from a template.
 *
 * Usage:
 *   npx tsx scripts/new-e2e-test.ts <template> <name> [--issue <number>]
 *
 * Templates:
 *   feature       — New feature or epic (comprehensive test suite)
 *   bugfix        — Bug fix verification (reproduce + verify fix)
 *   view          — Full view/page testing (render, interact, state)
 *   modal-form    — Modal dialog and form testing (lifecycle, validation)
 *   socket-api    — Socket.IO API endpoint testing (CRUD, edge cases)
 *   regression    — Regression test suite (quick checks per area)
 *   accessibility — Accessibility testing (keyboard, ARIA, focus)
 *   performance   — Performance testing (timing, large data, rapid ops)
 *
 * Examples:
 *   npx tsx scripts/new-e2e-test.ts feature pipeline-status --issue 608
 *   npx tsx scripts/new-e2e-test.ts bugfix settings-tabs --issue 598
 *   npx tsx scripts/new-e2e-test.ts view raid-log
 *   npx tsx scripts/new-e2e-test.ts regression navigation
 */

import fs from 'node:fs';
import path from 'node:path';

const PROJECT_ROOT = path.resolve(import.meta.dirname, '..');
const TEMPLATES_DIR = path.join(PROJECT_ROOT, 'tests', 'e2e', 'templates');
const SPECS_DIR = path.join(PROJECT_ROOT, 'tests', 'e2e');

const VALID_TEMPLATES = [
  'feature',
  'bugfix',
  'view',
  'modal-form',
  'socket-api',
  'regression',
  'accessibility',
  'performance',
];

function printUsage(): void {
  console.log(`
Overlord v2 — E2E Test Scaffolding

Usage:
  npx tsx scripts/new-e2e-test.ts <template> <name> [--issue <number>]

Templates:
  ${VALID_TEMPLATES.join(', ')}

Examples:
  npx tsx scripts/new-e2e-test.ts feature pipeline-status --issue 608
  npx tsx scripts/new-e2e-test.ts bugfix settings-tabs --issue 598
  npx tsx scripts/new-e2e-test.ts view raid-log
  npx tsx scripts/new-e2e-test.ts regression navigation
`);
}

function main(): void {
  const args = process.argv.slice(2);

  if (args.length < 2 || args.includes('--help') || args.includes('-h')) {
    printUsage();
    process.exit(args.includes('--help') || args.includes('-h') ? 0 : 1);
  }

  const [templateName, specName] = args;
  const issueIdx = args.indexOf('--issue');
  const issueNumber = issueIdx !== -1 ? args[issueIdx + 1] : undefined;

  // Validate template
  if (!VALID_TEMPLATES.includes(templateName)) {
    console.error(`\nError: Unknown template "${templateName}"`);
    console.error(`Valid templates: ${VALID_TEMPLATES.join(', ')}`);
    process.exit(1);
  }

  // Validate spec name
  if (!/^[a-z0-9-]+$/.test(specName)) {
    console.error(`\nError: Spec name must be lowercase alphanumeric with hyphens: "${specName}"`);
    process.exit(1);
  }

  // Build paths
  const templateFile = path.join(TEMPLATES_DIR, `${templateName}.template.ts`);
  const outputFile = path.join(SPECS_DIR, `${specName}.spec.ts`);

  // Check template exists
  if (!fs.existsSync(templateFile)) {
    console.error(`\nError: Template file not found: ${templateFile}`);
    process.exit(1);
  }

  // Check output doesn't already exist
  if (fs.existsSync(outputFile)) {
    console.error(`\nError: Spec file already exists: ${outputFile}`);
    console.error('Delete it first or choose a different name.');
    process.exit(1);
  }

  // Read template
  let content = fs.readFileSync(templateFile, 'utf-8');

  // Replace template markers
  const titleCase = specName
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');

  const date = new Date().toISOString().split('T')[0];

  content = content
    .replace(/\[FEATURE NAME\]/g, titleCase)
    .replace(/\[Epic\/Feature Name\]/g, titleCase)
    .replace(/\[MODAL NAME\]/g, titleCase)
    .replace(/\[Modal Name\]/g, titleCase)
    .replace(/\[ENTITY NAME\]/g, titleCase)
    .replace(/\[Entity\]/g, titleCase)
    .replace(/\[VIEW NAME\]/g, titleCase)
    .replace(/\[View Name\]/g, titleCase)
    .replace(/\[AREA NAME\]/g, titleCase)
    .replace(/\[Area Name\]/g, titleCase)
    .replace(/\[Session\/Sprint Name\]/g, `Sprint ${date}`)
    .replace(/\[DATE or Sprint\]/g, date)
    .replace(/<feature-name>/g, specName)
    .replace(/<view-name>/g, specName)
    .replace(/<entity>/g, specName)
    .replace(/<entity>-modal/g, `${specName}-modal`)
    .replace(/<issue-number>/g, issueNumber || 'NNN');

  if (issueNumber) {
    content = content.replace(/#NNN/g, `#${issueNumber}`);
    content = content.replace(/Issue: #NNN/g, `Issue: #${issueNumber}`);
  }

  // Update the doc comment to reference the output file
  content = content.replace(
    /Copy this file to tests\/e2e\/.*\.spec\.ts and customize\./,
    `Generated from ${templateName}.template.ts on ${date}`
  );

  // Write output
  fs.writeFileSync(outputFile, content, 'utf-8');

  console.log(`\n  Created: tests/e2e/${specName}.spec.ts`);
  console.log(`  Template: ${templateName}`);
  if (issueNumber) {
    console.log(`  Issue: #${issueNumber}`);
  }
  console.log(`\n  Next steps:`);
  console.log(`    1. Open ${outputFile}`);
  console.log(`    2. Uncomment and customize the test code`);
  console.log(`    3. Run: npx playwright test tests/e2e/${specName}.spec.ts`);
  console.log();
}

main();
