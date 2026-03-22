/**
 * Tool Resource Map Tests (#941)
 *
 * Tests: resource descriptor mapping, write vs read-only classification,
 * coverage of all registered tools.
 */

import { describe, it, expect } from 'vitest';
import {
  getDefaultResourceDescriptors,
  getLockedToolNames,
  READ_ONLY_TOOLS,
} from '../../../src/tools/tool-resource-map.js';

describe('Tool Resource Map', () => {
  describe('getDefaultResourceDescriptors', () => {
    it('returns descriptors for write_file (file:param)', () => {
      const descriptors = getDefaultResourceDescriptors('write_file');
      expect(descriptors).toBeDefined();
      expect(descriptors).toHaveLength(1);
      expect(descriptors![0]).toEqual({
        type: 'file',
        mode: 'param',
        paramKey: 'path',
      });
    });

    it('returns descriptors for patch_file (file:param)', () => {
      const descriptors = getDefaultResourceDescriptors('patch_file');
      expect(descriptors).toBeDefined();
      expect(descriptors![0].type).toBe('file');
      expect(descriptors![0].mode).toBe('param');
      expect(descriptors![0].paramKey).toBe('path');
    });

    it('returns descriptors for copy_file (file:param on destination)', () => {
      const descriptors = getDefaultResourceDescriptors('copy_file');
      expect(descriptors).toBeDefined();
      expect(descriptors![0].paramKey).toBe('destination');
    });

    it('returns descriptors for git_workflow (git:static)', () => {
      const descriptors = getDefaultResourceDescriptors('git_workflow');
      expect(descriptors).toBeDefined();
      expect(descriptors![0]).toEqual({
        type: 'git',
        mode: 'static',
      });
    });

    it('returns descriptors for bash (shell:static)', () => {
      const descriptors = getDefaultResourceDescriptors('bash');
      expect(descriptors).toBeDefined();
      expect(descriptors![0].type).toBe('shell');
      expect(descriptors![0].mode).toBe('static');
    });

    it('returns descriptors for game_engine with custom TTL', () => {
      const descriptors = getDefaultResourceDescriptors('game_engine');
      expect(descriptors).toBeDefined();
      expect(descriptors![0].type).toBe('build');
      expect(descriptors![0].lockOptions?.ttl).toBe(120_000);
    });

    it('returns descriptors for github_issues (github-api, not git)', () => {
      const descriptors = getDefaultResourceDescriptors('github_issues');
      expect(descriptors).toBeDefined();
      expect(descriptors![0].type).toBe('github-api');
      expect(descriptors![0].type).not.toBe('git');
    });

    it('returns descriptors for browser_tools (browser:static)', () => {
      const descriptors = getDefaultResourceDescriptors('browser_tools');
      expect(descriptors).toBeDefined();
      expect(descriptors![0].type).toBe('browser');
    });

    it('returns descriptors for database write tools', () => {
      for (const tool of ['record_note', 'create_task', 'create_raid_entry', 'create_milestone']) {
        const descriptors = getDefaultResourceDescriptors(tool);
        expect(descriptors).toBeDefined();
        expect(descriptors![0].type).toBe('database');
        expect(descriptors![0].mode).toBe('static');
      }
    });

    it('returns descriptors for plugin management tools', () => {
      for (const tool of ['install_plugin', 'uninstall_plugin', 'configure_plugin']) {
        const descriptors = getDefaultResourceDescriptors(tool);
        expect(descriptors).toBeDefined();
        expect(descriptors![0].type).toBe('plugin');
      }
    });

    it('returns descriptors for provider management tools', () => {
      for (const tool of ['switch_provider', 'configure_fallback']) {
        const descriptors = getDefaultResourceDescriptors(tool);
        expect(descriptors).toBeDefined();
        expect(descriptors![0].type).toBe('provider');
      }
    });

    it('returns undefined for read-only tools', () => {
      for (const tool of READ_ONLY_TOOLS) {
        expect(getDefaultResourceDescriptors(tool)).toBeUndefined();
      }
    });

    it('returns undefined for unknown tools', () => {
      expect(getDefaultResourceDescriptors('nonexistent_tool_xyz')).toBeUndefined();
    });
  });

  describe('getLockedToolNames', () => {
    it('returns all write tool names', () => {
      const names = getLockedToolNames();
      expect(names).toContain('write_file');
      expect(names).toContain('bash');
      expect(names).toContain('git_workflow');
      expect(names).toContain('browser_tools');
      expect(names).toContain('game_engine');
    });

    it('does not include read-only tools', () => {
      const names = new Set(getLockedToolNames());
      for (const readTool of READ_ONLY_TOOLS) {
        expect(names.has(readTool)).toBe(false);
      }
    });

    it('returns non-empty array', () => {
      expect(getLockedToolNames().length).toBeGreaterThan(0);
    });
  });

  describe('READ_ONLY_TOOLS', () => {
    it('contains expected read-only tools', () => {
      expect(READ_ONLY_TOOLS.has('read_file')).toBe(true);
      expect(READ_ONLY_TOOLS.has('list_dir')).toBe(true);
      expect(READ_ONLY_TOOLS.has('web_search')).toBe(true);
      expect(READ_ONLY_TOOLS.has('recall_notes')).toBe(true);
      expect(READ_ONLY_TOOLS.has('qa_run_tests')).toBe(true);
      expect(READ_ONLY_TOOLS.has('code_review')).toBe(true);
    });

    it('does not contain write tools', () => {
      expect(READ_ONLY_TOOLS.has('write_file')).toBe(false);
      expect(READ_ONLY_TOOLS.has('bash')).toBe(false);
      expect(READ_ONLY_TOOLS.has('git_workflow')).toBe(false);
    });
  });
});
