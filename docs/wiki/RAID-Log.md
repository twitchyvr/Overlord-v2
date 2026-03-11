# RAID Log

## Overview

The RAID Log (**R**isks, **A**ssumptions, **I**ssues, **D**ecisions) is a searchable database of all project context. Agents reference the RAID log before starting work in any room, and scope changes trigger re-entry with a RAID context brief.

**Source:** `src/rooms/raid-log.ts`

## Entry Types

### Risk
Something that **might** go wrong. Includes probability, impact, and mitigation.

```typescript
{
  type: 'risk',
  summary: 'SQLite may not handle concurrent writes under load',
  rationale: 'WAL mode helps but has limits at ~50 concurrent writers',
  affectedAreas: ['storage', 'transport']
}
```

### Assumption
Something taken as **true without proof**. Must be validated.

```typescript
{
  type: 'assumption',
  summary: 'Users will have Node.js 20+ installed',
  rationale: 'Required for ESM support and native fetch',
  affectedAreas: ['core', 'server']
}
```

### Issue
Something that **is** going wrong right now. Requires resolution.

```typescript
{
  type: 'issue',
  summary: 'MiniMax provider strips emojis from tool call responses',
  rationale: 'Causes JSON parse failures in tool results',
  affectedAreas: ['ai', 'tools']
}
```

### Decision
A choice that was **made** with rationale. Auditable.

```typescript
{
  type: 'decision',
  summary: 'Use SQLite for local dev, Supabase for production',
  rationale: 'Zero-config local development, managed Postgres for scale',
  decidedBy: 'architect',
  approvedBy: 'user',
  affectedAreas: ['storage']
}
```

## API

### `addRaidEntry({ buildingId, type, phase, roomId, summary, rationale, decidedBy, approvedBy, affectedAreas })`
Add a new RAID entry.

Returns: `ok({ id })`

### `searchRaid({ buildingId, type, phase, status, query })`
Search RAID entries with optional filters:
- `type`: Filter by entry type (risk/assumption/issue/decision)
- `phase`: Filter by project phase
- `status`: Filter by status (active/superseded/closed)
- `query`: Full-text search across summary and rationale

Returns: `ok([...entries])`

### `buildContextBrief(buildingId)`
Build a context brief from all active RAID entries. Used when:
- An agent enters a new room
- A scope change triggers re-entry to an earlier phase
- A new agent joins the project

Returns:
```typescript
ok({
  decisions: [...],
  risks: [...],
  assumptions: [...],
  issues: [...],
  summary: '12 active RAID entries across project'
})
```

### `updateRaidStatus(id, status)`
Update a RAID entry's status to `active`, `superseded`, or `closed`.

Returns: `ok({ id, status })`

## Scope Change Protocol

When scope changes occur mid-project:

1. A RAID entry of type `decision` is created documenting the scope change
2. `buildContextBrief()` generates a summary of all active entries
3. The agent re-enters the relevant earlier-phase room (e.g., Discovery)
4. The context brief is injected so the agent has full project context
5. Work proceeds through the phase gates again with the updated scope

This prevents the "telephone game" problem where context is lost as scope changes propagate through the team.

## Database Storage

```sql
CREATE TABLE raid_entries (
  id TEXT PRIMARY KEY,
  building_id TEXT NOT NULL REFERENCES buildings(id),
  type TEXT NOT NULL CHECK(type IN ('risk', 'assumption', 'issue', 'decision')),
  phase TEXT NOT NULL,
  room_id TEXT REFERENCES rooms(id),
  summary TEXT NOT NULL,
  rationale TEXT,
  decided_by TEXT,
  approved_by TEXT,
  affected_areas TEXT DEFAULT '[]',
  status TEXT DEFAULT 'active' CHECK(status IN ('active', 'superseded', 'closed')),
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
```

## Why RAID Matters

In v1, there was no project context persistence. When an agent started a new task, it had no knowledge of previous decisions, known risks, or ongoing issues. This led to:
- Repeated mistakes (same decisions made differently each time)
- Lost context during handoffs between agents
- No audit trail for "why was this done this way?"

v2's RAID log ensures every decision is recorded, searchable, and automatically included in room context.
