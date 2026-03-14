/**
 * MCP Client Tests
 *
 * Tests the McpServerConnection class — JSON-RPC protocol,
 * subprocess lifecycle, tool discovery, and error handling.
 * Uses mock subprocess to avoid spawning real processes.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:stream';

// Mock child_process before importing
const mockStdin = { writable: true, write: vi.fn() };
const mockStdout = new EventEmitter();
const mockStderr = new EventEmitter();
const mockProc = Object.assign(new EventEmitter(), {
  stdin: mockStdin,
  stdout: mockStdout,
  stderr: mockStderr,
  kill: vi.fn(),
  pid: 12345,
});

vi.mock('node:child_process', () => ({
  spawn: vi.fn(() => mockProc),
  execFileSync: vi.fn((cmd: string, args: string[]) => {
    if (cmd === 'which') return `/usr/local/bin/${args[0]}`;
    return '';
  }),
}));

vi.mock('../../../src/core/logger.js', () => {
  const child = () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  });
  return { logger: { child } };
});

import { McpServerConnection } from '../../../src/tools/mcp-client.js';
import type { McpServerConfig } from '../../../src/tools/mcp-client.js';

const testConfig: McpServerConfig = {
  name: 'test-server',
  description: 'Test MCP server',
  command: 'npx',
  args: ['-y', '@test/server'],
  env: { TEST_KEY: 'test-value' },
  enabled: true,
  builtin: false,
};

/**
 * Simulate the MCP server responding to a JSON-RPC request.
 * Intercepts stdin.write, reads the request ID, and emits a response on stdout.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function _simulateResponse(response: unknown): void {
  // The last call to stdin.write contains the JSON-RPC request
  const lastCall = mockStdin.write.mock.calls[mockStdin.write.mock.calls.length - 1];
  if (!lastCall) return;
  const request = JSON.parse(lastCall[0] as string);
  const responseMsg = JSON.stringify({ jsonrpc: '2.0', id: request.id, result: response });
  mockStdout.emit('data', Buffer.from(responseMsg + '\n'));
}

/**
 * Set up auto-response for initialize + tools/list sequence
 */
function setupInitResponses(): void {
  mockStdin.write.mockImplementation((data: string) => {
    const msg = JSON.parse(data.trim());

    // Skip notifications (no id)
    if (msg.id === undefined) return true;

    if (msg.method === 'initialize') {
      const resp = JSON.stringify({
        jsonrpc: '2.0',
        id: msg.id,
        result: { capabilities: {}, serverInfo: { name: 'test', version: '1.0' } },
      });
      setTimeout(() => mockStdout.emit('data', Buffer.from(resp + '\n')), 1);
    } else if (msg.method === 'tools/list') {
      const resp = JSON.stringify({
        jsonrpc: '2.0',
        id: msg.id,
        result: {
          tools: [
            { name: 'search', description: 'Search the web', inputSchema: { type: 'object', properties: { query: { type: 'string' } } } },
            { name: 'read_file', description: 'Read a file' },
          ],
        },
      });
      setTimeout(() => mockStdout.emit('data', Buffer.from(resp + '\n')), 1);
    }
    return true;
  });
}

