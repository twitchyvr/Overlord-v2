/**
 * Full Lifecycle Integration Test
 *
 * Walks the complete project flow:
 *   Strategist → Discovery → Architecture → Code Lab → Testing Lab → Review → Deploy
 *
 * Verifies:
 * - Room creation and agent entry for each phase
 * - Exit document submission with RAID auto-linking
 * - Phase gate sign-off with GO/NO-GO verdicts
 * - Phase advancement from strategy through deploy
 * - Exit doc → RAID entry pipeline
 * - Previous phase output feeds into next phase input
 * - Scope change re-entry flow
 *
 * Uses in-memory SQLite — no network, no external deps.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import * as dbModule from '../../src/storage/db.js';
import { initRooms, registerRoomType, createRoom, enterRoom, exitRoom, submitExitDocument } from '../../src/rooms/room-manager.js';
import { createGate, signoffGate, canAdvance, getGates } from '../../src/rooms/phase-gate.js';
import { addRaidEntry, searchRaid, buildContextBrief } from '../../src/rooms/raid-log.js';
import { EventEmitter } from 'eventemitter3';

// Room types
import { StrategistOffice } from '../../src/rooms/room-types/strategist.js';
import { DiscoveryRoom } from '../../src/rooms/room-types/discovery.js';
import { ArchitectureRoom } from '../../src/rooms/room-types/architecture.js';
import { CodeLab } from '../../src/rooms/room-types/code-lab.js';
import { TestingLab } from '../../src/rooms/room-types/testing-lab.js';
import { ReviewRoom } from '../../src/rooms/room-types/review.js';
import { DeployRoom } from '../../src/rooms/room-types/deploy.js';

let memDb: Database.Database;

function setupDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');

  // Create all tables needed
  db.prepare(`CREATE TABLE IF NOT EXISTS buildings (
    id TEXT PRIMARY KEY, project_id TEXT, name TEXT NOT NULL,
    config TEXT DEFAULT '{}', active_phase TEXT DEFAULT 'strategy',
    created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
  )`).run();

  db.prepare(`CREATE TABLE IF NOT EXISTS floors (
    id TEXT PRIMARY KEY, building_id TEXT NOT NULL REFERENCES buildings(id),
    type TEXT NOT NULL, name TEXT NOT NULL, sort_order INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 1, config TEXT DEFAULT '{}', created_at TEXT DEFAULT (datetime('now'))
  )`).run();

  db.prepare(`CREATE TABLE IF NOT EXISTS rooms (
    id TEXT PRIMARY KEY, floor_id TEXT NOT NULL REFERENCES floors(id),
    type TEXT NOT NULL, name TEXT NOT NULL, allowed_tools TEXT DEFAULT '[]',
    file_scope TEXT DEFAULT 'assigned', exit_template TEXT DEFAULT '{}',
    escalation TEXT DEFAULT '{}', provider TEXT DEFAULT 'configurable',
    config TEXT DEFAULT '{}', status TEXT DEFAULT 'idle', created_at TEXT DEFAULT (datetime('now'))
  )`).run();

  db.prepare(`CREATE TABLE IF NOT EXISTS tables_v2 (
    id TEXT PRIMARY KEY, room_id TEXT NOT NULL REFERENCES rooms(id),
    type TEXT NOT NULL DEFAULT 'focus', chairs INTEGER DEFAULT 1,
    description TEXT, created_at TEXT DEFAULT (datetime('now'))
  )`).run();

  db.prepare(`CREATE TABLE IF NOT EXISTS agents (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, role TEXT NOT NULL,
    building_id TEXT REFERENCES buildings(id),
    capabilities TEXT DEFAULT '[]', room_access TEXT DEFAULT '[]',
    badge TEXT, status TEXT DEFAULT 'idle', current_room_id TEXT REFERENCES rooms(id),
    current_table_id TEXT REFERENCES tables_v2(id), config TEXT DEFAULT '{}',
    created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
  )`).run();

  db.prepare(`CREATE TABLE IF NOT EXISTS exit_documents (
    id TEXT PRIMARY KEY, room_id TEXT NOT NULL REFERENCES rooms(id),
    type TEXT NOT NULL, completed_by TEXT NOT NULL, fields TEXT DEFAULT '{}',
    artifacts TEXT DEFAULT '[]', raid_entry_ids TEXT DEFAULT '[]',
    created_at TEXT DEFAULT (datetime('now'))
  )`).run();

  db.prepare(`CREATE TABLE IF NOT EXISTS phase_gates (
    id TEXT PRIMARY KEY, building_id TEXT NOT NULL REFERENCES buildings(id),
    phase TEXT NOT NULL, status TEXT DEFAULT 'pending', criteria TEXT DEFAULT '[]',
    exit_doc_id TEXT, signoff_reviewer TEXT, signoff_verdict TEXT,
    signoff_conditions TEXT DEFAULT '[]', signoff_timestamp TEXT,
    next_phase_input TEXT DEFAULT '{}',
    created_at TEXT DEFAULT (datetime('now'))
  )`).run();

  db.prepare(`CREATE TABLE IF NOT EXISTS raid_entries (
    id TEXT PRIMARY KEY, building_id TEXT NOT NULL REFERENCES buildings(id),
    type TEXT NOT NULL CHECK(type IN ('risk', 'assumption', 'issue', 'decision')),
    phase TEXT NOT NULL, room_id TEXT, summary TEXT NOT NULL, rationale TEXT,
    decided_by TEXT, approved_by TEXT, affected_areas TEXT DEFAULT '[]',
    status TEXT DEFAULT 'active' CHECK(status IN ('active', 'superseded', 'closed')),
    created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
  )`).run();

  return db;
}

describe('Full Lifecycle Integration', () => {
  const buildingId = 'b_lifecycle';
  const agentId = 'agent_lifecycle';
  const bus = new EventEmitter();

  beforeEach(() => {
    memDb = setupDb();
    vi.spyOn(dbModule, 'getDb').mockReturnValue(memDb as any);

    // Create building + floors
    memDb.prepare("INSERT INTO buildings (id, name) VALUES (?, 'Lifecycle Test')").run(buildingId);
    memDb.prepare("INSERT INTO floors (id, building_id, type, name) VALUES ('f_strat', ?, 'strategy', 'Strategy Floor')").run(buildingId);
    memDb.prepare("INSERT INTO floors (id, building_id, type, name) VALUES ('f_collab', ?, 'collaboration', 'Collab Floor')").run(buildingId);
    memDb.prepare("INSERT INTO floors (id, building_id, type, name) VALUES ('f_exec', ?, 'execution', 'Execution Floor')").run(buildingId);
    memDb.prepare("INSERT INTO floors (id, building_id, type, name) VALUES ('f_gov', ?, 'governance', 'Governance Floor')").run(buildingId);
    memDb.prepare("INSERT INTO floors (id, building_id, type, name) VALUES ('f_ops', ?, 'operations', 'Operations Floor')").run(buildingId);

    // Create agent with wildcard room access
    memDb.prepare("INSERT INTO agents (id, name, role, room_access) VALUES (?, 'Lifecycle Agent', 'orchestrator', '[\"*\"]')").run(agentId);

    // Register room types
    initRooms({ bus, agents: {} as any, tools: {} as any, ai: {} as any });
    registerRoomType('strategist', StrategistOffice as any);
    registerRoomType('discovery', DiscoveryRoom as any);
    registerRoomType('architecture', ArchitectureRoom as any);
    registerRoomType('code-lab', CodeLab as any);
    registerRoomType('testing-lab', TestingLab as any);
    registerRoomType('review', ReviewRoom as any);
    registerRoomType('deploy', DeployRoom as any);
  });

  it('walks full project lifecycle: strategy → discovery → architecture → execution → review → deploy', async () => {
    // Dynamically import to get the fresh module functions
    // Uses top-level imports: createRoom, enterRoom, exitRoom, submitExitDocument

    // ─── Phase 0: Strategy ───
    const stratRoom = createRoom({ type: 'strategist', floorId: 'f_strat', name: 'Project Setup' });
    expect(stratRoom.ok).toBe(true);
    const stratRoomId = stratRoom.data.id;

    const stratEnter = enterRoom({ roomId: stratRoomId, agentId, tableType: 'consultation' });
    expect(stratEnter.ok).toBe(true);

    // Submit building blueprint
    const stratExitDoc = await submitExitDocument({
      roomId: stratRoomId,
      agentId,
      document: {
        effortLevel: 'medium',
        projectGoals: ['Build task manager'],
        successCriteria: ['CRUD operations work'],
        floorsNeeded: ['collaboration', 'execution', 'governance'],
        roomConfig: [{ floor: 'execution', rooms: ['code-lab', 'testing-lab'] }],
        agentRoster: [{ name: 'Coder', role: 'developer', rooms: ['code-lab'] }],
        estimatedPhases: ['strategy', 'discovery', 'architecture', 'execution', 'review'],
      },
      buildingId,
      phase: 'strategy',
    });
    expect(stratExitDoc.ok).toBe(true);
    expect(stratExitDoc.data.raidEntryIds).toHaveLength(1);

    const stratExit = exitRoom({ roomId: stratRoomId, agentId });
    expect(stratExit.ok).toBe(true);

    // Create and sign off strategy gate → advance to discovery
    const stratGate = createGate({ buildingId, phase: 'strategy' });
    expect(stratGate.ok).toBe(true);
    const stratSignoff = await signoffGate({
      gateId: stratGate.data.id,
      reviewer: 'user',
      verdict: 'GO',
      exitDocId: stratExitDoc.data.id,
      nextPhaseInput: { projectGoals: ['Build task manager'] },
    });
    expect(stratSignoff.ok).toBe(true);

    // Verify phase advanced to discovery
    const building = memDb.prepare('SELECT active_phase FROM buildings WHERE id = ?').get(buildingId) as { active_phase: string };
    expect(building.active_phase).toBe('discovery');

    // ─── Phase 1: Discovery ───
    const discRoom = createRoom({ type: 'discovery', floorId: 'f_collab', name: 'Requirements' });
    expect(discRoom.ok).toBe(true);
    const discRoomId = discRoom.data.id;

    enterRoom({ roomId: discRoomId, agentId, tableType: 'collab' });

    const discExitDoc = await submitExitDocument({
      roomId: discRoomId,
      agentId,
      document: {
        businessOutcomes: ['Users can manage tasks'],
        constraints: ['2 week timeline'],
        unknowns: ['Performance requirements'],
        gapAnalysis: { current: 'No task system', target: 'Full CRUD', gaps: ['Backend API'] },
        riskAssessment: [{ risk: 'Tight deadline', analysis: 'High', citation: 'Team capacity' }],
        acceptanceCriteria: ['Create task', 'Update task', 'Delete task'],
      },
      buildingId,
      phase: 'discovery',
    });
    expect(discExitDoc.ok).toBe(true);

    exitRoom({ roomId: discRoomId, agentId });

    // Gate: discovery → architecture
    const discGate = createGate({ buildingId, phase: 'discovery' });
    await signoffGate({
      gateId: discGate.data.id,
      reviewer: 'architect',
      verdict: 'GO',
      exitDocId: discExitDoc.data.id,
      nextPhaseInput: { requirements: discExitDoc.data.id },
    });

    // ─── Phase 2: Architecture ───
    const archRoom = createRoom({ type: 'architecture', floorId: 'f_collab', name: 'Design' });
    const archRoomId = archRoom.data.id;
    enterRoom({ roomId: archRoomId, agentId, tableType: 'collab' });

    const archExitDoc = await submitExitDocument({
      roomId: archRoomId,
      agentId,
      document: {
        milestones: [{ name: 'API', criteria: ['endpoints work'], dependencies: [] }],
        taskBreakdown: [{ id: 't1', title: 'Build API', scope: { files: ['src/api.ts'] }, assignee: 'coder' }],
        dependencyGraph: { t1: [] },
        techDecisions: [{ decision: 'Use Express', reasoning: 'Simple', alternatives: ['Fastify'] }],
        fileAssignments: { 'src/api.ts': 't1' },
      },
      buildingId,
      phase: 'architecture',
    });
    expect(archExitDoc.ok).toBe(true);

    exitRoom({ roomId: archRoomId, agentId });

    // Gate: architecture → execution
    const archGate = createGate({ buildingId, phase: 'architecture' });
    await signoffGate({
      gateId: archGate.data.id,
      reviewer: 'architect',
      verdict: 'GO',
      exitDocId: archExitDoc.data.id,
      nextPhaseInput: { tasks: ['t1'] },
    });

    // ─── Phase 3: Execution (Code Lab) ───
    const codeRoom = createRoom({ type: 'code-lab', floorId: 'f_exec', name: 'Implementation' });
    const codeRoomId = codeRoom.data.id;
    enterRoom({ roomId: codeRoomId, agentId, tableType: 'focus' });

    const codeExitDoc = await submitExitDocument({
      roomId: codeRoomId,
      agentId,
      document: {
        filesModified: ['src/api.ts'],
        testsAdded: ['tests/api.test.ts'],
        changesDescription: 'Implemented CRUD endpoints',
        riskAssessment: 'Low — standard patterns',
      },
      buildingId,
      phase: 'execution',
    });
    expect(codeExitDoc.ok).toBe(true);

    exitRoom({ roomId: codeRoomId, agentId });

    // ─── Phase 3b: Execution (Testing Lab) ───
    const testRoom = createRoom({ type: 'testing-lab', floorId: 'f_exec', name: 'QA' });
    const testRoomId = testRoom.data.id;
    enterRoom({ roomId: testRoomId, agentId, tableType: 'focus' });

    const testExitDoc = await submitExitDocument({
      roomId: testRoomId,
      agentId,
      document: {
        testsRun: 15,
        testsPassed: 15,
        testsFailed: 0,
        coverage: { lines: 92, branches: 85 },
        lintErrors: 0,
        recommendations: ['All tests passing'],
      },
      buildingId,
      phase: 'execution',
    });
    expect(testExitDoc.ok).toBe(true);

    exitRoom({ roomId: testRoomId, agentId });

    // Gate: execution → review
    const execGate = createGate({ buildingId, phase: 'execution' });
    await signoffGate({
      gateId: execGate.data.id,
      reviewer: 'qa',
      verdict: 'GO',
      exitDocId: testExitDoc.data.id,
      nextPhaseInput: { testReport: testExitDoc.data.id },
    });

    // ─── Phase 4: Review ───
    const revRoom = createRoom({ type: 'review', floorId: 'f_gov', name: 'Gate Review' });
    const revRoomId = revRoom.data.id;
    enterRoom({ roomId: revRoomId, agentId, tableType: 'review' });

    const revExitDoc = await submitExitDocument({
      roomId: revRoomId,
      agentId,
      document: {
        verdict: 'GO',
        evidence: [{ claim: 'All tests pass', proof: '15/15', citation: 'QA report' }],
        conditions: [],
        riskQuestionnaire: [{ question: 'Data loss?', answer: 'No risk', risk: 'low' }],
      },
      buildingId,
      phase: 'review',
    });
    expect(revExitDoc.ok).toBe(true);

    exitRoom({ roomId: revRoomId, agentId });

    // Gate: review → deploy
    const revGate = createGate({ buildingId, phase: 'review' });
    await signoffGate({
      gateId: revGate.data.id,
      reviewer: 'architect',
      verdict: 'GO',
      exitDocId: revExitDoc.data.id,
    });

    // ─── Phase 5: Deploy ───
    const depRoom = createRoom({ type: 'deploy', floorId: 'f_ops', name: 'Production Deploy' });
    const depRoomId = depRoom.data.id;
    enterRoom({ roomId: depRoomId, agentId, tableType: 'focus' });

    const depExitDoc = await submitExitDocument({
      roomId: depRoomId,
      agentId,
      document: {
        environment: 'production',
        version: '1.0.0',
        deployedAt: new Date().toISOString(),
        healthCheck: { status: 'healthy', endpoints: ['/api/health'] },
        rollbackPlan: 'Revert to pre-deploy tag',
      },
      buildingId,
      phase: 'deploy',
    });
    expect(depExitDoc.ok).toBe(true);

    exitRoom({ roomId: depRoomId, agentId });

    // Gate: deploy (final)
    const depGate = createGate({ buildingId, phase: 'deploy' });
    await signoffGate({
      gateId: depGate.data.id,
      reviewer: 'ops',
      verdict: 'GO',
      exitDocId: depExitDoc.data.id,
    });

    // ─── VERIFY FULL LIFECYCLE ───

    // All gates should be GO
    const allGates = getGates(buildingId);
    expect(allGates.ok).toBe(true);
    const gateList = allGates.data as Array<{ status: string; phase: string }>;
    expect(gateList).toHaveLength(6);
    expect(gateList.every((g) => g.status === 'go')).toBe(true);

    // Building should be at final phase (deploy is last, no next phase)
    const finalBuilding = memDb.prepare('SELECT active_phase FROM buildings WHERE id = ?').get(buildingId) as { active_phase: string };
    // Deploy is the last phase in PHASE_ORDER, so active_phase stays at deploy
    expect(finalBuilding.active_phase).toBe('deploy');

    // RAID log should have entries for each exit document
    const raidResult = searchRaid({ buildingId });
    expect(raidResult.ok).toBe(true);
    const raidEntries = raidResult.data as Array<{ type: string; phase: string }>;
    expect(raidEntries.length).toBeGreaterThanOrEqual(6); // At least 1 per phase exit doc
    expect(raidEntries.filter((r) => r.type === 'decision').length).toBeGreaterThanOrEqual(6);

    // Exit documents should exist for all rooms
    const exitDocs = memDb.prepare('SELECT * FROM exit_documents').all() as Array<{ type: string; raid_entry_ids: string }>;
    expect(exitDocs).toHaveLength(7); // strat, disc, arch, code, test, review, deploy
    // Each exit doc with buildingId should have RAID entries linked
    const docsWithRaid = exitDocs.filter((d) => JSON.parse(d.raid_entry_ids).length > 0);
    expect(docsWithRaid).toHaveLength(7);
  });

  it('NO-GO verdict blocks phase advancement', async () => {
    // Uses top-level imports: createRoom, enterRoom, exitRoom, submitExitDocument

    // Create and enter a discovery room
    const room = createRoom({ type: 'discovery', floorId: 'f_collab', name: 'Blocked' });
    enterRoom({ roomId: room.data.id, agentId, tableType: 'collab' });

    await submitExitDocument({
      roomId: room.data.id,
      agentId,
      document: {
        businessOutcomes: ['Build X'],
        constraints: ['None'],
        unknowns: ['Everything'],
        gapAnalysis: { current: 'nothing', target: 'everything', gaps: ['all'] },
        riskAssessment: [{ risk: 'High', analysis: 'Too risky', citation: 'Common sense' }],
        acceptanceCriteria: ['Ship it'],
      },
      buildingId,
      phase: 'strategy', // still in strategy phase
    });

    exitRoom({ roomId: room.data.id, agentId });

    // Create gate and reject
    const gate = createGate({ buildingId, phase: 'strategy' });
    await signoffGate({
      gateId: gate.data.id,
      reviewer: 'architect',
      verdict: 'NO-GO',
      conditions: ['Requirements incomplete', 'Risk too high'],
    });

    // Building should NOT have advanced
    const building = memDb.prepare('SELECT active_phase FROM buildings WHERE id = ?').get(buildingId) as { active_phase: string };
    expect(building.active_phase).toBe('strategy');

    // canAdvance should return false
    const advance = canAdvance(buildingId);
    expect(advance.ok).toBe(true);
    expect(advance.data.canAdvance).toBe(false);
  });

  it('CONDITIONAL verdict does not auto-advance', async () => {
    const gate = createGate({ buildingId, phase: 'strategy' });
    await signoffGate({
      gateId: gate.data.id,
      reviewer: 'architect',
      verdict: 'CONDITIONAL',
      conditions: ['Fix security issue first'],
    });

    const building = memDb.prepare('SELECT active_phase FROM buildings WHERE id = ?').get(buildingId) as { active_phase: string };
    expect(building.active_phase).toBe('strategy');
  });

  it('scope change creates RAID issue and allows re-entry to prior phase room', async () => {
    // Uses top-level imports: createRoom, enterRoom, exitRoom, submitExitDocument

    // Start in architecture phase
    memDb.prepare("UPDATE buildings SET active_phase = 'architecture' WHERE id = ?").run(buildingId);

    const archRoom = createRoom({ type: 'architecture', floorId: 'f_collab', name: 'Design' });
    enterRoom({ roomId: archRoom.data.id, agentId, tableType: 'collab' });

    // Scope change detected — add RAID issue entry
    const raidResult = addRaidEntry({
      buildingId,
      type: 'issue',
      phase: 'architecture',
      roomId: archRoom.data.id,
      summary: 'Scope change: new requirement for real-time sync',
      rationale: 'User requested WebSocket support after initial design',
      decidedBy: agentId,
      affectedAreas: ['architecture', 'code-lab', 'testing-lab'],
    });
    expect(raidResult.ok).toBe(true);

    // Submit exit doc and exit architecture
    await submitExitDocument({
      roomId: archRoom.data.id,
      agentId,
      document: {
        milestones: [{ name: 'WS Support', criteria: ['Real-time'], dependencies: [] }],
        taskBreakdown: [{ id: 't1', title: 'Add WS server', scope: { files: ['src/ws.ts'] }, assignee: 'dev' }],
        dependencyGraph: {},
        techDecisions: [{ decision: 'Add WebSocket', reasoning: 'User req', alternatives: ['Polling'] }],
        fileAssignments: {},
      },
      buildingId,
      phase: 'architecture',
    });
    exitRoom({ roomId: archRoom.data.id, agentId });

    // Re-enter a discovery room for scope change re-evaluation
    const discRoom = createRoom({ type: 'discovery', floorId: 'f_collab', name: 'Scope Review' });
    const discEnter = enterRoom({ roomId: discRoom.data.id, agentId, tableType: 'collab' });
    expect(discEnter.ok).toBe(true);

    // Build context brief — agent entering discovery should see prior RAID context
    const brief = buildContextBrief(buildingId);
    expect(brief.ok).toBe(true);
    expect(brief.data.issues.length).toBeGreaterThan(0);
    expect(brief.data.issues[0].summary.toLowerCase()).toContain('scope change');

    // The agent can work in discovery with the RAID context
    await submitExitDocument({
      roomId: discRoom.data.id,
      agentId,
      document: {
        businessOutcomes: ['Real-time task updates'],
        constraints: ['Existing API must remain compatible'],
        unknowns: ['WebSocket scaling'],
        gapAnalysis: { current: 'REST only', target: 'REST + WS', gaps: ['WS server'] },
        riskAssessment: [{ risk: 'Breaking change', analysis: 'Medium', citation: 'API compat' }],
        acceptanceCriteria: ['WS connects', 'Events broadcast'],
      },
      buildingId,
      phase: 'discovery',
    });
    exitRoom({ roomId: discRoom.data.id, agentId });

    // Verify RAID log has both the issue and the exit doc decisions
    const allRaid = searchRaid({ buildingId });
    expect(allRaid.ok).toBe(true);
    const entries = allRaid.data as Array<{ type: string; summary: string }>;
    const issues = entries.filter((e) => e.type === 'issue');
    const decisions = entries.filter((e) => e.type === 'decision');
    expect(issues.length).toBeGreaterThanOrEqual(1);
    expect(decisions.length).toBeGreaterThanOrEqual(2); // arch + disc exit docs
  });

  it('exit doc RAID entries are linked back to exit document', async () => {
    // Uses top-level imports: createRoom, enterRoom, submitExitDocument

    const room = createRoom({ type: 'discovery', floorId: 'f_collab', name: 'RAID Link Test' });
    enterRoom({ roomId: room.data.id, agentId, tableType: 'collab' });

    const result = await submitExitDocument({
      roomId: room.data.id,
      agentId,
      document: {
        businessOutcomes: ['Test'],
        constraints: ['Test'],
        unknowns: ['Test'],
        gapAnalysis: { current: 'old', target: 'new', gaps: ['gap'] },
        riskAssessment: [{ risk: 'Test risk', analysis: 'Low', citation: 'N/A' }],
        acceptanceCriteria: ['Test'],
      },
      buildingId,
      phase: 'discovery',
    });
    expect(result.ok).toBe(true);
    expect(result.data.raidEntryIds).toHaveLength(1);

    // Verify the RAID entry exists in DB
    const raidId = result.data.raidEntryIds[0];
    const raidEntry = memDb.prepare('SELECT * FROM raid_entries WHERE id = ?').get(raidId) as { type: string; phase: string; room_id: string };
    expect(raidEntry).toBeDefined();
    expect(raidEntry.type).toBe('decision');
    expect(raidEntry.phase).toBe('discovery');
    expect(raidEntry.room_id).toBe(room.data.id);

    // Verify exit doc has the RAID entry ID stored
    const exitDoc = memDb.prepare('SELECT raid_entry_ids FROM exit_documents WHERE id = ?').get(result.data.id) as { raid_entry_ids: string };
    const linkedIds = JSON.parse(exitDoc.raid_entry_ids) as string[];
    expect(linkedIds).toContain(raidId);
  });

  it('previous phase nextPhaseInput is stored in gate record', async () => {
    const gate = createGate({ buildingId, phase: 'strategy' });
    const signoff = await signoffGate({
      gateId: gate.data.id,
      reviewer: 'user',
      verdict: 'GO',
      nextPhaseInput: { projectGoals: ['Build X'], constraints: ['Budget'] },
    });
    expect(signoff.ok).toBe(true);

    // Retrieve gate and check next_phase_input
    const gateRow = memDb.prepare('SELECT next_phase_input FROM phase_gates WHERE id = ?').get(gate.data.id) as { next_phase_input: string };
    const input = JSON.parse(gateRow.next_phase_input) as Record<string, unknown>;
    expect(input.projectGoals).toEqual(['Build X']);
    expect(input.constraints).toEqual(['Budget']);
  });
});
