/**
 * Tool Resource Map — Static Tool-to-Resource Mapping (#941)
 *
 * Declares which resources each tool requires locks on. The tool middleware
 * uses this to transparently acquire/release locks around tool execution.
 *
 * Tools not in this map (or mapped to undefined) require no locking and
 * execute with zero middleware overhead.
 *
 * Layer: Tools (depends on Core contracts only)
 *
 * Attribution:
 *   Pattern inspired by @m13v's browser-lock PreToolUse/PostToolUse hooks.
 */

import type { ToolResourceDescriptor } from '../core/contracts.js';

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

/**
 * Tools that are explicitly read-only and require no locking.
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
 * Get all tool names that have resource descriptors (write tools).
 */
export function getLockedToolNames(): string[] {
  return Object.keys(TOOL_RESOURCE_MAP);
}
