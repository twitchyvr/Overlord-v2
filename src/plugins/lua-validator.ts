/**
 * Lua Validator
 *
 * Validates Lua code syntax by attempting to parse it in a temporary
 * wasmoon LuaEngine. Returns structured validation results with
 * line numbers and error messages.
 */

import { logger } from '../core/logger.js';
import { config } from '../core/config.js';

const log = logger.child({ module: 'lua-validator' });

export interface LuaValidationResult {
  valid: boolean;
  errors: LuaSyntaxError[];
}

export interface LuaSyntaxError {
  line: number | null;
  message: string;
}

/**
 * Validate Lua code syntax without executing it.
 *
 * Uses wasmoon's LuaEngine to attempt loading the code string.
 * If parsing fails, extracts line numbers and error messages.
 * The engine is destroyed after validation — no side effects.
 */
export async function validateLuaSyntax(code: string): Promise<LuaValidationResult> {
  const luaEnabled = config.get('ENABLE_LUA_SCRIPTING');
  if (!luaEnabled) {
    // If Lua scripting is disabled, do a basic syntax heuristic check
    return basicSyntaxCheck(code);
  }

  try {
    // Dynamic import so wasmoon is only loaded when needed
    const { LuaFactory } = await import('wasmoon');
    const factory = new LuaFactory();
    const engine = await factory.createEngine();

    try {
      // Use doString to parse + compile (but we catch errors before real execution)
      // Load the code as a chunk without executing — Lua's load() parses only
      await engine.doString(`
        local fn, err = load(${JSON.stringify(code)}, "validate", "t", {})
        if err then
          error(err)
        end
      `);
      return { valid: true, errors: [] };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const parsed = parseLuaError(message);
      return { valid: false, errors: [parsed] };
    } finally {
      engine.global.close();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.warn({ error: message }, 'Lua runtime unavailable for validation, falling back to basic check');
    return basicSyntaxCheck(code);
  }
}

/**
 * Parse a Lua error string to extract line number and message.
 * Lua errors typically follow the pattern: [string "..."]:LINE: message
 */
function parseLuaError(errorStr: string): LuaSyntaxError {
  // Pattern: [string "validate"]:LINE: message
  const match = errorStr.match(/:(\d+):\s*(.+)/);
  if (match) {
    return {
      line: parseInt(match[1], 10),
      message: match[2].trim(),
    };
  }
  return { line: null, message: errorStr };
}

/**
 * Basic syntax check for when wasmoon is unavailable.
 * Checks for common Lua syntax issues without a runtime.
 */
function basicSyntaxCheck(code: string): LuaValidationResult {
  const errors: LuaSyntaxError[] = [];
  const lines = code.split('\n');

  // Track block balance (function/if/do/for/while vs end)
  let blockDepth = 0;
  const blockStarts: number[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.replace(/--.*$/, '').trim(); // Remove single-line comments

    // Skip empty lines and pure comments
    if (!trimmed) continue;

    // Count block openers
    const openers = trimmed.match(/\b(function|if|do|for|while|repeat)\b/g);
    if (openers) {
      for (const _opener of openers) {
        // "if" only opens a block if not a single-line if..then..end
        blockDepth++;
        blockStarts.push(i + 1);
      }
    }

    // Count block closers
    const closers = trimmed.match(/\bend\b/g);
    if (closers) {
      for (const _closer of closers) {
        blockDepth--;
        blockStarts.pop();
        if (blockDepth < 0) {
          errors.push({ line: i + 1, message: 'Unexpected "end" — no matching block opener' });
          blockDepth = 0;
        }
      }
    }

    // "until" closes "repeat"
    const untils = trimmed.match(/\buntil\b/g);
    if (untils) {
      for (const _until of untils) {
        blockDepth--;
        blockStarts.pop();
        if (blockDepth < 0) {
          errors.push({ line: i + 1, message: 'Unexpected "until" — no matching "repeat"' });
          blockDepth = 0;
        }
      }
    }

    // Check for unclosed strings on a single line (basic check)
    let inString: string | null = null;
    for (let j = 0; j < trimmed.length; j++) {
      const ch = trimmed[j];
      if (inString) {
        if (ch === inString && trimmed[j - 1] !== '\\') {
          inString = null;
        }
      } else if (ch === '"' || ch === "'") {
        inString = ch;
      }
    }
    if (inString) {
      errors.push({ line: i + 1, message: `Unclosed string (started with ${inString})` });
    }
  }

  // Check for unclosed blocks at EOF
  if (blockDepth > 0) {
    const lastStart = blockStarts[blockStarts.length - 1] || 1;
    errors.push({ line: lastStart, message: `Unclosed block — expected "end" (${blockDepth} block(s) still open)` });
  }

  return { valid: errors.length === 0, errors };
}
