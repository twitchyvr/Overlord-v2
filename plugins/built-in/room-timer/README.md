# Room Timer

Keeps your project phases on schedule by putting a time limit on how long work can happen inside each room.

## What It Does

Have you ever had a meeting that was supposed to last 30 minutes but dragged on for two hours? This plugin prevents that from happening to your project phases.

When an agent enters a room, a countdown clock starts. As work happens inside that room, the plugin watches the clock. When time is running low, it sends a warning. When time runs out, it sends an expiry alert. This helps teams stay focused and move through phases at a healthy pace.

The timer does not forcefully eject anyone from the room -- it simply raises awareness so the team can decide whether to wrap up or consciously extend.

## How It Works

1. An agent enters a room -- the clock starts (default: 30 minutes).
2. As tools run and work happens, the plugin checks elapsed time.
3. At 80% of the limit (24 minutes by default), a **warning** event is emitted.
4. When the full time limit is reached, an **expired** event is emitted.
5. When the agent exits the room, the timer is cleared.

If an agent re-enters the same room later, a fresh timer starts.

## Configuration

Adjust these settings through plugin storage:

| Setting | Default | What It Controls |
|---------|---------|-----------------|
| `timer_enabled` | `true` | Master switch to turn the timer on or off. |
| `default_minutes` | `30` | Default time limit for any room, in minutes. |
| `warning_percent` | `80` | At what percentage of elapsed time the warning fires. For example, `80` means the warning fires when 80% of the time has been used. |
| `room_overrides` | `{}` | Per-room-type time limits. For example, setting `{ "code-lab": 60 }` gives code-lab rooms a full hour instead of the default. |

### Example: Customizing Time Limits

To give coding rooms 60 minutes and architecture rooms 45 minutes while keeping everything else at 30:

Set `room_overrides` to:
```
{ "code-lab": 60, "architecture": 45 }
```

## Events Emitted

| Event | When | Key Payload Fields |
|-------|------|--------------------|
| `room:timer-warning` | Time is running low (default: 80% elapsed) | `roomId`, `roomName`, `roomType`, `limitMinutes`, `remainingMinutes`, `percentElapsed` |
| `room:timer-expired` | Time limit has been reached | `roomId`, `roomName`, `roomType`, `limitMinutes`, `elapsedMinutes`, `overtimeMinutes` |

## Permissions Used

- **room:read** -- To look up room details and determine the correct time limit.
- **agent:read** -- To identify which agents are active in the room.
- **storage:read / storage:write** -- To persist timer state and read configuration.
- **bus:emit** -- To send warning and expiry events.
