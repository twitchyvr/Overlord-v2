# Socket Events — Complete Reference

All real-time communication between the Overlord v2 client and server uses Socket.IO events.
Events follow a domain-namespaced pattern (`domain:action`) and use the acknowledgment
callback (`ack`) for request/response flows.

**Source:** `src/transport/socket-handler.ts`

---

## Universal Response Envelope

All acknowledged events return a `Result<T>`:

```typescript
// Success
{ ok: true, data: T, metadata?: { duration?, roomId?, agentId?, phase? } }

// Failure
{ ok: false, error: { code: string, message: string, retryable: boolean, context?: unknown } }
```

---

## Client → Server Events

### Building Domain

| Event | Payload | Response | Description |
|-------|---------|----------|-------------|
| `building:create` | `{ name?: string, description?: string, metadata?: object }` | `Result<Building>` | Create a new building |
| `building:get` | `{ buildingId: string }` | `Result<Building>` | Get building details |
| `building:list` | `{ projectId?: string }` | `Result<Building[]>` | List all buildings (optionally filtered by project) |
| `building:apply-blueprint` | `{ buildingId: string, blueprint: object, agentId: string }` | `Result<void>` | Apply a Phase Zero blueprint to a building |

### Floor Domain

| Event | Payload | Response | Description |
|-------|---------|----------|-------------|
| `floor:list` | `{ buildingId: string }` | `Result<Floor[]>` | List floors in a building |
| `floor:get` | `{ floorId: string }` | `Result<Floor>` | Get floor details |

### Room Domain

| Event | Payload | Response | Description |
|-------|---------|----------|-------------|
| `room:create` | `{ floorId: string, type: string, name: string, config?: object }` | `Result<Room>` | Create a room on a floor |
| `room:get` | `{ roomId: string }` | `Result<Room>` | Get room details (includes tables, agents, tools) |
| `room:list` | `{}` | `Result<Room[]>` | List all rooms |
| `room:enter` | `{ roomId: string, agentId: string, agentName?: string, agentRole?: string }` | `Result<{ tools: string[] }>` | Agent enters a room — returns allowed tools |
| `room:exit` | `{ roomId: string, agentId: string }` | `Result<void>` | Agent exits a room |

### Agent Domain

| Event | Payload | Response | Description |
|-------|---------|----------|-------------|
| `agent:register` | `{ name: string, role: string, capabilities: string[], badge?: string }` | `Result<Agent>` | Register a new agent |
| `agent:get` | `{ agentId: string }` | `Result<Agent>` | Get agent details |
| `agent:list` | `{ roomId?: string, status?: string }` | `Result<Agent[]>` | List agents (optionally filtered) |

### Chat Domain

| Event | Payload | Response | Description |
|-------|---------|----------|-------------|
| `chat:message` | `{ text: string, tokens: ParsedToken[], buildingId?: string, roomId?: string, agentId?: string }` | `Result<void>` | Send a chat message; parsed for `/commands`, `@mentions`, `#references` |

**ParsedToken format:**
```typescript
{
  type: 'command' | 'agent' | 'reference',
  char: '/' | '@' | '#',
  id: string,
  label: string
}
```

### Command Domain

| Event | Payload | Response | Description |
|-------|---------|----------|-------------|
| `command:list` | `{}` | `Result<Command[]>` | List all registered commands |

### Phase Domain

| Event | Payload | Response | Description |
|-------|---------|----------|-------------|
| `phase:status` | `{ buildingId: string }` | `Result<PhaseStatus>` | Get current phase status |
| `phase:gate` | `{ buildingId: string, phase: string }` | `Result<Gate>` | Get gate info for a phase |
| `phase:gates` | `{ buildingId: string }` | `Result<Gate[]>` | List all gates for a building |
| `phase:can-advance` | `{ buildingId: string }` | `Result<{ canAdvance: boolean, reason?: string }>` | Check if phase can advance |
| `phase:gate:signoff` | `{ gateId: string, reviewer: string, verdict: GateVerdict, conditions?: string, exitDocId?: string, nextPhaseInput?: object }` | `Result<void>` | Sign off a phase gate |
| `phase:advance` | `{ buildingId: string, reviewer?: string, nextPhaseInput?: object }` | `Result<{ from: string, to: string }>` | Advance to the next phase |

**GateVerdict:** `'GO' | 'NO-GO' | 'CONDITIONAL'`

### RAID Domain

| Event | Payload | Response | Description |
|-------|---------|----------|-------------|
| `raid:list` | `{ buildingId: string }` | `Result<RaidEntry[]>` | List all RAID entries |
| `raid:search` | `{ buildingId: string, type?: RaidType, status?: RaidStatus }` | `Result<RaidEntry[]>` | Search RAID entries |
| `raid:add` | `{ buildingId: string, type: RaidType, phase: string, summary: string, rationale?: string }` | `Result<RaidEntry>` | Add a RAID entry |
| `raid:update` | `{ id: string, status: RaidStatus }` | `Result<void>` | Update RAID entry status |

**RaidType:** `'risk' | 'assumption' | 'issue' | 'decision'`
**RaidStatus:** `'active' | 'superseded' | 'closed'`

### Task Domain

