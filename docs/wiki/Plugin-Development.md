# Plugin Development

## Overview

Overlord v2 supports a plugin system for extending the framework with custom room types, tools, commands, lifecycle hooks, and security hooks. Plugins run in **sandboxed environments** with explicit permission grants.

**Source:** `src/plugins/contracts.ts`, `src/plugins/plugin-loader.ts`, `src/plugins/lua-sandbox.ts`

**Full Lua documentation:** [`docs/lua/`](../lua/)
- [API Reference](../lua/api-reference.md) — Complete `overlord.*` API docs
- [Plugin Tutorial](../lua/plugin-tutorial.md) — Step-by-step guide
- [Security Hooks Tutorial](../lua/security-hooks-tutorial.md) — Pre/post tool-use hooks
- [Code Examples](../lua/examples.md) — 20+ copy-paste patterns
- [Developer Guide](../lua/developer-guide.md) — Architecture and best practices

---

## Plugin Engines

| Engine | Language | Sandbox | Best For |
|--------|----------|---------|----------|
| `lua` | Lua 5.4 (via wasmoon/WASM) | Isolated VM per plugin | Hooks, security, lightweight logic |
| `js` | JavaScript (via vm2) | Node.js VM sandbox | Complex tools, room types, heavy I/O |

**Lua is the recommended engine** for most plugins, especially security hooks. It offers the strongest isolation guarantees.

---

## Plugin Structure

```
plugins/
  my-plugin/
    plugin.json          ← Manifest (required)
    main.lua             ← Lua entrypoint
    README.md            ← Documentation (optional)
```

### Built-in plugins (29 total)

Shipped with Overlord in `plugins/built-in/`:

| Plugin | Type | Hooks Used |
|--------|------|------------|
| `shell-guard` | Security | `onPreToolUse` |
| `code-scanner` | Security | `onPreToolUse` |
| `secret-guard` | Security | `onPostToolUse` |
| `room-timer` | Utility | `onLoad`, `onRoomEnter`, `onRoomExit`, `onToolExecute`, `onPhaseAdvance` |
| `auto-phase-advance` | Workflow | `onPhaseAdvance` |
| `daily-standup` | Reporting | `onLoad` |
| `deadline-tracker` | Utility | `onPhaseAdvance` |
| ... | ... | ... |

---

## Manifest (`plugin.json`)

```json
{
  "id": "my-plugin",
  "name": "My Plugin",
  "version": "1.0.0",
  "description": "What this plugin does",
  "author": "Your Name",
  "engine": "lua",
  "entrypoint": "main.lua",
  "permissions": ["storage:read", "storage:write", "bus:emit"],
  "provides": {
    "roomTypes": [],
    "tools": [],
    "commands": []
  }
}
```

### Validation rules

- `id`: kebab-case (`^[a-z][a-z0-9]*(-[a-z0-9]+)*$`)
- `version`: semver (`^\d+\.\d+\.\d+`)
- `engine`: `"lua"` or `"js"`
- `permissions`: array of valid permission strings

---

## Permissions

| Permission | Description | Risk | APIs Unlocked |
|------------|-------------|------|---------------|
| `room:read` | List/get rooms | Low | `overlord.rooms.list()`, `.get()` |
| `room:write` | Create/modify rooms | Medium | `overlord.rooms.registerRoomType()` |
| `tool:execute` | Execute tools | Medium | `overlord.tools.register()`, `.execute()` |
| `agent:read` | List/get agents | Low | `overlord.agents.list()`, `.get()` |
| `bus:emit` | Emit events on the bus | Medium | `overlord.bus.emit()` |
| `storage:read` | Read plugin-scoped storage | Low | `overlord.storage.get()`, `.keys()` |
| `storage:write` | Write plugin-scoped storage | Low | `overlord.storage.set()`, `.delete()` |
| `fs:read` | Filesystem read access | High | _(filesystem APIs)_ |
| `fs:write` | Filesystem write access | High | _(filesystem APIs)_ |
| `net:http` | Outbound HTTP requests | High | _(HTTP client APIs)_ |
| `security:read` | Read security events/stats | Low | `overlord.security.getEvents()`, `.getStats()` |
| `security:write` | Log security events | Medium | `overlord.security.logEvent()` |

---

