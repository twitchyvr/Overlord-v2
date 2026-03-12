/**
 * Command System — Comprehensive Unit Tests
 *
 * Tests the full command subsystem: registry, built-in commands,
 * mention handler, and reference resolver.
 *
 * All external dependencies (building-manager, phase-gate, raid-log,
 * room-manager, agent-registry) are mocked — no real SQLite or IO.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'eventemitter3';
import type {
  CommandContext,
  CommandDefinition,
  ParsedToken,
} from '../../../src/commands/contracts.js';
import type {
  RoomManagerAPI,
  AgentRegistryAPI,
  ParsedAgent,
  RoomRow,
} from '../../../src/core/contracts.js';

// ─── Mock external dependencies ──────────────────────────────────────────────

vi.mock('../../../src/rooms/building-manager.js', () => ({
  createBuilding: vi.fn().mockReturnValue({ ok: true, data: { id: 'bld_1', name: 'Test Building' } }),
  getBuilding: vi.fn().mockReturnValue({
    ok: true,
    data: {
      id: 'bld_1',
      name: 'Test Building',
      active_phase: 'discovery',
      floors: [
        { id: 'floor_1', name: 'Main Floor', type: 'collaboration' },
        { id: 'floor_2', name: 'Integration Floor', type: 'integration' },
      ],
    },
  }),
  listBuildings: vi.fn().mockReturnValue({
    ok: true,
    data: [
      { id: 'bld_1', name: 'Test Building', active_phase: 'discovery' },
    ],
  }),
}));

import { getBuilding, listBuildings } from '../../../src/rooms/building-manager.js';

vi.mock('../../../src/rooms/phase-gate.js', () => ({
  getGates: vi.fn().mockReturnValue({
    ok: true,
    data: [
      { id: 'gate_1', phase: 'discovery', status: 'open', signoff_verdict: null },
      { id: 'gate_2', phase: 'strategy', status: 'locked', signoff_verdict: null },
    ],
  }),
  canAdvance: vi.fn().mockReturnValue({
    ok: true,
    data: { canAdvance: false, reason: 'Exit document not submitted', nextPhase: 'strategy' },
  }),
}));

import { getGates, canAdvance } from '../../../src/rooms/phase-gate.js';

vi.mock('../../../src/rooms/raid-log.js', () => ({
  searchRaid: vi.fn().mockReturnValue({
    ok: true,
    data: [
      {
        id: 'raid_001',
        type: 'risk',
        phase: 'discovery',
        summary: 'Third-party API may change',
        status: 'active',
        decided_by: null,
        rationale: 'API is in beta',
      },
      {
        id: 'raid_002',
        type: 'decision',
        phase: 'discovery',
        summary: 'Use TypeScript for all modules',
        status: 'active',
        decided_by: 'lead-architect',
        rationale: 'Team consensus',
      },
      {
        id: 'raid_003',
        type: 'issue',
        phase: 'discovery',
        summary: 'CI pipeline broken for ARM builds',
        status: 'active',
        decided_by: null,
        rationale: null,
      },
    ],
  }),
}));

import { searchRaid } from '../../../src/rooms/raid-log.js';

// ─── Mock Bus ────────────────────────────────────────────────────────────────

class MockBus extends EventEmitter {
  emitted: Array<{ event: string; data: unknown }> = [];

  override emit(event: string | symbol, data?: unknown): boolean {
    this.emitted.push({ event: String(event), data });
    return super.emit(event, data);
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeMockAgent(overrides: Partial<ParsedAgent> = {}): ParsedAgent {
  return {
    id: 'agent_1',
    name: 'Coder',
    role: 'developer',
    capabilities: ['write_code', 'review'],
    room_access: ['code-lab'],
    badge: null,
    status: 'idle',
    current_room_id: null,
    current_table_id: null,
    config: {},
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeMockRoom(overrides: Partial<RoomRow> = {}): RoomRow {
  return {
    id: 'room_1',
    floor_id: 'floor_1',
    type: 'code-lab',
    name: 'Main Lab',
    allowed_tools: '["bash","read_file"]',
    file_scope: 'assigned',
    exit_template: '{}',
    escalation: '{}',
    provider: 'anthropic',
    config: '{}',
    status: 'active',
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeContext(overrides: Partial<CommandContext> = {}): CommandContext {
  return {
    command: 'help',
    args: [],
    rawText: '/help',
    socketId: 'socket_test_1',
    tokens: [],
    bus: new MockBus() as any,
    ...overrides,
  };
}

// ─── Mocked APIs ─────────────────────────────────────────────────────────────

let rooms: RoomManagerAPI;
let agents: AgentRegistryAPI;

function createMockAPIs() {
  rooms = {
    createRoom: vi.fn().mockReturnValue({ ok: true, data: { id: 'room_1', type: 'code-lab', name: 'Lab' } }),
    enterRoom: vi.fn().mockReturnValue({ ok: true, data: { roomId: 'room_1', agentId: 'agent_1', tools: [] } }),
    exitRoom: vi.fn().mockReturnValue({ ok: true, data: { roomId: 'room_1', agentId: 'agent_1' } }),
    getRoom: vi.fn().mockReturnValue(null),
    listRooms: vi.fn().mockReturnValue([
      makeMockRoom({ id: 'room_1', name: 'Main Lab', type: 'code-lab', status: 'active' }),
      makeMockRoom({ id: 'room_2', name: 'Review Room', type: 'review', status: 'active' }),
    ]),
    registerRoomType: vi.fn(),
  };

  agents = {
    registerAgent: vi.fn().mockReturnValue({ ok: true, data: { id: 'agent_1', name: 'Coder' } }),
    removeAgent: vi.fn().mockReturnValue({ ok: true }),
    getAgent: vi.fn().mockImplementation((id: string) => {
      const agentMap: Record<string, ParsedAgent> = {
        agent_1: makeMockAgent({ id: 'agent_1', name: 'Coder', role: 'developer', status: 'idle' }),
        agent_2: makeMockAgent({ id: 'agent_2', name: 'Architect', role: 'architect', status: 'busy', current_room_id: 'room_1' }),
        agent_3: makeMockAgent({ id: 'agent_3', name: 'Reviewer', role: 'reviewer', status: 'idle' }),
      };
      return agentMap[id] || null;
    }),
    listAgents: vi.fn().mockReturnValue([
      makeMockAgent({ id: 'agent_1', name: 'Coder', role: 'developer', status: 'idle' }),
      makeMockAgent({ id: 'agent_2', name: 'Architect', role: 'architect', status: 'busy', current_room_id: 'room_1' }),
      makeMockAgent({ id: 'agent_3', name: 'Reviewer', role: 'reviewer', status: 'idle' }),
    ]),
    updateAgent: vi.fn().mockReturnValue({ ok: true }),
  };
}

// ─── TESTS ───────────────────────────────────────────────────────────────────

// Import the registry functions fresh for each describe block.
// Because the registry uses module-level state (Map + array), we must
// handle tests carefully to avoid cross-test contamination.

describe('Command System', () => {
  // ═══════════════════════════════════════════════════════════════════════════
  // Command Registry
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Command Registry', () => {
    // We import these at the top level since mocks are already set up.
    // The registry is module-level state, so registrations accumulate.
    let registerCommand: typeof import('../../../src/commands/command-registry.js').registerCommand;
    let getCommand: typeof import('../../../src/commands/command-registry.js').getCommand;
    let listCommands: typeof import('../../../src/commands/command-registry.js').listCommands;
    let parseCommandText: typeof import('../../../src/commands/command-registry.js').parseCommandText;
    let dispatchCommand: typeof import('../../../src/commands/command-registry.js').dispatchCommand;

    beforeEach(async () => {
      // Re-import registry to get a fresh module with cleared state
      vi.resetModules();
      const registry = await import('../../../src/commands/command-registry.js');
      registerCommand = registry.registerCommand;
      getCommand = registry.getCommand;
      listCommands = registry.listCommands;
      parseCommandText = registry.parseCommandText;
      dispatchCommand = registry.dispatchCommand;
    });

    describe('registerCommand', () => {
      it('registers a command definition by name', () => {
        const def: CommandDefinition = {
          name: 'test',
          description: 'A test command',
          usage: '/test',
          handler: () => ({ ok: true, response: 'done' }),
        };

        registerCommand(def);
        const result = getCommand('test');
        expect(result).toBeDefined();
        expect(result!.name).toBe('test');
        expect(result!.description).toBe('A test command');
      });

      it('registers aliases alongside the primary name', () => {
        const def: CommandDefinition = {
          name: 'status',
          description: 'Show status',
          usage: '/status',
          aliases: ['s', 'info'],
          handler: () => ({ ok: true }),
        };

        registerCommand(def);

        expect(getCommand('s')).toBeDefined();
        expect(getCommand('info')).toBeDefined();
        expect(getCommand('s')!.name).toBe('status');
        expect(getCommand('info')!.name).toBe('status');
      });

      it('lowercases the command name during registration', () => {
        const def: CommandDefinition = {
          name: 'MyCommand',
          description: 'Test',
          usage: '/mycommand',
          handler: () => ({ ok: true }),
        };

        registerCommand(def);
        expect(getCommand('mycommand')).toBeDefined();
      });

      it('overwrites an existing command with the same name', () => {
        const def1: CommandDefinition = {
          name: 'dup',
          description: 'First version',
          usage: '/dup',
          handler: () => ({ ok: true, response: 'first' }),
        };
        const def2: CommandDefinition = {
          name: 'dup',
          description: 'Second version',
          usage: '/dup',
          handler: () => ({ ok: true, response: 'second' }),
        };

        registerCommand(def1);
        registerCommand(def2);

        const result = getCommand('dup');
        expect(result!.description).toBe('Second version');
      });

      it('handles command with no aliases', () => {
        const def: CommandDefinition = {
          name: 'bare',
          description: 'No aliases',
          usage: '/bare',
          handler: () => ({ ok: true }),
        };

        registerCommand(def);
        expect(getCommand('bare')).toBeDefined();
      });
    });

    describe('getCommand', () => {
      it('finds a command by its primary name', () => {
        registerCommand({
          name: 'help',
          description: 'Show help',
          usage: '/help',
          handler: () => ({ ok: true }),
        });

        const cmd = getCommand('help');
        expect(cmd).toBeDefined();
        expect(cmd!.name).toBe('help');
      });

      it('finds a command by its alias', () => {
        registerCommand({
          name: 'help',
          description: 'Show help',
          usage: '/help',
          aliases: ['h', '?'],
          handler: () => ({ ok: true }),
        });

        const cmd = getCommand('h');
        expect(cmd).toBeDefined();
        expect(cmd!.name).toBe('help');
      });

      it('returns undefined for an unknown command name', () => {
        const cmd = getCommand('nonexistent');
        expect(cmd).toBeUndefined();
      });

      it('performs case-insensitive lookup', () => {
        registerCommand({
          name: 'deploy',
          description: 'Deploy',
          usage: '/deploy',
          handler: () => ({ ok: true }),
        });

        expect(getCommand('Deploy')).toBeDefined();
        expect(getCommand('DEPLOY')).toBeDefined();
      });
    });

    describe('listCommands', () => {
      it('returns all registered command definitions', () => {
        registerCommand({
          name: 'alpha',
          description: 'Alpha cmd',
          usage: '/alpha',
          handler: () => ({ ok: true }),
        });
        registerCommand({
          name: 'beta',
          description: 'Beta cmd',
          usage: '/beta',
          handler: () => ({ ok: true }),
        });

        const all = listCommands();
        expect(all.length).toBe(2);
        expect(all.map(c => c.name)).toContain('alpha');
        expect(all.map(c => c.name)).toContain('beta');
      });

      it('returns an empty array when no commands are registered', () => {
        const all = listCommands();
        expect(all).toEqual([]);
      });

      it('returns a copy, not the internal array', () => {
        registerCommand({
          name: 'original',
          description: 'Original',
          usage: '/original',
          handler: () => ({ ok: true }),
        });

        const list1 = listCommands();
        list1.push({ name: 'injected', description: 'x', usage: '/x', handler: () => ({ ok: true }) });

        const list2 = listCommands();
        expect(list2.length).toBe(1); // Should not include the injected command
      });

      it('does not include alias duplicates in the canonical list', () => {
        registerCommand({
          name: 'help',
          description: 'Help',
          usage: '/help',
          aliases: ['h', '?'],
          handler: () => ({ ok: true }),
        });

        const all = listCommands();
        // Should be 1 canonical entry, not 3
        expect(all.length).toBe(1);
        expect(all[0].name).toBe('help');
      });
    });

    describe('parseCommandText', () => {
      it('parses /help into command "help" with no args', () => {
        const result = parseCommandText('/help');
        expect(result).toEqual({ command: 'help', args: [] });
      });

      it('parses /status buildingId into command with one arg', () => {
        const result = parseCommandText('/status bld_1');
        expect(result).toEqual({ command: 'status', args: ['bld_1'] });
      });

      it('parses /raid risk into command with one arg', () => {
        const result = parseCommandText('/raid risk');
        expect(result).toEqual({ command: 'raid', args: ['risk'] });
      });

      it('parses multiple arguments correctly', () => {
        const result = parseCommandText('/deploy bld_1 --force --dry-run');
        expect(result).toEqual({ command: 'deploy', args: ['bld_1', '--force', '--dry-run'] });
      });

      it('returns null for text that does not start with /', () => {
        expect(parseCommandText('hello world')).toBeNull();
        expect(parseCommandText('help')).toBeNull();
        expect(parseCommandText('@mention something')).toBeNull();
        expect(parseCommandText('#reference')).toBeNull();
      });

      it('returns null for just a slash with no command name', () => {
        expect(parseCommandText('/')).toBeNull();
        expect(parseCommandText('/   ')).toBeNull();
      });

      it('lowercases the command name', () => {
        const result = parseCommandText('/HELP');
        expect(result).toEqual({ command: 'help', args: [] });
      });

      it('trims leading and trailing whitespace', () => {
        const result = parseCommandText('  /status bld_1  ');
        expect(result).toEqual({ command: 'status', args: ['bld_1'] });
      });

      it('collapses multiple spaces between arguments', () => {
        const result = parseCommandText('/raid   risk   bld_1');
        expect(result).toEqual({ command: 'raid', args: ['risk', 'bld_1'] });
      });
    });

    describe('dispatchCommand', () => {
      it('finds the handler by command name and calls it', async () => {
        const handler = vi.fn().mockReturnValue({ ok: true, response: 'handled' });
        registerCommand({
          name: 'ping',
          description: 'Ping',
          usage: '/ping',
          handler,
        });

        const ctx = makeContext({ command: 'ping', args: [], rawText: '/ping' });
        const result = await dispatchCommand(ctx);

        expect(handler).toHaveBeenCalledWith(ctx);
        expect(result).toEqual({ ok: true, response: 'handled' });
      });

      it('returns error result for unknown command', async () => {
        const ctx = makeContext({ command: 'unknown_cmd', rawText: '/unknown_cmd' });
        const result = await dispatchCommand(ctx);

        expect(result.ok).toBe(false);
        expect(result.response).toContain('Unknown command');
        expect(result.response).toContain('/unknown_cmd');
      });

      it('catches handler errors and returns error result', async () => {
        const handler = vi.fn().mockImplementation(() => {
          throw new Error('Handler exploded');
        });
        registerCommand({
          name: 'boom',
          description: 'Blows up',
          usage: '/boom',
          handler,
        });

        const ctx = makeContext({ command: 'boom', rawText: '/boom' });
        const result = await dispatchCommand(ctx);

        expect(result.ok).toBe(false);
        expect(result.response).toContain('Handler exploded');
      });

      it('handles async handlers correctly', async () => {
        const handler = vi.fn().mockResolvedValue({ ok: true, response: 'async result' });
        registerCommand({
          name: 'async-cmd',
          description: 'Async command',
          usage: '/async-cmd',
          handler,
        });

        const ctx = makeContext({ command: 'async-cmd', rawText: '/async-cmd' });
        const result = await dispatchCommand(ctx);

        expect(result).toEqual({ ok: true, response: 'async result' });
      });

      it('dispatches by alias as well as primary name', async () => {
        const handler = vi.fn().mockReturnValue({ ok: true, response: 'aliased' });
        registerCommand({
          name: 'status',
          description: 'Status',
          usage: '/status',
          aliases: ['s'],
          handler,
        });

        const ctx = makeContext({ command: 's', rawText: '/s' });
        const result = await dispatchCommand(ctx);

        expect(handler).toHaveBeenCalled();
        expect(result.ok).toBe(true);
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Built-in Commands
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Built-in Commands', () => {
    let registerBuiltinCommands: typeof import('../../../src/commands/builtin-commands.js').registerBuiltinCommands;
    let getCommand: typeof import('../../../src/commands/command-registry.js').getCommand;

    beforeEach(async () => {
      vi.resetModules();
      createMockAPIs();

      // Re-import to get fresh module state
      const builtins = await import('../../../src/commands/builtin-commands.js');
      const registry = await import('../../../src/commands/command-registry.js');

      registerBuiltinCommands = builtins.registerBuiltinCommands;
      getCommand = registry.getCommand;

      // Reset all mocks to default state
      vi.mocked(getBuilding).mockReturnValue({
        ok: true,
        data: {
          id: 'bld_1',
          name: 'Test Building',
          active_phase: 'discovery',
          floors: [
            { id: 'floor_1', name: 'Main Floor', type: 'collaboration' },
            { id: 'floor_2', name: 'Integration Floor', type: 'integration' },
          ],
        },
      });
      vi.mocked(listBuildings).mockReturnValue({
        ok: true,
        data: [
          { id: 'bld_1', name: 'Test Building', active_phase: 'discovery' },
        ],
      });
      vi.mocked(getGates).mockReturnValue({
        ok: true,
        data: [
          { id: 'gate_1', phase: 'discovery', status: 'open', signoff_verdict: null },
          { id: 'gate_2', phase: 'strategy', status: 'locked', signoff_verdict: null },
        ],
      });
      vi.mocked(canAdvance).mockReturnValue({
        ok: true,
        data: { canAdvance: false, reason: 'Exit document not submitted', nextPhase: 'strategy' },
      });
      vi.mocked(searchRaid).mockReturnValue({
        ok: true,
        data: [
          {
            id: 'raid_001', type: 'risk', phase: 'discovery',
            summary: 'Third-party API may change', status: 'active',
            decided_by: null, rationale: 'API is in beta',
          },
          {
            id: 'raid_002', type: 'decision', phase: 'discovery',
            summary: 'Use TypeScript for all modules', status: 'active',
            decided_by: 'lead-architect', rationale: 'Team consensus',
          },
          {
            id: 'raid_003', type: 'issue', phase: 'discovery',
            summary: 'CI pipeline broken for ARM builds', status: 'active',
            decided_by: null, rationale: null,
          },
        ],
      });

      // Register all built-in commands
      registerBuiltinCommands(rooms, agents);
    });

    describe('/help', () => {
      it('returns a list of all registered commands', () => {
        const cmd = getCommand('help')!;
        const ctx = makeContext({ command: 'help', args: [], rawText: '/help' });
        const result = cmd.handler(ctx) as import('../../../src/commands/contracts.js').CommandResult;

        expect(result.ok).toBe(true);
        expect(result.response).toContain('Available Commands');
        // Should list all 8 built-in commands
        expect(result.response).toContain('/help');
        expect(result.response).toContain('/status');
        expect(result.response).toContain('/phase');
        expect(result.response).toContain('/agents');
        expect(result.response).toContain('/rooms');
        expect(result.response).toContain('/raid');
        expect(result.response).toContain('/deploy');
        expect(result.response).toContain('/review');
      });

      it('returns help for a specific command when given a topic', () => {
        const cmd = getCommand('help')!;
        const ctx = makeContext({ command: 'help', args: ['status'], rawText: '/help status' });
        const result = cmd.handler(ctx) as import('../../../src/commands/contracts.js').CommandResult;

        expect(result.ok).toBe(true);
        expect(result.response).toContain('/status');
        expect(result.response).toContain('Show building status');
        expect(result.response).toContain('Usage');
      });

      it('shows aliases in specific command help', () => {
        const cmd = getCommand('help')!;
        const ctx = makeContext({ command: 'help', args: ['help'], rawText: '/help help' });
        const result = cmd.handler(ctx) as import('../../../src/commands/contracts.js').CommandResult;

        expect(result.ok).toBe(true);
        expect(result.response).toContain('/h');
        expect(result.response).toContain('/?');
      });

      it('shows scope in specific command help', () => {
        const cmd = getCommand('help')!;
        const ctx = makeContext({ command: 'help', args: ['phase'], rawText: '/help phase' });
        const result = cmd.handler(ctx) as import('../../../src/commands/contracts.js').CommandResult;

        expect(result.ok).toBe(true);
        expect(result.response).toContain('Scope: building');
      });

      it('returns error for unknown topic', () => {
        const cmd = getCommand('help')!;
        const ctx = makeContext({ command: 'help', args: ['nonexistent'], rawText: '/help nonexistent' });
        const result = cmd.handler(ctx) as import('../../../src/commands/contracts.js').CommandResult;

        expect(result.ok).toBe(false);
        expect(result.response).toContain('Unknown command: nonexistent');
      });

      it('is accessible via /h alias', () => {
        const cmd = getCommand('h');
        expect(cmd).toBeDefined();
        expect(cmd!.name).toBe('help');
      });

      it('is accessible via /? alias', () => {
        const cmd = getCommand('?');
        expect(cmd).toBeDefined();
        expect(cmd!.name).toBe('help');
      });
    });

    describe('/status', () => {
      it('returns building status with phase, floor count, room count, and agent count', () => {
        const cmd = getCommand('status')!;
        const ctx = makeContext({
          command: 'status',
          args: ['bld_1'],
          rawText: '/status bld_1',
          buildingId: 'bld_1',
        });
        const result = cmd.handler(ctx) as import('../../../src/commands/contracts.js').CommandResult;

        expect(result.ok).toBe(true);
        expect(result.response).toContain('Building: Test Building');
        expect(result.response).toContain('Active Phase: discovery');
        expect(result.response).toContain('Floors: 2');
        expect(result.response).toContain('Rooms:');
        expect(result.response).toContain('Agents:');
        expect(result.data).toBeDefined();
      });

      it('lists all buildings when no buildingId is provided', () => {
        const cmd = getCommand('status')!;
        const ctx = makeContext({
          command: 'status',
          args: [],
          rawText: '/status',
        });
        const result = cmd.handler(ctx) as import('../../../src/commands/contracts.js').CommandResult;

        expect(result.ok).toBe(true);
        expect(result.response).toContain('Buildings (1)');
        expect(result.response).toContain('Test Building');
      });

      it('shows "no buildings" message when none exist', () => {
        vi.mocked(listBuildings).mockReturnValue({ ok: true, data: [] });

        const cmd = getCommand('status')!;
        const ctx = makeContext({ command: 'status', args: [], rawText: '/status' });
        const result = cmd.handler(ctx) as import('../../../src/commands/contracts.js').CommandResult;

        expect(result.ok).toBe(true);
        expect(result.response).toContain('No buildings exist yet');
      });

      it('returns error when building not found', () => {
        vi.mocked(getBuilding).mockReturnValue({ ok: false, error: { code: 'NOT_FOUND', message: 'nope', retryable: false } });

        const cmd = getCommand('status')!;
        const ctx = makeContext({
          command: 'status',
          args: ['bld_nonexistent'],
          rawText: '/status bld_nonexistent',
        });
        const result = cmd.handler(ctx) as import('../../../src/commands/contracts.js').CommandResult;

        expect(result.ok).toBe(false);
        expect(result.response).toContain('Building not found');
      });

      it('uses ctx.buildingId when no arg is provided but context has buildingId', () => {
        const cmd = getCommand('status')!;
        const ctx = makeContext({
          command: 'status',
          args: [],
          rawText: '/status',
          buildingId: 'bld_1',
        });
        const result = cmd.handler(ctx) as import('../../../src/commands/contracts.js').CommandResult;

        expect(result.ok).toBe(true);
        expect(result.response).toContain('Building: Test Building');
        expect(getBuilding).toHaveBeenCalledWith('bld_1');
      });

      it('is accessible via /s alias', () => {
        const cmd = getCommand('s');
        expect(cmd).toBeDefined();
        expect(cmd!.name).toBe('status');
      });

      it('is accessible via /info alias', () => {
        const cmd = getCommand('info');
        expect(cmd).toBeDefined();
        expect(cmd!.name).toBe('status');
      });
    });

    describe('/phase', () => {
      it('returns phase info with gates and advance status', () => {
        const cmd = getCommand('phase')!;
        const ctx = makeContext({
          command: 'phase',
          args: ['bld_1'],
          rawText: '/phase bld_1',
        });
        const result = cmd.handler(ctx) as import('../../../src/commands/contracts.js').CommandResult;

        expect(result.ok).toBe(true);
        expect(result.response).toContain('Phase Status: Test Building');
        expect(result.response).toContain('Current Phase: **discovery**');
        expect(result.response).toContain('Gates:');
        expect(result.response).toContain('discovery: **open**');
        expect(result.response).toContain('strategy: **locked**');
        expect(result.response).toContain('Cannot advance: Exit document not submitted');
        expect(result.data).toEqual(expect.objectContaining({
          phase: 'discovery',
        }));
      });

      it('returns error when no buildingId is provided and no context buildingId', () => {
        const cmd = getCommand('phase')!;
        const ctx = makeContext({ command: 'phase', args: [], rawText: '/phase' });
        const result = cmd.handler(ctx) as import('../../../src/commands/contracts.js').CommandResult;

        expect(result.ok).toBe(false);
        expect(result.response).toContain('No building specified');
      });

      it('uses ctx.buildingId as fallback', () => {
        const cmd = getCommand('phase')!;
        const ctx = makeContext({
          command: 'phase',
          args: [],
          rawText: '/phase',
          buildingId: 'bld_1',
        });
        const result = cmd.handler(ctx) as import('../../../src/commands/contracts.js').CommandResult;

        expect(result.ok).toBe(true);
        expect(result.response).toContain('Test Building');
      });

      it('shows advance status when phase can advance', () => {
        vi.mocked(canAdvance).mockReturnValue({
          ok: true,
          data: { canAdvance: true, nextPhase: 'strategy' },
        });

        const cmd = getCommand('phase')!;
        const ctx = makeContext({ command: 'phase', args: ['bld_1'], rawText: '/phase bld_1' });
        const result = cmd.handler(ctx) as import('../../../src/commands/contracts.js').CommandResult;

        expect(result.ok).toBe(true);
        expect(result.response).toContain('Can advance to: **strategy**');
      });

      it('shows "No gates created yet" when gates list is empty', () => {
        vi.mocked(getGates).mockReturnValue({ ok: true, data: [] });

        const cmd = getCommand('phase')!;
        const ctx = makeContext({ command: 'phase', args: ['bld_1'], rawText: '/phase bld_1' });
        const result = cmd.handler(ctx) as import('../../../src/commands/contracts.js').CommandResult;

        expect(result.ok).toBe(true);
        expect(result.response).toContain('No gates created yet');
      });

      it('is accessible via /p and /gate aliases', () => {
        expect(getCommand('p')!.name).toBe('phase');
        expect(getCommand('gate')!.name).toBe('phase');
      });
    });

    describe('/agents', () => {
      it('returns a formatted list of all agents', () => {
        const cmd = getCommand('agents')!;
        const ctx = makeContext({ command: 'agents', args: [], rawText: '/agents' });
        const result = cmd.handler(ctx) as import('../../../src/commands/contracts.js').CommandResult;

        expect(result.ok).toBe(true);
        expect(result.response).toContain('Agents (3)');
        expect(result.response).toContain('Coder');
        expect(result.response).toContain('developer');
        expect(result.response).toContain('Architect');
        expect(result.response).toContain('Reviewer');
        expect(result.data).toHaveLength(3);
      });

      it('shows room assignment for agents in rooms', () => {
        const cmd = getCommand('agents')!;
        const ctx = makeContext({ command: 'agents', args: [], rawText: '/agents' });
        const result = cmd.handler(ctx) as import('../../../src/commands/contracts.js').CommandResult;

        // Architect has current_room_id = 'room_1'
        expect(result.response).toContain('Room: room_1');
      });

      it('shows (idle) for agents without room assignment', () => {
        const cmd = getCommand('agents')!;
        const ctx = makeContext({ command: 'agents', args: [], rawText: '/agents' });
        const result = cmd.handler(ctx) as import('../../../src/commands/contracts.js').CommandResult;

        // Coder has no current_room_id (null)
        expect(result.response).toContain('(idle)');
      });

      it('returns "no agents" message when none are registered', () => {
        (agents.listAgents as ReturnType<typeof vi.fn>).mockReturnValue([]);

        const cmd = getCommand('agents')!;
        const ctx = makeContext({ command: 'agents', args: [], rawText: '/agents' });
        const result = cmd.handler(ctx) as import('../../../src/commands/contracts.js').CommandResult;

        expect(result.ok).toBe(true);
        expect(result.response).toContain('No agents registered');
      });

      it('is accessible via /a and /team aliases', () => {
        expect(getCommand('a')!.name).toBe('agents');
        expect(getCommand('team')!.name).toBe('agents');
      });
    });

    describe('/rooms', () => {
      it('returns a formatted list of all rooms', () => {
        const cmd = getCommand('rooms')!;
        const ctx = makeContext({ command: 'rooms', args: [], rawText: '/rooms' });
        const result = cmd.handler(ctx) as import('../../../src/commands/contracts.js').CommandResult;

        expect(result.ok).toBe(true);
        expect(result.response).toContain('Rooms (2)');
        expect(result.response).toContain('Main Lab');
        expect(result.response).toContain('code-lab');
        expect(result.response).toContain('Review Room');
        expect(result.response).toContain('review');
        expect(result.data).toHaveLength(2);
      });

      it('returns "no rooms" message when none exist', () => {
        (rooms.listRooms as ReturnType<typeof vi.fn>).mockReturnValue([]);

        const cmd = getCommand('rooms')!;
        const ctx = makeContext({ command: 'rooms', args: [], rawText: '/rooms' });
        const result = cmd.handler(ctx) as import('../../../src/commands/contracts.js').CommandResult;

        expect(result.ok).toBe(true);
        expect(result.response).toContain('No rooms created yet');
      });

      it('shows room type and status for each room', () => {
        const cmd = getCommand('rooms')!;
        const ctx = makeContext({ command: 'rooms', args: [], rawText: '/rooms' });
        const result = cmd.handler(ctx) as import('../../../src/commands/contracts.js').CommandResult;

        expect(result.response).toContain('active');
      });

      it('is accessible via /r alias', () => {
        expect(getCommand('r')!.name).toBe('rooms');
      });
    });

    describe('/raid', () => {
      it('returns all RAID entries when no type filter is given', () => {
        const cmd = getCommand('raid')!;
        const ctx = makeContext({
          command: 'raid',
          args: [],
          rawText: '/raid',
          buildingId: 'bld_1',
        });
        const result = cmd.handler(ctx) as import('../../../src/commands/contracts.js').CommandResult;

        expect(result.ok).toBe(true);
        expect(result.response).toContain('RAID Log (3 entries)');
        expect(result.response).toContain('Third-party API may change');
        expect(result.response).toContain('Use TypeScript for all modules');
        expect(result.response).toContain('CI pipeline broken');
      });

      it('filters RAID entries by type (risk)', () => {
        vi.mocked(searchRaid).mockReturnValue({
          ok: true,
          data: [
            {
              id: 'raid_001', type: 'risk', phase: 'discovery',
              summary: 'Third-party API may change', status: 'active',
              decided_by: null, rationale: 'API is in beta',
            },
          ],
        });

        const cmd = getCommand('raid')!;
        const ctx = makeContext({
          command: 'raid',
          args: ['risk'],
          rawText: '/raid risk',
          buildingId: 'bld_1',
        });
        const result = cmd.handler(ctx) as import('../../../src/commands/contracts.js').CommandResult;

        expect(result.ok).toBe(true);
        expect(result.response).toContain('RISK');
        expect(searchRaid).toHaveBeenCalledWith(expect.objectContaining({ type: 'risk' }));
      });

      it('returns error for invalid RAID type', () => {
        const cmd = getCommand('raid')!;
        const ctx = makeContext({
          command: 'raid',
          args: ['invalid_type'],
          rawText: '/raid invalid_type',
          buildingId: 'bld_1',
        });
        const result = cmd.handler(ctx) as import('../../../src/commands/contracts.js').CommandResult;

        expect(result.ok).toBe(false);
        expect(result.response).toContain('Invalid RAID type');
        expect(result.response).toContain('risk, assumption, issue, decision');
      });

      it('returns error when no buildingId is available', () => {
        const cmd = getCommand('raid')!;
        const ctx = makeContext({
          command: 'raid',
          args: [],
          rawText: '/raid',
        });
        const result = cmd.handler(ctx) as import('../../../src/commands/contracts.js').CommandResult;

        expect(result.ok).toBe(false);
        expect(result.response).toContain('No building specified');
      });

      it('shows "no entries found" when RAID log is empty', () => {
        vi.mocked(searchRaid).mockReturnValue({ ok: true, data: [] });

        const cmd = getCommand('raid')!;
        const ctx = makeContext({
          command: 'raid',
          args: [],
          rawText: '/raid',
          buildingId: 'bld_1',
        });
        const result = cmd.handler(ctx) as import('../../../src/commands/contracts.js').CommandResult;

        expect(result.ok).toBe(true);
        expect(result.response).toContain('No RAID entries found');
      });

      it('shows type-specific "no entries" message when filtering', () => {
        vi.mocked(searchRaid).mockReturnValue({ ok: true, data: [] });

        const cmd = getCommand('raid')!;
        const ctx = makeContext({
          command: 'raid',
          args: ['assumption'],
          rawText: '/raid assumption',
          buildingId: 'bld_1',
        });
        const result = cmd.handler(ctx) as import('../../../src/commands/contracts.js').CommandResult;

        expect(result.ok).toBe(true);
        expect(result.response).toContain('No RAID entries found of type "assumption"');
      });

      it('includes entry IDs in the output', () => {
        const cmd = getCommand('raid')!;
        const ctx = makeContext({
          command: 'raid',
          args: [],
          rawText: '/raid',
          buildingId: 'bld_1',
        });
        const result = cmd.handler(ctx) as import('../../../src/commands/contracts.js').CommandResult;

        expect(result.response).toContain('raid_001');
        expect(result.response).toContain('raid_002');
      });

      it('is accessible via /log alias', () => {
        expect(getCommand('log')!.name).toBe('raid');
      });
    });

    describe('/deploy', () => {
      it('emits deploy:check bus event with buildingId and socketId', () => {
        const bus = new MockBus();
        const cmd = getCommand('deploy')!;
        const ctx = makeContext({
          command: 'deploy',
          args: ['bld_1'],
          rawText: '/deploy bld_1',
          bus: bus as any,
        });
        const result = cmd.handler(ctx) as import('../../../src/commands/contracts.js').CommandResult;

        expect(result.ok).toBe(true);
        expect(result.response).toContain('Deployment check triggered');
        expect(result.response).toContain('bld_1');
        expect(result.data).toEqual(expect.objectContaining({ buildingId: 'bld_1', triggered: true }));

        const deployEvent = bus.emitted.find(e => e.event === 'deploy:check');
        expect(deployEvent).toBeDefined();
        expect(deployEvent!.data).toEqual(expect.objectContaining({
          buildingId: 'bld_1',
          requestedBy: 'socket_test_1',
        }));
      });

      it('returns error when no buildingId is provided', () => {
        const cmd = getCommand('deploy')!;
        const ctx = makeContext({
          command: 'deploy',
          args: [],
          rawText: '/deploy',
        });
        const result = cmd.handler(ctx) as import('../../../src/commands/contracts.js').CommandResult;

        expect(result.ok).toBe(false);
        expect(result.response).toContain('No building specified');
      });

      it('uses ctx.buildingId as fallback', () => {
        const bus = new MockBus();
        const cmd = getCommand('deploy')!;
        const ctx = makeContext({
          command: 'deploy',
          args: [],
          rawText: '/deploy',
          buildingId: 'bld_1',
          bus: bus as any,
        });
        const result = cmd.handler(ctx) as import('../../../src/commands/contracts.js').CommandResult;

        expect(result.ok).toBe(true);
        const deployEvent = bus.emitted.find(e => e.event === 'deploy:check');
        expect(deployEvent).toBeDefined();
      });
    });

    describe('/review', () => {
      it('returns review status with gate info, active issues count, and advance status', () => {
        const cmd = getCommand('review')!;
        const ctx = makeContext({
          command: 'review',
          args: ['bld_1'],
          rawText: '/review bld_1',
        });
        const result = cmd.handler(ctx) as import('../../../src/commands/contracts.js').CommandResult;

        expect(result.ok).toBe(true);
        expect(result.response).toContain('Review Status: Test Building');
        expect(result.response).toContain('Phase: **discovery**');
        expect(result.response).toContain('Gate Status: **open**');
        expect(result.response).toContain('Active Issues:');
        expect(result.response).toContain('Ready to Advance: No');
        expect(result.data).toBeDefined();
      });

      it('returns error when no buildingId is provided', () => {
        const cmd = getCommand('review')!;
        const ctx = makeContext({ command: 'review', args: [], rawText: '/review' });
        const result = cmd.handler(ctx) as import('../../../src/commands/contracts.js').CommandResult;

        expect(result.ok).toBe(false);
        expect(result.response).toContain('No building specified');
      });

      it('returns error when building not found', () => {
        vi.mocked(getBuilding).mockReturnValue({ ok: false, error: { code: 'NOT_FOUND', message: 'nope', retryable: false } });

        const cmd = getCommand('review')!;
        const ctx = makeContext({ command: 'review', args: ['bld_x'], rawText: '/review bld_x' });
        const result = cmd.handler(ctx) as import('../../../src/commands/contracts.js').CommandResult;

        expect(result.ok).toBe(false);
        expect(result.response).toContain('Building not found');
      });

      it('shows "No gate created" when current phase has no gate', () => {
        vi.mocked(getGates).mockReturnValue({ ok: true, data: [] });

        const cmd = getCommand('review')!;
        const ctx = makeContext({ command: 'review', args: ['bld_1'], rawText: '/review bld_1' });
        const result = cmd.handler(ctx) as import('../../../src/commands/contracts.js').CommandResult;

        expect(result.ok).toBe(true);
        expect(result.response).toContain('No gate created for current phase');
      });

      it('shows reviewer and verdict when gate has signoff', () => {
        vi.mocked(getGates).mockReturnValue({
          ok: true,
          data: [
            {
              id: 'gate_1', phase: 'discovery', status: 'signed-off',
              signoff_verdict: 'approved', signoff_reviewer: 'Architect',
            },
          ],
        });

        const cmd = getCommand('review')!;
        const ctx = makeContext({ command: 'review', args: ['bld_1'], rawText: '/review bld_1' });
        const result = cmd.handler(ctx) as import('../../../src/commands/contracts.js').CommandResult;

        expect(result.ok).toBe(true);
        expect(result.response).toContain('Reviewer: Architect');
        expect(result.response).toContain('Verdict: approved');
      });

      it('shows "Ready to Advance: Yes" when advancement is possible', () => {
        vi.mocked(canAdvance).mockReturnValue({
          ok: true,
          data: { canAdvance: true, nextPhase: 'strategy' },
        });

        const cmd = getCommand('review')!;
        const ctx = makeContext({ command: 'review', args: ['bld_1'], rawText: '/review bld_1' });
        const result = cmd.handler(ctx) as import('../../../src/commands/contracts.js').CommandResult;

        expect(result.ok).toBe(true);
        expect(result.response).toContain('Ready to Advance: Yes');
      });

      it('counts active issues from RAID log', () => {
        // searchRaid returns 3 entries, one of which is type 'issue'
        const cmd = getCommand('review')!;
        const ctx = makeContext({ command: 'review', args: ['bld_1'], rawText: '/review bld_1' });
        const result = cmd.handler(ctx) as import('../../../src/commands/contracts.js').CommandResult;

        expect(result.ok).toBe(true);
        expect(result.response).toContain('Active Issues: 1');
        expect(result.data).toEqual(expect.objectContaining({ activeIssues: 1 }));
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Mention Handler
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Mention Handler', () => {
    let handleMention: typeof import('../../../src/commands/mention-handler.js').handleMention;
    let initMentionHandler: typeof import('../../../src/commands/mention-handler.js').initMentionHandler;

    beforeEach(async () => {
      vi.resetModules();
      createMockAPIs();

      const mentionMod = await import('../../../src/commands/mention-handler.js');
      handleMention = mentionMod.handleMention;
      initMentionHandler = mentionMod.initMentionHandler;

      initMentionHandler(agents);
    });

    it('resolves an agent by ID (direct lookup)', async () => {
      const token: ParsedToken = { type: 'agent', char: '@', id: 'agent_1', label: 'Coder' };
      const ctx = makeContext({ command: '', rawText: '@Coder hello' });

      const result = await handleMention(token, ctx);

      expect(result.agentId).toBe('agent_1');
      expect(result.notified).toBe(true);
      expect(result.response).toContain('Coder');
      expect(result.response).toContain('developer');
    });

    it('resolves an agent by name when ID lookup fails (exact match)', async () => {
      // getAgent returns null for the given ID, but name search finds it
      (agents.getAgent as ReturnType<typeof vi.fn>).mockReturnValueOnce(null);

      const token: ParsedToken = { type: 'agent', char: '@', id: 'unknown_id', label: 'Architect' };
      const ctx = makeContext({ command: '', rawText: '@Architect can you review?' });

      const result = await handleMention(token, ctx);

      expect(result.agentId).toBe('agent_2');
      expect(result.notified).toBe(true);
      expect(result.response).toContain('Architect');
    });

    it('resolves an agent by partial name match', async () => {
      (agents.getAgent as ReturnType<typeof vi.fn>).mockReturnValueOnce(null);

      const token: ParsedToken = { type: 'agent', char: '@', id: 'unknown_id', label: 'arch' };
      const ctx = makeContext({ command: '', rawText: '@arch look at this' });

      const result = await handleMention(token, ctx);

      expect(result.notified).toBe(true);
      expect(result.agentId).toBe('agent_2'); // Architect contains 'arch'
    });

    it('returns not-found for an unknown agent', async () => {
      (agents.getAgent as ReturnType<typeof vi.fn>).mockReturnValueOnce(null);

      const token: ParsedToken = { type: 'agent', char: '@', id: 'ghost', label: 'GhostAgent' };
      const ctx = makeContext({ command: '', rawText: '@GhostAgent hello' });

      const result = await handleMention(token, ctx);

      expect(result.notified).toBe(false);
      expect(result.response).toContain('not found');
      expect(result.response).toContain('GhostAgent');
    });

    it('emits agent:mentioned bus event with correct payload', async () => {
      const bus = new MockBus();
      const token: ParsedToken = { type: 'agent', char: '@', id: 'agent_1', label: 'Coder' };
      const ctx = makeContext({
        command: '',
        rawText: '@Coder please review',
        bus: bus as any,
        roomId: 'room_1',
        buildingId: 'bld_1',
      });

      await handleMention(token, ctx);

      const mentionEvent = bus.emitted.find(e => e.event === 'agent:mentioned');
      expect(mentionEvent).toBeDefined();
      expect(mentionEvent!.data).toEqual(expect.objectContaining({
        agentId: 'agent_1',
        agentName: 'Coder',
        agentRole: 'developer',
        mentionedBy: 'socket_test_1',
        roomId: 'room_1',
        buildingId: 'bld_1',
        rawText: '@Coder please review',
      }));
    });

    it('returns error when mention handler is not initialized', async () => {
      // Re-import to get uninitialized state
      vi.resetModules();
      const freshMention = await import('../../../src/commands/mention-handler.js');

      const token: ParsedToken = { type: 'agent', char: '@', id: 'agent_1', label: 'Coder' };
      const ctx = makeContext({ command: '', rawText: '@Coder hello' });

      const result = await freshMention.handleMention(token, ctx);

      expect(result.notified).toBe(false);
      expect(result.response).toContain('not available');
    });

    it('includes roomId as null when no room context exists', async () => {
      const bus = new MockBus();
      const token: ParsedToken = { type: 'agent', char: '@', id: 'agent_1', label: 'Coder' };
      const ctx = makeContext({
        command: '',
        rawText: '@Coder hello',
        bus: bus as any,
        // no roomId or buildingId
      });

      await handleMention(token, ctx);

      const mentionEvent = bus.emitted.find(e => e.event === 'agent:mentioned');
      expect(mentionEvent).toBeDefined();
      expect(mentionEvent!.data).toEqual(expect.objectContaining({
        roomId: null,
        buildingId: null,
      }));
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Reference Resolver
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Reference Resolver', () => {
    let resolveReference: typeof import('../../../src/commands/reference-resolver.js').resolveReference;
    let initReferenceResolver: typeof import('../../../src/commands/reference-resolver.js').initReferenceResolver;

    beforeEach(async () => {
      vi.resetModules();
      createMockAPIs();

      const refMod = await import('../../../src/commands/reference-resolver.js');
      resolveReference = refMod.resolveReference;
      initReferenceResolver = refMod.initReferenceResolver;

      initReferenceResolver(rooms);

      // Reset searchRaid mock
      vi.mocked(searchRaid).mockReturnValue({
        ok: true,
        data: [
          {
            id: 'raid_001', type: 'risk', summary: 'API may change',
            phase: 'discovery', status: 'active', rationale: 'API is in beta',
          },
        ],
      });
    });

    describe('Room references (#room-name)', () => {
      it('resolves #room-name to a room by exact name match', async () => {
        const token: ParsedToken = { type: 'reference', char: '#', id: 'Main Lab', label: 'Main Lab' };
        const ctx = makeContext({ command: '', rawText: 'check #Main Lab' });

        const result = await resolveReference(token, ctx);

        expect(result.resolved).toBe(true);
        expect(result.content).toEqual(expect.objectContaining({
          id: 'room_1',
          name: 'Main Lab',
          type: 'code-lab',
        }));
      });

      it('resolves #room-type to a room by type match', async () => {
        const token: ParsedToken = { type: 'reference', char: '#', id: 'code-lab', label: 'code-lab' };
        const ctx = makeContext({ command: '', rawText: 'go to #code-lab' });

        const result = await resolveReference(token, ctx);

        expect(result.resolved).toBe(true);
        expect(result.content).toEqual(expect.objectContaining({
          type: 'code-lab',
          name: 'Main Lab',
        }));
      });

      it('resolves hyphenated room name (spaces replaced with hyphens)', async () => {
        const token: ParsedToken = { type: 'reference', char: '#', id: 'main-lab', label: 'main-lab' };
        const ctx = makeContext({ command: '', rawText: 'go to #main-lab' });

        const result = await resolveReference(token, ctx);

        expect(result.resolved).toBe(true);
        expect(result.content).toEqual(expect.objectContaining({
          name: 'Main Lab',
        }));
      });

      it('returns not-found for unknown room reference', async () => {
        const token: ParsedToken = { type: 'reference', char: '#', id: 'nonexistent-room', label: 'nonexistent-room' };
        const ctx = makeContext({ command: '', rawText: '#nonexistent-room' });

        const result = await resolveReference(token, ctx);

        expect(result.resolved).toBe(false);
        expect(result.content).toEqual(expect.objectContaining({
          error: expect.stringContaining('not found'),
        }));
      });

      it('returns error when reference resolver is not initialized', async () => {
        vi.resetModules();
        const freshRef = await import('../../../src/commands/reference-resolver.js');

        const token: ParsedToken = { type: 'reference', char: '#', id: 'some-room', label: 'some-room' };
        const ctx = makeContext({ command: '', rawText: '#some-room' });

        const result = await freshRef.resolveReference(token, ctx);

        expect(result.resolved).toBe(false);
        expect(result.content).toEqual(expect.objectContaining({
          error: expect.stringContaining('not available'),
        }));
      });

      it('performs case-insensitive room lookup', async () => {
        const token: ParsedToken = { type: 'reference', char: '#', id: 'MAIN LAB', label: 'MAIN LAB' };
        const ctx = makeContext({ command: '', rawText: '#MAIN LAB' });

        const result = await resolveReference(token, ctx);

        expect(result.resolved).toBe(true);
        expect(result.content).toEqual(expect.objectContaining({ name: 'Main Lab' }));
      });
    });

    describe('RAID references (#raid-xxx)', () => {
      it('resolves #raid-001 to a RAID entry', async () => {
        const token: ParsedToken = { type: 'reference', char: '#', id: 'raid-001', label: 'raid-001' };
        const ctx = makeContext({
          command: '',
          rawText: 'see #raid-001',
          buildingId: 'bld_1',
        });

        const result = await resolveReference(token, ctx);

        expect(result.resolved).toBe(true);
        expect(result.content).toEqual(expect.objectContaining({
          id: 'raid_001',
          type: 'risk',
          summary: 'API may change',
        }));
      });

      it('normalizes raid-xxx to raid_xxx format', async () => {
        // The resolver converts 'raid-001' to 'raid_001' for matching
        const token: ParsedToken = { type: 'reference', char: '#', id: 'raid-001', label: 'RAID-001' };
        const ctx = makeContext({
          command: '',
          rawText: 'check #raid-001',
          buildingId: 'bld_1',
        });

        const result = await resolveReference(token, ctx);

        expect(result.resolved).toBe(true);
        expect(result.content).toEqual(expect.objectContaining({ id: 'raid_001' }));
      });

      it('handles raid_xxx format directly', async () => {
        const token: ParsedToken = { type: 'reference', char: '#', id: 'raid_001', label: 'RAID_001' };
        const ctx = makeContext({
          command: '',
          rawText: 'check #raid_001',
          buildingId: 'bld_1',
        });

        const result = await resolveReference(token, ctx);

        expect(result.resolved).toBe(true);
        expect(result.content).toEqual(expect.objectContaining({ id: 'raid_001' }));
      });

      it('returns not-found for unknown RAID entry', async () => {
        const token: ParsedToken = { type: 'reference', char: '#', id: 'raid-999', label: 'RAID-999' };
        const ctx = makeContext({
          command: '',
          rawText: '#raid-999',
          buildingId: 'bld_1',
        });

        const result = await resolveReference(token, ctx);

        expect(result.resolved).toBe(false);
        expect(result.content).toEqual(expect.objectContaining({
          error: expect.stringContaining('not found'),
        }));
      });

      it('returns error when no buildingId context is available for RAID lookup', async () => {
        const token: ParsedToken = { type: 'reference', char: '#', id: 'raid-001', label: 'RAID-001' };
        const ctx = makeContext({
          command: '',
          rawText: '#raid-001',
          // no buildingId
        });

        const result = await resolveReference(token, ctx);

        expect(result.resolved).toBe(false);
        expect(result.content).toEqual(expect.objectContaining({
          error: expect.stringContaining('No building context'),
        }));
      });

      it('returns error when RAID search fails', async () => {
        vi.mocked(searchRaid).mockReturnValue({
          ok: false,
          error: { code: 'DB_ERROR', message: 'database error', retryable: false },
        });

        const token: ParsedToken = { type: 'reference', char: '#', id: 'raid-001', label: 'RAID-001' };
        const ctx = makeContext({
          command: '',
          rawText: '#raid-001',
          buildingId: 'bld_1',
        });

        const result = await resolveReference(token, ctx);

        expect(result.resolved).toBe(false);
        expect(result.content).toEqual(expect.objectContaining({
          error: expect.stringContaining('RAID search failed'),
        }));
      });

      it('strips leading # from token ID before processing', async () => {
        const token: ParsedToken = { type: 'reference', char: '#', id: '#raid-001', label: 'RAID-001' };
        const ctx = makeContext({
          command: '',
          rawText: '#raid-001',
          buildingId: 'bld_1',
        });

        const result = await resolveReference(token, ctx);

        expect(result.resolved).toBe(true);
        expect(result.content).toEqual(expect.objectContaining({ id: 'raid_001' }));
      });

      it('includes rationale in resolved RAID entry content', async () => {
        const token: ParsedToken = { type: 'reference', char: '#', id: 'raid-001', label: 'RAID-001' };
        const ctx = makeContext({
          command: '',
          rawText: '#raid-001',
          buildingId: 'bld_1',
        });

        const result = await resolveReference(token, ctx);

        expect(result.resolved).toBe(true);
        expect(result.content).toEqual(expect.objectContaining({
          rationale: 'API is in beta',
        }));
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // initCommands (Public API / index.ts)
  // ═══════════════════════════════════════════════════════════════════════════

  describe('initCommands (Public API)', () => {
    it('initializes the full command system without errors', async () => {
      vi.resetModules();
      createMockAPIs();

      const { initCommands } = await import('../../../src/commands/index.js');
      const bus = new MockBus();
      const tools = {
        registerTool: vi.fn(),
        getTool: vi.fn().mockReturnValue(null),
        getToolsForRoom: vi.fn().mockReturnValue([]),
        executeInRoom: vi.fn().mockResolvedValue({ ok: true, data: {} }),
      };

      expect(() => {
        initCommands({ bus: bus as any, rooms, agents, tools });
      }).not.toThrow();
    });

    it('re-exports registry functions', async () => {
      vi.resetModules();
      const mod = await import('../../../src/commands/index.js');

      expect(mod.registerCommand).toBeDefined();
      expect(mod.getCommand).toBeDefined();
      expect(mod.listCommands).toBeDefined();
      expect(mod.parseCommandText).toBeDefined();
      expect(mod.dispatchCommand).toBeDefined();
    });

    it('re-exports handler functions', async () => {
      vi.resetModules();
      const mod = await import('../../../src/commands/index.js');

      expect(mod.handleMention).toBeDefined();
      expect(mod.resolveReference).toBeDefined();
    });
  });
});
