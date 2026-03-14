/**
 * Tool Registry Tests
 *
 * Tests: registration, room-scoped access, real tool execution,
 * command injection prevention, bash timeout validation
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { initTools, registerTool, getTool, getToolsForRoom, executeInRoom } from '../../../src/tools/tool-registry.js';
import type { Config, ToolDefinition } from '../../../src/core/contracts.js';

// Initialize builtin tools (github, qa_*, bash, etc.) so injection tests can run
const mockConfig = { get: () => undefined, validate: () => mockConfig, getAll: () => ({}) } as unknown as Config;
initTools(mockConfig);

describe('Tool Registry', () => {
  const mockTool: ToolDefinition = {
    name: 'test_tool',
    description: 'A test tool',
    category: 'test',
    inputSchema: { type: 'object', properties: { input: { type: 'string' } } },
    execute: async (p) => ({ output: `echo: ${p.input}` }),
  };

  beforeEach(() => {
    registerTool(mockTool);
  });

  describe('registerTool / getTool', () => {
    it('registers and retrieves a tool', () => {
      const tool = getTool('test_tool');
      expect(tool).not.toBeNull();
      expect(tool!.name).toBe('test_tool');
      expect(tool!.category).toBe('test');
    });

    it('returns null for unknown tool', () => {
      expect(getTool('nonexistent')).toBeNull();
    });
  });

  describe('getToolsForRoom', () => {
    it('returns only tools in the allowed list', () => {
      const tools = getToolsForRoom(['test_tool', 'bash']);
      const names = tools.map((t) => t.name);
      expect(names).toContain('test_tool');
    });

    it('filters out tools not in registry', () => {
      const tools = getToolsForRoom(['test_tool', 'totally_fake_tool']);
      expect(tools.length).toBe(1);
      expect(tools[0].name).toBe('test_tool');
    });

    it('returns empty array for empty list', () => {
      expect(getToolsForRoom([])).toEqual([]);
    });
  });

  describe('executeInRoom', () => {
    it('executes a tool when allowed', async () => {
      const result = await executeInRoom({
        toolName: 'test_tool',
        params: { input: 'hello' },
        roomAllowedTools: ['test_tool'],
        context: { roomId: 'r1', roomType: 'test', agentId: 'a1', fileScope: 'full' },
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect((result.data as Record<string, unknown>).output).toBe('echo: hello');
      }
    });

    it('rejects tool not in room allowed list', async () => {
      const result = await executeInRoom({
        toolName: 'test_tool',
        params: { input: 'hello' },
        roomAllowedTools: ['bash'], // test_tool not allowed
        context: { roomId: 'r1', roomType: 'test', agentId: 'a1', fileScope: 'full' },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('TOOL_NOT_AVAILABLE');
      }
    });

    it('returns error for unregistered tool', async () => {
      const result = await executeInRoom({
        toolName: 'ghost_tool',
        params: {},
        roomAllowedTools: ['ghost_tool'],
        context: { roomId: 'r1', roomType: 'test', agentId: 'a1', fileScope: 'full' },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('TOOL_NOT_FOUND');
      }
    });

    it('catches tool execution errors', async () => {
      registerTool({
        name: 'failing_tool',
        description: 'Always fails',
        category: 'test',
        inputSchema: { type: 'object' },
        execute: async () => { throw new Error('boom'); },
      });

      const result = await executeInRoom({
        toolName: 'failing_tool',
        params: {},
        roomAllowedTools: ['failing_tool'],
        context: { roomId: 'r1', roomType: 'test', agentId: 'a1', fileScope: 'full' },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('TOOL_EXECUTION_ERROR');
        expect(result.error.message).toBe('boom');
        expect(result.error.retryable).toBe(true);
      }
    });
  });

  describe('command injection prevention', () => {
    const ctx = { roomId: 'r1', roomType: 'test', agentId: 'a1', fileScope: 'full' as const };

    describe('github tool', () => {
      it('rejects action with semicolon (command chaining)', async () => {
        const result = await executeInRoom({
          toolName: 'github',
          params: { action: 'pr list; rm -rf /' },
          roomAllowedTools: ['github'],
          context: ctx,
        });
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error.message).toContain('Unsafe characters');
      });

      it('rejects action with pipe', async () => {
        const result = await executeInRoom({
          toolName: 'github',
          params: { action: 'pr list | cat /etc/passwd' },
          roomAllowedTools: ['github'],
          context: ctx,
        });
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error.message).toContain('Unsafe characters');
      });

      it('rejects action with dollar sign (command substitution)', async () => {
        const result = await executeInRoom({
          toolName: 'github',
          params: { action: 'pr list $(whoami)' },
          roomAllowedTools: ['github'],
          context: ctx,
        });
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error.message).toContain('Unsafe characters');
      });

      it('rejects action with backticks', async () => {
        const result = await executeInRoom({
          toolName: 'github',
          params: { action: 'pr list `whoami`' },
          roomAllowedTools: ['github'],
          context: ctx,
        });
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error.message).toContain('Unsafe characters');
      });

      it('rejects action with ampersand (background exec)', async () => {
        const result = await executeInRoom({
          toolName: 'github',
          params: { action: 'pr list & malicious' },
          roomAllowedTools: ['github'],
          context: ctx,
        });
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error.message).toContain('Unsafe characters');
      });

      it('rejects action with newline', async () => {
        const result = await executeInRoom({
          toolName: 'github',
          params: { action: 'pr list\nrm -rf /' },
          roomAllowedTools: ['github'],
          context: ctx,
        });
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error.message).toContain('Unsafe characters');
      });
    });

    describe('qa tools', () => {
      it('rejects args with semicolon', async () => {
        const result = await executeInRoom({
          toolName: 'qa_run_tests',
          params: { args: '-- --verbose; rm -rf /' },
          roomAllowedTools: ['qa_run_tests'],
          context: ctx,
        });
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error.message).toContain('Unsafe characters');
      });

      it('rejects args with command substitution', async () => {
        const result = await executeInRoom({
          toolName: 'qa_check_lint',
          params: { args: '$(cat /etc/passwd)' },
          roomAllowedTools: ['qa_check_lint'],
          context: ctx,
        });
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error.message).toContain('Unsafe characters');
      });
    });
  });

  describe('bash timeout validation', () => {
    const ctx = { roomId: 'r1', roomType: 'test', agentId: 'a1', fileScope: 'full' as const };

    it('rejects negative timeout', async () => {
      const result = await executeInRoom({
        toolName: 'bash',
        params: { command: 'echo hi', timeout: -1 },
        roomAllowedTools: ['bash'],
        context: ctx,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.message).toContain('Timeout must be between');
    });

    it('rejects zero timeout', async () => {
      const result = await executeInRoom({
        toolName: 'bash',
        params: { command: 'echo hi', timeout: 0 },
        roomAllowedTools: ['bash'],
        context: ctx,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.message).toContain('Timeout must be between');
    });

    it('rejects timeout exceeding 5 minutes', async () => {
      const result = await executeInRoom({
        toolName: 'bash',
        params: { command: 'echo hi', timeout: 999_999 },
        roomAllowedTools: ['bash'],
        context: ctx,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.message).toContain('Timeout must be between');
    });
  });
});
