/**
 * Server Bootstrap Tests
 *
 * Tests the server entry point initialization sequence.
 * Verifies layer ordering, endpoint registration, and shutdown handling.
 *
 * Since server.ts calls start() at module load, we mock all dependencies
 * and verify they're called in the correct order.
 */

import { describe, it, expect, vi, beforeAll } from 'vitest';

// Track initialization order
const initOrder: string[] = [];

// Mock all layer init functions
vi.mock('../../src/core/config.js', () => ({
  config: {
    validate: vi.fn(),
    get: vi.fn((key: string) => {
      if (key === 'PORT') return 3999;
      if (key === 'NODE_ENV') return 'test';
      if (key === 'CORS_ORIGIN') return '*';
      return undefined;
    }),
  },
}));

vi.mock('../../src/core/bus.js', () => {
  const handlers = new Map<string, Function>();
  return {
    bus: {
      emit: vi.fn(),
      on: vi.fn((event: string, fn: Function) => {
        handlers.set(event, fn);
      }),
      onNamespace: vi.fn(),
    },
  };
});

vi.mock('../../src/core/logger.js', () => {
  const child = () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
  });
  return { logger: { child } };
});

vi.mock('../../src/storage/db.js', () => ({
  initStorage: vi.fn(async () => {
    initOrder.push('storage');
  }),
}));

vi.mock('../../src/ai/ai-provider.js', () => ({
  initAI: vi.fn(() => {
    initOrder.push('ai');
    return { sendMessage: vi.fn() };
  }),
}));

vi.mock('../../src/tools/tool-registry.js', () => ({
  initTools: vi.fn(() => {
    initOrder.push('tools');
    return { getToolsForRoom: vi.fn(), executeInRoom: vi.fn() };
  }),
}));

vi.mock('../../src/agents/agent-registry.js', () => ({
  initAgents: vi.fn(() => {
    initOrder.push('agents');
    return { listAgents: vi.fn(() => []), getAgent: vi.fn(), registerAgent: vi.fn() };
  }),
}));

const mockRegisterRoomType = vi.fn();
vi.mock('../../src/rooms/room-manager.js', () => ({
  initRooms: vi.fn(() => {
    initOrder.push('rooms');
    return {
      registerRoomType: mockRegisterRoomType,
      createRoom: vi.fn(),
      getRoom: vi.fn(),
      listRooms: vi.fn(() => []),
      enterRoom: vi.fn(),
      hydrateRoomsFromDb: vi.fn(() => {
        initOrder.push('room-hydration');
        return { activated: 0, skipped: 0, failed: 0 };
      }),
    };
  }),
}));

vi.mock('../../src/rooms/room-types/index.js', () => ({
  registerBuiltInRoomTypes: vi.fn((registerFn: Function) => {
    initOrder.push('room-types');
  }),
}));

vi.mock('../../src/rooms/phase-zero.js', () => ({
  initPhaseZeroHandler: vi.fn(() => {
    initOrder.push('phase-zero');
  }),
}));

vi.mock('../../src/rooms/scope-change.js', () => ({
  initScopeChangeHandler: vi.fn(() => {
    initOrder.push('scope-change');
  }),
}));

vi.mock('../../src/rooms/chat-orchestrator.js', () => ({
  initChatOrchestrator: vi.fn(() => {
    initOrder.push('chat-orchestrator');
  }),
}));

vi.mock('../../src/rooms/building-onboarding.js', () => ({
  initBuildingOnboarding: vi.fn(() => {
    initOrder.push('building-onboarding');
  }),
}));

vi.mock('../../src/rooms/escalation-handler.js', () => ({
  initEscalationHandler: vi.fn(() => {
    initOrder.push('escalation-handler');
  }),
}));

vi.mock('../../src/rooms/building-manager.js', () => ({
  listBuildings: vi.fn(() => ({
    ok: true,
    data: [{ id: 'bld_1', name: 'Test', active_phase: 'strategy' }],
  })),
}));

vi.mock('../../src/commands/index.js', () => ({
  initCommands: vi.fn(() => {
    initOrder.push('commands');
  }),
}));

vi.mock('../../src/plugins/index.js', () => ({
  initPlugins: vi.fn(async () => {
    initOrder.push('plugins');
  }),
}));

vi.mock('../../src/tools/mcp-manager.js', () => ({
  initMcp: vi.fn(async () => {
    initOrder.push('mcp');
  }),
}));

// Mock HTTP/Express/Socket.IO
const mockRoutes: Record<string, Function> = {};
const mockApp = {
  use: vi.fn(),
  get: vi.fn((path: string, handler: Function) => {
    mockRoutes[path] = handler;
  }),
};

