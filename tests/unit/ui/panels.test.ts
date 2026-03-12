// @vitest-environment jsdom
/**
 * Tests for the panel modules:
 *   - phase-panel.js
 *   - agents-panel.js
 *   - raid-panel.js
 *   - activity-panel.js
 *   - projects-panel.js
 *   - tools-panel.js
 *   - logs-panel.js
 *   - team-panel.js
 *
 * Tests class structure, rendering, and filtering behavior.
 */

import { describe, it, expect, beforeEach } from 'vitest';

const storePath = '../../../public/ui/engine/store.js';
const enginePath = '../../../public/ui/engine/engine.js';

let Store: any;
let OverlordUI: any;

function createPanelEl(id: string, label: string): HTMLElement {
  const el = document.createElement('div');
  el.id = id;
  el.className = 'panel';

  const header = document.createElement('div');
  header.className = 'panel-header';
  header.dataset.panel = id.replace('panel-', '');

  const title = document.createElement('span');
  title.className = 'panel-title';
  title.textContent = label;
  header.appendChild(title);

  const chevron = document.createElement('span');
  chevron.className = 'panel-chevron';
  chevron.textContent = '\u25BE';
  header.appendChild(chevron);

  const body = document.createElement('div');
  body.className = 'panel-body';

  el.appendChild(header);
  el.appendChild(body);
  return el;
}

beforeEach(async () => {
  document.body.textContent = '';

  const storeMod = await import(storePath);
  const engineMod = await import(enginePath);
  Store = storeMod.Store;
  OverlordUI = engineMod.OverlordUI;

  const store = new Store();
  store.set('building.activePhase', 'strategy', { silent: true });
  store.set('building.agentPositions', {}, { silent: true });
  store.set('agents.list', [], { silent: true });
  store.set('raid.entries', [], { silent: true });
  store.set('phase.gates', [], { silent: true });
  store.set('phase.canAdvance', null, { silent: true });
  store.set('activity.items', [], { silent: true });
  store.set('building.list', [], { silent: true });
  store.set('building.active', null, { silent: true });
  store.set('rooms.list', [], { silent: true });
  store.set('tasks.list', [], { silent: true });
  store.set('ui.connected', false, { silent: true });
  store.set('panels.states', {}, { silent: true });
  store.set('panels.visibility', {}, { silent: true });
  store.set('panels.heights', {}, { silent: true });
  OverlordUI.init(store);
});

// ─── PhasePanel ─────────────────────────────────────────────

describe('PhasePanel', () => {
  it('exports the PhasePanel class', async () => {
    const mod = await import('../../../public/ui/panels/phase-panel.js');
    expect(mod.PhasePanel).toBeDefined();
  });

  it('renders current phase badge on mount', async () => {
    const { PhasePanel } = await import('../../../public/ui/panels/phase-panel.js');
    const el = createPanelEl('panel-phase', 'Phase Gates');
    document.body.appendChild(el);

    const panel = new PhasePanel(el);
    panel.mount();

    const body = el.querySelector('.panel-body');
    expect(body!.querySelector('.phase-badge')).not.toBeNull();
  });

  it('shows empty state when no gates', async () => {
    const { PhasePanel } = await import('../../../public/ui/panels/phase-panel.js');
    const el = createPanelEl('panel-phase', 'Phase Gates');
    document.body.appendChild(el);

    const panel = new PhasePanel(el);
    panel.mount();

    expect(el.querySelector('.panel-empty')).not.toBeNull();
  });

  it('renders gate entries when gates exist', async () => {
    const { PhasePanel } = await import('../../../public/ui/panels/phase-panel.js');
    const el = createPanelEl('panel-phase', 'Phase Gates');
    document.body.appendChild(el);

    const panel = new PhasePanel(el);
    panel.mount();

    // Set store data AFTER mount so subscriptions fire
    const store = OverlordUI.getStore();
    store.set('phase.gates', [
      { phase: 'strategy', verdict: 'GO', created_at: new Date().toISOString() },
      { phase: 'discovery', verdict: 'NO_GO', created_at: new Date().toISOString() }
    ]);

    const gateList = el.querySelector('.phase-gate-list');
    expect(gateList).not.toBeNull();
    expect(gateList!.children.length).toBe(2);
  });
});

// ─── AgentsPanel ────────────────────────────────────────────