| Event | Payload | Response | Description |
|-------|---------|----------|-------------|
| `task:create` | `{ buildingId: string, title: string, description?: string, status?: string, parentId?: string, milestoneId?: string, assigneeId?: string, roomId?: string, phase?: string, priority?: number }` | `Result<Task>` | Create a task |
| `task:update` | `{ id: string, ...updatable fields }` | `Result<Task>` | Update a task |
| `task:list` | `{ buildingId: string, status?: string, phase?: string, assigneeId?: string }` | `Result<Task[]>` | List tasks (with filters) |
| `task:get` | `{ id: string }` | `Result<{ task: Task, todos: Todo[] }>` | Get task with associated todos |

### Todo Domain

| Event | Payload | Response | Description |
|-------|---------|----------|-------------|
| `todo:create` | `{ taskId: string, description: string, agentId?: string, roomId?: string, status?: string, exitDocRef?: string }` | `Result<Todo>` | Create a todo under a task |
| `todo:toggle` | `{ id: string }` | `Result<Todo>` | Toggle todo done/not-done |
| `todo:list` | `{ taskId: string }` | `Result<Todo[]>` | List todos for a task |

### Exit Document Domain

| Event | Payload | Response | Description |
|-------|---------|----------|-------------|
| `exit-doc:submit` | `{ roomId: string, agentId: string, document: object, buildingId?: string, phase?: string }` | `Result<ExitDoc>` | Submit an exit document |
| `exit-doc:get` | `{ roomId: string }` | `Result<ExitDoc[]>` | Get exit docs for a room |
| `exit-doc:list` | `{ buildingId: string }` | `Result<ExitDoc[]>` | List all exit docs for a building |

### System Domain

| Event | Payload | Response | Description |
|-------|---------|----------|-------------|
| `system:status` | `{}` | `Result<{ isNewUser: boolean, buildings: Building[] }>` | Check if new user, list buildings |
| `system:health` | `{}` | `Result<{ uptime: number, version: string }>` | Server health check |

---

## Server → Client Broadcasts

These events are emitted by the server to all connected clients (via internal bus → socket bridge).

| Event | Payload | Trigger |
|-------|---------|---------|
| `room:agent:entered` | `{ roomId, roomType, agentId, agentName, tableType, status: 'active' }` | Agent entered a room |
| `room:agent:exited` | `{ roomId, roomType, agentId }` | Agent exited a room |
| `chat:response` | `{ content, agentId?, roomId?, type: 'command'\|'mention'\|'reference' }` | AI/command response |
| `chat:stream` | `{ token?, delta?, agentId?, roomId? }` | Streaming LLM tokens |
| `tool:executed` | `{ toolName, agentId, roomId, result, tier?, duration? }` | Tool execution completed |
| `phase:advanced` | `{ buildingId, from, to, gateId }` | Phase gate passed, advanced |
| `phase:gate:signed-off` | `{ gateId, verdict, reviewer, conditions? }` | Gate signed off |
| `raid:entry:added` | `{ buildingId, type, phase, summary, id }` | New RAID entry created |
| `phase-zero:complete` | `{ buildingId, blueprint }` | Phase Zero (strategist) completed |
| `phase-zero:failed` | `{ buildingId, error, reason }` | Phase Zero failed |
| `exit-doc:submitted` | `{ roomId, roomType, buildingId, agentId, document }` | Exit document submitted |
| `scope-change:detected` | `{ roomId, type, description, suggestedActions }` | Scope change detected |
| `agent:mentioned` | `{ agentId, mentionedBy, message }` | Agent mentioned in chat |
| `deploy:check` | `{ buildingId, requestedBy, timestamp }` | Deployment check triggered |
| `task:created` | `{ id, buildingId, title }` | Task created |
| `task:updated` | `{ id, buildingId, status? }` | Task updated |

---

## Event Flow Diagram

```
Client (Browser)          Transport (socket-handler.ts)       Bus (bus.ts)           Domain Layer
     |                              |                            |                       |
     |── room:enter ───────────────>|                            |                       |
     |                              |── room:enter ─────────────>|                       |
     |                              |                            |── rooms.enterRoom() ──>|
     |                              |                            |<── Result<{tools}> ────|
     |                              |<── ack(Result) ────────────|                       |
     |<── ack callback ────────────|                            |                       |
     |                              |                            |── room:agent:entered ──>|
     |<── room:agent:entered (broadcast) ────────────────────────|                       |
     |                              |                            |                       |
```

## Connection Lifecycle

```typescript
// Server-side pattern
io.on('connection', (socket) => {
  // All event handlers registered here
  socket.on('room:create', (data, ack) => { /* ... */ });
  socket.on('chat:message', (data, ack) => { /* ... */ });
  // ...

  // Bus events broadcast to this socket
  bus.on('room:agent:entered', (data) => socket.emit('room:agent:entered', data));

  socket.on('disconnect', () => {
    // Cleanup: remove agent from rooms, etc.
  });
});
```

## Client-Side Usage

```javascript
// Using the socket bridge (public/ui/engine/socket-bridge.js)
const socket = io();

// Request-response with ack
socket.emit('building:list', {}, (result) => {
  if (result.ok) {
    console.log('Buildings:', result.data);
  } else {
    console.error(result.error.message);
  }
});

// Listen for broadcasts
socket.on('phase:advanced', (data) => {
  console.log(`Phase advanced: ${data.from} → ${data.to}`);
});

// The socket bridge (window.overlordSocket) wraps these patterns
window.overlordSocket.fetchCommands();  // Returns Promise<Command[]>
window.overlordSocket.advancePhase(buildingId, reviewer);
window.overlordSocket.signoffGate({ gateId, reviewer, verdict, conditions });
window.overlordSocket.searchRaid(buildingId, query);
```
