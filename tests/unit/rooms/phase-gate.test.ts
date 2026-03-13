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
      criteria TEXT DEFAULT '[]',
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

  describe('createGate — criteria', () => {
    it('stores criteria labels as { label, met: false } objects', () => {
      const result = createGate({
        buildingId: 'bld_1',
        phase: 'strategy',
        criteria: ['Exit doc reviewed', 'RAID entries complete', 'Tests passing'],
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.criteria).toHaveLength(3);
        expect(result.data.criteria[0]).toEqual({ label: 'Exit doc reviewed', met: false });
        expect(result.data.criteria[2]).toEqual({ label: 'Tests passing', met: false });
      }

      // Verify in DB
      const row = db.prepare('SELECT criteria FROM phase_gates WHERE id = ?').get(result.ok ? result.data.id : '') as { criteria: string };
      const parsed = JSON.parse(row.criteria);
      expect(parsed).toHaveLength(3);
      expect(parsed.every((c: { met: boolean }) => c.met === false)).toBe(true);
    });

    it('defaults to empty criteria array when not provided', () => {
      const result = createGate({ buildingId: 'bld_1', phase: 'strategy' });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.criteria).toEqual([]);
      }
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

    it('updates criteria with met status and evidence URLs on sign-off', () => {
      const gate = createGate({
        buildingId: 'bld_1',
        phase: 'strategy',
        criteria: ['Exit doc reviewed', 'RAID complete'],
      });
      if (!gate.ok) throw new Error('gate creation failed');

      signoffGate({
        gateId: gate.data.id,
        reviewer: 'architect',
        verdict: 'GO',
        criteria: [
          { label: 'Exit doc reviewed', met: true, evidenceUrl: 'https://example.com/doc' },
          { label: 'RAID complete', met: true },
        ],
      });

      const row = db.prepare('SELECT criteria FROM phase_gates WHERE id = ?').get(gate.data.id) as { criteria: string };
      const parsed = JSON.parse(row.criteria);
      expect(parsed).toHaveLength(2);
      expect(parsed[0]).toEqual({ label: 'Exit doc reviewed', met: true, evidenceUrl: 'https://example.com/doc' });
      expect(parsed[1]).toEqual({ label: 'RAID complete', met: true });
    });

    it('preserves existing criteria when not provided in sign-off', () => {
      const gate = createGate({
        buildingId: 'bld_1',
        phase: 'strategy',
        criteria: ['Test criteria'],
      });
      if (!gate.ok) throw new Error('gate creation failed');

      signoffGate({
        gateId: gate.data.id,
        reviewer: 'pm',
        verdict: 'CONDITIONAL',
        conditions: ['Need more review'],
        // No criteria parameter — should preserve existing
      });

      const row = db.prepare('SELECT criteria FROM phase_gates WHERE id = ?').get(gate.data.id) as { criteria: string };
      const parsed = JSON.parse(row.criteria);
      expect(parsed).toHaveLength(1);
      expect(parsed[0]).toEqual({ label: 'Test criteria', met: false });
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

    it('returns parsed criteria objects instead of JSON strings', () => {
      createGate({
        buildingId: 'bld_1',
        phase: 'strategy',
        criteria: ['Exit doc ready', 'Tests passing'],
      });

      const result = getGates('bld_1');
      expect(result.ok).toBe(true);
      if (result.ok) {
        const gates = result.data as Array<{ criteria: Array<{ label: string; met: boolean }> }>;
        expect(gates[0].criteria).toHaveLength(2);
        expect(gates[0].criteria[0]).toEqual({ label: 'Exit doc ready', met: false });
        expect(typeof gates[0].criteria).toBe('object'); // not a string
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

  describe('signoffGate — edge cases', () => {
    it('does not advance when GO on final phase (deploy)', () => {
      // Move building to deploy (final phase)
      db.prepare("UPDATE buildings SET active_phase = 'deploy' WHERE id = 'bld_1'").run();
      const gate = createGate({ buildingId: 'bld_1', phase: 'deploy' });
      if (!gate.ok) throw new Error('gate creation failed');

      const result = signoffGate({
        gateId: gate.data.id,
        reviewer: 'pm',
        verdict: 'GO',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.verdict).toBe('GO');
        expect(result.data.status).toBe('go');
        expect(result.data.phaseAdvanced).toBe(false);
        expect(result.data.nextPhase).toBeNull();
      }

      // Building stays on deploy
      const building = db.prepare('SELECT active_phase FROM buildings WHERE id = ?').get('bld_1') as { active_phase: string };
      expect(building.active_phase).toBe('deploy');
    });

    it('returns phaseAdvanced=true and nextPhase when GO advances', () => {
      const gate = createGate({ buildingId: 'bld_1', phase: 'strategy' });
      if (!gate.ok) throw new Error('gate creation failed');

      const result = signoffGate({
        gateId: gate.data.id,
        reviewer: 'pm',
        verdict: 'GO',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.phaseAdvanced).toBe(true);
        expect(result.data.nextPhase).toBe('discovery');
      }
    });

    it('does not set phaseAdvanced on NO-GO verdict', () => {
      const gate = createGate({ buildingId: 'bld_1', phase: 'strategy' });
      if (!gate.ok) throw new Error('gate creation failed');

      const result = signoffGate({
        gateId: gate.data.id,
        reviewer: 'pm',
        verdict: 'NO-GO',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.phaseAdvanced).toBe(false);
        expect(result.data.nextPhase).toBeNull();
      }
    });

    it('handles gate phase not in PHASE_ORDER gracefully', () => {
      // Insert gate with a custom/unknown phase
      db.prepare(`
        INSERT INTO phase_gates (id, building_id, phase, status)
        VALUES ('gate_custom', 'bld_1', 'custom-phase', 'pending')
      `).run();

      const result = signoffGate({
        gateId: 'gate_custom',
        reviewer: 'pm',
        verdict: 'GO',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.phaseAdvanced).toBe(false);
        expect(result.data.nextPhase).toBeNull();
      }
    });
  });

  describe('createGate — edge cases', () => {
    it('allows multiple gates for the same building and phase (duplicate)', () => {
      createGate({ buildingId: 'bld_1', phase: 'strategy' });
      createGate({ buildingId: 'bld_1', phase: 'strategy' });

      const rows = db.prepare("SELECT * FROM phase_gates WHERE building_id = 'bld_1' AND phase = 'strategy'").all();
      expect(rows).toHaveLength(2);
    });

    it('generates unique IDs for each gate', () => {
      const g1 = createGate({ buildingId: 'bld_1', phase: 'strategy' });
      const g2 = createGate({ buildingId: 'bld_1', phase: 'strategy' });
      if (!g1.ok || !g2.ok) throw new Error('failed');

      expect(g1.data.id).not.toBe(g2.data.id);
    });
  });

  describe('canAdvance — edge cases', () => {
    it('returns canAdvance=false with reason on final phase', () => {
      db.prepare("UPDATE buildings SET active_phase = 'deploy' WHERE id = 'bld_1'").run();

      const result = canAdvance('bld_1');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.canAdvance).toBe(false);
        expect(result.data.reason).toContain('Final phase');
      }
    });

    it('returns error for unknown phase not in PHASE_ORDER', () => {
      db.prepare("UPDATE buildings SET active_phase = 'unknown-phase' WHERE id = 'bld_1'").run();

      const result = canAdvance('bld_1');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('UNKNOWN_PHASE');
      }
    });
  });

  describe('resolveConditions — edge cases', () => {
    it('resolves multiple conditions at once', () => {
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
        resolvedConditions: ['Fix auth', 'Update docs'],
        resolver: 'dev-agent',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.resolvedCount).toBe(2);
        expect(result.data.remainingConditions).toEqual(['Add rate limiting']);
      }
    });

    it('ignores non-matching resolved conditions', () => {
      const gate = createGate({ buildingId: 'bld_1', phase: 'strategy' });
      if (!gate.ok) throw new Error('failed');

      signoffGate({
        gateId: gate.data.id,
        reviewer: 'pm',
        verdict: 'CONDITIONAL',
        conditions: ['Fix auth', 'Add tests'],
      });

      const result = resolveConditions({
        gateId: gate.data.id,
        resolvedConditions: ['NonExistent condition'],
        resolver: 'agent',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        // None were actually matched, so all remain
        expect(result.data.remainingConditions).toEqual(['Fix auth', 'Add tests']);
      }
    });

    it('rejects resolve on a GO gate', () => {
      const gate = createGate({ buildingId: 'bld_1', phase: 'strategy' });
      if (!gate.ok) throw new Error('failed');

      signoffGate({ gateId: gate.data.id, reviewer: 'pm', verdict: 'GO' });

      const result = resolveConditions({
        gateId: gate.data.id,
        resolvedConditions: ['anything'],
        resolver: 'agent',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('GATE_NOT_CONDITIONAL');
      }
    });

    it('rejects resolve on a NO-GO gate', () => {
      const gate = createGate({ buildingId: 'bld_1', phase: 'strategy' });
      if (!gate.ok) throw new Error('failed');

      signoffGate({ gateId: gate.data.id, reviewer: 'pm', verdict: 'NO-GO' });

      const result = resolveConditions({
        gateId: gate.data.id,
        resolvedConditions: ['anything'],
        resolver: 'agent',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('GATE_NOT_CONDITIONAL');
      }
    });
  });

  describe('getStalePendingGates — edge cases', () => {
    it('uses default 30-minute threshold when no argument', () => {
      // Insert gate 2 hours old
      db.prepare(`
        INSERT INTO phase_gates (id, building_id, phase, status, created_at)
        VALUES ('gate_ancient', 'bld_1', 'strategy', 'pending', datetime('now', '-2 hours'))
      `).run();

      const result = getStalePendingGates(); // default threshold
      expect(result.ok).toBe(true);
      if (result.ok) {
        const gates = result.data as unknown[];
        expect(gates).toHaveLength(1);
      }
    });

    it('excludes non-pending (conditional/go/no-go) gates', () => {
      const gate = createGate({ buildingId: 'bld_1', phase: 'strategy' });
      if (!gate.ok) throw new Error('failed');

      // Sign off as conditional (not pending)
      signoffGate({ gateId: gate.data.id, reviewer: 'pm', verdict: 'CONDITIONAL', conditions: ['c1'] });

      // Backdate it
      db.prepare(`UPDATE phase_gates SET created_at = datetime('now', '-2 hours') WHERE id = ?`).run(gate.data.id);

      const result = getStalePendingGates(30 * 60 * 1000);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data).toHaveLength(0);
      }
    });

    it('returns empty when all pending gates are recent', () => {
      createGate({ buildingId: 'bld_1', phase: 'strategy' });

      const result = getStalePendingGates(30 * 60 * 1000);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data).toHaveLength(0);
      }
    });

    it('includes building_name and active_phase in results', () => {
      db.prepare(`
        INSERT INTO phase_gates (id, building_id, phase, status, created_at)
        VALUES ('gate_old2', 'bld_1', 'strategy', 'pending', datetime('now', '-1 hour'))
      `).run();

      const result = getStalePendingGates(30 * 60 * 1000);
      expect(result.ok).toBe(true);
      if (result.ok) {
        const gates = result.data as Record<string, unknown>[];
        expect(gates[0]).toHaveProperty('building_name', 'Test Project');
        expect(gates[0]).toHaveProperty('active_phase', 'strategy');
      }
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
