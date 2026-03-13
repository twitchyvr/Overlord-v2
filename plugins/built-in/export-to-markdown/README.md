# Export to Markdown

**Category:** Integration

## What It Does

The Export to Markdown plugin takes a snapshot of your entire Overlord project and turns it into a clean, readable markdown document. It captures rooms, agents, tool activity, RAID log data, and exit documents -- everything you need to understand where the project stands right now.

This is especially useful for sharing project status with people who do not use Overlord directly. Hand them a markdown file and they can see exactly what is going on.

## When Exports Are Generated

By default, an export is automatically generated every time a project phase advances (e.g., moving from Discovery to Architecture). You can also configure it to export on every room exit, or trigger exports manually via events.

## What Is Included

Each export contains these sections (all configurable):

| Section | What It Shows |
|---------|---------------|
| **Rooms** | All active rooms with their names, types, and IDs |
| **Agents** | All agents with their roles, statuses, and IDs |
| **Tool Execution Summary** | Aggregated counts of every tool that ran, with status breakdown |
| **RAID Log** | Current counts of Risks, Assumptions, Issues, and Dependencies (reads data from the raid-summary plugin if installed) |
| **Exit Documents** | Records of agents exiting rooms, with their summaries |

## Configuration

Customize by writing settings to storage under `export-to-markdown:config`:

| Setting | Default | What It Controls |
|---------|---------|------------------|
| `enabled` | `true` | Turn the plugin on or off |
| `exportOnPhase` | `true` | Automatically export on phase advance |
| `exportOnExit` | `false` | Automatically export on room exit |
| `includeAgents` | `true` | Include the agents section |
| `includeRooms` | `true` | Include the rooms section |
| `includeRaid` | `true` | Include the RAID log section |
| `includeTools` | `true` | Include the tool execution summary |
| `projectName` | `"Overlord Project"` | Name shown in the document header |
| `maxExports` | `50` | Maximum number of exports kept in history |

## Events Emitted

| Event | When | Payload |
|-------|------|---------|
| `export:ready` | Each time a markdown export is generated | `{ markdown, trigger, timestamp, phase }` |

## Storage Keys Used

| Key | Purpose |
|-----|---------|
| `export-to-markdown:config` | Plugin configuration |
| `export-to-markdown:tool-log` | Running log of tool executions (up to 500) |
| `export-to-markdown:exit-docs` | Collected exit documents (up to 200) |
| `export-to-markdown:history` | Archive of generated exports (up to maxExports) |

## Works Well With

- **raid-summary** -- If the RAID Summary plugin is installed, this plugin reads its data to include RAID counts in exports. Without it, the RAID section will show a note suggesting you install it.

## Permissions Required

- `room:read` -- Read room data for the rooms section
- `agent:read` -- Read agent data for the agents section
- `storage:read` / `storage:write` -- Store tool logs, exit docs, exports, and config
- `bus:emit` -- Emit export:ready events
- `tool:execute` -- Monitor tool executions for the summary section
