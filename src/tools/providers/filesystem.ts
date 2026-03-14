/**
 * Filesystem Tool Provider
 *
 * read_file, write_file, patch_file, list_dir implementations.
 * All paths are resolved relative to a working directory and
 * validated to stay within the cwd boundary (path traversal protection).
 */

import { readFile, writeFile, readdir, stat, copyFile as fsCopyFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { existsSync } from 'node:fs';
import { logger } from '../../core/logger.js';
import { guardPathWithPermissions } from '../path-permissions.js';

const log = logger.child({ module: 'tool:filesystem' });

export async function readFileImpl(params: {
  path: string;
  cwd?: string;
  allowedPaths?: string[];
}): Promise<{ content: string; path: string; size: number }> {
  const cwd = params.cwd || process.cwd();
  const fullPath = guardPathWithPermissions(params.path, cwd, params.allowedPaths || []);
  log.debug({ path: fullPath }, 'Reading file');

  const content = await readFile(fullPath, 'utf-8');
  return { content, path: fullPath, size: content.length };
}

export async function writeFileImpl(params: {
  path: string;
  content: string;
  cwd?: string;
  allowedPaths?: string[];
}): Promise<{ path: string; bytesWritten: number }> {
  const cwd = params.cwd || process.cwd();
  const fullPath = guardPathWithPermissions(params.path, cwd, params.allowedPaths || []);
  log.debug({ path: fullPath }, 'Writing file');

  await writeFile(fullPath, params.content, 'utf-8');
  return { path: fullPath, bytesWritten: params.content.length };
}

export async function patchFileImpl(params: {
  path: string;
  search: string;
  replace: string;
  cwd?: string;
  allowedPaths?: string[];
}): Promise<{ path: string; matched: boolean; occurrences: number }> {
  const cwd = params.cwd || process.cwd();
  const fullPath = guardPathWithPermissions(params.path, cwd, params.allowedPaths || []);
  log.debug({ path: fullPath }, 'Patching file');

  const content = await readFile(fullPath, 'utf-8');
  const occurrences = content.split(params.search).length - 1;

  if (occurrences === 0) {
    return { path: fullPath, matched: false, occurrences: 0 };
  }

  const patched = content.replaceAll(params.search, params.replace);
  await writeFile(fullPath, patched, 'utf-8');
  return { path: fullPath, matched: true, occurrences };
}

interface DirEntry {
  name: string;
  type: 'file' | 'directory' | 'other';
  size?: number;
}

export async function listDirImpl(params: {
  path: string;
  cwd?: string;
  allowedPaths?: string[];
}): Promise<{ path: string; entries: DirEntry[] }> {
  const cwd = params.cwd || process.cwd();
  const fullPath = guardPathWithPermissions(params.path, cwd, params.allowedPaths || []);
  log.debug({ path: fullPath }, 'Listing directory');

  if (!existsSync(fullPath)) {
    throw new Error(`Directory does not exist: ${fullPath}`);
  }

  const dirEntries = await readdir(fullPath, { withFileTypes: true });
  const entries: DirEntry[] = [];

  for (const entry of dirEntries) {
    const entryPath = resolve(fullPath, entry.name);
    if (entry.isFile()) {
      const st = await stat(entryPath);
      entries.push({ name: entry.name, type: 'file', size: st.size });
    } else if (entry.isDirectory()) {
      entries.push({ name: entry.name, type: 'directory' });
    } else {
      entries.push({ name: entry.name, type: 'other' });
    }
  }

  return { path: fullPath, entries };
}

/**
 * Copy a file from source to destination without AI involvement (#595).
 * Bypasses the AI context window — no need to read/output large content.
 */
export async function copyFileImpl(params: {
  source: string;
  destination: string;
  cwd: string;
  allowedPaths?: string[];
}): Promise<{ source: string; destination: string; bytesCopied: number }> {
  const srcPath = resolve(params.cwd, params.source);
  const destPath = resolve(params.cwd, params.destination);

  guardPathWithPermissions(srcPath, params.cwd, params.allowedPaths || []);
  guardPathWithPermissions(destPath, params.cwd, params.allowedPaths || []);

  if (!existsSync(srcPath)) {
    throw new Error(`Source file does not exist: ${params.source}`);
  }

  // Ensure destination directory exists
  const destDir = dirname(destPath);
  await mkdir(destDir, { recursive: true });

  await fsCopyFile(srcPath, destPath);
  const st = await stat(destPath);
  log.info({ source: srcPath, destination: destPath, bytes: st.size }, 'File copied');

  return { source: srcPath, destination: destPath, bytesCopied: st.size };
}
