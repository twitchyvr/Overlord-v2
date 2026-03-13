# Changelog Generator

Automatically builds a running record of what changed during your project session, organized by development phase.

## What It Does

As your agents work -- writing code, fixing bugs, advancing through phases -- this plugin watches what happens and creates structured changelog entries. You get a timestamped, categorized history without having to write it yourself.

Entries are grouped by phase (Discovery, Architecture, Code, Testing, etc.) and categorized using the standard "Keep a Changelog" format: Added, Fixed, Changed, Removed, Security, and Documentation.

## How It Works

1. When a tool runs that modifies something (writes a file, creates a resource, runs a fix), the plugin creates a changelog entry
2. It automatically guesses the right category based on what tool was used and which room it ran in
3. When a phase advances (e.g., from Architecture to Code), a section header is created
4. Read-only operations (searching, listing, reading files) are skipped to keep the log meaningful
5. Everything is stored chronologically and available for export

## Category Logic

The plugin infers categories automatically:

| Action | Category |
|---|---|
| Writing or creating files | Added |
| Deleting or removing files | Removed |
| Running tools in testing-lab or war-room | Fixed |
| Refactoring, renaming, or updating | Changed |
| Documentation-related tools | Documentation |
| Security audits or reviews | Security |
| Phase gate advances | Phase |

## Configuration

Customize behavior by setting these storage keys:

| Storage Key | Default | Description |
|---|---|---|
| `config:max_entries` | `1000` | Maximum changelog entries to keep |
| `config:auto_categorize` | `true` | Automatically categorize entries by tool and room |
| `config:include_tool_detail` | `true` | Include the tool name in entry descriptions |

## Events Emitted

| Event | When | Data |
|---|---|---|
| `changelog:entry` | A new changelog entry is created | `id`, `phase`, `category`, `description`, `markdown`, `tool` |
| `changelog:phase` | A development phase advances | `old_phase`, `new_phase`, `verdict`, `total_entries` |
| `changelog:status` | On plugin load | `total_entries`, `current_phase` |

## Example Output

The entries produced look like standard changelog markdown:

```
## Code Phase
- **Added**: File: src/utils/parser.ts
- **Added**: Executed write_file (agent: code-agent-1)
- **Fixed**: Test failure in auth module

## Testing Phase
- **Fixed**: Edge case in input validation
- **Changed**: Updated test fixtures
```

## Permissions Used

- **room:read** -- Determine which room type a tool executed in
- **agent:read** -- Include agent identity in changelog entries
- **storage:read / storage:write** -- Persist changelog entries and configuration
- **bus:emit** -- Send `changelog:entry`, `changelog:phase`, and `changelog:status` events
