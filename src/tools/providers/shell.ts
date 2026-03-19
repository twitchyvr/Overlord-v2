/**
 * Shell Tool Provider
 *
 * Executes bash commands in a child process.
 * Timeout, max output size, and working directory constraints.
 */

import { spawn } from 'node:child_process';
import { logger } from '../../core/logger.js';
import { config } from '../../core/config.js';

const log = logger.child({ module: 'tool:shell' });

const DEFAULT_TIMEOUT = config.get('SHELL_TIMEOUT_MS');
const MAX_OUTPUT = config.get('SHELL_MAX_OUTPUT');

interface ShellResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
}

export async function executeShell(params: {
  command: string;
  cwd?: string;
  timeout?: number;
}): Promise<ShellResult> {
  const { command, cwd = process.cwd(), timeout = DEFAULT_TIMEOUT } = params;

  log.debug({ command, cwd }, 'Executing shell command');

  return new Promise((resolve) => {
    const proc = spawn('bash', ['-c', command], {
      cwd,
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    proc.stdout.on('data', (data: Buffer) => {
      const chunk = data.toString();
      if (stdout.length + chunk.length <= MAX_OUTPUT) {
        stdout += chunk;
      }
    });

    proc.stderr.on('data', (data: Buffer) => {
      const chunk = data.toString();
      if (stderr.length + chunk.length <= MAX_OUTPUT) {
        stderr += chunk;
      }
    });

    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill('SIGTERM');
    }, timeout);

    proc.on('close', (code) => {
      clearTimeout(timer);
      const exitCode = code ?? 1;
      log.debug({ exitCode, timedOut, stdoutLen: stdout.length }, 'Shell command completed');
      resolve({ stdout, stderr, exitCode, timedOut });
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      log.error({ err }, 'Shell command error');
      resolve({ stdout: '', stderr: err.message, exitCode: 1, timedOut: false });
    });
  });
}
