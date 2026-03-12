/**
 * Filesystem Tool Provider
 *
 * read_file, write_file, patch_file, list_dir implementations.
 * All paths are resolved relative to a working directory and
 * validated to stay within the cwd boundary (path traversal protection).
 */

import { readFile, writeFile, readdir, stat } from 'node:fs/promises';
import { resolve, normalize } from 'node:path';
import { existsSync } from 'node:fs';
import { logger } from '../../core/logger.js';

const log = logger.child({ module: 'tool:filesystem' });

/**
 * Resolve a user-supplied path against cwd and verify it stays within bounds.
 * Prevents directory traversal attacks (e.g., ../../etc/passwd).
 */
function guardPath(userPath: string, cwd: string): string {
  const root = resolve(cwd);
  const full = resolve(root, normalize(userPath));

  // The resolved path must start with root + separator (or be root itself)
  if (full !== root && !full.startsWith(root + '/')) {
    throw new Error(`Path traversal blocked: "${userPath}" resolves outside working directory`);
  }

  return full;
}

export async function readFileImpl(params: {
  path: string;
  cwd?: string;
}): Promise<{ content: string; path: string; size: number }> {
  const cwd = params.cwd || process.cwd();
  const fullPath = guardPath(params.path, cwd);
  log.debug({ path: fullPath }, 'Reading file');

  const content = await readFile(fullPath, 'utf-8');
  return { content, path: fullPath, size: content.length };
}

export async function writeFileImpl(params: {
  path: string;
  content: string;
  cwd?: string;
}): Promise<{ path: string; bytesWritten: number }> {
  const cwd = params.cwd || process.cwd();
  const fullPath = guardPath(params.path, cwd);
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
  const cwd = params.cwd || process.cwd();
  const fullPath = guardPath(params.path, cwd);
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
}): Promise<{ path: string; entries: DirEntry[] }> {
  const cwd = params.cwd || process.cwd();
  const fullPath = guardPath(params.path, cwd);
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
