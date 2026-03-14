/**
 * Plugin Bundler Tests
 *
 * Tests exportBundle and importBundle for correct bundling,
 * validation, security checks, and round-trip integrity.
 * All filesystem interactions are mocked.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks ───

vi.mock('../../../src/core/logger.js', () => ({
  logger: {
    child: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  },
}));

const mockFs = {
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  readdirSync: vi.fn(),
  statSync: vi.fn(),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
};
vi.mock('node:fs', () => mockFs);

// ─── Helpers ───

function sampleManifest(overrides: Record<string, unknown> = {}) {
  return {
    id: 'test-plugin',
    name: 'Test Plugin',
    version: '1.0.0',
    description: 'A test plugin',
    engine: 'lua',
    entrypoint: 'main.lua',
    permissions: [],
    ...overrides,
  };
}

function makeBundle(overrides: Record<string, unknown> = {}) {
  const bundle = {
    version: 1,
    manifest: sampleManifest(),
    files: { 'main.lua': '-- hello world' },
    ...overrides,
  };
  return Buffer.from(JSON.stringify(bundle), 'utf-8').toString('base64');
}

function setupExportableDirMocks(manifest = sampleManifest(), files: Record<string, string> = { 'main.lua': '-- hello' }) {
  mockFs.existsSync.mockReturnValue(true);
  mockFs.readFileSync.mockImplementation((filePath: string) => {
    if (filePath.endsWith('plugin.json')) {
      return JSON.stringify(manifest);
    }
    const filename = filePath.split('/').pop() ?? '';
    if (files[filename] !== undefined) {
      return files[filename];
    }
    throw new Error(`ENOENT: ${filePath}`);
  });
  mockFs.readdirSync.mockReturnValue(Object.keys(files));
  mockFs.statSync.mockReturnValue({ isFile: () => true });
}

// ─── Re-import module per test to reset module-level state ───

let exportBundle: typeof import('../../../src/plugins/plugin-bundler.js').exportBundle;
let importBundle: typeof import('../../../src/plugins/plugin-bundler.js').importBundle;

describe('Plugin Bundler', () => {
  beforeEach(async () => {
    vi.resetModules();
    mockFs.existsSync.mockReset();
    mockFs.readFileSync.mockReset();
    mockFs.readdirSync.mockReset();
    mockFs.statSync.mockReset();
    mockFs.mkdirSync.mockReset();
    mockFs.writeFileSync.mockReset();

    const mod = await import('../../../src/plugins/plugin-bundler.js');
    exportBundle = mod.exportBundle;
    importBundle = mod.importBundle;
  });

  // ─── exportBundle ───

  describe('exportBundle', () => {
    it('returns error for non-existent directory', () => {
      mockFs.existsSync.mockReturnValue(false);

      const result = exportBundle('/plugins/missing');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('BUNDLE_DIR_NOT_FOUND');
      }
    });

    it('returns error for missing plugin.json', () => {
      mockFs.existsSync.mockImplementation((p: string) => {
        if (p.endsWith('plugin.json')) return false;
        return true;
      });

      const result = exportBundle('/plugins/no-manifest');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('BUNDLE_NO_MANIFEST');
      }
    });

    it('returns error for missing entrypoint file', () => {
      // Directory and plugin.json exist, but entrypoint main.lua is not among the files
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockImplementation((filePath: string) => {
        if (filePath.endsWith('plugin.json')) {
          return JSON.stringify(sampleManifest({ entrypoint: 'main.lua' }));
        }
        // Return content for the README that IS present
        return '# Readme';
      });
      // Directory only contains a .md file — no .lua entrypoint
      mockFs.readdirSync.mockReturnValue(['README.md']);
      mockFs.statSync.mockReturnValue({ isFile: () => true });

      const result = exportBundle('/plugins/no-entry');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('BUNDLE_MISSING_ENTRYPOINT');
      }
    });

    it('exports valid bundle with all files', () => {
      const files = {
        'main.lua': '-- main script',
        'config.json': '{"key":"value"}',
      };
      setupExportableDirMocks(sampleManifest(), files);

      const result = exportBundle('/plugins/test-plugin');
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      // Decode the bundle and verify contents
      const decoded = JSON.parse(Buffer.from(result.data, 'base64').toString('utf-8'));
      expect(decoded.version).toBe(1);
      expect(decoded.manifest.id).toBe('test-plugin');
      expect(decoded.files['main.lua']).toBe('-- main script');
      expect(decoded.files['config.json']).toBe('{"key":"value"}');
    });

    it('only includes allowed file extensions', () => {
      // Directory listing includes an allowed .lua and a disallowed .exe
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockImplementation((filePath: string) => {
        if (filePath.endsWith('plugin.json')) {
          return JSON.stringify(sampleManifest());
        }
        return '-- content';
      });
      mockFs.readdirSync.mockReturnValue(['main.lua', 'hack.exe', 'notes.md']);
      mockFs.statSync.mockReturnValue({ isFile: () => true });

      const result = exportBundle('/plugins/test-plugin');
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const decoded = JSON.parse(Buffer.from(result.data, 'base64').toString('utf-8'));
      expect(Object.keys(decoded.files)).toContain('main.lua');
      expect(Object.keys(decoded.files)).toContain('notes.md');
      expect(Object.keys(decoded.files)).not.toContain('hack.exe');
    });

    it('returns error when manifest JSON is unparseable', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue('not valid json {{{');

      const result = exportBundle('/plugins/bad-json');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('BUNDLE_MANIFEST_ERROR');
      }
    });

    it('skips non-file entries (directories) in the plugin dir', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockImplementation((filePath: string) => {
        if (filePath.endsWith('plugin.json')) {
          return JSON.stringify(sampleManifest());
        }
        return '-- lua code';
      });
      mockFs.readdirSync.mockReturnValue(['main.lua', 'subdir.lua']);
      mockFs.statSync.mockImplementation((filePath: string) => ({
        isFile: () => !filePath.endsWith('subdir.lua'),
      }));

      const result = exportBundle('/plugins/test-plugin');
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const decoded = JSON.parse(Buffer.from(result.data, 'base64').toString('utf-8'));
      expect(Object.keys(decoded.files)).toEqual(['main.lua']);
    });
  });

  // ─── importBundle ───

  describe('importBundle', () => {
    it('returns error for oversized bundle', () => {
      // Create a string exceeding 5MB
      const oversized = 'A'.repeat(5 * 1024 * 1024 + 1);

      const result = importBundle(oversized, '/plugins');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('BUNDLE_TOO_LARGE');
      }
    });

    it('returns error for invalid base64', () => {
      // Not valid base64 — will decode to garbled non-JSON
      const result = importBundle('!!!not-base64!!!', '/plugins');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('BUNDLE_DECODE_ERROR');
      }
    });

    it('returns error for missing version/manifest/files', () => {
      const incomplete = Buffer.from(JSON.stringify({ version: 1 }), 'utf-8').toString('base64');

      const result = importBundle(incomplete, '/plugins');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('BUNDLE_INVALID');
      }
    });

    it('returns error for wrong bundle version', () => {
      const wrongVersion = makeBundle({ version: 99 });

      const result = importBundle(wrongVersion, '/plugins');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('BUNDLE_VERSION_MISMATCH');
        expect(result.error.message).toContain('99');
      }
    });

    it('returns error for disallowed file extension', () => {
      const badFile = makeBundle({
        files: { 'main.lua': '-- ok', 'trojan.exe': 'malicious' },
      });

      const result = importBundle(badFile, '/plugins');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('BUNDLE_INVALID_FILE');
        expect(result.error.message).toContain('trojan.exe');
      }
    });

    it('returns error for path traversal attempt', () => {
      // Use an allowed extension so the extension check passes first
      const traversal = makeBundle({
        files: { 'main.lua': '-- ok', '../../../etc/config.json': 'pwned' },
      });

      const result = importBundle(traversal, '/plugins');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('BUNDLE_INVALID_PATH');
      }
    });

    it('returns error for path traversal via backslash', () => {
      // Use an allowed extension so the extension check passes first
      const traversal = makeBundle({
        files: { 'main.lua': '-- ok', '..\\..\\etc\\config.json': 'pwned' },
      });

      const result = importBundle(traversal, '/plugins');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('BUNDLE_INVALID_PATH');
      }
    });

    it('returns error for path with forward slash', () => {
      const slashPath = makeBundle({
        files: { 'main.lua': '-- ok', 'sub/file.lua': 'nested' },
      });

      const result = importBundle(slashPath, '/plugins');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('BUNDLE_INVALID_PATH');
      }
    });

    it('returns error when manifest is missing required fields', () => {
      const noId = makeBundle({
        manifest: { name: 'No ID', version: '1.0.0', entrypoint: 'main.lua' },
      });

      const result = importBundle(noId, '/plugins');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('BUNDLE_INVALID_MANIFEST');
      }
    });

    it('returns error when entrypoint is missing from bundle files', () => {
      const missingEntry = makeBundle({
        manifest: sampleManifest({ entrypoint: 'missing.lua' }),
        files: { 'main.lua': '-- not the entrypoint' },
      });

      const result = importBundle(missingEntry, '/plugins');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('BUNDLE_MISSING_ENTRYPOINT');
      }
    });

    it('successfully imports valid bundle', () => {
      mockFs.mkdirSync.mockReturnValue(undefined);
      mockFs.writeFileSync.mockReturnValue(undefined);

      const bundle = makeBundle();
      const result = importBundle(bundle, '/plugins');

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.data.id).toBe('test-plugin');
      expect(result.data.name).toBe('Test Plugin');

      // Verify mkdirSync was called for the target directory
      expect(mockFs.mkdirSync).toHaveBeenCalledWith(
        expect.stringContaining('test-plugin'),
        { recursive: true },
      );

      // Verify plugin.json was written
      expect(mockFs.writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining('plugin.json'),
        expect.any(String),
        'utf-8',
      );

      // Verify the entrypoint file was written
      expect(mockFs.writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining('main.lua'),
        '-- hello world',
        'utf-8',
      );
    });

    it('returns error when mkdirSync fails', () => {
      mockFs.mkdirSync.mockImplementation(() => { throw new Error('EACCES'); });

      const bundle = makeBundle();
      const result = importBundle(bundle, '/plugins');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('BUNDLE_WRITE_ERROR');
      }
    });

    it('returns error when writeFileSync fails', () => {
      mockFs.mkdirSync.mockReturnValue(undefined);
      mockFs.writeFileSync.mockImplementation(() => { throw new Error('ENOSPC'); });

      const bundle = makeBundle();
      const result = importBundle(bundle, '/plugins');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('BUNDLE_WRITE_ERROR');
      }
    });
  });

  // ─── Round-trip ───

  describe('round-trip', () => {
    it('export then import produces same manifest', () => {
      const manifest = sampleManifest();
      const files = {
        'main.lua': '-- main script\nprint("hello")',
        'config.json': '{"setting": true}',
        'README.md': '# My Plugin',
      };
      setupExportableDirMocks(manifest, files);

      // Export
      const exportResult = exportBundle('/plugins/test-plugin');
      expect(exportResult.ok).toBe(true);
      if (!exportResult.ok) return;

      // Import the exported bundle
      mockFs.mkdirSync.mockReturnValue(undefined);
      mockFs.writeFileSync.mockReturnValue(undefined);

      const importResult = importBundle(exportResult.data, '/target');
      expect(importResult.ok).toBe(true);
      if (!importResult.ok) return;

      // Manifest should match
      expect(importResult.data.id).toBe(manifest.id);
      expect(importResult.data.name).toBe(manifest.name);
      expect(importResult.data.version).toBe(manifest.version);
      expect(importResult.data.entrypoint).toBe(manifest.entrypoint);
      expect(importResult.data.engine).toBe(manifest.engine);

      // Verify all files were written (plugin.json + the 3 content files)
      expect(mockFs.writeFileSync).toHaveBeenCalledTimes(4);

      // Verify file contents match what was exported
      const writeCalls = mockFs.writeFileSync.mock.calls;
      const writtenFiles: Record<string, string> = {};
      for (const call of writeCalls) {
        const filePath = call[0] as string;
        const content = call[1] as string;
        const filename = filePath.split('/').pop() ?? '';
        writtenFiles[filename] = content;
      }

      expect(writtenFiles['main.lua']).toBe('-- main script\nprint("hello")');
      expect(writtenFiles['config.json']).toBe('{"setting": true}');
      expect(writtenFiles['README.md']).toBe('# My Plugin');
    });
  });
});
