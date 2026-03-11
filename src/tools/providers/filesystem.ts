/**
 * Filesystem Tool Provider
 *
 * read_file, write_file, patch_file, list_dir implementations.
 * All paths are resolved relative to a working directory.
 */

import { readFile, writeFile, readdir, stat } from 'node:fs/promises';
import { resolve, relative, basename } from 'node:path';
import { existsSync } from 'node:fs';
import { logger } from '../../core/logger.js';

const log = logger.child({ module: 'tool:filesystem' });

export async function readFileImpl(params: {
  path: string;
  cwd?: string;
}): Promise<{ content: string; path: string; size: number }> {
  const fullPath = resolve(params.cwd || process.cwd(), params.path);
  log.debug({ path: fullPath }, 'Reading file');

  const content = await readFile(fullPath, 'utf-8');
  return { content, path: fullPath, size: content.length };
}

export async function writeFileImpl(params: {
  path: string;
  content: string;
  cwd?: string;
}): Promise<{ path: string; bytesWritten: number }> {
  const fullPath = resolve(params.cwd || process.cwd(), params.path);
  log.debug({ path: fullPath }, 'Writing file');

  await writeFile(fullPath, params.content, 'utf-8');
  return { path: fullPath, bytesWritten: params.content.length };
}

export async function patchFileImpl(params: {
  path: string;
  search: string;
  replace: string;
  cwd?: string;
}): Promise<{ path: string; matched: boolean; occurrences: number }> {
  const fullPath = resolve(params.cwd || process.cwd(), params.path);
  log.debug({ path: fullPath }, 'Patching file');

  const content = await readFile(fullPath, 'utf-8');
  const occurrences = content.split(params.search).length - 1;

  if (occurrences === 0) {
    return { path: fullPath, matched: false, occurrences: 0 };
  }

  const patched = content.replace(params.search, params.replace);
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
}): Promise<{ path: string; entries: DirEntry[] }> {
  const fullPath = resolve(params.cwd || process.cwd(), params.path);
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
