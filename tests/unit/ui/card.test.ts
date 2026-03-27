// @vitest-environment jsdom
/**
 * Tests for public/ui/components/card.js
 *
 * Covers: Card.create() for all type-specific builders (agent, task,
 *         recommendation, milestone, kanban, room, floor, building,
 *         raid, generic), variant/className options, action buttons.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const cardPath = '../../../public/ui/components/card.js';

let Card: any;

beforeEach(async () => {
  const mod = await import(cardPath);
  Card = mod.Card;
});

// ─── create() — basic structure ─────────────────────────────

describe('Card.create() — basic structure', () => {
  it('returns a div element', () => {
    const card = Card.create('generic', { title: 'Test' });
    expect(card.tagName).toBe('DIV');
  });

  it('applies card base class and type class', () => {
    const card = Card.create('agent', { name: 'Bot' });
    expect(card.classList.contains('card')).toBe(true);
    expect(card.classList.contains('card-agent')).toBe(true);
  });

  it('sets data-card-type attribute', () => {
    const card = Card.create('task', { title: 'Do stuff' });
    expect(card.getAttribute('data-card-type')).toBe('task');
  });

  it('applies default variant (glass)', () => {
    const card = Card.create('generic', {});
    expect(card.classList.contains('card-glass')).toBe(true);
  });

  it('applies specified variant', () => {
    const card = Card.create('generic', {}, { variant: 'solid' });
    expect(card.classList.contains('card-solid')).toBe(true);
    expect(card.classList.contains('card-glass')).toBe(false);
  });

  it('applies outlined variant', () => {
    const card = Card.create('generic', {}, { variant: 'outlined' });
    expect(card.classList.contains('card-outlined')).toBe(true);
  });

  it('applies additional className', () => {
    const card = Card.create('generic', {}, { className: 'extra-class' });
    expect(card.classList.contains('extra-class')).toBe(true);
    expect(card.classList.contains('card')).toBe(true);
  });
});

// ─── create() — action buttons ──────────────────────────────

describe('Card.create() — action buttons', () => {
  it('adds .card-actions container when actions are provided', () => {
    const card = Card.create('generic', { title: 'Test' }, {
      actions: { Edit: vi.fn(), Delete: vi.fn() }
    });
    const actionsEl = card.querySelector('.card-actions');
    expect(actionsEl).not.toBeNull();
  });

  it('creates a .card-action-btn for each action', () => {
    const card = Card.create('generic', { title: 'Test' }, {
      actions: { Edit: vi.fn(), Delete: vi.fn() }
    });
    const btns = card.querySelectorAll('.card-action-btn');
    expect(btns.length).toBe(2);
    expect(btns[0].textContent).toBe('Edit');
    expect(btns[1].textContent).toBe('Delete');
  });

  it('calls the action handler with data and card when clicked', () => {
    const handler = vi.fn();
    const data = { title: 'Test' };
    const card = Card.create('generic', data, {
      actions: { Edit: handler }
    });

    const btn = card.querySelector('.card-action-btn');
    btn!.click();

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(data, card);
  });

  it('stops propagation on action button click', () => {
    const cardHandler = vi.fn();
    const actionHandler = vi.fn();
    const card = Card.create('generic', { title: 'X' }, {
      actions: { Act: actionHandler }
    });
    card.addEventListener('click', cardHandler);

    document.body.appendChild(card);
    const btn = card.querySelector('.card-action-btn') as HTMLElement;
    btn.click();

    // Action handler fires but stopPropagation prevents card handler
    expect(actionHandler).toHaveBeenCalledTimes(1);
    expect(cardHandler).not.toHaveBeenCalled();

    document.body.removeChild(card);
  });

  it('does not add .card-actions when no actions provided', () => {
    const card = Card.create('generic', { title: 'Test' });
    expect(card.querySelector('.card-actions')).toBeNull();
  });

  it('does not add .card-actions when actions object is empty', () => {
    const card = Card.create('generic', { title: 'Test' }, { actions: {} });
    expect(card.querySelector('.card-actions')).toBeNull();
  });
});

// ─── agent card ─────────────────────────────────────────────

describe('Card.create("agent")', () => {
  it('renders agent name in .agent-card-name', () => {
    const card = Card.create('agent', { name: 'Orchestrator' });
    const name = card.querySelector('.agent-card-name');
    expect(name).not.toBeNull();
    expect(name!.textContent).toBe('Orchestrator');
  });

  it('defaults name to "Agent" when not provided', () => {
    const card = Card.create('agent', {});
    const name = card.querySelector('.agent-card-name');
    expect(name!.textContent).toBe('Agent');
  });

  it('renders status dot with status class', () => {
    const card = Card.create('agent', { name: 'A', status: 'active' });
    const dot = card.querySelector('.agent-status-dot');
    expect(dot).not.toBeNull();
    expect(dot!.classList.contains('active')).toBe(true);
  });

  it('adds agent-{status} class to card when status is provided', () => {
    const card = Card.create('agent', { name: 'A', status: 'busy' });
    expect(card.classList.contains('agent-busy')).toBe(true);
  });

  it('renders role in .agent-card-role', () => {
    const card = Card.create('agent', { name: 'A', role: 'Developer' });
    const role = card.querySelector('.agent-card-role');
    expect(role).not.toBeNull();
    expect(role!.textContent).toBe('Developer');
  });

  it('renders current task', () => {
    const card = Card.create('agent', { name: 'A', currentTask: 'Fixing bug #42' });
    const task = card.querySelector('.agent-current-task');
    expect(task).not.toBeNull();
    expect(task!.textContent).toBe('Fixing bug #42');
  });

  it('renders capabilities as .agent-cap chips', () => {
    const card = Card.create('agent', { name: 'A', capabilities: ['code', 'test', 'deploy'] });
    const caps = card.querySelectorAll('.agent-cap');
    expect(caps.length).toBe(3);
    expect(caps[0].textContent).toBe('code');
    expect(caps[2].textContent).toBe('deploy');
  });

  it('renders badge when provided', () => {
    const card = Card.create('agent', { name: 'A', badge: 'LEAD' });
    const badge = card.querySelector('.agent-badge');
    expect(badge).not.toBeNull();
    expect(badge!.textContent).toBe('LEAD');
  });

  it('does not render badge when not provided', () => {
    const card = Card.create('agent', { name: 'A' });
    expect(card.querySelector('.agent-badge')).toBeNull();
  });
});

// ─── task card ──────────────────────────────────────────────

describe('Card.create("task")', () => {
  it('renders task title in .task-title', () => {
    const card = Card.create('task', { title: 'Build UI' });
    const title = card.querySelector('.task-title');
    expect(title!.textContent).toBe('Build UI');
  });

  it('defaults title to "Untitled Task"', () => {
    const card = Card.create('task', {});
    const title = card.querySelector('.task-title');
    expect(title!.textContent).toBe('Untitled Task');
  });

  it('does not render its own checkbox (task-view manages selection) (#1353)', () => {
    const card = Card.create('task', { title: 'T', id: '7' });
    const checkbox = card.querySelector('.task-checkbox');
    expect(checkbox).toBeNull();
  });

  it('adds task-done class when completed', () => {
    const card = Card.create('task', { title: 'Done', completed: true });
    expect(card.classList.contains('task-done')).toBe(true);
  });

  it('renders priority badge', () => {
    const card = Card.create('task', { title: 'T', priority: 'high' });
    const priority = card.querySelector('.task-priority');
    expect(priority).not.toBeNull();
    expect(priority!.textContent).toBe('high');
    expect(priority!.classList.contains('priority-high')).toBe(true);
  });

  it('renders short task id with T- prefix', () => {
    const card = Card.create('task', { title: 'T', id: '123' });
    const idEl = card.querySelector('.task-id');
    expect(idEl!.textContent).toMatch(/^T-/);
  });

  it('uses last 4 chars of UUID for task id', () => {
    const uuid = 'de59f234-4199-4d63-85af-6c12abbd6647';
    const card = Card.create('task', { title: 'T', id: uuid });
    const idEl = card.querySelector('.task-id');
    expect(idEl!.textContent).toBe('T-6647');
    expect(idEl!.getAttribute('title')).toBe(uuid);
  });

  it('renders description in .task-description', () => {
    const card = Card.create('task', { title: 'T', description: 'Details here' });
    const desc = card.querySelector('.task-description');
    expect(desc).not.toBeNull();
    expect(desc!.textContent).toBe('Details here');
  });

  it('renders footer with assignee and created date', () => {
    const card = Card.create('task', { title: 'T', assignee: 'Alice', created: '2026-01-01' });
    const footer = card.querySelector('.card-footer');
    expect(footer).not.toBeNull();
    expect(footer!.textContent).toContain('Alice');
    expect(footer!.textContent).toContain('2026-01-01');
  });

  it('adds task-{status} class when status provided', () => {
    const card = Card.create('task', { title: 'T', status: 'in-progress' });
    expect(card.classList.contains('task-in-progress')).toBe(true);
  });
});

// ─── recommendation card ────────────────────────────────────

describe('Card.create("recommendation")', () => {
  it('renders recommendation title', () => {
    const card = Card.create('recommendation', { title: 'Use caching' });
    const title = card.querySelector('.rec-card-title');
    expect(title!.textContent).toBe('Use caching');
  });

  it('defaults title to "Recommendation"', () => {
    const card = Card.create('recommendation', {});
    const title = card.querySelector('.rec-card-title');
    expect(title!.textContent).toBe('Recommendation');
  });

  it('renders description in card-body', () => {
    const card = Card.create('recommendation', { title: 'R', description: 'Implement Redis' });
    const body = card.querySelector('.card-body');
    expect(body!.textContent).toBe('Implement Redis');
  });
});

// ─── milestone card ─────────────────────────────────────────

describe('Card.create("milestone")', () => {
  it('renders milestone title', () => {
    const card = Card.create('milestone', { title: 'v1.0 Release' });
    const header = card.querySelector('.card-header');
    expect(header!.textContent).toContain('v1.0 Release');
  });

  it('renders status badge when status provided', () => {
    const card = Card.create('milestone', { title: 'M', status: 'active' });
    const badge = card.querySelector('.ms-status-badge');
    expect(badge).not.toBeNull();
    expect(badge!.textContent).toBe('active');
    expect(badge!.classList.contains('ms-active')).toBe(true);
  });

  it('renders description', () => {
    const card = Card.create('milestone', { title: 'M', description: 'First major release' });
    const body = card.querySelector('.card-body');
    expect(body!.textContent).toBe('First major release');
  });

  it('renders progress bar when progress is provided', () => {
    const card = Card.create('milestone', { title: 'M', progress: 75 });
    const fill = card.querySelector('.progress-bar-fill') as HTMLElement;
    expect(fill).not.toBeNull();
    expect(fill!.style.width).toBe('75%');
  });

  it('renders progress bar at 0%', () => {
    const card = Card.create('milestone', { title: 'M', progress: 0 });
    const fill = card.querySelector('.progress-bar-fill') as HTMLElement;
    expect(fill).not.toBeNull();
    expect(fill!.style.width).toBe('0%');
  });

  it('does not render progress bar when progress is undefined', () => {
    const card = Card.create('milestone', { title: 'M' });
    expect(card.querySelector('.progress-bar')).toBeNull();
  });
});

// ─── kanban card ────────────────────────────────────────────

describe('Card.create("kanban")', () => {
  it('renders kanban title in .kb-title', () => {
    const card = Card.create('kanban', { title: 'Fix tests' });
    const title = card.querySelector('.kb-title');
    expect(title!.textContent).toBe('Fix tests');
  });

  it('defaults title to "Task"', () => {
    const card = Card.create('kanban', {});
    const title = card.querySelector('.kb-title');
    expect(title!.textContent).toBe('Task');
  });

  it('renders assignee chip', () => {
    const card = Card.create('kanban', { title: 'T', assignee: 'Bob' });
    const chip = card.querySelector('.kb-chip');
    expect(chip!.textContent).toBe('Bob');
  });

  it('adds priority class when priority provided', () => {
    const card = Card.create('kanban', { title: 'T', priority: 'critical' });
    expect(card.classList.contains('priority-critical')).toBe(true);
  });
});

// ─── room card (v2) ─────────────────────────────────────────

describe('Card.create("room")', () => {
  it('renders room name in .room-card-name', () => {
    const card = Card.create('room', { name: 'War Room' });
    const name = card.querySelector('.room-card-name');
    expect(name!.textContent).toBe('War Room');
  });

  it('falls back to type for name when name not provided', () => {
    const card = Card.create('room', { type: 'strategy' });
    const name = card.querySelector('.room-card-name');
    expect(name!.textContent).toBe('strategy');
  });

  it('defaults name to "Room"', () => {
    const card = Card.create('room', {});
    const name = card.querySelector('.room-card-name');
    expect(name!.textContent).toBe('Room');
  });

  it('shows active status dot when occupied', () => {
    const card = Card.create('room', { name: 'R', occupied: true });
    const dot = card.querySelector('.status-dot');
    expect(dot!.classList.contains('status-active')).toBe(true);
    expect(card.classList.contains('room-occupied')).toBe(true);
  });

  it('shows idle status dot when not occupied', () => {
    const card = Card.create('room', { name: 'R', occupied: false });
    const dot = card.querySelector('.status-dot');
    expect(dot!.classList.contains('status-idle')).toBe(true);
  });

  it('renders room type label', () => {
    const card = Card.create('room', { name: 'R', type: 'coding' });
    const label = card.querySelector('.room-type-label');
    expect(label!.textContent).toBe('coding');
  });

  it('renders agent chips', () => {
    const card = Card.create('room', { name: 'R', agents: [{ name: 'Alice' }, { name: 'Bob' }] });
    const chips = card.querySelectorAll('.room-agent-chip');
    expect(chips.length).toBe(2);
    expect(chips[0].textContent).toBe('Alice');
    expect(chips[1].textContent).toBe('Bob');
  });

  it('supports string agents', () => {
    const card = Card.create('room', { name: 'R', agents: ['Alice', 'Bob'] });
    const chips = card.querySelectorAll('.room-agent-chip');
    expect(chips.length).toBe(2);
    expect(chips[0].textContent).toBe('Alice');
  });

  it('renders tool tags (max 4 + overflow)', () => {
    const tools = ['git', 'npm', 'docker', 'kubectl', 'terraform', 'ansible'];
    const card = Card.create('room', { name: 'R', tools });
    const tags = card.querySelectorAll('.tool-tag');
    // 4 regular + 1 overflow = 5
    expect(tags.length).toBe(5);
    const more = card.querySelector('.tool-tag-more');
    expect(more!.textContent).toBe('+2');
  });

  it('renders all tool tags when 4 or fewer', () => {
    const card = Card.create('room', { name: 'R', tools: ['git', 'npm'] });
    const tags = card.querySelectorAll('.tool-tag');
    expect(tags.length).toBe(2);
    expect(card.querySelector('.tool-tag-more')).toBeNull();
  });
});

// ─── floor card (v2) ────────────────────────────────────────

describe('Card.create("floor")', () => {
  it('renders floor name', () => {
    const card = Card.create('floor', { name: 'Engineering', number: 3 });
    const header = card.querySelector('.card-header');
    expect(header!.textContent).toContain('Engineering');
  });

  it('defaults to "Floor N" when no name', () => {
    const card = Card.create('floor', { number: 5 });
    const header = card.querySelector('.card-header');
    expect(header!.textContent).toContain('Floor 5');
  });

  it('renders floor type badge', () => {
    const card = Card.create('floor', { name: 'F', type: 'operations' });
    const badge = card.querySelector('.floor-type-badge');
    expect(badge!.textContent).toBe('operations');
  });

  it('renders room count', () => {
    const card = Card.create('floor', { name: 'F', rooms: ['a', 'b', 'c'] });
    const count = card.querySelector('.floor-room-count');
    expect(count!.textContent).toBe('3 rooms');
  });

  it('uses singular "room" for count of 1', () => {
    const card = Card.create('floor', { name: 'F', rooms: ['a'] });
    const count = card.querySelector('.floor-room-count');
    expect(count!.textContent).toBe('1 room');
  });

  it('does not render room count when rooms is empty or absent', () => {
    const card = Card.create('floor', { name: 'F' });
    expect(card.querySelector('.floor-room-count')).toBeNull();
  });

  it('renders floor type indicator with style', () => {
    const card = Card.create('floor', { name: 'F', type: 'engineering' });
    const indicator = card.querySelector('.floor-type-indicator') as HTMLElement;
    expect(indicator).not.toBeNull();
  });
});

// ─── building card (v2) ─────────────────────────────────────

describe('Card.create("building")', () => {
  it('renders building name', () => {
    const card = Card.create('building', { name: 'HQ' });
    const header = card.querySelector('.card-header');
    expect(header!.textContent).toContain('HQ');
  });

  it('defaults name to "Building"', () => {
    const card = Card.create('building', {});
    const header = card.querySelector('.card-header');
    expect(header!.textContent).toContain('Building');
  });

  it('renders active phase badge', () => {
    const card = Card.create('building', { name: 'B', activePhase: 'planning' });
    const badge = card.querySelector('.phase-badge');
    expect(badge!.textContent).toBe('planning');
    expect(badge!.classList.contains('phase-planning')).toBe(true);
  });

  it('renders description', () => {
    const card = Card.create('building', { name: 'B', description: 'Main headquarters' });
    const body = card.querySelector('.card-body');
    expect(body!.textContent).toContain('Main headquarters');
  });

  it('renders floor count', () => {
    const card = Card.create('building', { name: 'B', floorCount: 12 });
    const stat = card.querySelector('.building-stat');
    expect(stat!.textContent).toBe('12 floors');
  });

  it('renders floor count of 0', () => {
    const card = Card.create('building', { name: 'B', floorCount: 0 });
    const stat = card.querySelector('.building-stat');
    expect(stat!.textContent).toBe('0 floors');
  });
});

// ─── raid card (v2) ─────────────────────────────────────────

describe('Card.create("raid")', () => {
  it('renders raid entry title', () => {
    const card = Card.create('raid', { title: 'API latency spike', type: 'risk' });
    const body = card.querySelector('.card-body');
    expect(body!.textContent).toContain('API latency spike');
  });

  it('falls back to description when no title', () => {
    const card = Card.create('raid', { description: 'Needs monitoring', type: 'issue' });
    const body = card.querySelector('.card-body');
    expect(body!.textContent).toContain('Needs monitoring');
  });

  it('defaults to "RAID Entry" when no title or description', () => {
    const card = Card.create('raid', { type: 'risk' });
    const body = card.querySelector('.card-body');
    expect(body!.textContent).toContain('RAID Entry');
  });

  it('renders type badge in header', () => {
    const card = Card.create('raid', { title: 'T', type: 'risk' });
    const badge = card.querySelector('.badge-risk');
    expect(badge).not.toBeNull();
    expect(badge!.textContent).toBe('risk');
  });

  it('renders type icon with color (previously dot)', () => {
    const card = Card.create('raid', { title: 'T', type: 'risk' });
    const header = card.querySelector('.card-header');
    expect(header!.textContent).toContain('risk');
  });

  it('renders type badge in footer', () => {
    const card = Card.create('raid', { title: 'T', type: 'dependency' });
    const badge = card.querySelector('.badge-dependency');
    expect(badge!.textContent).toBe('dependency');
  });

  it('renders status in header', () => {
    const card = Card.create('raid', { title: 'T', status: 'open' });
    const header = card.querySelector('.card-header');
    expect(header!.textContent).toContain('open');
  });

  it('renders owner in footer', () => {
    const card = Card.create('raid', { title: 'T', owner: 'Team A' });
    const footer = card.querySelector('.card-footer');
    expect(footer!.textContent).toContain('Team A');
  });

  it('renders description below title when both exist', () => {
    const card = Card.create('raid', { title: 'Risk', description: 'Detailed explanation' });
    // Title is in .card-body, description is in a separate div
    expect(card.textContent).toContain('Risk');
    expect(card.textContent).toContain('Detailed explanation');
  });

  it('renders description as title when no title provided', () => {
    const card = Card.create('raid', { description: 'Desc only' });
    const body = card.querySelector('.card-body');
    expect(body!.textContent).toContain('Desc only');
  });
});

// ─── generic card ───────────────────────────────────────────

describe('Card.create("generic") / default', () => {
  it('renders title in .card-header', () => {
    const card = Card.create('generic', { title: 'Info Card' });
    const header = card.querySelector('.card-header');
    expect(header!.textContent).toBe('Info Card');
  });

  it('renders string body in .card-body', () => {
    const card = Card.create('generic', { body: 'Some content' });
    const body = card.querySelector('.card-body');
    expect(body!.textContent).toBe('Some content');
  });

  it('renders Node body by appending', () => {
    const node = document.createElement('em');
    node.textContent = 'Emphasized';
    const card = Card.create('generic', { body: node });
    const body = card.querySelector('.card-body');
    expect(body!.querySelector('em')).toBe(node);
  });

  it('renders footer in .card-footer', () => {
    const card = Card.create('generic', { footer: 'Updated today' });
    const footer = card.querySelector('.card-footer');
    expect(footer!.textContent).toBe('Updated today');
  });

  it('does not render header/body/footer when not provided', () => {
    const card = Card.create('generic', {});
    expect(card.querySelector('.card-header')).toBeNull();
    expect(card.querySelector('.card-body')).toBeNull();
    expect(card.querySelector('.card-footer')).toBeNull();
  });

  it('falls back to generic builder for unknown type', () => {
    const card = Card.create('unknown-type', { title: 'Fallback' });
    expect(card.classList.contains('card-unknown-type')).toBe(true);
    const header = card.querySelector('.card-header');
    expect(header!.textContent).toBe('Fallback');
  });
});