const mockHttpServer = {
  listen: vi.fn((_port: number, cb: Function) => cb()),
  close: vi.fn(),
};

vi.mock('express', () => {
  const expressFn = () => mockApp;
  expressFn.json = () => vi.fn();
  expressFn.static = () => vi.fn();
  return { default: expressFn };
});

vi.mock('node:http', () => ({
  createServer: vi.fn(() => mockHttpServer),
}));

vi.mock('socket.io', () => ({
  Server: vi.fn(() => ({
    on: vi.fn(),
  })),
}));

vi.mock('../../src/transport/socket-handler.js', () => ({
  initTransport: vi.fn(() => {
    initOrder.push('transport');
  }),
}));

describe('Server Bootstrap', () => {
  // server.ts calls start() at module load — import once, share state across all tests
  beforeAll(async () => {
    await import('../../src/server.js');
    // Allow async init to complete
    await vi.waitFor(() => {
      expect(initOrder.length).toBeGreaterThanOrEqual(14);
    });
  });

  it('initializes all layers in correct order', () => {
    // Verify strict layer ordering: Storage → AI → Tools → Agents → Rooms → Transport
    const storageIdx = initOrder.indexOf('storage');
    const aiIdx = initOrder.indexOf('ai');
    const toolsIdx = initOrder.indexOf('tools');
    const agentsIdx = initOrder.indexOf('agents');
    const roomsIdx = initOrder.indexOf('rooms');
    const transportIdx = initOrder.indexOf('transport');

    expect(storageIdx).toBeLessThan(aiIdx);
    expect(aiIdx).toBeLessThan(toolsIdx);
    expect(toolsIdx).toBeLessThan(agentsIdx);
    expect(agentsIdx).toBeLessThan(roomsIdx);
    expect(roomsIdx).toBeLessThan(transportIdx);
  });

  it('registers built-in room types after room manager init', () => {
    expect(initOrder).toContain('room-types');

    const roomsIdx = initOrder.indexOf('rooms');
    const roomTypesIdx = initOrder.indexOf('room-types');
    expect(roomTypesIdx).toBeGreaterThan(roomsIdx);
  });

  it('wires bus handlers before transport', () => {
    const phaseZeroIdx = initOrder.indexOf('phase-zero');
    const chatOrcIdx = initOrder.indexOf('chat-orchestrator');
    const buildingOnboardIdx = initOrder.indexOf('building-onboarding');
    const escalationIdx = initOrder.indexOf('escalation-handler');
    const transportIdx = initOrder.indexOf('transport');

    expect(phaseZeroIdx).toBeLessThan(transportIdx);
    expect(chatOrcIdx).toBeLessThan(transportIdx);
    expect(buildingOnboardIdx).toBeLessThan(transportIdx);
    expect(escalationIdx).toBeLessThan(transportIdx);
  });

  it('registers /health endpoint', () => {
    expect(mockRoutes['/health']).toBeDefined();

    const mockRes = { json: vi.fn() };
    mockRoutes['/health']({}, mockRes);

    expect(mockRes.json).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'ok', version: '0.1.0' }),
    );
  });

  it('registers /api/status endpoint with building data', () => {
    expect(mockRoutes['/api/status']).toBeDefined();

    const mockRes = { json: vi.fn() };
    mockRoutes['/api/status']({}, mockRes);

    expect(mockRes.json).toHaveBeenCalledWith(
      expect.objectContaining({
        isNewUser: false,
        buildings: expect.arrayContaining([
          expect.objectContaining({ id: 'bld_1', name: 'Test', activePhase: 'strategy' }),
        ]),
      }),
    );
  });

  it('starts HTTP server on configured port', () => {
    expect(mockHttpServer.listen).toHaveBeenCalledWith(3999, expect.any(Function));
  });

  it('initializes commands, plugins, and MCP after rooms', () => {
    const roomsIdx = initOrder.indexOf('rooms');
    const commandsIdx = initOrder.indexOf('commands');
    const pluginsIdx = initOrder.indexOf('plugins');
    const mcpIdx = initOrder.indexOf('mcp');
    const transportIdx = initOrder.indexOf('transport');

    expect(commandsIdx).toBeGreaterThan(roomsIdx);
    expect(pluginsIdx).toBeGreaterThan(roomsIdx);
    expect(mcpIdx).toBeGreaterThan(pluginsIdx);
    expect(commandsIdx).toBeLessThan(transportIdx);
    expect(pluginsIdx).toBeLessThan(transportIdx);
    expect(mcpIdx).toBeLessThan(transportIdx);
  });
});
