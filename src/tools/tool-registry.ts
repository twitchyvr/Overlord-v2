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

const log = logger.child({ module: 'tool-registry' });

/** @type {Map<string, ToolDefinition>} */
const tools = new Map();

/**
 * @typedef {object} ToolDefinition
 * @property {string} name
 * @property {string} description
 * @property {object} inputSchema - JSON Schema for parameters
 * @property {Function} execute - (params, context) => Result
 * @property {string} category
 */

export function initTools(config) {
  // Register built-in tools
  registerBuiltinTools();
  log.info({ count: tools.size }, 'Tool registry initialized');
  return { registerTool, getTool, getToolsForRoom, executeInRoom };
}

/**
 * Register a tool
 */
export function registerTool(definition) {
  tools.set(definition.name, definition);
  log.debug({ name: definition.name, category: definition.category }, 'Tool registered');
}

/**
 * Get a tool definition by name
 */
export function getTool(name) {
  return tools.get(name) || null;
}

/**
 * Get tools available for a specific room (filtered by room's allowed list)
 * This IS the access control — structural, not instructional
 */
export function getToolsForRoom(allowedToolNames) {
  return allowedToolNames
    .map((name) => tools.get(name))
    .filter(Boolean);
}

/**
 * Execute a tool within a room context.
 * Validates the tool is allowed in the room before executing.
 */
export async function executeInRoom({ toolName, params, roomAllowedTools, context }) {
  // Structural enforcement: tool must be in room's allowed list
  if (!roomAllowedTools.includes(toolName)) {
    return err(
      'TOOL_NOT_AVAILABLE',
      `Tool "${toolName}" is not available in this room. Available: ${roomAllowedTools.join(', ')}`
    );
  }

  const tool = tools.get(toolName);
  if (!tool) {
    return err('TOOL_NOT_FOUND', `Tool "${toolName}" is not registered`);
  }

  try {
    const result = await tool.execute(params, context);
    return ok(result);
  } catch (error) {
    return err('TOOL_EXECUTION_ERROR', error.message, { retryable: true, context: { toolName } });
  }
}

/**
 * Register all built-in tools
 */
function registerBuiltinTools() {
  // Shell tools
  registerTool({
    name: 'bash',
    description: 'Execute a bash command',
    category: 'shell',
    inputSchema: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] },
    execute: async (params) => {
      // Delegated to providers/shell.js
      return { output: 'Shell execution delegated to provider', command: params.command };
    },
  });

  // File tools
  registerTool({
    name: 'read_file',
    description: 'Read a file from the filesystem',
    category: 'file',
    inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
    execute: async (params) => {
      return { output: 'File read delegated to provider', path: params.path };
    },
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
    execute: async (params) => {
      return { output: 'File write delegated to provider', path: params.path };
    },
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
    execute: async (params) => {
      return { output: 'File patch delegated to provider', path: params.path };
    },
  });

  registerTool({
    name: 'list_dir',
    description: 'List contents of a directory',
    category: 'file',
    inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
    execute: async (params) => {
      return { output: 'Directory listing delegated to provider', path: params.path };
    },
  });

  // Web tools
  registerTool({
    name: 'web_search',
    description: 'Search the web',
    category: 'web',
    inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    execute: async (params) => {
      return { output: 'Web search delegated to provider', query: params.query };
    },
  });

  registerTool({
    name: 'fetch_webpage',
    description: 'Fetch and parse a webpage',
    category: 'web',
    inputSchema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
    execute: async (params) => {
      return { output: 'Web fetch delegated to provider', url: params.url };
    },
  });

  // QA tools
  for (const qa of ['qa_run_tests', 'qa_check_lint', 'qa_check_types', 'qa_check_coverage', 'qa_audit_deps']) {
    registerTool({
      name: qa,
      description: `QA: ${qa.replace('qa_', '').replace(/_/g, ' ')}`,
      category: 'qa',
      inputSchema: { type: 'object', properties: { args: { type: 'string' } } },
      execute: async (params) => {
        return { output: `QA tool ${qa} delegated to provider` };
      },
    });
  }

  // GitHub
  registerTool({
    name: 'github',
    description: 'GitHub CLI operations (commit, PR, issues)',
    category: 'github',
    inputSchema: {
      type: 'object',
      properties: { action: { type: 'string' }, args: { type: 'object' } },
      required: ['action'],
    },
    execute: async (params) => {
      return { output: 'GitHub operation delegated to provider', action: params.action };
    },
  });

  // Notes
  registerTool({
    name: 'record_note',
    description: 'Record a session note',
    category: 'notes',
    inputSchema: { type: 'object', properties: { content: { type: 'string' } }, required: ['content'] },
    execute: async (params) => {
      return { output: 'Note recorded', content: params.content };
    },
  });

  registerTool({
    name: 'recall_notes',
    description: 'Recall session notes',
    category: 'notes',
    inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
    execute: async (params) => {
      return { output: 'Notes recall delegated to provider' };
    },
  });

  // User interaction
  registerTool({
    name: 'ask_user',
    description: 'Ask the user a question',
    category: 'system',
    inputSchema: { type: 'object', properties: { question: { type: 'string' } }, required: ['question'] },
    execute: async (params) => {
      return { output: 'User question delegated to transport layer', question: params.question };
    },
  });
}
