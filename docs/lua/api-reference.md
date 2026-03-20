# Lua Plugin API Reference

> Complete reference for the Overlord v2 Lua plugin API.
> All functions are accessed through the global `overlord` table or the `registerHook` function.

---

## Table of Contents

- [Global Functions](#global-functions)
- [overlord.manifest](#overlordmanifest)
- [overlord.log](#overlordlog)
- [overlord.bus](#overlordbus)
- [overlord.rooms](#overlordrooms)
- [overlord.agents](#overlordagents)
- [overlord.storage](#overlordstorage)
- [overlord.security](#overlordsecurity)
- [Hook Registration](#hook-registration)
- [Hook Types](#hook-types)
- [Permissions](#permissions)
- [Sandbox Restrictions](#sandbox-restrictions)
- [Type Reference](#type-reference)

---

## Global Functions

### `registerHook(hookName, handler)`

Registers a lifecycle hook handler. This is the primary way plugins respond to system events.

| Parameter | Type | Description |
|-----------|------|-------------|
| `hookName` | `string` | One of the valid hook names (see [Hook Types](#hook-types)) |
| `handler` | `function(data) -> table\|nil` | Callback receiving hook-specific context data |

```lua
registerHook("onLoad", function(data)
    overlord.log.info("Plugin loaded!")
end)

-- Queryable hooks return a table to influence behavior
registerHook("onPreToolUse", function(context)
    if context.toolName == "shell" then
        return { action = "block", message = "Shell disabled" }
    end
    return { action = "allow" }
end)
```

**Valid hook names:**
`onLoad`, `onUnload`, `onRoomEnter`, `onRoomExit`, `onToolExecute`, `onPhaseAdvance`,
`onPreToolUse`, `onPostToolUse`, `onSecurityEvent`,
`onPhaseGateEvaluate`, `onExitDocValidate`, `onAgentAssign`,
`onNotificationRule`, `onProgressReport`, `onBuildingCreate`

---

## overlord.manifest

Read-only table containing the plugin's own manifest information. Always available (no permission required).

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Plugin ID (kebab-case, e.g. `"shell-guard"`) |
| `name` | `string` | Human-readable display name |
| `version` | `string` | Semver version string (e.g. `"1.0.0"`) |
| `description` | `string` | Short description of the plugin |
| `engine` | `string` | Always `"lua"` for Lua plugins |

```lua
overlord.log.info("Plugin " .. overlord.manifest.name .. " v" .. overlord.manifest.version)
```

---

## overlord.log

Scoped logger that tags all output with the plugin ID. Always available (no permission required).

### `overlord.log.info(message, data?)`

Log an informational message.

| Parameter | Type | Description |
|-----------|------|-------------|
| `message` | `string` | Log message |
| `data` | `table` (optional) | Structured data to include |

### `overlord.log.warn(message, data?)`

Log a warning.

### `overlord.log.error(message, data?)`

Log an error.

### `overlord.log.debug(message, data?)`

Log a debug message (only visible when debug logging is enabled).

```lua
overlord.log.info("Processing started", { roomId = "room-123", agentCount = 5 })
overlord.log.warn("Threshold exceeded", { value = 95, limit = 80 })
overlord.log.error("Connection failed", { endpoint = "https://api.example.com" })
overlord.log.debug("Cache hit", { key = "user:42" })
```

**Note:** Log entries are stored in a per-plugin ring buffer (100 entries max) and visible in the Plugin Manager UI.

---

## overlord.bus

Event bus for inter-plugin and system communication.

**Required permission:** `bus:emit`

### `overlord.bus.emit(event, data?)`

Emit an event on the Overlord event bus. Events are automatically namespaced to `plugin:<pluginId>:<event>`.

| Parameter | Type | Description |
|-----------|------|-------------|
| `event` | `string` | Event name |
| `data` | `table` (optional) | Event payload |

```lua
overlord.bus.emit("timer-warning", {
    roomId = "room-123",
    remainingMinutes = 5
})
-- Emits: "plugin:my-plugin:timer-warning"
```

**Behavior without permission:** Logs a `"bus:emit permission denied"` warning and silently returns.

---

## overlord.rooms

Room access API for reading room state and registering custom room types.

### `overlord.rooms.list()`

**Required permission:** `room:read`

Returns a list of all rooms in the current building.

```lua
local result = overlord.rooms.list()
if result and result.ok then
    for _, room in ipairs(result.data) do
        overlord.log.info("Room: " .. room.name)
    end
end
```

### `overlord.rooms.get(roomId)`

**Required permission:** `room:read`

Returns a single room by ID.

| Parameter | Type | Description |
|-----------|------|-------------|
| `roomId` | `string` | The room's unique ID |

```lua
local result = overlord.rooms.get("room-abc-123")
if result and result.ok then
    local room = result.data
    overlord.log.info("Room type: " .. room.type)
end
```

**Behavior without permission:** Returns `nil`.

---

## overlord.agents

Agent access API for reading agent state.

### `overlord.agents.list(filters?)`

**Required permission:** `agent:read`

Returns a list of agents, optionally filtered.

| Parameter | Type | Description |
|-----------|------|-------------|
| `filters` | `table` (optional) | Filter by `status` and/or `roomId` |

```lua
-- All agents
local all = overlord.agents.list()

-- Filter by status
local active = overlord.agents.list({ status = "active" })

-- Filter by room
local inRoom = overlord.agents.list({ roomId = "room-123" })
```

### `overlord.agents.get(agentId)`

**Required permission:** `agent:read`

Returns a single agent by ID.

| Parameter | Type | Description |
|-----------|------|-------------|
| `agentId` | `string` | The agent's unique ID |

```lua
local result = overlord.agents.get("agent-42")
if result and result.ok then
    overlord.log.info("Agent role: " .. result.data.role)
end
```

**Behavior without permission:** Returns `nil`.

---

## overlord.storage

Plugin-scoped key-value storage. Each plugin has its own isolated storage namespace — plugins cannot read or write each other's storage.

### `overlord.storage.get(key)`

**Required permission:** `storage:read`

| Parameter | Type | Description |
|-----------|------|-------------|
| `key` | `string` | Storage key |

Returns the stored value, or `nil` if not found.

### `overlord.storage.set(key, value)`

**Required permission:** `storage:write`

| Parameter | Type | Description |
|-----------|------|-------------|
| `key` | `string` | Storage key |
| `value` | `any` | Value to store (tables, strings, numbers, booleans) |

### `overlord.storage.delete(key)`

**Required permission:** `storage:write`

| Parameter | Type | Description |
|-----------|------|-------------|
| `key` | `string` | Storage key to delete |

Returns `true` if the key existed and was deleted, `false` otherwise.

### `overlord.storage.keys()`

**Required permission:** `storage:read`

Returns a list of all keys in the plugin's storage.

```lua
-- Save configuration
overlord.storage.set("config", {
    enabled = true,
    threshold = 80,
    patterns = { "rm -rf", "DROP TABLE" }
})

-- Read it back
local config = overlord.storage.get("config")
if config then
    overlord.log.info("Threshold: " .. tostring(config.threshold))
end

-- List all keys
local keys = overlord.storage.keys()
for _, key in ipairs(keys) do
    overlord.log.debug("Storage key: " .. key)
end

-- Delete a key
overlord.storage.delete("temp_data")
```

**Behavior without permission:** `get`/`keys` return `nil`/empty table; `set`/`delete` silently return.

---

## overlord.security

Security API for logging events, querying security state, and pattern matching. Added in #873 for the security hook system.

### `overlord.security.logEvent(event)`

**Required permission:** `security:write`

Log a security event to the in-memory event store.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | `string` | Yes | Event category (e.g. `"shell_guard"`, `"secret_leak"`) |
| `action` | `string` | Yes | `"allow"`, `"warn"`, or `"block"` |
| `message` | `string` | Yes | Human-readable description |
| `toolName` | `string` | No | Tool that triggered the event |
| `agentId` | `string` | No | Agent involved |
| `roomId` | `string` | No | Room where event occurred |
| `buildingId` | `string` | No | Building context |

```lua
overlord.security.logEvent({
    type = "shell_guard",
    action = "block",
    toolName = "shell",
    agentId = context.agentId,
    roomId = context.roomId,
    message = "Dangerous command blocked: rm -rf /",
    command = "rm -rf /"
})
```

**Note:** Events are stored in-memory (max 1000, FIFO eviction). The `pluginId` field is automatically set to the calling plugin's ID.

### `overlord.security.getEvents(filter?)`

**Required permission:** `security:read`

Query the security event store.

| Filter Field | Type | Description |
|-------------|------|-------------|
| `type` | `string` | Filter by event type |
| `action` | `string` | Filter by action (`"allow"`, `"warn"`, `"block"`) |
| `limit` | `number` | Maximum events to return |

Returns events in reverse chronological order (newest first).

```lua
-- Get last 10 blocked events
local blocked = overlord.security.getEvents({ action = "block", limit = 10 })
for _, event in ipairs(blocked) do
    overlord.log.info("Blocked: " .. event.message)
end

-- Get all shell_guard events
local shellEvents = overlord.security.getEvents({ type = "shell_guard" })
```

### `overlord.security.getStats()`

**Required permission:** `security:read`

Returns aggregate counts of security events.

| Field | Type | Description |
|-------|------|-------------|
| `total` | `number` | Total events logged |
| `blocked` | `number` | Events with action `"block"` |
| `warned` | `number` | Events with action `"warn"` |
| `allowed` | `number` | Events with action `"allow"` |

```lua
local stats = overlord.security.getStats()
if stats then
    overlord.log.info("Security stats: " .. stats.total .. " total, " ..
        stats.blocked .. " blocked, " .. stats.warned .. " warned")
end
```

### `overlord.security.matchPattern(text, pattern)`

Test a string against a regex pattern. Patterns are validated for safety (max 200 chars, no ReDoS-prone constructs).

| Parameter | Type | Description |
|-----------|------|-------------|
| `text` | `string` | Text to test |
| `pattern` | `string` | JavaScript regex pattern (case-insensitive) |

Returns `true` if the pattern matches, `false` otherwise.

```lua
if overlord.security.matchPattern(cmd, "rm\\s+\\-rf") then
    return { action = "block", message = "Dangerous delete command" }
end
```

**Note:** This uses JavaScript regex syntax (the pattern is compiled server-side), not Lua patterns. For Lua-native matching, use `string.match()` directly.

### `overlord.security.matchAny(text, patterns)`

Test a string against multiple regex patterns. Returns the first matching pattern or `nil`.

| Parameter | Type | Description |
|-----------|------|-------------|
| `text` | `string` | Text to test |
| `patterns` | `table` | Array of JavaScript regex pattern strings |

```lua
local match = overlord.security.matchAny(code, {
    "eval\\(", "innerHTML\\s*="
})
if match then
    overlord.log.warn("Matched dangerous pattern: " .. match)
end
```

### `overlord.security.redact(text, patterns)`

Replace all matches of the given patterns with `[REDACTED]`.

| Parameter | Type | Description |
|-----------|------|-------------|
| `text` | `string` | Text to redact |
| `patterns` | `table` | Array of JavaScript regex pattern strings |

Returns the redacted string.

```lua
local safe = overlord.security.redact(output, {
    "sk_live_[a-zA-Z0-9]+",
    "ghp_[a-zA-Z0-9]+",
    "AKIA[0-9A-Z]+"
})
```

---

## Hook Registration

Hooks are registered using the global `registerHook()` function. There are two categories:

### Fire-and-Forget Hooks

These hooks are broadcast to all plugins. The return value is ignored.

| Hook | Trigger | Context Fields |
|------|---------|---------------|
| `onLoad` | Plugin loaded and initialized | _(none)_ |
| `onUnload` | Plugin being unloaded | _(none)_ |
| `onRoomEnter` | Agent entered a room | `roomId`, `roomType`, `agentId` |
| `onRoomExit` | Agent exited a room | `roomId`, `roomType`, `agentId` |
| `onToolExecute` | Tool was executed (post-execution) | `toolName`, `agentId`, `roomId`, `result` |
| `onPhaseAdvance` | Phase gate advanced | `buildingId`, `fromPhase`, `toPhase` |
| `onBuildingCreate` | New building created | `buildingId`, `name` |
| `onSecurityEvent` | Security event logged | `type`, `action`, `message`, `toolName`, `agentId` |

### Queryable Hooks

These hooks are called sequentially until one plugin returns a non-nil value. That value influences system behavior.

| Hook | Trigger | Expected Return |
|------|---------|----------------|
| `onPreToolUse` | Before tool execution | `SecurityHookResult` |
| `onPostToolUse` | After tool execution | `SecurityHookResult` |
| `onPhaseGateEvaluate` | Phase gate go/no-go decision | `{ verdict: "go"\|"no-go", reason: "..." }` |
| `onExitDocValidate` | Exit document validation | `{ valid: true\|false, issues: {...} }` |
| `onAgentAssign` | Agent assignment strategy | `{ agentId: "..." }` |
| `onNotificationRule` | Alert/notification routing | `{ channels: {...}, priority: "..." }` |
| `onProgressReport` | Custom progress metrics | `{ metrics: {...} }` |

---

## Hook Types

### SecurityHookResult

Returned by `onPreToolUse` and `onPostToolUse` hooks.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `action` | `string` | Yes | `"allow"`, `"warn"`, or `"block"` |
| `message` | `string` | No | Human-readable explanation |
| `suggestion` | `string` | No | Suggested safer alternative |

```lua
return { action = "block", message = "Command blocked", suggestion = "Use git stash instead" }
```

### PreToolUseHookData

Context passed to `onPreToolUse` handlers.

| Field | Type | Description |
|-------|------|-------------|
| `hook` | `string` | Always `"onPreToolUse"` |
| `toolName` | `string` | Name of the tool about to execute |
| `toolParams` | `table` | Parameters passed to the tool |
| `agentId` | `string` | ID of the agent invoking the tool |
| `roomId` | `string` | ID of the room where execution occurs |
| `buildingId` | `string` | ID of the building (optional) |

### PostToolUseHookData

Context passed to `onPostToolUse` handlers.

| Field | Type | Description |
|-------|------|-------------|
| `hook` | `string` | Always `"onPostToolUse"` |
| `toolName` | `string` | Name of the tool that executed |
| `toolParams` | `table` | Parameters that were passed to the tool |
| `agentId` | `string` | ID of the agent that invoked the tool |
| `roomId` | `string` | ID of the room where execution occurred |
| `buildingId` | `string` | ID of the building (optional) |
| `result` | `any` | The tool's return value |
| `success` | `boolean` | Whether the tool succeeded |

---

## Permissions

Plugins declare required permissions in their `plugin.json` manifest. The sandbox enforces these at runtime — calling an API without the required permission logs a warning and returns a safe default (`nil`, `false`, or empty table).

| Permission | Description | Risk Level | APIs Unlocked |
|------------|-------------|------------|---------------|
| `room:read` | Read room state | Low | `overlord.rooms.list()`, `overlord.rooms.get()` |
| `room:write` | Create/modify rooms | Medium | `overlord.rooms.registerRoomType()` |
| `tool:execute` | Execute tools | Medium | `overlord.tools.register()`, `overlord.tools.execute()` |
| `agent:read` | Read agent state | Low | `overlord.agents.list()`, `overlord.agents.get()` |
| `bus:emit` | Emit events on the bus | Medium | `overlord.bus.emit()` |
| `storage:read` | Read plugin-scoped storage | Low | `overlord.storage.get()`, `overlord.storage.keys()` |
| `storage:write` | Write plugin-scoped storage | Low | `overlord.storage.set()`, `overlord.storage.delete()` |
| `fs:read` | Read files from filesystem | High | _(filesystem APIs)_ |
| `fs:write` | Write files to filesystem | High | _(filesystem APIs)_ |
| `net:http` | Outbound HTTP requests | High | _(HTTP client APIs)_ |
| `security:read` | Read security events/stats | Low | `overlord.security.getEvents()`, `overlord.security.getStats()` |
| `security:write` | Log security events | Medium | `overlord.security.logEvent()` |

**Note:** `overlord.security.matchPattern()`, `overlord.security.matchAny()`, and `overlord.security.redact()` do not require any permission — they are pure utility functions.

---

## Sandbox Restrictions

The Lua sandbox removes dangerous standard library globals to prevent plugins from escaping the sandbox:

| Blocked Global | Reason |
|---------------|--------|
| `os` | System operations (execute, remove, rename, etc.) |
| `io` | File I/O operations |
| `loadfile` | Load Lua from filesystem |
| `dofile` | Execute Lua from filesystem |
| `require` | Module loading from filesystem |
| `package` | Package/module system (has filesystem access) |
| `debug` | Debug library (can inspect/modify internals) |
| `collectgarbage` | GC control (DoS vector) |

**Available Lua standard libraries:**
- `string` — String manipulation (`string.match`, `string.format`, etc.)
- `table` — Table manipulation (`table.insert`, `table.sort`, etc.)
- `math` — Math functions (`math.floor`, `math.max`, etc.)
- `tostring`, `tonumber`, `type`, `pairs`, `ipairs`, `pcall`, `error`, `select`, `unpack`

**Each plugin gets its own isolated Lua VM instance** (via wasmoon/WebAssembly). A plugin crash never affects other plugins or the server.

---

## Type Reference

### Plugin Manifest (`plugin.json`)

```json
{
  "id": "string (kebab-case, required)",
  "name": "string (required)",
  "version": "string (semver, required)",
  "description": "string (required)",
  "author": "string (optional)",
  "engine": "lua",
  "entrypoint": "main.lua",
  "permissions": ["permission1", "permission2"],
  "provides": {
    "roomTypes": ["string"],
    "tools": ["string"],
    "commands": ["string"]
  }
}
```

### Security Event

```lua
{
  timestamp = 1710000000000,  -- Auto-set by logEvent()
  type = "shell_guard",       -- Event category
  action = "block",           -- "allow" | "warn" | "block"
  toolName = "shell",         -- Tool involved (optional)
  agentId = "agent-42",       -- Agent involved (optional)
  roomId = "room-abc",        -- Room context (optional)
  buildingId = "bld-1",       -- Building context (optional)
  message = "Command blocked", -- Human-readable description
  pluginId = "shell-guard",   -- Auto-set to calling plugin's ID
  details = {}                -- Additional data (optional)
}
```
