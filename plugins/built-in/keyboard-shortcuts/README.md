# Keyboard Shortcuts

Navigate Overlord faster with keyboard shortcuts. This plugin adds default shortcuts for common actions and lets you customize them to fit your workflow.

## What it does

When this plugin loads, it registers a set of keyboard shortcuts with the Overlord interface. Press a key combination and the corresponding action fires instantly, no mouse needed.

## Default shortcuts

### Navigation

| Shortcut | Action |
|----------|--------|
| Ctrl+Shift+D | Go to Dashboard |
| Ctrl+Shift+R | Go to Rooms |
| Ctrl+Shift+A | Go to Agents |
| Ctrl+Shift+T | Go to Tasks |
| Ctrl+Shift+L | Go to Activity Log |
| Ctrl+Shift+S | Go to Settings |

### Quick-switch rooms

| Shortcut | Action |
|----------|--------|
| Alt+1 | Switch to Room 1 |
| Alt+2 | Switch to Room 2 |
| Alt+3 | Switch to Room 3 |
| Alt+4 | Switch to Room 4 |
| Alt+5 | Switch to Room 5 |

### Panels and commands

| Shortcut | Action |
|----------|--------|
| Ctrl+K | Open Command Palette |
| Ctrl+Shift+H | Toggle Help Panel |
| Ctrl+Shift+P | Toggle Plugin Panel |

### Actions

| Shortcut | Action |
|----------|--------|
| Ctrl+Enter | Send Message |
| Ctrl+Shift+N | Create New Room |
| Escape | Close Modal / Cancel |

## How to customize

Manage your shortcuts using commands in the Overlord command interface:

- **Add or update a shortcut:** `shortcuts:add ctrl+shift+m|navigate:metrics|Go to Metrics`
  - Format: `key combo|action|label`
  - If the key combo already exists, it will be updated with the new action
- **Remove a shortcut:** `shortcuts:remove ctrl+shift+m`
- **List all shortcuts:** `shortcuts:list`
- **Restore defaults:** `shortcuts:reset`

### Key combo format

Separate modifiers with `+`. Supported modifiers: `ctrl`, `shift`, `alt`, `meta` (Cmd on Mac).

Examples: `ctrl+k`, `ctrl+shift+r`, `alt+1`, `meta+enter`

### Action format

Actions use colon-separated strings that the frontend understands:

- `navigate:rooms` — go to a view
- `navigate:room:index:0` — go to a specific room by position
- `panel:toggle:help` — toggle a panel
- `command:palette` — open the command palette
- `action:send-message` — trigger an action

## Events emitted

| Event | When | Payload |
|-------|------|---------|
| `shortcuts:register` | Plugin loads or shortcuts change | Full list of shortcuts grouped by category |
| `shortcuts:deregister` | Plugin unloads | Plugin ID (frontend removes all bindings) |
| `shortcuts:list` | You request the shortcut list | All shortcuts with groups and count |
| `shortcuts:hint` | You enter a room | Contextual hint message with relevant shortcuts |

## Permissions used

- **bus:emit** — sends shortcut events to the frontend
- **storage:read / storage:write** — saves your custom shortcut mappings
- **room:read** — reads room info to show contextual hints
- **agent:read** — reads agent info for shortcut context
