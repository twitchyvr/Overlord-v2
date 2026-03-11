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
import { executeShell } from './providers/shell.js';
import { readFileImpl, writeFileImpl, patchFileImpl, listDirImpl } from './providers/filesystem.js';
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
  // ─── Shell ───
  registerTool({
    name: 'bash',
    description: 'Execute a bash command',
    category: 'shell',
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'The bash command to execute' },
        timeout: { type: 'number', description: 'Timeout in milliseconds (default: 30000)' },
      },
      required: ['command'],
    },
    execute: async (p) => {
      const result = await executeShell({
        command: p.command as string,
        timeout: p.timeout as number | undefined,
      });
      if (result.timedOut) {
        return { output: `Command timed out.\nPartial stdout: ${result.stdout}\nPartial stderr: ${result.stderr}` };
      }
      if (result.exitCode !== 0) {
        return { output: `Exit code ${result.exitCode}\nstdout: ${result.stdout}\nstderr: ${result.stderr}` };
      }
      return { output: result.stdout || '(no output)' };
    },
  });

  // ─── File Operations ───
  registerTool({
    name: 'read_file',
    description: 'Read a file from the filesystem',
    category: 'file',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'File path to read' } },
      required: ['path'],
    },
    execute: async (p) => {
      const result = await readFileImpl({ path: p.path as string });
      return { output: result.content, path: result.path, size: result.size };
    },
  });

  registerTool({
    name: 'write_file',
    description: 'Write content to a file',
    category: 'file',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path to write' },
        content: { type: 'string', description: 'Content to write' },
      },
      required: ['path', 'content'],
    },
    execute: async (p) => {
      const result = await writeFileImpl({ path: p.path as string, content: p.content as string });
      return { output: `Written ${result.bytesWritten} bytes to ${result.path}`, path: result.path };
    },
  });

  registerTool({
    name: 'patch_file',
    description: 'Apply a search/replace patch to a file',
    category: 'file',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path to patch' },
        search: { type: 'string', description: 'Text to search for' },
        replace: { type: 'string', description: 'Replacement text' },
      },
      required: ['path', 'search', 'replace'],
    },
    execute: async (p) => {
      const result = await patchFileImpl({
        path: p.path as string,
        search: p.search as string,
        replace: p.replace as string,
      });
      if (!result.matched) {
        return { output: `Search string not found in ${result.path}`, matched: false };
      }
      return { output: `Patched ${result.occurrences} occurrence(s) in ${result.path}`, matched: true };
    },
  });

  registerTool({
    name: 'list_dir',
    description: 'List contents of a directory',
    category: 'file',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Directory path to list' } },
      required: ['path'],
    },
    execute: async (p) => {
      const result = await listDirImpl({ path: p.path as string });
      const listing = result.entries
        .map((e) => `${e.type === 'directory' ? '[dir]' : `[${e.size}B]`} ${e.name}`)
        .join('\n');
      return { output: listing || '(empty directory)', entries: result.entries };
    },
  });

  // ─── Web Tools (still delegated — require external API integration) ───
  registerTool({
    name: 'web_search',
    description: 'Search the web',
    category: 'web',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Search query' } },
      required: ['query'],
    },
    execute: async (p) => ({ output: `Web search not yet implemented. Query: ${p.query}` }),
  });

  registerTool({
    name: 'fetch_webpage',
    description: 'Fetch and parse a webpage',
    category: 'web',
    inputSchema: {
      type: 'object',
      properties: { url: { type: 'string', description: 'URL to fetch' } },
      required: ['url'],
    },
    execute: async (p) => ({ output: `Webpage fetch not yet implemented. URL: ${p.url}` }),
  });

  // ─── QA Tools ───
  for (const qa of ['qa_run_tests', 'qa_check_lint', 'qa_check_types', 'qa_check_coverage', 'qa_audit_deps']) {
    const cmdMap: Record<string, string> = {
      qa_run_tests: 'npm test',
      qa_check_lint: 'npm run lint',
      qa_check_types: 'npm run typecheck',
      qa_check_coverage: 'npm run test:coverage',
      qa_audit_deps: 'npm audit',
    };

    registerTool({
      name: qa,
      description: `QA: ${qa.replace('qa_', '').replace(/_/g, ' ')}`,
      category: 'qa',
      inputSchema: {
        type: 'object',
        properties: { args: { type: 'string', description: 'Additional arguments' } },
      },
      execute: async (p) => {
        const cmd = `${cmdMap[qa]}${p.args ? ` ${p.args}` : ''}`;
        const result = await executeShell({ command: cmd, timeout: 120_000 });
        return { output: result.stdout + (result.stderr ? `\n${result.stderr}` : ''), exitCode: result.exitCode };
      },
    });
  }

  // ─── GitHub ───
  registerTool({
    name: 'github',
    description: 'GitHub CLI operations (commit, PR, issues)',
    category: 'github',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', description: 'gh CLI command (e.g., "pr list", "issue create")' },
        args: { type: 'object', description: 'Additional arguments' },
      },
      required: ['action'],
    },
    execute: async (p) => {
      const result = await executeShell({ command: `gh ${p.action}`, timeout: 30_000 });
      return { output: result.stdout + (result.stderr ? `\n${result.stderr}` : ''), exitCode: result.exitCode };
    },
  });

  // ─── Notes (DB-backed, basic for now) ───
  registerTool({
    name: 'record_note',
    description: 'Record a session note',
    category: 'notes',
    inputSchema: {
      type: 'object',
      properties: { content: { type: 'string', description: 'Note content' } },
      required: ['content'],
    },
    execute: async (p) => ({ output: 'Note recorded', content: p.content }),
  });

  registerTool({
    name: 'recall_notes',
    description: 'Recall session notes',
    category: 'notes',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Search query for notes' } },
    },
    execute: async () => ({ output: 'Notes recall not yet implemented' }),
  });

  // ─── System ───
  registerTool({
    name: 'ask_user',
    description: 'Ask the user a question',
    category: 'system',
    inputSchema: {
      type: 'object',
      properties: { question: { type: 'string', description: 'Question to ask' } },
      required: ['question'],
    },
    execute: async (p) => ({ output: 'User question delegated to transport layer', question: p.question }),
  });
}
