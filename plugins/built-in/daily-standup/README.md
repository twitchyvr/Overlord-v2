# Daily Standup

A plugin that creates a daily standup summary report for your project, just like the quick status meetings many teams hold each morning.

## What It Does

Every day (or whenever you trigger it), this plugin looks at all the rooms and agents in your Overlord project and builds a simple three-part report:

1. **Completed** -- What work has been finished. This comes from execution rooms (Code Lab, Testing Lab, Deploy) and from room exits recorded throughout the day.
2. **Planned** -- What work is coming up next. This comes from planning rooms (Strategist, Discovery, Architecture) that have active agents.
3. **Blockers** -- Anything that is stuck. If an agent has a "blocked" status, it shows up here so you know what needs attention.

The report is saved to plugin storage so you can retrieve it later, and an event is fired so dashboards and other plugins can react to it.

## How to Configure

The plugin works out of the box with sensible defaults. If you want to customize it, write a configuration object to the `standup:config` storage key:

| Setting | Default | What It Controls |
|---------|---------|------------------|
| `auto_generate` | `true` | Whether a report is created automatically when the plugin loads |
| `max_items_per_section` | `20` | Maximum number of items shown in each section of the report |
| `execution_room_types` | code-lab, testing-lab, deploy | Which room types count as "completed work" |
| `planning_room_types` | strategist, discovery, architecture | Which room types count as "planned work" |

## Events Emitted

| Event | When | Data Included |
|-------|------|---------------|
| `standup:generated` | A new standup report is created | `date`, `report` (formatted text), `completed_count`, `planned_count`, `blocker_count` |

## Storage Keys

| Key | Contents |
|-----|----------|
| `standup:last_report` | The most recent standup report (date, text, and raw data) |
| `standup:completed:<date>` | Array of completed items for that day |
| `standup:planned:<date>` | Array of planned items for that day |
| `standup:blockers:<date>` | Array of blockers for that day |
| `standup:config` | Your custom configuration (optional) |

## Permissions Required

- **room:read** -- to list rooms and their types
- **agent:read** -- to list agents and check their status
- **storage:read** / **storage:write** -- to save and retrieve report data
- **bus:emit** -- to fire the `standup:generated` event
