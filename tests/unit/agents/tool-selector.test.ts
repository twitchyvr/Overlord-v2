/**
 * Tool Selector Tests (#654)
 *
 * Verifies intelligent tool filtering based on user message analysis.
 */

import { describe, it, expect } from 'vitest';
import { selectToolsForTask } from '../../../src/agents/tool-selector.js';
import type { ToolDefinition } from '../../../src/core/contracts.js';

function makeTool(name: string): ToolDefinition {
  return {
    name,
    description: `${name} tool`,
    category: 'test',
    inputSchema: { type: 'object' },
    execute: async () => ({}),
  };
}

// Simulate a Code Lab room's full tool set
const CODE_LAB_TOOLS = [
  'read_file', 'write_file', 'copy_file', 'patch_file', 'list_dir',
  'bash', 'web_search', 'fetch_webpage', 'e2e_test', 'screenshot',
  'analyze_screenshot', 'session_note', 'game_engine', 'dev_server',
  'workspace_sandbox',
].map(makeTool);

describe('Tool Selector', () => {
  it('always includes core tools (read_file, list_dir, session_note)', () => {
    const result = selectToolsForTask(CODE_LAB_TOOLS, 'hello');
    const names = result.map(t => t.name);
    expect(names).toContain('read_file');
    expect(names).toContain('list_dir');
    expect(names).toContain('session_note');
  });

  it('selects write tools for fix/edit tasks', () => {
    const result = selectToolsForTask(CODE_LAB_TOOLS, 'Fix the timeout in ai-proxy.ts');
    const names = result.map(t => t.name);
    expect(names).toContain('patch_file');
    expect(names).toContain('bash');
    expect(names).toContain('read_file');
    // Should NOT include unrelated tools
    expect(names).not.toContain('web_search');
    expect(names).not.toContain('game_engine');
    expect(names).not.toContain('workspace_sandbox');
  });

  it('selects web tools for search tasks', () => {
    const result = selectToolsForTask(CODE_LAB_TOOLS, 'Search for weather API documentation');
    const names = result.map(t => t.name);
    expect(names).toContain('web_search');
    expect(names).not.toContain('patch_file');
    expect(names).not.toContain('write_file');
  });

  it('selects screenshot tools for visual tasks', () => {
    const result = selectToolsForTask(CODE_LAB_TOOLS, 'Take a screenshot and check what it looks like');
    const names = result.map(t => t.name);
    expect(names).toContain('screenshot');
    expect(names).toContain('analyze_screenshot');
  });

  it('selects test tools for testing tasks', () => {
    const result = selectToolsForTask(CODE_LAB_TOOLS, 'Run the e2e tests with Playwright');
    const names = result.map(t => t.name);
    expect(names).toContain('e2e_test');
    expect(names).toContain('bash');
  });

  it('retains tools already used in session', () => {
    const used = new Set(['web_search', 'dev_server']);
    const result = selectToolsForTask(CODE_LAB_TOOLS, 'Fix the bug', used);
    const names = result.map(t => t.name);
    expect(names).toContain('web_search');
    expect(names).toContain('dev_server');
    expect(names).toContain('patch_file'); // From "fix" keyword
  });

  it('returns all tools when room has 5 or fewer', () => {
    const smallSet = ['read_file', 'list_dir', 'bash', 'session_note'].map(makeTool);
    const result = selectToolsForTask(smallSet, 'hello');
    expect(result.length).toBe(smallSet.length);
  });

  it('reduces tool count for generic messages', () => {
    const result = selectToolsForTask(CODE_LAB_TOOLS, 'What files are in this project?');
    // Should get core + bash (default) but not write/web/test tools
    expect(result.length).toBeLessThan(CODE_LAB_TOOLS.length);
  });

  it('includes bash as fallback when few tools match', () => {
    const result = selectToolsForTask(CODE_LAB_TOOLS, 'Tell me about this project');
    const names = result.map(t => t.name);
    expect(names).toContain('bash');
  });

  it('selects git tools for commit/push tasks', () => {
    const result = selectToolsForTask(CODE_LAB_TOOLS, 'Commit the changes and push to origin');
    const names = result.map(t => t.name);
    expect(names).toContain('bash');
  });
});
