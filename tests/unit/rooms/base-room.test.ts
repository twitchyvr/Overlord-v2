import { describe, it, expect, vi } from 'vitest';
import { BaseRoom } from '../../../src/rooms/room-types/base-room.js';
import { TestingLab } from '../../../src/rooms/room-types/testing-lab.js';
import { CodeLab } from '../../../src/rooms/room-types/code-lab.js';
import { DiscoveryRoom } from '../../../src/rooms/room-types/discovery.js';
import { ArchitectureRoom } from '../../../src/rooms/room-types/architecture.js';
import { ReviewRoom } from '../../../src/rooms/room-types/review.js';
import { DeployRoom } from '../../../src/rooms/room-types/deploy.js';
import { WarRoom } from '../../../src/rooms/room-types/war-room.js';
import { StrategistOffice } from '../../../src/rooms/room-types/strategist.js';
import type { Bus } from '../../../src/core/bus.js';

// Minimal mock bus for testing event emission
function mockBus(): Bus & { events: { event: string; data: unknown }[] } {
  const events: { event: string; data: unknown }[] = [];
  return {
    events,
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn((event: string, data: unknown) => {
      events.push({ event, data });
    }),
  } as unknown as Bus & { events: { event: string; data: unknown }[] };
}

// ─── BaseRoom Core ───

describe('BaseRoom', () => {
  it('returns allowed tools list', () => {
    const room = new BaseRoom('room_1');
    expect(room.getAllowedTools()).toEqual([]);
  });

  it('checks tool availability', () => {
    const room = new BaseRoom('room_1');
    expect(room.hasTool('write_file')).toBe(false);
  });

  it('validates exit document with no required fields', () => {
    const room = new BaseRoom('room_1');
    const result = room.validateExitDocument({ anything: true });
    expect(result.ok).toBe(true);
  });

  it('exposes escalation getter (empty by default)', () => {
    const room = new BaseRoom('room_1');
    expect(room.escalation).toEqual({});
  });

  it('exposes tables getter', () => {
    const room = new BaseRoom('room_1');
    expect(room.tables).toHaveProperty('focus');
    expect(room.tables.focus.chairs).toBe(1);
  });
});

// ─── Lifecycle Hooks ───

describe('BaseRoom lifecycle hooks', () => {
  it('onAgentEnter tracks agent and returns ok', () => {
    const room = new BaseRoom('room_1');
    const result = room.onAgentEnter('agent_1', 'focus');
    expect(result.ok).toBe(true);
    expect(room.agents.has('agent_1')).toBe(true);
  });

  it('onAgentExit removes agent and returns ok', () => {
    const room = new BaseRoom('room_1');
    room.onAgentEnter('agent_1', 'focus');
    expect(room.agents.has('agent_1')).toBe(true);

    const result = room.onAgentExit('agent_1');
    expect(result.ok).toBe(true);
    expect(room.agents.has('agent_1')).toBe(false);
  });

  it('onBeforeToolCall returns ok by default (no blocking)', () => {
    const room = new BaseRoom('room_1');
    const result = room.onBeforeToolCall('any_tool', 'agent_1', {});
    expect(result.ok).toBe(true);
  });

  it('onAfterToolCall is a no-op (does not throw)', () => {
    const room = new BaseRoom('room_1');
    expect(() => room.onAfterToolCall('any_tool', 'agent_1', { ok: true, data: null })).not.toThrow();
  });

  it('onMessage is a no-op (does not throw)', () => {
    const room = new BaseRoom('room_1');
    expect(() => room.onMessage('agent_1', 'hello', 'user')).not.toThrow();
  });
});

// ─── Bus Injection + Event Emission ───

