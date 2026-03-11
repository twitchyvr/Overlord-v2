# Event Bus

## Overview

The event bus is the **ONLY** shared communication channel in Overlord v2. It replaces v1's 2300-line hub.js with ~40 lines.

**Source:** `src/core/bus.ts`

## Design

- Built on `eventemitter3` for performance
- Adds a structured event envelope with timestamp
- Supports namespace-based subscriptions
- No business logic — just emit/on/off

## Structured Event Envelope

Every event emitted through the bus is wrapped in a structured envelope:

```typescript
bus.emit('room:agent:entered', { roomId, agentId });

// Receiver gets:
{
  event: 'room:agent:entered',
  timestamp: 1710123456789,
  roomId: '...',
  agentId: '...'
}
```

The `event` and `timestamp` fields are automatically added by the bus.

## API

### `bus.emit(event, data)`
Emit an event with structured envelope.

### `bus.on(event, handler)`
Subscribe to a specific event.

### `bus.off(event, handler)`
Unsubscribe from an event.

### `bus.onNamespace(prefix, handler)`
Subscribe to all events matching a namespace prefix:
```typescript
bus.onNamespace('room:', (data) => {
  // Fires for room:created, room:agent:entered, etc.
});
```

## Event Naming Convention

Events use dot-namespaced names organized by domain:

| Domain | Events |
|--------|--------|
| `server:` | `server:ready`, `server:shutdown` |
| `room:` | `room:create`, `room:enter`, `room:exit`, `room:submit-exit-doc` |
| `room:agent:` | `room:agent:entered`, `room:agent:exited` |
| `agent:` | `agent:register`, `agent:remove` |
| `chat:` | `chat:message`, `chat:response`, `chat:stream` |
| `phase:` | `phase:status`, `phase:gate`, `phase:advanced` |
| `raid:` | `raid:search`, `raid:entry:added` |
| `tool:` | `tool:executed` |
| `building:` | `building:get` |
| `system:` | `system:health` |

## Bus vs Direct Calls

The bus is used for **cross-layer communication** and **side effects**. Direct function calls are used for **synchronous operations within a layer**.

```
Room Manager handles room:enter event → updates DB → emits room:agent:entered
Transport layer listens for room:agent:entered → broadcasts via Socket.IO
```
