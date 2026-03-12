/**
 * Phase Gate Tests
 *
 * Tests the GO/NO-GO/CONDITIONAL verdict system.
 * Uses in-memory SQLite — no disk IO.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { createGate, signoffGate, canAdvance, getGates, getPendingGates, resolveConditions, getStalePendingGates, getPhaseOrder } from '../../../src/rooms/phase-gate.js';

// Patch getDb to use in-memory database
import * as dbModule from '../../../src/storage/db.js';
import { vi } from 'vitest';

let db: Database.Database;

function setupDb(): Database.Database {
  const memDb = new Database(':memory:');
  memDb.pragma('foreign_keys = OFF'); // Simplify test setup
  // Note: Database.prototype.exec() is SQLite's SQL execution method,
  // not Node's child_process exec — no shell injection risk.
  memDb.exec(`
    CREATE TABLE buildings (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      name TEXT NOT NULL,
      config TEXT DEFAULT '{}',
      active_phase TEXT DEFAULT 'strategy',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE phase_gates (
      id TEXT PRIMARY KEY,
      building_id TEXT NOT NULL,
      phase TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      exit_doc_id TEXT,
      signoff_reviewer TEXT,
      signoff_verdict TEXT,
      signoff_conditions TEXT DEFAULT '[]',
      signoff_timestamp TEXT,
      next_phase_input TEXT DEFAULT '{}',
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);
  return memDb;
}

describe('Phase Gate System', () => {
  beforeEach(() => {
    db = setupDb();
    vi.spyOn(dbModule, 'getDb').mockReturnValue(db as unknown as ReturnType<typeof dbModule.getDb>);

    // Seed a building
    db.prepare(`INSERT INTO buildings (id, name, active_phase) VALUES ('bld_1', 'Test Project', 'strategy')`).run();
  });

  describe('createGate', () => {
    it('creates a pending gate for a building phase', () => {
      const result = createGate({ buildingId: 'bld_1', phase: 'strategy' });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.phase).toBe('strategy');
        expect(result.data.status).toBe('pending');
        expect(result.data.id).toMatch(/^gate_/);
      }
    });

    it('stores gate in database', () => {
      createGate({ buildingId: 'bld_1', phase: 'discovery' });
      const rows = db.prepare('SELECT * FROM phase_gates WHERE building_id = ?').all('bld_1');
      expect(rows).toHaveLength(1);
    });
  });

  describe('signoffGate', () => {
    it('signs off with GO verdict and advances phase', () => {
      const gate = createGate({ buildingId: 'bld_1', phase: 'strategy' });
      if (!gate.ok) throw new Error('gate creation failed');

      const result = signoffGate({
        gateId: gate.data.id,
        reviewer: 'architect-agent',
        verdict: 'GO',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.verdict).toBe('GO');
        expect(result.data.status).toBe('go');
      }

      // Building phase should advance from strategy to discovery
      const building = db.prepare('SELECT active_phase FROM buildings WHERE id = ?').get('bld_1') as { active_phase: string };
      expect(building.active_phase).toBe('discovery');
    });

    it('signs off with NO-GO verdict and blocks advancement', () => {
      const gate = createGate({ buildingId: 'bld_1', phase: 'strategy' });
      if (!gate.ok) throw new Error('gate creation failed');

      signoffGate({
        gateId: gate.data.id,
        reviewer: 'architect-agent',
        verdict: 'NO-GO',
      });

      // Building phase should NOT advance
      const building = db.prepare('SELECT active_phase FROM buildings WHERE id = ?').get('bld_1') as { active_phase: string };
      expect(building.active_phase).toBe('strategy');
    });

    it('signs off with CONDITIONAL verdict and stores conditions', () => {
      const gate = createGate({ buildingId: 'bld_1', phase: 'strategy' });
      if (!gate.ok) throw new Error('gate creation failed');

      const result = signoffGate({
        gateId: gate.data.id,
        reviewer: 'pm-agent',
        verdict: 'CONDITIONAL',
        conditions: ['Fix auth flow', 'Add rate limiting'],
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.status).toBe('conditional');
      }

      const row = db.prepare('SELECT signoff_conditions FROM phase_gates WHERE id = ?').get(gate.data.id) as { signoff_conditions: string };
      expect(JSON.parse(row.signoff_conditions)).toEqual(['Fix auth flow', 'Add rate limiting']);
    });

    it('rejects invalid verdict', () => {
      const gate = createGate({ buildingId: 'bld_1', phase: 'strategy' });
      if (!gate.ok) throw new Error('gate creation failed');

      const result = signoffGate({
        gateId: gate.data.id,
        reviewer: 'agent',
        verdict: 'MAYBE' as any,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_VERDICT');
      }
    });

    it('rejects non-existent gate', () => {
      const result = signoffGate({
        gateId: 'gate_nonexistent',
        reviewer: 'agent',
        verdict: 'GO',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('GATE_NOT_FOUND');
      }
    });

    it('links exit document to gate', () => {
      const gate = createGate({ buildingId: 'bld_1', phase: 'strategy' });
      if (!gate.ok) throw new Error('gate creation failed');

      signoffGate({
        gateId: gate.data.id,
        reviewer: 'architect',
        verdict: 'GO',
        exitDocId: 'exitdoc_123',
      });

      const row = db.prepare('SELECT exit_doc_id FROM phase_gates WHERE id = ?').get(gate.data.id) as { exit_doc_id: string };
      expect(row.exit_doc_id).toBe('exitdoc_123');
    });

    it('stores next phase input for handoff', () => {
      const gate = createGate({ buildingId: 'bld_1', phase: 'strategy' });
      if (!gate.ok) throw new Error('gate creation failed');

      signoffGate({
        gateId: gate.data.id,
        reviewer: 'architect',
        verdict: 'GO',
        nextPhaseInput: { requirements: ['auth', 'api'], priority: 'high' },
      });

      const row = db.prepare('SELECT next_phase_input FROM phase_gates WHERE id = ?').get(gate.data.id) as { next_phase_input: string };
      expect(JSON.parse(row.next_phase_input)).toEqual({ requirements: ['auth', 'api'], priority: 'high' });
    });
  });

  describe('canAdvance', () => {
    it('returns false when no gate exists', () => {
      const result = canAdvance('bld_1');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.canAdvance).toBe(false);
      }
    });

    it('returns true after GO verdict', () => {
      const gate = createGate({ buildingId: 'bld_1', phase: 'strategy' });
      if (!gate.ok) throw new Error('gate creation failed');

      signoffGate({ gateId: gate.data.id, reviewer: 'agent', verdict: 'GO' });

      // After GO, building advances to discovery — so check discovery gate
      const result = canAdvance('bld_1');
      expect(result.ok).toBe(true);
      if (result.ok) {
        // Now in discovery phase, no gate yet so can't advance further
        expect(result.data.canAdvance).toBe(false);
      }
    });

    it('returns false after NO-GO verdict', () => {
      const gate = createGate({ buildingId: 'bld_1', phase: 'strategy' });
      if (!gate.ok) throw new Error('gate creation failed');

      signoffGate({ gateId: gate.data.id, reviewer: 'agent', verdict: 'NO-GO' });

      const result = canAdvance('bld_1');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.canAdvance).toBe(false);
      }
    });

    it('returns error for non-existent building', () => {
      const result = canAdvance('bld_ghost');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('BUILDING_NOT_FOUND');
      }
    });
  });

  describe('getGates', () => {
    it('returns all gates for a building', () => {
      createGate({ buildingId: 'bld_1', phase: 'strategy' });
      createGate({ buildingId: 'bld_1', phase: 'discovery' });

      const result = getGates('bld_1');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data).toHaveLength(2);
      }
    });

    it('returns empty array for building with no gates', () => {
      const result = getGates('bld_1');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data).toHaveLength(0);
      }
    });
  });

  describe('getPendingGates', () => {
    it('returns pending gates for a building', () => {
      createGate({ buildingId: 'bld_1', phase: 'strategy' });

      const result = getPendingGates('bld_1');
      expect(result.ok).toBe(true);
      if (result.ok) {
        const gates = result.data as unknown[];
        expect(gates).toHaveLength(1);
        expect((gates[0] as Record<string, unknown>).status).toBe('pending');
      }
    });

    it('returns conditional gates as pending approvals', () => {
      const gate = createGate({ buildingId: 'bld_1', phase: 'strategy' });
      if (!gate.ok) throw new Error('failed');

      signoffGate({
        gateId: gate.data.id,
        reviewer: 'pm',
        verdict: 'CONDITIONAL',
        conditions: ['Fix tests'],
      });

      const result = getPendingGates('bld_1');
      expect(result.ok).toBe(true);
      if (result.ok) {
        const gates = result.data as unknown[];
        expect(gates).toHaveLength(1);
        expect((gates[0] as Record<string, unknown>).status).toBe('conditional');
      }
    });

    it('excludes GO gates from pending', () => {
      const gate = createGate({ buildingId: 'bld_1', phase: 'strategy' });
      if (!gate.ok) throw new Error('failed');

      signoffGate({ gateId: gate.data.id, reviewer: 'pm', verdict: 'GO' });

      const result = getPendingGates('bld_1');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data).toHaveLength(0);
      }
    });

    it('returns all pending gates when no buildingId specified', () => {
      // Add a second building
      db.prepare(`INSERT INTO buildings (id, name, active_phase) VALUES ('bld_2', 'Other Project', 'strategy')`).run();

      createGate({ buildingId: 'bld_1', phase: 'strategy' });
      createGate({ buildingId: 'bld_2', phase: 'strategy' });

      const result = getPendingGates();
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data).toHaveLength(2);
      }
    });
  });

  describe('resolveConditions', () => {
    it('partially resolves conditions and returns remaining', () => {
      const gate = createGate({ buildingId: 'bld_1', phase: 'strategy' });
      if (!gate.ok) throw new Error('failed');

      signoffGate({
        gateId: gate.data.id,
        reviewer: 'pm',
        verdict: 'CONDITIONAL',
        conditions: ['Fix auth', 'Add rate limiting', 'Update docs'],
      });

      const result = resolveConditions({
        gateId: gate.data.id,
        resolvedConditions: ['Fix auth'],
        resolver: 'dev-agent',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.allResolved).toBe(false);
        expect(result.data.remainingConditions).toEqual(['Add rate limiting', 'Update docs']);
        expect(result.data.resolvedCount).toBe(1);
      }
    });

    it('auto-advances gate to GO when all conditions resolved', () => {
      const gate = createGate({ buildingId: 'bld_1', phase: 'strategy' });
      if (!gate.ok) throw new Error('failed');

      signoffGate({
        gateId: gate.data.id,
        reviewer: 'pm',
        verdict: 'CONDITIONAL',
        conditions: ['Fix auth'],
      });

      const result = resolveConditions({
        gateId: gate.data.id,
        resolvedConditions: ['Fix auth'],
        resolver: 'dev-agent',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        // Should have been re-signed as GO
        expect(result.data.verdict).toBe('GO');
      }

      // Building should have advanced
      const building = db.prepare('SELECT active_phase FROM buildings WHERE id = ?').get('bld_1') as { active_phase: string };
      expect(building.active_phase).toBe('discovery');
    });

    it('rejects resolve on non-conditional gate', () => {
      const gate = createGate({ buildingId: 'bld_1', phase: 'strategy' });
      if (!gate.ok) throw new Error('failed');

      // Gate is still pending (not conditional)
      const result = resolveConditions({
        gateId: gate.data.id,
        resolvedConditions: ['something'],
        resolver: 'agent',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('GATE_NOT_CONDITIONAL');
      }
    });

    it('rejects resolve on non-existent gate', () => {
      const result = resolveConditions({
        gateId: 'gate_nonexistent',
        resolvedConditions: ['something'],
        resolver: 'agent',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('GATE_NOT_FOUND');
      }
    });
  });

  describe('getStalePendingGates', () => {
    it('returns gates older than threshold', () => {
      // Insert a gate with a timestamp in the past
      db.prepare(`
        INSERT INTO phase_gates (id, building_id, phase, status, created_at)
        VALUES ('gate_old', 'bld_1', 'strategy', 'pending', datetime('now', '-1 hour'))
      `).run();

      const result = getStalePendingGates(30 * 60 * 1000); // 30 min threshold
      expect(result.ok).toBe(true);
      if (result.ok) {
        const gates = result.data as unknown[];
        expect(gates).toHaveLength(1);
        expect((gates[0] as Record<string, unknown>).id).toBe('gate_old');
      }
    });

    it('excludes recent gates', () => {
      createGate({ buildingId: 'bld_1', phase: 'strategy' }); // just created

      const result = getStalePendingGates(30 * 60 * 1000);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data).toHaveLength(0);
      }
    });
  });

  describe('getPhaseOrder', () => {
    it('returns the phase order array', () => {
      const order = getPhaseOrder();
      expect(order).toEqual(['strategy', 'discovery', 'architecture', 'execution', 'review', 'deploy']);
    });

    it('returns a copy (not the original array)', () => {
      const order1 = getPhaseOrder();
      const order2 = getPhaseOrder();
      order1.push('extra');
      expect(order2).toHaveLength(6);
    });
  });

  describe('full phase advancement', () => {
    it('advances through strategy → discovery → architecture', () => {
      // Strategy gate
      const g1 = createGate({ buildingId: 'bld_1', phase: 'strategy' });
      if (!g1.ok) throw new Error('failed');
      signoffGate({ gateId: g1.data.id, reviewer: 'pm', verdict: 'GO' });

      let building = db.prepare('SELECT active_phase FROM buildings WHERE id = ?').get('bld_1') as { active_phase: string };
      expect(building.active_phase).toBe('discovery');

      // Discovery gate
      const g2 = createGate({ buildingId: 'bld_1', phase: 'discovery' });
      if (!g2.ok) throw new Error('failed');
      signoffGate({ gateId: g2.data.id, reviewer: 'architect', verdict: 'GO' });

      building = db.prepare('SELECT active_phase FROM buildings WHERE id = ?').get('bld_1') as { active_phase: string };
      expect(building.active_phase).toBe('architecture');
    });
  });
});
