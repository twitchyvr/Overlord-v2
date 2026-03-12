/**
 * Built-in Commands Tests
 *
 * Tests the 8 core slash commands (/help, /status, /phase, /agents,
 * /rooms, /raid, /deploy, /review). All external dependencies mocked.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ─── Mock dependencies ───

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

const mockListBuildings = vi.fn();
const mockGetBuilding = vi.fn();
vi.mock('../../../src/rooms/building-manager.js', () => ({
  listBuildings: (...args: unknown[]) => mockListBuildings(...args),
  getBuilding: (...args: unknown[]) => mockGetBuilding(...args),
}));

const mockGetGates = vi.fn();
const mockCanAdvance = vi.fn();
vi.mock('../../../src/rooms/phase-gate.js', () => ({
  getGates: (...args: unknown[]) => mockGetGates(...args),
  canAdvance: (...args: unknown[]) => mockCanAdvance(...args),
}));

const mockSearchRaid = vi.fn();
vi.mock('../../../src/rooms/raid-log.js', () => ({
  searchRaid: (...args: unknown[]) => mockSearchRaid(...args),
}));

// ─── Helpers ───

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
}> = {}): import('../../../src/commands/contracts.js').CommandContext {
  return {
    command: overrides.command ?? 'test',
    args: overrides.args ?? [],
    rawText: overrides.rawText ?? '/test',
    socketId: overrides.socketId ?? 'sock-1',
    buildingId: overrides.buildingId,
    roomId: overrides.roomId,
    agentId: overrides.agentId,
    tokens: (overrides.tokens ?? []) as import('../../../src/commands/contracts.js').ParsedToken[],
    bus: (overrides.bus ?? { emit: vi.fn() }) as import('../../../src/core/bus.js').Bus,
  };
}

function makeAgentAPI(agents: Array<{
  id: string; name: string; role: string; status: string;
  current_room_id: string | null;
}> = []) {
  return {
    registerAgent: vi.fn(),
    removeAgent: vi.fn(),
    getAgent: vi.fn(),
    listAgents: vi.fn(() => agents),
    updateAgent: vi.fn(),
  };
}

function makeRoomAPI(rooms: Array<{
  id: string; name: string; type: string; status: string;
}> = []) {
  return {
    createRoom: vi.fn(),
    enterRoom: vi.fn(),
    exitRoom: vi.fn(),
    getRoom: vi.fn(),
    listRooms: vi.fn(() => rooms),
    registerRoomType: vi.fn(),
  };
}

// ─── Tests ───

let registerBuiltinCommands: typeof import('../../../src/commands/builtin-commands.js').registerBuiltinCommands;
let getCommand: typeof import('../../../src/commands/command-registry.js').getCommand;

describe('Built-in Commands', () => {
  let agentAPI: ReturnType<typeof makeAgentAPI>;
  let roomAPI: ReturnType<typeof makeRoomAPI>;

  beforeEach(async () => {
    vi.resetModules();
    mockListBuildings.mockReset();
    mockGetBuilding.mockReset();
    mockGetGates.mockReset();
    mockCanAdvance.mockReset();
    mockSearchRaid.mockReset();

    const builtinMod = await import('../../../src/commands/builtin-commands.js');
    const registryMod = await import('../../../src/commands/command-registry.js');
    registerBuiltinCommands = builtinMod.registerBuiltinCommands;
    getCommand = registryMod.getCommand;

    agentAPI = makeAgentAPI([
      { id: 'a1', name: 'Architect', role: 'architect', status: 'idle', current_room_id: null },
      { id: 'a2', name: 'Tester', role: 'qa', status: 'busy', current_room_id: 'room-1' },
    ]);
    roomAPI = makeRoomAPI([
      { id: 'room-1', name: 'Design Room', type: 'design', status: 'active' },
      { id: 'room-2', name: 'Review Room', type: 'review', status: 'empty' },
    ]);

    registerBuiltinCommands(roomAPI as never, agentAPI as never);
  });

  // ─── /help ───

  describe('/help', () => {
    it('lists all registered commands when no argument', () => {
      const handler = getCommand('help')!.handler;
      const result = handler(makeCtx({ command: 'help', args: [] }));
      expect((result as { ok: boolean }).ok).toBe(true);
      expect((result as { response: string }).response).toContain('Available Commands');
      expect((result as { response: string }).response).toContain('/help');
      expect((result as { response: string }).response).toContain('/status');
    });

    it('shows help for a specific command', () => {
      const handler = getCommand('help')!.handler;
      const result = handler(makeCtx({ command: 'help', args: ['status'] }));
      expect((result as { ok: boolean }).ok).toBe(true);
      expect((result as { response: string }).response).toContain('/status');
      expect((result as { response: string }).response).toContain('Usage');
    });

    it('returns error for unknown command topic', () => {
      const handler = getCommand('help')!.handler;
      const result = handler(makeCtx({ command: 'help', args: ['nonexistent'] }));
      expect((result as { ok: boolean }).ok).toBe(false);
      expect((result as { response: string }).response).toContain('Unknown command');
    });

    it('shows aliases when command has them', () => {
      const handler = getCommand('help')!.handler;
      const result = handler(makeCtx({ command: 'help', args: ['help'] }));
      expect((result as { response: string }).response).toContain('Aliases');
      expect((result as { response: string }).response).toContain('/h');
    });

    it('is accessible via alias /h and /?', () => {
      expect(getCommand('h')).toBeDefined();
      expect(getCommand('?')).toBeDefined();
      expect(getCommand('h')!.name).toBe('help');
    });
  });

  // ─── /status ───

  describe('/status', () => {
    it('lists all buildings when no buildingId specified', () => {
      mockListBuildings.mockReturnValue({
        ok: true,
        data: [
          { id: 'bld-1', name: 'Project A', active_phase: 'strategy' },
          { id: 'bld-2', name: 'Project B', active_phase: 'execution' },
        ],
      });

      const handler = getCommand('status')!.handler;
      const result = handler(makeCtx({ command: 'status', args: [] }));
      expect((result as { ok: boolean }).ok).toBe(true);
      expect((result as { response: string }).response).toContain('Buildings (2)');
      expect((result as { response: string }).response).toContain('Project A');
      expect((result as { response: string }).response).toContain('Project B');
    });

    it('shows details for a specific building', () => {
      mockGetBuilding.mockReturnValue({
        ok: true,
        data: {
          id: 'bld-1',
          name: 'My Project',
          active_phase: 'discovery',
          floors: [{ id: 'f1', name: 'Floor 1', type: 'strategy' }],
        },
      });

      const handler = getCommand('status')!.handler;
      const result = handler(makeCtx({ command: 'status', args: ['bld-1'] }));
      expect((result as { ok: boolean }).ok).toBe(true);
      expect((result as { response: string }).response).toContain('My Project');
      expect((result as { response: string }).response).toContain('discovery');
      expect((result as { response: string }).response).toContain('Agents: 2');
      expect((result as { response: string }).response).toContain('Rooms: 2');
    });

    it('uses context buildingId when no arg provided', () => {
      mockGetBuilding.mockReturnValue({
        ok: true,
        data: { id: 'bld-ctx', name: 'Ctx Building', active_phase: 'strategy', floors: [] },
      });

      const handler = getCommand('status')!.handler;
      handler(makeCtx({ command: 'status', args: [], buildingId: 'bld-ctx' }));
      expect(mockGetBuilding).toHaveBeenCalledWith('bld-ctx');
    });

    it('returns error when building not found', () => {
      mockGetBuilding.mockReturnValue({ ok: false });

      const handler = getCommand('status')!.handler;
      const result = handler(makeCtx({ command: 'status', args: ['bld-ghost'] }));
      expect((result as { ok: boolean }).ok).toBe(false);
      expect((result as { response: string }).response).toContain('not found');
    });

    it('shows message when no buildings exist', () => {
      mockListBuildings.mockReturnValue({ ok: true, data: [] });

      const handler = getCommand('status')!.handler;
      const result = handler(makeCtx({ command: 'status', args: [] }));
      expect((result as { ok: boolean }).ok).toBe(true);
      expect((result as { response: string }).response).toContain('No buildings');
    });

    it('is accessible via alias /s and /info', () => {
      expect(getCommand('s')!.name).toBe('status');
      expect(getCommand('info')!.name).toBe('status');
    });
  });

  // ─── /phase ───

  describe('/phase', () => {
    it('shows phase and gate status for a building', () => {
      mockGetBuilding.mockReturnValue({
        ok: true,
        data: { name: 'Test Build', active_phase: 'architecture' },
      });
      mockGetGates.mockReturnValue({
        ok: true,
        data: [
          { id: 'g1', phase: 'strategy', status: 'go', signoff_verdict: 'GO' },
          { id: 'g2', phase: 'discovery', status: 'go', signoff_verdict: 'GO' },
          { id: 'g3', phase: 'architecture', status: 'pending', signoff_verdict: null },
        ],
      });
      mockCanAdvance.mockReturnValue({
        ok: true,
        data: { canAdvance: false, reason: 'No gate exists for current phase' },
      });

      const handler = getCommand('phase')!.handler;
      const result = handler(makeCtx({ command: 'phase', args: ['bld-1'] }));
      expect((result as { ok: boolean }).ok).toBe(true);
      expect((result as { response: string }).response).toContain('architecture');
      expect((result as { response: string }).response).toContain('Gates:');
    });

    it('returns error when no buildingId specified', () => {
      const handler = getCommand('phase')!.handler;
      const result = handler(makeCtx({ command: 'phase', args: [] }));
      expect((result as { ok: boolean }).ok).toBe(false);
      expect((result as { response: string }).response).toContain('No building specified');
    });

    it('returns error when building not found', () => {
      mockGetBuilding.mockReturnValue({ ok: false });

      const handler = getCommand('phase')!.handler;
      const result = handler(makeCtx({ command: 'phase', args: ['bld-ghost'] }));
      expect((result as { ok: boolean }).ok).toBe(false);
    });

    it('shows "can advance" when canAdvance is true', () => {
      mockGetBuilding.mockReturnValue({
        ok: true,
        data: { name: 'Build', active_phase: 'strategy' },
      });
      mockGetGates.mockReturnValue({ ok: true, data: [] });
      mockCanAdvance.mockReturnValue({
        ok: true,
        data: { canAdvance: true, nextPhase: 'discovery' },
      });

      const handler = getCommand('phase')!.handler;
      const result = handler(makeCtx({ command: 'phase', args: ['bld-1'] }));
      expect((result as { response: string }).response).toContain('Can advance');
      expect((result as { response: string }).response).toContain('discovery');
    });

    it('is accessible via alias /p and /gate', () => {
      expect(getCommand('p')!.name).toBe('phase');
      expect(getCommand('gate')!.name).toBe('phase');
    });
  });

  // ─── /agents ───

  describe('/agents', () => {
    it('lists all registered agents', () => {
      const handler = getCommand('agents')!.handler;
      const result = handler(makeCtx({ command: 'agents' }));
      expect((result as { ok: boolean }).ok).toBe(true);
      expect((result as { response: string }).response).toContain('Agents (2)');
      expect((result as { response: string }).response).toContain('Architect');
      expect((result as { response: string }).response).toContain('Tester');
    });

    it('shows room assignment for active agents', () => {
      const handler = getCommand('agents')!.handler;
      const result = handler(makeCtx({ command: 'agents' }));
      expect((result as { response: string }).response).toContain('room-1');
    });

    it('shows idle status for agents without rooms', () => {
      const handler = getCommand('agents')!.handler;
      const result = handler(makeCtx({ command: 'agents' }));
      expect((result as { response: string }).response).toContain('idle');
    });

    it('returns message when no agents registered', async () => {
      // Re-register with empty agents
      vi.resetModules();
      const builtinMod = await import('../../../src/commands/builtin-commands.js');
      const registryMod = await import('../../../src/commands/command-registry.js');
      const emptyAgentAPI = makeAgentAPI([]);
      builtinMod.registerBuiltinCommands(roomAPI as never, emptyAgentAPI as never);

      const handler = registryMod.getCommand('agents')!.handler;
      const result = handler(makeCtx({ command: 'agents' }));
      expect((result as { ok: boolean }).ok).toBe(true);
      expect((result as { response: string }).response).toContain('No agents');
    });

    it('is accessible via alias /a and /team', () => {
      expect(getCommand('a')!.name).toBe('agents');
      expect(getCommand('team')!.name).toBe('agents');
    });
  });

  // ─── /rooms ───

  describe('/rooms', () => {
    it('lists all rooms with type and status', () => {
      const handler = getCommand('rooms')!.handler;
      const result = handler(makeCtx({ command: 'rooms' }));
      expect((result as { ok: boolean }).ok).toBe(true);
      expect((result as { response: string }).response).toContain('Rooms (2)');
      expect((result as { response: string }).response).toContain('Design Room');
      expect((result as { response: string }).response).toContain('Review Room');
      expect((result as { response: string }).response).toContain('[design]');
    });

    it('returns message when no rooms created', async () => {
      vi.resetModules();
      const builtinMod = await import('../../../src/commands/builtin-commands.js');
      const registryMod = await import('../../../src/commands/command-registry.js');
      const emptyRoomAPI = makeRoomAPI([]);
      builtinMod.registerBuiltinCommands(emptyRoomAPI as never, agentAPI as never);

      const handler = registryMod.getCommand('rooms')!.handler;
      const result = handler(makeCtx({ command: 'rooms' }));
      expect((result as { ok: boolean }).ok).toBe(true);
      expect((result as { response: string }).response).toContain('No rooms');
    });

    it('is accessible via alias /r', () => {
      expect(getCommand('r')!.name).toBe('rooms');
    });
  });

  // ─── /raid ───

  describe('/raid', () => {
    it('shows all RAID entries for a building', () => {
      mockSearchRaid.mockReturnValue({
        ok: true,
        data: [
          { id: 'raid_1', type: 'risk', phase: 'strategy', summary: 'Security risk', status: 'active', decided_by: 'pm' },
          { id: 'raid_2', type: 'decision', phase: 'strategy', summary: 'Use TypeScript', status: 'active', decided_by: 'architect' },
        ],
      });

      const handler = getCommand('raid')!.handler;
      const result = handler(makeCtx({ command: 'raid', args: [], buildingId: 'bld-1' }));
      expect((result as { ok: boolean }).ok).toBe(true);
      expect((result as { response: string }).response).toContain('RAID Log (2');
      expect((result as { response: string }).response).toContain('Security risk');
      expect((result as { response: string }).response).toContain('Use TypeScript');
    });

    it('filters by RAID type when specified', () => {
      mockSearchRaid.mockReturnValue({
        ok: true,
        data: [{ id: 'raid_1', type: 'risk', phase: 'strategy', summary: 'Risk entry', status: 'active', decided_by: null }],
      });

      const handler = getCommand('raid')!.handler;
      handler(makeCtx({ command: 'raid', args: ['risk'], buildingId: 'bld-1' }));
      expect(mockSearchRaid).toHaveBeenCalledWith({ buildingId: 'bld-1', type: 'risk' });
    });

    it('rejects invalid RAID type', () => {
      const handler = getCommand('raid')!.handler;
      const result = handler(makeCtx({ command: 'raid', args: ['invalid-type'], buildingId: 'bld-1' }));
      expect((result as { ok: boolean }).ok).toBe(false);
      expect((result as { response: string }).response).toContain('Invalid RAID type');
    });

    it('returns error when no buildingId specified', () => {
      const handler = getCommand('raid')!.handler;
      const result = handler(makeCtx({ command: 'raid', args: [] }));
      expect((result as { ok: boolean }).ok).toBe(false);
      expect((result as { response: string }).response).toContain('No building specified');
    });

    it('returns message when no entries found', () => {
      mockSearchRaid.mockReturnValue({ ok: true, data: [] });

      const handler = getCommand('raid')!.handler;
      const result = handler(makeCtx({ command: 'raid', args: [], buildingId: 'bld-1' }));
      expect((result as { ok: boolean }).ok).toBe(true);
      expect((result as { response: string }).response).toContain('No RAID entries');
    });

    it('shows status tags for non-active entries', () => {
      mockSearchRaid.mockReturnValue({
        ok: true,
        data: [
          { id: 'raid_1', type: 'decision', phase: 'strategy', summary: 'Old decision', status: 'superseded', decided_by: 'pm' },
        ],
      });

      const handler = getCommand('raid')!.handler;
      const result = handler(makeCtx({ command: 'raid', args: [], buildingId: 'bld-1' }));
      expect((result as { response: string }).response).toContain('[superseded]');
    });

    it('is accessible via alias /log', () => {
      expect(getCommand('log')!.name).toBe('raid');
    });
  });

  // ─── /deploy ───

  describe('/deploy', () => {
    it('emits deploy:check event on bus', () => {
      const bus = { emit: vi.fn() };
      const handler = getCommand('deploy')!.handler;
      const result = handler(makeCtx({ command: 'deploy', args: ['bld-1'], bus }));
      expect((result as { ok: boolean }).ok).toBe(true);
      expect(bus.emit).toHaveBeenCalledWith('deploy:check', expect.objectContaining({
        buildingId: 'bld-1',
        requestedBy: 'sock-1',
      }));
    });

    it('uses context buildingId when no arg', () => {
      const bus = { emit: vi.fn() };
      const handler = getCommand('deploy')!.handler;
      handler(makeCtx({ command: 'deploy', args: [], buildingId: 'bld-ctx', bus }));
      expect(bus.emit).toHaveBeenCalledWith('deploy:check', expect.objectContaining({
        buildingId: 'bld-ctx',
      }));
    });

    it('returns error when no buildingId specified', () => {
      const handler = getCommand('deploy')!.handler;
      const result = handler(makeCtx({ command: 'deploy', args: [] }));
      expect((result as { ok: boolean }).ok).toBe(false);
      expect((result as { response: string }).response).toContain('No building specified');
    });
  });

  // ─── /review ───

  describe('/review', () => {
    it('shows review status with gate and RAID info', () => {
      mockGetBuilding.mockReturnValue({
        ok: true,
        data: { name: 'Project X', active_phase: 'architecture' },
      });
      mockGetGates.mockReturnValue({
        ok: true,
        data: [
          { phase: 'architecture', status: 'conditional', signoff_verdict: 'CONDITIONAL', signoff_reviewer: 'lead' },
        ],
      });
      mockCanAdvance.mockReturnValue({
        ok: true,
        data: { canAdvance: false, reason: 'Gate verdict: CONDITIONAL' },
      });
      mockSearchRaid.mockReturnValue({
        ok: true,
        data: [
          { type: 'issue', status: 'active' },
          { type: 'risk', status: 'active' },
        ],
      });

      const handler = getCommand('review')!.handler;
      const result = handler(makeCtx({ command: 'review', args: ['bld-1'] }));
      expect((result as { ok: boolean }).ok).toBe(true);
      const response = (result as { response: string }).response;
      expect(response).toContain('Project X');
      expect(response).toContain('architecture');
      expect(response).toContain('conditional');
      expect(response).toContain('Active Issues: 1'); // only issues, not risks
      expect(response).toContain('Ready to Advance: No');
    });

    it('shows "no gate" message when no gate exists for current phase', () => {
      mockGetBuilding.mockReturnValue({
        ok: true,
        data: { name: 'Build', active_phase: 'strategy' },
      });
      mockGetGates.mockReturnValue({ ok: true, data: [] });
      mockCanAdvance.mockReturnValue({
        ok: true,
        data: { canAdvance: false, reason: 'No gate' },
      });
      mockSearchRaid.mockReturnValue({ ok: true, data: [] });

      const handler = getCommand('review')!.handler;
      const result = handler(makeCtx({ command: 'review', args: ['bld-1'] }));
      expect((result as { response: string }).response).toContain('No gate created');
    });

    it('returns error when no buildingId specified', () => {
      const handler = getCommand('review')!.handler;
      const result = handler(makeCtx({ command: 'review', args: [] }));
      expect((result as { ok: boolean }).ok).toBe(false);
      expect((result as { response: string }).response).toContain('No building specified');
    });

    it('returns error when building not found', () => {
      mockGetBuilding.mockReturnValue({ ok: false });

      const handler = getCommand('review')!.handler;
      const result = handler(makeCtx({ command: 'review', args: ['bld-ghost'] }));
      expect((result as { ok: boolean }).ok).toBe(false);
      expect((result as { response: string }).response).toContain('not found');
    });

    it('shows reviewer info when gate has been signed', () => {
      mockGetBuilding.mockReturnValue({
        ok: true,
        data: { name: 'Build', active_phase: 'strategy' },
      });
      mockGetGates.mockReturnValue({
        ok: true,
        data: [{ phase: 'strategy', status: 'go', signoff_verdict: 'GO', signoff_reviewer: 'pm-agent' }],
      });
      mockCanAdvance.mockReturnValue({ ok: true, data: { canAdvance: true, nextPhase: 'discovery' } });
      mockSearchRaid.mockReturnValue({ ok: true, data: [] });

      const handler = getCommand('review')!.handler;
      const result = handler(makeCtx({ command: 'review', args: ['bld-1'] }));
      expect((result as { response: string }).response).toContain('pm-agent');
      expect((result as { response: string }).response).toContain('Ready to Advance: Yes');
    });
  });

  // ─── registerBuiltinCommands ───

  describe('registerBuiltinCommands', () => {
    it('registers all 8 commands', () => {
      const commandNames = ['help', 'status', 'phase', 'agents', 'rooms', 'raid', 'deploy', 'review'];
      for (const name of commandNames) {
        expect(getCommand(name)).toBeDefined();
        expect(getCommand(name)!.name).toBe(name);
      }
    });

    it('all commands have description, usage, and handler', () => {
      const commandNames = ['help', 'status', 'phase', 'agents', 'rooms', 'raid', 'deploy', 'review'];
      for (const name of commandNames) {
        const cmd = getCommand(name)!;
        expect(cmd.description).toBeTruthy();
        expect(cmd.usage).toBeTruthy();
        expect(typeof cmd.handler).toBe('function');
      }
    });
  });
});
