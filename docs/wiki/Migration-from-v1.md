# Migration from v1

## Why a Rewrite?

Overlord v1 was a working prototype that proved the concept of AI agent orchestration. But it accumulated significant technical debt:

| Metric | v1 | v2 |
|--------|----|----|
| Language | JavaScript | TypeScript (strict) |
| Modules | 48 flat files | Layered architecture (7 layers) |
| Socket handlers | 137 in one file | Domain-organized events |
| Agent prompts | 200+ lines each | 10-line identity cards |
| Tool access | 4-tier approval system | Structural (binary) |
| Schema validation | None | Zod everywhere |
| Event system | 2300-line hub.js | 40-line event bus |
| Testing | Minimal | 80% coverage target |
| Architecture enforcement | Manual | Automated compliance checker |
| Phase discipline | None | Phase Gates (cannot be bypassed) |
| Decision tracking | None | RAID Log |

## What Changed

### Hub.js → Event Bus
v1's `hub.js` (2300 lines) handled everything: socket connections, agent routing, tool execution, state management, and message formatting. v2 splits this into:
- `bus.ts` — thin event emitter (40 lines)
- `socket-handler.ts` — domain-organized socket events
- `room-manager.ts` — room lifecycle
- `agent-registry.ts` — agent CRUD
- `tool-registry.ts` — tool definitions and execution

### Agent System Prompts → Room Context
v1 agents carried their entire behavior in 200-line system prompts. Changing how testing worked meant editing every test-related agent. v2 agents are 10-line identity cards — the room defines behavior, tools, and rules.

### 4-Tier Approval → Structural Access
v1 had 4 tiers of tool approval with confidence scores and escalation chains. LLMs routinely ignored these instructions. v2 uses structural enforcement — if a tool isn't in the room's `tools` array, it literally doesn't exist in the API call.

### Flat Files → Layered Architecture
v1 had 48 modules in a flat structure with circular dependencies. v2 enforces strict layer ordering: Transport → Rooms → Agents → Tools → AI → Storage → Core. An automated checker prevents regressions.

### No Types → TypeScript Strict
v1 was plain JavaScript with no type safety or schema validation. v2 uses TypeScript strict mode with Zod for runtime validation at every boundary.

## Tool Migration

v1 had 42 tools. v2 migrates the essential ones and organizes them by category:

| v1 Tool | v2 Tool | Category | Notes |
|---------|---------|----------|-------|
| run_bash | bash | shell | Renamed |
| read_file | read_file | file | Same |
| write_file | write_file | file | Same |
| edit_file | patch_file | file | Renamed, simplified |
| list_directory | list_dir | file | Renamed |
| web_search | web_search | web | Same |
| fetch_url | fetch_webpage | web | Renamed |
| gh_* | github | github | Consolidated |
| run_tests | qa_run_tests | qa | Namespaced |
| check_lint | qa_check_lint | qa | Namespaced |
| delegate_to_agent | (removed) | — | Replaced by room routing |
| create_todo | (via rooms) | — | Managed by room exit docs |

## Socket Event Migration

v1's 137 socket handlers are consolidated into domain-organized events:

| v1 Pattern | v2 Pattern |
|------------|-----------|
| `joinRoom` | `room:enter` |
| `leaveRoom` | `room:exit` |
| `message` | `chat:message` |
| `registerAgent` | `agent:register` |
| `toolResult` | (handled internally) |
| 130+ other handlers | Organized by domain prefix |

## Data Migration

v1 used a flat SQLite schema. v2 introduces the spatial model:

| v1 Table | v2 Tables |
|----------|-----------|
| agents | agents (with identity card fields) |
| conversations | messages (room-scoped) |
| (none) | buildings, floors, rooms, tables_v2 |
| (none) | phase_gates, raid_entries, exit_documents |
| (none) | tasks, todos |

A migration script (planned for Phase 0) will:
1. Export v1 data
2. Map agents to v2 identity card format
3. Import conversation history as room-scoped messages
4. Create default building/floor/room structure

## Compatibility

v2 is a **clean rewrite**, not an incremental upgrade. There is no backward compatibility with v1's API or data format. The migration path is:
1. Tag v1 at a known-good baseline
2. Stand up v2 alongside v1
3. Migrate data using the migration script
4. Verify feature parity
5. Cut over to v2
