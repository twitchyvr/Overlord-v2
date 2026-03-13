# Theme Switcher

Personalize the look of Overlord by switching between color themes. The plugin ships with four built-in themes and lets you create your own custom ones.

## What it does

When this plugin loads, it registers all available themes with the Overlord interface and applies the one you last used. You can switch themes at any time, and the interface updates immediately.

Built-in themes:

| Theme | Description |
|-------|------------|
| **Overlord Dark** | Deep navy background with electric blue accents (default) |
| **Overlord Light** | Clean white background with soft grey surfaces |
| **Sunset** | Warm dark purples with orange accents |
| **Ocean** | Deep teal background with aquamarine highlights |

## How to use

Switch themes using commands in the Overlord command interface:

- **Switch theme:** `theme:switch Sunset`
- **Add a custom theme:** `theme:add My Theme|#1a1a2e|#e94560|#16213e`
  - Format: `name|primary color|accent color|surface color` (use hex color codes)
- **List all themes:** `theme:list`
- **Remove a theme:** `theme:remove My Theme`

Your active theme is remembered between sessions. Custom themes you create are saved permanently until you remove them.

## Events emitted

| Event | When | Payload |
|-------|------|---------|
| `theme:register` | Plugin loads (once per theme) | Theme name, colors, whether it is the active theme |
| `theme:switch` | You switch themes | Theme name and all color values |
| `theme:list` | You request the theme list | All themes with their colors and which is active |
| `theme:removed` | You remove a theme | Name of the removed theme |

## Permissions used

- **bus:emit** — sends theme events to the frontend
- **storage:read / storage:write** — saves your custom themes and remembers your active theme
- **tool:execute** — listens for theme commands during tool execution
