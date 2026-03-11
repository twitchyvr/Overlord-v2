/**
 * Shell Tool Provider Tests
 */

import { describe, it, expect } from 'vitest';
import { executeShell } from '../../../src/tools/providers/shell.js';

describe('Shell Provider', () => {
  it('executes a simple command', async () => {
    const result = await executeShell({ command: 'echo hello' });
    expect(result.stdout.trim()).toBe('hello');
    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
  });

  it('captures stderr', async () => {
    const result = await executeShell({ command: 'echo error >&2' });
    expect(result.stderr.trim()).toBe('error');
  });

  it('returns non-zero exit code', async () => {
    const result = await executeShell({ command: 'exit 42' });
    expect(result.exitCode).toBe(42);
  });

  it('respects timeout', async () => {
    const result = await executeShell({ command: 'sleep 10', timeout: 500 });
    expect(result.timedOut).toBe(true);
  });

  it('handles command not found', async () => {
    const result = await executeShell({ command: 'nonexistent_command_xyz_123' });
    expect(result.exitCode).not.toBe(0);
  });

  it('respects cwd', async () => {
    const result = await executeShell({ command: 'pwd', cwd: '/tmp' });
    // /tmp may resolve to /private/tmp on macOS
    expect(result.stdout.trim()).toMatch(/\/tmp$/);
  });
});
