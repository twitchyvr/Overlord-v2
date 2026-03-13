import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import { executeGameEngine, detectEngine } from '../../../src/tools/providers/game-engine.js';

vi.mock('../../../src/tools/providers/shell.js', () => ({ executeShell: vi.fn() }));
vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return { ...actual, existsSync: vi.fn(), readdirSync: vi.fn(), readFileSync: vi.fn() };
});

import { executeShell } from '../../../src/tools/providers/shell.js';
const mockShell = vi.mocked(executeShell);
const mockExists = vi.mocked(fs.existsSync);
const mockReaddir = vi.mocked(fs.readdirSync);
const mockReadFile = vi.mocked(fs.readFileSync);

beforeEach(() => { vi.clearAllMocks(); });

describe('Game Engine Tool', () => {
  describe('detectEngine', () => {
    it('detects Unity via ProjectSettings.asset', () => {
      mockExists.mockImplementation((p: fs.PathLike) => String(p).endsWith('ProjectSettings.asset'));
      expect(detectEngine('/project')).toBe('unity');
    });

    it('detects Unreal via .uproject file', () => {
      mockExists.mockReturnValue(false);
      mockReaddir.mockReturnValue(['MyGame.uproject', 'Content'] as unknown as fs.Dirent[]);
      expect(detectEngine('/project')).toBe('unreal');
    });

    it('detects Godot via project.godot', () => {
      mockExists.mockImplementation((p: fs.PathLike) => String(p).endsWith('project.godot'));
      mockReaddir.mockReturnValue([] as unknown as fs.Dirent[]);
      expect(detectEngine('/project')).toBe('godot');
    });

    it('detects GameMaker via .yyp file', () => {
      mockExists.mockReturnValue(false);
      mockReaddir.mockReturnValue(['game.yyp', 'sprites'] as unknown as fs.Dirent[]);
      expect(detectEngine('/project')).toBe('gamemaker');
    });

    it('detects Phaser via game.js', () => {
      mockExists.mockImplementation((p: fs.PathLike) => {
        const s = String(p);
        return s.endsWith('game.js');
      });
      mockReaddir.mockReturnValue([] as unknown as fs.Dirent[]);
      expect(detectEngine('/project')).toBe('phaser');
    });

    it('detects Phaser via package.json dependency', () => {
      mockExists.mockImplementation((p: fs.PathLike) => {
        const s = String(p);
        return s.endsWith('package.json');
      });
      mockReaddir.mockReturnValue([] as unknown as fs.Dirent[]);
      mockReadFile.mockReturnValue(JSON.stringify({ dependencies: { phaser: '^3.60.0' } }));
      expect(detectEngine('/project')).toBe('phaser');
    });

    it('returns unknown when no engine detected', () => {
      mockExists.mockReturnValue(false);
      mockReaddir.mockReturnValue([] as unknown as fs.Dirent[]);
      expect(detectEngine('/project')).toBe('unknown');
    });

    it('returns unknown on readdirSync error', () => {
      mockExists.mockReturnValue(false);
      mockReaddir.mockImplementation(() => { throw new Error('ENOENT'); });
      expect(detectEngine('/project')).toBe('unknown');
    });
  });

  describe('detect action', () => {
    it('returns detected engine', async () => {
      mockExists.mockImplementation((p: fs.PathLike) => {
        const s = String(p);
        return s.endsWith('project.godot') || s === '/project';
      });
      mockReaddir.mockReturnValue([] as unknown as fs.Dirent[]);
      const r = await executeGameEngine({ action: 'detect', projectDir: '/project' });
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.data.engine).toBe('godot');
        expect(r.data.success).toBe(true);
        expect(r.data.action).toBe('detect');
      }
    });

    it('returns unknown detection', async () => {
      mockExists.mockImplementation((p: fs.PathLike) => String(p) === '/project');
      mockReaddir.mockReturnValue([] as unknown as fs.Dirent[]);
      const r = await executeGameEngine({ action: 'detect', projectDir: '/project' });
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.data.engine).toBe('unknown');
        expect(r.data.success).toBe(false);
      }
    });
  });

  describe('build action', () => {
    it('runs build command for detected engine', async () => {
      mockExists.mockImplementation((p: fs.PathLike) => {
        const s = String(p);
        return s.endsWith('project.godot') || s === '/project';
      });
      mockReaddir.mockReturnValue([] as unknown as fs.Dirent[]);
      mockShell.mockResolvedValue({ stdout: 'Build complete', stderr: '', exitCode: 0, timedOut: false });

      const r = await executeGameEngine({ action: 'build', projectDir: '/project' });
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.data.engine).toBe('godot');
        expect(r.data.success).toBe(true);
        expect(r.data.action).toBe('build');
      }
      expect(mockShell).toHaveBeenCalledWith(expect.objectContaining({
        command: expect.stringContaining('godot'),
        cwd: '/project',
      }));
    });

    it('reports failure on non-zero exit', async () => {
      mockExists.mockImplementation((p: fs.PathLike) => {
        const s = String(p);
        return s.endsWith('project.godot') || s === '/project';
      });
      mockReaddir.mockReturnValue([] as unknown as fs.Dirent[]);
      mockShell.mockResolvedValue({ stdout: '', stderr: 'Error: build failed', exitCode: 1, timedOut: false });

      const r = await executeGameEngine({ action: 'build', projectDir: '/project' });
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.data.success).toBe(false);
      }
    });

    it('uses explicit engine override', async () => {
      mockExists.mockImplementation((p: fs.PathLike) => String(p) === '/project');
      mockReaddir.mockReturnValue([] as unknown as fs.Dirent[]);
      mockShell.mockResolvedValue({ stdout: 'OK', stderr: '', exitCode: 0, timedOut: false });

      const r = await executeGameEngine({ action: 'build', projectDir: '/project', engine: 'phaser' });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.data.engine).toBe('phaser');
      expect(mockShell).toHaveBeenCalledWith(expect.objectContaining({
        command: 'npm run build',
      }));
    });
  });

  describe('error handling', () => {
    it('rejects non-existent directory', async () => {
      mockExists.mockReturnValue(false);
      const r = await executeGameEngine({ action: 'detect', projectDir: '/nonexistent' });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe('NOT_FOUND');
    });

    it('returns error when no engine detected for build', async () => {
      mockExists.mockImplementation((p: fs.PathLike) => String(p) === '/project');
      mockReaddir.mockReturnValue([] as unknown as fs.Dirent[]);
      const r = await executeGameEngine({ action: 'build', projectDir: '/project' });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe('ENGINE_NOT_DETECTED');
    });

    it('catches shell execution errors', async () => {
      mockExists.mockImplementation((p: fs.PathLike) => {
        const s = String(p);
        return s.endsWith('project.godot') || s === '/project';
      });
      mockReaddir.mockReturnValue([] as unknown as fs.Dirent[]);
      mockShell.mockRejectedValue(new Error('Shell crashed'));

      const r = await executeGameEngine({ action: 'build', projectDir: '/project' });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe('ENGINE_ERROR');
    });
  });

  describe('test action', () => {
    it('runs test command for engine', async () => {
      mockExists.mockImplementation((p: fs.PathLike) => {
        const s = String(p);
        return s.endsWith('project.godot') || s === '/project';
      });
      mockReaddir.mockReturnValue([] as unknown as fs.Dirent[]);
      mockShell.mockResolvedValue({ stdout: 'All tests passed', stderr: '', exitCode: 0, timedOut: false });

      const r = await executeGameEngine({ action: 'test', projectDir: '/project' });
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.data.action).toBe('test');
        expect(r.data.success).toBe(true);
      }
    });
  });

  describe('run action', () => {
    it('runs run command for engine', async () => {
      mockExists.mockImplementation((p: fs.PathLike) => {
        const s = String(p);
        return s.endsWith('project.godot') || s === '/project';
      });
      mockReaddir.mockReturnValue([] as unknown as fs.Dirent[]);
      mockShell.mockResolvedValue({ stdout: 'Running...', stderr: '', exitCode: 0, timedOut: false });

      const r = await executeGameEngine({ action: 'run', projectDir: '/project' });
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.data.action).toBe('run');
        expect(r.data.success).toBe(true);
      }
    });
  });
});
