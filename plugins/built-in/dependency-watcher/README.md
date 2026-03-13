# Dependency Watcher

Keeps an eye on your project's dependencies and alerts you when problems are found -- outdated packages, security vulnerabilities, missing dependencies, or version conflicts.

## What It Does

As your agents work, they often run tools that interact with package managers (npm, pip, cargo, etc.). This plugin watches the output from those tools and automatically detects dependency problems. When it spots something, it records the issue and sends an alert.

You get a continuously updated health dashboard of your project's dependencies without having to remember to run audits manually.

## How It Works

1. An agent runs a tool (like `npm install`, `npm audit`, or any tool that produces package-related output)
2. The plugin scans the output for known problem patterns (warnings, vulnerabilities, conflicts)
3. Detected issues are classified by type and severity
4. Issues are stored in a running list and alerts are emitted
5. When a phase advances, a dependency health report is sent so the team knows the current status

## What It Detects

| Issue Type | Examples |
|---|---|
| Outdated | Packages with newer versions available |
| Vulnerability | Known security vulnerabilities (CVEs, advisories) |
| Missing | Required packages that are not installed |
| Conflict | Version conflicts between packages |
| Deprecated | Packages that are no longer maintained |
| License | License compatibility issues |

## Severity Levels

Issues are ranked from lowest to highest severity:

1. **Info** -- Informational, no action needed
2. **Low** -- Minor issue, fix when convenient
3. **Moderate** -- Should be addressed soon
4. **High** -- Important issue, prioritize a fix
5. **Critical** -- Immediate attention required (triggers a special alert)

## Configuration

| Storage Key | Default | Description |
|---|---|---|
| `config:max_issues` | `200` | Maximum issues to track (oldest are pruned) |
| `config:severity_threshold` | `"low"` | Minimum severity level to track (ignores anything below) |
| `config:alert_on_critical` | `true` | Send special alerts for critical-severity issues |

## Events Emitted

| Event | When | Data |
|---|---|---|
| `dependency:issue` | A new dependency issue is detected | `id`, `type`, `severity`, `context`, `source_tool` |
| `dependency:alert` | A critical issue is found (or persists from a previous session) | `severity`, `message`, `count` or `source_tool` |
| `dependency:status` | After scanning or on plugin load | `total_issues`, `by_type`, `by_severity`, `new_issues` |
| `dependency:phase-report` | A development phase advances | `phase`, `total_issues`, `by_type`, `by_severity` |

## Current Limitations

This version detects dependency issues by scanning tool output as it flows through the system. It cannot:

- **Proactively scan package files** (package.json, Cargo.toml, requirements.txt) because the `fs:read` permission is not yet available in the plugin sandbox.
- **Check remote registries** (npm, PyPI, crates.io) for latest versions because the `net:http` permission is not yet available.

Once these permissions are implemented, a future version will be able to scan project files on room entry and query registries for the latest package information.

## Permissions Used

- **room:read** -- Identify which room a tool executed in
- **storage:read / storage:write** -- Persist dependency issues, summary counters, and configuration
- **bus:emit** -- Send `dependency:issue`, `dependency:alert`, `dependency:status`, and `dependency:phase-report` events
