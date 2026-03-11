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

import { describe, it, expect, beforeEach } from 'vitest';

const storePath = '../../../public/ui/engine/store.js';
const enginePath = '../../../public/ui/engine/engine.js';

let Store: any;
let OverlordUI: any;

beforeEach(async () => {
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