describe('BaseRoom bus integration', () => {
  it('setBus injects bus and enables event emission', () => {
    const room = new BaseRoom('room_1');
    const bus = mockBus();
    room.setBus(bus);

    room.onAgentEnter('agent_1', 'focus');
    expect(bus.emit).toHaveBeenCalledWith('room:agent:entered', {
      roomId: 'room_1',
      roomType: 'base',
      agentId: 'agent_1',
      tableType: 'focus',
    });
  });

  it('onAgentExit emits room:agent:exited event', () => {
    const room = new BaseRoom('room_1');
    const bus = mockBus();
    room.setBus(bus);

    room.onAgentEnter('agent_1', 'focus');
    room.onAgentExit('agent_1');

    expect(bus.emit).toHaveBeenCalledWith('room:agent:exited', {
      roomId: 'room_1',
      roomType: 'base',
      agentId: 'agent_1',
    });
  });

  it('does not throw without bus (graceful no-op)', () => {
    const room = new BaseRoom('room_1');
    expect(() => room.onAgentEnter('agent_1', 'focus')).not.toThrow();
    expect(() => room.onAgentExit('agent_1')).not.toThrow();
  });
});

// ─── Two-Phase Exit Document Validation ───

describe('Two-phase exit document validation', () => {
  it('Phase 1: rejects missing fields', () => {
    const lab = new TestingLab('lab_1');
    const result = lab.validateExitDocument({ testsRun: 10 });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('EXIT_DOC_INCOMPLETE');
  });

  it('Phase 2: rejects invalid field VALUES even when all fields present', () => {
    const lab = new TestingLab('lab_1');
    const result = lab.validateExitDocument({
      testsRun: 0, // invalid: must be positive
      testsPassed: 0,
      testsFailed: 0,
      coverage: { lines: 80, branches: 70 },
      lintErrors: 0,
      recommendations: ['something'],
    });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('EXIT_DOC_INVALID');
  });

  it('accepts document that passes both phases', () => {
    const lab = new TestingLab('lab_1');
    const result = lab.validateExitDocument({
      testsRun: 10,
      testsPassed: 8,
      testsFailed: 2,
      coverage: { lines: 85, branches: 70 },
      lintErrors: 0,
      recommendations: ['Fix failing tests'],
    });
    expect(result.ok).toBe(true);
  });
});

// ─── Context Injection ───

describe('BaseRoom context injection', () => {
  it('buildContextInjection includes escalation and outputFormat', () => {
    const lab = new TestingLab('lab_1');
    const context = lab.buildContextInjection();

    expect(context.roomType).toBe('testing-lab');
    expect(context.rules).toBeDefined();
    expect((context.rules as string[]).length).toBeGreaterThan(0);
    expect(context.tools).toBeDefined();
    expect(context.fileScope).toBe('read-only');
    expect(context.exitTemplate).toBeDefined();
    expect(context.outputFormat).toBeDefined();
    expect(context.escalation).toEqual({ onFailure: 'code-lab', onCritical: 'war-room' });
  });
});

// ─── TestingLab ───

