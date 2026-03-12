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
import { recordNote, recallNotes } from './providers/notes.js';
import { webSearch, fetchWebpage } from './providers/web.js';
import { fetchUrl, transformData, exportData, validateSchema } from './providers/data-exchange.js';
import { switchProvider, compareModels, configureFallback, testProvider } from './providers/provider-hub.js';
import { installPlugin, uninstallPlugin, configurePlugin, testPlugin, listPlugins } from './providers/plugin-bay.js';
import type { Result, ToolDefinition, ToolContext, ToolRegistryAPI, Config } from '../core/contracts.js';

const log = logger.child({ module: 'tool-registry' });

const tools = new Map<string, ToolDefinition>();

/**
 * Reject strings containing shell metacharacters that could enable injection.
 * Allows alphanumeric, spaces, hyphens, underscores, dots, slashes, colons,
 * equals signs, at-signs, and quotes (for passing quoted arguments to gh/npm).
 */
const SHELL_META_RE = /[;|&$`\\(){}<>!\n\r]/;
function rejectShellMeta(input: string, context: string): void {
  if (SHELL_META_RE.test(input)) {
    throw new Error(`Unsafe characters in ${context}: shell metacharacters are not allowed`);
  }
}

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
      const timeout = p.timeout as number | undefined;
      if (timeout !== undefined && (timeout <= 0 || timeout > 300_000)) {
        throw new Error('Timeout must be between 1 and 300000 ms');
      }
      const result = await executeShell({
        command: p.command as string,
        timeout,
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

  // ─── Web Tools ───
  registerTool({
    name: 'web_search',
    description: 'Search the web using DuckDuckGo HTML',
    category: 'web',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        maxResults: { type: 'number', description: 'Max results to return (default: 5)' },
      },
      required: ['query'],
    },
    execute: async (p) => {
      const results = await webSearch({
        query: p.query as string,
        maxResults: (p.maxResults as number) || 5,
      });
      return { output: results.map((r) => `${r.title}\n${r.url}\n${r.snippet}`).join('\n\n'), results };
    },
  });

  registerTool({
    name: 'fetch_webpage',
    description: 'Fetch a webpage and extract its text content',
    category: 'web',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL to fetch' },
        maxLength: { type: 'number', description: 'Max content length (default: 10000)' },
      },
      required: ['url'],
    },
    execute: async (p) => {
      const result = await fetchWebpage({
        url: p.url as string,
        maxLength: (p.maxLength as number) || 10000,
      });
      return { output: result.content, url: result.url, title: result.title, length: result.content.length };
    },
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
        const args = p.args as string | undefined;
        if (args) rejectShellMeta(args, `${qa} args`);
        const cmd = `${cmdMap[qa]}${args ? ` ${args}` : ''}`;
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
      const action = p.action as string;
      rejectShellMeta(action, 'github action');
      const result = await executeShell({ command: `gh ${action}`, timeout: 30_000 });
      return { output: result.stdout + (result.stderr ? `\n${result.stderr}` : ''), exitCode: result.exitCode };
    },
  });

  // ─── Notes (DB-backed) ───
  registerTool({
    name: 'record_note',
    description: 'Record a session note (persisted to database)',
    category: 'notes',
    inputSchema: {
      type: 'object',
      properties: {
        content: { type: 'string', description: 'Note content' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Optional tags' },
      },
      required: ['content'],
    },
    execute: async (p, ctx) => {
      const result = recordNote({
        content: p.content as string,
        tags: (p.tags as string[]) || [],
        agentId: ctx?.agentId,
        roomId: ctx?.roomId,
      });
      return { output: `Note recorded (id: ${result.id})`, id: result.id };
    },
  });

  registerTool({
    name: 'recall_notes',
    description: 'Recall session notes by keyword search or tags',
    category: 'notes',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query for notes' },
        tag: { type: 'string', description: 'Filter by tag' },
        limit: { type: 'number', description: 'Max notes to return (default: 10)' },
      },
    },
    execute: async (p, ctx) => {
      const notes = recallNotes({
        query: p.query as string | undefined,
        tag: p.tag as string | undefined,
        agentId: ctx?.agentId,
        limit: (p.limit as number) || 10,
      });
      if (notes.length === 0) {
        return { output: 'No notes found', notes: [] };
      }
      const formatted = notes.map((n) => `[${n.id}] (${n.created_at}) ${n.content}`).join('\n');
      return { output: formatted, notes, count: notes.length };
    },
  });

  // ─── System ───
  registerTool({
    name: 'ask_user',
    description: 'Ask the user a question via the transport layer',
    category: 'system',
    inputSchema: {
      type: 'object',
      properties: {
        question: { type: 'string', description: 'Question to ask the user' },
        context: { type: 'string', description: 'Additional context for the question' },
      },
      required: ['question'],
    },
    execute: async (p, ctx) => {
      // Emit bus event for transport layer to relay to connected client
      // The transport layer will listen for ask_user:request and forward to socket
      const { bus } = await import('../core/bus.js');
      const requestId = `ask_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

      bus.emit('ask_user:request', {
        requestId,
        question: p.question,
        context: p.context,
        agentId: ctx?.agentId,
        roomId: ctx?.roomId,
      });

      return {
        output: `Question sent to user: "${p.question}"`,
        requestId,
        question: p.question,
        pending: true,
      };
    },
  });

  // ─── Data Exchange Tools ───
  registerTool({
    name: 'fetch_url',
    description: 'Fetch data from a URL and parse it (supports JSON, CSV, text)',
    category: 'data',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL to fetch data from' },
        format: { type: 'string', description: 'Expected format: json, csv, text, auto (default: auto)' },
        maxLength: { type: 'number', description: 'Max content length (default: 50000)' },
      },
      required: ['url'],
    },
    execute: async (p) => {
      const result = await fetchUrl({
        url: p.url as string,
        format: (p.format as 'json' | 'csv' | 'text' | 'auto') || 'auto',
        maxLength: (p.maxLength as number) || 50000,
      });
      return {
        output: `Fetched ${result.recordCount} records from ${result.url} (format: ${result.format}, ${result.rawLength} bytes)`,
        ...result,
      };
    },
  });

  registerTool({
    name: 'transform_data',
    description: 'Apply transformation operations to data (filter, sort, pick, rename, deduplicate, flatten, group)',
    category: 'data',
    inputSchema: {
      type: 'object',
      properties: {
        data: { description: 'Array of records to transform' },
        operations: {
          type: 'array',
          description: 'Array of operations: {type: "filter"|"sort"|"pick"|"rename"|"deduplicate"|"flatten"|"group"|"map", field?, value?, fields?, direction?, mapping?}',
        },
      },
      required: ['data', 'operations'],
    },
    execute: async (p) => {
      const result = transformData({
        data: p.data as unknown,
        operations: p.operations as Array<{ type: 'filter' | 'sort' | 'pick' | 'rename' | 'deduplicate' | 'flatten' | 'group' | 'map'; field?: string; value?: unknown; fields?: string[]; direction?: 'asc' | 'desc'; mapping?: Record<string, string> }>,
      });
      return {
        output: `Applied ${result.operationsApplied} operations → ${result.recordCount} records\n${result.transformLog.join('\n')}`,
        ...result,
      };
    },
  });

  registerTool({
    name: 'export_data',
    description: 'Export data to a file in JSON, CSV, or text format',
    category: 'data',
    inputSchema: {
      type: 'object',
      properties: {
        data: { description: 'Data to export' },
        format: { type: 'string', description: 'Output format: json, csv, text' },
        path: { type: 'string', description: 'File path to write' },
      },
      required: ['data', 'format', 'path'],
    },
    execute: async (p) => {
      const result = await exportData({
        data: p.data as unknown,
        format: p.format as 'json' | 'csv' | 'text',
        path: p.path as string,
      });
      return {
        output: `Exported ${result.recordCount} records to ${result.path} (${result.format}, ${result.bytesWritten} bytes)`,
        ...result,
      };
    },
  });

  registerTool({
    name: 'validate_schema',
    description: 'Validate data against a JSON schema (checks types, required fields)',
    category: 'data',
    inputSchema: {
      type: 'object',
      properties: {
        data: { description: 'Data to validate (single record or array)' },
        schema: { type: 'object', description: 'JSON schema with properties and required fields' },
      },
      required: ['data', 'schema'],
    },
    execute: async (p) => {
      const result = validateSchema({
        data: p.data as unknown,
        schema: p.schema as Record<string, unknown>,
      });
      const summary = result.valid
        ? `All ${result.recordsChecked} records valid`
        : `${result.failed}/${result.recordsChecked} records failed validation:\n${result.errors.map((e) => `  ${e.path}: ${e.message}`).join('\n')}`;
      return { output: summary, ...result };
    },
  });

  // ─── Provider Hub Tools ───
  registerTool({
    name: 'switch_provider',
    description: 'Switch the active AI provider for a room type',
    category: 'provider',
    inputSchema: {
      type: 'object',
      properties: {
        roomType: { type: 'string', description: 'Room type to switch provider for' },
        provider: { type: 'string', description: 'Provider: anthropic, minimax, openai, ollama' },
      },
      required: ['roomType', 'provider'],
    },
    execute: async (p) => {
      const result = switchProvider({
        roomType: p.roomType as string,
        provider: p.provider as string,
      });
      return {
        output: result.status === 'switched'
          ? `Switched ${result.roomType} from ${result.previousProvider} to ${result.newProvider}`
          : `${result.roomType} already using ${result.newProvider}`,
        ...result,
      };
    },
  });

  registerTool({
    name: 'compare_models',
    description: 'Run a prompt against multiple AI providers and compare responses',
    category: 'provider',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'Prompt to send to each provider' },
        providers: { type: 'array', items: { type: 'string' }, description: 'Providers to compare' },
        maxTokens: { type: 'number', description: 'Max tokens per response (default: 200)' },
      },
      required: ['prompt', 'providers'],
    },
    execute: async (p) => {
      const result = await compareModels({
        prompt: p.prompt as string,
        providers: p.providers as string[],
        maxTokens: (p.maxTokens as number) || 200,
      });
      const lines = result.comparisons.map((c) =>
        c.error
          ? `${c.provider} (${c.model}): ERROR — ${c.error}`
          : `${c.provider} (${c.model}): ${c.responseTime}ms, ${c.outputLength} chars`,
      );
      return {
        output: `Comparison results:\n${lines.join('\n')}\nFastest: ${result.fastest} | Longest output: ${result.longestOutput}`,
        ...result,
      };
    },
  });

  registerTool({
    name: 'configure_fallback',
    description: 'Set up a fallback provider chain for a room type',
    category: 'provider',
    inputSchema: {
      type: 'object',
      properties: {
        roomType: { type: 'string', description: 'Room type' },
        primary: { type: 'string', description: 'Primary provider' },
        fallbacks: { type: 'array', items: { type: 'string' }, description: 'Fallback providers in order' },
        priority: { type: 'number', description: 'Priority (default: 1)' },
      },
      required: ['roomType', 'primary', 'fallbacks'],
    },
    execute: async (p) => {
      const result = configureFallback({
        roomType: p.roomType as string,
        primary: p.primary as string,
        fallbacks: p.fallbacks as string[],
        priority: (p.priority as number) || 1,
      });
      return {
        output: `Fallback chain ${result.status} for ${result.roomType}: ${result.chain.primary} → ${result.chain.fallbacks.join(' → ')}`,
        ...result,
      };
    },
  });

  registerTool({
    name: 'test_provider',
    description: 'Test connectivity and response from an AI provider',
    category: 'provider',
    inputSchema: {
      type: 'object',
      properties: {
        provider: { type: 'string', description: 'Provider to test: anthropic, minimax, openai, ollama' },
      },
      required: ['provider'],
    },
    execute: async (p) => {
      const result = await testProvider({ provider: p.provider as string });
      return {
        output: result.reachable
          ? `${result.provider} (${result.model}): OK — ${result.responseTime}ms`
          : `${result.provider} (${result.model}): FAILED — ${result.error}`,
        ...result,
      };
    },
  });

  // ─── Plugin Bay Tools ───
  registerTool({
    name: 'install_plugin',
    description: 'Install a plugin from a file path or builtin registry',
    category: 'plugin',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Plugin name' },
        source: { type: 'string', description: 'File path or "builtin:name"' },
        version: { type: 'string', description: 'Version (default: 0.0.0)' },
        config: { type: 'object', description: 'Plugin configuration' },
      },
      required: ['name', 'source'],
    },
    execute: async (p) => {
      const result = await installPlugin({
        name: p.name as string,
        source: p.source as string,
        version: (p.version as string) || '0.0.0',
        config: (p.config as Record<string, unknown>) || {},
      });
      return {
        output: `Plugin "${result.name}" ${result.status} (id: ${result.pluginId}, hooks: ${result.hooks.length})`,
        ...result,
      };
    },
  });

  registerTool({
    name: 'uninstall_plugin',
    description: 'Remove/unload a plugin',
    category: 'plugin',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Plugin name' },
        pluginId: { type: 'string', description: 'Plugin ID (alternative to name)' },
      },
    },
    execute: async (p) => {
      const result = await uninstallPlugin({
        name: p.name as string | undefined,
        pluginId: p.pluginId as string | undefined,
      });
      return {
        output: result.status === 'uninstalled'
          ? `Plugin "${result.name}" uninstalled`
          : `Plugin not found: ${p.name || p.pluginId}`,
        ...result,
      };
    },
  });

  registerTool({
    name: 'configure_plugin',
    description: 'Update plugin configuration settings',
    category: 'plugin',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Plugin name' },
        pluginId: { type: 'string', description: 'Plugin ID (alternative to name)' },
        config: { type: 'object', description: 'Configuration key-value pairs to update' },
      },
      required: ['config'],
    },
    execute: async (p) => {
      const result = configurePlugin({
        name: p.name as string | undefined,
        pluginId: p.pluginId as string | undefined,
        config: p.config as Record<string, unknown>,
      });
      return {
        output: `Plugin "${result.name}" configured — ${Object.keys(result.newConfig).length} settings`,
        ...result,
      };
    },
  });

  registerTool({
    name: 'test_plugin',
    description: 'Test a plugin by running a hook in the sandbox',
    category: 'plugin',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Plugin name' },
        pluginId: { type: 'string', description: 'Plugin ID (alternative to name)' },
        hook: { type: 'string', description: 'Hook to test (default: onLoad)' },
      },
    },
    execute: async (p) => {
      const result = await testPlugin({
        name: p.name as string | undefined,
        pluginId: p.pluginId as string | undefined,
        hook: (p.hook as string) || 'onLoad',
      });
      return {
        output: result.passed
          ? `Plugin "${result.name}" hook "${result.hookTested}": PASS (${result.responseTime}ms)`
          : `Plugin "${result.name}" hook "${result.hookTested}": FAIL — ${result.details}`,
        ...result,
      };
    },
  });

  registerTool({
    name: 'list_plugins',
    description: 'List all installed plugins with their status',
    category: 'plugin',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    execute: async () => {
      const result = listPlugins();
      if (result.total === 0) {
        return { output: 'No plugins installed', ...result };
      }
      const lines = result.plugins.map((p) =>
        `${p.name} v${p.version} [${p.status}] — hooks: ${p.hooks.length}, tested: ${p.lastTestResult || 'never'}`,
      );
      return {
        output: `${result.total} plugins (${result.active} active):\n${lines.join('\n')}`,
        ...result,
      };
    },
  });
}