## Lua Plugin API (`overlord.*`)

Lua plugins access the Overlord API through the global `overlord` table:

```lua
-- Always available (no permission)
overlord.manifest.id          -- Plugin's ID
overlord.manifest.name        -- Plugin's name
overlord.manifest.version     -- Plugin's version
overlord.log.info(msg, data)  -- Scoped logger
overlord.log.warn(msg, data)
overlord.log.error(msg, data)
overlord.log.debug(msg, data)

-- Requires bus:emit
overlord.bus.emit(event, data)

-- Requires room:read
overlord.rooms.list()
overlord.rooms.get(roomId)

-- Requires agent:read
overlord.agents.list(filters)
overlord.agents.get(agentId)

-- Requires storage:read / storage:write
overlord.storage.get(key)
overlord.storage.set(key, value)
overlord.storage.delete(key)
overlord.storage.keys()

-- Requires security:write
overlord.security.logEvent(event)

-- Requires security:read
overlord.security.getEvents(filter)
overlord.security.getStats()

-- No permission required (utility functions)
overlord.security.matchPattern(text, pattern)
overlord.security.matchAny(text, patterns)
overlord.security.redact(text, patterns)
```

See [API Reference](../lua/api-reference.md) for complete documentation.

---

## Hook System

### Registering hooks

```lua
registerHook("onLoad", function(data)
    overlord.log.info("Plugin loaded!")
end)
```

### Fire-and-forget hooks

Broadcast to all plugins. Return value ignored.

| Hook | Trigger |
|------|---------|
| `onLoad` | Plugin loaded |
| `onUnload` | Plugin unloading |
| `onRoomEnter` | Agent entered room |
| `onRoomExit` | Agent exited room |
| `onToolExecute` | Tool executed (post) |
| `onPhaseAdvance` | Phase advanced |
| `onBuildingCreate` | Building created |
| `onSecurityEvent` | Security event logged |

### Queryable hooks

Called sequentially. First non-nil return wins.

| Hook | Return Type |
|------|------------|
| `onPreToolUse` | `{ action, message, suggestion }` |
| `onPostToolUse` | `{ action, message, suggestion }` |
| `onPhaseGateEvaluate` | `{ verdict, reason }` |
| `onExitDocValidate` | `{ valid, issues }` |
| `onAgentAssign` | `{ agentId }` |
| `onNotificationRule` | `{ channels, priority }` |
| `onProgressReport` | `{ metrics }` |

---

## Security Hooks (#873)

Pre/post tool-use hooks that can block, warn, or allow tool execution.

```lua
-- Block dangerous shell commands
registerHook("onPreToolUse", function(context)
    if context.toolName == "shell" then
        local cmd = tostring(context.toolParams.command or "")
        if string.match(cmd, "rm%s+%-rf%s+/") then
            overlord.security.logEvent({
                type = "my_guard",
                action = "block",
                toolName = "shell",
                message = "Recursive root delete blocked"
            })
            return { action = "block", message = "Cannot delete root filesystem" }
        end
    end
    return { action = "allow" }
end)
```

See [Security Hooks Tutorial](../lua/security-hooks-tutorial.md) for complete guide.

---

## Sandbox Safety

### Blocked Lua globals

`os`, `io`, `loadfile`, `dofile`, `require`, `package`, `debug`, `collectgarbage`

### Available Lua standard libraries

`string`, `table`, `math`, `tostring`, `tonumber`, `type`, `pairs`, `ipairs`, `pcall`, `error`, `select`, `unpack`

### Isolation

- Each plugin: separate Lua VM (WebAssembly)
- Storage: namespace-isolated per plugin
- Crashes: caught and logged, never affect server
- Permissions: enforced at runtime, denied calls return safe defaults

---

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `ENABLE_PLUGINS` | `false` | Enable the plugin system |
| `PLUGIN_DIR` | `./plugins` | Directory to scan for plugins |

---

## Quick Start

1. Create `plugins/my-plugin/plugin.json` and `plugins/my-plugin/main.lua`
2. Set `ENABLE_PLUGINS=true` in your environment
3. Start Overlord: `npm run dev`
4. Check the Plugin Manager UI for status
5. See [Plugin Tutorial](../lua/plugin-tutorial.md) for a full walkthrough
