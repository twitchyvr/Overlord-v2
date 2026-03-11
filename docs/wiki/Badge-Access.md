# Badge Access

## Overview

Room access is controlled through **badges** on agent identity cards. When an agent tries to enter a room, the Room Manager checks if the agent's `roomAccess` array includes the room's type.

## How It Works

```typescript
// Agent's identity card
{
  name: 'Developer',
  roomAccess: ['code-lab', 'testing-lab', 'war-room']
}

// Room Manager checks on entry
const roomAccess = JSON.parse(agent.room_access);
if (!roomAccess.includes(room.type) && !roomAccess.includes('*')) {
  return err('ACCESS_DENIED', `Agent does not have access to ${room.type} rooms`);
}
```

## Wildcard Access

An agent with `roomAccess: ['*']` can enter any room. This should only be used for administrative agents.

## Default Agent Badges

| Agent | Room Access |
|-------|------------|
| Strategist | `strategist` |
| Architect | `discovery`, `architecture`, `review` |
| Developer | `code-lab`, `testing-lab`, `war-room` |
| QA Lead | `testing-lab`, `review` |
| DevOps | `deploy`, `war-room` |
| PM | `discovery`, `architecture`, `review`, `war-room` |

## Access Denied Flow

When an agent is denied entry:
1. `enterRoom()` returns `err('ACCESS_DENIED', ...)`
2. The transport layer reports the error to the client
3. The agent's status remains `idle`
4. No room context is injected

## Granting Access

Update an agent's room access via:
```typescript
updateAgent(agentId, {
  roomAccess: ['code-lab', 'testing-lab', 'deploy']
});
```

## Design Rationale

Badges provide a lightweight access control layer that:
- Prevents agents from entering rooms they shouldn't (QA Lead can't deploy)
- Keeps the enforcement at the room entry point (not scattered across tools)
- Works with the existing room type system (no separate permission model)
- Can be modified at runtime via `updateAgent()`
