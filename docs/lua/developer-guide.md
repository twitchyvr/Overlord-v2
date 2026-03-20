# Lua Plugin Developer Guide

> Architecture, best practices, testing, and deployment guide for Overlord v2 Lua plugins.

---

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Plugin Lifecycle](#plugin-lifecycle)
- [Directory Structure](#directory-structure)
- [Manifest Reference](#manifest-reference)
- [Plugin Loading Order](#plugin-loading-order)
- [Sandbox Security Model](#sandbox-security-model)
- [Performance Considerations](#performance-considerations)
- [Testing Plugins](#testing-plugins)
- [Debugging](#debugging)
- [Best Practices](#best-practices)
- [Migration from JS Plugins](#migration-from-js-plugins)
- [Troubleshooting](#troubleshooting)

---

## Architecture Overview

```
                    ┌─────────────────────┐
                    │   Overlord Server    │
                    │  (Node.js / TypeScript) │
                    └──────────┬──────────┘
                               │
                    ┌──────────▼──────────┐
                    │    Plugin Loader     │
                    │  (plugin-loader.ts)  │
                    └──────────┬──────────┘
                               │
              ┌────────────────┼────────────────┐
              │                │                │
     ┌────────▼────────┐ ┌────▼────┐ ┌────────▼────────┐
     │  Lua Sandbox    │ │  JS VM  │ │  Lua Sandbox    │
     │  (wasmoon/WASM) │ │ (vm2)   │ │  (wasmoon/WASM) │
     │  Plugin A       │ │ Plugin B│ │  Plugin C       │
     └────────┬────────┘ └────┬────┘ └────────┬────────┘
              │                │                │
              └────────────────┼────────────────┘
                               │
                    ┌──────────▼──────────┐
                    │   overlord global   │
                    │  (permission-filtered)│
                    └─────────────────────┘
```

Each Lua plugin runs in its own **isolated WebAssembly Lua VM** (powered by [wasmoon](https://github.com/nicholasgasior/wasmoon)). The VM has:
- No access to Node.js APIs
- No access to the filesystem, network, or OS
- Only the `overlord` global table, filtered by declared permissions
- Standard Lua libraries (minus dangerous ones)

### How hooks work

1. **Fire-and-forget hooks** (onLoad, onRoomEnter, etc.): Bus events trigger `broadcastHook()` which calls every active plugin's handler. Return values are ignored.

2. **Queryable hooks** (onPreToolUse, onPhaseGateEvaluate, etc.): Called via `queryHook()` which iterates plugins in registration order. The **first** plugin to return a non-nil value wins — that value becomes the system's decision. If no plugin returns a value, the TypeScript default behavior applies.

---

## Plugin Lifecycle

```
discover → validate manifest → create sandbox → execute script → register hooks → active
                                                                                    │
                                            unload ← destroy sandbox ← remove hooks ┘
```

1. **Discovery** — Plugin loader scans `PLUGIN_DIR` and `PLUGIN_DIR/built-in/` for `plugin.json` files
2. **Validation** — Manifest is checked for required fields, valid ID format (kebab-case), valid engine, valid permissions, and valid semver
3. **Sandbox creation** — A new Lua VM is instantiated with the `overlord` API injected
4. **Script execution** — The entrypoint file is read and executed in the sandbox
5. **Hook registration** — During execution, `registerHook()` calls record hook handlers
6. **Active** — Plugin is now receiving hook callbacks

### Plugin status values

| Status | Meaning |
|--------|---------|
| `loading` | Sandbox being created, script being executed |
| `active` | Plugin loaded and receiving hooks |
| `error` | Failed to load (check error message) |
| `unloaded` | Plugin has been shut down |

---

## Directory Structure

### User plugins

```
plugins/
  my-plugin/
    plugin.json          ← Manifest (required)
    main.lua             ← Entrypoint (required, referenced by manifest)
    README.md            ← Documentation (optional)
```

### Built-in plugins

```
plugins/
  built-in/
    shell-guard/
      plugin.json
      main.lua
    code-scanner/
      plugin.json
      main.lua
    secret-guard/
      plugin.json
      main.lua
    room-timer/
      plugin.json
      main.lua
    ... (26 built-in plugins)
```

### Plugin override

If a user plugin has the same `id` as a built-in plugin, the user plugin takes precedence. This allows customizing built-in behavior without modifying the source.

---

## Manifest Reference

```json
{
  "id": "my-plugin",
  "name": "My Plugin",
  "version": "1.0.0",
  "description": "What this plugin does",
  "author": "Your Name",
  "engine": "lua",
  "entrypoint": "main.lua",
  "permissions": ["storage:read", "storage:write"],
  "provides": {
    "roomTypes": [],
    "tools": [],
    "commands": []
  }
}
```

### Validation rules

| Field | Rule |
|-------|------|
| `id` | Kebab-case: `^[a-z][a-z0-9]*(-[a-z0-9]+)*$` |
| `version` | Semver: `^\d+\.\d+\.\d+(-[a-zA-Z0-9.]+)?$` |
| `engine` | Must be `"lua"` or `"js"` |
| `entrypoint` | Must be a relative path, file must exist |
| `permissions` | Each must be a valid permission string |

### provides (optional)

Declares what the plugin contributes to the system:
- `roomTypes` — Custom room type names registered by this plugin
- `tools` — Custom tool names registered by this plugin
- `commands` — Custom command names registered by this plugin

---

## Plugin Loading Order

1. Built-in plugins are discovered first (alphabetical by directory name)
2. User plugins are discovered second
3. User plugins override built-in plugins with the same `id`
4. Plugins are loaded sequentially (not in parallel)
5. Within queryable hooks, plugins are called in load order — first loaded, first called

**Implication:** If you want your security plugin to run before built-in ones, you cannot — built-in plugins load first. To override built-in behavior, create a user plugin with the same `id`.

---

## Sandbox Security Model

### What's blocked

| Feature | Status | Reason |
|---------|--------|--------|
| `os.*` | Blocked | System operations |
| `io.*` | Blocked | File I/O |
| `require()` | Blocked | Module loading |
| `loadfile()` | Blocked | File loading |
| `dofile()` | Blocked | File execution |
| `package.*` | Blocked | Module system |
| `debug.*` | Blocked | VM internals |
| `collectgarbage()` | Blocked | DoS vector |

### What's available

| Feature | Status |
|---------|--------|
| `string.*` | Full access |
| `table.*` | Full access |
| `math.*` | Full access |
| `tostring`, `tonumber`, `type` | Available |
| `pairs`, `ipairs` | Available |
| `pcall`, `error` | Available |
| `select`, `unpack` | Available |
| `overlord.*` | Permission-filtered |
| `registerHook()` | Always available |

### Permission enforcement

APIs called without the required permission:
- Log a warning to the plugin's log buffer
- Return a safe default (`nil`, `false`, empty table, or silent no-op)
- Never throw an error

### Isolation guarantees

- Each plugin has its own Lua VM — no shared state between plugins
- Plugin storage is namespaced — plugins cannot read each other's data
- A plugin crash/error is caught and logged — it never crashes the server
- Plugin execution has no timeout by default (wasmoon limitation), but the Node.js event loop remains responsive

---

## Performance Considerations

### Hook execution is synchronous per plugin

When a queryable hook (like `onPreToolUse`) fires, plugins are called sequentially. A slow plugin delays tool execution for all agents. Keep hook handlers fast:

- Avoid expensive string operations on large inputs
- Use early returns when a hook doesn't apply
- Cache computed values in storage rather than recomputing

### Pattern matching

For security hooks, prefer Lua's `string.match()` for simple patterns — it's faster than `overlord.security.matchPattern()` which crosses the Lua/JS boundary.

Use `overlord.security.matchPattern()` when you need:
- JavaScript regex features not available in Lua patterns
- Built-in ReDoS protection
- Case-insensitive matching without manual lowercasing

### Storage is in-memory

Plugin storage is an in-memory Map. Reads are instant, writes are instant. However, storage is not persisted across server restarts (unless the storage layer is configured for persistence).

---

## Testing Plugins

### Manual testing

1. Place your plugin in the `plugins/` directory
2. Start Overlord with `ENABLE_PLUGINS=true`
3. Check server logs for load success/failure
4. Use the Plugin Manager UI to view plugin status and logs
5. Trigger the relevant hooks (enter rooms, execute tools, advance phases)
6. Check plugin logs in the UI

### Unit testing hook logic

Extract your hook logic into testable functions:

```lua
-- main.lua

-- Testable function
local function shouldBlock(cmd)
    for _, rule in ipairs(RULES) do
        if string.match(cmd, rule.pattern) then
            return rule
        end
    end
    return nil
end

-- Hook registration uses the function
registerHook("onPreToolUse", function(context)
    if context.toolName ~= "shell" then return { action = "allow" } end
    local cmd = tostring(context.toolParams.command or "")
    local matched = shouldBlock(cmd)
    if matched then
        return { action = matched.action, message = matched.message }
    end
    return { action = "allow" }
end)
```

### Verifying via Security Events

After triggering your plugin, query the security event store:

```lua
-- In another plugin or via the API
local events = overlord.security.getEvents({ type = "my_plugin", limit = 5 })
-- Or check stats
local stats = overlord.security.getStats()
```

---

## Debugging

### Check plugin logs

The Plugin Manager UI shows each plugin's log ring buffer (last 100 entries). Look here first.

### Server-side logs

Plugin loader logs appear with `module: "plugins"` or `module: "lua-sandbox"`:

```
[plugins] Discovered 29 plugins (26 built-in, 3 user)
[plugins] Plugin "my-plugin" loaded successfully
[lua-sandbox] Lua plugin script executed successfully
```

### Common error messages

| Error | Cause |
|-------|-------|
| `Invalid hook name: "xyz"` | Hook name not in VALID_HOOKS list |
| `Hook handler must be a function` | Passed non-function to registerHook |
| `xxx permission denied` | Plugin's manifest doesn't declare required permission |
| `PLUGIN_EXECUTION_ERROR` | Lua syntax error or runtime error in script |
| `SANDBOX_DESTROYED` | Attempted to use sandbox after plugin was unloaded |

### Debug logging

Use `overlord.log.debug()` liberally during development. Debug logs are visible in the Plugin Manager when debug mode is enabled.

---

## Best Practices

### 1. Minimal permissions

Only declare permissions your plugin actually needs. Security-conscious users will review your `plugin.json` before enabling.

### 2. Always return from queryable hooks

Queryable hooks (`onPreToolUse`, `onPostToolUse`, etc.) should always return a value. Returning `nil` means "no opinion" — the next plugin or the TypeScript default takes over.

```lua
-- Good: explicit allow
return { action = "allow" }

-- Bad: implicit nil (makes the plugin invisible)
-- (no return statement)
```

### 3. Log security decisions

Every `block` and `warn` action should be logged via `overlord.security.logEvent()`. This creates an audit trail visible in the Security Events UI.

### 4. Use pcall for external calls

Wrap calls to `overlord.rooms.get()`, `overlord.agents.get()`, etc. in `pcall`:

```lua
local ok, result = pcall(overlord.rooms.get, roomId)
if ok and result and result.ok then
    -- use result.data
end
```

### 5. Keep hooks fast

Hook handlers run in the critical path of tool execution. A slow `onPreToolUse` handler delays every tool call.

### 6. Version your plugin

Follow semver and update the version in `plugin.json` when behavior changes. The Plugin Manager UI displays versions.

### 7. Document your plugin

Include a `README.md` in your plugin directory explaining what it does, what permissions it needs, and how to configure it.

### 8. Handle nil gracefully

Hook context fields may be `nil`. Always use `or ""` / `or "unknown"` defaults:

```lua
local agentId = context.agentId or ""
local cmd = tostring(context.toolParams.command or "")
```

---

## Migration from JS Plugins

| JS Pattern | Lua Equivalent |
|-----------|---------------|
| `module.exports = function(context) { ... }` | Top-level code + `registerHook()` |
| `context.log.info(msg)` | `overlord.log.info(msg)` |
| `context.bus.emit(event, data)` | `overlord.bus.emit(event, data)` |
| `context.storage.get(key)` | `overlord.storage.get(key)` |
| `return { onLoad: () => {} }` | `registerHook("onLoad", function() end)` |
| `async/await` | Not needed (Lua handlers are synchronous) |
| `try/catch` | `pcall(fn)` |
| `console.log` | `overlord.log.info` |

---

## Troubleshooting

### Plugin doesn't load

1. Check `plugin.json` exists and is valid JSON
2. Verify `id` is kebab-case
3. Verify `version` is valid semver
4. Verify all `permissions` are valid permission strings
5. Verify `entrypoint` file exists
6. Check server logs for validation errors

### Hook doesn't fire

1. Verify the hook name is spelled correctly (case-sensitive)
2. Verify the plugin loaded successfully (check status in Plugin Manager)
3. Verify the triggering event actually occurred (check server logs)
4. For queryable hooks, check if another plugin returned first

### Permission denied warnings

1. Check `plugin.json` permissions array includes the required permission
2. Ensure `security:read` and `security:write` are both listed if using the security API
3. Restart the server after modifying `plugin.json`

### Storage not persisting

Plugin storage is in-memory by default. Values are lost on server restart. This is by design for the current implementation.

### Pattern matching doesn't work

- Lua patterns and JavaScript regex are different syntaxes
- `string.match()` uses Lua patterns: `%s`, `%d`, `%-`
- `overlord.security.matchPattern()` uses JS regex: `\s`, `\d`, `-`
- Patterns over 200 characters are rejected
- Patterns with nested quantifiers are rejected (ReDoS protection)