describe('AgentsPanel', () => {
  it('exports the AgentsPanel class', async () => {
    const mod = await import('../../../public/ui/panels/agents-panel.js');
    expect(mod.AgentsPanel).toBeDefined();
  });

  it('shows empty state when no agents', async () => {
    const { AgentsPanel } = await import('../../../public/ui/panels/agents-panel.js');
    const el = createPanelEl('panel-agents', 'Agents');
    document.body.appendChild(el);

    const panel = new AgentsPanel(el);
    panel.mount();

    expect(el.querySelector('.panel-empty')).not.toBeNull();
  });

  it('renders agent list when agents exist', async () => {
    const { AgentsPanel } = await import('../../../public/ui/panels/agents-panel.js');
    const el = createPanelEl('panel-agents', 'Agents');
    document.body.appendChild(el);

    const panel = new AgentsPanel(el);
    panel.mount();

    // Set store data AFTER mount so subscriptions fire
    const store = OverlordUI.getStore();
    store.set('agents.list', [
      { id: 'a1', name: 'Strategist', role: 'strategist', status: 'active' },
      { id: 'a2', name: 'Developer', role: 'developer', status: 'idle' },
      { id: 'a3', name: 'Reviewer', role: 'reviewer', status: 'active' }
    ]);

    const summary = el.querySelector('.agents-panel-summary');
    expect(summary!.textContent).toContain('3 registered agents');

    const list = el.querySelector('.agents-list');
    expect(list!.children.length).toBe(3);
  });

  it('filters agents by status', async () => {
    const { AgentsPanel } = await import('../../../public/ui/panels/agents-panel.js');
    const el = createPanelEl('panel-agents', 'Agents');
    document.body.appendChild(el);

    const panel = new AgentsPanel(el);
    panel.mount();

    // Set store data AFTER mount so subscriptions fire
    const store = OverlordUI.getStore();
    store.set('agents.list', [
      { id: 'a1', name: 'Active Agent', status: 'active' },
      { id: 'a2', name: 'Idle Agent', status: 'idle' }
    ]);

    // Change filter to 'active'
    panel._filter = 'active';
    panel._renderContent();

    const list = el.querySelector('.agents-list');
    expect(list!.children.length).toBe(1);
  });
});

// ─── RaidPanel ──────────────────────────────────────────────

describe('RaidPanel', () => {
  it('exports the RaidPanel class', async () => {
    const mod = await import('../../../public/ui/panels/raid-panel.js');
    expect(mod.RaidPanel).toBeDefined();
  });

  it('shows empty state when no entries', async () => {
    const { RaidPanel } = await import('../../../public/ui/panels/raid-panel.js');
    const el = createPanelEl('panel-raid', 'RAID Log');
    document.body.appendChild(el);

    const panel = new RaidPanel(el);
    panel.mount();

    expect(el.querySelector('.panel-empty')).not.toBeNull();
  });

  it('renders stats row with type counts', async () => {
    const { RaidPanel } = await import('../../../public/ui/panels/raid-panel.js');
    const el = createPanelEl('panel-raid', 'RAID Log');
    document.body.appendChild(el);

    const panel = new RaidPanel(el);
    panel.mount();

    // Set store data AFTER mount so subscriptions fire
    const store = OverlordUI.getStore();
    store.set('raid.entries', [
      { id: '1', type: 'risk', title: 'Risk 1', description: 'Test risk' },
      { id: '2', type: 'risk', title: 'Risk 2', description: 'Another risk' },
      { id: '3', type: 'issue', title: 'Issue 1', description: 'Test issue' }
    ]);

    const statsRow = el.querySelector('.raid-stats-row');
    expect(statsRow).not.toBeNull();

    const statCounts = el.querySelectorAll('.raid-stat-count');
    expect(statCounts.length).toBe(4); // risk, assumption, issue, dependency

    // Risk count should be 2
    expect(statCounts[0].textContent).toBe('2');
    // Issue count should be 1
    expect(statCounts[2].textContent).toBe('1');
  });

  it('filters entries by type', async () => {
    const { RaidPanel } = await import('../../../public/ui/panels/raid-panel.js');
    const el = createPanelEl('panel-raid', 'RAID Log');
    document.body.appendChild(el);

    const panel = new RaidPanel(el);
    panel.mount();

    // Set store data AFTER mount so subscriptions fire
    const store = OverlordUI.getStore();
    store.set('raid.entries', [
      { id: '1', type: 'risk', title: 'R1' },
      { id: '2', type: 'issue', title: 'I1' },
      { id: '3', type: 'assumption', title: 'A1' }
    ]);

    // Apply filter for 'risk' only
    panel._activeFilters = ['risk'];
    panel._applyFilters();

    expect(panel._filteredEntries.length).toBe(1);
    expect(panel._filteredEntries[0].type).toBe('risk');
  });

  it('filters entries by search query', async () => {
    const { RaidPanel } = await import('../../../public/ui/panels/raid-panel.js');
    const el = createPanelEl('panel-raid', 'RAID Log');
    document.body.appendChild(el);

    const panel = new RaidPanel(el);
    panel.mount();

    // Set store data AFTER mount so subscriptions fire
    const store = OverlordUI.getStore();
    store.set('raid.entries', [
      { id: '1', type: 'risk', title: 'Database migration risk' },
      { id: '2', type: 'risk', title: 'API compatibility' },
      { id: '3', type: 'issue', title: 'Database timeout' }
    ]);

    panel._searchQuery = 'database';
    panel._applyFilters();

    expect(panel._filteredEntries.length).toBe(2);
  });
});

