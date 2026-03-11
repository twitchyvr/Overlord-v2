/**
 * Architecture Compliance Checker
 *
 * Verifies that import dependencies follow the strict layer ordering:
 *   Transport -> Rooms -> Agents -> Tools -> AI -> Storage -> Core
 *
 * Each layer can only import from layers below it. No circular deps.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const LAYER_ORDER = ['transport', 'rooms', 'agents', 'tools', 'ai', 'storage', 'core'];

function getLayer(filePath: string): string | null {
  const rel = relative('src', filePath);
  const firstDir = rel.split('/')[0];
  return LAYER_ORDER.includes(firstDir) ? firstDir : null;
}

function getLayerIndex(layer: string): number {
  return LAYER_ORDER.indexOf(layer);
}

function walkDir(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      files.push(...walkDir(full));
    } else if (full.endsWith('.ts')) {
      files.push(full);
    }
  }
  return files;
}

function checkFile(filePath: string): string[] {
  const violations: string[] = [];
  const content = readFileSync(filePath, 'utf-8');
  const fileLayer = getLayer(filePath);
  if (!fileLayer) return [];

  const importRegex = /from\s+['"]\.\.?\/(.*?)['"]/g;
  let match;

  while ((match = importRegex.exec(content)) !== null) {
    const importPath = match[1];
    const parts = importPath.replace(/\.js$/, '').split('/');
    const resolvedParts = relative('src', filePath).split('/');
    resolvedParts.pop();

    for (const part of parts) {
      if (part === '..') {
        resolvedParts.pop();
      } else if (part !== '.') {
        resolvedParts.push(part);
      }
    }

    const importedLayer = resolvedParts[0];
    if (!LAYER_ORDER.includes(importedLayer)) continue;

    const fileIdx = getLayerIndex(fileLayer);
    const importIdx = getLayerIndex(importedLayer);

    if (importIdx < fileIdx) {
      violations.push(
        `${relative('src', filePath)}: imports from "${importedLayer}" but is in "${fileLayer}". ` +
        `${fileLayer} cannot depend on ${importedLayer}.`
      );
    }
  }

  return violations;
}

const srcDir = join(globalThis.process.cwd(), 'src');
const files = walkDir(srcDir);
const allViolations: string[] = [];

for (const file of files) {
  allViolations.push(...checkFile(file));
}

if (allViolations.length > 0) {
  console.error('Layer dependency violations found:\n');
  for (const v of allViolations) {
    console.error(`  - ${v}`);
  }
  console.error(`\nLayer order (top to bottom): ${LAYER_ORDER.join(' -> ')}`);
  globalThis.process.exitCode = 1;
} else {
  console.log(`Layer check passed. ${files.length} files checked, 0 violations.`);
  console.log(`Layer order: ${LAYER_ORDER.join(' -> ')}`);
}
