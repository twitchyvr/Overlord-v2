/**
 * Dev Server Tool Provider
 *
 * Spawns background dev server processes, tracks them by project directory,
 * and provides lifecycle management (start, stop, status, logs).
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { logger } from '../../core/logger.js';
import { ok, err } from '../../core/contracts.js';
import type { Result } from '../../core/contracts.js';

const log = logger.child({ module: 'tool:dev-server' });

export type DevServerAction = 'start' | 'stop' | 'status' | 'logs';

export interface ServerEntry {
  pid: number;
  process: ChildProcess;
  projectDir: string;
  command: string;
  port: number;
  startedAt: string;
  stdout: string[];
  stderr: string[];
}

export interface DevServerResult {
  action: DevServerAction;
  projectDir: string;
  pid?: number;
  port?: number;
  url?: string;
  running?: boolean;
  output?: string;
}

/** Maximum lines of stdout/stderr to retain per server */
const MAX_LOG_LINES = 500;

/** Active server processes indexed by projectDir */
const servers = new Map<string, ServerEntry>();

/**
 * Exposed for testing: get the internal server map.
 */
export function getServerMap(): Map<string, ServerEntry> {
  return servers;
}

/**
 * Check if a process is still alive by sending signal 0.
 */
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function executeDevServer(params: {
  action: DevServerAction;
  projectDir: string;
  command?: string;
  port?: number;
}): Promise<Result<DevServerResult>> {
  const { action, projectDir, command, port = 3000 } = params;

  switch (action) {
    case 'start':
      return startServer(projectDir, command || 'npm run dev', port);
    case 'stop':
      return stopServer(projectDir);
    case 'status':
      return serverStatus(projectDir);
    case 'logs':
      return serverLogs(projectDir);
    default:
      return err('INVALID_ACTION', `Unknown dev_server action: ${action}`, { retryable: false });
  }
}

function startServer(projectDir: string, command: string, port: number): Result<DevServerResult> {
  // Check if already running
  const existing = servers.get(projectDir);
  if (existing && isProcessAlive(existing.pid)) {
    return err('ALREADY_RUNNING', `Server already running for ${projectDir} (PID ${existing.pid})`, { retryable: false });
  }

  log.info({ projectDir, command, port }, 'Starting dev server');

  const proc = spawn('bash', ['-c', command], {
    cwd: projectDir,
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });

  const entry: ServerEntry = {
    pid: proc.pid!,
    process: proc,
    projectDir,
    command,
    port,
    startedAt: new Date().toISOString(),
    stdout: [],
    stderr: [],
  };

  proc.stdout?.on('data', (data: Buffer) => {
    const line = data.toString().trimEnd();
    entry.stdout.push(line);
    if (entry.stdout.length > MAX_LOG_LINES) {
      entry.stdout.shift();
    }
  });

  proc.stderr?.on('data', (data: Buffer) => {
    const line = data.toString().trimEnd();
    entry.stderr.push(line);
    if (entry.stderr.length > MAX_LOG_LINES) {
      entry.stderr.shift();
    }
  });

  proc.on('close', (code) => {
    log.info({ projectDir, pid: entry.pid, exitCode: code }, 'Dev server exited');
    servers.delete(projectDir);
  });

  proc.on('error', (error) => {
    log.error({ projectDir, pid: entry.pid, error: error.message }, 'Dev server error');
    servers.delete(projectDir);
  });

  // Unref so the parent process can exit even if the server is running
  proc.unref();

  servers.set(projectDir, entry);

  return ok({
    action: 'start',
    projectDir,
    pid: entry.pid,
    port,
    url: `http://localhost:${port}`,
    running: true,
  });
}

function stopServer(projectDir: string): Result<DevServerResult> {
  const entry = servers.get(projectDir);
  if (!entry) {
    return err('NOT_RUNNING', `No server running for ${projectDir}`, { retryable: false });
  }

  log.info({ projectDir, pid: entry.pid }, 'Stopping dev server');

  try {
    // Kill the process group (negative PID) to also kill children
    process.kill(-entry.pid, 'SIGTERM');
  } catch {
    // Process may already be dead
    try {
      process.kill(entry.pid, 'SIGTERM');
    } catch {
      // already dead
    }
  }

  servers.delete(projectDir);

  return ok({
    action: 'stop',
    projectDir,
    pid: entry.pid,
    running: false,
  });
}

function serverStatus(projectDir: string): Result<DevServerResult> {
  const entry = servers.get(projectDir);
  if (!entry) {
    return ok({
      action: 'status',
      projectDir,
      running: false,
    });
  }

  const alive = isProcessAlive(entry.pid);
  if (!alive) {
    servers.delete(projectDir);
  }

  return ok({
    action: 'status',
    projectDir,
    pid: entry.pid,
    port: entry.port,
    url: `http://localhost:${entry.port}`,
    running: alive,
  });
}

function serverLogs(projectDir: string): Result<DevServerResult> {
  const entry = servers.get(projectDir);
  if (!entry) {
    return err('NOT_RUNNING', `No server running for ${projectDir}`, { retryable: false });
  }

  const stdout = entry.stdout.slice(-50).join('\n');
  const stderr = entry.stderr.slice(-50).join('\n');
  const output = [
    stdout ? `=== stdout ===\n${stdout}` : '',
    stderr ? `=== stderr ===\n${stderr}` : '',
  ].filter(Boolean).join('\n\n') || '(no output)';

  return ok({
    action: 'logs',
    projectDir,
    pid: entry.pid,
    port: entry.port,
    running: isProcessAlive(entry.pid),
    output,
  });
}