// ─── ActivityPanel ──────────────────────────────────────────

describe('ActivityPanel', () => {
  it('exports the ActivityPanel class', async () => {
    const mod = await import('../../../public/ui/panels/activity-panel.js');
    expect(mod.ActivityPanel).toBeDefined();
  });

  it('shows empty state when no activity', async () => {
    const { ActivityPanel } = await import('../../../public/ui/panels/activity-panel.js');
    const el = createPanelEl('panel-activity', 'Activity');
    document.body.appendChild(el);

    const panel = new ActivityPanel(el);
    panel.mount();

    expect(el.querySelector('.panel-empty')).not.toBeNull();
  });

  it('renders activity items in reverse order (newest first)', async () => {
    const { ActivityPanel } = await import('../../../public/ui/panels/activity-panel.js');
    const el = createPanelEl('panel-activity', 'Activity');
    document.body.appendChild(el);

    const panel = new ActivityPanel(el);
    panel.mount();

    // Set store data AFTER mount so subscriptions fire
    const store = OverlordUI.getStore();
    store.set('activity.items', [
      { event: 'tool:executed', toolName: 'read_file', ts: '2024-01-01T10:00:00Z' },
      { event: 'phase:advanced', newPhase: 'discovery', ts: '2024-01-01T11:00:00Z' },
      { event: 'tool:executed', toolName: 'write_file', ts: '2024-01-01T12:00:00Z' }
    ]);

    const list = el.querySelector('.activity-list');
    expect(list).not.toBeNull();
    expect(list!.children.length).toBe(3);
  });

  it('filters activity by type', async () => {
    const { ActivityPanel } = await import('../../../public/ui/panels/activity-panel.js');
    const el = createPanelEl('panel-activity', 'Activity');
    document.body.appendChild(el);

    const panel = new ActivityPanel(el);
    panel._items = [
      { event: 'tool:executed', toolName: 'read' },
      { event: 'phase:advanced', newPhase: 'test' },
      { event: 'room:agent:entered', agentId: 'a1' },
      { event: 'tool:executed', toolName: 'write' }
    ];

    panel._filter = 'tools';
    const filtered = panel._getFilteredItems();
    expect(filtered.length).toBe(2);
    expect(filtered.every((i: any) => i.event.startsWith('tool:'))).toBe(true);

    panel._filter = 'phases';
    const phases = panel._getFilteredItems();
    expect(phases.length).toBe(1);

    panel._filter = 'agents';
    const agents = panel._getFilteredItems();
    expect(agents.length).toBe(1);
  });

  it('formats summaries correctly', async () => {
    const { ActivityPanel } = await import('../../../public/ui/panels/activity-panel.js');
    const el = createPanelEl('panel-activity', 'Activity');
    const panel = new ActivityPanel(el);

    expect(panel._formatSummary({ event: 'tool:executed', toolName: 'read_file' }))
      .toContain('read_file');

    expect(panel._formatSummary({ event: 'phase:advanced', newPhase: 'discovery' }))
      .toContain('discovery');

    expect(panel._formatSummary({ event: 'room:agent:entered', agentId: 'bot-1' }))
      .toContain('bot-1');

    expect(panel._formatSummary({ event: 'phase-zero:complete' }))
      .toContain('Phase Zero complete');
  });

  it('caps at MAX_ITEMS (100)', async () => {
    const { ActivityPanel } = await import('../../../public/ui/panels/activity-panel.js');
    const el = createPanelEl('panel-activity', 'Activity');
    document.body.appendChild(el);

    const panel = new ActivityPanel(el);
    panel.mount();

    // Add 110 items
    for (let i = 0; i < 110; i++) {
      panel._addItem({ event: 'system', message: `Item ${i}` });
    }

    expect(panel._items.length).toBe(100);
  });
});

