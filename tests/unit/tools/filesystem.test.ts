/**
 * Filesystem Tool Provider Tests
 *
 * Includes path traversal protection tests.
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
      const dir = makeTempDir();
      await expect(listDirImpl({ path: 'nonexistent-sub', cwd: dir })).rejects.toThrow();
    });
  });

  describe('path traversal protection', () => {
    // Use a non-temp cwd so paths outside it aren't auto-allowed by tmpdir logic
    const NON_TEMP_CWD = '/usr/local/overlord-test-fake';

    it('blocks absolute paths outside cwd', async () => {
      await expect(
        readFileImpl({ path: '/etc/passwd', cwd: NON_TEMP_CWD }),
      ).rejects.toThrow('Access denied');
    });

    it('blocks ../ traversal in readFileImpl', async () => {
      await expect(
        readFileImpl({ path: '../../../etc/passwd', cwd: NON_TEMP_CWD }),
      ).rejects.toThrow('Access denied');
    });

    it('blocks ../ traversal in writeFileImpl', async () => {
      await expect(
        writeFileImpl({ path: '../../evil.txt', content: 'pwned', cwd: NON_TEMP_CWD }),
      ).rejects.toThrow('Access denied');
    });

    it('blocks ../ traversal in patchFileImpl', async () => {
      await expect(
        patchFileImpl({ path: '../outside.txt', search: 'a', replace: 'b', cwd: NON_TEMP_CWD }),
      ).rejects.toThrow('Access denied');
    });

    it('blocks ../ traversal in listDirImpl', async () => {
      await expect(
        listDirImpl({ path: '../../', cwd: NON_TEMP_CWD }),
      ).rejects.toThrow('Access denied');
    });

    it('blocks sneaky traversal (subdir/../../..)', async () => {
      await expect(
        readFileImpl({ path: 'sub/../../..', cwd: NON_TEMP_CWD }),
      ).rejects.toThrow('Access denied');
    });

    it('blocks traversal disguised in nested path', async () => {
      await expect(
        readFileImpl({ path: 'a/b/c/../../../../etc/shadow', cwd: NON_TEMP_CWD }),
      ).rejects.toThrow('Access denied');
    });

    it('allows valid relative paths within cwd', async () => {
      const dir = makeTempDir();
      mkdirSync(join(dir, 'sub'));
      writeFileSync(join(dir, 'sub', 'ok.txt'), 'safe');

      const result = await readFileImpl({ path: 'sub/ok.txt', cwd: dir });
      expect(result.content).toBe('safe');
    });

    it('allows path that resolves to cwd itself', async () => {
      const dir = makeTempDir();
      writeFileSync(join(dir, 'file.txt'), 'data');
      mkdirSync(join(dir, 'sub'));

      // "sub/.." resolves back to cwd — listing cwd itself is fine
      const result = await listDirImpl({ path: 'sub/..', cwd: dir });
      expect(result.entries.length).toBeGreaterThan(0);
    });

    it('allows . path (current directory)', async () => {
      const dir = makeTempDir();
      writeFileSync(join(dir, 'test.txt'), 'hi');

      const result = await listDirImpl({ path: '.', cwd: dir });
      const names = result.entries.map((e) => e.name);
      expect(names).toContain('test.txt');
    });

    it('allows explicitly allowed paths outside cwd', async () => {
      const dir = makeTempDir();
      const extraDir = makeTempDir();
      writeFileSync(join(extraDir, 'shared.txt'), 'shared data');

      const result = await readFileImpl({
        path: join(extraDir, 'shared.txt'),
        cwd: dir,
        allowedPaths: [extraDir],
      });
      expect(result.content).toBe('shared data');
    });

    it('blocks .env files even within cwd', async () => {
      const dir = makeTempDir();
      writeFileSync(join(dir, '.env'), 'SECRET=123');

      await expect(
        readFileImpl({ path: '.env', cwd: dir }),
      ).rejects.toThrow('protected path');
    });
  });
});
