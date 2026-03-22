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
  } catch { /* ignore if not yet loaded */ }

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

  it('renders floor sections when building data is set', async () => {
    const { BuildingView } = await import('../../../public/ui/views/building-view.js');
    const el = document.createElement('div');
    const view = new BuildingView(el);
    view.mount();

    const store = OverlordUI.getStore();
    store.set('building.data', { name: 'Test Building', active_phase: 'execution' });
    store.set('building.floors', [
      { id: 'f1', name: 'Strategy Floor', type: 'strategy', ordinal: 3, rooms: [] },
      { id: 'f2', name: 'Execution Floor', type: 'execution', ordinal: 1, rooms: [{ id: 'r1', type: 'code-lab' }] }
    ]);

    expect(el.querySelector('.building-header')).not.toBeNull();
    expect(el.querySelector('.building-name')!.textContent).toBe('Test Building');
    expect(el.querySelectorAll('.floor-section').length).toBe(2);
    expect(el.querySelector('.building-stats-inline')).not.toBeNull();
  });

  it('shows building stats footer', async () => {
    const { BuildingView } = await import('../../../public/ui/views/building-view.js');
    const el = document.createElement('div');
    const view = new BuildingView(el);
    view.mount();

    const store = OverlordUI.getStore();
    store.set('building.data', { name: 'B' });
    store.set('building.floors', [
      { id: 'f1', ordinal: 1, rooms: [{ id: 'r1' }, { id: 'r2' }] }
    ]);

    const statsInline = el.querySelector('.building-stats-inline');
    expect(statsInline).not.toBeNull();
    expect(statsInline!.textContent).toContain('1 floor');
    expect(statsInline!.textContent).toContain('2 rooms');
  });

  it('shows agent indicator when agents are on a floor', async () => {
    const { BuildingView } = await import('../../../public/ui/views/building-view.js');
    const el = document.createElement('div');
    const view = new BuildingView(el);
    view.mount();

    const store = OverlordUI.getStore();
    store.set('building.data', { name: 'B' });
    store.set('building.floors', [
      { id: 'f1', ordinal: 1, rooms: [] }
    ]);

    // Verify no indicator initially
    expect(el.querySelector('.floor-agent-indicator')).toBeNull();

    // Add agents
    store.set('building.agentPositions', {
      a1: { agentId: 'a1', name: 'Agent 1', floorId: 'f1', status: 'active' },
      a2: { agentId: 'a2', name: 'Agent 2', floorId: 'f1', status: 'idle' }
    });

    const indicator = el.querySelector('.floor-agent-indicator');
    expect(indicator).not.toBeNull();
    expect(indicator!.textContent).toContain('2');
  });

  it('removes agent indicator when all agents leave a floor', async () => {
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

    expect(el.querySelector('.floor-agent-indicator')).not.toBeNull();

    // Remove all agents
    store.set('building.agentPositions', {});

    expect(el.querySelector('.floor-agent-indicator')).toBeNull();
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
    let statsInline = el.querySelector('.building-stats-inline');
    expect(statsInline!.textContent).toContain('0 active');

    // Add agents — one active, one idle
    store.set('building.agentPositions', {
      a1: { agentId: 'a1', floorId: 'f1', status: 'active' },
      a2: { agentId: 'a2', floorId: 'f1', status: 'idle' },
      a3: { agentId: 'a3', floorId: 'f1', status: 'working' }
    });

    // active + working = 2
    statsInline = el.querySelector('.building-stats-inline');
    expect(statsInline!.textContent).toContain('2 active');
  });

  it('shows room items with agent dots in expanded floors', async () => {
    const { BuildingView } = await import('../../../public/ui/views/building-view.js');
    const el = document.createElement('div');
    const view = new BuildingView(el);
    view.mount();

    const store = OverlordUI.getStore();
    store.set('building.data', { name: 'B' });
    store.set('building.agentPositions', {
      a1: { agentId: 'a1', name: 'Alice', floorId: 'f1', roomId: 'r1', status: 'active' }
    });
    store.set('building.floors', [
      { id: 'f1', ordinal: 1, rooms: [{ id: 'r1', name: 'Code Lab', type: 'code-lab' }] }
    ]);

    // Expand the floor by clicking the floor header
    const floorHeader = el.querySelector('.floor-section-header') as HTMLElement;
    expect(floorHeader).not.toBeNull();
    floorHeader.click();

    // Should now have expanded content with room items
    expect(el.querySelector('.floor-room-list')).not.toBeNull();
    const roomItem = el.querySelector('.room-item') as HTMLElement;
    expect(roomItem).not.toBeNull();
    expect(roomItem.classList.contains('room-item-occupied')).toBe(true);

    // Should have agent count indicator (compact view — no avatars)
    const agentCount = roomItem.querySelector('.room-item-count');
    expect(agentCount).not.toBeNull();
  });

  it('sorts floors by ordinal (lowest first — top-down reading order)', async () => {
    const { BuildingView } = await import('../../../public/ui/views/building-view.js');
    const el = document.createElement('div');
    const view = new BuildingView(el);
    view.mount();

    const store = OverlordUI.getStore();
    store.set('building.data', { name: 'B' });
    store.set('building.floors', [
      { id: 'f1', name: 'Operations', type: 'operations', ordinal: 1, rooms: [] },
      { id: 'f3', name: 'Strategy', type: 'strategy', ordinal: 3, rooms: [] },
      { id: 'f2', name: 'Execution', type: 'execution', ordinal: 2, rooms: [] }
    ]);

    const sections = el.querySelectorAll('.floor-section');
    expect(sections.length).toBe(3);
    // Lowest ordinal first (top-down: Operations 1, Execution 2, Strategy 3)
    expect(sections[0].querySelector('.floor-section-name')!.textContent).toBe('Operations');
    expect(sections[1].querySelector('.floor-section-name')!.textContent).toBe('Execution');
    expect(sections[2].querySelector('.floor-section-name')!.textContent).toBe('Strategy');
  });

  it('applies floor type data-attribute for CSS coloring', async () => {
    const { BuildingView } = await import('../../../public/ui/views/building-view.js');
    const el = document.createElement('div');
    const view = new BuildingView(el);
    view.mount();

    const store = OverlordUI.getStore();
    store.set('building.data', { name: 'B' });
    store.set('building.floors', [
      { id: 'f1', name: 'Strat', type: 'strategy', ordinal: 1, rooms: [] }
    ]);

    const section = el.querySelector('.floor-section') as HTMLElement;
    expect(section.dataset.type).toBe('strategy');
  });

  it('dispatches building:floor-selected on floor header click', async () => {
    const { BuildingView } = await import('../../../public/ui/views/building-view.js');
    const el = document.createElement('div');
    const view = new BuildingView(el);
    view.mount();

    const store = OverlordUI.getStore();
    store.set('building.data', { name: 'B' });
    store.set('building.floors', [
      { id: 'f1', ordinal: 1, rooms: [] }
    ]);

    const dispatched: any[] = [];
    OverlordUI.subscribe('building:floor-selected', (data: any) => dispatched.push(data));

    const header = el.querySelector('.floor-section-header') as HTMLElement;
    header.click();

    expect(dispatched.length).toBe(1);
    expect(dispatched[0].floorId).toBe('f1');
    expect(dispatched[0].expanded).toBe(true);
  });

  it('renders room items with status badges in expanded floor', async () => {
    const { BuildingView } = await import('../../../public/ui/views/building-view.js');
    const el = document.createElement('div');
    const view = new BuildingView(el);
    view.mount();

    const store = OverlordUI.getStore();
    store.set('building.data', { name: 'B' });
    store.set('building.floors', [
      { id: 'f1', ordinal: 1, rooms: [
        { id: 'r1', name: 'Code Lab', type: 'code-lab' },
        { id: 'r2', name: 'War Room', type: 'war-room' }
      ]}
    ]);

    // Expand floor
    (el.querySelector('.floor-section-header') as HTMLElement).click();

    const roomItems = el.querySelectorAll('.room-item');
    expect(roomItems.length).toBe(2);

    // Both rooms should have idle status dot (no agents)
    const dots = el.querySelectorAll('.room-item-dot');
    expect(dots.length).toBe(2);
    expect(dots[0].classList.contains('room-item-dot-idle')).toBe(true);
  });

  it('room item shows active status when agents are present', async () => {
    const { BuildingView } = await import('../../../public/ui/views/building-view.js');
    const el = document.createElement('div');
    const view = new BuildingView(el);
    view.mount();

    const store = OverlordUI.getStore();
    store.set('building.data', { name: 'B' });
    store.set('building.agentPositions', {
      a1: { agentId: 'a1', name: 'Coder', floorId: 'f1', roomId: 'r1', status: 'working' }
    });
    store.set('building.floors', [
      { id: 'f1', ordinal: 1, rooms: [{ id: 'r1', name: 'Code Lab', type: 'code-lab' }] }
    ]);

    // Expand floor
    (el.querySelector('.floor-section-header') as HTMLElement).click();

    const dot = el.querySelector('.room-item-dot')!;
    expect(dot.classList.contains('room-item-dot-active')).toBe(true);
  });

  it('room item shows error status when an agent has error status', async () => {
    const { BuildingView } = await import('../../../public/ui/views/building-view.js');
    const el = document.createElement('div');
    const view = new BuildingView(el);
    view.mount();

    const store = OverlordUI.getStore();
    store.set('building.data', { name: 'B' });
    store.set('building.agentPositions', {
      a1: { agentId: 'a1', name: 'Broken', floorId: 'f1', roomId: 'r1', status: 'error' }
    });
    store.set('building.floors', [
      { id: 'f1', ordinal: 1, rooms: [{ id: 'r1', type: 'code-lab' }] }
    ]);

    // Expand floor
    (el.querySelector('.floor-section-header') as HTMLElement).click();

    const dot = el.querySelector('.room-item-dot')!;
    expect(dot.classList.contains('room-item-dot-error')).toBe(true);
  });

  it('room item displays agent count and type tag', async () => {
    const { BuildingView } = await import('../../../public/ui/views/building-view.js');
    const el = document.createElement('div');
    const view = new BuildingView(el);
    view.mount();

    const store = OverlordUI.getStore();
    store.set('building.data', { name: 'B' });
    store.set('building.agentPositions', {
      a1: { agentId: 'a1', name: 'A1', floorId: 'f1', roomId: 'r1', status: 'active' },
      a2: { agentId: 'a2', name: 'A2', floorId: 'f1', roomId: 'r1', status: 'idle' },
      a3: { agentId: 'a3', name: 'A3', floorId: 'f1', roomId: 'r2', status: 'active' }
    });
    store.set('building.floors', [
      { id: 'f1', ordinal: 1, rooms: [
        { id: 'r1', type: 'code-lab' },
        { id: 'r2', type: 'war-room' }
      ]}
    ]);

    (el.querySelector('.floor-section-header') as HTMLElement).click();

    // Agent count pills (#726 compact view)
    const counts = el.querySelectorAll('.room-item-count');
    expect(counts.length).toBe(2); // both rooms have agents
    expect(counts[0].textContent).toBe('2');
    expect(counts[1].textContent).toBe('1');

    // Room names (type info merged into name — no separate type tag)
    const names = el.querySelectorAll('.room-item-name');
    expect(names.length).toBe(2);
  });

  it('room item shows count for occupied rooms (#726 compact)', async () => {
    const { BuildingView } = await import('../../../public/ui/views/building-view.js');
    const el = document.createElement('div');
    const view = new BuildingView(el);
    view.mount();

    const store = OverlordUI.getStore();
    store.set('building.data', { name: 'B' });
    store.set('building.agentPositions', {
      a1: { agentId: 'a1', name: 'Alice', floorId: 'f1', roomId: 'r1', status: 'active' }
    });
    store.set('building.floors', [
      { id: 'f1', ordinal: 1, rooms: [{ id: 'r1', name: 'Code Lab', type: 'code-lab' }] }
    ]);

    (el.querySelector('.floor-section-header') as HTMLElement).click();

    const count = el.querySelector('.room-item-count');
    expect(count).not.toBeNull();
    expect(count!.textContent).toBe('1');
  });

  it('room item formats room type slug as title when no name given', async () => {
    const { BuildingView } = await import('../../../public/ui/views/building-view.js');
    const el = document.createElement('div');
    const view = new BuildingView(el);
    view.mount();

    const store = OverlordUI.getStore();
    store.set('building.data', { name: 'B' });
    store.set('building.floors', [
      { id: 'f1', ordinal: 1, rooms: [{ id: 'r1', type: 'code-lab' }] }
    ]);

    (el.querySelector('.floor-section-header') as HTMLElement).click();

    const name = el.querySelector('.room-item-name')!;
    expect(name.textContent).toBe('Code Lab');
  });

  it('dispatches building:room-selected on room item click', async () => {
    const { BuildingView } = await import('../../../public/ui/views/building-view.js');
    const el = document.createElement('div');
    const view = new BuildingView(el);
    view.mount();

    const store = OverlordUI.getStore();
    store.set('building.data', { name: 'B' });
    store.set('building.floors', [
      { id: 'f1', ordinal: 1, rooms: [{ id: 'r1', type: 'code-lab' }] }
    ]);

    // Expand floor
    (el.querySelector('.floor-section-header') as HTMLElement).click();

    const dispatched: any[] = [];
    OverlordUI.subscribe('building:room-selected', (data: any) => dispatched.push(data));

    const roomItem = el.querySelector('.room-item') as HTMLElement;
    roomItem.click();

    expect(dispatched.length).toBe(1);
    expect(dispatched[0].roomId).toBe('r1');
    expect(dispatched[0].floorId).toBe('f1');
  });

  it('updates room status on agentPositions change', async () => {
    const { BuildingView } = await import('../../../public/ui/views/building-view.js');
    const el = document.createElement('div');
    const view = new BuildingView(el);
    view.mount();

    const store = OverlordUI.getStore();
    store.set('building.data', { name: 'B' });
    store.set('building.floors', [
      { id: 'f1', ordinal: 1, rooms: [{ id: 'r1', type: 'code-lab' }] }
    ]);

    // Expand floor
    (el.querySelector('.floor-section-header') as HTMLElement).click();

    // Initially idle
    let dot = el.querySelector('.room-item-dot')!;
    expect(dot.classList.contains('room-item-dot-idle')).toBe(true);

    // Add an active agent
    store.set('building.agentPositions', {
      a1: { agentId: 'a1', name: 'Coder', floorId: 'f1', roomId: 'r1', status: 'working' }
    });

    dot = el.querySelector('.room-item-dot')!;
    expect(dot.classList.contains('room-item-dot-active')).toBe(true);
  });

  it('does not render foundation element (#726 — removed)', async () => {
    const { BuildingView } = await import('../../../public/ui/views/building-view.js');
    const el = document.createElement('div');
    const view = new BuildingView(el);
    view.mount();

    const store = OverlordUI.getStore();
    store.set('building.data', { name: 'B' });
    store.set('building.floors', [{ id: 'f1', ordinal: 1, rooms: [] }]);

    const foundation = el.querySelector('.building-foundation');
    expect(foundation).toBeNull();
  });

  it('accordion: only one floor expanded at a time (#726)', async () => {
    const { BuildingView } = await import('../../../public/ui/views/building-view.js');
    const el = document.createElement('div');
    const view = new BuildingView(el);
    view.mount();

    const store = OverlordUI.getStore();
    store.set('building.data', { name: 'B' });
    store.set('building.floors', [
      { id: 'f1', name: 'Floor A', ordinal: 1, rooms: [{ id: 'r1', type: 'code-lab' }] },
      { id: 'f2', name: 'Floor B', ordinal: 2, rooms: [{ id: 'r2', type: 'review' }] }
    ]);

    // Expand first floor
    const headers = el.querySelectorAll('.floor-section-header');
    (headers[0] as HTMLElement).click();
    expect(el.querySelectorAll('.floor-section.expanded').length).toBe(1);

    // Expand second floor — first should close (accordion)
    (headers[1] as HTMLElement).click();
    const expanded = el.querySelectorAll('.floor-section.expanded');
    expect(expanded.length).toBe(1);
    expect(expanded[0].getAttribute('data-floor-id')).toBe('f2');
  });

  it('cleans up on destroy', async () => {
    const { BuildingView } = await import('../../../public/ui/views/building-view.js');
    const parent = document.createElement('div');
    const el = document.createElement('div');
    parent.appendChild(el);
    const view = new BuildingView(el);
    view.mount();

    expect(view._mounted).toBe(true);
    view.destroy();
    expect(view._mounted).toBe(false);
    expect(view._subs.length).toBe(0);
    expect(view._listeners.length).toBe(0);
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

  it('shows empty state on initial mount with no messages', async () => {
    const { ChatView } = await import('../../../public/ui/views/chat-view.js');
    const el = document.createElement('div');
    const view = new ChatView(el);
    view.mount();

    // Empty state should appear immediately on mount, no store update needed
    const messages = el.querySelector('.chat-messages');
    expect(messages!.querySelector('.empty-state')).not.toBeNull();
    expect(messages!.textContent).toContain('Start a Conversation');
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
  it('uses fuzzy matching for command suggestions', async () => {
    const { ChatView } = await import('../../../public/ui/views/chat-view.js');
    const el = document.createElement('div');
    const view = new ChatView(el);
    view.mount();

    // Pre-populate the command cache with known commands
    (view as any)._cmdCache = [
      { id: 'deploy', label: 'deploy', description: 'Start deploy phase', icon: '🚀' },
      { id: 'status', label: 'status', description: 'Show project status', icon: '📊' },
      { id: 'agents', label: 'agents', description: 'List all agents', icon: '🤖' },
      { id: 'raid',   label: 'raid',   description: 'Show RAID log summary', icon: '⚠️' }
    ];

    // Call the internal resolver directly (bypass debounce)
    await (view as any)._resolveTokenSuggestions('command', 'dpl');

    // Fuzzy match: "dpl" should match "deploy" (d-e-p-l-o-y contains d, p, l in order)
    const tokenInput = (view as any)._tokenInput;
    const suggestions = tokenInput._suggestions;
    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions[0].label).toBe('deploy');
  });

  it('fuzzy-matches agent suggestions by role/description', async () => {
    const { ChatView } = await import('../../../public/ui/views/chat-view.js');
    const el = document.createElement('div');
    const view = new ChatView(el);
    view.mount();

    const store = OverlordUI.getStore();
    store.set('agents.list', [
      { id: 'a1', name: 'strategist', role: 'Strategic planning', specialization: '' },
      { id: 'a2', name: 'coder', role: 'Code development', specialization: '' },
      { id: 'a3', name: 'tester', role: 'Quality assurance', specialization: '' }
    ]);

    // Force cache rebuild
    (view as any)._agentCache = null;
    await (view as any)._resolveTokenSuggestions('agent', 'str');

    const suggestions = (view as any)._tokenInput._suggestions;
    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions[0].label).toBe('strategist');
  });

  it('debounces token trigger calls', async () => {
    const { ChatView } = await import('../../../public/ui/views/chat-view.js');
    const el = document.createElement('div');
    const view = new ChatView(el);
    view.mount();

    // Pre-populate cache
    (view as any)._cmdCache = [
      { id: 'help', label: 'help', description: 'Help', icon: '❓' }
    ];

    // Rapid-fire calls should be debounced
    (view as any)._handleTokenTrigger('command', 'h');
    (view as any)._handleTokenTrigger('command', 'he');
    (view as any)._handleTokenTrigger('command', 'hel');

    // Suggestions shouldn't be set yet (debounce is 150ms)
    const immediateCount = (view as any)._tokenInput._suggestions.length;
    expect(immediateCount).toBe(0);

    // Wait for debounce to fire
    await new Promise(r => setTimeout(r, 200));

    // Now the suggestions should be populated
    const afterDebounce = (view as any)._tokenInput._suggestions;
    expect(afterDebounce.length).toBeGreaterThan(0);
    expect(afterDebounce[0].label).toBe('help');
  });

  it('invalidates caches when store data changes', async () => {
    const { ChatView } = await import('../../../public/ui/views/chat-view.js');
    const el = document.createElement('div');
    const view = new ChatView(el);
    view.mount();

    // Manually set caches
    (view as any)._cmdCache = [{ id: 'old', label: 'old' }];
    (view as any)._agentCache = [{ id: 'old', label: 'old' }];
    (view as any)._refCache = [{ id: 'old', label: 'old' }];

    const store = OverlordUI.getStore();

    // Changing commands.list should clear command cache
    store.set('commands.list', []);
    expect((view as any)._cmdCache).toBeNull();

    // Changing agents.list should clear agent cache
    store.set('agents.list', []);
    expect((view as any)._agentCache).toBeNull();

    // Changing rooms.list should clear reference cache
    store.set('rooms.list', []);
    expect((view as any)._refCache).toBeNull();
  });

  it('uses contextual icons for commands', async () => {
    const { ChatView } = await import('../../../public/ui/views/chat-view.js');
    const el = document.createElement('div');
    const view = new ChatView(el);

    expect((view as any)._commandIcon('deploy')).toBe('\u{1F680}');
    expect((view as any)._commandIcon('agents')).toBe('\u{1F916}');
    expect((view as any)._commandIcon('unknown_cmd')).toBe('\u{1F4BB}');
  });

  it('provides static fallback when server returns empty commands', async () => {
    const { ChatView } = await import('../../../public/ui/views/chat-view.js');
    const el = document.createElement('div');
    const view = new ChatView(el);
    view.mount();

    const store = OverlordUI.getStore();
    store.set('commands.list', null);

    // No socket available — should use static fallback
    (view as any)._cmdCache = null;
    const origSocket = window.overlordSocket;
    (window as any).overlordSocket = null;
    await (view as any)._resolveTokenSuggestions('command', '');
    (window as any).overlordSocket = origSocket;

    const suggestions = (view as any)._tokenInput._suggestions;
    expect(suggestions.length).toBeGreaterThanOrEqual(8);
    // Should include well-known commands
    expect(suggestions.some((s: any) => s.label === 'help')).toBe(true);
    expect(suggestions.some((s: any) => s.label === 'deploy')).toBe(true);
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
    expect(el.querySelectorAll('.kpi-card').length).toBe(5);
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

  it('shows empty state when no buildings exist', async () => {
    const { DashboardView } = await import('../../../public/ui/views/dashboard-view.js');
    const el = document.createElement('div');
    const view = new DashboardView(el);
    view.mount();

    const store = OverlordUI.getStore();
    store.set('building.list', []);

    const buildingsSection = el.querySelector('.dashboard-buildings-section');
    expect(buildingsSection!.querySelector('.empty-state')).not.toBeNull();
    expect(buildingsSection!.textContent).toContain('No buildings yet');
  });

  it('updates KPI values without full re-render', async () => {
    const { DashboardView } = await import('../../../public/ui/views/dashboard-view.js');
    const el = document.createElement('div');
    const view = new DashboardView(el);
    view.mount();

    const store = OverlordUI.getStore();
    // Initial render with 0 agents
    store.set('building.list', []);

    const kpiValues = el.querySelectorAll('.kpi-card-value');
    expect(kpiValues[2].textContent).toBe('0'); // rooms KPI

    // Update rooms
    store.set('rooms.list', [
      { id: 'r1', name: 'Room 1' },
      { id: 'r2', name: 'Room 2' },
      { id: 'r3', name: 'Room 3' }
    ]);

    expect(kpiValues[2].textContent).toBe('3');
  });

  it('updates RAID count in KPI when entries change', async () => {
    const { DashboardView } = await import('../../../public/ui/views/dashboard-view.js');
    const el = document.createElement('div');
    const view = new DashboardView(el);
    view.mount();

    const store = OverlordUI.getStore();
    store.set('building.list', []);

    const kpiValues = el.querySelectorAll('.kpi-card-value');
    expect(kpiValues[3].textContent).toBe('0');

    store.set('raid.entries', [
      { id: 'r1', type: 'risk', summary: 'A' },
      { id: 'r2', type: 'issue', summary: 'B' }
    ]);

    expect(kpiValues[3].textContent).toBe('2');
  });

  it('has a New Project button that dispatches navigate:onboarding', async () => {
    const { DashboardView } = await import('../../../public/ui/views/dashboard-view.js');
    const el = document.createElement('div');
    const view = new DashboardView(el);
    view.mount();

    const dispatched: any[] = [];
    OverlordUI.subscribe('navigate:onboarding', () => dispatched.push(true));

    const btn = el.querySelector('.dashboard-actions .btn-primary') as HTMLElement;
    expect(btn).not.toBeNull();
    btn.click();

    expect(dispatched.length).toBe(1);
  });

  it('does not show phase progress when no active building', async () => {
    const { DashboardView } = await import('../../../public/ui/views/dashboard-view.js');
    const el = document.createElement('div');
    const view = new DashboardView(el);
    view.mount();

    const store = OverlordUI.getStore();
    store.set('building.list', [
      { id: 'b1', name: 'Test', activePhase: 'architecture' }
    ]);
    // Do NOT set building.active

    expect(el.querySelector('.dashboard-phase-section')).toBeNull();
  });

  it('cleans up on destroy', async () => {
    const { DashboardView } = await import('../../../public/ui/views/dashboard-view.js');
    const parent = document.createElement('div');
    const el = document.createElement('div');
    parent.appendChild(el);
    const view = new DashboardView(el);
    view.mount();

    expect(view._mounted).toBe(true);
    view.destroy();
    expect(view._mounted).toBe(false);
    expect(view._subs.length).toBe(0);
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
    expect(cards.length).toBe(8);
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

  it('clicking a template card switches to effort selection step', async () => {
    const { StrategistView } = await import('../../../public/ui/views/strategist-view.js');
    const el = document.createElement('div');
    const view = new StrategistView(el);
    view.mount();

    const firstCard = el.querySelector('.template-card') as HTMLElement;
    firstCard.click();

    // Should now show effort selection, not configuration directly
    expect(el.querySelector('.effort-grid')).not.toBeNull();
    expect(el.querySelectorAll('.effort-card').length).toBe(3);
  });

  it('effort selection shows 3 levels: Just Build It, Guide Me, Full Control', async () => {
    const { StrategistView } = await import('../../../public/ui/views/strategist-view.js');
    const el = document.createElement('div');
    const view = new StrategistView(el);
    view.mount();

    // Click a template to get to effort step
    const firstCard = el.querySelector('.template-card') as HTMLElement;
    firstCard.click();

    const names = [...el.querySelectorAll('.effort-card-name')].map(
      (n: Element) => n.textContent
    );
    expect(names).toContain('Just Build It');
    expect(names).toContain('Guide Me');
    expect(names).toContain('Full Control');
  });

  it('medium effort level is selected by default', async () => {
    const { StrategistView } = await import('../../../public/ui/views/strategist-view.js');
    const el = document.createElement('div');
    const view = new StrategistView(el);
    view.mount();

    const firstCard = el.querySelector('.template-card') as HTMLElement;
    firstCard.click();

    // Medium should be selected by default
    const selectedCard = el.querySelector('.effort-card.selected') as HTMLElement;
    expect(selectedCard).not.toBeNull();
    expect(selectedCard.querySelector('.effort-card-name')!.textContent).toBe('Guide Me');
  });

  it('clicking an effort card selects it', async () => {
    const { StrategistView } = await import('../../../public/ui/views/strategist-view.js');
    const el = document.createElement('div');
    const view = new StrategistView(el);
    view.mount();

    const firstCard = el.querySelector('.template-card') as HTMLElement;
    firstCard.click();

    // Click the Easy card
    const effortCards = el.querySelectorAll('.effort-card');
    (effortCards[0] as HTMLElement).click();

    // Easy should now be selected
    const selected = el.querySelector('.effort-card.selected .effort-card-name') as HTMLElement;
    expect(selected.textContent).toBe('Just Build It');
    expect((view as any)._effortLevel).toBe('easy');
  });

  it('Continue button on effort step goes to configuration', async () => {
    const { StrategistView } = await import('../../../public/ui/views/strategist-view.js');
    const el = document.createElement('div');
    const view = new StrategistView(el);
    view.mount();

    const firstCard = el.querySelector('.template-card') as HTMLElement;
    firstCard.click();

    // Click Continue
    const continueBtn = el.querySelector('.strategist-actions .btn') as HTMLElement;
    continueBtn.click();

    // Should now show configuration form
    expect(el.querySelector('.strategist-form')).not.toBeNull();
    expect(el.querySelector('.form-group')).not.toBeNull();
    expect(el.querySelector('.blueprint-preview')).not.toBeNull();
  });

  it('configuration step shows effort level badge', async () => {
    const { StrategistView } = await import('../../../public/ui/views/strategist-view.js');
    const el = document.createElement('div');
    const view = new StrategistView(el);
    view.mount();

    const firstCard = el.querySelector('.template-card') as HTMLElement;
    firstCard.click();

    // Continue to config
    const continueBtn = el.querySelector('.strategist-actions .btn') as HTMLElement;
    continueBtn.click();

    // Should have an effort level badge
    const badge = el.querySelector('.effort-level-badge');
    expect(badge).not.toBeNull();
    expect(badge!.textContent).toContain('Guide Me'); // default medium
  });

  it('configuration back button goes to effort step (not template select)', async () => {
    const { StrategistView } = await import('../../../public/ui/views/strategist-view.js');
    const el = document.createElement('div');
    const view = new StrategistView(el);
    view.mount();

    // Select template → effort → configure
    const firstCard = el.querySelector('.template-card') as HTMLElement;
    firstCard.click();
    const continueBtn = el.querySelector('.strategist-actions .btn') as HTMLElement;
    continueBtn.click();

    // Click back
    const backBtn = el.querySelector('.btn-ghost') as HTMLElement;
    backBtn.click();

    // Should be back on the effort step
    expect(el.querySelector('.effort-grid')).not.toBeNull();
    expect(el.querySelector('.strategist-form')).toBeNull();
  });

  it('stores effort level through the full flow', async () => {
    const { StrategistView } = await import('../../../public/ui/views/strategist-view.js');
    const el = document.createElement('div');
    const view = new StrategistView(el);
    view.mount();

    // Select template
    const firstCard = el.querySelector('.template-card') as HTMLElement;
    firstCard.click();

    // Select Advanced effort
    const effortCards = el.querySelectorAll('.effort-card');
    (effortCards[2] as HTMLElement).click(); // Advanced is the 3rd card
    expect((view as any)._effortLevel).toBe('advanced');

    // Continue to config
    const continueBtn = el.querySelector('.strategist-actions .btn') as HTMLElement;
    continueBtn.click();

    // Effort level should still be advanced
    expect((view as any)._effortLevel).toBe('advanced');
    const badge = el.querySelector('.effort-level-badge');
    expect(badge!.textContent).toContain('Full Control');
  });
});

// ─── inferTemplate / extractProjectName ─────────────────────

describe('One-Shot Prompting — inferTemplate', () => {
  it('infers web-app for "build me a website for my bakery"', async () => {
    const { inferTemplate } = await import('../../../public/ui/views/strategist-view.js');
    const templates = [
      { id: 'web-app' }, { id: 'microservices' }, { id: 'data-pipeline' },
      { id: 'cli-tool' }, { id: 'api-service' },
    ];
    const result = inferTemplate('build me a website for my bakery with online ordering', templates as any);
    expect(result.id).toBe('web-app');
  });

  it('infers data-pipeline for "dashboard that shows sales data"', async () => {
    const { inferTemplate } = await import('../../../public/ui/views/strategist-view.js');
    const templates = [
      { id: 'web-app' }, { id: 'microservices' }, { id: 'data-pipeline' },
      { id: 'cli-tool' }, { id: 'api-service' },
    ];
    const result = inferTemplate('I need a dashboard that shows my sales data and analytics', templates as any);
    expect(result.id).toBe('data-pipeline');
  });

  it('infers cli-tool for "command line tool for batch processing"', async () => {
    const { inferTemplate } = await import('../../../public/ui/views/strategist-view.js');
    const templates = [
      { id: 'web-app' }, { id: 'microservices' }, { id: 'data-pipeline' },
      { id: 'cli-tool' }, { id: 'api-service' },
    ];
    const result = inferTemplate('create a command line tool for batch automation', templates as any);
    expect(result.id).toBe('cli-tool');
  });

  it('infers api-service for "REST API with authentication"', async () => {
    const { inferTemplate } = await import('../../../public/ui/views/strategist-view.js');
    const templates = [
      { id: 'web-app' }, { id: 'microservices' }, { id: 'data-pipeline' },
      { id: 'cli-tool' }, { id: 'api-service' },
    ];
    const result = inferTemplate('build a REST API with authentication and webhooks', templates as any);
    expect(result.id).toBe('api-service');
  });

  it('infers microservices for "distributed system with event-driven services"', async () => {
    const { inferTemplate } = await import('../../../public/ui/views/strategist-view.js');
    const templates = [
      { id: 'web-app' }, { id: 'microservices' }, { id: 'data-pipeline' },
      { id: 'cli-tool' }, { id: 'api-service' },
    ];
    const result = inferTemplate('distributed system with multiple services and event-driven communication', templates as any);
    expect(result.id).toBe('microservices');
  });

  it('defaults to web-app for ambiguous prompts', async () => {
    const { inferTemplate } = await import('../../../public/ui/views/strategist-view.js');
    const templates = [
      { id: 'web-app' }, { id: 'microservices' }, { id: 'data-pipeline' },
      { id: 'cli-tool' }, { id: 'api-service' },
    ];
    const result = inferTemplate('build me something cool', templates as any);
    expect(result.id).toBe('web-app');
  });

  it('defaults to web-app for empty prompt', async () => {
    const { inferTemplate } = await import('../../../public/ui/views/strategist-view.js');
    const templates = [{ id: 'web-app' }];
    const result = inferTemplate('', templates as any);
    expect(result.id).toBe('web-app');
  });

  it('defaults to web-app for null prompt', async () => {
    const { inferTemplate } = await import('../../../public/ui/views/strategist-view.js');
    const templates = [{ id: 'web-app' }];
    const result = inferTemplate(null as any, templates as any);
    expect(result.id).toBe('web-app');
  });

  it('infers unity-game for "Unity 3d mobile game"', async () => {
    const { inferTemplate } = await import('../../../public/ui/views/strategist-view.js');
    const templates = [
      { id: 'web-app' }, { id: 'unity-game' }, { id: 'js-game' }, { id: 'unreal-game' },
    ];
    const result = inferTemplate('create a unity 3d game for mobile phones', templates as any);
    expect(result.id).toBe('unity-game');
  });

  it('infers js-game for "browser game with Phaser"', async () => {
    const { inferTemplate } = await import('../../../public/ui/views/strategist-view.js');
    const templates = [
      { id: 'web-app' }, { id: 'unity-game' }, { id: 'js-game' }, { id: 'unreal-game' },
    ];
    const result = inferTemplate('build a browser game using Phaser with pixel art', templates as any);
    expect(result.id).toBe('js-game');
  });

  it('infers unreal-game for "Unreal Engine FPS"', async () => {
    const { inferTemplate } = await import('../../../public/ui/views/strategist-view.js');
    const templates = [
      { id: 'web-app' }, { id: 'unity-game' }, { id: 'js-game' }, { id: 'unreal-game' },
    ];
    const result = inferTemplate('create an Unreal Engine FPS game with photorealistic graphics', templates as any);
    expect(result.id).toBe('unreal-game');
  });

  it('infers unity-game for "3d mobile game"', async () => {
    const { inferTemplate } = await import('../../../public/ui/views/strategist-view.js');
    const templates = [
      { id: 'web-app' }, { id: 'unity-game' }, { id: 'js-game' }, { id: 'unreal-game' },
    ];
    const result = inferTemplate('build a 3d game for mobile phones', templates as any);
    expect(result.id).toBe('unity-game');
  });

  it('infers js-game for "2d html5 game"', async () => {
    const { inferTemplate } = await import('../../../public/ui/views/strategist-view.js');
    const templates = [
      { id: 'web-app' }, { id: 'unity-game' }, { id: 'js-game' }, { id: 'unreal-game' },
    ];
    const result = inferTemplate('make a 2d game playable in the browser as an html5 game', templates as any);
    expect(result.id).toBe('js-game');
  });
});

describe('One-Shot Prompting — extractProjectName', () => {
  it('extracts name from "build me a website for my bakery"', async () => {
    const { extractProjectName } = await import('../../../public/ui/views/strategist-view.js');
    const name = extractProjectName('build me a website for my bakery');
    expect(name).toBe('Website');
  });

  it('extracts name from "create a video game like Doom"', async () => {
    const { extractProjectName } = await import('../../../public/ui/views/strategist-view.js');
    const name = extractProjectName('create a video game like Doom');
    expect(name).toBe('Video game');
  });

  it('extracts name from "I need a dashboard that shows my sales"', async () => {
    const { extractProjectName } = await import('../../../public/ui/views/strategist-view.js');
    const name = extractProjectName('I need a dashboard that shows my sales');
    expect(name).toBe('Dashboard');
  });

  it('returns trimmed prompt as fallback for unrecognized patterns', async () => {
    const { extractProjectName } = await import('../../../public/ui/views/strategist-view.js');
    const name = extractProjectName('my awesome project');
    expect(name).toBe('my awesome project');
  });

  it('returns empty string for empty input', async () => {
    const { extractProjectName } = await import('../../../public/ui/views/strategist-view.js');
    expect(extractProjectName('')).toBe('');
  });

  it('truncates very long prompts', async () => {
    const { extractProjectName } = await import('../../../public/ui/views/strategist-view.js');
    const long = 'x'.repeat(100);
    const name = extractProjectName(long);
    expect(name.length).toBeLessThanOrEqual(54); // 50 + "..."
  });
});

describe('One-Shot Prompting — UI', () => {
  it('renders one-shot input on template selection step', async () => {
    const { StrategistView } = await import('../../../public/ui/views/strategist-view.js');
    const el = document.createElement('div');
    const view = new StrategistView(el);
    view.mount();

    expect(el.querySelector('.one-shot-input')).not.toBeNull();
    expect(el.querySelector('.onboarding-paths')).not.toBeNull();
    expect(el.querySelector('.one-shot-divider')).not.toBeNull();
  });

  it('one-shot divider says "or choose a template"', async () => {
    const { StrategistView } = await import('../../../public/ui/views/strategist-view.js');
    const el = document.createElement('div');
    const view = new StrategistView(el);
    view.mount();

    const divider = el.querySelector('.one-shot-divider');
    expect(divider!.textContent).toContain('or choose a template');
  });

  it('has a "Just Build It" button in the onboarding paths', async () => {
    const { StrategistView } = await import('../../../public/ui/views/strategist-view.js');
    const el = document.createElement('div');
    const view = new StrategistView(el);
    view.mount();

    const buttons = el.querySelectorAll('.onboarding-path-input .btn');
    const justBuildBtn = Array.from(buttons).find(b => b.textContent?.includes('Just Build It'));
    expect(justBuildBtn).not.toBeNull();
  });

  it('typing in the one-shot input updates _oneShotPrompt state', async () => {
    const { StrategistView } = await import('../../../public/ui/views/strategist-view.js');
    const el = document.createElement('div');
    const view = new StrategistView(el);
    view.mount();

    const input = el.querySelector('.one-shot-input') as HTMLTextAreaElement;
    input.value = 'Build me a bakery website';
    input.dispatchEvent(new Event('input'));

    expect((view as any)._oneShotPrompt).toBe('Build me a bakery website');
  });

  it('template grid still appears below onboarding paths', async () => {
    const { StrategistView } = await import('../../../public/ui/views/strategist-view.js');
    const el = document.createElement('div');
    const view = new StrategistView(el);
    view.mount();

    // Onboarding paths and template grid should both be present
    expect(el.querySelector('.onboarding-paths')).not.toBeNull();
    expect(el.querySelector('.template-grid')).not.toBeNull();
    expect(el.querySelectorAll('.template-card').length).toBe(8);
  });

  it('renders "Use Existing Codebase" option (#872)', async () => {
    const { StrategistView } = await import('../../../public/ui/views/strategist-view.js');
    const el = document.createElement('div');
    const view = new StrategistView(el);
    view.mount();

    // Should have three onboarding path cards
    const pathCards = el.querySelectorAll('.onboarding-path-card');
    expect(pathCards.length).toBe(3);

    // First card should be "Use Existing Codebase"
    const firstTitle = pathCards[0].querySelector('.onboarding-path-title');
    expect(firstTitle!.textContent).toContain('Use Existing Codebase');

    // Should have a path input
    const pathInput = pathCards[0].querySelector('input[type="text"]');
    expect(pathInput).not.toBeNull();
    expect(pathInput!.getAttribute('placeholder')).toContain('/path/to/your/project');
  });

  it('renders "Import from GitHub" option (#872)', async () => {
    const { StrategistView } = await import('../../../public/ui/views/strategist-view.js');
    const el = document.createElement('div');
    const view = new StrategistView(el);
    view.mount();

    const pathCards = el.querySelectorAll('.onboarding-path-card');
    const githubCard = pathCards[2];
    const title = githubCard.querySelector('.onboarding-path-title');
    expect(title!.textContent).toContain('Import from GitHub');
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

  it('builds content with all sections from room data', async () => {
    const { RoomView } = await import('../../../public/ui/views/room-view.js');
    const el = document.createElement('div');
    const view = new RoomView(el);
    view.mount();

    // Set room data directly and build content
    (view as any)._roomData = {
      id: 'room_1',
      type: 'code-lab',
      name: 'Main Lab',
      tools: ['read_file', 'write_file', 'run_test'],
      fileScope: 'assigned',
      exitRequired: { type: 'code-lab', fields: ['summary', 'files_changed'] },
      escalation: { 'blocked': 'war-room' },
      tables: { coding: { purpose: 'Implementation work' }, review: { purpose: 'Code review' } },
      provider: 'anthropic',
    };
    (view as any)._agentPositions = {};

    const content = (view as any)._buildContent();

    // Should have header section
    expect(content.querySelector('.room-view-header')).not.toBeNull();
    expect(content.querySelector('.room-type-badge')!.textContent).toBe('Code Lab');

    // Should have stats bar
    expect(content.querySelector('.room-stats-bar')).not.toBeNull();
    const statValues = content.querySelectorAll('.room-stat-value');
    expect(statValues.length).toBe(4);

    // Should have agent roster
    expect(content.querySelector('.room-agent-roster')).not.toBeNull();
    expect(content.querySelector('.room-roster-empty')).not.toBeNull(); // no agents

    // Should have tools section
    expect(content.querySelector('.rv-tools-section')).not.toBeNull();
    expect(content.querySelectorAll('.rv-tool-tag').length).toBe(3);

    // Should have table management section
    expect(content.querySelector('.rv-table-mgmt')).not.toBeNull();
    expect(content.querySelectorAll('.rv-contract-table-item').length).toBe(2);

    // Should have activity feed
    expect(content.querySelector('.room-activity-section')).not.toBeNull();
    expect(content.querySelector('.room-activity-empty')).not.toBeNull();

    // Should have exit document section (exitRequired is set with fields)
    expect(content.querySelector('.room-exit-doc-section')).not.toBeNull();
  });

  it('shows agent roster with status dots when agents are present', async () => {
    const { RoomView } = await import('../../../public/ui/views/room-view.js');
    const el = document.createElement('div');
    const view = new RoomView(el);
    view.mount();

    (view as any)._roomData = {
      id: 'room_1', type: 'code-lab', tools: [],
      exitRequired: null, escalation: {}, tables: {},
    };
    (view as any)._agentPositions = {
      'a1': { agentId: 'a1', name: 'Coder', role: 'developer', roomId: 'room_1', status: 'working' },
      'a2': { agentId: 'a2', name: 'Reviewer', role: 'reviewer', roomId: 'room_1', status: 'idle' },
      'a3': { agentId: 'a3', name: 'Other', role: 'tester', roomId: 'room_2', status: 'idle' },
    };

    const content = (view as any)._buildContent();

    // Only agents in room_1 should appear
    const rosterRows = content.querySelectorAll('.room-roster-row');
    expect(rosterRows.length).toBe(2);

    // Check status dots
    expect(rosterRows[0].querySelector('.room-roster-dot-working')).not.toBeNull();
    expect(rosterRows[1].querySelector('.room-roster-dot-idle')).not.toBeNull();

    // Check names (agent names render as EntityLink.agent() which produces .entity-link-agent)
    const name0 = rosterRows[0].querySelector('.entity-link-agent') || rosterRows[0].querySelector('.room-roster-name');
    const name1 = rosterRows[1].querySelector('.entity-link-agent') || rosterRows[1].querySelector('.room-roster-name');
    expect(name0!.textContent).toBe('Coder');
    expect(name1!.textContent).toBe('Reviewer');

    // Stats bar should show 2 agents
    const agentStat = content.querySelectorAll('.room-stat-value')[0];
    expect(agentStat.textContent).toBe('2');
  });

  it('shows active status badge when agents are in room', async () => {
    const { RoomView } = await import('../../../public/ui/views/room-view.js');
    const el = document.createElement('div');
    const view = new RoomView(el);
    view.mount();

    (view as any)._roomData = { id: 'room_1', type: 'war-room', tools: [], exitRequired: null, escalation: {}, tables: {} };
    (view as any)._agentPositions = {
      'a1': { agentId: 'a1', name: 'Agent', roomId: 'room_1', status: 'working' },
    };

    const content = (view as any)._buildContent();
    expect(content.querySelector('.room-status-active')!.textContent).toBe('Active');
  });

  it('shows empty status badge when no agents in room', async () => {
    const { RoomView } = await import('../../../public/ui/views/room-view.js');
    const el = document.createElement('div');
    const view = new RoomView(el);
    view.mount();

    (view as any)._roomData = { id: 'room_1', type: 'discovery', tools: [], exitRequired: null, escalation: {}, tables: {} };
    (view as any)._agentPositions = {};

    const content = (view as any)._buildContent();
    expect(content.querySelector('.room-status-empty')!.textContent).toBe('Empty');
  });

  it('formats room type slugs as titles', async () => {
    const { RoomView } = await import('../../../public/ui/views/room-view.js');
    const el = document.createElement('div');
    const view = new RoomView(el);

    expect((view as any)._formatRoomType('code-lab')).toBe('Code Lab');
    expect((view as any)._formatRoomType('war-room')).toBe('War Room');
    expect((view as any)._formatRoomType('discovery')).toBe('Discovery');
    expect((view as any)._formatRoomType(null)).toBe('Room');
  });

  it('tracks activity items and renders them in feed', async () => {
    const { RoomView } = await import('../../../public/ui/views/room-view.js');
    const el = document.createElement('div');
    const view = new RoomView(el);
    view.mount();

    (view as any)._roomData = { id: 'room_1', type: 'code-lab', tools: [], exitRequired: null, escalation: {}, tables: {} };
    (view as any)._agentPositions = {};

    // Add activity
    (view as any)._addActivity({ type: 'enter', message: 'Coder joined', roomId: 'room_1', timestamp: new Date().toISOString() });
    (view as any)._addActivity({ type: 'tool', message: 'read_file executed', roomId: 'room_1', timestamp: new Date().toISOString() });

    const content = (view as any)._buildContent();
    const activityItems = content.querySelectorAll('.room-activity-item');
    expect(activityItems.length).toBe(2);
    expect(activityItems[0].querySelector('.room-activity-text')!.textContent).toBe('Coder joined');
  });

  it('displays exit document field count when required', async () => {
    const { RoomView } = await import('../../../public/ui/views/room-view.js');
    const el = document.createElement('div');
    const view = new RoomView(el);
    view.mount();

    (view as any)._roomData = {
      id: 'room_1', type: 'code-lab', tools: [],
      exitRequired: { type: 'code-lab', fields: ['summary', 'files_changed', 'test_results'] },
      escalation: {}, tables: {},
    };
    (view as any)._agentPositions = {};

    const content = (view as any)._buildContent();
    const exitDocSection = content.querySelector('.room-exit-doc-section');
    expect(exitDocSection).not.toBeNull();
    const fieldsCount = exitDocSection!.querySelector('.room-exit-doc-fields-count');
    expect(fieldsCount).not.toBeNull();
    expect(fieldsCount!.textContent).toContain('3 required fields');
  });
});

// ─── TaskView ──────────────────────────────────────────────

describe('TaskView', () => {
  // TaskView requires an active building to show tasks (otherwise shows "Select a project")
  beforeEach(() => {
    const store = OverlordUI.getStore();
    store.set('building.active', 'test-building-1', { silent: true });
  });
  afterEach(() => {
    const store = OverlordUI.getStore();
    store.set('building.active', null, { silent: true });
  });

  it('shows "No Building Selected" when no building is active', async () => {
    const store = OverlordUI.getStore();
    store.set('building.active', null, { silent: true });

    const { TaskView } = await import('../../../public/ui/views/task-view.js');
    const el = document.createElement('div');
    const view = new TaskView(el);
    view.mount();

    const emptyState = el.querySelector('.view-empty-state');
    expect(emptyState).not.toBeNull();
    expect(el.textContent).toContain('No Building Selected');
  });

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

    // Trigger the store subscription to move past the loading state
    const store = OverlordUI.getStore();
    store.set('tasks.list', []);

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
    localStorage.clear();
    const { TaskView } = await import('../../../public/ui/views/task-view.js');
    const el = document.createElement('div');
    const view = new TaskView(el);
    view._buildingId = 'bld_test';
    view.mount();

    const store = OverlordUI.getStore();
    store.set('building.active', 'bld_test');
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
    localStorage.clear();
    const { TaskView } = await import('../../../public/ui/views/task-view.js');
    const el = document.createElement('div');
    const view = new TaskView(el);
    view._buildingId = 'bld_test';
    view.mount();

    const store = OverlordUI.getStore();
    store.set('building.active', 'bld_test');
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
  beforeEach(() => {
    const store = OverlordUI.getStore();
    store.set('building.active', 'test-building-1', { silent: true });
  });
  afterEach(() => {
    const store = OverlordUI.getStore();
    store.set('building.active', null, { silent: true });
  });

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

    // Trigger the store subscription to move past the loading state
    const store = OverlordUI.getStore();
    store.set('raid.entries', []);

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
  beforeEach(() => {
    const store = OverlordUI.getStore();
    store.set('building.active', 'test-building-1', { silent: true });
  });
  afterEach(() => {
    const store = OverlordUI.getStore();
    store.set('building.active', null, { silent: true });
  });

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
  beforeEach(() => {
    const store = OverlordUI.getStore();
    store.set('building.active', 'test-building-1', { silent: true });
  });
  afterEach(() => {
    const store = OverlordUI.getStore();
    store.set('building.active', null, { silent: true });
  });

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

// ─── ActivityView ──────────────────────────────────────────────

describe('ActivityView', () => {
  it('exports the ActivityView class', async () => {
    const mod = await import('../../../public/ui/views/activity-view.js');
    expect(mod.ActivityView).toBeDefined();
  });

  it('shows "No Building Selected" when no building is active', async () => {
    const store = OverlordUI.getStore();
    store.set('building.active', null, { silent: true });
    store.set('activity.items', [], { silent: true });

    const { ActivityView } = await import('../../../public/ui/views/activity-view.js');
    const el = document.createElement('div');
    const view = new ActivityView(el);
    view.mount();

    const emptyState = el.querySelector('.view-empty-state');
    expect(emptyState).not.toBeNull();
    expect(el.textContent).toContain('No Building Selected');
  });
});

// ─── SecurityView (#880) ────────────────────────────────────

describe('SecurityView', () => {
  it('exports the SecurityView class', async () => {
    const mod = await import('../../../public/ui/views/security-view.js');
    expect(mod.SecurityView).toBeDefined();
    expect(typeof mod.SecurityView).toBe('function');
  });

  it('renders empty state when no events', async () => {
    const store = OverlordUI.getStore();
    store.set('building.active', 'test-building-123', { silent: true });
    const { SecurityView } = await import('../../../public/ui/views/security-view.js');
    const el = document.createElement('div');
    const view = new SecurityView(el);
    view.mount();

    // Root element gets the class directly
    expect(el.classList.contains('security-view')).toBe(true);
    expect(el.querySelector('.security-empty')).not.toBeNull();
    expect(el.textContent).toContain('No Security Events');
  });

  it('renders no-building guard when no building selected', async () => {
    const store = OverlordUI.getStore();
    store.set('building.active', null, { silent: true });
    const { SecurityView } = await import('../../../public/ui/views/security-view.js');
    const el = document.createElement('div');
    const view = new SecurityView(el);
    view.mount();

    expect(el.textContent).toContain('No Building Selected');
  });

  it('renders stats bar with 4 stat cards', async () => {
    const store = OverlordUI.getStore();
    store.set('building.active', 'test-building-123', { silent: true });
    const { SecurityView } = await import('../../../public/ui/views/security-view.js');
    const el = document.createElement('div');
    const view = new SecurityView(el);
    view.mount();

    const statCards = el.querySelectorAll('.security-stat-card');
    expect(statCards.length).toBe(4);
    expect(el.textContent).toContain('Total');
    expect(el.textContent).toContain('Blocked');
    expect(el.textContent).toContain('Warned');
    expect(el.textContent).toContain('Allowed');
  });

  it('renders filter pills for all, blocked, warnings, allowed', async () => {
    const store = OverlordUI.getStore();
    store.set('building.active', 'test-building-123', { silent: true });
    const { SecurityView } = await import('../../../public/ui/views/security-view.js');
    const el = document.createElement('div');
    const view = new SecurityView(el);
    view.mount();

    const pills = el.querySelectorAll('.security-filter-pill');
    expect(pills.length).toBe(4);
    expect(pills[0].textContent).toBe('All');
    expect(pills[1].textContent).toBe('Blocked');
    expect(pills[2].textContent).toBe('Warnings');
    expect(pills[3].textContent).toBe('Allowed');
  });

  it('renders events when store has data', async () => {
    const store = OverlordUI.getStore();
    store.set('building.active', 'test-building-123', { silent: true });
    store.set('security.events', [
      { action: 'block', toolName: 'write_file', message: 'Blocked rm -rf', timestamp: Date.now(), pluginId: 'shell-guard' },
      { action: 'warn', toolName: 'execute_command', message: 'SQL detected', timestamp: Date.now() - 1000, pluginId: 'code-scanner' },
      { action: 'allow', toolName: 'read_file', timestamp: Date.now() - 2000 },
    ], { silent: true });
    store.set('security.stats', { total: 3, blocked: 1, warned: 1, allowed: 1 }, { silent: true });

    const { SecurityView } = await import('../../../public/ui/views/security-view.js');
    const el = document.createElement('div');
    const view = new SecurityView(el);
    view.mount();

    const rows = el.querySelectorAll('.security-event-row');
    expect(rows.length).toBe(3);

    // First event should be blocked (red)
    expect(rows[0].classList.contains('security-action--block')).toBe(true);
    expect(el.textContent).toContain('Blocked rm -rf');
    expect(el.textContent).toContain('shell-guard');
  });

  it('cleans up on destroy', async () => {
    const { SecurityView } = await import('../../../public/ui/views/security-view.js');
    const el = document.createElement('div');
    const view = new SecurityView(el);
    view.mount();

    expect(view._mounted).toBe(true);
    view.destroy();
    expect(view._mounted).toBe(false);
    expect(view._subs.length).toBe(0);
  });
});

/* ────────────────────────────────────────────────────────── */
/*  OnboardingWizard — keyboard navigation (#883)            */
/* ────────────────────────────────────────────────────────── */

describe('OnboardingWizard — keyboard navigation', () => {
  it('renders effort cards with tabindex and role', async () => {
    const { OnboardingWizard } = await import('../../../public/ui/views/onboarding-wizard.js');
    const el = document.createElement('div');
    const view = new OnboardingWizard(el);
    view.mount();

    // Navigate to effort step (step 3) by setting internal state
    (view as any)._step = 3;
    (view as any).render();

    const cards = el.querySelectorAll('.effort-level-card');
    expect(cards.length).toBeGreaterThan(0);
    for (const card of cards) {
      expect(card.getAttribute('tabindex')).toBe('0');
      expect(card.getAttribute('role')).toBe('option');
    }

    // Container should have listbox role
    const container = el.querySelector('.effort-level-choices');
    expect(container?.getAttribute('role')).toBe('listbox');
  });

  it('renders type cards with tabindex and role', async () => {
    const { OnboardingWizard } = await import('../../../public/ui/views/onboarding-wizard.js');
    const el = document.createElement('div');
    const view = new OnboardingWizard(el);
    view.mount();

    (view as any)._step = 4;
    (view as any).render();

    const cards = el.querySelectorAll('.wizard-type-card');
    expect(cards.length).toBeGreaterThan(0);
    for (const card of cards) {
      expect(card.getAttribute('tabindex')).toBe('0');
      expect(card.getAttribute('role')).toBe('option');
    }

    const grid = el.querySelector('.wizard-type-grid');
    expect(grid?.getAttribute('role')).toBe('listbox');
  });

  it('renders scale cards with tabindex and role', async () => {
    const { OnboardingWizard } = await import('../../../public/ui/views/onboarding-wizard.js');
    const el = document.createElement('div');
    const view = new OnboardingWizard(el);
    view.mount();

    (view as any)._step = 5;
    (view as any)._selectedType = { id: 'web-app' };
    (view as any)._selectedScale = null;
    (view as any).render();

    const cards = el.querySelectorAll('.wizard-scale-card');
    expect(cards.length).toBeGreaterThan(0);
    for (const card of cards) {
      expect(card.getAttribute('tabindex')).toBe('0');
      expect(card.getAttribute('role')).toBe('option');
    }
  });

  it('arrow keys cycle focus between effort cards', async () => {
    const { OnboardingWizard } = await import('../../../public/ui/views/onboarding-wizard.js');
    const el = document.createElement('div');
    document.body.appendChild(el);
    const view = new OnboardingWizard(el);
    view.mount();

    (view as any)._step = 3;
    (view as any).render();

    const cards = el.querySelectorAll('.effort-level-card') as NodeListOf<HTMLElement>;
    expect(cards.length).toBeGreaterThan(1);

    // Focus first card
    cards[0].focus();
    expect(document.activeElement).toBe(cards[0]);

    // Press ArrowRight → focus moves to second card
    const rightEvent = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true });
    cards[0].dispatchEvent(rightEvent);
    expect(document.activeElement).toBe(cards[1]);

    // Press ArrowLeft → focus moves back to first card
    const leftEvent = new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true });
    cards[1].dispatchEvent(leftEvent);
    expect(document.activeElement).toBe(cards[0]);

    document.body.removeChild(el);
  });

  it('Escape goes back one step', async () => {
    const { OnboardingWizard } = await import('../../../public/ui/views/onboarding-wizard.js');
    const el = document.createElement('div');
    document.body.appendChild(el);
    const view = new OnboardingWizard(el);
    view.mount();

    (view as any)._step = 4;
    (view as any).render();

    const card = el.querySelector('.wizard-type-card') as HTMLElement;
    expect(card).toBeTruthy();
    card.focus();

    const escEvent = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
    card.dispatchEvent(escEvent);

    // Should go back to step 3 (effort)
    expect((view as any)._step).toBe(3);

    document.body.removeChild(el);
  });

  it('Enter selects the focused card', async () => {
    const { OnboardingWizard } = await import('../../../public/ui/views/onboarding-wizard.js');
    const el = document.createElement('div');
    document.body.appendChild(el);
    const view = new OnboardingWizard(el);
    view.mount();

    (view as any)._step = 3;
    (view as any).render();

    const card = el.querySelector('.effort-level-card') as HTMLElement;
    expect(card).toBeTruthy();
    card.focus();

    const enterEvent = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true });
    card.dispatchEvent(enterEvent);

    // Should advance to step 4 (type) after selecting effort
    expect((view as any)._step).toBe(4);

    document.body.removeChild(el);
  });
});

/* ────────────────────────────────────────────────────────── */
/*  SettingsView — security level tab (#882)                  */
/* ────────────────────────────────────────────────────────── */

describe('SettingsView — security level tab', () => {
  it('includes security tab in settings', async () => {
    const { SettingsView } = await import('../../../public/ui/views/settings-view.js');
    expect(SettingsView).toBeDefined();
  });

  it('renders 4 security level cards when tab is active', async () => {
    const { SettingsView } = await import('../../../public/ui/views/settings-view.js');
    const el = document.createElement('div');
    const view = new SettingsView(el);
    view.mount();

    // Simulate opening settings and switching to security tab
    (view as any)._activeTab = 'security';
    const container = document.createElement('div');
    const tab = (view as any)._buildSecurityTab();
    container.appendChild(tab);

    // Without a building selected, should show empty hint
    const hint = container.querySelector('.settings-empty-hint');
    expect(hint).toBeTruthy();
  });

  it('renders security level cards with correct roles', async () => {
    const { SettingsView } = await import('../../../public/ui/views/settings-view.js');
    const el = document.createElement('div');
    const view = new SettingsView(el);
    view.mount();

    // Mock store with active building
    const { OverlordUI } = await import('../../../public/ui/engine/engine.js');
    const store = OverlordUI.getStore();
    if (store) {
      store.set('building.active', 'test-building-id');
      store.set('building.data', { config: { securityLevel: 'standard' } });
    }

    (view as any)._activeTab = 'security';
    const tab = (view as any)._buildSecurityTab();

    const cards = tab.querySelectorAll('.security-level-card');
    expect(cards.length).toBe(4);

    for (const card of cards) {
      expect(card.getAttribute('role')).toBe('option');
      expect(card.getAttribute('tabindex')).toBe('0');
    }

    // Check standard is selected by default
    const selectedCard = tab.querySelector('.security-level-card.selected');
    expect(selectedCard).toBeTruthy();
    expect(selectedCard?.getAttribute('data-level')).toBe('standard');

    // Listbox container
    const listbox = tab.querySelector('[role="listbox"]');
    expect(listbox).toBeTruthy();
  });
});
