# Lua Scripting Guide

## Overview

Overlord v2 uses Lua 5.4 (compiled to WebAssembly via [wasmoon](https://github.com/nicholasgasior/wasmoon)) as the primary plugin scripting language. Lua plugins run in isolated sandboxes with explicit permission grants.

This page is a summary. Full documentation lives in [`docs/lua/`](../lua/):

| Document | Description |
|----------|-------------|
| [API Reference](../lua/api-reference.md) | Complete `overlord.*` API with every method, parameter, and return type |
| [Plugin Tutorial](../lua/plugin-tutorial.md) | 6-part step-by-step guide from Hello World to complete plugins |
| [Security Hooks Tutorial](../lua/security-hooks-tutorial.md) | 7-part guide to building pre/post tool-use security plugins |
| [Code Examples](../lua/examples.md) | 20+ copy-paste patterns organized by category |
| [Developer Guide](../lua/developer-guide.md) | Architecture, testing, debugging, and best practices |

---

## Why Lua?

- **Strongest isolation** — Each plugin runs in its own WebAssembly VM. No access to Node.js, filesystem, or network unless explicitly granted.
- **Lightweight** — Lua VMs start in milliseconds. Adding 29 plugins adds negligible overhead.
- **Simple syntax** — Easy to learn for non-programmers writing custom rules.
- **Safe by default** — Dangerous standard libraries (`os`, `io`, `debug`) are removed.

---

## Quick Example

### plugin.json

```json
{
  "id": "my-guard",
  "name": "My Guard",
  "version": "1.0.0",
  "description": "Blocks dangerous commands",
  "engine": "lua",
  "entrypoint": "main.lua",
  "permissions": ["security:read", "security:write"]
}
```

### main.lua

```lua
registerHook("onPreToolUse", function(context)
    if context.toolName ~= "shell" then
        return { action = "allow" }
    end

    local cmd = tostring(context.toolParams.command or "")

    if string.match(cmd, "rm%s+%-rf%s+/") then
        overlord.security.logEvent({
            type = "my_guard",
            action = "block",
            toolName = "shell",
            message = "Blocked: rm -rf /"
        })
        return { action = "block", message = "Cannot delete root filesystem" }
    end

    return { action = "allow" }
end)

overlord.log.info("My Guard loaded")
```

---

## API Surface

All Lua plugins access the system through the global `overlord` table:

| Namespace | Permission | Methods |
|-----------|-----------|---------|
| `overlord.manifest` | _(none)_ | `.id`, `.name`, `.version`, `.description`, `.engine` |
| `overlord.log` | _(none)_ | `.info()`, `.warn()`, `.error()`, `.debug()` |
| `overlord.bus` | `bus:emit` | `.emit(event, data)` |
| `overlord.rooms` | `room:read` | `.list()`, `.get(id)` |
| `overlord.agents` | `agent:read` | `.list(filters)`, `.get(id)` |
| `overlord.storage` | `storage:read/write` | `.get(key)`, `.set(key, val)`, `.delete(key)`, `.keys()` |
| `overlord.security` | `security:read/write` | `.logEvent()`, `.getEvents()`, `.getStats()`, `.matchPattern()`, `.matchAny()`, `.redact()` |

---

## Hook Types

### Fire-and-forget (broadcast to all plugins)

`onLoad`, `onUnload`, `onRoomEnter`, `onRoomExit`, `onToolExecute`, `onPhaseAdvance`, `onBuildingCreate`, `onSecurityEvent`

### Queryable (first non-nil return wins)

`onPreToolUse`, `onPostToolUse`, `onPhaseGateEvaluate`, `onExitDocValidate`, `onAgentAssign`, `onNotificationRule`, `onProgressReport`

---

## Built-In Security Plugins

| Plugin | Hook | Rules |
|--------|------|-------|
| `shell-guard` | `onPreToolUse` | 23 patterns: rm -rf, curl\|bash, force push, DROP TABLE, fork bombs, etc. |
| `code-scanner` | `onPreToolUse` | SQL injection, XSS, hardcoded AWS keys, code injection |
| `secret-guard` | `onPostToolUse` | Stripe keys, GitHub tokens, AWS keys, private keys, JWTs, Slack tokens |

---

## Sandbox Restrictions

**Blocked:** `os`, `io`, `loadfile`, `dofile`, `require`, `package`, `debug`, `collectgarbage`

**Available:** `string`, `table`, `math`, `tostring`, `tonumber`, `type`, `pairs`, `ipairs`, `pcall`, `error`, `select`, `unpack`

---

## See Also

- [[Plugin Development]] — Full plugin system documentation
- [[Tool Registry]] — How tools are registered and executed
- [[Structural Tool Access]] — How room contracts control tool availability
