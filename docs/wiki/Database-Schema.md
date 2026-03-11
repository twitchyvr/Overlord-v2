# Database Schema

## Overview

Overlord v2 uses **SQLite** for local development with **WAL mode** and **foreign keys** enabled. The schema is designed for future migration to PostgreSQL/Supabase.

**Source:** `src/storage/db.ts`

## Tables

### buildings
The top-level project container.

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `id` | TEXT PK | — | Unique identifier |
| `project_id` | TEXT | — | External project reference |
| `name` | TEXT NOT NULL | — | Display name |
| `config` | TEXT | `'{}'` | JSON configuration |
| `active_phase` | TEXT | `'strategy'` | Current phase |
| `created_at` | TEXT | `datetime('now')` | Creation timestamp |
| `updated_at` | TEXT | `datetime('now')` | Last update timestamp |

### floors
Categories of rooms within a building.

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `id` | TEXT PK | — | Unique identifier |
| `building_id` | TEXT FK→buildings | — | Parent building |
| `type` | TEXT NOT NULL | — | Floor type (lobby, strategy, etc.) |
| `name` | TEXT NOT NULL | — | Display name |
| `sort_order` | INTEGER | `0` | Display ordering |
| `is_active` | INTEGER | `1` | Whether floor is active |
| `config` | TEXT | `'{}'` | JSON configuration |
| `created_at` | TEXT | `datetime('now')` | Creation timestamp |

### rooms
Bounded workspaces with tools and rules.

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `id` | TEXT PK | — | Unique identifier |
| `floor_id` | TEXT FK→floors | — | Parent floor |
| `type` | TEXT NOT NULL | — | Room type (code-lab, testing-lab, etc.) |
| `name` | TEXT NOT NULL | — | Display name |
| `allowed_tools` | TEXT | `'[]'` | JSON array of tool names |
| `file_scope` | TEXT | `'assigned'` | File access level |
| `exit_template` | TEXT | `'{}'` | JSON exit document template |
| `escalation` | TEXT | `'{}'` | JSON escalation rules |
| `provider` | TEXT | `'configurable'` | AI provider override |
| `config` | TEXT | `'{}'` | JSON room-specific config |
| `status` | TEXT | `'idle'` | Room status |
| `created_at` | TEXT | `datetime('now')` | Creation timestamp |

### tables_v2
Work modes within rooms (named `tables_v2` to avoid SQL keyword conflict).

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `id` | TEXT PK | — | Unique identifier |
| `room_id` | TEXT FK→rooms | — | Parent room |
| `type` | TEXT NOT NULL | `'focus'` | Table type |
| `chairs` | INTEGER | `1` | Max concurrent agents |
| `description` | TEXT | — | What this table is for |
| `created_at` | TEXT | `datetime('now')` | Creation timestamp |

### agents
10-line identity cards for AI agents.

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `id` | TEXT PK | — | Unique identifier |
| `name` | TEXT NOT NULL | — | Agent name |
| `role` | TEXT NOT NULL | — | Agent role |
| `capabilities` | TEXT | `'[]'` | JSON array of capabilities |
| `room_access` | TEXT | `'[]'` | JSON array of room types |
| `badge` | TEXT | — | Access badge identifier |
| `status` | TEXT | `'idle'` | Current status |
| `current_room_id` | TEXT FK→rooms | — | Currently occupied room |
| `current_table_id` | TEXT FK→tables_v2 | — | Currently occupied table |
| `config` | TEXT | `'{}'` | JSON agent-specific config |
| `created_at` | TEXT | `datetime('now')` | Creation timestamp |
| `updated_at` | TEXT | `datetime('now')` | Last update timestamp |

### messages
Chat messages within rooms.

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `id` | TEXT PK | — | Unique identifier |
| `room_id` | TEXT FK→rooms | — | Room where message was sent |
| `agent_id` | TEXT FK→agents | — | Sending agent (null for user) |
| `role` | TEXT NOT NULL | — | Message role (user, assistant, system) |
| `content` | TEXT | — | Message content |
| `tool_calls` | TEXT | — | JSON tool call data |
| `thread_id` | TEXT | — | Thread grouping |
| `parent_id` | TEXT FK→messages | — | Reply parent |
| `created_at` | TEXT | `datetime('now')` | Creation timestamp |

### tasks
Work items tracked within a building.

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `id` | TEXT PK | — | Unique identifier |
| `building_id` | TEXT FK→buildings | — | Parent building |
| `title` | TEXT NOT NULL | — | Task title |
| `description` | TEXT | — | Task description |
| `status` | TEXT | `'pending'` | Task status |
| `parent_id` | TEXT FK→tasks | — | Parent task (subtasks) |
| `milestone_id` | TEXT | — | Associated milestone |
| `assignee_id` | TEXT FK→agents | — | Assigned agent |
| `room_id` | TEXT FK→rooms | — | Room where work happens |
| `phase` | TEXT | — | Project phase |
| `priority` | TEXT | `'normal'` | Priority level |
| `created_at` | TEXT | `datetime('now')` | Creation timestamp |
| `updated_at` | TEXT | `datetime('now')` | Last update timestamp |

