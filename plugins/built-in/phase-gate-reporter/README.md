# Phase Gate Reporter

Creates a detailed record every time your project moves from one phase to the next, building a complete history of all phase transitions.

## What It Does

In Overlord, phases are the major milestones of your project workflow -- Discovery, Architecture, Coding, Testing, Review, Deploy. Moving from one phase to the next is a significant decision. This plugin makes sure that decision is documented.

Every time a phase advances, this plugin captures:

- **What phase you came from** and **what phase you moved to**
- **The verdict** (GO or NO-GO)
- **The evidence** that supported the decision (links, documents, test results)
- **Who was involved** (which agents were in the room at the time)
- **When it happened** (precise timestamp)

All of this is saved as a searchable history. You can look back weeks later and answer questions like "Why did we skip from Architecture straight to Testing?" or "Who approved the move to Deploy?"

Think of it as a flight recorder for your project's decision points.

## How It Works

1. A phase transition happens (triggered manually or by the Auto Phase Advance plugin).
2. This plugin captures all the context around that transition.
3. A formatted report is generated and stored in plugin storage.
4. The report is also emitted as a `phasegate:report` event for the UI or other plugins to use.

Reports accumulate over time, up to a configurable maximum (default: 100). When the limit is reached, the oldest reports are pruned to make room for new ones.

## Configuration

Adjust these settings through plugin storage:

| Setting | Default | What It Controls |
|---------|---------|-----------------|
| `reporter_enabled` | `true` | Master switch to turn reporting on or off. |
| `max_stored_reports` | `100` | Maximum number of reports to keep in storage. Oldest are removed first when this limit is exceeded. |
| `include_agent_list` | `true` | Whether to include a list of all agents present in the room at the time of the transition. |

## What a Report Looks Like

Each report contains these fields:

| Field | Description |
|-------|-------------|
| `id` | Unique report identifier (e.g., `pgr-1710345600-a3f1`) |
| `timestamp` | When the transition occurred |
| `roomName` | The room where the transition happened |
| `roomType` | The type of room (e.g., architecture, code-lab) |
| `fromPhase` | The phase being left |
| `toPhase` | The phase being entered |
| `verdict` | GO or NO-GO |
| `evidence` | Array of evidence items presented for the decision |
| `participants` | List of agents who were in the room, with names and roles |
| `formattedText` | A human-readable text version of the full report |

## Events Emitted

| Event | When | Key Payload Fields |
|-------|------|--------------------|
| `phasegate:report` | A phase transition is recorded | `reportId`, `roomId`, `roomName`, `fromPhase`, `toPhase`, `verdict`, `evidence`, `participants`, `formattedText` |

## Permissions Used

- **room:read** -- To look up room details for the report.
- **agent:read** -- To list participants who were in the room during the transition.
- **storage:read / storage:write** -- To persist reports and read configuration.
- **bus:emit** -- To broadcast the report event.
