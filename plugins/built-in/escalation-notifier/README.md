# Escalation Notifier

**Category:** Communication

## What It Does

The Escalation Notifier watches for signs of trouble across the entire Overlord system and raises alerts when something looks wrong. It detects patterns like agents rushing into the war-room, tools failing, or a cascade of errors happening all at once. When it spots a problem, it emits an event that other parts of the system can respond to -- for example, showing a warning in the dashboard or triggering a notification.

## Escalation Patterns Detected

| Pattern | Severity | What Triggers It |
|---------|----------|------------------|
| War-room entry | High | An agent enters a room of type "war-room" |
| Tool failure | Medium | A tool execution returns an error or failed status |
| Blocked tool | Medium | A tool execution is blocked or denied |
| Rapid room hopping | Low | An agent switches rooms many times in a short window |
| Error cascade | Critical | Multiple tool failures happen within a short time window |

## How It Works

1. The plugin listens to room entry, room exit, and tool execution events.
2. When an event matches one of the escalation patterns, it determines the severity.
3. It emits an `escalation:detected` event with severity, reason, and context.
4. All escalations are saved to history so you can review them later.

## Configuration

Customize the plugin by writing settings to storage under `escalation-notifier:config`:

| Setting | Default | What It Controls |
|---------|---------|------------------|
| `enabled` | `true` | Turn the plugin on or off |
| `warRoomTypes` | `["war-room"]` | Room type names that trigger a war-room escalation |
| `errorThresholdCritical` | `5` | How many errors within the window trigger a "critical" cascade |
| `errorWindowSeconds` | `300` | Sliding window (in seconds) for counting errors |
| `roomHopThreshold` | `5` | How many room changes within the window flag rapid hopping |
| `roomHopWindowSeconds` | `120` | Sliding window (in seconds) for counting room transitions |

## Events Emitted

| Event | When | Payload |
|-------|------|---------|
| `escalation:detected` | Each time an escalation pattern is matched | `{ severity, reason, context, timestamp }` |

## Storage Keys Used

| Key | Purpose |
|-----|---------|
| `escalation-notifier:config` | Plugin configuration |
| `escalation-notifier:recent-errors` | Sliding window of recent tool errors |
| `escalation-notifier:recent-transitions` | Sliding window of recent room transitions |
| `escalation-notifier:history` | Archive of past escalation events (up to 100) |

## Permissions Required

- `room:read` -- Read room information for war-room detection
- `agent:read` -- Read agent details for context
- `storage:read` / `storage:write` -- Store sliding windows and history
- `bus:emit` -- Emit escalation:detected events
- `tool:execute` -- Monitor tool execution results
