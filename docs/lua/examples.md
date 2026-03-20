# Lua Plugin Code Examples

> Copy-paste patterns for common plugin tasks. Each example is self-contained.

---

## Table of Contents

- [Logging](#logging)
- [Storage Patterns](#storage-patterns)
- [Event Bus](#event-bus)
- [Room Queries](#room-queries)
- [Agent Queries](#agent-queries)
- [Security: Pre-Tool-Use](#security-pre-tool-use)
- [Security: Post-Tool-Use](#security-post-tool-use)
- [Security: Pattern Matching](#security-pattern-matching)
- [Security: Event Queries](#security-event-queries)
- [Lifecycle Hooks](#lifecycle-hooks)
- [Configuration Patterns](#configuration-patterns)
- [Error Handling](#error-handling)
- [Complete Plugin Templates](#complete-plugin-templates)

---

## Logging

### Structured log with data

```lua
overlord.log.info("Task completed", {
    taskId = "task-42",
    duration = 1500,
    agent = "agent-7"
})
```

### Log levels

```lua
overlord.log.debug("Cache lookup", { key = "user:42" })   -- Debug only
overlord.log.info("Processing started")                     -- Normal operation
overlord.log.warn("Rate limit approaching", { current = 95, limit = 100 })
overlord.log.error("Connection failed", { endpoint = "api.example.com" })
```

### Log plugin version on load

```lua
registerHook("onLoad", function()
    overlord.log.info(overlord.manifest.name .. " v" .. overlord.manifest.version .. " loaded")
end)
```

---

## Storage Patterns

### Simple key-value

```lua
-- Write
overlord.storage.set("last_run", os.time())

-- Read
local lastRun = overlord.storage.get("last_run")
if lastRun then
    overlord.log.info("Last run: " .. tostring(lastRun))
end
```

### Table storage (config object)

```lua
overlord.storage.set("config", {
    enabled = true,
    threshold = 80,
    whitelist = { "agent-1", "agent-2" }
})

local config = overlord.storage.get("config") or {}
local threshold = config.threshold or 80
```

### Counter pattern

```lua
local function increment(key)
    local count = overlord.storage.get(key) or 0
    count = count + 1
    overlord.storage.set(key, count)
    return count
end

-- Usage
local total = increment("total_events")
```

### Map/dictionary pattern

```lua
local function getMap(key)
    return overlord.storage.get(key) or {}
end

local function setMapEntry(mapKey, entryKey, value)
    local map = getMap(mapKey)
    map[entryKey] = value
    overlord.storage.set(mapKey, map)
end

-- Usage
setMapEntry("room_scores", "room-abc", 42)
local scores = getMap("room_scores")
```

### List all stored data

```lua
local keys = overlord.storage.keys()
for _, key in ipairs(keys) do
    local value = overlord.storage.get(key)
    overlord.log.debug("Storage: " .. key .. " = " .. tostring(value))
end
```

---

## Event Bus

### Emit a simple event

```lua
overlord.bus.emit("task-completed", { taskId = "task-42" })
```

### Emit with rich data

```lua
overlord.bus.emit("phase-report", {
    buildingId = "bld-1",
    phase = "execution",
    agentCount = 5,
    roomCount = 3,
    timestamp = os.time()
})
```

### Emit from a hook

```lua
registerHook("onRoomEnter", function(data)
    overlord.bus.emit("room-activity", {
        action = "enter",
        roomId = data.roomId,
        agentId = data.agentId,
        timestamp = os.time()
    })
end)
```

---

## Room Queries

### List all rooms

```lua
local result = overlord.rooms.list()
if result and result.ok then
    for _, room in ipairs(result.data) do
        overlord.log.info(room.name .. " (" .. room.type .. ")")
    end
end
```

### Get a specific room

```lua
local result = overlord.rooms.get("room-abc-123")
if result and result.ok then
    local room = result.data
    overlord.log.info("Room: " .. room.name .. ", type: " .. room.type)
end
```

### Count rooms by type

```lua
local function countRoomsByType()
    local result = overlord.rooms.list()
    if not result or not result.ok then return {} end

    local counts = {}
    for _, room in ipairs(result.data) do
        counts[room.type] = (counts[room.type] or 0) + 1
    end
    return counts
end
```

---

## Agent Queries

### List active agents

```lua
local result = overlord.agents.list({ status = "active" })
if result and result.ok then
    overlord.log.info("Active agents: " .. #result.data)
    for _, agent in ipairs(result.data) do
        overlord.log.debug("  " .. (agent.display_name or agent.name) .. " - " .. (agent.role or "no role"))
    end
end
```

### Find agents in a room

```lua
local function agentsInRoom(roomId)
    local result = overlord.agents.list({ roomId = roomId })
    if result and result.ok then return result.data end
    return {}
end
```

### Get agent details

```lua
local result = overlord.agents.get("agent-42")
if result and result.ok then
    local agent = result.data
    overlord.log.info("Agent: " .. agent.display_name .. ", role: " .. agent.role)
end
```

---

## Security: Pre-Tool-Use

### Block a specific tool

```lua
registerHook("onPreToolUse", function(context)
    if context.toolName == "shell" then
        return { action = "block", message = "Shell access disabled" }
    end
    return { action = "allow" }
end)
```

### Allowlist-only tools

```lua
local ALLOWED_TOOLS = {
    ["read_file"] = true,
    ["search_files"] = true,
    ["list_directory"] = true,
}

registerHook("onPreToolUse", function(context)
    if not ALLOWED_TOOLS[context.toolName] then
        overlord.security.logEvent({
            type = "tool_allowlist",
            action = "block",
            toolName = context.toolName,
            message = "Tool not in allowlist: " .. context.toolName
        })
        return { action = "block", message = "Only read-only tools are permitted" }
    end
    return { action = "allow" }
end)
```

### Check file paths

```lua
registerHook("onPreToolUse", function(context)
    if context.toolName ~= "write_file" then return { action = "allow" } end

    local path = tostring(context.toolParams.path or "")

    -- Block writes outside project directory
    if string.match(path, "^/") and not string.match(path, "^/workspace/") then
        return { action = "block", message = "Writes outside /workspace/ are blocked" }
    end

    -- Block writes to sensitive files
    if string.match(path, "%.env$") or string.match(path, "%.env%.") then
        return { action = "block", message = "Cannot write to .env files" }
    end

    return { action = "allow" }
end)
```

### Warn on risky but allowed operations

```lua
registerHook("onPreToolUse", function(context)
    if context.toolName ~= "shell" then return { action = "allow" } end

    local cmd = tostring(context.toolParams.command or "")

    if string.match(cmd, "npm%s+install") then
        return { action = "warn", message = "Installing packages — verify these are trusted" }
    end

    if string.match(cmd, "git%s+push") then
        return { action = "warn", message = "Pushing to remote — verify the target branch" }
    end

    return { action = "allow" }
end)
```

---

## Security: Post-Tool-Use

### Audit all tool executions

```lua
registerHook("onPostToolUse", function(context)
    overlord.security.logEvent({
        type = "audit",
        action = context.success and "allow" or "warn",
        toolName = context.toolName or "",
        agentId = context.agentId or "",
        roomId = context.roomId or "",
        message = (context.success and "OK" or "FAILED") .. ": " .. (context.toolName or "unknown")
    })
    return { action = "allow" }
end)
```

### Flag failed tool executions

```lua
registerHook("onPostToolUse", function(context)
    if not context.success then
        overlord.security.logEvent({
            type = "tool_failure",
            action = "warn",
            toolName = context.toolName or "",
            agentId = context.agentId or "",
            message = "Tool failed: " .. (context.toolName or "unknown")
        })
        return { action = "warn", message = "Tool execution failed — review output" }
    end
    return { action = "allow" }
end)
```

---

## Security: Pattern Matching

### JavaScript regex via matchPattern

```lua
-- Note: uses JS regex, not Lua patterns
local hasCurl = overlord.security.matchPattern(cmd, "curl\\s+https?://")
local hasToken = overlord.security.matchPattern(text, "Bearer\\s+[A-Za-z0-9._-]+")
```

### Multiple patterns via matchAny

```lua
local secretTypes = {
    "sk_live_[a-zA-Z0-9]+",
    "ghp_[a-zA-Z0-9]+",
    "AKIA[0-9A-Z]+",
}

local found = overlord.security.matchAny(output, secretTypes)
if found then
    overlord.log.warn("Secret pattern found: " .. found)
end
```

### Redact sensitive data

```lua
local cleaned = overlord.security.redact(rawOutput, {
    "sk_live_[a-zA-Z0-9]+",
    "password=[^&\\s]+",
    "token=[^&\\s]+"
})
```

---

## Security: Event Queries

### Get recent blocked events

```lua
local blocked = overlord.security.getEvents({ action = "block", limit = 10 })
for _, event in ipairs(blocked) do
    overlord.log.info("Blocked: " .. event.message .. " at " .. tostring(event.timestamp))
end
```

### Get events by type

```lua
local shellEvents = overlord.security.getEvents({ type = "shell_guard" })
overlord.log.info("Shell guard events: " .. #shellEvents)
```

### Security dashboard stats

```lua
local stats = overlord.security.getStats()
if stats then
    overlord.log.info(string.format(
        "Security: %d total (%d blocked, %d warned, %d allowed)",
        stats.total, stats.blocked, stats.warned, stats.allowed
    ))
end
```

---

## Lifecycle Hooks

### Track time in rooms

```lua
registerHook("onRoomEnter", function(data)
    overlord.storage.set("enter_" .. data.roomId, os.time())
end)

registerHook("onRoomExit", function(data)
    local enterTime = overlord.storage.get("enter_" .. data.roomId)
    if enterTime then
        local elapsed = os.time() - enterTime
        overlord.log.info("Time in room: " .. math.floor(elapsed / 60) .. " minutes", {
            roomId = data.roomId
        })
        overlord.storage.delete("enter_" .. data.roomId)
    end
end)
```

### React to phase advances

```lua
registerHook("onPhaseAdvance", function(data)
    overlord.log.info("Phase: " .. data.fromPhase .. " -> " .. data.toPhase)
    overlord.bus.emit("phase-changed", {
        from = data.fromPhase,
        to = data.toPhase,
        building = data.buildingId,
        timestamp = os.time()
    })
end)
```

### React to building creation

```lua
registerHook("onBuildingCreate", function(data)
    overlord.log.info("New building: " .. (data.name or "unnamed"), {
        buildingId = data.buildingId
    })

    -- Initialize default settings for new buildings
    overlord.storage.set("building_" .. data.buildingId, {
        created = os.time(),
        securityLevel = "standard"
    })
end)
```

---

## Configuration Patterns

### Config with defaults

```lua
local function getConfig(key, default)
    local value = overlord.storage.get(key)
    if value == nil then return default end
    return value
end

-- Usage
local enabled = getConfig("enabled", true)
local threshold = getConfig("threshold", 80)
local patterns = getConfig("patterns", {})
```

### Feature flags

```lua
local function isFeatureEnabled(feature)
    local flags = overlord.storage.get("feature_flags") or {}
    return flags[feature] == true
end

registerHook("onPreToolUse", function(context)
    if not isFeatureEnabled("shell_guard") then
        return { action = "allow" }
    end
    -- ... guard logic
end)
```

---

## Error Handling

### Safe room lookup

```lua
local function safeGetRoom(roomId)
    local success, result = pcall(overlord.rooms.get, roomId)
    if success and result and result.ok then
        return result.data
    end
    return nil
end
```

### Safe hook with full error handling

```lua
registerHook("onToolExecute", function(data)
    local success, err = pcall(function()
        -- Your logic here
        if data.roomId then
            local room = safeGetRoom(data.roomId)
            if room then
                overlord.log.info("Tool used in " .. room.name)
            end
        end
    end)

    if not success then
        overlord.log.error("Hook error: " .. tostring(err))
    end
end)
```

### Nil-safe string building

```lua
local function safeStr(value)
    if value == nil then return "unknown" end
    return tostring(value)
end

-- Usage
overlord.log.info("Agent " .. safeStr(data.agentId) .. " in room " .. safeStr(data.roomId))
```

---

## Complete Plugin Templates

### Minimal plugin

```json
{
  "id": "my-plugin",
  "name": "My Plugin",
  "version": "1.0.0",
  "description": "Does something useful",
  "engine": "lua",
  "entrypoint": "main.lua",
  "permissions": []
}
```

```lua
registerHook("onLoad", function()
    overlord.log.info(overlord.manifest.name .. " loaded")
end)
```

### Security hook plugin template

```json
{
  "id": "my-guard",
  "name": "My Guard",
  "version": "1.0.0",
  "description": "Custom security rules",
  "engine": "lua",
  "entrypoint": "main.lua",
  "permissions": ["security:read", "security:write"]
}
```

```lua
local RULES = {
    -- Add your rules here
    { pattern = "dangerous_pattern", action = "block", message = "Blocked for safety" },
}

registerHook("onPreToolUse", function(context)
    local content = tostring(context.toolParams.command or context.toolParams.content or "")

    for _, rule in ipairs(RULES) do
        if string.match(content, rule.pattern) then
            overlord.security.logEvent({
                type = overlord.manifest.id,
                action = rule.action,
                toolName = context.toolName,
                agentId = context.agentId or "",
                message = rule.message
            })
            return { action = rule.action, message = rule.message }
        end
    end

    return { action = "allow" }
end)

overlord.log.info(overlord.manifest.name .. " loaded — " .. #RULES .. " rules active")
```

### Full-featured plugin template

```json
{
  "id": "my-full-plugin",
  "name": "My Full Plugin",
  "version": "1.0.0",
  "description": "A full-featured plugin with storage, events, and hooks",
  "engine": "lua",
  "entrypoint": "main.lua",
  "permissions": ["room:read", "agent:read", "storage:read", "storage:write", "bus:emit"]
}
```

```lua
-- Configuration
local function getConfig(key, default)
    local value = overlord.storage.get(key)
    if value == nil then return default end
    return value
end

-- State management
local function loadState()
    return overlord.storage.get("state") or {}
end

local function saveState(state)
    overlord.storage.set("state", state)
end

-- Core logic
local function processEvent(data)
    local state = loadState()
    -- ... your logic here
    saveState(state)
end

-- Hooks
registerHook("onLoad", function()
    local enabled = getConfig("enabled", true)
    overlord.log.info(overlord.manifest.name .. " loaded", { enabled = enabled })
end)

registerHook("onRoomEnter", function(data)
    if not getConfig("enabled", true) then return end

    local ok, err = pcall(processEvent, data)
    if not ok then
        overlord.log.error("Processing failed: " .. tostring(err))
    end
end)

registerHook("onToolExecute", function(data)
    if not getConfig("enabled", true) then return end

    local ok, err = pcall(processEvent, data)
    if not ok then
        overlord.log.error("Processing failed: " .. tostring(err))
    end
end)
```
