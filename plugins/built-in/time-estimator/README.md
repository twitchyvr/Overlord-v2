# Time Estimator

A plugin that predicts when your project will finish by measuring how fast work is getting done and projecting that pace forward.

## What It Does

Every time an agent finishes work in a room (a "room exit"), the plugin records it as one completed unit of work. Over time, these data points build a picture of your team's **velocity** -- how many tasks get done per day.

Using that velocity, the plugin calculates:

- **How much work is left** -- based on total planned rooms minus completed work
- **How many days that will take** -- remaining work divided by velocity
- **Estimated completion date** -- today plus the estimated days remaining

The more data the plugin collects, the more accurate the estimate becomes. Early on, with only a few data points, the estimate will be rough. After a dozen or more completions, it smooths out and becomes reliable.

## How It Works

1. **Data collection** -- Every room exit is recorded with a timestamp. These are the raw data points.
2. **Velocity calculation** -- The plugin looks at the most recent completions (default: last 20) and calculates the average rate of completions per day.
3. **Projection** -- Remaining work (total planned minus completed) is divided by velocity to get estimated days remaining.
4. **Events** -- The estimate is emitted as an event so dashboards and other plugins can display it.

## How to Configure

Write to the `estimate:config` storage key to customize:

| Setting | Default | What It Controls |
|---------|---------|------------------|
| `velocity_window` | `20` | Number of recent completions used for velocity calculation. Larger = smoother, smaller = more responsive |
| `min_data_points` | `3` | Minimum completions needed before an estimate is produced |
| `total_planned_rooms` | `0` | Total rooms expected in the project. If 0, uses the current room count as an approximation |
| `recalc_on_room_exit` | `true` | Recalculate after every room exit |
| `recalc_on_phase_advance` | `true` | Recalculate on phase transitions |
| `max_completions` | `500` | Maximum completion records to store |

The most important setting to tune is `total_planned_rooms`. If you know the project will have 25 rooms total, set this to 25 for the most accurate remaining-time estimate. If left at 0, the plugin uses the current room count, which can shift as the project evolves.

## Events Emitted

| Event | When | Data Included |
|-------|------|---------------|
| `estimate:updated` | A new estimate is calculated | `status`, `velocity`, `completed`, `total_planned`, `remaining`, `days_remaining`, `est_completion`, `timestamp` |

The `status` field will be either `"calculated"` (a valid estimate was produced) or `"insufficient_data"` (not enough completions yet, with a `reason` field explaining why).

## Storage Keys

| Key | Contents |
|-----|----------|
| `estimate:completions` | Array of completion records (timestamp, room_id, room_type) |
| `estimate:snapshot` | The latest estimate calculation |
| `estimate:config` | Your custom configuration (optional) |

## Understanding the Output

When you see an `estimate:updated` event, here is what the fields mean:

- **velocity**: How many tasks are getting done per day (e.g., 2.5 completions/day)
- **completed**: Total tasks finished so far
- **total_planned**: How many tasks the project is expected to have
- **remaining**: Tasks still to be done (total_planned minus completed)
- **days_remaining**: Estimated working days until everything is done
- **est_completion**: The projected finish date

If velocity is low and there is a lot of remaining work, the estimate will show a far-out date. That is a signal to either add resources, reduce scope, or adjust expectations.

## Permissions Required

- **room:read** -- to count total rooms for the remaining-work calculation
- **agent:read** -- to inspect agent state during estimation
- **storage:read** / **storage:write** -- to persist completion records, snapshots, and config
- **bus:emit** -- to fire the `estimate:updated` event
