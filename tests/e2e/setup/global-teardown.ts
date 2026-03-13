/**
 * Overlord v2 — Playwright Global Teardown
 *
 * Stops the Overlord server process that was started in global-setup.
 * Uses both the global reference and a PID file as fallback.
 */

import { type FullConfig } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const PROJECT_ROOT = path.resolve(import.meta.dirname, '..', '..', '..');
const PID_FILE = path.join(PROJECT_ROOT, 'test-results', '.server.pid');

export default async function globalTeardown(_config: FullConfig): Promise<void> {
  console.log('\n[E2E Teardown] Stopping server...');

  // Try the global process reference first
  const serverProcess = (globalThis as any).__OVERLORD_SERVER_PROCESS__;
  if (serverProcess && !serverProcess.killed) {
    serverProcess.kill('SIGTERM');
    console.log(`[E2E Teardown] Sent SIGTERM to server process (PID: ${serverProcess.pid})`);

    // Wait briefly for graceful shutdown
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        if (!serverProcess.killed) {
          serverProcess.kill('SIGKILL');
          console.log('[E2E Teardown] Force-killed server process');
        }
        resolve();
      }, 5000);

      serverProcess.on('exit', () => {
        clearTimeout(timeout);
        resolve();
      });
    });
  }

  // Fallback: try PID file
  if (fs.existsSync(PID_FILE)) {
    try {
      const pid = parseInt(fs.readFileSync(PID_FILE, 'utf-8').trim(), 10);
      if (!isNaN(pid)) {
        try {
          process.kill(pid, 'SIGTERM');
          console.log(`[E2E Teardown] Sent SIGTERM to PID ${pid} (from PID file)`);
        } catch {
          // Process may already be dead -- that's fine
        }
      }
    } catch {
      // PID file read error -- ignore
    }
    fs.unlinkSync(PID_FILE);
  }

  console.log('[E2E Teardown] Server stopped.');
}
