// @vitest-environment jsdom
/**
 * Tests for the panel modules:
 *   - phase-panel.js
 *   - agents-panel.js
 *   - raid-panel.js
 *   - activity-panel.js
 *
 * Tests class structure, rendering, and filtering behavior.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

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
