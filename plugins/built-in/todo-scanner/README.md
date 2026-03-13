# TODO Scanner

Automatically finds and tracks code annotations like TODO, FIXME, and HACK in your project as agents work in code-lab rooms.

## What It Does

When agents use tools in a code-lab room (reading files, writing code, searching), this plugin scans the output for common annotation patterns. Every time it spots a TODO, FIXME, HACK, XXX, or NOTE comment, it records it and alerts you.

Think of it as a running checklist of things your team still needs to address -- built automatically as work happens.

## How It Works

1. An agent enters a code-lab room and starts working
2. Every time a tool runs (read a file, write code, search), the plugin checks the output
3. If it finds annotations like `TODO: fix this later`, it saves them to a list
4. A `todo:found` event fires for each new item (other plugins or the dashboard can react)
5. A `todo:summary` event fires with updated totals

## Configuration

You can customize the plugin by setting values in storage before or after loading. If you do not change these, sensible defaults are used.

| Storage Key | Default | Description |
|---|---|---|
| `config:patterns` | `["TODO", "FIXME", "HACK", "XXX", "NOTE"]` | Which annotation patterns to look for |
| `config:max_items` | `500` | Maximum number of items to keep (oldest are pruned) |
| `config:room_filter` | `"code-lab"` | Which room type to scan in |

## Events Emitted

| Event | When | Data |
|---|---|---|
| `todo:found` | A new annotation is discovered | `id`, `pattern`, `line`, `text`, `tool`, `room_id` |
| `todo:summary` | After scanning or on room entry | `total_items`, `new_items`, `patterns` |

## Current Limitations

This version scans tool execution results (file reads, code output, search results). It does not proactively scan the full filesystem because the `fs:read` permission is not yet available in the plugin sandbox. Once that permission is implemented, a future version will be able to scan entire project directories on demand.

## Permissions Used

- **room:read** -- Check which room type a tool executed in
- **storage:read / storage:write** -- Persist the list of found items and configuration
- **bus:emit** -- Send `todo:found` and `todo:summary` events
