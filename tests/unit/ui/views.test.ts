// @vitest-environment jsdom
/**
 * Tests for the view modules:
 *   - building-view.js
 *   - chat-view.js
 *   - dashboard-view.js
 *   - strategist-view.js
 *   - room-view.js
 *
 * Tests class structure, instantiation, and rendering behavior
 * with a mock engine/store.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const storePath = '../../../public/ui/engine/store.js';
const enginePath = '../../../public/ui/engine/engine.js';

let Store: any;
let OverlordUI: any;

beforeEach(async () => {
  // Clean up modals from previous tests
  try {
    const { Modal } = await import('../../../public/ui/components/modal.js');
    Modal.closeAll();
  } catch (_) { /* ignore if not yet loaded */ }

  // Clear DOM
  document.body.textContent = '';

  const storeMod = await import(storePath);
  const engineMod = await import(enginePath);
  Store = storeMod.Store;
  OverlordUI = engineMod.OverlordUI;

  // Initialize engine with a store so views can use it
  const store = new Store();
  store.set('building.data', null, { silent: true });
  store.set('building.floors', [], { silent: true });
  store.set('building.agentPositions', {}, { silent: true });
  store.set('building.list', [], { silent: true });
  store.set('building.active', null, { silent: true });
  store.set('building.activePhase', 'strategy', { silent: true });
  store.set('agents.list', [], { silent: true });
  store.set('raid.entries', [], { silent: true });
  store.set('chat.messages', [], { silent: true });
  store.set('activity.items', [], { silent: true });
  store.set('phase.gates', [], { silent: true });
  store.set('phase.canAdvance', null, { silent: true });
  store.set('rooms.list', [], { silent: true });
  store.set('tasks.list', [], { silent: true });
  OverlordUI.init(store);
});

// ─── BuildingView ───────────────────────────────────────────

