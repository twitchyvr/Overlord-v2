# Socket Events

## Overview

Socket.IO events are organized by domain. The transport layer maps socket events to internal bus events and broadcasts bus events back to connected clients.

**Source:** `src/transport/socket-handler.ts`

## Client → Server Events

### Building Domain
| Event | Data | Response | Description |
|-------|------|----------|-------------|
| `building:get` | `{}` | `{ ok, data }` | Get building info |

### Room Domain
| Event | Data | Response | Description |
|-------|------|----------|-------------|
| `room:create` | `{ type, floorId, name, config? }` | Result | Create a new room |
| `room:list` | `{}` | `{ ok, data: Room[] }` | List all rooms |
| `room:enter` | `{ roomId, agentId, tableType? }` | Result | Agent enters a room |
| `room:exit` | `{ roomId, agentId }` | Result | Agent exits a room |

### Agent Domain
| Event | Data | Response | Description |
|-------|------|----------|-------------|
| `agent:register` | `{ name, role, capabilities, roomAccess, badge }` | Result | Register a new agent |
| `agent:list` | `{ status?, roomId? }` | `{ ok, data: Agent[] }` | List agents |

### Chat Domain
| Event | Data | Response | Description |
|-------|------|----------|-------------|
| `chat:message` | `{ content, roomId?, agentId? }` | — | Send a chat message (no ack) |

### Phase Domain
| Event | Data | Response | Description |
|-------|------|----------|-------------|
| `phase:status` | `{ buildingId }` | `{ ok }` | Get phase status |
| `phase:gate` | `{ gateId, verdict, ... }` | `{ ok }` | Submit gate sign-off |

### RAID Domain
| Event | Data | Response | Description |
|-------|------|----------|-------------|
| `raid:search` | `{ buildingId, type?, phase?, query? }` | `{ ok }` | Search RAID log |

### System Domain
| Event | Data | Response | Description |
|-------|------|----------|-------------|
| `system:health` | — | `{ ok, data: { uptime, version } }` | Health check |

## Server → Client Broadcasts

These are emitted from the bus and broadcast to all connected clients:

| Event | Data | Trigger |
|-------|------|---------|
| `room:agent:entered` | `{ roomId, agentId, ... }` | Agent enters a room |
| `room:agent:exited` | `{ roomId, agentId, ... }` | Agent exits a room |
| `chat:response` | `{ content, agentId, roomId }` | AI response to chat |
| `chat:stream` | `{ chunk, agentId, roomId }` | Streaming AI response |
| `tool:executed` | `{ toolName, result, roomId }` | Tool execution completed |
| `phase:advanced` | `{ buildingId, from, to }` | Phase gate passed |
| `raid:entry:added` | `{ id, type, summary }` | New RAID entry |

## Event Flow

```
Client                    Transport               Bus                   Domain
  │                          │                     │                      │
  ├── room:enter ──────────►│                     │                      │
  │                          ├── room:enter ──────►│                      │
  │                          │                     ├── (rooms.enterRoom) ►│
  │                          │                     │◄── ok({ tools }) ────┤
  │                          │                     ├── room:agent:entered │
  │◄── room:agent:entered ──┤◄── broadcast ───────┤                      │
  │                          │                     │                      │
```

## Connection Lifecycle

```typescript
io.on('connection', (socket) => {
  // Client connected — register all event handlers
  socket.on('room:create', (data, ack) => { ... });
  socket.on('room:list', (data, ack) => { ... });
  // ...

  socket.on('disconnect', () => {
    // Client disconnected — cleanup
  });
});
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