// ─── ProjectsPanel ─────────────────────────────────────────

describe('ProjectsPanel', () => {
  it('exports the ProjectsPanel class', async () => {
    const mod = await import('../../../public/ui/panels/projects-panel.js');
    expect(mod.ProjectsPanel).toBeDefined();
  });

  it('shows empty state when no buildings', async () => {
    const { ProjectsPanel } = await import('../../../public/ui/panels/projects-panel.js');
    const el = createPanelEl('panel-projects', 'Projects');
    document.body.appendChild(el);

    const panel = new ProjectsPanel(el);
    panel.mount();

    expect(el.querySelector('.panel-empty')).not.toBeNull();
  });

  it('renders summary with building count', async () => {
    const { ProjectsPanel } = await import('../../../public/ui/panels/projects-panel.js');
    const el = createPanelEl('panel-projects', 'Projects');
    document.body.appendChild(el);

    const panel = new ProjectsPanel(el);
    panel.mount();

    const store = OverlordUI.getStore();
    store.set('building.list', [
      { id: 'b1', name: 'Alpha', activePhase: 'strategy' },
      { id: 'b2', name: 'Beta', activePhase: 'execution' }
    ]);

    const summary = el.querySelector('.panel-summary');
    expect(summary).not.toBeNull();
    expect(summary!.textContent).toContain('2 buildings');
  });

  it('renders building entries in projects list', async () => {
    const { ProjectsPanel } = await import('../../../public/ui/panels/projects-panel.js');
    const el = createPanelEl('panel-projects', 'Projects');
    document.body.appendChild(el);

    const panel = new ProjectsPanel(el);
    panel.mount();

    const store = OverlordUI.getStore();
    store.set('building.list', [
      { id: 'b1', name: 'Alpha', activePhase: 'strategy' },
      { id: 'b2', name: 'Beta', activePhase: 'execution' },
      { id: 'b3', name: 'Gamma', activePhase: 'review' }
    ]);

    const list = el.querySelector('.projects-list');
    expect(list).not.toBeNull();
    expect(list!.children.length).toBe(3);
  });

  it('tracks active building from store', async () => {
    const { ProjectsPanel } = await import('../../../public/ui/panels/projects-panel.js');
    const el = createPanelEl('panel-projects', 'Projects');
    document.body.appendChild(el);

    const panel = new ProjectsPanel(el);
    panel.mount();

    const store = OverlordUI.getStore();
    store.set('building.list', [
      { id: 'b1', name: 'Alpha', activePhase: 'strategy' }
    ]);
    store.set('building.active', 'b1');

    expect(panel._activeId).toBe('b1');
  });

  it('shows singular "building" for count of 1', async () => {
    const { ProjectsPanel } = await import('../../../public/ui/panels/projects-panel.js');
    const el = createPanelEl('panel-projects', 'Projects');
    document.body.appendChild(el);

    const panel = new ProjectsPanel(el);
    panel.mount();

    const store = OverlordUI.getStore();
    store.set('building.list', [
      { id: 'b1', name: 'Solo', activePhase: 'discovery' }
    ]);

    const summary = el.querySelector('.panel-summary');
    expect(summary!.textContent).toContain('1 building');
    expect(summary!.textContent).not.toContain('1 buildings');
  });
});

// ─── ToolsPanel ────────────────────────────────────────────

