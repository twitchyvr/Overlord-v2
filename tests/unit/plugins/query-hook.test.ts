/**
 * queryHook Tests
 *
 * Tests the queryHook function from plugin-loader.ts which iterates
 * active plugin sandboxes and returns the first non-null hook response.
 * This is the core mechanism for making Overlord behavior scriptable.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

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

const mockCreateSandbox = vi.fn();
vi.mock('../../../src/plugins/plugin-sandbox.js', () => ({
  createSandbox: async (...args: unknown[]) => mockCreateSandbox(...args),
}));

const mockFs = {
  existsSync: vi.fn(),
  readdirSync: vi.fn(),
  readFileSync: vi.fn(),
};
vi.mock('node:fs', () => mockFs);

// ─── Helpers ───

function makeMockSandbox(hooks: Record<string, unknown> = {}) {
  return {
    execute: vi.fn(() => ({ ok: true, data: { pluginId: 'test-plugin', hooks: Object.keys(hooks) } })),
    callHook: vi.fn(async () => ({ ok: true, data: null })),
    getHooks: vi.fn(() => ({ ...hooks })),
    destroy: vi.fn(),
  };
}

function makeSystemAPIs() {
  return {
    bus: { emit: vi.fn(), on: vi.fn(), off: vi.fn() },
    rooms: { registerRoomType: vi.fn(), listRooms: vi.fn(() => []), getRoom: vi.fn() },
    agents: { listAgents: vi.fn(() => []), getAgent: vi.fn() },
    tools: {
      registerTool: vi.fn(),
      getTool: vi.fn(),
      executeInRoom: vi.fn(async () => ({ ok: true, data: null })),
    },
  };
}

function makeManifest(id: string) {
  return {
    id,
    name: `Plugin ${id}`,
    version: '1.0.0',
    description: `Test plugin ${id}`,
    engine: 'js' as const,
    entrypoint: 'main.js',
    permissions: [] as string[],
  };
}

// Re-import module on each test to reset module-level state
let initPluginLoader: typeof import('../../../src/plugins/plugin-loader.js').initPluginLoader;
let loadPlugin: typeof import('../../../src/plugins/plugin-loader.js').loadPlugin;
let queryHook: typeof import('../../../src/plugins/plugin-loader.js').queryHook;

describe('queryHook', () => {
  beforeEach(async () => {
    vi.resetModules();
    mockFs.existsSync.mockReset();
    mockFs.readdirSync.mockReset();
    mockFs.readFileSync.mockReset();
    mockCreateSandbox.mockReset();

    const mod = await import('../../../src/plugins/plugin-loader.js');
    initPluginLoader = mod.initPluginLoader;
    loadPlugin = mod.loadPlugin;
    queryHook = mod.queryHook;
  });

  // ─── 1. No plugins loaded ───

  it('returns null when no plugins are loaded', async () => {
    initPluginLoader(makeSystemAPIs() as never);
    const result = await queryHook('onPhaseGateEvaluate', { phaseId: 'p1' });
    expect(result).toBeNull();
  });

  // ─── 2. No plugin has the requested hook ───

  it('returns null when no plugin has the requested hook', async () => {
    initPluginLoader(makeSystemAPIs() as never);
    mockFs.readFileSync.mockReturnValue('// code');

    // Plugin registers onLoad but NOT onRoomEnter
    const sandbox = makeMockSandbox({ onLoad: vi.fn() });
    mockCreateSandbox.mockReturnValue(sandbox);
    await loadPlugin(makeManifest('no-match') as never, '/plugins/no-match');

    const result = await queryHook('onRoomEnter', { agentId: 'a1' });
    expect(result).toBeNull();
    expect(sandbox.callHook).not.toHaveBeenCalled();
  });

  // ─── 3. Returns first non-null value ───

  it('returns first non-null value from a plugin hook', async () => {
    initPluginLoader(makeSystemAPIs() as never);
    mockFs.readFileSync.mockReturnValue('// code');

    const sandbox = makeMockSandbox({ onPhaseGateEvaluate: vi.fn() });
    sandbox.callHook.mockResolvedValue({ ok: true, data: { verdict: 'GO' } });
    mockCreateSandbox.mockReturnValue(sandbox);
    await loadPlugin(makeManifest('gate-plugin') as never, '/plugins/gate-plugin');

    const result = await queryHook('onPhaseGateEvaluate', { phaseId: 'discovery' });
    expect(result).toEqual({ verdict: 'GO' });
  });

  // ─── 4. Skips plugins that are not active ───

  it('skips plugins that are not active', async () => {
    initPluginLoader(makeSystemAPIs() as never);
    mockFs.readFileSync.mockReturnValue('// code');

    // Load a plugin whose sandbox execution fails — sets status to 'error'
    const errorSandbox = makeMockSandbox({ onToolExecute: vi.fn() });
    errorSandbox.execute.mockReturnValue({
      ok: false,
      error: { code: 'PLUGIN_EXECUTION_ERROR', message: 'SyntaxError', retryable: false },
    });
    mockCreateSandbox.mockReturnValue(errorSandbox);
    await loadPlugin(makeManifest('broken-plugin') as never, '/plugins/broken-plugin');

    const result = await queryHook('onToolExecute', { toolName: 'write-file' });
    expect(result).toBeNull();
    expect(errorSandbox.callHook).not.toHaveBeenCalled();
  });

  // ─── 5. Skips plugins that don't register the hook ───

  it('skips plugins that do not register the hook', async () => {
    initPluginLoader(makeSystemAPIs() as never);
    mockFs.readFileSync.mockReturnValue('// code');

    // Plugin A has onLoad only — should be skipped for onToolExecute
    const sandboxA = makeMockSandbox({ onLoad: vi.fn() });
    mockCreateSandbox.mockReturnValueOnce(sandboxA);
    await loadPlugin(makeManifest('plugin-a') as never, '/plugins/plugin-a');

    // Plugin B has onToolExecute — should be called
    const sandboxB = makeMockSandbox({ onToolExecute: vi.fn() });
    sandboxB.callHook.mockResolvedValue({ ok: true, data: { allowed: true } });
    mockCreateSandbox.mockReturnValueOnce(sandboxB);
    await loadPlugin(makeManifest('plugin-b') as never, '/plugins/plugin-b');

    const result = await queryHook('onToolExecute', { toolName: 'read-file' });
    expect(result).toEqual({ allowed: true });
    expect(sandboxA.callHook).not.toHaveBeenCalled();
    expect(sandboxB.callHook).toHaveBeenCalled();
  });

  // ─── 6. Returns null when all plugins return null/undefined ───

  it('returns null when all plugins return null or undefined', async () => {
    initPluginLoader(makeSystemAPIs() as never);
    mockFs.readFileSync.mockReturnValue('// code');

    const sandbox1 = makeMockSandbox({ onRoomExit: vi.fn() });
    sandbox1.callHook.mockResolvedValue({ ok: true, data: null });
    mockCreateSandbox.mockReturnValueOnce(sandbox1);
    await loadPlugin(makeManifest('null-plugin') as never, '/plugins/null-plugin');

    const sandbox2 = makeMockSandbox({ onRoomExit: vi.fn() });
    sandbox2.callHook.mockResolvedValue({ ok: true, data: undefined });
    mockCreateSandbox.mockReturnValueOnce(sandbox2);
    await loadPlugin(makeManifest('undef-plugin') as never, '/plugins/undef-plugin');

    const result = await queryHook('onRoomExit', { agentId: 'a1', roomId: 'r1' });
    expect(result).toBeNull();
    // Both should have been queried
    expect(sandbox1.callHook).toHaveBeenCalled();
    expect(sandbox2.callHook).toHaveBeenCalled();
  });

  // ─── 7. Catches errors from plugin hooks without crashing ───

  it('catches errors from plugin hooks without crashing', async () => {
    initPluginLoader(makeSystemAPIs() as never);
    mockFs.readFileSync.mockReturnValue('// code');

    // First plugin throws an exception
    const throwingSandbox = makeMockSandbox({ onToolExecute: vi.fn() });
    throwingSandbox.callHook.mockRejectedValue(new Error('Lua runtime error'));
    mockCreateSandbox.mockReturnValueOnce(throwingSandbox);
    await loadPlugin(makeManifest('throwing-plugin') as never, '/plugins/throwing-plugin');

    // Second plugin returns a value
    const goodSandbox = makeMockSandbox({ onToolExecute: vi.fn() });
    goodSandbox.callHook.mockResolvedValue({ ok: true, data: { intercepted: true } });
    mockCreateSandbox.mockReturnValueOnce(goodSandbox);
    await loadPlugin(makeManifest('good-plugin') as never, '/plugins/good-plugin');

    // Should not throw — catches the error and continues to the next plugin
    const result = await queryHook('onToolExecute', { toolName: 'deploy' });
    expect(result).toEqual({ intercepted: true });
    expect(throwingSandbox.callHook).toHaveBeenCalled();
    expect(goodSandbox.callHook).toHaveBeenCalled();
  });

  // ─── 8. Passes correct hook data to sandbox callHook ───

  it('passes correct hook data to sandbox callHook', async () => {
    initPluginLoader(makeSystemAPIs() as never);
    mockFs.readFileSync.mockReturnValue('// code');

    const sandbox = makeMockSandbox({ onRoomEnter: vi.fn() });
    sandbox.callHook.mockResolvedValue({ ok: true, data: null });
    mockCreateSandbox.mockReturnValue(sandbox);
    await loadPlugin(makeManifest('data-check') as never, '/plugins/data-check');

    await queryHook('onRoomEnter', { agentId: 'agent-1', roomId: 'room-42', extra: 'value' });

    expect(sandbox.callHook).toHaveBeenCalledWith('onRoomEnter', {
      hook: 'onRoomEnter',
      agentId: 'agent-1',
      roomId: 'room-42',
      extra: 'value',
    });
  });

  // ─── 9. First plugin returning value short-circuits ───

  it('first plugin returning value short-circuits — second plugin not called', async () => {
    initPluginLoader(makeSystemAPIs() as never);
    mockFs.readFileSync.mockReturnValue('// code');

    const sandbox1 = makeMockSandbox({ onToolExecute: vi.fn() });
    sandbox1.callHook.mockResolvedValue({ ok: true, data: { overridden: 'by-first' } });
    mockCreateSandbox.mockReturnValueOnce(sandbox1);
    await loadPlugin(makeManifest('first-wins') as never, '/plugins/first-wins');

    const sandbox2 = makeMockSandbox({ onToolExecute: vi.fn() });
    sandbox2.callHook.mockResolvedValue({ ok: true, data: { overridden: 'by-second' } });
    mockCreateSandbox.mockReturnValueOnce(sandbox2);
    await loadPlugin(makeManifest('second-loses') as never, '/plugins/second-loses');

    const result = await queryHook('onToolExecute', { toolName: 'write-file' });
    expect(result).toEqual({ overridden: 'by-first' });
    expect(sandbox1.callHook).toHaveBeenCalled();
    expect(sandbox2.callHook).not.toHaveBeenCalled();
  });

  // ─── 10. Works with newer hook types ───

  it('works with onPhaseGateEvaluate hook type', async () => {
    initPluginLoader(makeSystemAPIs() as never);
    mockFs.readFileSync.mockReturnValue('// code');

    const sandbox = makeMockSandbox({ onPhaseGateEvaluate: vi.fn() });
    sandbox.callHook.mockResolvedValue({ ok: true, data: { verdict: 'NO_GO', reason: 'Tests failing' } });
    mockCreateSandbox.mockReturnValue(sandbox);
    await loadPlugin(makeManifest('gate-evaluator') as never, '/plugins/gate-evaluator');

    const result = await queryHook('onPhaseGateEvaluate', {
      phaseFrom: 'discovery',
      phaseTo: 'architecture',
      evidence: [],
    });
    expect(result).toEqual({ verdict: 'NO_GO', reason: 'Tests failing' });
  });

  it('works with onExitDocValidate hook type', async () => {
    initPluginLoader(makeSystemAPIs() as never);
    mockFs.readFileSync.mockReturnValue('// code');

    const sandbox = makeMockSandbox({ onExitDocValidate: vi.fn() });
    sandbox.callHook.mockResolvedValue({
      ok: true,
      data: { valid: false, errors: ['Missing acceptance criteria'] },
    });
    mockCreateSandbox.mockReturnValue(sandbox);
    await loadPlugin(makeManifest('doc-validator') as never, '/plugins/doc-validator');

    const result = await queryHook('onExitDocValidate', {
      roomId: 'discovery-room',
      exitDoc: { summary: 'Requirements gathered' },
    });
    expect(result).toEqual({ valid: false, errors: ['Missing acceptance criteria'] });
  });

  // ─── Additional edge cases ───

  it('skips plugin whose callHook returns a non-ok result and continues', async () => {
    initPluginLoader(makeSystemAPIs() as never);
    mockFs.readFileSync.mockReturnValue('// code');

    // First plugin returns an error result (ok: false)
    const errSandbox = makeMockSandbox({ onRoomEnter: vi.fn() });
    errSandbox.callHook.mockResolvedValue({
      ok: false,
      error: { code: 'HOOK_FAILED', message: 'nope', retryable: false },
    });
    mockCreateSandbox.mockReturnValueOnce(errSandbox);
    await loadPlugin(makeManifest('err-plugin') as never, '/plugins/err-plugin');

    // Second plugin returns a value
    const okSandbox = makeMockSandbox({ onRoomEnter: vi.fn() });
    okSandbox.callHook.mockResolvedValue({ ok: true, data: { custom: 'response' } });
    mockCreateSandbox.mockReturnValueOnce(okSandbox);
    await loadPlugin(makeManifest('ok-plugin') as never, '/plugins/ok-plugin');

    const result = await queryHook('onRoomEnter', { agentId: 'a1' });
    expect(result).toEqual({ custom: 'response' });
  });

  it('returns null when the only plugin throws and no other plugins exist', async () => {
    initPluginLoader(makeSystemAPIs() as never);
    mockFs.readFileSync.mockReturnValue('// code');

    const sandbox = makeMockSandbox({ onRoomExit: vi.fn() });
    sandbox.callHook.mockRejectedValue(new Error('catastrophic failure'));
    mockCreateSandbox.mockReturnValue(sandbox);
    await loadPlugin(makeManifest('solo-crash') as never, '/plugins/solo-crash');

    const result = await queryHook('onRoomExit', { roomId: 'r1' });
    expect(result).toBeNull();
  });
});