describe('TestingLab', () => {
  it('does NOT include write_file in tools (structural enforcement)', () => {
    const lab = new TestingLab('lab_1');
    expect(lab.hasTool('write_file')).toBe(false);
    expect(lab.hasTool('patch_file')).toBe(false);
  });

  it('includes QA tools', () => {
    const lab = new TestingLab('lab_1');
    expect(lab.hasTool('qa_run_tests')).toBe(true);
    expect(lab.hasTool('qa_check_lint')).toBe(true);
    expect(lab.hasTool('read_file')).toBe(true);
  });

  it('has read-only file scope', () => {
    const lab = new TestingLab('lab_1');
    expect(lab.fileScope).toBe('read-only');
  });

  it('requires test report exit document', () => {
    const lab = new TestingLab('lab_1');
    expect(lab.exitRequired.type).toBe('test-report');
    expect(lab.exitRequired.fields).toContain('testsRun');
    expect(lab.exitRequired.fields).toContain('testsPassed');
  });

  it('validates incomplete exit document', () => {
    const lab = new TestingLab('lab_1');
    const result = lab.validateExitDocument({ testsRun: 10 });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('EXIT_DOC_INCOMPLETE');
  });

  it('validates complete exit document', () => {
    const lab = new TestingLab('lab_1');
    const result = lab.validateExitDocument({
      testsRun: 10,
      testsPassed: 8,
      testsFailed: 2,
      coverage: { lines: 85, branches: 70 },
      lintErrors: 0,
      recommendations: ['Fix failing tests'],
    });
    expect(result.ok).toBe(true);
  });

  it('rejects testsRun = 0', () => {
    const lab = new TestingLab('lab_1');
    const result = lab.validateExitDocumentValues({
      testsRun: 0,
      testsPassed: 0,
      testsFailed: 0,
      coverage: {},
      lintErrors: 0,
      recommendations: ['x'],
    });
    expect(result.ok).toBe(false);
    expect(result.error?.message).toContain('testsRun');
  });

  it('rejects testsPassed + testsFailed != testsRun', () => {
    const lab = new TestingLab('lab_1');
    const result = lab.validateExitDocumentValues({
      testsRun: 10,
      testsPassed: 5,
      testsFailed: 3, // 5 + 3 = 8, not 10
      coverage: {},
      lintErrors: 0,
      recommendations: ['x'],
    });
    expect(result.ok).toBe(false);
    expect(result.error?.message).toContain('must equal');
  });

  it('rejects empty recommendations', () => {
    const lab = new TestingLab('lab_1');
    const result = lab.validateExitDocumentValues({
      testsRun: 1,
      testsPassed: 1,
      testsFailed: 0,
      coverage: {},
      lintErrors: 0,
      recommendations: [],
    });
    expect(result.ok).toBe(false);
    expect(result.error?.message).toContain('recommendations');
  });

  it('onAfterToolCall emits escalation on qa_run_tests failure', () => {
    const lab = new TestingLab('lab_1');
    const bus = mockBus();
    lab.setBus(bus);

    lab.onAfterToolCall('qa_run_tests', 'agent_1', {
      ok: false,
      error: { code: 'TEST_FAIL', message: 'Tests failed' },
    });

    expect(bus.events).toHaveLength(1);
    expect(bus.events[0].event).toBe('room:escalation:suggested');
    const data = bus.events[0].data as Record<string, unknown>;
    expect(data.targetRoom).toBe('code-lab');
    expect(data.condition).toBe('onFailure');
  });

  it('onAfterToolCall does NOT emit on success', () => {
    const lab = new TestingLab('lab_1');
    const bus = mockBus();
    lab.setBus(bus);

    lab.onAfterToolCall('qa_run_tests', 'agent_1', { ok: true, data: {} });
    expect(bus.events).toHaveLength(0);
  });

  it('onAfterToolCall ignores unrelated tools', () => {
    const lab = new TestingLab('lab_1');
    const bus = mockBus();
    lab.setBus(bus);

    lab.onAfterToolCall('read_file', 'agent_1', {
      ok: false,
      error: { code: 'READ_FAIL', message: 'Failed' },
    });
    expect(bus.events).toHaveLength(0);
  });
});

// ─── CodeLab ───

describe('CodeLab', () => {
  it('includes write_file in tools', () => {
    const lab = new CodeLab('codelab_1');
    expect(lab.hasTool('write_file')).toBe(true);
    expect(lab.hasTool('patch_file')).toBe(true);
    expect(lab.hasTool('bash')).toBe(true);
  });

  it('has assigned file scope', () => {
    const lab = new CodeLab('codelab_1');
    expect(lab.fileScope).toBe('assigned');
  });

  it('testing-lab and code-lab have different write access', () => {
    const testLab = new TestingLab('test_1');
    const codeLab = new CodeLab('code_1');
    expect(testLab.hasTool('write_file')).toBe(false);
    expect(codeLab.hasTool('write_file')).toBe(true);
  });

  it('rejects empty filesModified', () => {
    const lab = new CodeLab('codelab_1');
    const result = lab.validateExitDocumentValues({
      filesModified: [],
      testsAdded: [],
      changesDescription: 'did stuff',
      riskAssessment: 'low',
    });
    expect(result.ok).toBe(false);
    expect(result.error?.message).toContain('filesModified');
  });

  it('rejects empty changesDescription', () => {
    const lab = new CodeLab('codelab_1');
    const result = lab.validateExitDocumentValues({
      filesModified: ['file.ts'],
      testsAdded: [],
      changesDescription: '  ', // whitespace only
      riskAssessment: 'low',
    });
    expect(result.ok).toBe(false);
    expect(result.error?.message).toContain('changesDescription');
  });

  it('accepts valid implementation report', () => {
    const lab = new CodeLab('codelab_1');
    const result = lab.validateExitDocumentValues({
      filesModified: ['src/foo.ts'],
      testsAdded: ['tests/foo.test.ts'],
      changesDescription: 'Implemented feature X',
      riskAssessment: 'Low — isolated change',
    });
    expect(result.ok).toBe(true);
  });

  it('onAfterToolCall emits escalation on write_file failure', () => {
    const lab = new CodeLab('codelab_1');
    const bus = mockBus();
    lab.setBus(bus);

    lab.onAfterToolCall('write_file', 'agent_1', {
      ok: false,
      error: { code: 'WRITE_FAIL', message: 'Permission denied' },
    });

    expect(bus.events).toHaveLength(1);
    expect(bus.events[0].event).toBe('room:escalation:suggested');
    const data = bus.events[0].data as Record<string, unknown>;
    expect(data.targetRoom).toBe('war-room');
  });
});