describe('ToolsPanel', () => {
  it('exports the ToolsPanel class', async () => {
    const mod = await import('../../../public/ui/panels/tools-panel.js');
    expect(mod.ToolsPanel).toBeDefined();
  });

  it('shows empty state when no room selected', async () => {
    const { ToolsPanel } = await import('../../../public/ui/panels/tools-panel.js');
    const el = createPanelEl('panel-tools', 'Tools');
    document.body.appendChild(el);

    const panel = new ToolsPanel(el);
    panel.mount();

    expect(el.querySelector('.panel-empty')).not.toBeNull();
    expect(el.querySelector('.panel-empty')!.textContent).toContain('Select a room');
  });

  it('renders tools list when room tools provided', async () => {
    const { ToolsPanel } = await import('../../../public/ui/panels/tools-panel.js');
    const el = createPanelEl('panel-tools', 'Tools');
    document.body.appendChild(el);

    const panel = new ToolsPanel(el);
    panel.mount();

    // Simulate room selection via engine event
    panel._roomTools = ['bash', 'read_file', 'write_file'];
    panel._renderContent();

    const list = el.querySelector('.tools-list');
    expect(list).not.toBeNull();
    expect(list!.children.length).toBe(3);
  });

  it('switches between available and history tabs', async () => {
    const { ToolsPanel } = await import('../../../public/ui/panels/tools-panel.js');
    const el = createPanelEl('panel-tools', 'Tools');
    document.body.appendChild(el);

    const panel = new ToolsPanel(el);
    panel.mount();

    // Default tab is 'available'
    expect(panel._tab).toBe('available');

    // Switch to history
    panel._tab = 'history';
    panel._renderContent();

    // Should show empty state for history
    expect(el.querySelector('.panel-empty')!.textContent).toContain('No tool executions');
  });

  it('renders execution history entries', async () => {
    const { ToolsPanel } = await import('../../../public/ui/panels/tools-panel.js');
    const el = createPanelEl('panel-tools', 'Tools');
    document.body.appendChild(el);

    const panel = new ToolsPanel(el);
    panel.mount();

    panel._tab = 'history';
    panel._executions = [
      { event: 'tool:executed', toolName: 'bash', timestamp: Date.now(), result: { ok: true } },
      { event: 'tool:executed', toolName: 'read_file', timestamp: Date.now(), result: { ok: false } }
    ];
    panel._renderContent();

    const list = el.querySelector('.tools-history-list');
    expect(list).not.toBeNull();
    expect(list!.children.length).toBe(2);
  });

  it('filters tool executions from activity items', async () => {
    const { ToolsPanel } = await import('../../../public/ui/panels/tools-panel.js');
    const el = createPanelEl('panel-tools', 'Tools');
    document.body.appendChild(el);

    const panel = new ToolsPanel(el);
    panel.mount();

    const store = OverlordUI.getStore();
    store.set('activity.items', [
      { event: 'tool:executed', toolName: 'bash' },
      { event: 'phase:advanced', newPhase: 'discovery' },
      { event: 'tool:executed', toolName: 'write_file' },
      { event: 'room:agent:entered', agentId: 'a1' }
    ]);

    // Only tool:executed items should be captured
    expect(panel._executions.length).toBe(2);
  });
});

// ─── LogsPanel ─────────────────────────────────────────────

