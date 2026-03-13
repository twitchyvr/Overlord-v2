/**
 * MCP Tool Bridge — Bidirectional Format Translation
 *
 * Bridges the gap between MCP (Model Context Protocol) tool definitions
 * and Overlord's internal ToolDefinition format. Enables MCP servers to
 * provide tools that are seamlessly usable within Overlord rooms.
 *
 * Two key transforms:
 *   1. mcpToOverlordTool: MCP tool def -> Overlord ToolDefinition
 *   2. overlordToMcpCall: Overlord tool call -> MCP request format
 *
 * The MCP Manager (src/tools/mcp-manager.ts) already does inline tool
 * registration. This module provides a clean, testable bridge layer
 * that can be used independently of the manager lifecycle.
 *
 * Layer: AI (depends on Core only)
 *
 * @see Issue #366
 */

import { logger } from '../core/logger.js';
import type { ToolDefinition } from '../core/contracts.js';

const log = logger.child({ module: 'ai:mcp-bridge' });

// ─── Types ───

/** MCP tool definition as returned by tools/list */
export interface McpToolDefinition {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

/** MCP JSON-RPC request for tools/call */
export interface McpCallRequest {
  method: 'tools/call';
  params: {
    name: string;
    arguments: Record<string, unknown>;
  };
}

/** MCP JSON-RPC response from tools/call */
export interface McpCallResponse {
  content?: Array<{
    type: string;
    text?: string;
    [key: string]: unknown;
  }>;
}

/** Options for converting MCP tools to Overlord format */
export interface BridgeOptions {
  /** Server name prefix for namespacing (e.g., 'github' -> 'mcp_github_toolname') */
  serverName: string;
  /** Optional category override (defaults to 'mcp') */
  category?: string;
  /** Optional executor function — called when the tool is invoked within Overlord */
  executor?: (toolName: string, params: Record<string, unknown>) => Promise<unknown>;
}

// ─── Public API ───

/**
 * Convert an MCP tool definition to Overlord's ToolDefinition format.
 *
 * The resulting ToolDefinition can be registered in Overlord's tool registry
 * and used in any room that includes it in its allowedTools list.
 *
 * Tool names are namespaced as: `mcp_<serverName>_<toolName>`
 * This prevents collisions between tools from different MCP servers and
 * Overlord's built-in tools.
 *
 * @param mcpTool - The MCP tool definition (from tools/list response)
 * @param options - Bridge configuration (server name, executor, etc.)
 * @returns An Overlord ToolDefinition ready for registry registration
 */
export function mcpToOverlordTool(
  mcpTool: McpToolDefinition,
  options: BridgeOptions,
): ToolDefinition {
  const overlordName = `mcp_${options.serverName}_${mcpTool.name}`;
  const category = options.category || 'mcp';

  log.debug(
    { mcpTool: mcpTool.name, overlordName, server: options.serverName },
    'Converting MCP tool to Overlord format',
  );

  // Build input schema — default to open object if MCP tool has no schema
  const inputSchema = mcpTool.inputSchema || {
    type: 'object',
    properties: {},
    additionalProperties: true,
  };

  // Build the description with MCP server attribution
  const description = mcpTool.description
    ? `[MCP:${options.serverName}] ${mcpTool.description}`
    : `[MCP:${options.serverName}] ${mcpTool.name}`;

  const definition: ToolDefinition = {
    name: overlordName,
    description,
    category,
    inputSchema,
    execute: async (params: Record<string, unknown>) => {
      if (options.executor) {
        return options.executor(mcpTool.name, params);
      }
      // Without an executor, return a descriptive error
      throw new Error(
        `MCP tool "${mcpTool.name}" on server "${options.serverName}" has no executor configured`,
      );
    },
  };

  return definition;
}

/**
 * Convert multiple MCP tool definitions to Overlord format.
 *
 * Convenience wrapper around `mcpToOverlordTool` for batch conversion.
 *
 * @param mcpTools - Array of MCP tool definitions
 * @param options - Bridge configuration
 * @returns Array of Overlord ToolDefinitions
 */
export function mcpToOverlordTools(
  mcpTools: McpToolDefinition[],
  options: BridgeOptions,
): ToolDefinition[] {
  log.info(
    { server: options.serverName, toolCount: mcpTools.length },
    'Batch converting MCP tools to Overlord format',
  );

  return mcpTools.map((tool) => mcpToOverlordTool(tool, options));
}

/**
 * Convert an Overlord tool call into an MCP JSON-RPC request.
 *
 * Takes a tool name (in Overlord's namespaced format) and parameters,
 * and produces the MCP `tools/call` request payload.
 *
 * @param toolName - The Overlord tool name (e.g., 'mcp_github_create_issue')
 * @param params - The tool's input parameters
 * @returns An MCP-formatted call request
 */
export function overlordToMcpCall(
  toolName: string,
  params: Record<string, unknown>,
): McpCallRequest {
  // Extract the original MCP tool name by stripping the namespace prefix
  const mcpToolName = extractMcpToolName(toolName);

  log.debug(
    { overlordName: toolName, mcpName: mcpToolName },
    'Converting Overlord tool call to MCP format',
  );

  return {
    method: 'tools/call',
    params: {
      name: mcpToolName,
      arguments: params,
    },
  };
}

/**
 * Extract the original MCP tool name from an Overlord-namespaced tool name.
 *
 * Given 'mcp_github_create_issue', returns 'create_issue'.
 * Given 'mcp_fs_read_file', returns 'read_file'.
 *
 * The format is: mcp_<serverName>_<toolName>
 * Server names can contain underscores, so we split on the SECOND underscore
 * only if the name starts with 'mcp_'.
 */
export function extractMcpToolName(overlordName: string): string {
  if (!overlordName.startsWith('mcp_')) {
    return overlordName;
  }

  // Remove 'mcp_' prefix, then find the first underscore to split server from tool
  const withoutPrefix = overlordName.slice(4); // 'github_create_issue'
  const firstUnderscore = withoutPrefix.indexOf('_');

  if (firstUnderscore === -1) {
    // No underscore after server name — tool name IS the remaining string
    return withoutPrefix;
  }

  return withoutPrefix.slice(firstUnderscore + 1); // 'create_issue'
}

/**
 * Extract the MCP server name from an Overlord-namespaced tool name.
 *
 * Given 'mcp_github_create_issue', returns 'github'.
 */
export function extractMcpServerName(overlordName: string): string | null {
  if (!overlordName.startsWith('mcp_')) {
    return null;
  }

  const withoutPrefix = overlordName.slice(4);
  const firstUnderscore = withoutPrefix.indexOf('_');

  if (firstUnderscore === -1) {
    return withoutPrefix;
  }

  return withoutPrefix.slice(0, firstUnderscore);
}

/**
 * Check whether a tool name is an MCP-bridged tool.
 */
export function isMcpTool(toolName: string): boolean {
  return toolName.startsWith('mcp_');
}

/**
 * Parse an MCP call response into a plain text result.
 *
 * MCP responses contain an array of content blocks. This function
 * concatenates all text content into a single string result.
 */
export function parseMcpResponse(response: McpCallResponse): string {
  if (!response.content || !Array.isArray(response.content)) {
    return '';
  }

  return response.content
    .map((block) => block.text || JSON.stringify(block))
    .join('\n');
}