// ─── DiscoveryRoom ───

describe('DiscoveryRoom', () => {
  it('has read-only file scope and collaboration tools', () => {
    const room = new DiscoveryRoom('disc_1');
    expect(room.fileScope).toBe('read-only');
    expect(room.hasTool('web_search')).toBe(true);
    expect(room.hasTool('write_file')).toBe(false);
  });

  it('rejects empty businessOutcomes', () => {
    const room = new DiscoveryRoom('disc_1');
    const result = room.validateExitDocumentValues({
      businessOutcomes: [],
      constraints: ['c'],
      unknowns: ['u'],
      gapAnalysis: {},
      riskAssessment: [{ risk: 'r' }],
      acceptanceCriteria: ['ac'],
    });
    expect(result.ok).toBe(false);
    expect(result.error?.message).toContain('businessOutcomes');
  });

  it('rejects empty acceptanceCriteria', () => {
    const room = new DiscoveryRoom('disc_1');
    const result = room.validateExitDocumentValues({
      businessOutcomes: ['bo'],
      constraints: ['c'],
      unknowns: ['u'],
      gapAnalysis: {},
      riskAssessment: [{ risk: 'r' }],
      acceptanceCriteria: [],
    });
    expect(result.ok).toBe(false);
    expect(result.error?.message).toContain('acceptanceCriteria');
  });

  it('accepts valid requirements document', () => {
    const room = new DiscoveryRoom('disc_1');
    const result = room.validateExitDocumentValues({
      businessOutcomes: ['Build feature X'],
      constraints: ['Budget: $0'],
      unknowns: ['API limits'],
      gapAnalysis: { current: 'nothing', target: 'everything', gaps: ['all'] },
      riskAssessment: [{ risk: 'Timeline', analysis: 'Tight', citation: 'PM said so' }],
      acceptanceCriteria: ['Tests pass'],
    });
    expect(result.ok).toBe(true);
  });
});

// ─── ArchitectureRoom ───

describe('ArchitectureRoom', () => {
  it('has read-only scope and collaboration tools', () => {
    const room = new ArchitectureRoom('arch_1');
    expect(room.fileScope).toBe('read-only');
    expect(room.hasTool('write_file')).toBe(false);
  });

  it('rejects empty milestones', () => {
    const room = new ArchitectureRoom('arch_1');
    const result = room.validateExitDocumentValues({
      milestones: [],
      taskBreakdown: [{ id: 't1' }],
      dependencyGraph: {},
      techDecisions: [{ decision: 'd' }],
      fileAssignments: {},
    });
    expect(result.ok).toBe(false);
    expect(result.error?.message).toContain('milestones');
  });

  it('accepts valid architecture document', () => {
    const room = new ArchitectureRoom('arch_1');
    const result = room.validateExitDocumentValues({
      milestones: [{ name: 'M1', criteria: ['done'] }],
      taskBreakdown: [{ id: 't1', title: 'Task 1' }],
      dependencyGraph: { t1: [] },
      techDecisions: [{ decision: 'Use TS', reasoning: 'Type safety' }],
      fileAssignments: { t1: ['src/foo.ts'] },
    });
    expect(result.ok).toBe(true);
  });
});

// ─── ReviewRoom ───

