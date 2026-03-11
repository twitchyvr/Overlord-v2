/**
 * Tool Registry Tests
 *
 * Tests: registration, room-scoped access, real tool execution
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { registerTool, getTool, getToolsForRoom, executeInRoom } from '../../../src/tools/tool-registry.js';
import type { ToolDefinition } from '../../../src/core/contracts.js';

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
});