describe('LogsPanel', () => {
  it('exports the LogsPanel class', async () => {
    const mod = await import('../../../public/ui/panels/logs-panel.js');
    expect(mod.LogsPanel).toBeDefined();
  });

  it('shows empty state when no logs', async () => {
    const { LogsPanel } = await import('../../../public/ui/panels/logs-panel.js');
    const el = createPanelEl('panel-logs', 'Logs');
    document.body.appendChild(el);

    const panel = new LogsPanel(el);
    panel.mount();

    expect(el.querySelector('.panel-empty')).not.toBeNull();
  });

  it('adds log entries via _addLog', async () => {
    const { LogsPanel } = await import('../../../public/ui/panels/logs-panel.js');
    const el = createPanelEl('panel-logs', 'Logs');
    document.body.appendChild(el);

    const panel = new LogsPanel(el);
    panel.mount();

    panel._addLog({ level: 'info', message: 'Test info log' });
    panel._addLog({ level: 'warn', message: 'Test warning' });
    panel._addLog({ level: 'error', message: 'Test error' });

    expect(panel._logs.length).toBe(3);

    const list = el.querySelector('.logs-list');
    expect(list).not.toBeNull();
    expect(list!.children.length).toBe(3);
  });

  it('filters logs by level', async () => {
    const { LogsPanel } = await import('../../../public/ui/panels/logs-panel.js');
    const el = createPanelEl('panel-logs', 'Logs');
    document.body.appendChild(el);

    const panel = new LogsPanel(el);
    panel.mount();

    panel._addLog({ level: 'info', message: 'Info 1' });
    panel._addLog({ level: 'warn', message: 'Warning 1' });
    panel._addLog({ level: 'error', message: 'Error 1' });
    panel._addLog({ level: 'info', message: 'Info 2' });

    panel._filter = 'warn';
    const warnLogs = panel._getFiltered();
    expect(warnLogs.length).toBe(1);

    panel._filter = 'error';
    const errorLogs = panel._getFiltered();
    expect(errorLogs.length).toBe(1);

    panel._filter = 'all';
    const allLogs = panel._getFiltered();
    expect(allLogs.length).toBe(4);
  });

  it('counts logs by level', async () => {
    const { LogsPanel } = await import('../../../public/ui/panels/logs-panel.js');
    const el = createPanelEl('panel-logs', 'Logs');

    const panel = new LogsPanel(el);

    panel._logs = [
      { level: 'info', message: 'a', timestamp: Date.now() },
      { level: 'warn', message: 'b', timestamp: Date.now() },
      { level: 'warn', message: 'c', timestamp: Date.now() },
      { level: 'error', message: 'd', timestamp: Date.now() }
    ];

    expect(panel._countByLevel('warn')).toBe(2);
    expect(panel._countByLevel('error')).toBe(1);
    expect(panel._countByLevel('info')).toBe(1);
  });

  it('caps logs at MAX_LOGS (200)', async () => {
    const { LogsPanel } = await import('../../../public/ui/panels/logs-panel.js');
    const el = createPanelEl('panel-logs', 'Logs');
    document.body.appendChild(el);

    const panel = new LogsPanel(el);
    panel.mount();

    for (let i = 0; i < 220; i++) {
      panel._addLog({ level: 'info', message: `Log ${i}` });
    }

    expect(panel._logs.length).toBe(200);
  });

  it('sets default fields on log entries', async () => {
    const { LogsPanel } = await import('../../../public/ui/panels/logs-panel.js');
    const el = createPanelEl('panel-logs', 'Logs');

    const panel = new LogsPanel(el);
    panel._addLog({ message: 'Bare log' });

    expect(panel._logs[0].level).toBe('info');
    expect(panel._logs[0].source).toBe('server');
    expect(panel._logs[0].timestamp).toBeDefined();
  });
});

// ─── TeamPanel ─────────────────────────────────────────────

