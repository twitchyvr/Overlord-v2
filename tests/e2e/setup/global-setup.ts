/**
 * Overlord v2 — Playwright Global Setup
 *
 * 1. Delete existing database for a clean test run
 * 2. Build TypeScript (if dist/ is stale)
 * 3. Start the Overlord v2 server on port 4000
 * 4. Wait for HTTP /health endpoint to respond
 * 5. Store the server process reference for teardown
 */

import { type FullConfig } from '@playwright/test';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';

const PROJECT_ROOT = path.resolve(import.meta.dirname, '..', '..', '..');
const DB_PATH = path.join(PROJECT_ROOT, 'data', 'overlord.db');
const DB_WAL = DB_PATH + '-wal';
const DB_SHM = DB_PATH + '-shm';
const SERVER_URL = 'http://localhost:4000';
const HEALTH_URL = `${SERVER_URL}/health`;
const MAX_WAIT_MS = 30_000;
const POLL_INTERVAL_MS = 500;

// Store server process globally so teardown can access it
declare global {
  // eslint-disable-next-line no-var
  var __OVERLORD_SERVER_PROCESS__: ChildProcess | undefined;
}

/**
 * Poll the /health endpoint until it responds with 200.
 */
function waitForServer(timeoutMs: number): Promise<void> {
  const startTime = Date.now();

  return new Promise((resolve, reject) => {
    const check = () => {
      if (Date.now() - startTime > timeoutMs) {
        reject(new Error(`Server did not become ready within ${timeoutMs}ms`));
        return;
      }

      http
        .get(HEALTH_URL, (res) => {
          if (res.statusCode === 200) {
            resolve();
          } else {
            setTimeout(check, POLL_INTERVAL_MS);
          }
        })
        .on('error', () => {
          setTimeout(check, POLL_INTERVAL_MS);
        });
    };

    check();
  });
}

export default async function globalSetup(_config: FullConfig): Promise<void> {
  console.log('\n[E2E Setup] Preparing test environment...');

  // 1. Delete existing database for a clean slate
  for (const file of [DB_PATH, DB_WAL, DB_SHM]) {
    if (fs.existsSync(file)) {
      fs.unlinkSync(file);
      console.log(`[E2E Setup] Deleted: ${path.relative(PROJECT_ROOT, file)}`);
    }
  }

  // Ensure data directory exists
  const dataDir = path.dirname(DB_PATH);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  // 2. Build TypeScript if dist/ is missing or stale
  const distDir = path.join(PROJECT_ROOT, 'dist');
  const srcDir = path.join(PROJECT_ROOT, 'src');

  let needsBuild = !fs.existsSync(distDir);
  if (!needsBuild) {
    // Check if any src file is newer than dist/server.js
    const distServerStat = fs.statSync(path.join(distDir, 'server.js'), { throwIfNoEntry: false });
    if (!distServerStat) {
      needsBuild = true;
    } else {
      // Simple heuristic: compare src/ mtime against dist/server.js mtime
      const srcStat = fs.statSync(srcDir);
      if (srcStat.mtimeMs > distServerStat.mtimeMs) {
        needsBuild = true;
      }
    }
  }

  if (needsBuild) {
    console.log('[E2E Setup] Building TypeScript...');
    execFileSync('npx', ['tsc'], { cwd: PROJECT_ROOT, stdio: 'pipe' });
    console.log('[E2E Setup] Build complete.');
  }

  // 3. Start the server
  console.log('[E2E Setup] Starting Overlord v2 server...');

  const serverProcess = spawn('node', ['dist/server.js'], {
    cwd: PROJECT_ROOT,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      PORT: '4000',
      LOG_LEVEL: 'warn',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
  });

  // Capture stdout/stderr for debugging
  let serverOutput = '';
  serverProcess.stdout?.on('data', (data: Buffer) => {
    serverOutput += data.toString();
  });
  serverProcess.stderr?.on('data', (data: Buffer) => {
    serverOutput += data.toString();
  });

  serverProcess.on('error', (err) => {
    console.error('[E2E Setup] Server process error:', err.message);
  });

  serverProcess.on('exit', (code) => {
    if (code !== null && code !== 0) {
      console.error(`[E2E Setup] Server exited with code ${code}`);
      console.error('[E2E Setup] Server output:', serverOutput.slice(-2000));
    }
  });

  // Store globally for teardown
  globalThis.__OVERLORD_SERVER_PROCESS__ = serverProcess;

  // Write PID to file as a fallback cleanup mechanism
  const pidFile = path.join(PROJECT_ROOT, 'test-results', '.server.pid');
  if (!fs.existsSync(path.dirname(pidFile))) {
    fs.mkdirSync(path.dirname(pidFile), { recursive: true });
  }
  fs.writeFileSync(pidFile, String(serverProcess.pid));

  // 4. Wait for server to be ready
  try {
    await waitForServer(MAX_WAIT_MS);
    console.log('[E2E Setup] Server is ready on port 4000');
  } catch (err) {
    console.error('[E2E Setup] Server failed to start. Output:');
    console.error(serverOutput.slice(-3000));
    serverProcess.kill('SIGTERM');
    throw err;
  }
}
