# Progress Dashboard

A plugin that shows you how far along your project is by calculating a completion percentage across all workflow phases.

## What It Does

Overlord projects move through a series of phases -- from Strategy all the way through to Deployment. This plugin looks at which rooms exist in your project, figures out which phase each room belongs to, and calculates an overall completion percentage.

The seven phases and their weights are:

| Phase | Room Type | Weight |
|-------|-----------|--------|
| Strategy | strategist | 10% |
| Discovery | discovery | 15% |
| Architecture | architecture | 15% |
| Execution | code-lab | 25% |
| Testing | testing-lab | 15% |
| Review | review | 10% |
| Deployment | deploy | 10% |

Each phase is marked as:

- **Not started** -- no rooms of that type exist yet
- **In progress** -- rooms exist and work is ongoing
- **Complete** -- rooms exist and later phases have also begun (meaning this phase has been passed)

The overall percentage is a weighted average of all phase completions. Execution is weighted the heaviest because that is where most of the work happens.

## How to Configure

The plugin works automatically with no setup needed. If you want to customize behavior, write to the `progress:config` storage key:

| Setting | Default | What It Controls |
|---------|---------|------------------|
| `recalc_on_phase_advance` | `true` | Recalculate when a phase gate is passed |
| `recalc_on_room_change` | `true` | Recalculate when agents enter or exit rooms |
| `max_history` | `50` | Number of historical snapshots to keep for trend tracking |

## Events Emitted

| Event | When | Data Included |
|-------|------|---------------|
| `progress:updated` | Progress is recalculated | `overall_pct`, `total_rooms`, `total_agents`, `active_agents`, `phases` (array of per-phase details), `timestamp` |

## Storage Keys

| Key | Contents |
|-----|----------|
| `progress:snapshot` | The latest progress calculation |
| `progress:history` | Array of past snapshots (overall_pct + timestamp) for trend tracking |
| `progress:config` | Your custom configuration (optional) |

## Permissions Required

- **room:read** -- to list rooms and determine which phases are active
- **agent:read** -- to count agents and check activity status
- **storage:read** / **storage:write** -- to save snapshots and history
- **bus:emit** -- to fire the `progress:updated` event
