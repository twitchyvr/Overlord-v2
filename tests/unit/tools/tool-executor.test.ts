/**
 * Tool Executor Tests
 *
 * Tests the executeInRoom function in isolation — the core enforcement
 * mechanism that prevents tools from running outside their room scope.
 * Also tests tool registration, retrieval, and error handling.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  registerTool,
  getTool,
  getToolsForRoom,
  executeInRoom,
} from '../../../src/tools/tool-registry.js';
import type { ToolDefinition, ToolContext } from '../../../src/core/contracts.js';

const DEFAULT_CONTEXT: ToolContext = {
  roomId: 'room_1',
  roomType: 'code-lab',
  agentId: 'agent_1',
  fileScope: 'assigned',
};

describe('Tool Executor', () => {
  let callLog: Array<{ name: string; params: Record<string, unknown>; context?: ToolContext }>;

  beforeEach(() => {
    callLog = [];

    // Register a set of mock tools for testing
    const mockTools: ToolDefinition[] = [
      {
        name: 'mock_read',
        description: 'Mock read tool',
        category: 'file',
        inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
        execute: async (p, ctx) => {
          callLog.push({ name: 'mock_read', params: p, context: ctx });
          return { content: `Contents of ${p.path}` };
        },
      },
      {
        name: 'mock_write',
        description: 'Mock write tool',
        category: 'file',
        inputSchema: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } } },
        execute: async (p, ctx) => {
          callLog.push({ name: 'mock_write', params: p, context: ctx });
          return { written: true };
        },
      },
      {
        name: 'mock_slow',
        description: 'Slow mock tool',
        category: 'test',
        inputSchema: { type: 'object' },
        execute: async (_p, ctx) => {
          callLog.push({ name: 'mock_slow', params: {}, context: ctx });
          await new Promise((r) => setTimeout(r, 50));
          return { done: true };
        },
      },
      {
        name: 'mock_error',
        description: 'Always-erroring tool',
        category: 'test',
        inputSchema: { type: 'object' },
        execute: async () => { throw new Error('Tool exploded'); },
      },
    ];

    for (const tool of mockTools) {
      registerTool(tool);
    }
  });

  describe('room-scoped execution', () => {
    it('allows execution when tool is in room allowed list', async () => {
      const result = await executeInRoom({
        toolName: 'mock_read',
        params: { path: '/test.ts' },
        roomAllowedTools: ['mock_read', 'mock_write'],
        context: DEFAULT_CONTEXT,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect((result.data as Record<string, unknown>).content).toBe('Contents of /test.ts');
      }
      expect(callLog).toHaveLength(1);
      expect(callLog[0].name).toBe('mock_read');
    });

    it('rejects execution when tool is NOT in room allowed list', async () => {
      const result = await executeInRoom({
        toolName: 'mock_write',
        params: { path: '/hack.ts', content: 'bad' },
        roomAllowedTools: ['mock_read'], // write NOT allowed
        context: DEFAULT_CONTEXT,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('TOOL_NOT_AVAILABLE');
        expect(result.error.message).toContain('mock_write');
        expect(result.error.message).toContain('mock_read');
      }
      // Tool should NEVER have been called
      expect(callLog).toHaveLength(0);
    });

    it('rejects execution when room has empty tool list', async () => {
      const result = await executeInRoom({
        toolName: 'mock_read',
        params: { path: '/test.ts' },
        roomAllowedTools: [], // no tools allowed
        context: DEFAULT_CONTEXT,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('TOOL_NOT_AVAILABLE');
      }
    });
  });

  describe('context passing', () => {
    it('passes tool context to execute function', async () => {
      const ctx: ToolContext = {
        roomId: 'room_test',
        roomType: 'testing-lab',
        agentId: 'agent_qa',
        fileScope: 'read-only',
      };

      await executeInRoom({
        toolName: 'mock_read',
        params: { path: '/test.ts' },
        roomAllowedTools: ['mock_read'],
        context: ctx,
      });

      expect(callLog[0].context).toEqual(ctx);
    });
  });

  describe('error handling', () => {
    it('catches tool execution errors and returns ErrResult', async () => {
      const result = await executeInRoom({
        toolName: 'mock_error',
        params: {},
        roomAllowedTools: ['mock_error'],
        context: DEFAULT_CONTEXT,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('TOOL_EXECUTION_ERROR');
        expect(result.error.message).toBe('Tool exploded');
        expect(result.error.retryable).toBe(true);
      }
    });

    it('returns TOOL_NOT_FOUND for unregistered tool in allowed list', async () => {
      const result = await executeInRoom({
        toolName: 'ghost_tool',
        params: {},
        roomAllowedTools: ['ghost_tool'],
        context: DEFAULT_CONTEXT,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('TOOL_NOT_FOUND');
      }
    });
  });

  describe('getToolsForRoom filtering', () => {
    it('returns only tools that are both registered and allowed', () => {
      const tools = getToolsForRoom(['mock_read', 'mock_write', 'nonexistent_tool']);
      expect(tools).toHaveLength(2);
      expect(tools.map((t) => t.name).sort()).toEqual(['mock_read', 'mock_write']);
    });

    it('returns empty array when no tools match', () => {
      expect(getToolsForRoom(['totally_fake'])).toEqual([]);
    });
  });

  describe('registration and retrieval', () => {
    it('can retrieve registered tool by name', () => {
      const tool = getTool('mock_read');
      expect(tool).not.toBeNull();
      expect(tool!.name).toBe('mock_read');
      expect(tool!.category).toBe('file');
    });

    it('returns null for unregistered tool', () => {
      expect(getTool('ghost')).toBeNull();
    });

    it('overwrites previous registration for same name', () => {
      registerTool({
        name: 'mock_read',
        description: 'Updated mock read',
        category: 'updated',
        inputSchema: {},
        execute: async () => ({ updated: true }),
      });

      const tool = getTool('mock_read');
      expect(tool!.description).toBe('Updated mock read');
      expect(tool!.category).toBe('updated');
    });
  });

  describe('concurrent execution', () => {
    it('handles multiple simultaneous tool calls', async () => {
      const results = await Promise.all([
        executeInRoom({
          toolName: 'mock_read',
          params: { path: '/a.ts' },
          roomAllowedTools: ['mock_read', 'mock_slow'],
          context: DEFAULT_CONTEXT,
        }),
        executeInRoom({
          toolName: 'mock_slow',
          params: {},
          roomAllowedTools: ['mock_read', 'mock_slow'],
          context: DEFAULT_CONTEXT,
        }),
        executeInRoom({
          toolName: 'mock_read',
          params: { path: '/b.ts' },
          roomAllowedTools: ['mock_read', 'mock_slow'],
          context: DEFAULT_CONTEXT,
        }),
      ]);

      expect(results.every((r) => r.ok)).toBe(true);
      expect(callLog).toHaveLength(3);
    });
  });
});
