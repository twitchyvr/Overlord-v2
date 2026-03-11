# Implementation Phases

## Overview

Overlord v2 follows an 8-phase implementation roadmap. Each phase builds on the previous one, and Phase Gates ensure quality at each transition.

## Phase 0: Stabilize v1
**Status:** Planned | **GitHub Issue:** #1

Tag v1 at a known-good state. Create a baseline for comparison.

### Deliverables
- Tag v1 baseline: `v1.0.0-baseline`
- Document all v1 features and behaviors
- Create migration compatibility matrix
- Archive v1 architecture docs in v2 repo
- Set up the v2 repository structure

---

## Phase 1: Foundation (Bus + Storage + Config)
**Status:** Current | **GitHub Issue:** #2

Build the foundation layers that everything else depends on.

### Deliverables
- Core event bus (`src/core/bus.ts`)
- Zod-validated config loader (`src/core/config.ts`)
- Pino structured logger (`src/core/logger.ts`)
- Universal I/O contracts (`src/core/contracts.ts`)
- SQLite storage layer with full schema (`src/storage/db.ts`)
- Architecture compliance checker (`scripts/check-layers.ts`)
- CI/CD pipeline (GitHub Actions)
- Unit tests for all core modules

### Acceptance Criteria
- [x] Event bus emits structured envelopes
- [x] Config validates all fields at startup
- [x] Database creates all 12 tables with indexes
- [x] Layer compliance checker passes
- [x] CI runs lint + typecheck + test + compliance
- [x] 80% test coverage on core modules

---

## Phase 2: Rooms (Room Manager + Testing Lab + Exit Protocol)
**Status:** Planned | **GitHub Issue:** #3

Build the room system — the core of v2 architecture.

### Deliverables
- Room Manager with lifecycle (create, enter, exit)
- BaseRoom abstract class
- Testing Lab room type (first room — clear constraints)
- Code Lab room type
- Exit document validation
- Room type registry (for plugins)
- Integration tests for room lifecycle

### Key Milestone
The Testing Lab is the first room built because it has the clearest constraints:
- Cannot write files (structural enforcement)
- Has a well-defined exit document (test report)
- Easy to validate the core paradigm

---

## Phase 3: Agents + AI (Registry + Providers + Tool Executor)
**Status:** Planned | **GitHub Issue:** #4

Build the agent system and AI provider layer.

### Deliverables
- Agent Registry with identity cards
- Agent Session tracking
- Agent Router (@mentions, #references)
- AI Provider adapter layer
- Anthropic adapter (full implementation)
- MiniMax adapter (full implementation)
- OpenAI adapter (full implementation)
- Ollama adapter (full implementation)
- Room-scoped tool execution
- Integration tests for agent ↔ room ↔ tool flow

### Key Milestone
End-to-end flow: Agent enters room → gets tools → sends message → AI responds → tool executes → exit document submitted.

---

## Phase 4: All Rooms + RAID (Remaining Rooms + Phase Gates)
**Status:** Planned | **GitHub Issue:** #5

Build all remaining room types and the RAID log system.

### Deliverables
- Discovery Room
- Architecture Room
- Review Room
- Deploy Room
- War Room
- RAID Log (add, search, context brief)
- Phase Gate system (create, sign-off, advance)
- Scope Change Protocol
- Full phase lifecycle integration tests

---

## Phase 5: Phase Zero (Strategist + Building Architect)
**Status:** Planned | **GitHub Issue:** #6

Build the consultative setup experience.

### Deliverables
- Strategist Office room type
- Building Architect room type
- Quick Start mode (template selection)
- Advanced mode (custom building layout)
- Building Blueprint exit document
- Phase Zero → Discovery transition

---

## Phase 6: UI (Building-Themed Frontend)
**Status:** Planned | **GitHub Issue:** #7

Build the user interface with the building metaphor.

### Deliverables
- Building visualization (floors, rooms, agents)
- Room detail views
- Agent status dashboard
- Chat interface with room context
- Phase progress visualization
- RAID Log browser
- Exit Document viewer
- Real-time updates via Socket.IO

---

## Phase 7: Plugins + Polish (Scripting + Integration)
**Status:** Planned | **GitHub Issue:** #8

Add extensibility and polish.

### Deliverables
- Plugin loader and sandbox
- Lua scripting runtime
- JavaScript scripting runtime
- Plugin API documentation
- MCP integration
- Performance optimization
- Documentation polish
- Public beta release

## Phase Dependencies

```
Phase 0 ─→ Phase 1 ─→ Phase 2 ─→ Phase 3 ─→ Phase 4 ─→ Phase 5 ─→ Phase 6 ─→ Phase 7
                            └── Phase Gate ──┘      └── Phase Gate ──┘
```

Each transition between major phases goes through a Phase Gate review.
