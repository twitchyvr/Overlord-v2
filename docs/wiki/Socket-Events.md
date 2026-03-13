# Socket Events

## Overview

Socket.IO events are organized by domain. The transport layer maps socket events to internal bus events and broadcasts bus events back to connected clients.

**Source:** `src/transport/socket-handler.ts`
**Full reference:** [`docs/api/socket-events.md`](../api/socket-events.md)

## Client → Server Events

### Building Domain
| Event | Data | Response | Description |
|-------|------|----------|-------------|
| `building:create` | `{ name?, description?, metadata? }` | `Result<Building>` | Create a new building |
| `building:get` | `{ buildingId }` | `Result<Building>` | Get building info |
| `building:list` | `{ projectId? }` | `Result<Building[]>` | List all buildings |
| `building:apply-blueprint` | `{ buildingId, blueprint, agentId }` | `Result<void>` | Apply Phase Zero blueprint |

### Floor Domain
| Event | Data | Response | Description |
|-------|------|----------|-------------|
| `floor:list` | `{ buildingId }` | `Result<Floor[]>` | List floors in a building |
| `floor:get` | `{ floorId }` | `Result<Floor>` | Get floor details |

### Room Domain
| Event | Data | Response | Description |
|-------|------|----------|-------------|
| `room:create` | `{ floorId, type, name, config? }` | `Result<Room>` | Create a new room |
| `room:get` | `{ roomId }` | `Result<Room>` | Get room details |
| `room:list` | `{}` | `Result<Room[]>` | List all rooms |
| `room:enter` | `{ roomId, agentId, agentName?, agentRole? }` | `Result<{ tools }>` | Agent enters a room |
| `room:exit` | `{ roomId, agentId }` | `Result<void>` | Agent exits a room |

### Agent Domain
| Event | Data | Response | Description |
|-------|------|----------|-------------|
| `agent:register` | `{ name, role, capabilities, badge? }` | `Result<Agent>` | Register a new agent |
| `agent:get` | `{ agentId }` | `Result<Agent>` | Get agent details |
| `agent:list` | `{ status?, roomId? }` | `Result<Agent[]>` | List agents |

