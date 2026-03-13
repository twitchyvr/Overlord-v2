/**
 * Command Registry Tests
 *
 * Tests registerCommand, getCommand, listCommands, parseCommandText,
 * and dispatchCommand with full coverage of edge cases.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// We must re-import from a fresh module each test suite to reset the internal
// Map/array state.  vitest.mock + resetModules handles this.
let registerCommand: typeof import('../../../src/commands/command-registry.js').registerCommand;
let getCommand: typeof import('../../../src/commands/command-registry.js').getCommand;
let listCommands: typeof import('../../../src/commands/command-registry.js').listCommands;
let parseCommandText: typeof import('../../../src/commands/command-registry.js').parseCommandText;
let dispatchCommand: typeof import('../../../src/commands/command-registry.js').dispatchCommand;

// Suppress logger output in tests
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

/** Helper: create a minimal CommandDefinition */
function makeDef(overrides: Partial<{
  name: string;
  description: string;
  usage: string;
  aliases: string[];
  handler: (ctx: unknown) => { ok: boolean; response?: string };
}> = {}) {
  return {
    name: overrides.name ?? 'test',
    description: overrides.description ?? 'A test command',
    usage: overrides.usage ?? '/test',
    handler: overrides.handler ?? (() => ({ ok: true, response: 'done' })),
    ...(overrides.aliases ? { aliases: overrides.aliases } : {}),
  };
}

/** Helper: create a minimal CommandContext */
function makeCtx(overrides: Partial<{
  command: string;
  args: string[];
  rawText: string;
  socketId: string;
  buildingId: string;
  roomId: string;
  agentId: string;
  tokens: unknown[];
  bus: { emit: ReturnType<typeof vi.fn> };
}> = {}) {
  return {
    command: overrides.command ?? 'test',
    args: overrides.args ?? [],
    rawText: overrides.rawText ?? '/test',
    socketId: overrides.socketId ?? 'sock-1',
    buildingId: overrides.buildingId,
    roomId: overrides.roomId,
    agentId: overrides.agentId,
    tokens: overrides.tokens ?? [],
    bus: overrides.bus ?? { emit: vi.fn() },
  };
}

