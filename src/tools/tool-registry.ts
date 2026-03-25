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
import { readFileImpl, writeFileImpl, patchFileImpl, listDirImpl, copyFileImpl } from './providers/filesystem.js';
import { recordNote, recallNotes } from './providers/notes.js';
import { writeNote, readNote, listNotes, deleteNote, clearNotes } from './providers/session-notes.js';
import { webSearch, fetchWebpage } from './providers/web.js';
import { fetchUrl, transformData, exportData, validateSchema } from './providers/data-exchange.js';
import { switchProvider, compareModels, configureFallback, testProvider } from './providers/provider-hub.js';
import { installPlugin, uninstallPlugin, configurePlugin, testPlugin, listPlugins } from './providers/plugin-bay.js';
import { executeStaticAnalysis } from './providers/static-analysis.js';
import { executeDeepAnalysis } from './providers/deep-analysis.js';
import { executeCodeReview } from './providers/code-review.js';
import { executeGitHubIssues } from './providers/github-issues.js';
import { executeGitWorkflow } from './providers/git-workflow.js';
import { executeE2ETest } from './providers/e2e-testing.js';
import { executeGameEngine } from './providers/game-engine.js';
import { executeDevServer } from './providers/dev-server.js';
import { executeBrowserTools } from './providers/browser-tools.js';
import { executeWorkspaceSandbox } from './providers/workspace-sandbox.js';
import { executeMergeQueue } from './providers/merge-queue.js';
import { analyzeScreenshot } from './providers/screenshot-analyzer.js';
import type { Result, ToolDefinition, ToolContext, ToolRegistryAPI, Config } from '../core/contracts.js';
import { getDb } from '../storage/db.js';
import { searchDocuments, getDocumentContent, listDocuments, getDocumentToc, generateManifest } from '../storage/doc-library.js';
import { MiddlewareChain, ResourceLockMiddleware } from './tool-middleware.js';
import { getDefaultResourceDescriptors, getToolConcurrencyMode } from './tool-resource-map.js';

const log = logger.child({ module: 'tool-registry' });

