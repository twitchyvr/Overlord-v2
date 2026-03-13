/**
 * Game Engine Tool Provider
 *
 * Auto-detects game engines from project files and runs engine-specific
 * build, test, and run commands.
 *
 * Supported engines: Unity, Unreal, Godot, GameMaker, Phaser
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { ok, err } from '../../core/contracts.js';
import { executeShell } from './shell.js';
import type { Result } from '../../core/contracts.js';

export type EngineType = 'unity' | 'unreal' | 'godot' | 'gamemaker' | 'phaser' | 'unknown';
export type EngineAction = 'detect' | 'build' | 'test' | 'run';

export interface GameEngineResult {
  engine: EngineType;
  action: EngineAction;
  success: boolean;
  output: string;
  artifacts: string[];
}

/**
 * Detect game engine from project files.
 */
export function detectEngine(projectDir: string): EngineType {
  // Unity: ProjectSettings.asset
  if (fs.existsSync(path.join(projectDir, 'ProjectSettings', 'ProjectSettings.asset'))) {
    return 'unity';
  }

  // Unreal: *.uproject
  try {
    const entries = fs.readdirSync(projectDir);
    if (entries.some(f => f.endsWith('.uproject'))) {
      return 'unreal';
    }
    // GameMaker: *.yyp
    if (entries.some(f => f.endsWith('.yyp'))) {
      return 'gamemaker';
    }
  } catch {
    // readdirSync can fail if path isn't a directory
  }

  // Godot: project.godot
  if (fs.existsSync(path.join(projectDir, 'project.godot'))) {
    return 'godot';
  }

  // Phaser: game.js or phaser in package.json dependencies
  if (fs.existsSync(path.join(projectDir, 'game.js'))) {
    return 'phaser';
  }
  const pkgPath = path.join(projectDir, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkgContent = fs.readFileSync(pkgPath, 'utf-8');
      const pkg = JSON.parse(pkgContent);
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      if (deps && typeof deps === 'object' && 'phaser' in deps) {
        return 'phaser';
      }
    } catch {
      // malformed package.json — not phaser
    }
  }

  return 'unknown';
}

const BUILD_COMMANDS: Record<EngineType, string> = {
  unity: 'unity -batchmode -quit -nographics -buildTarget StandaloneLinux64 -projectPath . -logFile -',
  unreal: 'ue4 BuildCookRun -project=. -noP4 -platform=Linux -clientconfig=Development -cook -build -stage -pak',
  godot: 'godot --export-release "Linux/X11" build/game',
  gamemaker: 'igor run',
  phaser: 'npm run build',
  unknown: '',
};

const TEST_COMMANDS: Record<EngineType, string> = {
  unity: 'unity -batchmode -quit -nographics -runTests -projectPath . -testResults results.xml',
  unreal: 'ue4 RunTests -project=.',
  godot: 'godot --headless --script res://tests/run_tests.gd',
  gamemaker: 'igor test',
  phaser: 'npm test',
  unknown: '',
};

const RUN_COMMANDS: Record<EngineType, string> = {
  unity: 'unity -projectPath .',
  unreal: 'ue4 Run -project=.',
  godot: 'godot --path .',
  gamemaker: 'igor run --config=Default',
  phaser: 'npm start',
  unknown: '',
};

export async function executeGameEngine(params: {
  action: EngineAction;
  projectDir: string;
  engine?: string;
}): Promise<Result<GameEngineResult>> {
  const { action, projectDir, engine: explicitEngine } = params;

  if (!fs.existsSync(projectDir)) {
    return err('NOT_FOUND', 'Project directory does not exist: ' + projectDir, { retryable: false });
  }

  const engine = (explicitEngine as EngineType) || detectEngine(projectDir);

  if (action === 'detect') {
    return ok({
      engine,
      action: 'detect',
      success: engine !== 'unknown',
      output: engine !== 'unknown'
        ? `Detected engine: ${engine}`
        : 'No supported game engine detected',
      artifacts: [],
    });
  }

  if (engine === 'unknown') {
    return err('ENGINE_NOT_DETECTED', 'No supported game engine detected in ' + projectDir, { retryable: false });
  }

  const commandMap: Record<EngineAction, Record<EngineType, string>> = {
    detect: BUILD_COMMANDS, // unused for detect, but keeps TS happy
    build: BUILD_COMMANDS,
    test: TEST_COMMANDS,
    run: RUN_COMMANDS,
  };

  const command = commandMap[action][engine];
  if (!command) {
    return err('NO_COMMAND', `No ${action} command for engine ${engine}`, { retryable: false });
  }

  try {
    const result = await executeShell({
      command,
      cwd: projectDir,
      timeout: 300_000,
    });

    const success = result.exitCode === 0;
    const output = result.stdout + (result.stderr ? '\n' + result.stderr : '');
    const artifacts: string[] = [];

    // Collect build artifacts for build action
    if (action === 'build' && success) {
      const buildDir = path.join(projectDir, 'build');
      if (fs.existsSync(buildDir)) {
        try {
          const files = fs.readdirSync(buildDir);
          artifacts.push(...files.map(f => path.join(buildDir, f)));
        } catch {
          // build dir not readable
        }
      }
    }

    return ok({
      engine,
      action,
      success,
      output: output.slice(0, 10_000),
      artifacts,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return err('ENGINE_ERROR', `Game engine ${action} failed: ${message}`, { retryable: true });
  }
}
