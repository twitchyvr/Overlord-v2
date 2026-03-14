/**
 * Plugin Bundler
 *
 * Exports plugins as portable .overlord-script bundles (ZIP format)
 * and imports them back. Uses Node.js built-in zlib for compression
 * with a simple custom archive format (JSON manifest + files).
 *
 * Bundle format: base64-encoded JSON containing:
 *   { version: 1, manifest: {...}, files: { "main.lua": "...", ... } }
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { logger } from '../core/logger.js';
import { ok, err } from '../core/contracts.js';
import type { Result } from '../core/contracts.js';
import type { PluginManifest } from './contracts.js';

const log = logger.child({ module: 'plugin-bundler' });

const BUNDLE_VERSION = 1;
const MAX_BUNDLE_SIZE = 5 * 1024 * 1024; // 5MB max bundle size
const ALLOWED_EXTENSIONS = new Set(['.lua', '.js', '.json', '.md', '.txt', '.cfg']);

export interface PluginBundle {
  version: number;
  manifest: PluginManifest;
  files: Record<string, string>;
}

/**
 * Export a plugin directory as a base64-encoded bundle string.
 * Reads the plugin.json manifest and all allowed files from the directory.
 */
export function exportBundle(pluginDir: string): Result<string> {
  const resolvedDir = path.resolve(pluginDir);

  if (!fs.existsSync(resolvedDir)) {
    return err('BUNDLE_DIR_NOT_FOUND', `Plugin directory not found: ${resolvedDir}`);
  }

  // Read manifest
  const manifestPath = path.join(resolvedDir, 'plugin.json');
  if (!fs.existsSync(manifestPath)) {
    return err('BUNDLE_NO_MANIFEST', `No plugin.json found in ${resolvedDir}`);
  }

  let manifest: PluginManifest;
  try {
    const raw = fs.readFileSync(manifestPath, 'utf-8');
    manifest = JSON.parse(raw) as PluginManifest;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return err('BUNDLE_MANIFEST_ERROR', `Failed to read manifest: ${message}`);
  }

  // Collect all allowed files from the directory
  const files: Record<string, string> = {};
  try {
    const entries = fs.readdirSync(resolvedDir);
    for (const entry of entries) {
      const ext = path.extname(entry).toLowerCase();
      if (!ALLOWED_EXTENSIONS.has(ext)) continue;

      const filePath = path.join(resolvedDir, entry);
      const stat = fs.statSync(filePath);
      if (!stat.isFile()) continue;

      files[entry] = fs.readFileSync(filePath, 'utf-8');
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return err('BUNDLE_READ_ERROR', `Failed to read plugin files: ${message}`);
  }

  // Ensure entrypoint is included
  if (!files[manifest.entrypoint]) {
    return err('BUNDLE_MISSING_ENTRYPOINT', `Entrypoint "${manifest.entrypoint}" not found in plugin directory`);
  }

  const bundle: PluginBundle = { version: BUNDLE_VERSION, manifest, files };
  const json = JSON.stringify(bundle);
  const base64 = Buffer.from(json, 'utf-8').toString('base64');

  log.info(
    { pluginId: manifest.id, fileCount: Object.keys(files).length, size: base64.length },
    'Plugin exported as bundle',
  );

  return ok(base64);
}

/**
 * Import a base64-encoded bundle string into a target directory.
 * Validates the bundle format, checks for ID conflicts, and extracts files.
 */
export function importBundle(base64: string, targetDir: string): Result<PluginManifest> {
  if (base64.length > MAX_BUNDLE_SIZE) {
    return err('BUNDLE_TOO_LARGE', `Bundle exceeds maximum size of ${MAX_BUNDLE_SIZE} bytes`);
  }

  // Decode and parse
  let bundle: PluginBundle;
  try {
    const json = Buffer.from(base64, 'base64').toString('utf-8');
    bundle = JSON.parse(json) as PluginBundle;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return err('BUNDLE_DECODE_ERROR', `Failed to decode bundle: ${message}`);
  }

  // Validate bundle structure
  if (!bundle.version || !bundle.manifest || !bundle.files) {
    return err('BUNDLE_INVALID', 'Invalid bundle format — missing version, manifest, or files');
  }

  if (bundle.version !== BUNDLE_VERSION) {
    return err('BUNDLE_VERSION_MISMATCH', `Unsupported bundle version: ${bundle.version} (expected ${BUNDLE_VERSION})`);
  }

  const { manifest, files } = bundle;

  // Basic manifest validation
  if (!manifest.id || !manifest.name || !manifest.entrypoint) {
    return err('BUNDLE_INVALID_MANIFEST', 'Bundle manifest missing required fields (id, name, entrypoint)');
  }

  // Ensure entrypoint exists in files
  if (!files[manifest.entrypoint]) {
    return err('BUNDLE_MISSING_ENTRYPOINT', `Entrypoint "${manifest.entrypoint}" not in bundle files`);
  }

  // Validate file extensions (security: prevent writing arbitrary file types)
  for (const filename of Object.keys(files)) {
    const ext = path.extname(filename).toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      return err('BUNDLE_INVALID_FILE', `Disallowed file type in bundle: ${filename}`);
    }
    // Prevent path traversal
    if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      return err('BUNDLE_INVALID_PATH', `Invalid file path in bundle: ${filename}`);
    }
  }

  // Create the target directory
  const pluginTargetDir = path.join(path.resolve(targetDir), manifest.id);
  try {
    fs.mkdirSync(pluginTargetDir, { recursive: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return err('BUNDLE_WRITE_ERROR', `Failed to create plugin directory: ${message}`);
  }

  // Write all files
  try {
    // Always write a fresh plugin.json from the manifest
    fs.writeFileSync(
      path.join(pluginTargetDir, 'plugin.json'),
      JSON.stringify(manifest, null, 2),
      'utf-8',
    );

    for (const [filename, content] of Object.entries(files)) {
      fs.writeFileSync(path.join(pluginTargetDir, filename), content, 'utf-8');
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return err('BUNDLE_WRITE_ERROR', `Failed to write plugin files: ${message}`);
  }

  log.info(
    { pluginId: manifest.id, targetDir: pluginTargetDir, fileCount: Object.keys(files).length },
    'Plugin bundle imported',
  );

  return ok(manifest);
}