describe('BuildingView', () => {
  it('exports the BuildingView class', async () => {
    const mod = await import('../../../public/ui/views/building-view.js');
    expect(mod.BuildingView).toBeDefined();
    expect(typeof mod.BuildingView).toBe('function');
  });

  it('renders empty state when no building data', async () => {
    const { BuildingView } = await import('../../../public/ui/views/building-view.js');
    const el = document.createElement('div');
    const view = new BuildingView(el);
    view.mount();

    expect(el.querySelector('.empty-state')).not.toBeNull();
    expect(el.textContent).toContain('No Building Selected');
  });

  it('renders floors when building data is set', async () => {
    const { BuildingView } = await import('../../../public/ui/views/building-view.js');
    const el = document.createElement('div');
    const view = new BuildingView(el);
    view.mount();

    // Set store data AFTER mount so subscriptions fire
    const store = OverlordUI.getStore();
    store.set('building.data', { name: 'Test Building', active_phase: 'execution' });
    store.set('building.floors', [
      { id: 'f1', name: 'Strategy Floor', type: 'strategy', ordinal: 3, rooms: [] },
      { id: 'f2', name: 'Execution Floor', type: 'execution', ordinal: 1, rooms: [{ id: 'r1', type: 'code-lab' }] }
    ]);

    expect(el.querySelector('.building-header')).not.toBeNull();
    expect(el.querySelector('.building-name')!.textContent).toBe('Test Building');
    expect(el.querySelectorAll('.floor-bar').length).toBe(2);
    expect(el.querySelector('.building-stats')).not.toBeNull();
  });

  it('shows building stats footer', async () => {
    const { BuildingView } = await import('../../../public/ui/views/building-view.js');
    const el = document.createElement('div');
    const view = new BuildingView(el);
    view.mount();

    // Set store data AFTER mount so subscriptions fire
    const store = OverlordUI.getStore();
    store.set('building.data', { name: 'B' });
    store.set('building.floors', [
      { id: 'f1', ordinal: 1, rooms: [{ id: 'r1' }, { id: 'r2' }] }
    ]);

    const statValues = el.querySelectorAll('.building-stat-value');
    expect(statValues.length).toBe(3);
    expect(statValues[0].textContent).toBe('1');  // 1 floor
    expect(statValues[1].textContent).toBe('2');  // 2 rooms
    expect(statValues[2].textContent).toBe('0');  // 0 active agents
  });

  it('adds agent dots when agentPositions update without full re-render', async () => {
    const { BuildingView } = await import('../../../public/ui/views/building-view.js');
    const el = document.createElement('div');
    const view = new BuildingView(el);
    view.mount();

    const store = OverlordUI.getStore();
    store.set('building.data', { name: 'B' });
    store.set('building.floors', [
      { id: 'f1', ordinal: 1, rooms: [] }
    ]);

    // Verify no dots initially
    expect(el.querySelector('.floor-agent-dots')).toBeNull();

    // Add agents via agentPositions — triggers _updateAgentDots (partial update)
    store.set('building.agentPositions', {
      a1: { agentId: 'a1', name: 'Agent 1', floorId: 'f1', status: 'active' },
      a2: { agentId: 'a2', name: 'Agent 2', floorId: 'f1', status: 'idle' }
    });

    const dotsRow = el.querySelector('.floor-agent-dots');
    expect(dotsRow).not.toBeNull();
    expect(dotsRow!.querySelectorAll('.agent-dot').length).toBe(2);
    expect(dotsRow!.querySelector('.agent-dot-active')).not.toBeNull();
    expect(dotsRow!.querySelector('.agent-dot-idle')).not.toBeNull();
  });

  it('removes agent dots when all agents leave a floor', async () => {
    const { BuildingView } = await import('../../../public/ui/views/building-view.js');
    const el = document.createElement('div');
    const view = new BuildingView(el);
    view.mount();

    const store = OverlordUI.getStore();
    store.set('building.data', { name: 'B' });
    store.set('building.floors', [
      { id: 'f1', ordinal: 1, rooms: [] }
    ]);
    store.set('building.agentPositions', {
      a1: { agentId: 'a1', name: 'Agent 1', floorId: 'f1', status: 'active' }
    });

    expect(el.querySelector('.floor-agent-dots')).not.toBeNull();

    // Remove all agents
    store.set('building.agentPositions', {});

    expect(el.querySelector('.floor-agent-dots')).toBeNull();
  });

  it('updates active agent count in stats on agentPositions change', async () => {
    const { BuildingView } = await import('../../../public/ui/views/building-view.js');
    const el = document.createElement('div');
    const view = new BuildingView(el);
    view.mount();

    const store = OverlordUI.getStore();
    store.set('building.data', { name: 'B' });
    store.set('building.floors', [
      { id: 'f1', ordinal: 1, rooms: [] }
    ]);

    // Initially 0 active
    const statValues = el.querySelectorAll('.building-stat-value');
    expect(statValues[2].textContent).toBe('0');

    // Add agents — one active, one idle
    store.set('building.agentPositions', {
      a1: { agentId: 'a1', floorId: 'f1', status: 'active' },
      a2: { agentId: 'a2', floorId: 'f1', status: 'idle' },
      a3: { agentId: 'a3', floorId: 'f1', status: 'working' }
    });

    // active + working = 2
    expect(statValues[2].textContent).toBe('2');
  });

  it('updates room card avatars in expanded floors on agentPositions change', async () => {
    const { BuildingView } = await import('../../../public/ui/views/building-view.js');
    const el = document.createElement('div');
    const view = new BuildingView(el);
    view.mount();

    const store = OverlordUI.getStore();
    store.set('building.data', { name: 'B' });
    store.set('building.floors', [
      { id: 'f1', ordinal: 1, rooms: [{ id: 'r1', name: 'Code Lab', type: 'code-lab' }] }
    ]);

    // Expand the floor by clicking the floor bar
    const floorBar = el.querySelector('.floor-bar') as HTMLElement;
    expect(floorBar).not.toBeNull();
    floorBar.click();

    // Should now have expanded content with room card
    expect(el.querySelector('.floor-room-grid')).not.toBeNull();
    const roomCard = el.querySelector('.room-card') as HTMLElement;
    expect(roomCard).not.toBeNull();
    expect(roomCard.classList.contains('room-occupied')).toBe(false);

    // Add an agent to that room
    store.set('building.agentPositions', {
      a1: { agentId: 'a1', name: 'Alice', floorId: 'f1', roomId: 'r1', status: 'active' }
    });

    // Room card should now be occupied with avatar
    expect(roomCard.classList.contains('room-occupied')).toBe(true);
    const avatarRow = roomCard.querySelector('.room-agent-avatars');
    expect(avatarRow).not.toBeNull();
    expect(avatarRow!.querySelector('.agent-avatar')!.textContent).toBe('A');
  });

  it('shows overflow indicator when more than 8 agents on a floor', async () => {
    const { BuildingView } = await import('../../../public/ui/views/building-view.js');
    const el = document.createElement('div');
    const view = new BuildingView(el);
    view.mount();

    const store = OverlordUI.getStore();
    store.set('building.data', { name: 'B' });
    store.set('building.floors', [
      { id: 'f1', ordinal: 1, rooms: [] }
    ]);

    // Add 10 agents to one floor
    const positions: Record<string, unknown> = {};
    for (let i = 1; i <= 10; i++) {
      positions[`a${i}`] = { agentId: `a${i}`, name: `Agent ${i}`, floorId: 'f1', status: 'active' };
    }
    store.set('building.agentPositions', positions);

    const dotsRow = el.querySelector('.floor-agent-dots');
    expect(dotsRow).not.toBeNull();
    // Only 8 dots rendered, plus overflow
    expect(dotsRow!.querySelectorAll('.agent-dot').length).toBe(8);
    const overflow = dotsRow!.querySelector('.agent-dot-overflow');
    expect(overflow).not.toBeNull();
    expect(overflow!.textContent).toBe('+2');
  });
});

// ─── ChatView ───────────────────────────────────────────────

