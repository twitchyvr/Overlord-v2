/**
 * Agent-Runtime Agnostic Tests (#679)
 *
 * Verifies per-agent AI provider configuration and resolution order.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { initStorage, getDb } from '../../../src/storage/db.js';
import { initAgents, getAgent, updateAgent, registerAgent } from '../../../src/agents/agent-registry.js';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdirSync, existsSync, rmSync } from 'fs';
import type { Config } from '../../../src/core/config.js';

let testDir: string;

function createMockConfig(dbPath: string): Config {
  return {
    get: vi.fn((key: string) => {
      if (key === 'DB_PATH') return dbPath;
      return undefined;
    }),
    validate: vi.fn(),
    getAll: vi.fn(),
  } as unknown as Config;
}

describe('Agent Provider Configuration (#679)', () => {
  beforeEach(async () => {
    testDir = join(tmpdir(), `overlord-provider-test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
    mkdirSync(testDir, { recursive: true });
    const cfg = createMockConfig(join(testDir, 'test.db'));
    await initStorage(cfg);

    const mockBus = { on: vi.fn(), off: vi.fn(), emit: vi.fn() } as any;
    initAgents({ bus: mockBus });

    // Seed a building and agent
    const db = getDb();
    db.prepare(`INSERT INTO buildings (id, name) VALUES ('bld_1', 'Test')`).run();
    registerAgent({
      name: 'Test Agent',
      role: 'developer',
      buildingId: 'bld_1',
    });
  });

  afterEach(() => {
    if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
  });

  it('agent defaults to configurable provider', () => {
    const db = getDb();
    const agents = db.prepare('SELECT * FROM agents WHERE name = ?').all('Test Agent') as any[];
    expect(agents.length).toBeGreaterThan(0);
    expect(agents[0].provider).toBe('configurable');
  });

  it('agent provider is included in parsed agent', () => {
    const db = getDb();
    const row = db.prepare('SELECT id FROM agents WHERE name = ?').get('Test Agent') as any;
    const agent = getAgent(row.id);
    expect(agent).not.toBeNull();
    expect(agent!.provider).toBe('configurable');
  });

  it('updateAgent sets provider', () => {
    const db = getDb();
    const row = db.prepare('SELECT id FROM agents WHERE name = ?').get('Test Agent') as any;

    const result = updateAgent(row.id, { provider: 'anthropic' });
    expect(result.ok).toBe(true);

    const agent = getAgent(row.id);
    expect(agent!.provider).toBe('anthropic');
  });

  it('updateAgent can reset to configurable', () => {
    const db = getDb();
    const row = db.prepare('SELECT id FROM agents WHERE name = ?').get('Test Agent') as any;

    updateAgent(row.id, { provider: 'openai' });
    updateAgent(row.id, { provider: 'configurable' });

    const agent = getAgent(row.id);
    expect(agent!.provider).toBe('configurable');
  });

  it('provider column exists on agents table (migration)', () => {
    const db = getDb();
    const columns = db.prepare("PRAGMA table_info('agents')").all() as Array<{ name: string }>;
    const hasProvider = columns.some(c => c.name === 'provider');
    expect(hasProvider).toBe(true);
  });
});
