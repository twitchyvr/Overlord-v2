/**
 * Intelligent Tool Selector (#654)
 *
 * Analyzes the user message and selects only relevant tools from the room's
 * allowed set. Reduces context window usage by 1000-3000 tokens per conversation.
 *
 * Strategy:
 * - Core tools (read_file, list_dir) are ALWAYS included
 * - Task-specific tools are matched by keyword analysis
 * - Tools already used in the session are always retained
 * - Minimum 3 tools, maximum = room's full set
 *
 * Layer: Agents (depends on Core only)
 */

import { logger } from '../core/logger.js';
import type { ToolDefinition } from '../core/contracts.js';

const log = logger.child({ module: 'tool-selector' });

// ─── Tool Categories ───

/** Always included regardless of task */
const CORE_TOOLS = new Set([
  'read_file',
  'list_dir',
  'session_note',
]);

/** Tool → keywords that suggest this tool is needed */
const TOOL_KEYWORDS: Record<string, string[]> = {
  // Write tools — triggered by editing/fixing/creating
  write_file: ['write', 'create', 'add', 'new file', 'generate', 'scaffold', 'implement', 'rewrite'],
  patch_file: ['fix', 'change', 'update', 'modify', 'edit', 'replace', 'patch', 'refactor', 'rename', 'delete', 'remove line', 'remove function'],
  copy_file: ['copy', 'duplicate', 'clone', 'template'],

  // Shell — triggered by running/building/testing
  bash: ['run', 'test', 'build', 'install', 'compile', 'execute', 'npm', 'git', 'deploy', 'commit', 'push', 'branch', 'check', 'lint', 'format'],

  // Web — triggered by searching/researching
  web_search: ['search', 'find', 'look up', 'documentation', 'docs', 'api reference', 'how to', 'research'],
  fetch_webpage: ['fetch', 'download', 'webpage', 'url', 'website', 'page content'],

  // QA — triggered by testing/quality
  qa_run_tests: ['test', 'tests', 'run tests', 'unit test', 'test suite'],
  qa_check_lint: ['lint', 'linting', 'eslint', 'style check'],
  qa_check_types: ['type check', 'typecheck', 'typescript', 'tsc', 'types'],
  qa_check_coverage: ['coverage', 'test coverage'],
  qa_audit_deps: ['audit', 'dependency', 'vulnerab', 'security scan'],
  e2e_test: ['e2e', 'end-to-end', 'playwright', 'cypress', 'browser test', 'integration test'],

  // Visual — triggered by screenshot/visual
  screenshot: ['screenshot', 'visual', 'see the page', 'what does it look like', 'inspect', 'preview', 'render'],
  analyze_screenshot: ['analyze screenshot', 'describe what you see', 'visual issue', 'look at the screenshot', 'ui check'],

  // Dev tools
  dev_server: ['dev server', 'start server', 'localhost', 'port'],
  game_engine: ['game', 'unity', 'godot', 'unreal'],
  workspace_sandbox: ['sandbox', 'worktree', 'isolated'],

  // GitHub
  github: ['github', 'issue', 'pr', 'pull request', 'merge'],

  // Notes
  record_note: ['note', 'remember', 'save note'],
  recall_notes: ['recall', 'what did', 'previous note', 'notes'],
};

/** Tools that should be included together (if one is selected, include its companions) */
const TOOL_GROUPS: Record<string, string[]> = {
  write_file: ['read_file', 'list_dir', 'bash'],
  patch_file: ['read_file', 'list_dir', 'bash'],
  e2e_test: ['screenshot', 'bash'],
  screenshot: ['analyze_screenshot'],
  qa_run_tests: ['bash'],
  dev_server: ['bash', 'screenshot'],
};

// ─── Public API ───

/**
 * Select relevant tools for a task based on the user message.
 *
 * @param roomTools - All tools available in the room
 * @param userMessage - The user's message/task description
 * @param usedTools - Tools already used in this session (always retained)
 * @returns Filtered list of tools relevant to the task
 */
export function selectToolsForTask(
  roomTools: ToolDefinition[],
  userMessage: string,
  usedTools: Set<string> = new Set(),
): ToolDefinition[] {
  // Small room tool sets don't benefit from filtering
  if (roomTools.length <= 5) return roomTools;

  const roomToolNames = new Set(roomTools.map(t => t.name));
  const selected = new Set<string>();
  const messageLower = userMessage.toLowerCase();

  // 1. Always include core tools
  for (const core of CORE_TOOLS) {
    if (roomToolNames.has(core)) selected.add(core);
  }

  // 2. Always retain tools already used in session
  for (const used of usedTools) {
    if (roomToolNames.has(used)) selected.add(used);
  }

  // 3. Match task keywords to tools
  for (const [toolName, keywords] of Object.entries(TOOL_KEYWORDS)) {
    if (!roomToolNames.has(toolName)) continue;
    if (selected.has(toolName)) continue;

    for (const keyword of keywords) {
      if (messageLower.includes(keyword)) {
        selected.add(toolName);

        // Include companion tools
        const companions = TOOL_GROUPS[toolName];
        if (companions) {
          for (const c of companions) {
            if (roomToolNames.has(c)) selected.add(c);
          }
        }
        break;
      }
    }
  }

  // 4. If very few tools matched (< 3 non-core), include bash as a safe default
  //    since most tasks benefit from shell access
  if (selected.size < 4 && roomToolNames.has('bash')) {
    selected.add('bash');
  }

  // 5. Filter the room tools to only selected ones, preserving order
  const filtered = roomTools.filter(t => selected.has(t.name));

  const dropped = roomTools.length - filtered.length;
  if (dropped > 0) {
    log.info(
      {
        total: roomTools.length,
        selected: filtered.length,
        dropped,
        tools: filtered.map(t => t.name),
      },
      'Tool selection: reduced context',
    );
  }

  return filtered;
}
