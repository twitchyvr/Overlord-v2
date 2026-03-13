/**
 * MCP Tool Bridge Tests
 *
 * Tests the bidirectional format translation between MCP tool definitions
 * and Overlord's ToolDefinition format.
 *
 * @see Issue #366
 */

import { describe, it, expect, vi } from 'vitest';
import {
  mcpToOverlordTool,
  mcpToOverlordTools,
  overlordToMcpCall,
  extractMcpToolName,
  extractMcpServerName,
  isMcpTool,
  parseMcpResponse,
} from '../../../src/ai/mcp-tool-bridge.js';
import type { McpToolDefinition, BridgeOptions } from '../../../src/ai/mcp-tool-bridge.js';

const defaultOptions: BridgeOptions = {
  serverName: 'github',
};

describe('MCP Tool Bridge', () => {
  describe('mcpToOverlordTool', () => {
    it('converts a basic MCP tool to Overlord format', () => {
      const mcpTool: McpToolDefinition = {
        name: 'create_issue',
        description: 'Create a GitHub issue',
        inputSchema: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            body: { type: 'string' },
          },
          required: ['title'],
        },
      };

      const result = mcpToOverlordTool(mcpTool, defaultOptions);

      expect(result.name).toBe('mcp_github_create_issue');
      expect(result.description).toBe('[MCP:github] Create a GitHub issue');
      expect(result.category).toBe('mcp');
      expect(result.inputSchema).toEqual(mcpTool.inputSchema);
    });

    it('uses tool name as fallback description when none provided', () => {
      const mcpTool: McpToolDefinition = {
        name: 'read_file',
      };

      const result = mcpToOverlordTool(mcpTool, defaultOptions);

      expect(result.description).toBe('[MCP:github] read_file');
    });

    it('provides default input schema when MCP tool has none', () => {
      const mcpTool: McpToolDefinition = {
        name: 'simple_tool',
      };

      const result = mcpToOverlordTool(mcpTool, defaultOptions);

      expect(result.inputSchema).toEqual({
        type: 'object',
        properties: {},
        additionalProperties: true,
      });
    });

    it('uses custom category when provided', () => {
      const mcpTool: McpToolDefinition = {
        name: 'search',
        description: 'Search docs',
      };

      const result = mcpToOverlordTool(mcpTool, {
        serverName: 'obsidian',
        category: 'knowledge-base',
      });

      expect(result.category).toBe('knowledge-base');
    });

    it('execute calls the provided executor', async () => {
      const executor = vi.fn().mockResolvedValue({ result: 'ok' });
      const mcpTool: McpToolDefinition = {
        name: 'list_repos',
        description: 'List repositories',
      };

      const result = mcpToOverlordTool(mcpTool, {
        serverName: 'github',
        executor,
      });

      const output = await result.execute({ org: 'acme' });

      expect(executor).toHaveBeenCalledWith('list_repos', { org: 'acme' });
      expect(output).toEqual({ result: 'ok' });
    });

    it('execute throws when no executor is provided', async () => {
      const mcpTool: McpToolDefinition = {
        name: 'dangerous_tool',
      };

      const result = mcpToOverlordTool(mcpTool, defaultOptions);

      await expect(result.execute({})).rejects.toThrow('no executor configured');
    });
  });

  describe('mcpToOverlordTools', () => {
    it('batch converts multiple MCP tools', () => {
      const mcpTools: McpToolDefinition[] = [
        { name: 'create_issue', description: 'Create issue' },
        { name: 'list_repos', description: 'List repos' },
        { name: 'get_file', description: 'Get file contents' },
      ];

      const results = mcpToOverlordTools(mcpTools, defaultOptions);

      expect(results).toHaveLength(3);
      expect(results[0].name).toBe('mcp_github_create_issue');
      expect(results[1].name).toBe('mcp_github_list_repos');
      expect(results[2].name).toBe('mcp_github_get_file');
    });

    it('handles empty tool list', () => {
      const results = mcpToOverlordTools([], defaultOptions);
      expect(results).toHaveLength(0);
    });
  });

  describe('overlordToMcpCall', () => {
    it('converts an Overlord tool call to MCP format', () => {
      const result = overlordToMcpCall('mcp_github_create_issue', {
        title: 'Bug fix',
        body: 'Fixed the login bug',
      });

      expect(result.method).toBe('tools/call');
      expect(result.params.name).toBe('create_issue');
      expect(result.params.arguments).toEqual({
        title: 'Bug fix',
        body: 'Fixed the login bug',
      });
    });

    it('handles non-namespaced tool names', () => {
      const result = overlordToMcpCall('bash', { command: 'ls' });

      expect(result.params.name).toBe('bash');
      expect(result.params.arguments).toEqual({ command: 'ls' });
    });

    it('handles empty params', () => {
      const result = overlordToMcpCall('mcp_github_list_repos', {});

      expect(result.params.arguments).toEqual({});
    });
  });

  describe('extractMcpToolName', () => {
    it('extracts tool name from namespaced format', () => {
      expect(extractMcpToolName('mcp_github_create_issue')).toBe('create_issue');
    });

    it('handles tool names with multiple underscores', () => {
      expect(extractMcpToolName('mcp_github_get_pull_request')).toBe('get_pull_request');
    });

    it('returns original name for non-MCP tools', () => {
      expect(extractMcpToolName('bash')).toBe('bash');
      expect(extractMcpToolName('read_file')).toBe('read_file');
    });

    it('handles server-only name (no tool name after server)', () => {
      expect(extractMcpToolName('mcp_github')).toBe('github');
    });
  });

  describe('extractMcpServerName', () => {
    it('extracts server name from namespaced format', () => {
      expect(extractMcpServerName('mcp_github_create_issue')).toBe('github');
    });

    it('returns null for non-MCP tools', () => {
      expect(extractMcpServerName('bash')).toBeNull();
      expect(extractMcpServerName('read_file')).toBeNull();
    });

    it('handles server-only name', () => {
      expect(extractMcpServerName('mcp_github')).toBe('github');
    });
  });

  describe('isMcpTool', () => {
    it('returns true for MCP-prefixed tools', () => {
      expect(isMcpTool('mcp_github_create_issue')).toBe(true);
      expect(isMcpTool('mcp_filesystem_read')).toBe(true);
    });

    it('returns false for regular tools', () => {
      expect(isMcpTool('bash')).toBe(false);
      expect(isMcpTool('read_file')).toBe(false);
      expect(isMcpTool('write_file')).toBe(false);
    });
  });

  describe('parseMcpResponse', () => {
    it('parses a simple text response', () => {
      const response = {
        content: [
          { type: 'text', text: 'Issue created successfully' },
        ],
      };

      expect(parseMcpResponse(response)).toBe('Issue created successfully');
    });

    it('concatenates multiple content blocks', () => {
      const response = {
        content: [
          { type: 'text', text: 'Line 1' },
          { type: 'text', text: 'Line 2' },
        ],
      };

      expect(parseMcpResponse(response)).toBe('Line 1\nLine 2');
    });

    it('handles blocks without text by JSON stringifying them', () => {
      const response = {
        content: [
          { type: 'resource', uri: 'file:///tmp/test.txt' },
        ],
      };

      const result = parseMcpResponse(response);
      expect(result).toContain('resource');
      expect(result).toContain('file:///tmp/test.txt');
    });

    it('returns empty string for missing content', () => {
      expect(parseMcpResponse({})).toBe('');
      expect(parseMcpResponse({ content: undefined })).toBe('');
    });

    it('returns empty string for null content', () => {
      expect(parseMcpResponse({ content: null as unknown as undefined })).toBe('');
    });
  });
});
