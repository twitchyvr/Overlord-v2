# Tables and Chairs

## Overview

Tables define **how** agents work within a room. Each table type specifies a collaboration mode and maximum concurrency via its chair count.

## Table Types

### Focus Table
- **Chairs:** 1
- **Mode:** Solo work
- **Use Case:** One agent, one scope. Best for focused implementation or single-threaded testing.
- **Rooms:** Code Lab, Testing Lab, Deploy Room

### Collab Table
- **Chairs:** 2-4
- **Mode:** Pair/group work
- **Use Case:** Multiple agents share context and collaborate. Good for requirements gathering, architecture design, parallel test suites.
- **Rooms:** Testing Lab (3), Discovery Room (4), Architecture Room (4), Code Lab (4)

### Boardroom Table
- **Chairs:** 4-8
- **Mode:** Full team
- **Use Case:** Large integration tasks or incident response. All relevant agents present.
- **Rooms:** Code Lab (8), War Room (8)

### Consultation Table
- **Chairs:** 2
- **Mode:** Strategist + User
- **Use Case:** Phase Zero setup. Consultative dialog to configure the project.
- **Rooms:** Strategist Office

### Review Table
- **Chairs:** 3
- **Mode:** PM + Architect + Reviewer
- **Use Case:** Governance sign-off. Multiple perspectives required for go/no-go decisions.
- **Rooms:** Review Room

## Chair Mechanics

When an agent enters a room, they're assigned to a specific table:

1. **Check room access** — agent's badge must include the room type
2. **Select table** — default to `focus` unless specified
3. **Check availability** — must have an open chair at the table
4. **Sit down** — agent's `current_room_id` and `current_table_id` are updated

Multiple agents at the same table share the room's context but maintain individual sessions.

## Database Representation

Tables are stored in the `tables_v2` table:

```sql
CREATE TABLE tables_v2 (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(id),
  type TEXT NOT NULL DEFAULT 'focus',
  chairs INTEGER DEFAULT 1,
  description TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
```

## Room-Table Matrix

| Room Type | Focus | Collab | Boardroom | Consultation | Review |
|-----------|-------|--------|-----------|--------------|--------|
| Strategist | - | - | - | 2 chairs | - |
| Discovery | - | 4 chairs | - | - | - |
| Architecture | - | 4 chairs | - | - | - |
| Code Lab | 1 chair | 4 chairs | 8 chairs | - | - |
| Testing Lab | 1 chair | 3 chairs | - | - | - |
| Review | - | - | - | - | 3 chairs |
| Deploy | 1 chair | - | - | - | - |
| War Room | - | - | 8 chairs | - | - |