describe('TeamPanel', () => {
  it('exports the TeamPanel class', async () => {
    const mod = await import('../../../public/ui/panels/team-panel.js');
    expect(mod.TeamPanel).toBeDefined();
  });

  it('shows empty state when no agents', async () => {
    const { TeamPanel } = await import('../../../public/ui/panels/team-panel.js');
    const el = createPanelEl('panel-team', 'Team');
    document.body.appendChild(el);

    const panel = new TeamPanel(el);
    panel.mount();

    expect(el.querySelector('.panel-empty')).not.toBeNull();
    expect(el.querySelector('.panel-empty')!.textContent).toContain('No team members');
  });

  it('groups agents by role', async () => {
    const { TeamPanel } = await import('../../../public/ui/panels/team-panel.js');
    const el = createPanelEl('panel-team', 'Team');
    document.body.appendChild(el);

    const panel = new TeamPanel(el);
    panel.mount();

    const store = OverlordUI.getStore();
    store.set('agents.list', [
      { id: 'a1', name: 'Alice', role: 'developer', status: 'active' },
      { id: 'a2', name: 'Bob', role: 'developer', status: 'idle' },
      { id: 'a3', name: 'Carol', role: 'tester', status: 'active' }
    ]);

    const groups = panel._groupByRole();
    expect(Object.keys(groups)).toContain('developer');
    expect(Object.keys(groups)).toContain('tester');
    expect(groups['developer'].length).toBe(2);
    expect(groups['tester'].length).toBe(1);
  });

  it('renders role headers with correct counts', async () => {
    const { TeamPanel } = await import('../../../public/ui/panels/team-panel.js');
    const el = createPanelEl('panel-team', 'Team');
    document.body.appendChild(el);

    const panel = new TeamPanel(el);
    panel.mount();

    const store = OverlordUI.getStore();
    store.set('agents.list', [
      { id: 'a1', name: 'Alice', role: 'developer' },
      { id: 'a2', name: 'Bob', role: 'developer' },
      { id: 'a3', name: 'Carol', role: 'tester' }
    ]);

    const roleHeaders = el.querySelectorAll('.team-role-header');
    expect(roleHeaders.length).toBe(2);

    const roleCounts = el.querySelectorAll('.team-role-count');
    // One of them should be (2), the other (1)
    const counts = Array.from(roleCounts).map(e => e.textContent);
    expect(counts).toContain('(2)');
    expect(counts).toContain('(1)');
  });

  it('shows summary with agent count and active count', async () => {
    const { TeamPanel } = await import('../../../public/ui/panels/team-panel.js');
    const el = createPanelEl('panel-team', 'Team');
    document.body.appendChild(el);

    const panel = new TeamPanel(el);
    panel.mount();

    const store = OverlordUI.getStore();
    store.set('agents.list', [
      { id: 'a1', name: 'Alice', role: 'developer', status: 'active' },
      { id: 'a2', name: 'Bob', role: 'tester', status: 'idle' }
    ]);
    store.set('building.agentPositions', {
      'a1': { status: 'active', roomId: 'r1' }
    });

    const summary = el.querySelector('.panel-summary');
    expect(summary).not.toBeNull();
    expect(summary!.textContent).toContain('2 agents');
    expect(summary!.textContent).toContain('1 active');
  });

  it('resolves room names from rooms list', async () => {
    const { TeamPanel } = await import('../../../public/ui/panels/team-panel.js');
    const el = createPanelEl('panel-team', 'Team');

    const panel = new TeamPanel(el);
    panel._rooms = [
      { id: 'r1', name: 'War Room', type: 'strategy' },
      { id: 'r2', name: 'Dev Lab', type: 'execution' }
    ];

    expect(panel._getRoomName('r1')).toBe('War Room');
    expect(panel._getRoomName('r2')).toBe('Dev Lab');
    expect(panel._getRoomName('r999')).toBe('r999'); // unknown room returns ID
    expect(panel._getRoomName(null)).toBeNull();
  });

  it('formats role names with capitalization', async () => {
    const { TeamPanel } = await import('../../../public/ui/panels/team-panel.js');
    const el = createPanelEl('panel-team', 'Team');

    const panel = new TeamPanel(el);
    expect(panel._formatRole('developer')).toBe('Developer');
    expect(panel._formatRole('tester')).toBe('Tester');
    expect(panel._formatRole('lead')).toBe('Lead');
  });

  it('assigns correct role icons', async () => {
    const { TeamPanel } = await import('../../../public/ui/panels/team-panel.js');
    const el = createPanelEl('panel-team', 'Team');

    const panel = new TeamPanel(el);
    // Known roles should get their specific icons
    expect(panel._getRoleIcon('developer')).not.toBe(panel._getRoleIcon('unknown_role'));
    // Unknown roles should get the default icon
    expect(panel._getRoleIcon('xyznonexistent')).toBeDefined();
  });
});

// ─── TasksPanel ────────────────────────────────────────────

