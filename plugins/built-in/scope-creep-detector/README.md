# Scope Creep Detector

A plugin that watches for your project quietly growing beyond its original plan, so you can catch scope creep before it becomes a problem.

## What It Does

When a project kicks off, there is usually a plan: a certain number of tasks, phases, and rooms that represent the work to be done. As the project progresses, new rooms sometimes get added -- a new feature here, an extra review cycle there. That is scope creep, and it is one of the biggest reasons projects miss their deadlines.

This plugin captures a **baseline** (the room count when it first runs) and then monitors the current room count over time. If the count grows beyond a configurable threshold, it fires an alert so the team can decide whether the new work is justified or whether the project is drifting off track.

## How It Works

1. **Baseline capture** -- The first time the plugin loads, it counts all existing rooms and saves that number as the baseline. You can also set the baseline manually by writing to the `scope:baseline` storage key.

2. **Ongoing monitoring** -- Every time a room is entered, a room is exited, or a phase advances, the plugin recounts the rooms and compares against the baseline.

3. **Alerting** -- If the room count has grown by more than the threshold (default: 20% AND at least 3 rooms), a `scope:alert` event is fired with details about what changed.

The dual threshold (percentage AND absolute) prevents false alarms on small projects. A project with 3 rooms adding 1 room is a 33% increase, but probably not scope creep -- the absolute threshold catches that.

## How to Configure

Write to the `scope:config` storage key to customize:

| Setting | Default | What It Controls |
|---------|---------|------------------|
| `alert_threshold_pct` | `20` | Percentage growth above baseline that triggers an alert |
| `alert_threshold_abs` | `3` | Minimum absolute room increase above baseline before alerting |
| `auto_baseline` | `true` | Whether to automatically capture baseline on first load |
| `check_on_room_change` | `true` | Whether to re-check when rooms are entered or exited |
| `max_history` | `100` | Maximum number of historical snapshots to keep |

To reset the baseline (for example, after a deliberate scope expansion that the team approved), write a new baseline object to `scope:baseline`:

```
{
    count: 15,
    created_at: "2026-03-15 10:00:00"
}
```

## Events Emitted

| Event | When | Data Included |
|-------|------|---------------|
| `scope:alert` | Room count exceeds both threshold percentages | `baseline`, `current`, `growth`, `growth_pct`, `type_changes`, `message`, `timestamp` |
| `scope:check` | Every check cycle completes (even if no alert) | `current`, `baseline`, `growth`, `growth_pct`, `alert` (boolean), `timestamp` |
| `scope:baseline` | A new baseline is established | `count`, `created_at` |

## Storage Keys

| Key | Contents |
|-----|----------|
| `scope:baseline` | The original planned room count and capture date |
| `scope:history` | Array of snapshots tracking room count over time |
| `scope:config` | Your custom configuration (optional) |

## Permissions Required

- **room:read** -- to count rooms and categorize by type
- **agent:read** -- to inspect agent activity during checks
- **storage:read** / **storage:write** -- to persist baseline, history, and config
- **bus:emit** -- to fire alert, check, and baseline events
