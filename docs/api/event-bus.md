# Internal Event Bus — Complete Reference

The event bus is the central nervous system of Overlord v2. Domain modules communicate
through the bus rather than importing each other directly, enforcing the layered
architecture with no circular dependencies.

**Source:** `src/core/bus.ts`

---

## Architecture

```
Transport Layer (socket-handler.ts)
        ↕ bus events
Internal Bus (bus.ts) — eventemitter3
        ↕ bus events
Domain Layers (rooms, agents, tools, ai, storage)
```

The bus sits between the transport layer and domain logic:
- **Inbound:** Socket events are forwarded to the bus by `socket-handler.ts`
- **Outbound:** Domain events emitted on the bus are broadcast to connected clients
- **Internal:** Domain modules communicate with each other via bus events

---

## Bus Events

### Room Lifecycle

| Event | Payload | Emitted By | Consumed By |
|-------|---------|------------|-------------|
| `room:create` | `{ type, floorId, name, config? }` | Transport | Rooms module |
| `room:enter` | `{ roomId, agentId, agentName?, agentRole? }` | Transport | Rooms module |
| `room:exit` | `{ roomId, agentId }` | Transport | Rooms module |
| `room:agent:entered` | `{ roomId, roomType, agentId, agentName, tableType, status }` | Rooms module | Transport (broadcast) |
| `room:agent:exited` | `{ roomId, roomType, agentId }` | Rooms module | Transport (broadcast) |

### Agent Lifecycle

| Event | Payload | Emitted By | Consumed By |
|-------|---------|------------|-------------|
| `agent:register` | `{ name, role, capabilities, badge? }` | Transport | Agents module |
| `agent:remove` | `{ agentId }` | Transport | Agents module |
| `agent:mentioned` | `{ agentId, mentionedBy, message }` | Chat handler | Transport (broadcast) |

### Chat & Messages

| Event | Payload | Emitted By | Consumed By |
|-------|---------|------------|-------------|
| `chat:message` | `{ text, tokens, buildingId?, roomId?, agentId? }` | Transport | Chat handler |
| `chat:response` | `{ content, agentId?, roomId?, type }` | Chat handler | Transport (broadcast) |
| `chat:stream` | `{ token?, delta?, agentId?, roomId? }` | AI provider | Transport (broadcast) |

### Tool Execution

| Event | Payload | Emitted By | Consumed By |
|-------|---------|------------|-------------|
| `tool:executing` | `{ toolName, agentId, roomId, params }` | Tool registry | Activity tracking |
| `tool:executed` | `{ toolName, agentId, roomId, result, duration?, tier? }` | Tool registry | Transport (broadcast) |
| `tool:blocked` | `{ toolName, agentId, roomId, reason }` | Tool registry | Activity tracking |

### Phase Management

| Event | Payload | Emitted By | Consumed By |
|-------|---------|------------|-------------|
| `phase:status` | `{ buildingId }` | Transport | Phase module |
| `phase:gate` | `{ buildingId, phase }` | Transport | Phase module |
| `phase:advanced` | `{ buildingId, from, to, gateId }` | Phase module | Transport (broadcast) |
| `phase:gate:signed-off` | `{ gateId, verdict, reviewer, conditions? }` | Phase module | Transport (broadcast) |

### Phase Zero

| Event | Payload | Emitted By | Consumed By |
|-------|---------|------------|-------------|
| `phase-zero:complete` | `{ buildingId, blueprint }` | Strategist room | Transport (broadcast) |
| `phase-zero:failed` | `{ buildingId, error, reason }` | Strategist room | Transport (broadcast) |

### Exit Documents

| Event | Payload | Emitted By | Consumed By |
|-------|---------|------------|-------------|
| `room:submit-exit-doc` | `{ roomId, agentId, document }` | Transport | Rooms module |
| `exit-doc:submitted` | `{ roomId, roomType, buildingId, agentId, document }` | Rooms module | Transport (broadcast) |

### RAID Log

| Event | Payload | Emitted By | Consumed By |
|-------|---------|------------|-------------|
| `raid:entry:added` | `{ buildingId, type, phase, summary, id }` | RAID module | Transport (broadcast) |

### Task & Todo

| Event | Payload | Emitted By | Consumed By |
|-------|---------|------------|-------------|
| `task:created` | `{ id, buildingId, title }` | Task module | Transport (broadcast) |
| `task:updated` | `{ id, buildingId, status? }` | Task module | Transport (broadcast) |

### Scope Changes

| Event | Payload | Emitted By | Consumed By |
|-------|---------|------------|-------------|
| `scope-change:detected` | `{ roomId, type, description, suggestedActions }` | Rooms module | Transport (broadcast) |

### Deployment

| Event | Payload | Emitted By | Consumed By |
|-------|---------|------------|-------------|
| `deploy:check` | `{ buildingId, requestedBy, timestamp }` | Deploy command | Transport (broadcast) |

### System

| Event | Payload | Emitted By | Consumed By |
|-------|---------|------------|-------------|
| `server:ready` | `{ port, version }` | Server | Startup logging |
| `server:shutdown` | `{}` | Server | Cleanup handlers |
| `ask_user:request` | `{ question, context?, agentId }` | `ask_user` tool | Transport (to chat UI) |

---

## Bus API

### `bus.emit(event, data)`
Emit an event with data. All subscribers are notified synchronously.

### `bus.on(event, handler)`
Subscribe to an event. Returns an unsubscribe function.

### `bus.off(event, handler)`
Unsubscribe a specific handler from an event.

### `bus.once(event, handler)`
Subscribe to an event for a single invocation only.

---

## Structured Envelope

All bus events follow a consistent pattern. Domain events include metadata:

```typescript
bus.emit('tool:executed', {
  toolName: 'bash',
  agentId: 'agent-1',
  roomId: 'room-1',
  result: { ok: true, data: { stdout: '...', exitCode: 0 } },
  duration: 1234,
  tier: 1,
  timestamp: Date.now()
});
```

---

## Socket Bridge (Client-Side)

On the client side, the socket bridge (`public/ui/engine/socket-bridge.js`) maps
incoming socket events to the reactive store and the UI engine's event bus:

```javascript
// Server broadcasts tool:executed → socket bridge receives it
socket.on('tool:executed', (data) => {
  // Update store (for persistent state)
  store.update('activity.items', (items) => [
    { event: 'tool:executed', ...data, timestamp: Date.now() },
    ...(items || []).slice(0, 99)
  ]);

  // Dispatch on engine bus (for live UI updates)
  engine.dispatch('tool:executed', data);
  engine.dispatch('activity:new', { event: 'tool:executed', ...data });
});
```

This dual approach ensures:
- **Store updates** persist state and trigger subscribed components
- **Engine dispatches** provide immediate event-driven updates