describe('McpServerConnection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStdin.writable = true;
    // Reset EventEmitter listeners
    mockStdout.removeAllListeners();
    mockStderr.removeAllListeners();
    (mockProc as EventEmitter).removeAllListeners();
  });

  describe('constructor', () => {
    it('creates connection with config', () => {
      const conn = new McpServerConnection(testConfig);
      expect(conn.config.name).toBe('test-server');
      expect(conn.status).toBe('disconnected');
      expect(conn.isReady).toBe(false);
      expect(conn.tools).toEqual([]);
    });

    it('accepts custom timeout', () => {
      const conn = new McpServerConnection(testConfig, 30_000);
      expect(conn.config.name).toBe('test-server');
    });
  });

  describe('getInfo', () => {
    it('returns server info', () => {
      const conn = new McpServerConnection(testConfig);
      const info = conn.getInfo();

      expect(info).toEqual({
        name: 'test-server',
        description: 'Test MCP server',
        status: 'disconnected',
        tools: [],
        toolCount: 0,
        lastError: null,
        enabled: true,
        builtin: false,
      });
    });
  });

  describe('start', () => {
    it('initializes and discovers tools', async () => {
      setupInitResponses();
      const conn = new McpServerConnection(testConfig);
      const result = await conn.start();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data).toHaveProperty('tools');
        expect((result.data as { tools: string[] }).tools).toContain('search');
        expect((result.data as { tools: string[] }).tools).toContain('read_file');
      }

      expect(conn.status).toBe('connected');
      expect(conn.isReady).toBe(true);
      expect(conn.tools).toHaveLength(2);
    });

    it('returns ok if already running', async () => {
      setupInitResponses();
      const conn = new McpServerConnection(testConfig);
      await conn.start();

      const result = await conn.start();
      expect(result.ok).toBe(true);
    });

    it('resolves npx to full path', async () => {
      const { spawn } = await import('node:child_process');
      setupInitResponses();
      const conn = new McpServerConnection(testConfig);
      await conn.start();

      expect(spawn).toHaveBeenCalledWith(
        '/usr/local/bin/npx',
        expect.any(Array),
        expect.any(Object),
      );
    });
  });

  describe('callTool', () => {
    it('sends tools/call and returns result', async () => {
      setupInitResponses();
      const conn = new McpServerConnection(testConfig);
      await conn.start();

      // Reset mock for the tool call
      mockStdin.write.mockImplementation((data: string) => {
        const msg = JSON.parse(data.trim());
        if (msg.id === undefined) return true;
        const resp = JSON.stringify({
          jsonrpc: '2.0',
          id: msg.id,
          result: { content: [{ text: 'search results here', type: 'text' }] },
        });
        setTimeout(() => mockStdout.emit('data', Buffer.from(resp + '\n')), 1);
        return true;
      });

      const result = await conn.callTool('search', { query: 'test' });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data).toBe('search results here');
      }
    });

    it('returns error when not ready', async () => {
      const conn = new McpServerConnection(testConfig);
      const result = await conn.callTool('search', {});

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('MCP_NOT_READY');
      }
    });
  });

  describe('destroy', () => {
    it('kills subprocess and resets state', async () => {
      setupInitResponses();
      const conn = new McpServerConnection(testConfig);
      await conn.start();

      conn.destroy();
      expect(conn.status).toBe('disconnected');
      expect(conn.isReady).toBe(false);
      expect(mockProc.kill).toHaveBeenCalled();
    });

    it('rejects pending requests on destroy', async () => {
      setupInitResponses();
      const conn = new McpServerConnection(testConfig);
      await conn.start();

      // Start a tool call that won't resolve
      mockStdin.write.mockImplementation(() => true);
      const callPromise = conn.callTool('slow_tool', {});

      // Destroy before it resolves
      conn.destroy();

      const result = await callPromise;
      expect(result.ok).toBe(false);
    });
  });

  describe('JSON-RPC error handling', () => {
    it('handles server error responses', async () => {
      setupInitResponses();
      const conn = new McpServerConnection(testConfig);
      await conn.start();

      mockStdin.write.mockImplementation((data: string) => {
        const msg = JSON.parse(data.trim());
        if (msg.id === undefined) return true;
        const resp = JSON.stringify({
          jsonrpc: '2.0',
          id: msg.id,
          error: { code: -32601, message: 'Method not found' },
        });
        setTimeout(() => mockStdout.emit('data', Buffer.from(resp + '\n')), 1);
        return true;
      });

      const result = await conn.callTool('nonexistent', {});
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('Method not found');
      }
    });

    it('handles malformed JSON from server', async () => {
      setupInitResponses();
      const conn = new McpServerConnection(testConfig);
      await conn.start();

      // Emit malformed JSON — should not crash
      mockStdout.emit('data', Buffer.from('not valid json\n'));
      expect(conn.status).toBe('connected');
    });

    it('handles server stderr output', async () => {
      setupInitResponses();
      const conn = new McpServerConnection(testConfig);
      await conn.start();

      // Emit stderr — should log warning but not crash
      mockStderr.emit('data', Buffer.from('some warning\n'));
      expect(conn.status).toBe('connected');
    });
  });

  describe('subprocess exit', () => {
    it('resets state on subprocess exit', async () => {
      setupInitResponses();
      const conn = new McpServerConnection(testConfig);
      await conn.start();

      mockProc.emit('exit', 1, null);
      expect(conn.status).toBe('disconnected');
      expect(conn.isReady).toBe(false);
    });

    it('rejects pending requests on exit', async () => {
      setupInitResponses();
      const conn = new McpServerConnection(testConfig);
      await conn.start();

      mockStdin.write.mockImplementation(() => true);
      const callPromise = conn.callTool('tool', {});

      mockProc.emit('exit', 1, null);
      const result = await callPromise;
      expect(result.ok).toBe(false);
    });
  });
});
