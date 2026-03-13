# GitHub Sync

**Category:** Integration

## What It Does

The GitHub Sync plugin bridges Overlord and GitHub by preparing structured data packages from your Overlord project state -- rooms, agents, phases, and tool results -- and making them available for synchronization with a GitHub repository. It tracks milestones, task completions, and phase transitions so that your GitHub Issues and Milestones can stay in sync with what is happening inside Overlord.

## Current Status

This plugin currently operates in **queue-only mode**. It collects state, builds payloads, and emits events -- but does not yet push data directly to GitHub because the `net:http` permission is not yet implemented in the Overlord runtime. Once `net:http` becomes available, the plugin will automatically begin pushing queued payloads to the GitHub API.

In the meantime, other plugins or external tools can listen for the `github:sync-ready` event and handle the actual HTTP calls.

## How It Works

1. When a phase advances, an agent exits a room, or a significant tool runs, the plugin gathers a snapshot of the current Overlord state.
2. It checks whether this snapshot is a duplicate of something already queued (to avoid sending the same data twice).
3. If it is new, the plugin adds it to an internal queue and emits a `github:sync-ready` event.
4. The queue is persisted to storage so nothing is lost between sessions.

## Configuration

Customize by writing settings to storage under `github-sync:config`:

| Setting | Default | What It Controls |
|---------|---------|------------------|
| `enabled` | `true` | Turn the plugin on or off |
| `repoOwner` | `""` | GitHub owner (organization or user name) |
| `repoName` | `""` | GitHub repository name |
| `syncOnPhase` | `true` | Automatically sync when a project phase advances |
| `syncOnExit` | `true` | Automatically sync when an agent exits a room |
| `labelPrefix` | `"overlord:"` | Prefix added to auto-created GitHub labels |

## Events Emitted

| Event | When | Payload |
|-------|------|---------|
| `github:sync-ready` | Each time a new sync payload is queued | `{ type, repoOwner, repoName, rooms, agents, timestamp, extra }` |

## Storage Keys Used

| Key | Purpose |
|-----|---------|
| `github-sync:config` | Plugin configuration |
| `github-sync:queue` | Queue of payloads awaiting sync (up to 200) |
| `github-sync:hashes` | Deduplication hashes for recent payloads |

## Permissions Required

- `room:read` -- Gather room state for sync payloads
- `agent:read` -- Gather agent state for sync payloads
- `storage:read` / `storage:write` -- Persist queue, hashes, and config
- `bus:emit` -- Emit github:sync-ready events
- `net:http` -- Declared but not yet available; needed for direct GitHub API calls
