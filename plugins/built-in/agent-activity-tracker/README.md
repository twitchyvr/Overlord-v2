# Agent Activity Tracker

**Category:** Agent Enhancement
**Version:** 1.0.0

## What It Does

This plugin keeps a running tally of everything your agents do. Every time an agent enters a room, leaves a room, or uses a tool, the tracker records it. Data is organized by hour, so you can see exactly how busy each agent has been throughout the day.

Periodically, the plugin sends out a summary report showing which agents were most active, how many tools were executed, and overall system activity. This makes it easy to spot bottlenecks, identify overworked agents, or see which parts of the project are getting the most attention.

## How It Works

1. **Room enters** -- counted each time an agent walks into a room.
2. **Room exits** -- counted each time an agent leaves a room.
3. **Tool executions** -- counted each time an agent uses any tool.
4. **Hourly summaries** -- once per hour, the plugin packages up all the counters and emits a summary event.
5. **Real-time updates** -- every individual action also fires its own event, so dashboards can update live.

All data is stored with hourly granularity, so you get a clear picture of when work happened, not just how much.

## Configuration

| Setting | Default | What It Controls |
|---------|---------|-----------------|
| `config:summary_enabled` | `true` | Whether hourly summary events are emitted |
| `config:retention_hours` | `168` (7 days) | How many hours of historical data to keep |

## Events Emitted

| Event | When | Data Included |
|-------|------|---------------|
| `plugin:activity-tracker:action` | Every individual action (enter, exit, tool use) | Action type, agent ID, room ID, tool name, hour |
| `plugin:activity-tracker:summary` | Once per hour (on next action after the hour rolls) | Active agent count, total enters/exits/tool executions, per-agent breakdown |

## Permissions Required

- `room:read` -- to access room details
- `agent:read` -- to list all agents for summary generation
- `storage:read` -- to read activity counters
- `storage:write` -- to update activity counters
- `bus:emit` -- to send action and summary events

## Understanding the Data

The summary event gives you a snapshot like this:

- **activeAgents:** 4 -- four agents did work this hour
- **totalRoomEnters:** 12 -- agents entered rooms 12 times total
- **totalToolExecutions:** 47 -- 47 tools were used across all agents
- **agents:** a list showing each active agent's individual numbers

This is useful for understanding team workload and ensuring work is distributed evenly.
