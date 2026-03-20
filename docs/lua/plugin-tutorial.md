# Lua Plugin Tutorial

> Step-by-step guide to building your first Overlord v2 Lua plugin.

---

## Prerequisites

- Overlord v2 running with `ENABLE_PLUGINS=true`
- Basic familiarity with Lua syntax
- A project (building) created in Overlord

---

## Part 1: Hello World Plugin

Every plugin starts with two files: a manifest (`plugin.json`) and an entrypoint script.

### Create the plugin directory

```
plugins/
  hello-world/
    plugin.json
    main.lua
```

### Write the manifest

```json
{
  "id": "hello-world",
  "name": "Hello World",
  "version": "1.0.0",
  "description": "A minimal plugin that logs a greeting on load",
  "author": "Your Name",
  "engine": "lua",
  "entrypoint": "main.lua",
  "permissions": []
}
```

Key rules:
- `id` must be **kebab-case** (lowercase letters, numbers, hyphens)
- `version` must follow **semver** (e.g. `1.0.0`)
- `engine` must be `"lua"` for Lua plugins
- `entrypoint` is relative to the plugin directory
- `permissions` is an empty array if the plugin needs no API access

### Write the entrypoint

```lua
-- hello-world/main.lua

registerHook("onLoad", function()
    overlord.log.info("Hello from " .. overlord.manifest.name .. "!")
end)

registerHook("onUnload", function()
    overlord.log.info("Goodbye from " .. overlord.manifest.name)
end)
```

### Verify it loaded

Restart Overlord (or reload plugins from the Plugin Manager UI). Check the server logs for:

```
[plugins] Plugin "hello-world" loaded successfully
[hello-world] Hello from Hello World!
```

---

## Part 2: Using the Event Bus

Extend the plugin to emit events when agents enter or leave rooms.

### Update the manifest

Add `bus:emit` and `room:read` permissions:

```json
{
  "id": "hello-world",
  "name": "Hello World",
  "version": "1.1.0",
  "description": "Logs greetings and tracks room activity",
  "engine": "lua",
  "entrypoint": "main.lua",
  "permissions": ["bus:emit", "room:read"]
}
```

### Add room hooks

```lua
-- hello-world/main.lua

registerHook("onLoad", function()
    overlord.log.info("Hello World plugin loaded")
end)

registerHook("onRoomEnter", function(data)
    overlord.log.info("Agent entered room", {
        agentId = data.agentId,
        roomId = data.roomId,
        roomType = data.roomType
    })

    -- Emit a custom event
    overlord.bus.emit("agent-activity", {
        action = "entered",
        agentId = data.agentId,
        roomId = data.roomId
    })
end)

registerHook("onRoomExit", function(data)
    overlord.log.info("Agent left room", {
        agentId = data.agentId,
        roomId = data.roomId
    })

    overlord.bus.emit("agent-activity", {
        action = "exited",
        agentId = data.agentId,
        roomId = data.roomId
    })
end)
```

The event bus namespaces events automatically: `overlord.bus.emit("agent-activity", ...)` becomes `plugin:hello-world:agent-activity` on the bus.

---

## Part 3: Using Storage

Add persistent state to track how many times agents enter rooms.

### Update permissions

```json
"permissions": ["bus:emit", "room:read", "storage:read", "storage:write"]
```

### Add counter logic

```lua
-- Track room entry counts

local function getEntryCount(roomId)
    local counts = overlord.storage.get("entry_counts") or {}
    return counts[roomId] or 0
end

local function incrementEntryCount(roomId)
    local counts = overlord.storage.get("entry_counts") or {}
    counts[roomId] = (counts[roomId] or 0) + 1
    overlord.storage.set("entry_counts", counts)
    return counts[roomId]
end

registerHook("onRoomEnter", function(data)
    local count = incrementEntryCount(data.roomId)
    overlord.log.info("Room entry #" .. count, {
        roomId = data.roomId,
        agentId = data.agentId
    })
end)

registerHook("onLoad", function()
    -- Show stored counts on load
    local keys = overlord.storage.keys()
    overlord.log.info("Storage has " .. #keys .. " keys")
end)
```