describe('Command Registry', () => {
  beforeEach(async () => {
    // Reset the module so the internal Map/array are empty
    vi.resetModules();
    const mod = await import('../../../src/commands/command-registry.js');
    registerCommand = mod.registerCommand;
    getCommand = mod.getCommand;
    listCommands = mod.listCommands;
    parseCommandText = mod.parseCommandText;
    dispatchCommand = mod.dispatchCommand;
  });

  // ─── registerCommand ───

  describe('registerCommand', () => {
    it('registers a command by name', () => {
      registerCommand(makeDef({ name: 'status' }));
      expect(getCommand('status')).toBeDefined();
      expect(getCommand('status')!.name).toBe('status');
    });

    it('stores the command case-insensitively', () => {
      registerCommand(makeDef({ name: 'Status' }));
      expect(getCommand('status')).toBeDefined();
      expect(getCommand('STATUS')).toBeDefined();
    });

    it('registers aliases alongside the primary name', () => {
      registerCommand(makeDef({ name: 'help', aliases: ['h', '?'] }));
      expect(getCommand('help')).toBeDefined();
      expect(getCommand('h')).toBeDefined();
      expect(getCommand('?')).toBeDefined();
      // All point to the same definition
      expect(getCommand('h')).toBe(getCommand('help'));
      expect(getCommand('?')).toBe(getCommand('help'));
    });

    it('overwrites on duplicate name registration', () => {
      const first = makeDef({ name: 'dup', description: 'first' });
      const second = makeDef({ name: 'dup', description: 'second' });
      registerCommand(first);
      registerCommand(second);
      expect(getCommand('dup')!.description).toBe('second');
    });

    it('overwrites on alias collision with existing command', () => {
      registerCommand(makeDef({ name: 'alpha' }));
      registerCommand(makeDef({ name: 'beta', aliases: ['alpha'] }));
      // 'alpha' now points to the beta definition
      expect(getCommand('alpha')!.name).toBe('beta');
    });

    it('adds to definitions list even on overwrites', () => {
      registerCommand(makeDef({ name: 'one' }));
      registerCommand(makeDef({ name: 'one' }));
      // definitions array grows (both entries kept)
      expect(listCommands().length).toBe(2);
    });
  });

  // ─── getCommand ───

  describe('getCommand', () => {
    it('returns undefined for unregistered command', () => {
      expect(getCommand('nonexistent')).toBeUndefined();
    });

    it('performs case-insensitive lookup', () => {
      registerCommand(makeDef({ name: 'DEPLOY' }));
      expect(getCommand('deploy')).toBeDefined();
      expect(getCommand('Deploy')).toBeDefined();
      expect(getCommand('DEPLOY')).toBeDefined();
    });

    it('returns the full definition object', () => {
      const def = makeDef({ name: 'info', description: 'Shows info', usage: '/info [topic]' });
      registerCommand(def);
      const result = getCommand('info');
      expect(result).toBeDefined();
      expect(result!.name).toBe('info');
      expect(result!.description).toBe('Shows info');
      expect(result!.usage).toBe('/info [topic]');
    });
  });

  // ─── listCommands ───

  describe('listCommands', () => {
    it('returns empty array when nothing registered', () => {
      expect(listCommands()).toEqual([]);
    });

    it('returns all registered definitions', () => {
      registerCommand(makeDef({ name: 'a' }));
      registerCommand(makeDef({ name: 'b' }));
      registerCommand(makeDef({ name: 'c' }));
      expect(listCommands().length).toBe(3);
    });

    it('returns a copy (mutation-safe)', () => {
      registerCommand(makeDef({ name: 'x' }));
      const list = listCommands();
      list.pop();
      // Original internal array should be unaffected
      expect(listCommands().length).toBe(1);
    });

    it('does not include alias duplicates', () => {
      registerCommand(makeDef({ name: 'cmd', aliases: ['c', 'cm'] }));
      const list = listCommands();
      expect(list.length).toBe(1);
      expect(list[0].name).toBe('cmd');
    });
  });

  // ─── parseCommandText ───

  describe('parseCommandText', () => {
    it('parses a simple /command', () => {
      const result = parseCommandText('/help');
      expect(result).toEqual({ command: 'help', args: [] });
    });

    it('parses command with arguments', () => {
      const result = parseCommandText('/raid risk');
      expect(result).toEqual({ command: 'raid', args: ['risk'] });
    });

    it('parses command with multiple arguments', () => {
      const result = parseCommandText('/status --json --verbose');
      expect(result).toEqual({ command: 'status', args: ['--json', '--verbose'] });
    });

    it('returns null for text not starting with /', () => {
      expect(parseCommandText('hello world')).toBeNull();
      expect(parseCommandText('@agent')).toBeNull();
      expect(parseCommandText('#reference')).toBeNull();
    });

    it('returns null for empty string', () => {
      expect(parseCommandText('')).toBeNull();
    });

    it('returns null for just a slash', () => {
      expect(parseCommandText('/')).toBeNull();
    });

    it('returns null for slash followed by only whitespace', () => {
      expect(parseCommandText('/   ')).toBeNull();
    });

    it('trims leading and trailing whitespace', () => {
      const result = parseCommandText('  /help  ');
      expect(result).toEqual({ command: 'help', args: [] });
    });

    it('normalizes command name to lowercase', () => {
      const result = parseCommandText('/HELP');
      expect(result).toEqual({ command: 'help', args: [] });
    });

    it('collapses multiple spaces between arguments', () => {
      const result = parseCommandText('/raid   risk   high');
      expect(result).toEqual({ command: 'raid', args: ['risk', 'high'] });
    });
  });

  // ─── dispatchCommand ───

  describe('dispatchCommand', () => {
    it('dispatches to registered handler and returns result', async () => {
      registerCommand(makeDef({
        name: 'ping',
        handler: () => ({ ok: true, response: 'pong' }),
      }));

      const result = await dispatchCommand(makeCtx({ command: 'ping' }) as never);
      expect(result.ok).toBe(true);
      expect(result.response).toBe('pong');
    });

    it('returns error result for unknown command', async () => {
      const result = await dispatchCommand(makeCtx({ command: 'unknown' }) as never);
      expect(result.ok).toBe(false);
      expect(result.response).toContain('Unknown command');
      expect(result.response).toContain('/unknown');
    });

    it('passes full context to handler', async () => {
      const handler = vi.fn(() => ({ ok: true }));
      registerCommand(makeDef({ name: 'inspect', handler }));

      const ctx = makeCtx({
        command: 'inspect',
        args: ['--deep'],
        socketId: 'sock-42',
        buildingId: 'bld-1',
      });
      await dispatchCommand(ctx as never);

      expect(handler).toHaveBeenCalledOnce();
      const passedCtx = handler.mock.calls[0][0];
      expect(passedCtx).toMatchObject({
        command: 'inspect',
        args: ['--deep'],
        socketId: 'sock-42',
        buildingId: 'bld-1',
      });
    });

    it('catches handler errors and returns error result', async () => {
      registerCommand(makeDef({
        name: 'boom',
        handler: () => { throw new Error('handler exploded'); },
      }));

      const result = await dispatchCommand(makeCtx({ command: 'boom' }) as never);
      expect(result.ok).toBe(false);
      expect(result.response).toContain('handler exploded');
    });

    it('dispatches via alias', async () => {
      registerCommand(makeDef({
        name: 'help',
        aliases: ['h'],
        handler: () => ({ ok: true, response: 'Help text' }),
      }));

      const result = await dispatchCommand(makeCtx({ command: 'h' }) as never);
      expect(result.ok).toBe(true);
      expect(result.response).toBe('Help text');
    });

    it('handles async handlers', async () => {
      registerCommand(makeDef({
        name: 'slow',
        handler: async () => {
          await new Promise(r => setTimeout(r, 10));
          return { ok: true, response: 'completed' };
        },
      }));

      const result = await dispatchCommand(makeCtx({ command: 'slow' }) as never);
      expect(result.ok).toBe(true);
      expect(result.response).toBe('completed');
    });

    it('handles async handler rejection', async () => {
      registerCommand(makeDef({
        name: 'fail-async',
        handler: async () => { throw new Error('async failure'); },
      }));

      const result = await dispatchCommand(makeCtx({ command: 'fail-async' }) as never);
      expect(result.ok).toBe(false);
      expect(result.response).toContain('async failure');
    });
  });
});
