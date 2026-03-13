# RAID Summary

**Category:** Communication

## What It Does

The RAID Summary plugin keeps track of the four categories in Overlord's RAID log -- Risks, Assumptions, Issues, and Dependencies -- and periodically generates a summary report with trend analysis. Instead of scrolling through hundreds of individual log entries, you get a clear picture: "Risks are growing, Issues are declining, Dependencies are stable."

RAID stands for:
- **R**isks -- things that might go wrong
- **A**ssumptions -- things we believe to be true but have not confirmed
- **I**ssues -- things that are currently wrong
- **D**ependencies -- things we need from somewhere else

## How It Works

1. Every time a RAID-related tool runs (creating or updating a risk, issue, etc.), the plugin increments a counter for that category.
2. At regular intervals (or whenever a project phase advances), the plugin compiles a summary.
3. The summary includes counts for each category plus a trend direction by comparing the current period to previous periods.
4. The summary is emitted as an event and saved to history.

## Trend Analysis

The plugin compares your current period's counts to the average of recent past periods:

| Trend | Meaning |
|-------|---------|
| Growing | This period's count is more than 20% above the recent average |
| Stable | Roughly in line with the recent average |
| Declining | This period's count is more than 20% below the recent average |

Categories with a "growing" trend are highlighted as areas of concern.

## Configuration

Customize by writing settings to storage under `raid-summary:config`:

| Setting | Default | What It Controls |
|---------|---------|------------------|
| `enabled` | `true` | Turn the plugin on or off |
| `summaryInterval` | `6` | Hours between automatic summaries |
| `trendWindowPeriods` | `3` | How many past periods to compare against for trends |
| `raidToolPatterns` | `["raid", "risk", "assumption", "issue", "dependency", "log_raid"]` | Tool name patterns that indicate RAID activity |

## Events Emitted

| Event | When | Payload |
|-------|------|---------|
| `raid:summary` | Each time a summary is generated | `{ summary, counts, trends, concerns, timestamp }` |

## Storage Keys Used

| Key | Purpose |
|-----|---------|
| `raid-summary:config` | Plugin configuration |
| `raid-summary:current-counts` | Running counts for the current period |
| `raid-summary:period-history` | Archive of past period counts (for trend calculation) |
| `raid-summary:summary-history` | Archive of generated summaries (up to 30) |
| `raid-summary:last-summary-time` | Timestamp of the last generated summary |

## Permissions Required

- `room:read` -- Read room information
- `agent:read` -- Read agent details
- `storage:read` / `storage:write` -- Store counts, history, and config
- `bus:emit` -- Emit raid:summary events
- `tool:execute` -- Monitor tool executions for RAID activity
