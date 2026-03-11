# Agent Router

## Overview

The Agent Router handles message routing, determining which agent in which room should handle incoming messages. It supports @mentions for direct agent targeting and #references for context linking.

**Source:** `src/agents/agent-router.ts`

## Routing Logic

### Phase-Based Routing
By default, messages are routed based on the building's current phase:

| Phase | Primary Room | Primary Agent |
|-------|-------------|---------------|
| Strategy | Strategist Office | Strategist |
| Discovery | Discovery Room | PM / Architect |
| Architecture | Architecture Room | Architect |
| Execution | Code Lab | Developer |
| Review | Review Room | Architect |
| Deploy | Deploy Room | DevOps |

### @Mentions
Users can target a specific agent:
```
@developer fix the login bug in auth.ts
```

The router resolves the agent name and routes to their current room.

### #References
Users can reference previous context:
```
#task-42 Continue working on the API endpoints
```

References are resolved and injected into the message context.

## Agent Session

**Source:** `src/agents/agent-session.ts`

The `AgentSession` class tracks an agent's work within a room:

- **Available tools**: Filtered by the room's `allowedTools` list
- **File scope**: Constrained by the room's `fileScope`
- **Message history**: Scoped to the room
- **Exit document progress**: Tracking required fields

## Multi-Agent Coordination

When multiple agents are at a **Collab** or **Boardroom** table:
1. Messages are broadcast to all agents at the table
2. Each agent responds within their own session
3. The router manages turn order
4. Agents can reference each other's outputs

## Future: Delegation

Planned but not yet implemented:
- Agent-to-agent delegation within rooms
- Cross-room handoff with context brief
- Automatic escalation based on RAID entries
