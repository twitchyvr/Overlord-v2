/**
 * Tool Registry
 *
 * Defines all available tools. Room-scoped access replaces the 4-tier approval system.
 * Tools are registered globally but only available to agents through their current room.
 *
 * If a tool isn't in the room's allowed list, it doesn't exist.
 */

import { logger } from '../core/logger.js';
import { ok, err } from '../core/contracts.js';
import type { Result, ToolDefinition, ToolContext, ToolRegistryAPI, Config } from '../core/contracts.js';

const log = logger.child({ module: 'tool-registry' });

const tools = new Map<string, ToolDefinition>();

export function initTools(_config: Config): ToolRegistryAPI {
  registerBuiltinTools();
  log.info({ count: tools.size }, 'Tool registry initialized');
  return { registerTool, getTool, getToolsForRoom, executeInRoom };
}

export function registerTool(definition: ToolDefinition): void {
  tools.set(definition.name, definition);
  log.debug({ name: definition.name, category: definition.category }, 'Tool registered');
}

export function getTool(name: string): ToolDefinition | null {
  return tools.get(name) || null;
}

/**
 * Get tools available for a specific room (filtered by room's allowed list)
 * This IS the access control — structural, not instructional
 */
export function getToolsForRoom(allowedToolNames: string[]): ToolDefinition[] {
  return allowedToolNames
    .map((name) => tools.get(name))
    .filter((t): t is ToolDefinition => t !== undefined);
}

/**
 * Execute a tool within a room context.
 * Validates the tool is allowed in the room before executing.
 */
export async function executeInRoom(params: {
  toolName: string;
  params: Record<string, unknown>;
  roomAllowedTools: string[];
  context: ToolContext;
}): Promise<Result> {
  if (!params.roomAllowedTools.includes(params.toolName)) {
    return err(
      'TOOL_NOT_AVAILABLE',
      `Tool "${params.toolName}" is not available in this room. Available: ${params.roomAllowedTools.join(', ')}`,
    );
  }

  const tool = tools.get(params.toolName);
  if (!tool) {
    return err('TOOL_NOT_FOUND', `Tool "${params.toolName}" is not registered`);
  }

  try {
    const result = await tool.execute(params.params, params.context);
    return ok(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return err('TOOL_EXECUTION_ERROR', message, {
      retryable: true,
      context: { toolName: params.toolName },
    });
  }
}

function registerBuiltinTools(): void {
  registerTool({
    name: 'bash',
    description: 'Execute a bash command',
    category: 'shell',
    inputSchema: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] },
    execute: async (p) => ({ output: 'Shell execution delegated to provider', command: p.command }),
  });

  registerTool({
    name: 'read_file',
    description: 'Read a file from the filesystem',
    category: 'file',
    inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
    execute: async (p) => ({ output: 'File read delegated to provider', path: p.path }),
  });

  registerTool({
    name: 'write_file',
    description: 'Write content to a file',
    category: 'file',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string' }, content: { type: 'string' } },
      required: ['path', 'content'],
    },
    execute: async (p) => ({ output: 'File write delegated to provider', path: p.path }),
  });

  registerTool({
    name: 'patch_file',
    description: 'Apply a patch/edit to a file',
    category: 'file',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string' }, search: { type: 'string' }, replace: { type: 'string' } },
      required: ['path', 'search', 'replace'],
    },
    execute: async (p) => ({ output: 'File patch delegated to provider', path: p.path }),
  });

  registerTool({
    name: 'list_dir',
    description: 'List contents of a directory',
    category: 'file',
    inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
    execute: async (p) => ({ output: 'Directory listing delegated to provider', path: p.path }),
  });

  registerTool({
    name: 'web_search',
    description: 'Search the web',
    category: 'web',
    inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    execute: async (p) => ({ output: 'Web search delegated to provider', query: p.query }),
  });

  registerTool({
    name: 'fetch_webpage',
    description: 'Fetch and parse a webpage',
    category: 'web',
    inputSchema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
    execute: async (p) => ({ output: 'Web fetch delegated to provider', url: p.url }),
  });

  for (const qa of ['qa_run_tests', 'qa_check_lint', 'qa_check_types', 'qa_check_coverage', 'qa_audit_deps']) {
    registerTool({
      name: qa,
      description: `QA: ${qa.replace('qa_', '').replace(/_/g, ' ')}`,
      category: 'qa',
      inputSchema: { type: 'object', properties: { args: { type: 'string' } } },
      execute: async () => ({ output: `QA tool ${qa} delegated to provider` }),
    });
  }

  registerTool({
    name: 'github',
    description: 'GitHub CLI operations (commit, PR, issues)',
    category: 'github',
    inputSchema: {
      type: 'object',
      properties: { action: { type: 'string' }, args: { type: 'object' } },
      required: ['action'],
    },
    execute: async (p) => ({ output: 'GitHub operation delegated to provider', action: p.action }),
  });

  registerTool({
    name: 'record_note',
    description: 'Record a session note',
    category: 'notes',
    inputSchema: { type: 'object', properties: { content: { type: 'string' } }, required: ['content'] },
    execute: async (p) => ({ output: 'Note recorded', content: p.content }),
  });

  registerTool({
    name: 'recall_notes',
    description: 'Recall session notes',
    category: 'notes',
    inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
    execute: async () => ({ output: 'Notes recall delegated to provider' }),
  });

  registerTool({
    name: 'ask_user',
    description: 'Ask the user a question',
    category: 'system',
    inputSchema: { type: 'object', properties: { question: { type: 'string' } }, required: ['question'] },
    execute: async (p) => ({ output: 'User question delegated to transport layer', question: p.question }),
  });
}
