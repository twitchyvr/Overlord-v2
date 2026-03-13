# Code Complexity Alert

Watches for overly complex code as agents work in code-lab rooms and alerts you when files get too complicated.

## What It Does

Every time a tool runs in a code-lab room (reading a file, writing code, running analysis), this plugin checks the output for signs of complexity. It looks at things like file length, how deeply nested the code is, how many functions are crammed into one file, and whether function signatures have too many parameters.

When complexity exceeds your configured thresholds, you get an alert so you can address it before it becomes technical debt.

## How It Works

1. An agent works in a code-lab room using tools that read or write code
2. The plugin runs heuristic analysis on the tool's output
3. It measures six complexity indicators and checks each against a threshold
4. If one or more thresholds are exceeded, the file is flagged
5. High and critical complexity files trigger alerts
6. All metrics are stored for trend tracking over time

## What It Measures

| Metric | Default Threshold | What It Means |
|---|---|---|
| File line count | 300 lines | Files longer than this are hard to navigate |
| Nesting depth | 4 levels | Deeply nested code is hard to follow |
| Functions per file | 20 | Too many functions suggests a "god object" |
| Parameter count | 5 params | Long parameter lists are hard to use correctly |
| Line length | 120 characters | Very long lines are hard to read |
| Method chaining | 5 chains | Deeply chained calls are hard to debug |

## Complexity Levels

Based on how many thresholds are exceeded:

| Level | Violations | Meaning |
|---|---|---|
| **Low** | 0 | Code is within all thresholds |
| **Moderate** | 1 | One area needs attention |
| **High** | 2-3 | Multiple complexity issues, refactoring recommended |
| **Critical** | 4+ | Severely complex, should be refactored before proceeding |

## Configuration

Override any threshold or setting by writing to storage:

| Storage Key | Default | Description |
|---|---|---|
| `config:thresholds` | (see below) | Table of threshold values to override |
| `config:room_filter` | `"code-lab"` | Which room type to analyze |
| `config:max_metrics` | `500` | Maximum metric records to store |
| `config:alert_cooldown` | `30` | Seconds between repeated alerts for the same file |

### Threshold Overrides

Set `config:thresholds` to a table with any keys you want to override:

```
{
  max_file_lines = 500,
  max_nesting_depth = 6,
  max_params = 8
}
```

Any thresholds you do not include will keep their default values.

## Events Emitted

| Event | When | Data |
|---|---|---|
| `complexity:metric` | Every time a file is analyzed (moderate or above) | `id`, `file`, `level`, `violation_count`, `line_count`, `nesting_depth` |
| `complexity:alert` | A file has high or critical complexity | `file`, `level`, `violation_count`, `issues`, `violations`, `tool` |
| `complexity:summary` | An agent enters a code-lab room | `hot_files`, `total_tracked`, `trigger` |
| `complexity:status` | On plugin load | `tracked_files`, `by_level` |

## Current Limitations

This version analyzes code that passes through tool executions (file reads, writes, and command output). It uses heuristic indicators (indentation depth, pattern matching for function signatures) rather than formal AST parsing.

The heuristics work well for most well-formatted code but may under-count or over-count in unusual formatting styles. A future version with `fs:read` support could use more sophisticated static analysis by reading source files directly.

## Permissions Used

- **room:read** -- Check which room type a tool executed in
- **agent:read** -- Track which agent triggered the analysis
- **storage:read / storage:write** -- Persist complexity metrics, alert timestamps, and configuration
- **bus:emit** -- Send `complexity:metric`, `complexity:alert`, `complexity:summary`, and `complexity:status` events