const tools = new Map<string, ToolDefinition>();
let middlewareChain: MiddlewareChain | null = null;

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

  // Attach resource descriptors and concurrency modes to registered tools (#941, #942)
  for (const [name, tool] of tools) {
    const descriptors = getDefaultResourceDescriptors(name);
    if (descriptors) {
      tool.resources = descriptors;
    }
    // Set concurrency mode if not already declared (#942)
    if (!tool.concurrencyMode) {
      tool.concurrencyMode = getToolConcurrencyMode(name);
    }
  }

  // Initialize middleware chain (#941)
  middlewareChain = new MiddlewareChain();
  middlewareChain.add(new ResourceLockMiddleware());

  log.info({ count: tools.size, middlewares: middlewareChain.size }, 'Tool registry initialized');
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
/** List all registered tools with name, description, and category (#689) */
export function listAllTools(): Array<{ name: string; description: string; category: string }> {
  return Array.from(tools.values()).map(t => ({
    name: t.name,
    description: t.description || '',
    category: t.category || 'general',
  })).sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
}

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
  /** Whether resource locking is enabled. Default: true (#941). */
  resourceLocking?: boolean;
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
    const finalExecute = async (): Promise<Result> => {
      const result = await tool.execute(params.params, params.context);
      return ok(result);
    };

    // Route through middleware chain if available and locking enabled (#941)
    if (middlewareChain && params.resourceLocking !== false) {
      return await middlewareChain.execute(tool, params.params, params.context, finalExecute);
    }

    return await finalExecute();
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
    execute: async (p, ctx) => {
      const timeout = p.timeout as number | undefined;
      if (timeout !== undefined && (timeout <= 0 || timeout > 300_000)) {
        throw new Error('Timeout must be between 1 and 300000 ms');
      }
      const result = await executeShell({
        command: p.command as string,
        timeout,
        cwd: ctx?.workingDirectory,
      });
      if (result.timedOut) {
        return { output: `Command timed out.\nPartial stdout: ${result.stdout}\nPartial stderr: ${result.stderr}` };
      }
      if (result.exitCode !== 0) {
        return { output: `Exit code ${result.exitCode}\nstdout: ${result.stdout}\nstderr: ${result.stderr}` };
      }

      // Detect build output directories in successful commands (#607)
      const cmd = (p.command as string).toLowerCase();
      const isBuild = /\b(build|compile|bundle|pack|dist)\b/.test(cmd);
      let buildOutput: string | undefined;
      if (isBuild && ctx?.workingDirectory) {
        const fs = await import('node:fs');
        const path = await import('node:path');
        for (const dir of ['dist', 'build', 'out', 'target/release', 'target/debug', '.next', '.output']) {
          const fullDir = path.resolve(ctx.workingDirectory, dir);
          if (fs.existsSync(fullDir)) {
            try {
              const entries = fs.readdirSync(fullDir);
              buildOutput = `${fullDir} (${entries.length} files)`;
              break; // only break on successful read — skip to next dir on error
            } catch { /* permission denied or other error — try next dir */ }
          }
        }
      }

      const output = result.stdout || '(no output)';
      return buildOutput
        ? { output: `${output}\n\n📦 Build output: ${buildOutput}` }
        : { output };
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
    execute: async (p, ctx) => {
      const result = await readFileImpl({ path: p.path as string, cwd: ctx?.workingDirectory, allowedPaths: ctx?.allowedPaths });
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
    execute: async (p, ctx) => {
      const result = await writeFileImpl({ path: p.path as string, content: p.content as string, cwd: ctx?.workingDirectory, allowedPaths: ctx?.allowedPaths });
      return { output: `Written ${result.bytesWritten} bytes to ${result.path}`, path: result.path };
    },
  });

  registerTool({
    name: 'copy_file',
    description: 'Copy a file from source to destination. Bypasses AI context — efficient for large files.',
    category: 'file',
    inputSchema: {
      type: 'object',
      properties: {
        source: { type: 'string', description: 'Source file path to copy from' },
        destination: { type: 'string', description: 'Destination file path to copy to' },
      },
      required: ['source', 'destination'],
    },
    execute: async (p, ctx) => {
      const result = await copyFileImpl({ source: p.source as string, destination: p.destination as string, cwd: ctx?.workingDirectory || '.', allowedPaths: ctx?.allowedPaths });
      return { output: `Copied ${result.bytesCopied} bytes: ${result.source} → ${result.destination}` };
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
    execute: async (p, ctx) => {
      const result = await patchFileImpl({
        path: p.path as string,
        search: p.search as string,
        replace: p.replace as string,
        cwd: ctx?.workingDirectory,
        allowedPaths: ctx?.allowedPaths,
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
    execute: async (p, ctx) => {
      const result = await listDirImpl({ path: p.path as string, cwd: ctx?.workingDirectory, allowedPaths: ctx?.allowedPaths });
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
      execute: async (p, ctx) => {
        const args = p.args as string | undefined;
        if (args) rejectShellMeta(args, `${qa} args`);
        const cmd = `${cmdMap[qa]}${args ? ` ${args}` : ''}`;
        const result = await executeShell({ command: cmd, timeout: 120_000, cwd: ctx?.workingDirectory });
        return { output: result.stdout + (result.stderr ? `\n${result.stderr}` : ''), exitCode: result.exitCode };
      },
    });
  }

  // --- QA Static Analysis ---
  registerTool({
    name: 'qa_static_analysis',
    description: 'QA: auto-detect project type and run lint/type-check',
    category: 'qa',
    inputSchema: {
      type: 'object',
      properties: {
        projectDir: { type: 'string', description: 'Project directory to analyze' },
        checks: { type: 'array', items: { type: 'string' }, description: 'Checks to run: lint, typecheck (default: both)' },
      },
      required: ['projectDir'],
    },
    execute: async (p) => {
      const result = await executeStaticAnalysis({
        projectDir: p.projectDir as string,
        checks: p.checks as string[] | undefined,
      });
      if (!result.ok) {
        return { output: result.error.message, error: true };
      }
      const d = result.data;
      return {
        output: '[' + d.projectType + '] ' + d.summary,
        ...d,
      };
    },
  });

  // --- QA Deep Analysis ---
  registerTool({
    name: 'qa_deep_analysis',
    description: 'QA: run security audit, dependency check, and complexity analysis',
    category: 'qa',
    inputSchema: {
      type: 'object',
      properties: {
        projectDir: { type: 'string', description: 'Project directory to analyze' },
        analysisType: { type: 'string', description: 'Type: security, dependencies, complexity, all (default: all)' },
      },
      required: ['projectDir'],
    },
    execute: async (p) => {
      const result = await executeDeepAnalysis({
        projectDir: p.projectDir as string,
        analysisType: p.analysisType as 'security' | 'dependencies' | 'complexity' | 'all' | undefined,
      });
      if (!result.ok) {
        return { output: result.error.message, error: true };
      }
      const d = result.data;
      return {
        output: d.summary,
        ...d,
      };
    },
  });

  // ─── Code Review ───
  registerTool({
    name: 'code_review',
    description: 'Review code changes by analyzing git diff for issues (security, performance, style)',
    category: 'qa',
    inputSchema: {
      type: 'object',
      properties: {
        files: { type: 'array', items: { type: 'string' }, description: 'Files to review' },
        projectDir: { type: 'string', description: 'Project directory' },
        reviewType: { type: 'string', description: 'Review type: full, security, performance (default: full)' },
      },
      required: ['files', 'projectDir'],
    },
    execute: async (p) => {
      const result = await executeCodeReview({
        files: p.files as string[],
        projectDir: p.projectDir as string,
        reviewType: (p.reviewType as 'full' | 'security' | 'performance') || 'full',
      });
      if (!result.ok) {
        return { output: result.error.message, error: true };
      }
      const d = result.data;
      return {
        output: d.summary,
        ...d,
      };
    },
  });

  // ─── GitHub Issues ───
  registerTool({
    name: 'github_issues',
    description: 'Manage GitHub Issues: create, list, get, close, comment',
    category: 'github',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', description: 'Action: create, list, get, close, comment' },
        repo: { type: 'string', description: 'Repository (owner/repo) — defaults to current repo' },
        title: { type: 'string', description: 'Issue title (for create)' },
        body: { type: 'string', description: 'Issue body or comment text' },
        issueNumber: { type: 'number', description: 'Issue number (for get, close, comment)' },
        labels: { type: 'array', items: { type: 'string' }, description: 'Labels (for create)' },
      },
      required: ['action'],
    },
    execute: async (p, ctx) => {
      const result = await executeGitHubIssues({
        action: p.action as 'create' | 'list' | 'get' | 'close' | 'comment',
        repo: p.repo as string | undefined,
        title: p.title as string | undefined,
        body: p.body as string | undefined,
        issueNumber: p.issueNumber as number | undefined,
        labels: p.labels as string[] | undefined,
        cwd: ctx?.workingDirectory,
      });
      if (!result.ok) {
        return { output: result.error.message, error: true };
      }
      const { output: ghOutput, ...ghRest } = result.data;
      return { output: ghOutput, ...ghRest };
    },
  });

  // ─── Git Workflow ───
  registerTool({
    name: 'git_workflow',
    description: 'Structured git operations: branch, commit, push, pr, status, diff',
    category: 'github',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', description: 'Action: branch, commit, push, pr, status, diff' },
        projectDir: { type: 'string', description: 'Project directory' },
        branch: { type: 'string', description: 'Branch name (for branch, push)' },
        message: { type: 'string', description: 'Commit message or PR title' },
        files: { type: 'array', items: { type: 'string' }, description: 'Files to stage or diff' },
      },
      required: ['action', 'projectDir'],
    },
    execute: async (p) => {
      const result = await executeGitWorkflow({
        action: p.action as 'branch' | 'commit' | 'push' | 'pr' | 'status' | 'diff',
        projectDir: p.projectDir as string,
        branch: p.branch as string | undefined,
        message: p.message as string | undefined,
        files: p.files as string[] | undefined,
      });
      if (!result.ok) {
        return { output: result.error.message, error: true };
      }
      const { output: gitOutput, ...gitRest } = result.data;
      return { output: gitOutput, ...gitRest };
    },
  });

  // ─── E2E Testing ───
  registerTool({
    name: 'e2e_test',
    description: 'Auto-detect test framework and run E2E tests with structured results',
    category: 'qa',
    inputSchema: {
      type: 'object',
      properties: {
        projectDir: { type: 'string', description: 'Project directory' },
        testCommand: { type: 'string', description: 'Custom test command (overrides auto-detection)' },
        framework: { type: 'string', description: 'Framework hint (playwright, cypress, jest, vitest, mocha)' },
      },
      required: ['projectDir'],
    },
    execute: async (p) => {
      const result = await executeE2ETest({
        projectDir: p.projectDir as string,
        testCommand: p.testCommand as string | undefined,
        framework: p.framework as string | undefined,
      });
      if (!result.ok) {
        return { output: result.error.message, error: true };
      }
      const { output: _rawOutput, ...e2eRest } = result.data;
      return {
        output: `[${result.data.framework}] ${result.data.testsRun} tests — ${result.data.passed} passed, ${result.data.failed} failed (${result.data.duration}ms)`,
        rawOutput: _rawOutput,
        ...e2eRest,
      };
    },
  });

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
    execute: async (p, ctx) => {
      const action = p.action as string;
      rejectShellMeta(action, 'github action');
      const result = await executeShell({ command: `gh ${action}`, timeout: 30_000, cwd: ctx?.workingDirectory });
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

  // ─── Session Notes (Agent Scratchpad) ───
  registerTool({
    name: 'session_note',
    description: 'Manage persistent agent notes (scratchpad). Notes survive context pruning and are injected into system prompt.',
    category: 'notes',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', description: 'Action: write, read, list, delete, clear' },
        key: { type: 'string', description: 'Note key (required for write, read, delete)' },
        value: { type: 'string', description: 'Note value (required for write)' },
        targetAgentId: { type: 'string', description: 'Read another agent\'s notes (for cross-agent visibility)' },
      },
      required: ['action'],
    },
    execute: async (p, ctx) => {
      const action = p.action as string;
      const agentId = (p.targetAgentId as string) || ctx?.agentId || 'unknown';
      const key = p.key as string;
      // ToolContext doesn't declare buildingId; extract from ctx if the room injected it
      const buildingId = ctx?.buildingId;

      switch (action) {
        case 'write': {
          if (!key || !p.value) return { output: 'Error: "key" and "value" required for write' };
          const result = writeNote(agentId, key, p.value as string, buildingId);
          return { output: result.message, ok: result.ok };
        }
        case 'read': {
          if (!key) return { output: 'Error: "key" required for read' };
          const note = readNote(agentId, key);
          if (!note) return { output: `Note "${key}" not found`, found: false };
          return { output: `[${note.key}] (updated: ${note.updatedAt})\n${note.value}`, found: true, note };
        }
        case 'list': {
          const notes = listNotes(agentId);
          if (notes.length === 0) return { output: 'No session notes', notes: [], count: 0 };
          const lines = notes.map(n => `- ${n.key}: ${n.value.slice(0, 100)}${n.value.length > 100 ? '...' : ''}`);
          return { output: `${notes.length} notes:\n${lines.join('\n')}`, notes, count: notes.length };
        }
        case 'delete': {
          if (!key) return { output: 'Error: "key" required for delete' };
          const result = deleteNote(agentId, key);
          return { output: result.message, ok: result.ok };
        }
        case 'clear': {
          const result = clearNotes(agentId);
          return { output: `Cleared ${result.count} notes`, ok: result.ok, count: result.count };
        }
        default:
          return { output: `Unknown action "${action}". Use: write, read, list, delete, clear` };
      }
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

  // ─── Game Engine ───
  registerTool({
    name: 'game_engine',
    description: 'Auto-detect game engine and run build/test/run commands (Unity, Unreal, Godot, GameMaker, Phaser)',
    category: 'engine',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', description: 'Action: detect, build, test, run' },
        projectDir: { type: 'string', description: 'Project directory' },
        engine: { type: 'string', description: 'Engine override: unity, unreal, godot, gamemaker, phaser' },
      },
      required: ['action', 'projectDir'],
    },
    execute: async (p) => {
      const result = await executeGameEngine({
        action: p.action as 'detect' | 'build' | 'test' | 'run',
        projectDir: p.projectDir as string,
        engine: p.engine as string | undefined,
      });
      if (!result.ok) {
        return { output: result.error.message, error: true };
      }
      const { output, ...rest } = result.data;
      return { output, ...rest };
    },
  });

  // ─── Dev Server ───
  registerTool({
    name: 'dev_server',
    description: 'Manage background dev servers: start, stop, status, logs',
    category: 'server',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', description: 'Action: start, stop, status, logs' },
        projectDir: { type: 'string', description: 'Project directory' },
        command: { type: 'string', description: 'Server command (default: npm run dev)' },
        port: { type: 'number', description: 'Port number (default: 3000)' },
      },
      required: ['action', 'projectDir'],
    },
    execute: async (p) => {
      const result = await executeDevServer({
        action: p.action as 'start' | 'stop' | 'status' | 'logs',
        projectDir: p.projectDir as string,
        command: p.command as string | undefined,
        port: p.port as number | undefined,
      });
      if (!result.ok) {
        return { output: result.error.message, error: true };
      }
      const d = result.data;
      const parts = [`[${d.action}] ${d.projectDir}`];
      if (d.pid) parts.push(`PID: ${d.pid}`);
      if (d.url) parts.push(`URL: ${d.url}`);
      if (d.running !== undefined) parts.push(d.running ? 'RUNNING' : 'STOPPED');
      const { output: dOutput, ...dRest } = d;
      return { output: dOutput || parts.join(' | '), ...dRest };
    },
  });

  // ─── Browser Tools ───
  registerTool({
    name: 'browser_tools',
    description: 'Browser automation: screenshot (Playwright headless), navigate, inspect',
    category: 'browser',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', description: 'Action: screenshot, navigate, inspect' },
        url: { type: 'string', description: 'URL to interact with' },
        selector: { type: 'string', description: 'CSS selector (for screenshot targeting or inspect)' },
      },
      required: ['action', 'url'],
    },
    execute: async (p) => {
      const result = await executeBrowserTools({
        action: p.action as 'screenshot' | 'navigate' | 'inspect',
        url: p.url as string,
        selector: p.selector as string | undefined,
      });
      if (!result.ok) {
        return { output: result.error.message, error: true };
      }
      const { output: btOutput, ...btRest } = result.data;
      return { output: btOutput, ...btRest };
    },
  });

  // ─── Screenshot (dedicated tool alias for room access) ───
  registerTool({
    name: 'screenshot',
    description: 'Take a real browser screenshot of a URL using Playwright headless. Returns the file path — pass to MiniMax understand_image to analyze visually.',
    category: 'browser',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL to screenshot (e.g., http://localhost:3000 or https://mygardenly.netlify.app)' },
        selector: { type: 'string', description: 'Optional CSS selector to screenshot a specific element' },
      },
      required: ['url'],
    },
    execute: async (p) => {
      const result = await executeBrowserTools({
        action: 'screenshot',
        url: p.url as string,
        selector: p.selector as string | undefined,
      });
      if (!result.ok) {
        return { output: result.error.message, error: true };
      }
      const { output: btOutput, ...btRest } = result.data;
      return { output: btOutput, ...btRest };
    },
  });

  // ─── Screenshot Analyzer (Vision AI) ───
  registerTool({
    name: 'analyze_screenshot',
    description: 'Analyze a screenshot using AI vision. Reads a PNG/JPG file and returns a description of visible UI elements, data, and any issues. Use after the screenshot tool.',
    category: 'browser',
    inputSchema: {
      type: 'object',
      properties: {
        screenshotPath: { type: 'string', description: 'Path to the screenshot PNG/JPG file (from screenshot tool output)' },
        prompt: { type: 'string', description: 'Optional: specific question about the screenshot (e.g., "Is the weather widget showing data?")' },
      },
      required: ['screenshotPath'],
    },
    execute: async (p) => {
      const result = await analyzeScreenshot({
        screenshotPath: p.screenshotPath as string,
        prompt: p.prompt as string | undefined,
      });
      if (!result.ok) {
        return { output: result.error.message, error: true };
      }
      const { description, elements, issues, screenshotPath: path } = result.data;
      const issuesSummary = issues.length > 0
        ? `\n\nISSUES FOUND (${issues.length}):\n${issues.map(i => `  - ${i}`).join('\n')}`
        : '\n\nNo visual issues detected.';
      return {
        output: `${description}\n\nUI Elements: ${elements.join(', ')}${issuesSummary}`,
        description,
        elements,
        issues,
        screenshotPath: path,
      };
    },
  });

  // ─── Workspace Sandbox ───
  registerTool({
    name: 'workspace_sandbox',
    description: 'Manage isolated git worktree sandboxes: create, destroy, list, status, merge-ready',
    category: 'workspace',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', description: 'Action: create, destroy, list, status, merge-ready' },
        projectDir: { type: 'string', description: 'Git repository directory' },
        branch: { type: 'string', description: 'Branch name (default: main)' },
      },
      required: ['action', 'projectDir'],
    },
    execute: async (p) => {
      const result = await executeWorkspaceSandbox({
        action: p.action as 'create' | 'destroy' | 'list' | 'status' | 'merge-ready',
        projectDir: p.projectDir as string,
        branch: p.branch as string | undefined,
      });
      if (!result.ok) {
        return { output: result.error.message, error: true };
      }
      const { output: wsOutput, ...wsRest } = result.data;
      return { output: wsOutput, ...wsRest };
    },
  });

  // ─── Merge Queue (#944) ───

  registerTool({
    name: 'merge_queue',
    description: 'Manage sequential merge queue for worktree branches: enqueue, dequeue, process, status, drift',
    category: 'workspace',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', description: 'Action: enqueue, dequeue, process, status, drift' },
        buildingId: { type: 'string', description: 'Building ID' },
        projectDir: { type: 'string', description: 'Git repository directory' },
        branch: { type: 'string', description: 'Branch name (for enqueue/drift)' },
        worktreePath: { type: 'string', description: 'Worktree path (for enqueue)' },
        agentId: { type: 'string', description: 'Agent requesting merge (for enqueue)' },
        priority: { type: 'string', description: 'Priority: hotfix, feature, refactor, auto' },
        entryId: { type: 'string', description: 'Queue entry ID (for dequeue)' },
      },
      required: ['action', 'buildingId'],
    },
    execute: async (p, ctx) => {
      const result = await executeMergeQueue({
        action: p.action as string,
        buildingId: p.buildingId as string,
        projectDir: p.projectDir as string | undefined,
        branch: p.branch as string | undefined,
        worktreePath: p.worktreePath as string | undefined,
        agentId: (p.agentId as string) || ctx?.agentId || 'unknown',
        priority: (p.priority as string) || 'feature',
        entryId: p.entryId as string | undefined,
      });
      if (!result.ok) {
        return { output: result.error.message, error: true };
      }
      return result.data;
    },
  });

  // ─── Overlord Project Management Tools (#788) ───

  registerTool({
    name: 'create_task',
    description: 'Create a task in the current project. Use this when you identify work that needs to be done.',
    category: 'project',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Short descriptive title for the task' },
        description: { type: 'string', description: 'Detailed description of what needs to be done' },
        priority: { type: 'string', enum: ['low', 'normal', 'high', 'critical'], description: 'Task priority (default: normal)' },
        phase: { type: 'string', description: 'Project phase this task belongs to (e.g., strategy, discovery, architecture, execution)' },
        milestone_id: { type: 'string', description: 'ID of the milestone to link this task to (from create_milestone response)' },
      },
      required: ['title'],
    },
    execute: async (p, ctx) => {
      const buildingId = ctx?.buildingId;
      if (!buildingId) return { output: 'Error: no active building', error: true };

      const db = getDb();
      const title = p.title as string;
      const description = (p.description as string) || '';
      const priority = (p.priority as string) || 'normal';
      // Default phase to current building phase if not specified (#1199)
      let phase = (p.phase as string) || null;
      if (!phase) {
        const building = db.prepare('SELECT active_phase FROM buildings WHERE id = ?').get(buildingId) as { active_phase: string } | undefined;
        phase = building?.active_phase || null;
      }
      const milestoneId = (p.milestone_id as string) || null;

      // #1134 — Dedup check: skip if a task with very similar title already exists
      const existing = db.prepare(
        `SELECT id, title FROM tasks WHERE building_id = ? AND LOWER(title) = LOWER(?)`
      ).get(buildingId, title) as { id: string; title: string } | undefined;
      if (existing) {
        return {
          output: `Task already exists: "${existing.title}" (id: ${existing.id}) — skipped duplicate`,
          taskId: existing.id,
        };
      }
      // Also check for fuzzy match (title contains or is contained by existing)
      const fuzzy = db.prepare(
        `SELECT id, title FROM tasks WHERE building_id = ? AND (LOWER(title) LIKE '%' || LOWER(?) || '%' OR LOWER(?) LIKE '%' || LOWER(title) || '%') LIMIT 1`
      ).get(buildingId, title.slice(0, 40), title.slice(0, 40)) as { id: string; title: string } | undefined;
      if (fuzzy) {
        return {
          output: `Similar task exists: "${fuzzy.title}" (id: ${fuzzy.id}) — skipped to avoid duplicate`,
          taskId: fuzzy.id,
        };
      }

      const id = `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      db.prepare(`
        INSERT INTO tasks (id, building_id, title, description, priority, phase, status, assignee_id, milestone_id)
        VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)
      `).run(id, buildingId, title, description, priority, phase, ctx?.agentId || null, milestoneId);

      return {
        output: `Task created: "${title}" (${priority} priority)${phase ? ` for ${phase} phase` : ''}${milestoneId ? ` [linked to milestone]` : ''}`,
        taskId: id,
      };
    },
  });

  // ── Update Task Status (#1022) ──
  registerTool({
    name: 'update_task',
    description: 'Update a task status. Use this to mark tasks as in-progress when you start working on them, or done when you finish.',
    category: 'project',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: { type: 'string', description: 'The task ID to update (from create_task response or task listing)' },
        status: { type: 'string', enum: ['in-progress', 'done', 'blocked'], description: 'New status for the task' },
        note: { type: 'string', description: 'Optional completion note describing what was done' },
      },
      required: ['task_id', 'status'],
    },
    execute: async (p, ctx) => {
      const buildingId = ctx?.buildingId;
      if (!buildingId) return { output: 'Error: no active building', error: true };

      const db = getDb();
      const taskId = p.task_id as string;
      // Normalize status: accept both in_progress and in-progress (#1203)
      let status = p.status as string;
      if (status === 'in_progress') status = 'in-progress';
      const note = (p.note as string) || '';

      // Verify task exists and belongs to this building
      const task = db.prepare('SELECT id, title, status FROM tasks WHERE id = ? AND building_id = ?').get(taskId, buildingId) as { id: string; title: string; status: string } | undefined;
      if (!task) return { output: `Error: task ${taskId} not found in this building`, error: true };

      db.prepare('UPDATE tasks SET status = ?, updated_at = datetime(?) WHERE id = ?')
        .run(status, new Date().toISOString(), taskId);

      // Append completion note to description if provided
      if (note) {
        db.prepare("UPDATE tasks SET description = COALESCE(description, '') || ? WHERE id = ?")
          .run(`\n\n---\n**${status === 'done' ? 'Completed' : 'Update'}:** ${note}`, taskId);
      }

      // Emit event for real-time UI updates (#1023)
      if (ctx?.bus && typeof (ctx.bus as { emit?: unknown }).emit === 'function') {
        (ctx.bus as { emit: (e: string, d: Record<string, unknown>) => void }).emit('task:updated', { taskId, buildingId, status, previousStatus: task.status, title: task.title, agentId: ctx.agentId });
      }

      return {
        output: `Task "${task.title}" updated: ${task.status} → ${status}${note ? ` (${note})` : ''}`,
      };
    },
  });

  registerTool({
    name: 'create_raid_entry',
    description: 'Log a Risk, Assumption, Issue, or Decision in the project RAID log. Use this proactively when you identify risks, make assumptions, discover issues, or make decisions.',
    category: 'project',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['risk', 'assumption', 'issue', 'decision'], description: 'RAID entry type' },
        summary: { type: 'string', description: 'Brief summary of the entry' },
        rationale: { type: 'string', description: 'Why this matters — context and reasoning' },
        affectedAreas: { type: 'array', items: { type: 'string' }, description: 'Areas of the project affected (e.g., architecture, neural-network, rendering)' },
      },
      required: ['type', 'summary'],
    },
    execute: async (p, ctx) => {
      const buildingId = ctx?.buildingId;
      if (!buildingId) return { output: 'Error: no active building', error: true };

      const db = getDb();
      const type = p.type as string;
      const summary = p.summary as string;
      const rationale = (p.rationale as string) || '';
      const affectedAreas = Array.isArray(p.affectedAreas) ? p.affectedAreas : [];

      // #1134 — Dedup: skip if a RAID entry of the same type with similar summary exists
      const existing = db.prepare(
        `SELECT id, summary FROM raid_entries WHERE building_id = ? AND type = ? AND (LOWER(summary) = LOWER(?) OR LOWER(summary) LIKE '%' || LOWER(?) || '%')`
      ).get(buildingId, type, summary, summary.slice(0, 30)) as { id: string; summary: string } | undefined;
      if (existing) {
        const typeLabel = { risk: 'Risk', assumption: 'Assumption', issue: 'Issue', decision: 'Decision' }[type] || type;
        return {
          output: `${typeLabel} already exists: "${existing.summary}" (id: ${existing.id}) — skipped duplicate`,
          entryId: existing.id,
        };
      }

      const id = `raid_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      db.prepare(`
        INSERT INTO raid_entries (id, building_id, type, phase, summary, rationale, decided_by, affected_areas, status)
        VALUES (?, ?, ?, (SELECT active_phase FROM buildings WHERE id = ?), ?, ?, ?, ?, 'active')
      `).run(id, buildingId, type, buildingId, summary, rationale, ctx?.agentId || null, JSON.stringify(affectedAreas));

      const typeLabel = { risk: 'Risk', assumption: 'Assumption', issue: 'Issue', decision: 'Decision' }[type] || type;
      return {
        output: `${typeLabel} logged: "${summary}"`,
        entryId: id,
      };
    },
  });

  registerTool({
    name: 'create_milestone',
    description: 'Create a project milestone. Use this to define key delivery points.',
    category: 'project',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Milestone name (e.g., "v0.1 — Core Simulation Running")' },
        description: { type: 'string', description: 'What this milestone represents' },
      },
      required: ['title'],
    },
    execute: async (p, ctx) => {
      const buildingId = ctx?.buildingId;
      if (!buildingId) return { output: 'Error: no active building', error: true };

      const db = getDb();
      const title = p.title as string;
      const description = (p.description as string) || '';

      // #1134 — Dedup: skip if milestone with similar title exists
      const existing = db.prepare(
        `SELECT id, title FROM milestones WHERE building_id = ? AND (LOWER(title) = LOWER(?) OR LOWER(title) LIKE '%' || LOWER(?) || '%')`
      ).get(buildingId, title, title.slice(0, 30)) as { id: string; title: string } | undefined;
      if (existing) {
        return {
          output: `Milestone already exists: "${existing.title}" (id: ${existing.id}) — skipped duplicate`,
          milestoneId: existing.id,
        };
      }

      const id = `ms_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      db.prepare(`
        INSERT INTO milestones (id, building_id, title, description, status)
        VALUES (?, ?, ?, ?, 'active')
      `).run(id, buildingId, title, description);

      return {
        output: `Milestone created: "${title}"`,
        milestoneId: id,
      };
    },
  });

  // ─── Documentation Library Tools (#811) ───

  registerTool({
    name: 'search_library',
    description: 'Search project documentation libraries for information. Use this to find relevant docs, specs, guides, or code references.',
    category: 'documentation',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query — keywords, concepts, or questions' },
        limit: { type: 'number', description: 'Max results (default: 10)' },
      },
      required: ['query'],
    },
    execute: async (p, ctx) => {
      const buildingId = ctx?.buildingId;
      const result = searchDocuments({
        query: p.query as string,
        buildingId: buildingId || undefined,
        limit: (p.limit as number) || 10,
      });
      if (!result.ok) return { output: result.error?.message || 'Search failed', error: true };
      const docs = result.data as Array<{ title: string; summary: string; file_path: string; library_name: string }>;
      if (docs.length === 0) return { output: 'No matching documents found.' };
      const lines = docs.map((d, i) =>
        `${i + 1}. **${d.title}** (${d.library_name})\n   ${d.summary}\n   Path: ${d.file_path}`
      );
      return { output: `Found ${docs.length} documents:\n\n${lines.join('\n\n')}` };
    },
  });

  registerTool({
    name: 'get_document',
    description: 'Read the full content of a document from the project documentation library.',
    category: 'documentation',
    inputSchema: {
      type: 'object',
      properties: {
        documentId: { type: 'string', description: 'Document entry ID from search results' },
      },
      required: ['documentId'],
    },
    execute: async (p) => {
      const result = getDocumentContent(p.documentId as string);
      if (!result.ok) return { output: result.error?.message || 'Document not found', error: true };
      const doc = result.data as { title: string; content: string; file_path: string; toc: Array<{ level: number; title: string; lineNumber: number }> };
      // Include TOC navigation if available (#814)
      let tocSection = '';
      if (doc.toc && doc.toc.length > 0) {
        const tocLines = doc.toc.map(t => `${'  '.repeat(t.level - 1)}- ${t.title} (line ${t.lineNumber})`);
        tocSection = `\n## Table of Contents\n${tocLines.join('\n')}\n\n---\n\n`;
      }
      return { output: `# ${doc.title}\n${tocSection}${doc.content}` };
    },
  });

  registerTool({
    name: 'list_library',
    description: 'List all documents in a documentation library with their summaries.',
    category: 'documentation',
    inputSchema: {
      type: 'object',
      properties: {
        libraryId: { type: 'string', description: 'Library ID to list' },
      },
      required: ['libraryId'],
    },
    execute: async (p) => {
      const result = listDocuments(p.libraryId as string);
      if (!result.ok) return { output: result.error?.message || 'Library not found', error: true };
      const docs = result.data as Array<{ title: string; file_path: string; word_count: number; format: string }>;
      if (docs.length === 0) return { output: 'Library is empty.' };
      const lines = docs.map(d => `- ${d.title} (${d.format}, ${d.word_count} words) — ${d.file_path}`);
      return { output: `${docs.length} documents:\n\n${lines.join('\n')}` };
    },
  });

  registerTool({
    name: 'get_document_toc',
    description: 'Get the table of contents (heading structure) for a document. Useful for navigating large documents without reading the full content.',
    category: 'documentation',
    inputSchema: {
      type: 'object',
      properties: {
        documentId: { type: 'string', description: 'Document entry ID' },
      },
      required: ['documentId'],
    },
    execute: async (p) => {
      const result = getDocumentToc(p.documentId as string);
      if (!result.ok) return { output: result.error?.message || 'TOC not found', error: true };
      const toc = result.data as Array<{ level: number; title: string; lineNumber: number }>;
      if (toc.length === 0) return { output: 'No table of contents available for this document.' };
      const lines = toc.map(t => `${'  '.repeat(t.level - 1)}- ${t.title} (line ${t.lineNumber})`);
      return { output: `Table of Contents:\n\n${lines.join('\n')}` };
    },
  });

  registerTool({
    name: 'get_library_manifest',
    description: 'Get a complete manifest of a documentation library — all documents, their summaries, topics, and table of contents. Use this for a comprehensive overview of available documentation.',
    category: 'documentation',
    inputSchema: {
      type: 'object',
      properties: {
        libraryId: { type: 'string', description: 'Library ID' },
      },
      required: ['libraryId'],
    },
    execute: async (p) => {
      const result = generateManifest(p.libraryId as string);
      if (!result.ok) return { output: result.error?.message || 'Library not found', error: true };
      const manifest = result.data;
      const header = `# ${manifest.name}\n\n${manifest.description || ''}\n\n` +
        `**${manifest.documentCount} documents** | ${manifest.totalWords.toLocaleString()} words | ` +
        `Topics: ${manifest.topTopics.slice(0, 8).join(', ')}\n`;
      const docList = manifest.documents.map(d => {
        const tocPreview = d.toc.length > 0 ? `\n    TOC: ${d.toc.slice(0, 5).map(t => t.title).join(' → ')}${d.toc.length > 5 ? '...' : ''}` : '';
        return `- **${d.title}** (${d.format}, ${d.wordCount} words)\n  ${d.summary}${tocPreview}`;
      });
      return { output: `${header}\n## Documents\n\n${docList.join('\n\n')}` };
    },
  });

  // ── Documentation Specialist Tools (#815) ──

  registerTool({
    name: 'validate_documentation',
    description: 'Validate project documentation for freshness, completeness, and consistency. Checks CHANGELOG, README, and other doc files against the current code state.',
    category: 'documentation',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    execute: async (_p, ctx) => {
      const { validateDocumentation } = await import('./providers/doc-validator.js');
      const result = validateDocumentation({
        workingDirectory: ctx?.workingDirectory || '.',
      });
      if (!result.ok) return { output: result.error?.message || 'Validation failed', error: true };
      const report = result.data;
      const sections: string[] = [
        `## Documentation Validation Report`,
        '',
        `**Freshness:** ${report.freshness.status} — ${report.freshness.details}`,
        `**Completeness:** ${report.completeness.status} — ${report.completeness.details}`,
        `**Consistency:** ${report.consistency.status} — ${report.consistency.details}`,
      ];
      if (report.issues.length > 0) {
        sections.push('', '### Issues Found', ...report.issues.map((i: string, idx: number) => `${idx + 1}. ${i}`));
      }
      if (report.suggestions.length > 0) {
        sections.push('', '### Suggestions', ...report.suggestions.map((s: string) => `- ${s}`));
      }
      return { output: sections.join('\n') };
    },
  });

  // ── Document Format Tools (#812) ──

  registerTool({
    name: 'read_pdf',
    description: 'Extract text and metadata from a PDF file. Returns page count, text content, and document info.',
    category: 'document',
    inputSchema: {
      type: 'object',
      properties: {
        filePath: { type: 'string', description: 'Path to the PDF file' },
        pages: { type: 'string', description: 'Optional page range, e.g. "1-5" or "3"' },
      },
      required: ['filePath'],
    },
    execute: async (p, ctx) => {
      const { readPdfImpl } = await import('./providers/document-formats.js');
      const result = await readPdfImpl({
        filePath: p.filePath as string,
        pages: p.pages as string | undefined,
        cwd: ctx?.workingDirectory,
        allowedPaths: ctx?.allowedPaths,
      });
      return { output: `PDF: ${result.pageCount} pages\n\n${result.text}` };
    },
  });

  registerTool({
    name: 'read_docx',
    description: 'Extract text and structure from a Word document (.docx). Returns plain text, HTML, and word count.',
    category: 'document',
    inputSchema: {
      type: 'object',
      properties: {
        filePath: { type: 'string', description: 'Path to the DOCX file' },
      },
      required: ['filePath'],
    },
    execute: async (p, ctx) => {
      const { readDocxImpl } = await import('./providers/document-formats.js');
      const result = await readDocxImpl({
        filePath: p.filePath as string,
        cwd: ctx?.workingDirectory,
        allowedPaths: ctx?.allowedPaths,
      });
      return { output: `DOCX: ${result.wordCount} words\n\n${result.text}` };
    },
  });

  registerTool({
    name: 'read_xlsx',
    description: 'Extract tabular data from an Excel spreadsheet (.xlsx). Returns sheet names, headers, and row data as JSON.',
    category: 'document',
    inputSchema: {
      type: 'object',
      properties: {
        filePath: { type: 'string', description: 'Path to the XLSX file' },
        sheet: { type: 'string', description: 'Sheet name (defaults to first sheet)' },
      },
      required: ['filePath'],
    },
    execute: async (p, ctx) => {
      const { readXlsxImpl } = await import('./providers/document-formats.js');
      const result = await readXlsxImpl({
        filePath: p.filePath as string,
        sheet: p.sheet as string | undefined,
        cwd: ctx?.workingDirectory,
        allowedPaths: ctx?.allowedPaths,
      });
      const preview = result.data.slice(0, 20);
      return { output: `XLSX: ${result.rowCount} rows, ${result.headers.length} columns\nSheets: ${result.sheets.join(', ')}\nHeaders: ${result.headers.join(', ')}\n\n${JSON.stringify(preview, null, 2)}` };
    },
  });

  registerTool({
    name: 'parse_markdown',
    description: 'Parse a Markdown file into structured data: table of contents, code blocks, links, and word count.',
    category: 'document',
    inputSchema: {
      type: 'object',
      properties: {
        filePath: { type: 'string', description: 'Path to the Markdown file' },
      },
      required: ['filePath'],
    },
    execute: async (p, ctx) => {
      const { parseMarkdownImpl } = await import('./providers/document-formats.js');
      const result = await parseMarkdownImpl({
        filePath: p.filePath as string,
        cwd: ctx?.workingDirectory,
        allowedPaths: ctx?.allowedPaths,
      });
      const tocStr = result.toc.map(h => `${'  '.repeat(h.level - 1)}- ${h.title} (line ${h.line})`).join('\n');
      return { output: `Markdown: ${result.wordCount} words, ${result.toc.length} headings, ${result.codeBlocks.length} code blocks, ${result.links.length} links\n\nTable of Contents:\n${tocStr}\n\n${result.text.slice(0, 5000)}` };
    },
  });

  registerTool({
    name: 'detect_file_type',
    description: 'Detect the type, MIME type, and category of a file. Reports whether the file is readable as text.',
    category: 'document',
    inputSchema: {
      type: 'object',
      properties: {
        filePath: { type: 'string', description: 'Path to the file' },
      },
      required: ['filePath'],
    },
    execute: async (p, ctx) => {
      const { detectFileTypeImpl } = await import('./providers/document-formats.js');
      const result = await detectFileTypeImpl({
        filePath: p.filePath as string,
        cwd: ctx?.workingDirectory,
        allowedPaths: ctx?.allowedPaths,
      });
      return { output: `Type: ${result.extension} (${result.mimeType})\nCategory: ${result.category}\nReadable: ${result.readable}` };
    },
  });
}