describe('ChatView', () => {
  it('exports the ChatView class', async () => {
    const mod = await import('../../../public/ui/views/chat-view.js');
    expect(mod.ChatView).toBeDefined();
  });

  it('renders chat structure on mount', async () => {
    const { ChatView } = await import('../../../public/ui/views/chat-view.js');
    const el = document.createElement('div');
    const view = new ChatView(el);
    view.mount();

    expect(el.querySelector('.chat-header')).not.toBeNull();
    expect(el.querySelector('.chat-messages')).not.toBeNull();
    // TokenInput.mount() overwrites the container's class to 'token-input-container'
    expect(el.querySelector('.token-input-container')).not.toBeNull();
  });

  it('shows empty state when no messages', async () => {
    const { ChatView } = await import('../../../public/ui/views/chat-view.js');
    const el = document.createElement('div');
    const view = new ChatView(el);
    view.mount();

    // Trigger the subscription to render the empty state
    const store = OverlordUI.getStore();
    store.set('chat.messages', []);

    const messages = el.querySelector('.chat-messages');
    expect(messages!.querySelector('.empty-state')).not.toBeNull();
  });

  it('renders messages from store', async () => {
    const { ChatView } = await import('../../../public/ui/views/chat-view.js');
    const el = document.createElement('div');
    const view = new ChatView(el);
    view.mount();

    const store = OverlordUI.getStore();
    store.set('chat.messages', [
      { id: '1', role: 'user', content: 'Hello', timestamp: new Date().toISOString() },
      { id: '2', role: 'assistant', content: 'Hi there', timestamp: new Date().toISOString() }
    ]);

    const messageEls = el.querySelectorAll('.chat-message');
    expect(messageEls.length).toBe(2);
    expect(messageEls[0].classList.contains('chat-message-user')).toBe(true);
    expect(messageEls[1].classList.contains('chat-message-assistant')).toBe(true);
  });
});

// ─── DashboardView ──────────────────────────────────────────

describe('DashboardView', () => {
  it('exports the DashboardView class', async () => {
    const mod = await import('../../../public/ui/views/dashboard-view.js');
    expect(mod.DashboardView).toBeDefined();
  });

  it('renders KPI cards and header on mount', async () => {
    const { DashboardView } = await import('../../../public/ui/views/dashboard-view.js');
    const el = document.createElement('div');
    const view = new DashboardView(el);
    view.mount();

    expect(el.querySelector('.dashboard-header')).not.toBeNull();
    expect(el.querySelector('.dashboard-title')!.textContent).toBe('Dashboard');
    expect(el.querySelectorAll('.kpi-card').length).toBe(4);
  });

  it('shows building list section', async () => {
    const { DashboardView } = await import('../../../public/ui/views/dashboard-view.js');
    const el = document.createElement('div');
    const view = new DashboardView(el);
    view.mount();

    expect(el.querySelector('.dashboard-buildings-section')).not.toBeNull();
  });

  it('displays buildings from store', async () => {
    const { DashboardView } = await import('../../../public/ui/views/dashboard-view.js');
    const el = document.createElement('div');
    const view = new DashboardView(el);
    view.mount();

    // Set store data AFTER mount so subscriptions fire
    const store = OverlordUI.getStore();
    store.set('building.list', [
      { id: 'b1', name: 'Project Alpha', active_phase: 'execution' },
      { id: 'b2', name: 'Project Beta', active_phase: 'strategy' }
    ]);

    const grid = el.querySelector('.building-card-grid');
    expect(grid).not.toBeNull();
    expect(grid!.children.length).toBe(2);
  });

  it('shows phase progress when active building is set', async () => {
    const { DashboardView } = await import('../../../public/ui/views/dashboard-view.js');
    const el = document.createElement('div');
    const view = new DashboardView(el);
    view.mount();

    // Set store data AFTER mount so subscriptions fire and trigger render
    const store = OverlordUI.getStore();
    store.set('building.list', [
      { id: 'b1', name: 'Test', activePhase: 'architecture' }
    ]);
    store.set('building.active', 'b1');

    expect(el.querySelector('.dashboard-phase-section')).not.toBeNull();
  });
});

// ─── StrategistView ─────────────────────────────────────────

describe('StrategistView', () => {
  it('exports the StrategistView class', async () => {
    const mod = await import('../../../public/ui/views/strategist-view.js');
    expect(mod.StrategistView).toBeDefined();
  });

  it('renders template selection on mount', async () => {
    const { StrategistView } = await import('../../../public/ui/views/strategist-view.js');
    const el = document.createElement('div');
    const view = new StrategistView(el);
    view.mount();

    expect(el.querySelector('.strategist-header')).not.toBeNull();
    expect(el.querySelector('.template-grid')).not.toBeNull();
  });

  it('renders 5 template cards', async () => {
    const { StrategistView } = await import('../../../public/ui/views/strategist-view.js');
    const el = document.createElement('div');
    const view = new StrategistView(el);
    view.mount();

    const cards = el.querySelectorAll('.template-card');
    expect(cards.length).toBe(5);
  });

  it('template cards have correct names', async () => {
    const { StrategistView } = await import('../../../public/ui/views/strategist-view.js');
    const el = document.createElement('div');
    const view = new StrategistView(el);
    view.mount();

    const names = [...el.querySelectorAll('.template-card-name')].map(
      (n: Element) => n.textContent
    );
    expect(names).toContain('Web Application');
    expect(names).toContain('Microservices');
    expect(names).toContain('Data Pipeline');
    expect(names).toContain('CLI Tool');
    expect(names).toContain('API Service');
  });

  it('clicking a template card switches to configure step', async () => {
    const { StrategistView } = await import('../../../public/ui/views/strategist-view.js');
    const el = document.createElement('div');
    const view = new StrategistView(el);
    view.mount();

    const firstCard = el.querySelector('.template-card') as HTMLElement;
    firstCard.click();

    // Should now show configuration form
    expect(el.querySelector('.strategist-form')).not.toBeNull();
    expect(el.querySelector('.form-group')).not.toBeNull();
    expect(el.querySelector('.blueprint-preview')).not.toBeNull();
  });
});

