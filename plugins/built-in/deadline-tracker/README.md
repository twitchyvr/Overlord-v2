# Deadline Tracker

A plugin that keeps an eye on your project milestones and deadlines, alerting you when something is coming up soon or has already been missed.

## What It Does

You tell the plugin about your deadlines -- things like "Architecture review by March 27" or "MVP feature-complete by April 15" -- and it watches the calendar for you. Whenever the plugin runs a check (on startup, on phase transitions, or after room exits), it looks at every deadline and categorizes it:

- **On track** -- the deadline is still comfortably in the future
- **Warning** -- the deadline is within the warning window (default: 3 days away)
- **Missed** -- the deadline date has passed and the item is not marked complete

For warnings and missed deadlines, the plugin fires events so dashboards and notification systems can alert the team.

## How to Set Up Deadlines

Deadlines are stored as an array at the `deadlines:list` storage key. Each deadline looks like this:

```
{
    id: "unique-id",
    title: "What this milestone is about",
    due_date: "2026-04-15",
    phase: "Execution",
    status: "pending"
}
```

- **id** -- a unique identifier for this deadline
- **title** -- a human-readable name
- **due_date** -- the target date in YYYY-MM-DD format
- **phase** -- (optional) which project phase this belongs to
- **status** -- either "pending" or "complete"

When you first install the plugin, it seeds a few example deadlines so you can see the format. Set `seed_examples` to `false` in the config to disable this.

To mark a deadline as done, update its `status` field to `"complete"` in the storage.

## How to Configure

Write to the `deadlines:config` storage key to customize behavior:

| Setting | Default | What It Controls |
|---------|---------|------------------|
| `warning_days` | `3` | How many days before a deadline to start firing warnings |
| `check_on_load` | `true` | Whether to check deadlines when the plugin first loads |
| `check_on_phase_advance` | `true` | Whether to check deadlines on phase transitions |
| `seed_examples` | `true` | Whether to create example deadlines if none exist |

## Events Emitted

| Event | When | Data Included |
|-------|------|---------------|
| `deadline:warning` | A deadline is within the warning window | `id`, `title`, `due_date`, `days_left` |
| `deadline:missed` | A deadline has passed without being completed | `id`, `title`, `due_date`, `days_late` |
| `deadline:check` | A full check cycle completes | `total`, `warning_count`, `missed_count`, `ok_count`, `checked_at` |

## Storage Keys

| Key | Contents |
|-----|----------|
| `deadlines:list` | Array of deadline objects |
| `deadlines:config` | Your custom configuration (optional) |
| `deadlines:last_check` | Results of the most recent check (warnings, missed, on-track counts) |

## Permissions Required

- **room:read** -- to correlate room activity with deadline phases
- **agent:read** -- to check agent activity during deadline evaluation
- **storage:read** / **storage:write** -- to store and retrieve deadlines and check results
- **bus:emit** -- to fire warning, missed, and check events