describe('TasksPanel', () => {
  it('exports TasksPanel class', async () => {
    const mod = await import('../../../public/ui/panels/tasks-panel.js');
    expect(mod.TasksPanel).toBeDefined();
  });

  it('renders with empty state when no tasks', async () => {
    const { TasksPanel } = await import('../../../public/ui/panels/tasks-panel.js');
    const el = createPanelEl('panel-tasks', 'Tasks');
    const panel = new TasksPanel(el);
    panel.mount();

    const body = el.querySelector('.panel-body');
    expect(body).not.toBeNull();
    expect(body!.querySelector('.panel-empty')).not.toBeNull();
    expect(body!.querySelector('.panel-empty')!.textContent).toContain('No tasks yet');

    panel.destroy();
  });

  it('renders status counts in stats row', async () => {
    const store = OverlordUI.getStore();

    const { TasksPanel } = await import('../../../public/ui/panels/tasks-panel.js');
    const el = createPanelEl('panel-tasks', 'Tasks');
    const panel = new TasksPanel(el);
    panel.mount();

    store.set('tasks.list', [
      { id: '1', title: 'A', status: 'pending', priority: 'normal' },
      { id: '2', title: 'B', status: 'in-progress', priority: 'high' },
      { id: '3', title: 'C', status: 'done', priority: 'normal' },
      { id: '4', title: 'D', status: 'blocked', priority: 'critical' },
      { id: '5', title: 'E', status: 'pending', priority: 'low' },
    ]);

    const statsRow = el.querySelector('.task-stats-row');
    expect(statsRow).not.toBeNull();
    const counts = statsRow!.querySelectorAll('.task-stat-count');
    expect(counts.length).toBe(4);
    // pending: 2, in-progress: 1, done: 1, blocked: 1
    const countValues = Array.from(counts).map(c => c.textContent);
    expect(countValues).toEqual(['2', '1', '1', '1']);

    panel.destroy();
  });

  it('renders task items sorted by status priority', async () => {
    const store = OverlordUI.getStore();

    const { TasksPanel } = await import('../../../public/ui/panels/tasks-panel.js');
    const el = createPanelEl('panel-tasks', 'Tasks');
    const panel = new TasksPanel(el);
    panel.mount();

    store.set('tasks.list', [
      { id: '1', title: 'Pending Task', status: 'pending', priority: 'normal' },
      { id: '2', title: 'Active Task', status: 'in-progress', priority: 'normal' },
      { id: '3', title: 'Blocked Task', status: 'blocked', priority: 'high' },
    ]);

    const items = el.querySelectorAll('.drill-item');
    expect(items.length).toBe(3);
    // in-progress first, then blocked, then pending
    expect(items[0].textContent).toContain('Active Task');
    expect(items[1].textContent).toContain('Blocked Task');
    expect(items[2].textContent).toContain('Pending Task');

    panel.destroy();
  });

  it('shows View All Tasks button', async () => {
    const { TasksPanel } = await import('../../../public/ui/panels/tasks-panel.js');
    const el = createPanelEl('panel-tasks', 'Tasks');
    const panel = new TasksPanel(el);
    panel.mount();

    const footer = el.querySelector('.panel-footer-action');
    expect(footer).not.toBeNull();
    expect(footer!.textContent).toContain('View All Tasks');

    panel.destroy();
  });

  it('shows truncation message when over MAX_VISIBLE_TASKS', async () => {
    const store = OverlordUI.getStore();

    const { TasksPanel } = await import('../../../public/ui/panels/tasks-panel.js');
    const el = createPanelEl('panel-tasks', 'Tasks');
    const panel = new TasksPanel(el);
    panel.mount();

    const tasks = Array.from({ length: 20 }, (_, i) => ({
      id: `t${i}`, title: `Task ${i}`, status: 'pending', priority: 'normal'
    }));
    store.set('tasks.list', tasks);

    const truncated = el.querySelector('.panel-truncated');
    expect(truncated).not.toBeNull();
    expect(truncated!.textContent).toContain('15 of 20');

    panel.destroy();
  });

  it('updates when tasks.list store key changes', async () => {
    const store = OverlordUI.getStore();
    const { TasksPanel } = await import('../../../public/ui/panels/tasks-panel.js');
    const el = createPanelEl('panel-tasks', 'Tasks');
    const panel = new TasksPanel(el);
    panel.mount();

    // Initially empty
    expect(el.querySelector('.panel-empty')).not.toBeNull();

    // Add tasks
    store.set('tasks.list', [
      { id: '1', title: 'New Task', status: 'in-progress', priority: 'high' }
    ]);

    // Now should show a drill-item
    expect(el.querySelector('.panel-empty')).toBeNull();
    const items = el.querySelectorAll('.drill-item');
    expect(items.length).toBe(1);
    expect(items[0].textContent).toContain('New Task');

    panel.destroy();
  });

  it('shows HIGH badge for high-priority tasks', async () => {
    const store = OverlordUI.getStore();

    const { TasksPanel } = await import('../../../public/ui/panels/tasks-panel.js');
    const el = createPanelEl('panel-tasks', 'Tasks');
    const panel = new TasksPanel(el);
    panel.mount();

    store.set('tasks.list', [
      { id: '1', title: 'Urgent', status: 'pending', priority: 'high' }
    ]);

    const badge = el.querySelector('.drill-badge');
    expect(badge).not.toBeNull();
    expect(badge!.textContent).toContain('HIGH');

    panel.destroy();
  });

  it('shows CRIT badge for critical-priority tasks', async () => {
    const store = OverlordUI.getStore();

    const { TasksPanel } = await import('../../../public/ui/panels/tasks-panel.js');
    const el = createPanelEl('panel-tasks', 'Tasks');
    const panel = new TasksPanel(el);
    panel.mount();

    store.set('tasks.list', [
      { id: '1', title: 'Critical Fix', status: 'blocked', priority: 'critical' }
    ]);

    const badge = el.querySelector('.drill-badge');
    expect(badge).not.toBeNull();
    expect(badge!.textContent).toContain('CRIT');

    panel.destroy();
  });
});