// ─── RoomView ───────────────────────────────────────────────

describe('RoomView', () => {
  it('exports the RoomView class', async () => {
    const mod = await import('../../../public/ui/views/room-view.js');
    expect(mod.RoomView).toBeDefined();
  });

  it('mounts without error', async () => {
    const { RoomView } = await import('../../../public/ui/views/room-view.js');
    const el = document.createElement('div');
    const view = new RoomView(el);
    expect(() => view.mount()).not.toThrow();
  });

  it('listens for building:room-selected events', async () => {
    const { RoomView } = await import('../../../public/ui/views/room-view.js');
    const el = document.createElement('div');
    const view = new RoomView(el);
    view.mount();
    // The view should have registered at least one listener
    expect(view._listeners.length).toBeGreaterThan(0);
  });
});

// ─── TaskView ──────────────────────────────────────────────

describe('TaskView', () => {
  it('exports the TaskView class', async () => {
    const mod = await import('../../../public/ui/views/task-view.js');
    expect(mod.TaskView).toBeDefined();
    expect(typeof mod.TaskView).toBe('function');
  });

  it('renders header, search, tabs, and list container on mount', async () => {
    const { TaskView } = await import('../../../public/ui/views/task-view.js');
    const el = document.createElement('div');
    const view = new TaskView(el);
    view.mount();

    expect(el.querySelector('.task-view-header')).not.toBeNull();
    expect(el.querySelector('.task-view-title')!.textContent).toBe('Tasks');
    expect(el.querySelector('.task-search-input')).not.toBeNull();
    expect(el.querySelector('.task-filter-tabs')).not.toBeNull();
    expect(el.querySelector('#task-list')).not.toBeNull();
  });

  it('shows empty state when no tasks', async () => {
    const { TaskView } = await import('../../../public/ui/views/task-view.js');
    const el = document.createElement('div');
    const view = new TaskView(el);
    view.mount();

    const list = el.querySelector('#task-list');
    expect(list!.querySelector('.empty-state')).not.toBeNull();
    expect(list!.textContent).toContain('No tasks yet');
  });

  it('renders task cards from store', async () => {
    const { TaskView } = await import('../../../public/ui/views/task-view.js');
    const el = document.createElement('div');
    const view = new TaskView(el);
    view.mount();

    const store = OverlordUI.getStore();
    store.set('tasks.list', [
      { id: 't1', title: 'Write tests', status: 'pending', priority: 'high', created_at: new Date().toISOString() },
      { id: 't2', title: 'Fix bug', status: 'in-progress', priority: 'critical', created_at: new Date().toISOString() },
      { id: 't3', title: 'Deploy v2', status: 'done', priority: 'normal', created_at: new Date().toISOString() }
    ]);

    const cards = el.querySelectorAll('.card-task');
    expect(cards.length).toBe(3);
  });

  it('filters tasks by status tab', async () => {
    const { TaskView } = await import('../../../public/ui/views/task-view.js');
    const el = document.createElement('div');
    const view = new TaskView(el);
    view.mount();

    const store = OverlordUI.getStore();
    store.set('tasks.list', [
      { id: 't1', title: 'Task A', status: 'pending', priority: 'normal', created_at: new Date().toISOString() },
      { id: 't2', title: 'Task B', status: 'done', priority: 'normal', created_at: new Date().toISOString() }
    ]);

    // Click the 'Done' tab
    const doneTab = el.querySelector('[data-tab-id="done"]') as HTMLElement;
    expect(doneTab).not.toBeNull();
    doneTab.click();

    const cards = el.querySelectorAll('.card-task');
    expect(cards.length).toBe(1);
  });

  it('filters tasks by search query', async () => {
    const { TaskView } = await import('../../../public/ui/views/task-view.js');
    const el = document.createElement('div');
    const view = new TaskView(el);
    view.mount();

    const store = OverlordUI.getStore();
    store.set('tasks.list', [
      { id: 't1', title: 'Write tests', status: 'pending', priority: 'normal', created_at: new Date().toISOString() },
      { id: 't2', title: 'Fix auth bug', status: 'pending', priority: 'normal', created_at: new Date().toISOString() }
    ]);

    // Type in the search input
    const searchInput = el.querySelector('.task-search-input') as HTMLInputElement;
    searchInput.value = 'auth';
    searchInput.dispatchEvent(new Event('input'));

    const cards = el.querySelectorAll('.card-task');
    expect(cards.length).toBe(1);
  });

  it('sorts tasks by priority (critical first)', async () => {
    const { TaskView } = await import('../../../public/ui/views/task-view.js');
    const el = document.createElement('div');
    const view = new TaskView(el);
    view.mount();

    const store = OverlordUI.getStore();
    store.set('tasks.list', [
      { id: 't1', title: 'Low task', status: 'pending', priority: 'low', created_at: new Date().toISOString() },
      { id: 't2', title: 'Critical task', status: 'pending', priority: 'critical', created_at: new Date().toISOString() },
      { id: 't3', title: 'Normal task', status: 'pending', priority: 'normal', created_at: new Date().toISOString() }
    ]);

    const titles = [...el.querySelectorAll('.task-title')].map((t: Element) => t.textContent);
    expect(titles[0]).toBe('Critical task');
    expect(titles[titles.length - 1]).toBe('Low task');
  });

  it('has a New Task button', async () => {
    const { TaskView } = await import('../../../public/ui/views/task-view.js');
    const el = document.createElement('div');
    const view = new TaskView(el);
    view.mount();

    const newBtn = el.querySelector('.task-view-actions .btn-primary');
    expect(newBtn).not.toBeNull();
    expect(newBtn!.textContent).toContain('New Task');
  });

  it('renders tab badges with correct counts', async () => {
    const { TaskView } = await import('../../../public/ui/views/task-view.js');
    const el = document.createElement('div');
    const view = new TaskView(el);
    view.mount();

    const store = OverlordUI.getStore();
    store.set('tasks.list', [
      { id: 't1', title: 'A', status: 'pending', priority: 'normal' },
      { id: 't2', title: 'B', status: 'pending', priority: 'normal' },
      { id: 't3', title: 'C', status: 'done', priority: 'normal' }
    ]);

    const allTab = el.querySelector('[data-tab-id="all"]');
    const allBadge = allTab?.querySelector('.tab-badge');
    expect(allBadge?.textContent).toBe('3');

    const pendingTab = el.querySelector('[data-tab-id="pending"]');
    const pendingBadge = pendingTab?.querySelector('.tab-badge');
    expect(pendingBadge?.textContent).toBe('2');
  });

  it('cleans up on destroy', async () => {
    const { TaskView } = await import('../../../public/ui/views/task-view.js');
    const parent = document.createElement('div');
    const el = document.createElement('div');
    parent.appendChild(el);
    const view = new TaskView(el);
    view.mount();

    expect(view._mounted).toBe(true);
    view.destroy();
    expect(view._mounted).toBe(false);
    expect(view._subs.length).toBe(0);
    expect(view._listeners.length).toBe(0);
  });
});

