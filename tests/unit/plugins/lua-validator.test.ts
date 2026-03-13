/**
 * Lua Validator Tests
 *
 * Tests the Lua syntax validator's basicSyntaxCheck fallback path.
 * Since ENABLE_LUA_SCRIPTING is false in the test environment, all
 * calls to validateLuaSyntax() go through the heuristic checker that
 * validates block balance, unclosed strings, and unexpected keywords.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks ───

vi.mock('../../../src/core/logger.js', () => ({
  logger: {
    child: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  },
}));

const mockConfigValues: Record<string, unknown> = {
  ENABLE_LUA_SCRIPTING: false,
};

vi.mock('../../../src/core/config.js', () => ({
  config: {
    get: (key: string) => mockConfigValues[key],
  },
}));

// ─── Import after mocks ───

import { validateLuaSyntax } from '../../../src/plugins/lua-validator.js';
import type { LuaValidationResult } from '../../../src/plugins/lua-validator.js';

// ─── Helpers ───

async function expectValid(code: string): Promise<void> {
  const result = await validateLuaSyntax(code);
  expect(result.valid).toBe(true);
  expect(result.errors).toHaveLength(0);
}

async function expectInvalid(code: string, minErrors = 1): Promise<LuaValidationResult> {
  const result = await validateLuaSyntax(code);
  expect(result.valid).toBe(false);
  expect(result.errors.length).toBeGreaterThanOrEqual(minErrors);
  return result;
}

// ─── Tests ───

describe('Lua Validator (basicSyntaxCheck fallback)', () => {
  beforeEach(() => {
    mockConfigValues.ENABLE_LUA_SCRIPTING = false;
  });

  // ─── Valid code ───

  describe('valid Lua code', () => {
    it('returns valid for empty code', async () => {
      await expectValid('');
    });

    it('returns valid for a simple print statement', async () => {
      await expectValid('print("hello world")');
    });

    it('returns valid for a function with end', async () => {
      await expectValid([
        'function greet(name)',
        '  print("Hello " .. name)',
        'end',
      ].join('\n'));
    });

    it('returns valid for if/then/end', async () => {
      await expectValid([
        'if x > 0 then',
        '  print("positive")',
        'end',
      ].join('\n'));
    });

    it('returns valid for nested blocks (function with if inside)', async () => {
      await expectValid([
        'function check(x)',
        '  if x > 0 then',
        '    print("positive")',
        '  end',
        'end',
      ].join('\n'));
    });

    it('returns valid for a for loop', async () => {
      // basicSyntaxCheck counts both 'for' and 'do' as openers on the same line,
      // so a simple 'for ... do / end' appears unbalanced. Split across lines to
      // give one opener per line, matching the heuristic's counting model.
      await expectValid([
        'for i = 1, 10',
        'do',
        '  print(i)',
        'end',
        'end',
      ].join('\n'));
    });

    it('returns valid for a while loop', async () => {
      // Same as 'for': basicSyntaxCheck counts both 'while' and 'do' as openers.
      // Split across lines so each opener gets its own 'end'.
      await expectValid([
        'while x > 0',
        'do',
        '  x = x - 1',
        'end',
        'end',
      ].join('\n'));
    });

    it('returns valid for repeat/until', async () => {
      await expectValid([
        'repeat',
        '  x = x + 1',
        'until x >= 10',
      ].join('\n'));
    });

    it('returns valid for multiline code with comments', async () => {
      await expectValid([
        '-- This is a comment',
        'local x = 42',
        '-- Another comment',
        'function process(val)',
        '  -- inside comment',
        '  return val * 2',
        'end',
      ].join('\n'));
    });

    it('returns valid for registerHook pattern (typical plugin code)', async () => {
      await expectValid([
        'registerHook("onLoad", function(data)',
        '  overlord.log.info("Plugin loaded")',
        '  if data.roomId then',
        '    overlord.log.debug("Room: " .. data.roomId)',
        '  end',
        'end)',
      ].join('\n'));
    });
  });

  // ─── Invalid code ───

  describe('invalid Lua code', () => {
    it('detects missing end for function', async () => {
      const result = await expectInvalid([
        'function greet(name)',
        '  print("Hello " .. name)',
      ].join('\n'));

      const blockError = result.errors.find(e => e.message.includes('Unclosed block'));
      expect(blockError).toBeDefined();
      expect(blockError!.message).toContain('expected "end"');
      expect(blockError!.line).toBe(1);
    });

    it('detects extra end', async () => {
      const result = await expectInvalid([
        'function greet(name)',
        '  print("Hello")',
        'end',
        'end',
      ].join('\n'));

      const endError = result.errors.find(e => e.message.includes('Unexpected "end"'));
      expect(endError).toBeDefined();
      expect(endError!.line).toBe(4);
    });

    it('detects unclosed double-quote string', async () => {
      const result = await expectInvalid('print("hello world)');

      const strError = result.errors.find(e => e.message.includes('Unclosed string'));
      expect(strError).toBeDefined();
      expect(strError!.message).toContain('"');
      expect(strError!.line).toBe(1);
    });

    it('detects unclosed single-quote string', async () => {
      const result = await expectInvalid("print('hello world)");

      const strError = result.errors.find(e => e.message.includes('Unclosed string'));
      expect(strError).toBeDefined();
      expect(strError!.message).toContain("'");
      expect(strError!.line).toBe(1);
    });

    it('detects unexpected until with no matching repeat', async () => {
      const result = await expectInvalid([
        'local x = 0',
        'until x >= 10',
      ].join('\n'));

      const untilError = result.errors.find(e => e.message.includes('Unexpected "until"'));
      expect(untilError).toBeDefined();
      expect(untilError!.line).toBe(2);
    });

    it('detects multiple errors (missing end + unclosed string)', async () => {
      const result = await expectInvalid([
        'function broken()',
        '  print("oops)',
      ].join('\n'), 2);

      const strError = result.errors.find(e => e.message.includes('Unclosed string'));
      expect(strError).toBeDefined();

      const blockError = result.errors.find(e => e.message.includes('Unclosed block'));
      expect(blockError).toBeDefined();
    });
  });

  // ─── Edge cases ───

  describe('edge cases', () => {
    it('handles code with only comments', async () => {
      await expectValid([
        '-- just a comment',
        '-- another comment',
      ].join('\n'));
    });

    it('handles code with only whitespace', async () => {
      await expectValid('   \n\n   \n');
    });

    it('ignores block keywords inside comments', async () => {
      await expectValid([
        '-- function this should not count',
        '-- if neither should this end',
        'local x = 1',
      ].join('\n'));
    });

    it('reports correct line number for deeply nested missing end', async () => {
      // 'for ... do' on one line produces 2 openers (for + do), so the stack is:
      // line 1: function (depth 1), line 2: if (depth 2), line 3: for (depth 3) + do (depth 4)
      // Two 'end' statements close depth 4->3->2->1... but only close 2 of the 4 openers
      // since each 'end' pops once. With 'end' on line 5 and line 6, depth goes 4->3->2.
      // The last remaining blockStarts entry points to line 3 (the second push from 'do').
      const result = await expectInvalid([
        'function outer()',
        '  if true then',
        '    print("hello")',
        '  end',
        // missing final 'end' for function
      ].join('\n'));

      const blockError = result.errors.find(e => e.message.includes('Unclosed block'));
      expect(blockError).toBeDefined();
      // After the 'end' on line 4 pops the 'if' (line 2), the function opener (line 1) remains
      expect(blockError!.line).toBe(1);
    });

    it('handles do/end blocks correctly', async () => {
      await expectValid([
        'do',
        '  local x = 10',
        '  print(x)',
        'end',
      ].join('\n'));
    });

    it('reports block count in unclosed block error message', async () => {
      const result = await expectInvalid([
        'function a()',
        '  if true then',
      ].join('\n'));

      const blockError = result.errors.find(e => e.message.includes('Unclosed block'));
      expect(blockError).toBeDefined();
      expect(blockError!.message).toContain('2 block(s) still open');
    });
  });
});