### todos
Granular action items within tasks.

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `id` | TEXT PK | — | Unique identifier |
| `task_id` | TEXT FK→tasks | — | Parent task |
| `agent_id` | TEXT FK→agents | — | Assigned agent |
| `room_id` | TEXT FK→rooms | — | Room context |
| `description` | TEXT NOT NULL | — | Todo description |
| `status` | TEXT | `'pending'` | Completion status |
| `exit_doc_ref` | TEXT | — | Reference to exit document |
| `created_at` | TEXT | `datetime('now')` | Creation timestamp |
| `completed_at` | TEXT | — | Completion timestamp |

### exit_documents
Structured output required to leave a room.

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `id` | TEXT PK | — | Unique identifier |
| `room_id` | TEXT FK→rooms | — | Room this document exits |
| `type` | TEXT NOT NULL | — | Document type |
| `completed_by` | TEXT NOT NULL | — | Agent who completed it |
| `fields` | TEXT | `'{}'` | JSON document fields |
| `artifacts` | TEXT | `'[]'` | JSON array of artifact refs |
| `raid_entry_ids` | TEXT | `'[]'` | JSON array of RAID refs |
| `created_at` | TEXT | `datetime('now')` | Creation timestamp |

### phase_gates
GO/NO-GO checkpoints between phases.

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `id` | TEXT PK | — | Unique identifier |
| `building_id` | TEXT FK→buildings | — | Parent building |
| `phase` | TEXT NOT NULL | — | Phase this gate guards |
| `status` | TEXT | `'pending'` | Gate status |
| `exit_doc_id` | TEXT FK→exit_documents | — | Supporting exit document |
| `signoff_reviewer` | TEXT | — | Who reviewed |
| `signoff_verdict` | TEXT | — | GO/NO-GO/CONDITIONAL |
| `signoff_conditions` | TEXT | `'[]'` | JSON conditions array |
| `signoff_timestamp` | TEXT | — | When sign-off occurred |
| `next_phase_input` | TEXT | `'{}'` | JSON input for next phase |
| `created_at` | TEXT | `datetime('now')` | Creation timestamp |

### raid_entries
Risks, Assumptions, Issues, and Decisions.

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `id` | TEXT PK | — | Unique identifier |
| `building_id` | TEXT FK→buildings | — | Parent building |
| `type` | TEXT NOT NULL | — | risk/assumption/issue/decision |
| `phase` | TEXT NOT NULL | — | Project phase |
| `room_id` | TEXT FK→rooms | — | Room where entry was created |
| `summary` | TEXT NOT NULL | — | Entry summary |
| `rationale` | TEXT | — | Reasoning/justification |
| `decided_by` | TEXT | — | Who made the decision |
| `approved_by` | TEXT | — | Who approved it |
| `affected_areas` | TEXT | `'[]'` | JSON array of affected areas |
| `status` | TEXT | `'active'` | active/superseded/closed |
| `created_at` | TEXT | `datetime('now')` | Creation timestamp |
| `updated_at` | TEXT | `datetime('now')` | Last update timestamp |

### migrations
Database migration tracking.

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `version` | INTEGER PK | — | Migration version |
| `name` | TEXT NOT NULL | — | Migration name |
| `applied_at` | TEXT | `datetime('now')` | When applied |

## Indexes

| Index | Table | Column(s) |
|-------|-------|-----------|
| `idx_rooms_floor` | rooms | floor_id |
| `idx_rooms_type` | rooms | type |
| `idx_messages_room` | messages | room_id |
| `idx_messages_thread` | messages | thread_id |
| `idx_agents_room` | agents | current_room_id |
| `idx_tasks_building` | tasks | building_id |
| `idx_todos_task` | todos | task_id |
| `idx_raid_building` | raid_entries | building_id |
| `idx_raid_phase` | raid_entries | phase |
| `idx_raid_type` | raid_entries | type |
| `idx_exit_docs_room` | exit_documents | room_id |
| `idx_phase_gates_building` | phase_gates | building_id |

## Database Configuration

```
journal_mode = WAL    (Write-Ahead Logging for concurrent reads)
foreign_keys = ON     (Referential integrity enforced)
```

## Future: PostgreSQL Migration

The schema is designed to be portable. Key considerations:
- All IDs are TEXT (UUID-compatible)
- All JSON columns use TEXT (→ JSONB in Postgres)
- All timestamps use ISO 8601 strings (→ TIMESTAMPTZ in Postgres)
- `datetime('now')` defaults → `NOW()` in Postgres
- The storage layer uses an adapter pattern for swappability