// ─── RaidLogView ───────────────────────────────────────────

describe('RaidLogView', () => {
  it('exports the RaidLogView class', async () => {
    const mod = await import('../../../public/ui/views/raid-log-view.js');
    expect(mod.RaidLogView).toBeDefined();
    expect(typeof mod.RaidLogView).toBe('function');
  });

  it('renders header, search, type tabs, status tabs, and list container on mount', async () => {
    const { RaidLogView } = await import('../../../public/ui/views/raid-log-view.js');
    const el = document.createElement('div');
    const view = new RaidLogView(el);
    view.mount();

    expect(el.querySelector('.raid-view-header')).not.toBeNull();
    expect(el.querySelector('.raid-view-title')!.textContent).toBe('RAID Log');
    expect(el.querySelector('.raid-search-input')).not.toBeNull();
    expect(el.querySelector('.raid-type-tabs')).not.toBeNull();
    expect(el.querySelector('.raid-status-tabs')).not.toBeNull();
    expect(el.querySelector('#raid-list')).not.toBeNull();
  });

  it('shows empty state when no entries', async () => {
    const { RaidLogView } = await import('../../../public/ui/views/raid-log-view.js');
    const el = document.createElement('div');
    const view = new RaidLogView(el);
    view.mount();

    const list = el.querySelector('#raid-list');
    expect(list!.querySelector('.empty-state')).not.toBeNull();
    expect(list!.textContent).toContain('No RAID entries yet');
  });

  it('renders RAID entry cards from store', async () => {
    const { RaidLogView } = await import('../../../public/ui/views/raid-log-view.js');
    const el = document.createElement('div');
    const view = new RaidLogView(el);
    view.mount();

    const store = OverlordUI.getStore();
    store.set('raid.entries', [
      { id: 'r1', type: 'risk', summary: 'API rate limits', status: 'active', created_at: new Date().toISOString() },
      { id: 'r2', type: 'decision', summary: 'Use PostgreSQL', status: 'active', created_at: new Date().toISOString() },
      { id: 'r3', type: 'issue', summary: 'Auth flow broken', status: 'closed', created_at: new Date().toISOString() }
    ]);

    const cards = el.querySelectorAll('.card-raid');
    expect(cards.length).toBe(3);
  });

  it('filters entries by type tab', async () => {
    const { RaidLogView } = await import('../../../public/ui/views/raid-log-view.js');
    const el = document.createElement('div');
    const view = new RaidLogView(el);
    view.mount();

    const store = OverlordUI.getStore();
    store.set('raid.entries', [
      { id: 'r1', type: 'risk', summary: 'Risk A', status: 'active', created_at: new Date().toISOString() },
      { id: 'r2', type: 'decision', summary: 'Decision B', status: 'active', created_at: new Date().toISOString() },
      { id: 'r3', type: 'risk', summary: 'Risk C', status: 'active', created_at: new Date().toISOString() }
    ]);

    // Click the 'Risks' tab
    const riskTab = el.querySelector('.raid-type-tabs [data-tab-id="risk"]') as HTMLElement;
    expect(riskTab).not.toBeNull();
    riskTab.click();

    const cards = el.querySelectorAll('.card-raid');
    expect(cards.length).toBe(2);
  });

  it('filters entries by status tab', async () => {
    const { RaidLogView } = await import('../../../public/ui/views/raid-log-view.js');
    const el = document.createElement('div');
    const view = new RaidLogView(el);
    view.mount();

    const store = OverlordUI.getStore();
    store.set('raid.entries', [
      { id: 'r1', type: 'risk', summary: 'Risk A', status: 'active', created_at: new Date().toISOString() },
      { id: 'r2', type: 'risk', summary: 'Risk B', status: 'closed', created_at: new Date().toISOString() }
    ]);

    // Click the 'Closed' status tab
    const closedTab = el.querySelector('.raid-status-tabs [data-tab-id="closed"]') as HTMLElement;
    expect(closedTab).not.toBeNull();
    closedTab.click();

    const cards = el.querySelectorAll('.card-raid');
    expect(cards.length).toBe(1);
  });

  it('filters entries by search query', async () => {
    const { RaidLogView } = await import('../../../public/ui/views/raid-log-view.js');
    const el = document.createElement('div');
    const view = new RaidLogView(el);
    view.mount();

    const store = OverlordUI.getStore();
    store.set('raid.entries', [
      { id: 'r1', type: 'risk', summary: 'API rate limits', status: 'active', created_at: new Date().toISOString() },
      { id: 'r2', type: 'decision', summary: 'Use PostgreSQL', status: 'active', created_at: new Date().toISOString() }
    ]);

    const searchInput = el.querySelector('.raid-search-input') as HTMLInputElement;
    searchInput.value = 'postgresql';
    searchInput.dispatchEvent(new Event('input'));

    const cards = el.querySelectorAll('.card-raid');
    expect(cards.length).toBe(1);
  });

  it('has a New Entry button', async () => {
    const { RaidLogView } = await import('../../../public/ui/views/raid-log-view.js');
    const el = document.createElement('div');
    const view = new RaidLogView(el);
    view.mount();

    const newBtn = el.querySelector('.raid-view-actions .btn-primary');
    expect(newBtn).not.toBeNull();
    expect(newBtn!.textContent).toContain('New Entry');
  });

  it('renders type tab badges with correct counts', async () => {
    const { RaidLogView } = await import('../../../public/ui/views/raid-log-view.js');
    const el = document.createElement('div');
    const view = new RaidLogView(el);
    view.mount();

    const store = OverlordUI.getStore();
    store.set('raid.entries', [
      { id: 'r1', type: 'risk', summary: 'A', status: 'active' },
      { id: 'r2', type: 'risk', summary: 'B', status: 'active' },
      { id: 'r3', type: 'issue', summary: 'C', status: 'active' }
    ]);

    const allTab = el.querySelector('.raid-type-tabs [data-tab-id="all"]');
    const allBadge = allTab?.querySelector('.tab-badge');
    expect(allBadge?.textContent).toBe('3');

    const riskTab = el.querySelector('.raid-type-tabs [data-tab-id="risk"]');
    const riskBadge = riskTab?.querySelector('.tab-badge');
    expect(riskBadge?.textContent).toBe('2');
  });

  it('renders subtitle text', async () => {
    const { RaidLogView } = await import('../../../public/ui/views/raid-log-view.js');
    const el = document.createElement('div');
    const view = new RaidLogView(el);
    view.mount();

    const subtitle = el.querySelector('.raid-view-subtitle');
    expect(subtitle).not.toBeNull();
    expect(subtitle!.textContent).toContain('Risks');
    expect(subtitle!.textContent).toContain('Decisions');
  });

  it('cleans up on destroy', async () => {
    const { RaidLogView } = await import('../../../public/ui/views/raid-log-view.js');
    const parent = document.createElement('div');
    const el = document.createElement('div');
    parent.appendChild(el);
    const view = new RaidLogView(el);
    view.mount();

    expect(view._mounted).toBe(true);
    view.destroy();
    expect(view._mounted).toBe(false);
    expect(view._subs.length).toBe(0);
    expect(view._listeners.length).toBe(0);
  });
});