describe('ReviewRoom', () => {
  it('has read-only scope and governance tools', () => {
    const room = new ReviewRoom('review_1');
    expect(room.fileScope).toBe('read-only');
    expect(room.hasTool('qa_run_tests')).toBe(true);
    expect(room.hasTool('write_file')).toBe(false);
  });

  it('rejects invalid verdict', () => {
    const room = new ReviewRoom('review_1');
    const result = room.validateExitDocumentValues({
      verdict: 'MAYBE',
      evidence: [{ claim: 'c', proof: 'p' }],
      conditions: [],
      riskQuestionnaire: [{ q: 'q', a: 'a' }],
    });
    expect(result.ok).toBe(false);
    expect(result.error?.message).toContain('verdict');
  });

  it('accepts GO verdict with evidence', () => {
    const room = new ReviewRoom('review_1');
    const result = room.validateExitDocumentValues({
      verdict: 'GO',
      evidence: [{ claim: 'Tests pass', proof: '100%', citation: 'test-report.json' }],
      conditions: [],
      riskQuestionnaire: [{ question: 'Risk?', answer: 'Low', risk: 'low' }],
    });
    expect(result.ok).toBe(true);
  });

  it('accepts NO-GO verdict', () => {
    const room = new ReviewRoom('review_1');
    const result = room.validateExitDocumentValues({
      verdict: 'NO-GO',
      evidence: [{ claim: 'c' }],
      conditions: [],
      riskQuestionnaire: [{ q: 'q' }],
    });
    expect(result.ok).toBe(true);
  });

  it('accepts CONDITIONAL verdict with non-empty conditions', () => {
    const room = new ReviewRoom('review_1');
    const result = room.validateExitDocumentValues({
      verdict: 'CONDITIONAL',
      evidence: [{ claim: 'c' }],
      conditions: ['Fix lint errors before deploy'],
      riskQuestionnaire: [{ q: 'q' }],
    });
    expect(result.ok).toBe(true);
  });

  it('onAfterToolCall emits escalation on QA failure', () => {
    const room = new ReviewRoom('review_1');
    const bus = mockBus();
    room.setBus(bus);

    room.onAfterToolCall('qa_run_tests', 'agent_1', {
      ok: false,
      error: { code: 'TEST_FAIL', message: 'Tests failed' },
    });

    expect(bus.events).toHaveLength(1);
    const data = bus.events[0].data as Record<string, unknown>;
    expect(data.targetRoom).toBe('code-lab');
  });
});

// ─── DeployRoom ───

describe('DeployRoom', () => {
  it('has read-only scope', () => {
    const room = new DeployRoom('deploy_1');
    expect(room.fileScope).toBe('read-only');
  });

  it('rejects empty rollbackPlan', () => {
    const room = new DeployRoom('deploy_1');
    const result = room.validateExitDocumentValues({
      environment: 'prod',
      version: '1.0.0',
      deployedAt: '2026-01-01',
      healthCheck: { status: 'ok', endpoints: ['/api'] },
      rollbackPlan: '', // empty
    });
    expect(result.ok).toBe(false);
    expect(result.error?.message).toContain('rollbackPlan');
  });

  it('rejects non-object healthCheck', () => {
    const room = new DeployRoom('deploy_1');
    const result = room.validateExitDocumentValues({
      environment: 'prod',
      version: '1.0.0',
      deployedAt: '2026-01-01',
      healthCheck: 'ok', // not an object
      rollbackPlan: 'git revert',
    });
    expect(result.ok).toBe(false);
    expect(result.error?.message).toContain('healthCheck');
  });

  it('accepts valid deployment report', () => {
    const room = new DeployRoom('deploy_1');
    const result = room.validateExitDocumentValues({
      environment: 'production',
      version: '2.1.0',
      deployedAt: '2026-03-11T10:00:00Z',
      healthCheck: { status: 'healthy', endpoints: ['/api/health'] },
      rollbackPlan: 'git revert abc123',
    });
    expect(result.ok).toBe(true);
  });

  it('onAfterToolCall emits war-room escalation on deployment failure', () => {
    const room = new DeployRoom('deploy_1');
    const bus = mockBus();
    room.setBus(bus);

    room.onAfterToolCall('bash', 'agent_1', {
      ok: false,
      error: { code: 'DEPLOY_FAIL', message: 'Deployment failed' },
    });

    expect(bus.events).toHaveLength(1);
    const data = bus.events[0].data as Record<string, unknown>;
    expect(data.targetRoom).toBe('war-room');
    expect(data.condition).toBe('onFailure');
  });
});

