/**
 * Filesystem Tool Provider Tests
 */

import { describe, it, expect, afterEach } from 'vitest';
import { readFileImpl, writeFileImpl, patchFileImpl, listDirImpl } from '../../../src/tools/providers/filesystem.js';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('Filesystem Provider', () => {
  const tempDirs: string[] = [];

  function makeTempDir(): string {
    const dir = mkdtempSync(join(tmpdir(), 'overlord-test-'));
    tempDirs.push(dir);
    return dir;
  }

  afterEach(() => {
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
    tempDirs.length = 0;
  });

  describe('readFileImpl', () => {
    it('reads a file', async () => {
      const dir = makeTempDir();
      writeFileSync(join(dir, 'test.txt'), 'hello world');
      const result = await readFileImpl({ path: 'test.txt', cwd: dir });
      expect(result.content).toBe('hello world');
      expect(result.size).toBe(11);
    });

    it('throws for missing file', async () => {
      const dir = makeTempDir();
      await expect(readFileImpl({ path: 'missing.txt', cwd: dir })).rejects.toThrow();
    });
  });

  describe('writeFileImpl', () => {
    it('writes a file', async () => {
      const dir = makeTempDir();
      const result = await writeFileImpl({ path: 'out.txt', content: 'data', cwd: dir });
      expect(result.bytesWritten).toBe(4);

      const read = await readFileImpl({ path: 'out.txt', cwd: dir });
      expect(read.content).toBe('data');
    });
  });

  describe('patchFileImpl', () => {
    it('replaces text in a file', async () => {
      const dir = makeTempDir();
      writeFileSync(join(dir, 'file.ts'), 'const x = 1;\nconst y = 2;');

      const result = await patchFileImpl({
        path: 'file.ts',
        search: 'const x = 1',
        replace: 'const x = 42',
        cwd: dir,
      });
      expect(result.matched).toBe(true);
      expect(result.occurrences).toBe(1);

      const read = await readFileImpl({ path: 'file.ts', cwd: dir });
      expect(read.content).toContain('const x = 42');
    });

    it('reports no match', async () => {
      const dir = makeTempDir();
      writeFileSync(join(dir, 'file.ts'), 'hello');

      const result = await patchFileImpl({
        path: 'file.ts',
        search: 'nonexistent',
        replace: 'something',
        cwd: dir,
      });
      expect(result.matched).toBe(false);
    });
  });

  describe('listDirImpl', () => {
    it('lists directory contents', async () => {
      const dir = makeTempDir();
      writeFileSync(join(dir, 'a.txt'), 'aaa');
      writeFileSync(join(dir, 'b.txt'), 'bbb');
      mkdirSync(join(dir, 'sub'));

      const result = await listDirImpl({ path: '.', cwd: dir });
      expect(result.entries.length).toBe(3);

      const names = result.entries.map((e) => e.name);
      expect(names).toContain('a.txt');
      expect(names).toContain('b.txt');
      expect(names).toContain('sub');

      const subDir = result.entries.find((e) => e.name === 'sub');
      expect(subDir?.type).toBe('directory');
    });

    it('throws for nonexistent directory', async () => {
      await expect(listDirImpl({ path: '/nonexistent-dir-xyz' })).rejects.toThrow();
    });
  });
});