// ─── TaskView form validation ──────────────────────────────

describe('TaskView — create form validation', () => {
  it('shows validation error when title is empty on submit', async () => {
    const { TaskView } = await import('../../../public/ui/views/task-view.js');
    const el = document.createElement('div');
    const view = new TaskView(el);
    view.mount();

    // Click "New Task" to open the form
    const newBtn = el.querySelector('.task-view-actions .btn-primary') as HTMLElement;
    newBtn.click();

    // Wait for modal to render
    await new Promise(r => setTimeout(r, 50));

    // Submit with empty title
    const submitBtn = document.querySelector('.task-create-actions .btn-primary') as HTMLElement;
    expect(submitBtn).not.toBeNull();
    submitBtn.click();

    await new Promise(r => setTimeout(r, 50));

    // Title input should have error class
    const titleInput = document.getElementById('task-create-title');
    expect(titleInput?.classList.contains('input-error')).toBe(true);

    // Error message should be visible
    const errorMsg = document.querySelector('.task-create-form .form-error');
    expect(errorMsg).not.toBeNull();
    expect(errorMsg!.textContent).toBe('Title is required');
  });

  it('calls createTask and closes modal on valid submit', async () => {
    const { TaskView } = await import('../../../public/ui/views/task-view.js');
    const { Modal } = await import('../../../public/ui/components/modal.js');
    const el = document.createElement('div');
    const view = new TaskView(el);
    view.mount();

    // Mock overlordSocket
    (window as any).overlordSocket = {
      createTask: vi.fn().mockResolvedValue({ ok: true, data: { id: 'new-task' } }),
      fetchTasks: vi.fn(),
      fetchTodos: vi.fn(),
    };

    // Set buildingId AFTER mount (mount reads from store and overwrites)
    (view as any)._buildingId = 'b1';

    // Open the form
    const newBtn = el.querySelector('.task-view-actions .btn-primary') as HTMLElement;
    newBtn.click();
    await new Promise(r => setTimeout(r, 50));

    // Fill in the title
    const titleInput = document.getElementById('task-create-title') as HTMLInputElement;
    titleInput.value = 'My new task';

    // Call submit directly to avoid microtask timing issues
    await (view as any)._submitCreateForm();

    expect((window as any).overlordSocket.createTask).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'My new task', buildingId: 'b1' })
    );

    // Modal should be closed on success
    expect(Modal.isOpen('task-create')).toBe(false);

    Modal.closeAll();
    delete (window as any).overlordSocket;
  });

  it('keeps modal open on failed submit', async () => {
    const { TaskView } = await import('../../../public/ui/views/task-view.js');
    const { Modal } = await import('../../../public/ui/components/modal.js');
    const el = document.createElement('div');
    const view = new TaskView(el);
    view.mount();

    // Mock overlordSocket with failure
    (window as any).overlordSocket = {
      createTask: vi.fn().mockResolvedValue({ ok: false, error: { message: 'Server error' } }),
      fetchTasks: vi.fn(),
      fetchTodos: vi.fn(),
    };

    // Set buildingId AFTER mount
    (view as any)._buildingId = 'b1';

    // Open form
    const newBtn = el.querySelector('.task-view-actions .btn-primary') as HTMLElement;
    newBtn.click();
    await new Promise(r => setTimeout(r, 50));

    // Fill title and submit directly
    (document.getElementById('task-create-title') as HTMLInputElement).value = 'Failing task';
    await (view as any)._submitCreateForm();

    // Modal should still be open
    expect(Modal.isOpen('task-create')).toBe(true);

    Modal.closeAll();
    delete (window as any).overlordSocket;
  });
});

