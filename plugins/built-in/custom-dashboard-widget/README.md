# Custom Dashboard Widget

A template plugin that adds a live-updating widget to your Overlord dashboard. It shows how many agents are active, which rooms are in use, and when the data was last refreshed.

This plugin is designed as a starting point. You can customize it to display whatever information matters most to your team.

## What it does

When this plugin loads, a new widget appears on your dashboard. It automatically updates whenever:

- An agent enters or leaves a room
- A project phase advances
- The configured refresh interval elapses

The widget displays:

- **Agent count** broken down by status (active, idle, busy)
- **Active rooms** with their names and types
- **Last refresh time** so you know the data is current

## How to configure

You can change three settings to make the widget your own. Update these values through plugin storage or the plugin settings panel:

| Setting | Default | What it controls |
|---------|---------|-----------------|
| `widget_title` | Dashboard Overview | The heading shown on the widget |
| `widget_type` | stats | The widget layout: `stats` (numbers), `list` (scrollable list), or `chart` (visual graph) |
| `refresh_seconds` | 30 | How often the widget refreshes automatically (in seconds) |

## Events emitted

The frontend listens for these events to render and update the widget:

| Event | When | Payload |
|-------|------|---------|
| `widget:register` | Plugin loads | Widget ID, title, type, refresh interval |
| `widget:update` | Room/agent changes or phase advances | Agent count, agents by status, active room count, room list, last refresh timestamp |
| `widget:deregister` | Plugin unloads | Widget ID |

## Permissions used

- **room:read** — reads the list of active rooms
- **agent:read** — reads agent names, roles, and statuses
- **bus:emit** — sends widget events to the frontend
- **storage:read / storage:write** — saves and loads your widget settings