### Chat Domain
| Event | Data | Response | Description |
|-------|------|----------|-------------|
| `chat:message` | `{ text, tokens, buildingId?, roomId?, agentId? }` | `Result<void>` | Send a chat message (parsed for /commands, @mentions, #references) |

### Command Domain
| Event | Data | Response | Description |
|-------|------|----------|-------------|
| `command:list` | `{}` | `Result<Command[]>` | List all registered commands |

### Phase Domain
| Event | Data | Response | Description |
|-------|------|----------|-------------|
| `phase:status` | `{ buildingId }` | `Result<PhaseStatus>` | Get phase status |
| `phase:gate` | `{ buildingId, phase }` | `Result<Gate>` | Get gate info for a phase |
| `phase:gates` | `{ buildingId }` | `Result<Gate[]>` | List all gates |
| `phase:can-advance` | `{ buildingId }` | `Result<{ canAdvance, reason? }>` | Check if phase can advance |
| `phase:gate:signoff` | `{ gateId, reviewer, verdict, conditions? }` | `Result<void>` | Sign off a phase gate |
| `phase:advance` | `{ buildingId, reviewer? }` | `Result<{ from, to }>` | Advance to next phase |

### RAID Domain
| Event | Data | Response | Description |
|-------|------|----------|-------------|
| `raid:list` | `{ buildingId }` | `Result<RaidEntry[]>` | List RAID entries |
| `raid:search` | `{ buildingId, type?, status? }` | `Result<RaidEntry[]>` | Search RAID entries |
| `raid:add` | `{ buildingId, type, phase, summary, rationale? }` | `Result<RaidEntry>` | Add a RAID entry |
| `raid:update` | `{ id, status }` | `Result<void>` | Update RAID entry status |

### Task Domain
| Event | Data | Response | Description |
|-------|------|----------|-------------|
| `task:create` | `{ buildingId, title, description?, status?, ... }` | `Result<Task>` | Create a task |
| `task:update` | `{ id, ...fields }` | `Result<Task>` | Update a task |
| `task:list` | `{ buildingId, status?, phase?, assigneeId? }` | `Result<Task[]>` | List tasks |
| `task:get` | `{ id }` | `Result<{ task, todos }>` | Get task with todos |

### Todo Domain
| Event | Data | Response | Description |
|-------|------|----------|-------------|
| `todo:create` | `{ taskId, description, agentId?, ... }` | `Result<Todo>` | Create a todo |
| `todo:toggle` | `{ id }` | `Result<Todo>` | Toggle todo status |
| `todo:list` | `{ taskId }` | `Result<Todo[]>` | List todos for a task |

### Exit Document Domain
| Event | Data | Response | Description |
|-------|------|----------|-------------|
| `exit-doc:submit` | `{ roomId, agentId, document, buildingId? }` | `Result<ExitDoc>` | Submit an exit document |
| `exit-doc:get` | `{ roomId }` | `Result<ExitDoc[]>` | Get exit docs for a room |
| `exit-doc:list` | `{ buildingId }` | `Result<ExitDoc[]>` | List all exit docs |

### System Domain
| Event | Data | Response | Description |
|-------|------|----------|-------------|
| `system:status` | `{}` | `Result<{ isNewUser, buildings }>` | New user check + buildings |
| `system:health` | `{}` | `Result<{ uptime, version }>` | Health check |

## Server → Client Broadcasts

These are emitted from the bus and broadcast to all connected clients:

| Event | Data | Trigger |
|-------|------|---------|
| `room:agent:entered` | `{ roomId, roomType, agentId, agentName, tableType, status }` | Agent enters a room |
| `room:agent:exited` | `{ roomId, roomType, agentId }` | Agent exits a room |
| `chat:response` | `{ content, agentId, roomId, type }` | AI/command response |
| `chat:stream` | `{ token?, delta?, agentId?, roomId? }` | Streaming AI response |
| `tool:executed` | `{ toolName, agentId, roomId, result, tier?, duration? }` | Tool execution completed |
| `phase:advanced` | `{ buildingId, from, to, gateId }` | Phase gate passed |
| `phase:gate:signed-off` | `{ gateId, verdict, reviewer, conditions? }` | Gate signed off |
| `raid:entry:added` | `{ buildingId, type, phase, summary, id }` | New RAID entry |
| `phase-zero:complete` | `{ buildingId, blueprint }` | Phase Zero completed |
| `phase-zero:failed` | `{ buildingId, error, reason }` | Phase Zero failed |
| `exit-doc:submitted` | `{ roomId, roomType, buildingId, agentId, document }` | Exit doc submitted |
| `scope-change:detected` | `{ roomId, type, description, suggestedActions }` | Scope change detected |
| `agent:mentioned` | `{ agentId, mentionedBy, message }` | Agent mentioned in chat |
| `deploy:check` | `{ buildingId, requestedBy, timestamp }` | Deploy check triggered |
| `task:created` | `{ id, buildingId, title }` | Task created |
| `task:updated` | `{ id, buildingId, status? }` | Task updated |

## Event Flow

```
Client                    Transport               Bus                   Domain
  |                          |                     |                      |
  |-- room:enter ----------->|                     |                      |
  |                          |-- room:enter ------->|                      |
  |                          |                     |-- (rooms.enterRoom) ->|
  |                          |                     |<-- ok({ tools }) -----|
  |                          |<-- ack(Result) ------|                      |
  |<-- ack callback ---------|                     |                      |
  |                          |                     |-- room:agent:entered  |
  |<-- room:agent:entered ---|<-- broadcast --------|                      |
  |                          |                     |                      |
```

## Acknowledgment Pattern

Events that modify state use the Socket.IO acknowledgment pattern:

```typescript
// Client sends with callback
socket.emit('room:create', { type: 'code-lab', ... }, (result) => {
  if (result.ok) { /* success */ }
  else { /* handle error */ }
});

// Server responds via callback
socket.on('room:create', (data, ack) => {
  const result = rooms.createRoom(data);
  if (ack) ack(result);
});
```

Fire-and-forget events (like `chat:message`) do not use acknowledgments.