**Important:** Storage is scoped per-plugin. Your `entry_counts` key is isolated from other plugins' storage.

---

## Part 4: Querying Agents and Rooms

Build a plugin that reports on project state.

### Manifest

```json
{
  "id": "project-reporter",
  "name": "Project Reporter",
  "version": "1.0.0",
  "description": "Reports on agent and room state during phase advances",
  "engine": "lua",
  "entrypoint": "main.lua",
  "permissions": ["room:read", "agent:read", "bus:emit"]
}
```

### Main script

```lua
-- project-reporter/main.lua

registerHook("onPhaseAdvance", function(data)
    overlord.log.info("Phase advanced", {
        from = data.fromPhase,
        to = data.toPhase,
        building = data.buildingId
    })

    -- Get all active agents
    local agents = overlord.agents.list({ status = "active" })
    if agents and agents.ok then
        overlord.log.info("Active agents: " .. #agents.data)
    end

    -- Get all rooms
    local rooms = overlord.rooms.list()
    if rooms and rooms.ok then
        local roomTypes = {}
        for _, room in ipairs(rooms.data) do
            roomTypes[room.type] = (roomTypes[room.type] or 0) + 1
        end

        for roomType, count in pairs(roomTypes) do
            overlord.log.info("Room type: " .. roomType .. " (" .. count .. " rooms)")
        end
    end

    -- Emit a summary event
    overlord.bus.emit("phase-report", {
        fromPhase = data.fromPhase,
        toPhase = data.toPhase,
        buildingId = data.buildingId
    })
end)
```

---

## Part 5: Error Handling

Lua plugins run in a sandboxed VM. Errors are caught and logged without crashing the server. However, good error handling improves debuggability.

### Using pcall

```lua
registerHook("onToolExecute", function(data)
    -- Wrap risky operations in pcall
    local success, result = pcall(function()
        local room = overlord.rooms.get(data.roomId)
        if not room or not room.ok then
            error("Room not found: " .. tostring(data.roomId))
        end
        return room.data
    end)

    if not success then
        overlord.log.error("Failed to process tool execution", {
            error = tostring(result),
            roomId = data.roomId,
            toolName = data.toolName
        })
    end
end)
```

### Nil-safe access

Lua tables may not contain expected fields. Always check for nil:

```lua
registerHook("onRoomEnter", function(data)
    -- Safe: check before access
    local roomId = data.roomId or "unknown"
    local agentId = data.agentId or "unknown"

    -- Safe: use tostring for values that might not be strings
    overlord.log.info("Enter: " .. tostring(roomId) .. " by " .. tostring(agentId))
end)
```

---

## Part 6: Complete Example — Room Timer

This example combines all concepts into a real plugin that time-boxes room sessions.

See the built-in `room-timer` plugin at `plugins/built-in/room-timer/` for the full implementation. Key patterns demonstrated:

1. **Configuration via storage** — Default values with storage overrides
2. **State management** — Timer state persisted across hook invocations
3. **Multiple hooks** — `onLoad`, `onRoomEnter`, `onRoomExit`, `onToolExecute`, `onPhaseAdvance`
4. **Bus events** — Emitting `room:timer-warning` and `room:timer-expired`
5. **Error handling** — All external calls wrapped in `pcall`
6. **Helper functions** — Extracting reusable logic into local functions

### Architecture pattern

```lua
-- 1. Configuration helpers
local function getConfig(key, default) ... end

-- 2. State management
local function loadState() ... end
local function saveState(state) ... end

-- 3. Core logic
local function evaluate(roomId) ... end

-- 4. Hook registrations
registerHook("onLoad", function() ... end)
registerHook("onRoomEnter", function(data) ... end)
registerHook("onToolExecute", function(data) ... end)
```

---

## Next Steps

- [Security Hooks Tutorial](./security-hooks-tutorial.md) — Build pre/post tool-use security plugins
- [API Reference](./api-reference.md) — Complete API documentation
- [Code Examples](./examples.md) — 20+ example patterns
- [Plugin Developer Guide](./developer-guide.md) — Architecture, testing, and best practices
