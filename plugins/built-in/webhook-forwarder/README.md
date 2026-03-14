# Webhook Forwarder

**Category:** Integration

## What It Does

The Webhook Forwarder captures events from across the Overlord system -- room entries, tool executions, phase changes -- and packages them into standard webhook payloads. These payloads can be sent to external services like Slack, Discord, Zapier, or any system that accepts webhook calls.

Think of it as a bridge: everything interesting that happens inside Overlord gets packaged up and sent out to whatever tools you already use.

## Current Status

This plugin currently operates in **queue-only mode**. It collects events, builds payloads, queues them, and emits `webhook:queued` events -- but cannot yet deliver them over HTTP because the `net:http` permission is not yet implemented in the Overlord runtime. Once `net:http` becomes available, the plugin will automatically start delivering queued payloads to your configured endpoints.

In the meantime, other plugins can listen for `webhook:queued` events and handle delivery themselves.

## How It Works

1. The plugin registers listeners on every Overlord lifecycle hook.
2. When an event fires, it checks your filter settings to see if you want that type of event forwarded.
3. If the event passes the filter, a webhook payload is built with event details, timestamps, and optional context (room/agent counts).
4. The payload is added to a persistent queue and a `webhook:queued` event is emitted.
5. When HTTP delivery becomes available, queued payloads will be POSTed to all configured endpoints.

## Configuration

Customize by writing settings to storage under `webhook-forwarder:config`:

| Setting | Default | What It Controls |
|---------|---------|------------------|
| `enabled` | `true` | Turn the plugin on or off |
| `endpoints` | `[]` | Array of webhook targets, each with `url` and optional `headers` |
| `filters.onRoomEnter` | `true` | Forward room entry events |
| `filters.onRoomExit` | `true` | Forward room exit events |
| `filters.onToolExecute` | `true` | Forward tool execution events |
| `filters.onPhaseAdvance` | `true` | Forward phase advance events |
| `filters.onLoad` | `false` | Forward plugin load events (usually too noisy) |
| `filters.onUnload` | `false` | Forward plugin unload events |
| `maxQueueSize` | `500` | Maximum payloads stored in queue before oldest are dropped |
| `includeContext` | `true` | Include room/agent counts in each payload |

### Example Endpoint Configuration

```
endpoints = {
  {
    url = "https://hooks.slack.com/services/T.../B.../xxx",
    headers = { ["Content-Type"] = "application/json" }
  },
  {
    url = "https://your-server.com/api/webhooks/overlord",
    headers = { ["Authorization"] = "Bearer your-token" }
  }
}
```

## Events Emitted

| Event | When | Payload |
|-------|------|---------|
| `webhook:queued` | Each time a payload is added to the queue | `{ event, timestamp, queueSize }` |

## Webhook Payload Format

Each queued payload has this structure:

| Field | Description |
|-------|-------------|
| `event` | The hook name (e.g., "onRoomEnter", "onPhaseAdvance") |
| `source` | Always "overlord" |
| `plugin` | Always "webhook-forwarder" |
| `version` | Plugin version |
| `timestamp` | Unix timestamp of when the event occurred |
| `data` | Event-specific details (room ID, agent ID, tool name, etc.) |
| `overlord` | Overlord instance info (id, name, version) if available |
| `context` | Room and agent counts (if includeContext is true) |

## Storage Keys Used

| Key | Purpose |
|-----|---------|
| `webhook-forwarder:config` | Plugin configuration |
| `webhook-forwarder:queue` | Persistent payload queue (up to maxQueueSize) |
| `webhook-forwarder:stats` | Delivery statistics (queued, delivered, failed counts) |

## Permissions Required

- `room:read` -- Read room info for context enrichment
- `agent:read` -- Read agent info for context enrichment
- `storage:read` / `storage:write` -- Persist queue, stats, and config
- `bus:emit` -- Emit webhook:queued events
- `tool:execute` -- Monitor tool execution events
- `net:http` -- Declared but not yet available; needed for HTTP delivery
