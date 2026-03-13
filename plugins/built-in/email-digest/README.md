# Email Digest

**Category:** Communication

## What It Does

The Email Digest plugin watches everything that happens inside Overlord and keeps a running count of all communication-related activity between agents. At a regular interval (once per day by default), it compiles a summary of who sent what, how many messages were exchanged, and which tools were involved -- then makes that summary available to the rest of the system.

Think of it like a daily email newsletter, but for your AI agents: "Here is what everyone talked about today."

## How It Works

1. Every time a tool runs, the plugin checks if it looks communication-related (email, message, chat, etc.).
2. If it matches, the plugin records which agent triggered it and updates a running tally.
3. When the configured time interval passes, the plugin compiles everything into a formatted digest and emits it as an event.
4. The digest is also saved to history so you can review past summaries.

## Configuration

You can customize the plugin by writing settings to storage under the key `email-digest:config`. Available options:

| Setting | Default | What It Controls |
|---------|---------|------------------|
| `digestIntervalHours` | `24` | How often (in hours) a new digest is compiled |
| `trackPatterns` | `["email", "message", "notify", "send", "chat", "communicate"]` | Which tool names to track (substring match) |
| `enabled` | `true` | Turn the plugin on or off |

## Events Emitted

| Event | When | Payload |
|-------|------|---------|
| `digest:ready` | Each time a digest is compiled | `{ summary, counts, timestamp }` |

## Storage Keys Used

| Key | Purpose |
|-----|---------|
| `email-digest:config` | Plugin configuration |
| `email-digest:counts` | Running message counts for current interval |
| `email-digest:history` | Archive of past digest summaries (up to 30) |
| `email-digest:last-digest-time` | Timestamp of the last compiled digest |

## Permissions Required

- `room:read` -- Read room information
- `agent:read` -- Read agent information
- `storage:read` / `storage:write` -- Store and retrieve counts and config
- `bus:emit` -- Emit the digest:ready event
- `tool:execute` -- Monitor tool executions
