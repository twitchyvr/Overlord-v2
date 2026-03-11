# Spatial Model

## Building / Floor / Room / Table / Chair

Overlord v2 uses a **tycoon-game spatial metaphor** to organize AI agent work. Think of it like a building management sim where each floor serves a purpose, rooms have specific equipment, and agents sit at tables to work.

```
Building (project container)
  └── Floor (category of rooms)
       └── Room (bounded workspace with rules + tools)
            └── Table (work mode: focus, collab, boardroom)
                 └── Chair (agent slot)
```

## Building

A **Building** is the top-level container for a project. It has:
- A name and project ID
- An **active phase** (strategy, discovery, architecture, execution, review, deploy)
- Configuration that cascades down to rooms
- A set of floors

Buildings are created during Phase Zero by the Strategist. A single Overlord instance can manage multiple buildings (projects) simultaneously.

## Floor

A **Floor** is a category of rooms grouped by purpose. Each floor maps to a phase or function:

| Floor | Purpose | Phase |
|-------|---------|-------|
| **Strategy** | Phase Zero setup | Pre-project |
| **Collaboration** | Planning & requirements | Discovery, Architecture |
| **Execution** | Building & testing | Implementation |
| **Operations** | Deployment & monitoring | Deploy |
| **Governance** | Sign-off & audit | Review |
| **Integration** | External I/O | Cross-cutting |
| **Lobby** | Dashboard & user-facing | Always active |

Floors have a sort order and can be activated/deactivated per building.

## Room

A **Room** is the core unit of work. It defines:
- **Allowed Tools** — structural access control (if not listed, doesn't exist)
- **File Scope** — `assigned` (task files only), `read-only`, or `full` (War Room)
- **Exit Template** — structured document required to leave
- **Escalation Rules** — where to go on failure/scope change
- **Provider** — which AI model to use (`smart`, `cheap`, `configurable`)
- **Rules** — injected into agent context on entry

See [[Room Types]] for all implemented rooms and [[Room Contracts]] for the schema.

## Table

A **Table** is a work mode within a room. It defines **how** agents work:

| Table Type | Chairs | Description |
|------------|--------|-------------|
| **Focus** | 1 | Solo work — one agent, one scope |
| **Collab** | 2-4 | Pair/group work — multiple agents, shared context |
| **Boardroom** | 4-8 | Large team — integration tasks, war rooms |
| **Consultation** | 2 | Strategist + User |
| **Review** | 3 | PM + Architect + Reviewer |

The table type determines the maximum number of agents that can work simultaneously and the collaboration mode.

## Chair

A **Chair** is an agent slot at a table. When an agent enters a room, they sit at a specific table in an available chair. The number of chairs limits concurrency — a Focus table with 1 chair means only one agent can work at a time.

## Spatial Flow Example

```
1. User says "Build me a todo app"
2. Strategist Office (Strategy Floor)
   └── Consultation Table (2 chairs: Strategist + User)
   └── Exit: Building Blueprint (goals, floors, rooms, agents)

3. Discovery Room (Collaboration Floor)
   └── Collab Table (4 chairs: PM + SMEs + User)
   └── Exit: Requirements Document (outcomes, constraints, risks)

4. Architecture Room (Collaboration Floor)
   └── Collab Table (4 chairs: Architect + PM)
   └── Exit: Architecture Document (milestones, tasks, dependencies)

5. Code Lab (Execution Floor)
   └── Focus Table (1 chair: Developer)
   └── Exit: Implementation Report (files, tests, changes)

6. Testing Lab (Execution Floor)
   └── Focus/Collab Table (1-3 chairs: QA agents)
   └── Exit: Test Report (pass/fail, coverage, recommendations)

7. Review Room (Governance Floor)
   └── Review Table (3 chairs: PM + Architect + Reviewer)
   └── Exit: Gate Review (GO/NO-GO/CONDITIONAL)

8. Deploy Room (Operations Floor)
   └── Focus Table (1 chair: DevOps)
   └── Exit: Deployment Report (env, version, health, rollback)
```
