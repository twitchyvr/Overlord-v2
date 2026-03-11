# Floors

## Overview

Floors are categories of rooms grouped by purpose. Each floor maps to a phase or function in the project lifecycle. A building contains 7 floors by default, though the Strategist can configure which floors are active during Phase Zero.

## Floor Types

### Lobby (Floor 0)
**Purpose:** Dashboard, user-facing, always active.

| Room | Description |
|------|-------------|
| Main Chat | Primary user interaction point |
| Dashboard | Project overview, status, metrics |
| Project Gallery | Browse and manage buildings |
| Security Desk | Access control, permissions overview |

The Lobby is the default floor. Users interact through the Lobby, and it remains active regardless of the current project phase.

### Strategy (Floor 1)
**Purpose:** Phase Zero setup — consultative project initialization.

| Room | Description |
|------|-------------|
| Strategist Office | "What are you building? What does success look like?" |
| Building Architect | Configure floors, rooms, and agents for the building |

The Strategy floor is active before any project work begins. The Strategist asks consultative questions and produces a Building Blueprint that configures the entire project.

### Collaboration (Floor 2)
**Purpose:** Planning, requirements, and incident response.

| Room | Description |
|------|-------------|
| Discovery Room | Define outcomes, constraints, unknowns |
| Architecture Room | Milestones, tasks, dependency graphs, tech decisions |
| War Room | Incident response — elevated access, time-boxed |

The Collaboration floor handles all planning work. Agents in these rooms have read-only file access and focus on analysis and documentation.

### Execution (Floor 3)
**Purpose:** Building and testing code.

| Room | Description |
|------|-------------|
| Code Lab | Full implementation workspace with write access |
| Testing Lab | Test-only workspace — cannot modify source code |
| Integration Room | Cross-module integration work |

The Execution floor is where code gets written and tested. The key invariant is that the Testing Lab **structurally cannot** modify source code — `write_file` is not in its tools list.

### Operations (Floor 4)
**Purpose:** Deployment and monitoring.

| Room | Description |
|------|-------------|
| Deploy Room | Git operations, CI/CD triggers, verification |
| Monitoring Room | Post-deployment health checks, metrics |

The Operations floor handles everything after code is approved. It requires Governance floor sign-off before deployment can proceed.

### Governance (Floor 5)
**Purpose:** Sign-off, audit, and release.

| Room | Description |
|------|-------------|
| Review Room | GO/NO-GO decisions with evidence requirements |
| Audit Room | Compliance and security review |
| Release Lounge | Final release sign-off |

The Governance floor is the quality gate. Nothing advances to deployment without passing through Review. Agents must provide evidence with `file:line` citations.

### Integration (Floor 6)
**Purpose:** External I/O and plugin communication.

| Room | Description |
|------|-------------|
| Plugin Bay | Plugin loading and management |
| Data Exchange | External data import/export |
| Provider Hub | AI provider management and configuration |

The Integration floor handles all external communication. This is where plugins register, external APIs connect, and AI provider configuration happens.

## Default Building Layout

When a building is created via the seed script, it gets all 7 floors:

```typescript
const FLOORS = [
  { type: 'lobby',         name: 'Lobby',         sortOrder: 0 },
  { type: 'strategy',      name: 'Strategy',      sortOrder: 1 },
  { type: 'collaboration', name: 'Collaboration', sortOrder: 2 },
  { type: 'execution',     name: 'Execution',     sortOrder: 3 },
  { type: 'operations',    name: 'Operations',    sortOrder: 4 },
  { type: 'governance',    name: 'Governance',    sortOrder: 5 },
  { type: 'integration',   name: 'Integration',   sortOrder: 6 },
];
```