// ─── RaidLogView form validation ──────────────────────────────

describe('RaidLogView — create form validation', () => {
  it('shows validation error when summary is empty on submit', async () => {
    const { RaidLogView } = await import('../../../public/ui/views/raid-log-view.js');
    const el = document.createElement('div');
    const view = new RaidLogView(el);
    view.mount();

    // Click "New Entry"
    const newBtn = el.querySelector('.raid-view-actions .btn-primary') as HTMLElement;
    newBtn.click();
    await new Promise(r => setTimeout(r, 50));

    // Submit with empty summary
    const submitBtn = document.querySelector('.raid-create-actions .btn-primary') as HTMLElement;
    expect(submitBtn).not.toBeNull();
    submitBtn.click();
    await new Promise(r => setTimeout(r, 50));

    // Summary input should have error class
    const summaryInput = document.getElementById('raid-create-summary');
    expect(summaryInput?.classList.contains('input-error')).toBe(true);

    // Error message
    const errorMsg = document.querySelector('.raid-create-form .form-error');
    expect(errorMsg).not.toBeNull();
    expect(errorMsg!.textContent).toBe('Summary is required');
  });

  it('calls addRaidEntry and closes modal on valid submit', async () => {
    const { RaidLogView } = await import('../../../public/ui/views/raid-log-view.js');
    const { Modal } = await import('../../../public/ui/components/modal.js');
    const el = document.createElement('div');
    const view = new RaidLogView(el);
    view.mount();

    // Mock overlordSocket
    (window as any).overlordSocket = {
      addRaidEntry: vi.fn().mockResolvedValue({ ok: true, data: { id: 'new-entry' } }),
      fetchRaidEntries: vi.fn(),
    };

    // Set buildingId AFTER mount
    (view as any)._buildingId = 'b1';

    // Open form
    const newBtn = el.querySelector('.raid-view-actions .btn-primary') as HTMLElement;
    newBtn.click();
    await new Promise(r => setTimeout(r, 50));

    // Fill in summary
    (document.getElementById('raid-create-summary') as HTMLInputElement).value = 'API rate limit risk';

    // Call submit directly to avoid microtask timing issues
    await (view as any)._submitCreateForm();

    expect((window as any).overlordSocket.addRaidEntry).toHaveBeenCalledWith(
      expect.objectContaining({ summary: 'API rate limit risk', buildingId: 'b1' })
    );

    // Modal should be closed
    expect(Modal.isOpen('raid-create')).toBe(false);

    Modal.closeAll();
    delete (window as any).overlordSocket;
  });

  it('keeps modal open on failed submit', async () => {
    const { RaidLogView } = await import('../../../public/ui/views/raid-log-view.js');
    const { Modal } = await import('../../../public/ui/components/modal.js');
    const el = document.createElement('div');
    const view = new RaidLogView(el);
    view.mount();

    (window as any).overlordSocket = {
      addRaidEntry: vi.fn().mockResolvedValue({ ok: false, error: { message: 'DB error' } }),
      fetchRaidEntries: vi.fn(),
    };

    // Set buildingId AFTER mount
    (view as any)._buildingId = 'b1';

    const newBtn = el.querySelector('.raid-view-actions .btn-primary') as HTMLElement;
    newBtn.click();
    await new Promise(r => setTimeout(r, 50));

    (document.getElementById('raid-create-summary') as HTMLInputElement).value = 'Failing entry';
    await (view as any)._submitCreateForm();

    expect(Modal.isOpen('raid-create')).toBe(true);

    Modal.closeAll();
    delete (window as any).overlordSocket;
  });
});

