/**
 * Built-In Plugin Manifest Validation
 *
 * Ensures all 26 built-in Lua scripts have valid manifests,
 * correct structure, and their entrypoint files exist.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const BUILT_IN_DIR = path.resolve('plugins/built-in');

// Valid permissions per the PluginPermission type
const VALID_PERMISSIONS = new Set([
  'room:read', 'room:write', 'tool:execute', 'agent:read',
  'bus:emit', 'storage:read', 'storage:write', 'fs:read', 'fs:write', 'net:http',
]);

// Valid lifecycle hooks
const VALID_HOOKS = ['onLoad', 'onUnload', 'onRoomEnter', 'onRoomExit', 'onToolExecute', 'onPhaseAdvance'];

// Regex for valid plugin IDs (kebab-case)
const ID_PATTERN = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

// Regex for valid semver versions
const VERSION_PATTERN = /^\d+\.\d+\.\d+(-[a-zA-Z0-9.]+)?$/;

// ── Discover all built-in plugins ──

function getBuiltInPluginDirs(): string[] {
  if (!fs.existsSync(BUILT_IN_DIR)) return [];
  return fs.readdirSync(BUILT_IN_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name)
    .sort();
}

function readManifest(pluginName: string): Record<string, unknown> {
  const manifestPath = path.join(BUILT_IN_DIR, pluginName, 'plugin.json');
  const raw = fs.readFileSync(manifestPath, 'utf-8');
  return JSON.parse(raw);
}

// ── Tests ──

describe('Built-In Plugin Library', () => {

  const pluginDirs = getBuiltInPluginDirs();

  it('has at least 20 built-in plugins', () => {
    expect(pluginDirs.length).toBeGreaterThanOrEqual(20);
  });

  describe('each plugin has required files', () => {
    for (const dir of pluginDirs) {
      describe(dir, () => {
        const pluginPath = path.join(BUILT_IN_DIR, dir);

        it('has plugin.json', () => {
          expect(fs.existsSync(path.join(pluginPath, 'plugin.json'))).toBe(true);
        });

        it('has main.lua entrypoint', () => {
          expect(fs.existsSync(path.join(pluginPath, 'main.lua'))).toBe(true);
        });

        it('has README.md', () => {
          expect(fs.existsSync(path.join(pluginPath, 'README.md'))).toBe(true);
        });
      });
    }
  });

  describe('each manifest is valid', () => {
    for (const dir of pluginDirs) {
      describe(dir, () => {
        let manifest: Record<string, unknown>;

        try {
          manifest = readManifest(dir);
        } catch {
          it('has parseable JSON', () => {
            expect.fail(`plugin.json in ${dir} is not valid JSON`);
          });
          return;
        }

        it('has required fields', () => {
          expect(manifest).toHaveProperty('id');
          expect(manifest).toHaveProperty('name');
          expect(manifest).toHaveProperty('version');
          expect(manifest).toHaveProperty('description');
          expect(manifest).toHaveProperty('engine');
          expect(manifest).toHaveProperty('entrypoint');
          expect(manifest).toHaveProperty('permissions');
        });

        it('has valid kebab-case id', () => {
          expect(typeof manifest.id).toBe('string');
          expect(manifest.id).toMatch(ID_PATTERN);
        });

        it('has id matching directory name', () => {
          expect(manifest.id).toBe(dir);
        });

        it('has non-empty name and description', () => {
          expect(typeof manifest.name).toBe('string');
          expect((manifest.name as string).length).toBeGreaterThan(0);
          expect(typeof manifest.description).toBe('string');
          expect((manifest.description as string).length).toBeGreaterThan(0);
        });

        it('has valid semver version', () => {
          expect(typeof manifest.version).toBe('string');
          expect(manifest.version).toMatch(VERSION_PATTERN);
        });

        it('uses lua engine', () => {
          expect(manifest.engine).toBe('lua');
        });

        it('has entrypoint set to main.lua', () => {
          expect(manifest.entrypoint).toBe('main.lua');
        });

        it('has valid permissions array', () => {
          expect(Array.isArray(manifest.permissions)).toBe(true);
          const perms = manifest.permissions as string[];
          for (const p of perms) {
            expect(VALID_PERMISSIONS).toContain(p);
          }
        });

        it('has Overlord Team as author', () => {
          expect(manifest.author).toBe('Overlord Team');
        });
      });
    }
  });

  describe('main.lua files have substance', () => {
    for (const dir of pluginDirs) {
      it(`${dir}/main.lua is not empty and registers hooks`, () => {
        const luaPath = path.join(BUILT_IN_DIR, dir, 'main.lua');
        const content = fs.readFileSync(luaPath, 'utf-8');

        // Must have content
        expect(content.length).toBeGreaterThan(50);

        // Must register at least one hook
        expect(content).toContain('registerHook');

        // Must use the overlord API
        expect(content).toContain('overlord.');
      });
    }
  });

  describe('README.md files are descriptive', () => {
    for (const dir of pluginDirs) {
      it(`${dir}/README.md has title and description`, () => {
        const readmePath = path.join(BUILT_IN_DIR, dir, 'README.md');
        const content = fs.readFileSync(readmePath, 'utf-8');

        // Must start with a heading
        expect(content).toMatch(/^#\s+/);

        // Must have some substance
        expect(content.length).toBeGreaterThan(100);
      });
    }
  });

  describe('no duplicate plugin IDs', () => {
    it('all plugin IDs are unique', () => {
      const ids = pluginDirs.map(dir => {
        try {
          return readManifest(dir).id as string;
        } catch {
          return dir;
        }
      });
      const unique = new Set(ids);
      expect(unique.size).toBe(ids.length);
    });
  });

  describe('category coverage', () => {
    const allIds = pluginDirs;

    const agentScripts = allIds.filter(id =>
      id.includes('agent') || id.includes('assign') || id.includes('handoff') || id.includes('mood')
    );
    const projectScripts = allIds.filter(id =>
      id.includes('standup') || id.includes('progress') || id.includes('deadline') ||
      id.includes('scope') || id.includes('estimator')
    );
    const codeScripts = allIds.filter(id =>
      id.includes('todo') || id.includes('changelog') || id.includes('dependency') ||
      id.includes('complexity')
    );
    const roomScripts = allIds.filter(id =>
      id.includes('phase') || id.includes('room') || id.includes('exit-doc')
    );
    const commScripts = allIds.filter(id =>
      id.includes('email') || id.includes('escalation') || id.includes('raid')
    );

    it('has agent enhancement scripts', () => {
      expect(agentScripts.length).toBeGreaterThanOrEqual(3);
    });

    it('has project management scripts', () => {
      expect(projectScripts.length).toBeGreaterThanOrEqual(3);
    });

    it('has code quality scripts', () => {
      expect(codeScripts.length).toBeGreaterThanOrEqual(3);
    });

    it('has room & phase scripts', () => {
      expect(roomScripts.length).toBeGreaterThanOrEqual(3);
    });

    it('has communication scripts', () => {
      expect(commScripts.length).toBeGreaterThanOrEqual(3);
    });
  });
});
