# Layer Stack

## Strict Layer Ordering

Overlord v2 enforces a strict dependency hierarchy. Each layer may only import from layers **below** it. No circular dependencies. No lateral imports across layer boundaries.

```
Transport  →  Rooms  →  Agents  →  Tools  →  AI  →  Storage  →  Core
(top)                                                              (bottom)
```

## Layer Definitions

### Core (Bottom Layer)
**Path:** `src/core/`

The foundation. No dependencies on any other layer.

| Module | Purpose |
|--------|---------|
| `bus.ts` | Event emitter — the ONLY shared communication channel |
| `config.ts` | Zod-validated configuration from .env |
| `logger.ts` | Pino structured logger |
| `contracts.ts` | Universal I/O contracts (ok/err, Zod schemas) |

### Storage
**Path:** `src/storage/`
**Depends on:** Core

Database layer. SQLite (local) with designed adapter path to PostgreSQL/Supabase.

| Module | Purpose |
|--------|---------|
| `db.ts` | Database initialization, schema, connection management |

### AI
**Path:** `src/ai/`
**Depends on:** Core, Storage

Provider-agnostic AI adapter layer.

| Module | Purpose |
|--------|---------|
| `ai-provider.ts` | Adapter registry, message routing by provider |

### Tools
**Path:** `src/tools/`
**Depends on:** Core, Storage, AI

Tool definitions and room-scoped execution.

| Module | Purpose |
|--------|---------|
| `tool-registry.ts` | Tool definitions, room-scoped access, execution |
| `tool-executor.ts` | Room-scoped tool execution wrapper |

### Agents
**Path:** `src/agents/`
**Depends on:** Core, Storage, AI, Tools

Agent management and routing.

| Module | Purpose |
|--------|---------|
| `agent-registry.ts` | Agent CRUD with 10-line identity cards |
| `agent-session.ts` | Agent work session within rooms |
| `agent-router.ts` | Message routing, @mentions, #references |

### Rooms
**Path:** `src/rooms/`
**Depends on:** Core, Storage, AI, Tools, Agents

The core of v2 architecture.

| Module | Purpose |
|--------|---------|
| `room-manager.ts` | Room lifecycle (create, enter, exit, submit exit doc) |
| `phase-gate.ts` | GO/NO-GO phase transitions |
| `raid-log.ts` | RAID entry management and context briefs |
| `room-types/*.ts` | Individual room implementations |

### Transport (Top Layer)
**Path:** `src/transport/`
**Depends on:** All layers

External interface. Maps Socket.IO events and HTTP routes to internal operations.

| Module | Purpose |
|--------|---------|
| `socket-handler.ts` | Socket.IO event handlers by domain |

## Compliance Checker

The architecture compliance script (`scripts/check-layers.ts`) automatically verifies layer ordering:

```bash
npm run check:layers
```

It parses all imports in `src/` and flags any violations where a lower layer imports from a higher layer. This runs as part of CI.

## Why Strict Ordering?

v1 had circular dependencies everywhere. Module A imported from B, which imported from C, which imported from A. This made:
- Testing impossible without mocking the entire system
- Refactoring dangerous (change one thing, break everything)
- Understanding data flow impossible

v2's strict ordering means:
- **Core** can be tested in complete isolation
- **Storage** only needs Core mocks
- **Each layer** has a clear, minimal dependency set
- **Data flows down** for operations, **events flow up** via the bus
