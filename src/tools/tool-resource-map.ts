/**
 * Tool Resource Map — Static Tool-to-Resource Mapping (#941, #942)
 *
 * Declares which resources each tool requires locks on and what concurrency
 * mode each tool operates in. The tool middleware uses this to transparently
 * acquire/release locks around tool execution.
 *
 * Concurrency modes (#942):
 *   - 'concurrent': No locking needed (read-only tools)
 *   - 'serialized': One agent at a time per resource (write tools)
 *   - 'exclusive': One agent globally, blocks all other tool execution
 *
 * Tools not in the resource map require no locking. Tools without an explicit
 * concurrency mode default to 'serialized' if they have resources, or
 * 'concurrent' if they don't.
 *
 * Layer: Tools (depends on Core contracts only)
 *
 * Attribution:
 *   Pattern inspired by @m13v's browser-lock PreToolUse/PostToolUse hooks.
 *   Concurrency model inspired by mediar-ai/terminator Send+Sync trait bounds.
 */

import type { ToolResourceDescriptor, ToolConcurrencyMode } from '../core/contracts.js';

// ── Resource Descriptors ──

/**
 * Static map from tool name to resource descriptors.
 * Only write/mutating tools are listed. Read-only tools are absent (= no locking).
 */
const TOOL_RESOURCE_MAP: Record<string, ToolResourceDescriptor[]> = {
  // ── Filesystem writes ──
  write_file: [{ type: 'file', mode: 'param', paramKey: 'path' }],
  patch_file: [{ type: 'file', mode: 'param', paramKey: 'path' }],
  copy_file: [{ type: 'file', mode: 'param', paramKey: 'destination' }],
  export_data: [{ type: 'file', mode: 'param', paramKey: 'path' }],

  // ── Git / VCS operations ──
  git_workflow: [{ type: 'git', mode: 'static' }],
  github: [{ type: 'git', mode: 'static' }],
  workspace_sandbox: [{ type: 'git', mode: 'static' }],

  // ── GitHub API (separate from local git) ──
  github_issues: [{ type: 'github-api', mode: 'static' }],

  // ── Shell execution ──
  bash: [{ type: 'shell', mode: 'static' }],

  // ── Browser automation ──
  browser_tools: [{ type: 'browser', mode: 'static' }],

  // ── Dev server / build ──
  dev_server: [{ type: 'devserver', mode: 'static' }],
  game_engine: [{ type: 'build', mode: 'static', lockOptions: { ttl: 120_000 } }],

  // ── Database writes ──
  record_note: [{ type: 'database', mode: 'static' }],
  create_task: [{ type: 'database', mode: 'static' }],
  create_raid_entry: [{ type: 'database', mode: 'static' }],
  create_milestone: [{ type: 'database', mode: 'static' }],

  // ── Plugin management ──
  install_plugin: [{ type: 'plugin', mode: 'static' }],
  uninstall_plugin: [{ type: 'plugin', mode: 'static' }],
  configure_plugin: [{ type: 'plugin', mode: 'static' }],

  // ── Provider management ──
  switch_provider: [{ type: 'provider', mode: 'static' }],
  configure_fallback: [{ type: 'provider', mode: 'static' }],
};

// ── Concurrency Mode Map (#942) ──

/**
 * Static map from tool name to concurrency mode.
 * Tools not listed here get a default based on whether they have resource descriptors:
 *   - Has resources → 'serialized'
 *   - No resources → 'concurrent'
 *
 * Only tools that deviate from the default need explicit entries.
 * 'exclusive' tools acquire a global lock that blocks ALL other tool execution.
 */
const TOOL_CONCURRENCY_MAP: Record<string, ToolConcurrencyMode> = {
  // ── Exclusive tools (global lock — one agent at a time for the entire system) ──
  browser_tools: 'exclusive',    // Single browser instance, destructive navigation
  game_engine: 'exclusive',      // Single build pipeline, long-running, writes shared artifacts
  dev_server: 'exclusive',       // Single dev server process, port conflicts

  // ── Serialized tools (per-resource locking, default for tools with resources) ──
  // These are already correctly inferred from having resource descriptors,
  // but listed explicitly for documentation completeness:
  // write_file, patch_file, copy_file, export_data → serialized per file path
  // git_workflow, github, workspace_sandbox → serialized per building (git ops)
  // github_issues → serialized per building (API rate limits)
  // bash → serialized per building (shell state)
  // record_note, create_task, etc. → serialized per building (database writes)
  // install_plugin, etc. → serialized per building (plugin state)
  // switch_provider, etc. → serialized per building (provider state)

  // ── Concurrent tools (no locking, safe for parallel access) ──
  // All tools in READ_ONLY_TOOLS are concurrent by default (no resources = concurrent).
  // No explicit entries needed.
};

/**
 * Tools that are explicitly read-only and require no locking.
 * These are always concurrent — any number of agents can call them simultaneously.
 * Listed for documentation and testing — not used at runtime.
 */
export const READ_ONLY_TOOLS = new Set([
  'read_file',
  'list_dir',
  'web_search',
  'fetch_webpage',
  'fetch_url',
  'recall_notes',
  'session_note',
  'search_library',
  'get_document',
  'list_library',
  'qa_run_tests',
  'qa_check_lint',
  'qa_check_types',
  'qa_static_analysis',
  'qa_check_coverage',
  'qa_audit_deps',
  'code_review',
  'e2e_test',
  'screenshot',
  'analyze_screenshot',
  'validate_schema',
  'transform_data',
  'compare_models',
  'test_provider',
  'test_plugin',
  'list_plugins',
  'ask_user',
  'parse_markdown',
  'read_pdf',
  'read_docx',
  'read_xlsx',
  'detect_file_type',
]);

// ── Public API ──

/**
 * Get the resource descriptors for a builtin tool.
 * Returns undefined if the tool requires no locking (read-only).
 */
export function getDefaultResourceDescriptors(toolName: string): ToolResourceDescriptor[] | undefined {
  return TOOL_RESOURCE_MAP[toolName];
}

/**
 * Get the declared concurrency mode for a tool (#942).
 * Returns the explicit mode if declared, otherwise infers from resource descriptors:
 *   - Has resources → 'serialized'
 *   - No resources → 'concurrent'
 */
export function getToolConcurrencyMode(toolName: string): ToolConcurrencyMode {
  // Explicit declaration takes precedence
  if (TOOL_CONCURRENCY_MAP[toolName]) {
    return TOOL_CONCURRENCY_MAP[toolName];
  }
  // Infer from resource descriptors
  return TOOL_RESOURCE_MAP[toolName] ? 'serialized' : 'concurrent';
}

/**
 * Get all tool names that have resource descriptors (write tools).
 */
export function getLockedToolNames(): string[] {
  return Object.keys(TOOL_RESOURCE_MAP);
}

/**
 * Get all tool names that are declared exclusive (#942).
 */
export function getExclusiveToolNames(): string[] {
  return Object.entries(TOOL_CONCURRENCY_MAP)
    .filter(([, mode]) => mode === 'exclusive')
    .map(([name]) => name);
}
