# Commands — Complete Reference

Overlord v2 includes a slash-command system for quick actions in the chat interface.
Commands are prefixed with `/` and can be typed directly or selected from the autocomplete menu.

**Source:** `src/commands/builtin-commands.ts`, `src/commands/command-registry.ts`

---

## Built-in Commands

### `/help`
List all available commands or show help for a specific command.

| Property | Value |
|----------|-------|
| **Aliases** | `h`, `?` |
| **Scope** | `global` |
| **Usage** | `/help [command]` |

**Examples:**
```
/help              → Lists all commands with descriptions
/help phase        → Shows detailed help for /phase
/h agents          → Shows detailed help for /agents
```

---

### `/status`
Show building status including current phase, room count, and agent count.

| Property | Value |
|----------|-------|
| **Aliases** | `s`, `info` |
| **Scope** | `global` |
| **Usage** | `/status [buildingId]` |

**Response format:**
```
**Building: MyProject**
Phase: discovery
Rooms: 5
Agents: 3
```

---

### `/phase`
Show the current phase and gate status for a building.

| Property | Value |
|----------|-------|
| **Aliases** | `p`, `gate` |
| **Scope** | `building` |
| **Usage** | `/phase [buildingId]` |

**Response format:**
```
**Phase Status: MyProject**
Current: Phase 2 (architecture)
Gates:
  - Phase 1 → Phase 2: GO (reviewer: alice, 2026-03-10)
  - Phase 2 → Phase 3: PENDING
Can advance: No (gate not signed off)
```

---

### `/agents`
List all registered agents with their roles and current room assignments.

| Property | Value |
|----------|-------|
| **Aliases** | `a`, `team` |
| **Scope** | `global` |
| **Usage** | `/agents` |

**Response format:**
```
**Agents (3):**
- architect-1 (Architect) — in architecture-room-1
- coder-1 (Developer) — idle
- qa-1 (QA Engineer) — in testing-lab-1
```

---

### `/rooms`
List all rooms with their type, floor, and current occupancy.

| Property | Value |
|----------|-------|
| **Aliases** | `r` |
| **Scope** | `global` |
| **Usage** | `/rooms` |

**Response format:**
```
**Rooms (5):**
- strategist-room (strategist) — Floor 0, 1 agent
- discovery-room (discovery) — Floor 1, 0 agents
- arch-room (architecture) — Floor 2, 2 agents
- code-lab-1 (code-lab) — Floor 3, 1 agent
- test-lab-1 (testing-lab) — Floor 4, 0 agents
```

---

### `/raid`
Show the RAID log (Risks, Assumptions, Issues, Decisions), optionally filtered by type.

| Property | Value |
|----------|-------|
| **Aliases** | `log` |
| **Scope** | `building` |
| **Usage** | `/raid [type] [buildingId]` |

**Response format:**
```
**RAID Log (8 entries):**

Risks (2):
  R-001: Data migration may lose customer records [active]
  R-002: Third-party API rate limits during peak [active]

Assumptions (2):
  A-001: Team has access to staging environment [active]
  A-002: Client approves design by Friday [superseded]

Issues (3):
  I-001: Auth middleware storing tokens insecurely [active]
  I-002: CSS not loading in Safari 15 [closed]
  I-003: Memory leak in socket handler [active]

Decisions (1):
  D-001: Use SQLite for v2, migrate to Postgres later [active]
```

---

### `/deploy`
Trigger a deployment readiness check for the current building.

| Property | Value |
|----------|-------|
| **Aliases** | — |
| **Scope** | `building` |
| **Usage** | `/deploy [buildingId]` |

Emits `deploy:check` event on the bus, which broadcasts to all clients.

---

### `/review`
Show the review status for the current phase, including gate status and blocking issues.

| Property | Value |
|----------|-------|
| **Aliases** | — |
| **Scope** | `building` |
| **Usage** | `/review [buildingId]` |

**Response format:**
```
**Review Status:**
Phase: architecture
Gate: PENDING (0/1 sign-offs)
Active Issues: 2
Active Risks: 1
Ready to Advance: No
```

---

## Command Registry API

Commands are managed through the registry in `src/commands/command-registry.ts`.

### `registerCommand(definition)`

Register a new command (built-in or plugin).

```typescript
import { registerCommand } from './commands/command-registry.js';

registerCommand({
  name: 'my-command',
  description: 'Does something useful',
  usage: '/my-command [arg]',
  aliases: ['mc'],
  scope: 'building',      // 'global' | 'building' | 'room'
  execute: async (args, context) => {
    // context: { buildingId?, roomId?, agentId?, socketId }
    return { ok: true, data: 'Command executed' };
  }
});
```

### `listCommands()`

List all registered commands. Returns an array of command definitions.

### `getCommand(name)`

Get a command by name or alias. Returns the command definition or `undefined`.

### `parseCommandText(text)`

Parse a `/command arg1 arg2` string into `{ command: string, args: string[] }`.

### `dispatchCommand(name, args, context)`

Execute a command by name with arguments and context. Returns a `Result`.

---

## Chat Token Integration

Commands integrate with the chat token system. When a user types `/` in the chat input,
the frontend requests available commands via the `command:list` socket event and shows
them as autocomplete suggestions.

```javascript
// Frontend: chat-view.js
async _handleTokenTrigger(type, query) {
  if (type === 'command') {
    // Fetch from server
    await window.overlordSocket.fetchCommands();
    const commands = store.get('commands.list');
    // Show matching commands as suggestions
  }
}
```

Commands dispatched from chat are processed in `socket-handler.ts` at the `chat:message`
handler, which calls `dispatchCommand()` and returns the result as a `chat:response` event.
