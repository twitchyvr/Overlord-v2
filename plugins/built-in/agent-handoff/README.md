# Agent Handoff

**Category:** Agent Enhancement
**Version:** 1.0.0

## What It Does

When one agent finishes work in a room and another agent picks up where they left off, important context can get lost. This plugin solves that problem by automatically capturing a "handoff summary" whenever an agent exits a room, and delivering it to the next agent who enters.

Think of it like a shift change at a hospital: the outgoing nurse writes notes about each patient so the incoming nurse knows exactly what is going on. No one has to start from scratch or guess what happened before they arrived.

## How It Works

**When an agent leaves a room (capture phase):**
1. The plugin records who the agent was, what room they were in, and what type of room it was.
2. It tracks which tools the agent used during their time in the room.
3. It notes which room the agent came from before this one (the "chain").
4. All of this is saved to storage as the latest handoff for that room.

**When a new agent enters a room (delivery phase):**
1. The plugin checks if a handoff summary exists from a previous agent.
2. If it does (and it is from a different agent), the context is delivered via the event bus.
3. The entering agent and the UI receive details about who worked here before, when, and what they did.
4. If no previous handoff exists, a "no context" event is emitted so the agent knows they are starting fresh.

## Configuration

| Setting | Default | What It Controls |
|---------|---------|-----------------|
| `config:max_history` | `10` | Maximum number of historical handoff entries kept per room |
| `config:auto_deliver` | `true` | Automatically deliver context when an agent enters a room |
| `config:include_tool_history` | `true` | Track which tools were used as part of the handoff context |

## Events Emitted

| Event | When | Data Included |
|-------|------|---------------|
| `plugin:handoff:captured` | An agent exits a room and context is saved | Room ID/name, agent ID/name, timestamp |
| `plugin:handoff:delivered` | An agent enters a room and receives previous context | Room ID, entering agent, previous agent name/role, room type, capture timestamp, recent history |
| `plugin:handoff:no-context` | An agent enters a room with no previous handoff | Room ID, agent ID, message |

## Permissions Required

- `room:read` -- to look up room details
- `agent:read` -- to get agent names and roles
- `storage:read` -- to retrieve handoff summaries and configuration
- `storage:write` -- to store handoff summaries and tool history
- `bus:emit` -- to deliver handoff events

## Room Chain Tracking

The plugin also tracks the sequence of rooms each agent moves through. If Agent A goes from the Discovery room to the Architecture room to the Code Lab, the handoff notes include that chain. This helps the next agent understand the workflow path, not just the last room.

## Example Scenario

1. Agent "Strategist" finishes work in the `discovery` room and exits.
2. The plugin captures a handoff: "Strategist worked in discovery, used read_file and search tools, came from the strategy room."
3. Agent "Architect" enters the `discovery` room.
4. The plugin delivers the handoff: "Strategist (strategy role) last worked here at 2:30 PM. They came from the strategy room."
5. The Architect now has context about what was already explored and can build on it instead of repeating work.
