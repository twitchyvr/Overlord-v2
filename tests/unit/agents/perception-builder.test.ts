/**
 * Perception Builder Tests
 *
 * Tests the PTA (Perception-Thinking-Action) perception builder that
 * constructs context summaries for the conversation loop.
 *
 * @see Issue #362
 */

import { describe, it, expect } from 'vitest';
import {
  buildPerception,
  extractToolResults,
} from '../../../src/agents/perception-builder.js';
import type { RoomContext, ToolResultEntry } from '../../../src/agents/perception-builder.js';

const baseRoom: RoomContext = {
  roomId: 'room_test_1',
  roomType: 'code-lab',
  allowedTools: ['bash', 'read_file', 'write_file'],
  fileScope: 'full',
  rules: ['Follow best practices', 'Write tests'],
};

describe('Perception Builder', () => {
  describe('buildPerception', () => {
    it('builds a basic perception with room context', () => {
      const result = buildPerception(baseRoom, [], 1, 20);

      expect(result).toContain('## Current Perception State');
      expect(result).toContain('code-lab');
      expect(result).toContain('room_test_1');
      expect(result).toContain('Iteration: 1 of 20');
      expect(result).toContain('full');
    });

    it('includes available tools list', () => {
      const result = buildPerception(baseRoom, [], 1, 20);

      expect(result).toContain('Available tools (3)');
      expect(result).toContain('bash');
      expect(result).toContain('read_file');
      expect(result).toContain('write_file');
    });

    it('includes tool results when provided', () => {
      const toolResults: ToolResultEntry[] = [
        { name: 'bash', success: true, summary: 'Listed 5 files' },
        { name: 'read_file', success: false, summary: 'File not found: /missing.ts' },
      ];

      const result = buildPerception(baseRoom, toolResults, 2, 20);

      expect(result).toContain('## Recent Tool Results');
      expect(result).toContain('[OK] bash: Listed 5 files');
      expect(result).toContain('[ERROR] read_file: File not found: /missing.ts');
    });

    it('adds warning when iterations are nearly exhausted', () => {
      const result = buildPerception(baseRoom, [], 18, 20);

      expect(result).toContain('WARNING');
      expect(result).toContain('2 iteration(s) remaining');
    });

    it('adds warning at exactly 3 remaining', () => {
      const result = buildPerception(baseRoom, [], 17, 20);

      expect(result).toContain('WARNING');
      expect(result).toContain('3 iteration(s) remaining');
    });

    it('does not warn when plenty of iterations remain', () => {
      const result = buildPerception(baseRoom, [], 5, 20);

      expect(result).not.toContain('WARNING');
    });

    it('includes goal when provided', () => {
      const result = buildPerception(baseRoom, [], 1, 20, 'Fix the login bug in auth module');

      expect(result).toContain('## Goal');
      expect(result).toContain('Fix the login bug in auth module');
    });

    it('truncates long tool result summaries', () => {
      const longSummary = 'x'.repeat(600);
      const toolResults: ToolResultEntry[] = [
        { name: 'bash', success: true, summary: longSummary },
      ];

      const result = buildPerception(baseRoom, toolResults, 2, 20);

      expect(result).toContain('... [truncated]');
      // The original 600-char summary should be cut to 500 + truncation marker
      expect(result).not.toContain('x'.repeat(600));
    });

    it('handles empty allowed tools list', () => {
      const emptyRoom: RoomContext = { ...baseRoom, allowedTools: [] };
      const result = buildPerception(emptyRoom, [], 1, 20);

      expect(result).not.toContain('Available tools');
    });
  });

  describe('extractToolResults', () => {
    it('extracts successful tool results', () => {
      const toolCalls = [
        { name: 'bash', input: { command: 'ls' }, result: { output: 'file1.ts\nfile2.ts' } },
      ];

      const results = extractToolResults(toolCalls);

      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('bash');
      expect(results[0].success).toBe(true);
      expect(results[0].summary).toContain('file1.ts');
    });

    it('detects error results', () => {
      const toolCalls = [
        { name: 'bash', input: { command: 'rm /' }, result: { error: 'Permission denied' } },
      ];

      const results = extractToolResults(toolCalls);

      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('bash');
      expect(results[0].success).toBe(false);
      expect(results[0].summary).toBe('Permission denied');
    });

    it('truncates long result summaries', () => {
      const longResult = { data: 'x'.repeat(400) };
      const toolCalls = [
        { name: 'read_file', input: { path: 'big.ts' }, result: longResult },
      ];

      const results = extractToolResults(toolCalls);

      expect(results).toHaveLength(1);
      expect(results[0].summary.length).toBeLessThanOrEqual(303); // 300 + '...'
    });

    it('handles multiple tool calls', () => {
      const toolCalls = [
        { name: 'bash', input: { command: 'ls' }, result: { output: 'ok' } },
        { name: 'read_file', input: { path: 'a.ts' }, result: { error: 'not found' } },
        { name: 'write_file', input: { path: 'b.ts' }, result: { written: true } },
      ];

      const results = extractToolResults(toolCalls);

      expect(results).toHaveLength(3);
      expect(results[0].success).toBe(true);
      expect(results[1].success).toBe(false);
      expect(results[2].success).toBe(true);
    });

    it('handles empty tool calls array', () => {
      const results = extractToolResults([]);
      expect(results).toHaveLength(0);
    });

    it('handles null result gracefully', () => {
      const toolCalls = [
        { name: 'bash', input: {}, result: null },
      ];

      const results = extractToolResults(toolCalls);

      expect(results).toHaveLength(1);
      expect(results[0].success).toBe(true); // null is not { error: ... }
    });
  });
});
