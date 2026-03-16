# GNAP Integration

## Attribution

Overlord v2's agent messaging system integrates the [**GNAP (Git-Native Agent Protocol)**](https://github.com/farol-team/gnap) created by [**Farol Labs**](https://github.com/farol-team).

> **GNAP is licensed under the MIT License — Copyright (c) 2026 Farol Labs.**

This integration was proposed by [@ori-cofounder](https://github.com/ori-cofounder) from Farol Labs in [Issue #271](https://github.com/twitchyvr/Overlord-v2/issues/271#issuecomment-4050010066) and designed collaboratively in [Issue #277](https://github.com/twitchyvr/Overlord-v2/issues/277).

---

## What is GNAP?

GNAP is a decentralized coordination system for AI agents and humans to collaborate through a shared Git repository.

**Core philosophy:** *"No servers. No databases. No vendor lock-in. Just git."*

### Four Core Entities

All stored as JSON files in a `.gnap/` directory:

| Entity | Location | Purpose |
|--------|----------|---------|
| **Agents** | `agents.json` | Team roster — id, name, role, type (ai/human), status, capabilities |
| **Tasks** | `tasks/{id}.json` | Work units with state machine: backlog -> ready -> in_progress -> review -> done |
| **Runs** | `runs/{id}.json` | Execution records — tracks attempts, cost, tokens, artifacts |
| **Messages** | `messages/{id}.json` | Inter-agent communication with routing, threading, and read tracking |

### How It Works

- **Git push = send.** Agent writes a JSON message file, commits, pushes.
- **Git pull = receive.** Agent pulls, reads new message files, filters by `to` field.
- **Broadcast:** Set `to: ["*"]` for all-team messages.
- **Threading:** `thread` field links replies to parent messages.
- **Read receipts:** `read_by` array tracks who has processed each message.

---

## How Overlord Integrates GNAP

Overlord uses a **dual-mode messaging** architecture — agents can communicate via the real-time event bus (fast, ephemeral) or GNAP (persistent, auditable), or both simultaneously.

### Architecture

```
                  MessagingPort (interface)
                  /                       \
    BusMessagingAdapter            GnapMessagingAdapter
    (real-time, ephemeral)         (git-backed, persistent)
                  \                       /
                    DualModeRouter
                    (routes by urgency)
```

### Source Files

| File | Layer | Purpose |
|------|-------|---------|
| `src/core/messaging-port.ts` | Core | `MessagingPort` interface + `DualModeRouter` interface |
| `src/agents/gnap-messaging-adapter.ts` | Agents | GNAP `MessagingPort` implementation — reads/writes `.gnap/messages/*.json` |
| `src/agents/dual-mode-router.ts` | Agents | Routes: `sendRealtime` (bus only) / `sendDurable` (bus + GNAP) |

### MessagingPort Interface

```typescript
interface MessagingPort {
  send(to: string, message: AgentMessage): Promise<void>;
  receive(agentId: string): Promise<AgentMessage[]>;
  subscribe(agentId: string, callback: (msg: AgentMessage) => void): () => void;
  history?(agentId: string, limit?: number): Promise<AgentMessage[]>;
}
```

### Dual-Mode Strategy

| Mode | Transport | Latency | Persistence | Use Case |
|------|-----------|---------|-------------|----------|
| **Realtime** | Event bus only | < 100ms | Ephemeral | Tool results, status changes, UI updates |
| **Durable** | Bus + GNAP | < 100ms + async write | Git-backed | Cross-session, audit trail, external integration |

The `DualModeRouter` always sends via bus for real-time delivery. Durable messages are additionally persisted to GNAP. If GNAP write fails, the bus delivery still succeeds — GNAP is best-effort for durability.

### Per-Project Isolation

Each building's GNAP store lives at `{working_directory}/.gnap/`:

```
project-alpha/
  .gnap/
    messages/
      1710340800000-a1b2c3d4.json
      1710340860000-e5f6g7h8.json
  src/
  ...
```

Buildings without a `working_directory` fall back to bus-only mode.

### Message Format

```json
{
  "id": "a1b2c3d4-...",
  "from": "agent_strategist",
  "to": "agent_architect",
  "type": "handoff",
  "subject": "Requirements complete",
  "body": "Discovery phase finished. 12 requirements documented.",
  "transport": "gnap",
  "timestamp": 1710340800000
}
```

Message types: `task`, `question`, `update`, `handoff`, `escalation`, `notification`

---

## Configuration

GNAP messaging is toggled per building in the Settings UI (Messaging tab):

| Setting | Default | Description |
|---------|---------|-------------|
| Messaging mode | `bus` | `bus` (real-time only) or `gnap` (dual-mode) |
| GNAP directory | `.gnap` | Relative to building's `working_directory` |

### GNAP Status Endpoint

The `gnap:status` socket event returns:
- Whether GNAP is enabled and the directory is writable
- Message count and last write timestamp
- Any errors preventing operation

### GNAP Test Endpoint

The `gnap:test` socket event sends a test message through the full pipeline and verifies read-back, confirming the adapter is working end-to-end.

---

## Delivery Strategies

Three delivery modes (configurable globally, overridable per building):

| Strategy | Behavior |
|----------|----------|
| **Passive Polling** | Agent pulls on timer (configurable, default 300s) |
| **Bus-Bridged** | GNAP write also emits `agent:message-available` on bus for instant notification |
| **Priority-Aware** | Message `type` maps to urgency: `alert` = immediate, `directive` = notify, `status/info` = queue |

### Agent Readiness States

| State | Message Handling |
|-------|-----------------|
| `idle` | Process all queued messages in priority order |
| `active` | Only `alert` and `directive` notify; rest queues |
| `busy` | Only `alert` interrupts |
| `blocked` | Queue unless message resolves the block |
| `dnd` | Queue everything except `alert` |

---

## Related Issues

| Issue | Title | Status |
|-------|-------|--------|
| [#271](https://github.com/twitchyvr/Overlord-v2/issues/271) | Async agent email system (original) | Closed |
| [#277](https://github.com/twitchyvr/Overlord-v2/issues/277) | GNAP proposal and design | Closed |
| [#372](https://github.com/twitchyvr/Overlord-v2/issues/372) | GNAP implementation | Closed |
| [#600](https://github.com/twitchyvr/Overlord-v2/issues/600) | GNAP adapter implementation | Closed |
| [#647](https://github.com/twitchyvr/Overlord-v2/issues/647) | GNAP attribution fulfillment | Open |

---

## Acknowledgments

Thank you to the [Farol Labs](https://github.com/farol-team) team for creating GNAP and for collaborating on its integration into Overlord v2. Special thanks to [@ori-cofounder](https://github.com/ori-cofounder) for proposing the integration and providing architectural guidance on directory structure, dual-mode transport, and per-project isolation.
