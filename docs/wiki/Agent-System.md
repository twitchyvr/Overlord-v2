# Agent System

## Overview

In v2, agents are **10-line identity cards**, not 200-line system prompts. The agent defines **who** — the room defines **what they can do**.

> Agent = who. Room = what they can do. Table = how they work.

**Source:** `src/agents/agent-registry.ts`

## Agent Identity Card

```typescript
{
  id: 'agent_123',
  name: 'Developer',
  role: 'developer',
  capabilities: ['typescript', 'testing', 'debugging'],
  roomAccess: ['code-lab', 'testing-lab', 'war-room'],
  badge: 'execution'
}
```

That's it. No 200-line system prompt. No tool lists. No behavioral instructions. The room provides all of that when the agent enters.

## v1 vs v2 Agent Design

| Aspect | v1 | v2 |
|--------|----|----|
| Definition | 200-line system prompt | 10-line identity card |
| Behavior | Hardcoded in agent | Defined by room |
| Tools | Listed in agent config | Defined by room contract |
| Rules | Embedded in prompt | Injected by room on entry |
| Changing behavior | Edit every agent | Edit the room once |

## API

### `registerAgent({ name, role, capabilities, roomAccess, badge, config })`
Register a new agent with a minimal identity card.

Returns: `ok({ id, name, role })`

### `getAgent(agentId)`
Get a fully hydrated agent (JSON fields parsed).

Returns: Agent object or `null`

### `listAgents({ status?, roomId? })`
List all agents with optional filters.

Returns: Array of agent objects

### `updateAgent(agentId, updates)`
Update an agent's identity card fields.

Returns: `ok({ id })` or `err('AGENT_NOT_FOUND', ...)`

### `removeAgent(agentId)`
Remove an agent from the registry.

Returns: `ok({ id })`

## Default Agents

The seed script creates 6 default agents:

| Agent | Role | Room Access |
|-------|------|-------------|
| **Strategist** | strategist | strategist |
| **Architect** | architect | discovery, architecture, review |
| **Developer** | developer | code-lab, testing-lab, war-room |
| **QA Lead** | qa | testing-lab, review |
| **DevOps** | devops | deploy, war-room |
| **PM** | pm | discovery, architecture, review, war-room |

## Agent Lifecycle

```
1. Register agent (identity card)
2. Agent enters room (badge check → context injection)
3. Agent gets room's tools, rules, file scope
4. Agent works within room constraints
5. Agent submits exit document
6. Agent exits room → status: idle
```

## Context Injection on Room Entry

When an agent enters a room, the room's `buildContextInjection()` creates a context object:

```typescript
{
  roomType: 'testing-lab',
  rules: ['You CANNOT modify source code.', ...],
  tools: ['read_file', 'bash', 'qa_run_tests', ...],
  fileScope: 'read-only',
  exitTemplate: { type: 'test-report', fields: [...] },
  outputFormat: { testsRun: 'number', ... }
}
```

This context is merged into the agent's prompt at the AI provider level, giving the agent room-specific behavior without modifying the agent itself.

## Database Storage

```sql
CREATE TABLE agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  capabilities TEXT DEFAULT '[]',
  room_access TEXT DEFAULT '[]',
  badge TEXT,
  status TEXT DEFAULT 'idle',
  current_room_id TEXT REFERENCES rooms(id),
  current_table_id TEXT REFERENCES tables_v2(id),
  config TEXT DEFAULT '{}',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
```