// ─── RaidLogView edit form ────────────────────────────────────

describe('RaidLogView — edit form', () => {
  it('opens edit form pre-filled with entry data', async () => {
    const { RaidLogView } = await import('../../../public/ui/views/raid-log-view.js');
    const { Modal } = await import('../../../public/ui/components/modal.js');
    const el = document.createElement('div');
    const view = new RaidLogView(el);
    view.mount();

    const entry = {
      id: 'r1',
      type: 'risk',
      summary: 'API risk',
      rationale: 'Rate limits',
      decided_by: 'architect',
      affected_areas: ['api', 'auth'],
      status: 'active',
      phase: 'strategy'
    };

    (view as any)._openEditForm(entry);
    await new Promise(r => setTimeout(r, 50));

    expect(Modal.isOpen('raid-edit')).toBe(true);
    expect((document.getElementById('raid-edit-summary') as HTMLInputElement).value).toBe('API risk');
    expect((document.getElementById('raid-edit-decided-by') as HTMLInputElement).value).toBe('architect');
    expect((document.getElementById('raid-edit-areas') as HTMLInputElement).value).toBe('api, auth');

    Modal.closeAll();
  });

  it('calls editRaidEntry and closes modal on valid submit', async () => {
    const { RaidLogView } = await import('../../../public/ui/views/raid-log-view.js');
    const { Modal } = await import('../../../public/ui/components/modal.js');
    const el = document.createElement('div');
    const view = new RaidLogView(el);
    view.mount();

    (window as any).overlordSocket = {
      editRaidEntry: vi.fn().mockResolvedValue({ ok: true, data: { id: 'r1', summary: 'Updated' } }),
      fetchRaidEntries: vi.fn(),
    };

    const entry = { id: 'r1', type: 'risk', summary: 'Old', rationale: '', decided_by: '', affected_areas: [], status: 'active', phase: 'strategy' };
    (view as any)._openEditForm(entry);
    await new Promise(r => setTimeout(r, 50));

    (document.getElementById('raid-edit-summary') as HTMLInputElement).value = 'Updated summary';
    await (view as any)._submitEditForm('r1');

    expect((window as any).overlordSocket.editRaidEntry).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'r1', summary: 'Updated summary' })
    );
    expect(Modal.isOpen('raid-edit')).toBe(false);

    Modal.closeAll();
    delete (window as any).overlordSocket;
  });

  it('shows validation error when summary is empty on edit submit', async () => {
    const { RaidLogView } = await import('../../../public/ui/views/raid-log-view.js');
    const { Modal } = await import('../../../public/ui/components/modal.js');
    const el = document.createElement('div');
    const view = new RaidLogView(el);
    view.mount();

    const entry = { id: 'r1', type: 'risk', summary: 'Test', rationale: '', decided_by: '', affected_areas: [], status: 'active', phase: 'strategy' };
    (view as any)._openEditForm(entry);
    await new Promise(r => setTimeout(r, 50));

    (document.getElementById('raid-edit-summary') as HTMLInputElement).value = '';
    await (view as any)._submitEditForm('r1');

    const summaryInput = document.getElementById('raid-edit-summary');
    expect(summaryInput?.classList.contains('input-error')).toBe(true);

    Modal.closeAll();
  });
});