// ─── WarRoom ───

describe('WarRoom', () => {
  it('has full file scope (elevated access)', () => {
    const room = new WarRoom('war_1');
    expect(room.fileScope).toBe('full');
  });

  it('has no escalation targets (it IS the top)', () => {
    const room = new WarRoom('war_1');
    expect(room.escalation).toEqual({});
  });

  it('has 8-chair boardroom table', () => {
    const room = new WarRoom('war_1');
    expect(room.tables.boardroom.chairs).toBe(8);
  });

  it('rejects empty rootCause', () => {
    const room = new WarRoom('war_1');
    const result = room.validateExitDocumentValues({
      incidentSummary: 'thing broke',
      rootCause: '', // empty
      resolution: 'fixed it',
      preventionPlan: ['add tests'],
      timeToResolve: '30min',
    });
    expect(result.ok).toBe(false);
    expect(result.error?.message).toContain('rootCause');
  });

  it('rejects empty preventionPlan', () => {
    const room = new WarRoom('war_1');
    const result = room.validateExitDocumentValues({
      incidentSummary: 'thing broke',
      rootCause: 'null pointer',
      resolution: 'added check',
      preventionPlan: [], // empty
      timeToResolve: '30min',
    });
    expect(result.ok).toBe(false);
    expect(result.error?.message).toContain('preventionPlan');
  });

  it('accepts valid incident report', () => {
    const room = new WarRoom('war_1');
    const result = room.validateExitDocumentValues({
      incidentSummary: 'Production outage',
      rootCause: 'DB connection pool exhausted',
      resolution: 'Increased pool size + added circuit breaker',
      preventionPlan: ['Add pool monitoring', 'Set up alerts'],
      timeToResolve: '45 minutes',
    });
    expect(result.ok).toBe(true);
  });
});

// ─── StrategistOffice ───

describe('StrategistOffice', () => {
  it('has read-only scope and consultation table', () => {
    const room = new StrategistOffice('strat_1');
    expect(room.fileScope).toBe('read-only');
    expect(room.tables.consultation.chairs).toBe(2);
  });

  it('rejects empty projectGoals', () => {
    const room = new StrategistOffice('strat_1');
    const result = room.validateExitDocumentValues({
      projectGoals: [],
      successCriteria: ['sc'],
      floorsNeeded: ['execution'],
      roomConfig: [{ floor: 'execution', rooms: ['code-lab'] }],
      agentRoster: [{ name: 'Dev', role: 'developer', rooms: ['code-lab'] }],
      estimatedPhases: ['Phase 1'],
    });
    expect(result.ok).toBe(false);
    expect(result.error?.message).toContain('projectGoals');
  });

  it('rejects empty agentRoster', () => {
    const room = new StrategistOffice('strat_1');
    const result = room.validateExitDocumentValues({
      projectGoals: ['Build X'],
      successCriteria: ['sc'],
      floorsNeeded: ['execution'],
      roomConfig: [{ floor: 'execution', rooms: ['code-lab'] }],
      agentRoster: [],
      estimatedPhases: ['Phase 1'],
    });
    expect(result.ok).toBe(false);
    expect(result.error?.message).toContain('agentRoster');
  });

  it('accepts valid building blueprint', () => {
    const room = new StrategistOffice('strat_1');
    const result = room.validateExitDocumentValues({
      projectGoals: ['Build a REST API'],
      successCriteria: ['All endpoints respond <200ms'],
      floorsNeeded: ['execution', 'governance'],
      roomConfig: [{ floor: 'execution', rooms: ['code-lab', 'testing-lab'] }],
      agentRoster: [{ name: 'Coder', role: 'developer', rooms: ['code-lab'] }],
      estimatedPhases: ['Phase 1: Foundation', 'Phase 2: Features'],
    });
    expect(result.ok).toBe(true);
  });
});
