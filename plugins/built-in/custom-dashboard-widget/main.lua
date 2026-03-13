-- =============================================================================
-- Custom Dashboard Widget — Overlord Plugin
-- =============================================================================
-- This plugin registers a custom widget on the Overlord dashboard and keeps it
-- updated with live data (agent counts, active rooms, recent activity).
--
-- HOW IT WORKS:
--   1. On load, it reads widget configuration from plugin storage (or uses
--      sensible defaults) and emits a "widget:register" event so the frontend
--      knows to render the widget.
--   2. Whenever an agent enters or exits a room, or a phase advances, the
--      plugin gathers fresh data and emits a "widget:update" event.
--   3. You can customise the widget title, type, and refresh interval by
--      changing values in plugin storage.
--
-- CUSTOMISATION:
--   overlord.storage.set("widget_title",    "My Custom Widget")
--   overlord.storage.set("widget_type",     "stats")       -- stats | list | chart
--   overlord.storage.set("refresh_seconds", "30")          -- auto-refresh interval
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Helper: safely read a storage key with a fallback default
-- ---------------------------------------------------------------------------
local function storageGet(key, default)
    local ok, value = pcall(overlord.storage.get, key)
    if ok and value ~= nil then
        return value
    end
    return default
end

-- ---------------------------------------------------------------------------
-- Helper: build the live data snapshot that the widget displays
-- ---------------------------------------------------------------------------
local function buildWidgetData()
    -- Gather room information
    local rooms = {}
    local activeRoomCount = 0
    local ok_rooms, roomList = pcall(overlord.rooms.list)
    if ok_rooms and roomList then
        for _, room in ipairs(roomList) do
            table.insert(rooms, {
                id   = room.id,
                name = room.name,
                type = room.type
            })
            activeRoomCount = activeRoomCount + 1
        end
    end

    -- Gather agent information
    local agents = {}
    local agentsByStatus = { active = 0, idle = 0, busy = 0 }
    local ok_agents, agentList = pcall(overlord.agents.list, {})
    if ok_agents and agentList then
        for _, agent in ipairs(agentList) do
            table.insert(agents, {
                id     = agent.id,
                name   = agent.name,
                role   = agent.role,
                status = agent.status
            })
            local status = agent.status or "idle"
            agentsByStatus[status] = (agentsByStatus[status] or 0) + 1
        end
    end

    -- Record this refresh as "recent activity"
    local timestamp = os.date("!%Y-%m-%dT%H:%M:%SZ")
    local ok_store, _ = pcall(overlord.storage.set, "last_refresh", timestamp)
    if not ok_store then
        overlord.log.warn("Could not persist last_refresh timestamp")
    end

    return {
        agentCount      = #agents,
        agentsByStatus  = agentsByStatus,
        activeRoomCount = activeRoomCount,
        rooms           = rooms,
        lastRefresh     = timestamp
    }
end

-- ---------------------------------------------------------------------------
-- Helper: emit a widget:update event with the latest data
-- ---------------------------------------------------------------------------
local function emitWidgetUpdate()
    local ok, data = pcall(buildWidgetData)
    if not ok then
        overlord.log.error("Failed to build widget data", { error = tostring(data) })
        return
    end

    local ok_emit, emitErr = pcall(overlord.bus.emit, "widget:update", {
        widgetId = overlord.manifest.id,
        data     = data
    })
    if not ok_emit then
        overlord.log.error("Failed to emit widget:update", { error = tostring(emitErr) })
    else
        overlord.log.debug("Widget data updated", { agentCount = data.agentCount, rooms = data.activeRoomCount })
    end
end

-- =============================================================================
-- Lifecycle Hooks
-- =============================================================================

-- ---------------------------------------------------------------------------
-- onLoad — Register the widget with the frontend
-- ---------------------------------------------------------------------------
registerHook("onLoad", function()
    overlord.log.info("Custom Dashboard Widget loading", {
        pluginId = overlord.manifest.id,
        version  = overlord.manifest.version
    })

    -- Read user-customisable settings (or use defaults)
    local title          = storageGet("widget_title",    "Dashboard Overview")
    local widgetType     = storageGet("widget_type",     "stats")
    local refreshSeconds = tonumber(storageGet("refresh_seconds", "30")) or 30

    -- Tell the frontend to create the widget
    local ok, err = pcall(overlord.bus.emit, "widget:register", {
        widgetId        = overlord.manifest.id,
        title           = title,
        type            = widgetType,
        refreshInterval = refreshSeconds
    })

    if not ok then
        overlord.log.error("Failed to register widget", { error = tostring(err) })
        return
    end

    overlord.log.info("Widget registered", {
        title           = title,
        type            = widgetType,
        refreshInterval = refreshSeconds
    })

    -- Send the first data payload immediately so the widget is not empty
    emitWidgetUpdate()
end)

-- ---------------------------------------------------------------------------
-- onUnload — Deregister the widget so the frontend removes it
-- ---------------------------------------------------------------------------
registerHook("onUnload", function()
    local ok, err = pcall(overlord.bus.emit, "widget:deregister", {
        widgetId = overlord.manifest.id
    })
    if not ok then
        overlord.log.warn("Failed to deregister widget on unload", { error = tostring(err) })
    end
    overlord.log.info("Custom Dashboard Widget unloaded")
end)

-- ---------------------------------------------------------------------------
-- onRoomEnter — An agent entered a room; refresh the widget
-- ---------------------------------------------------------------------------
registerHook("onRoomEnter", function(context)
    overlord.log.debug("Room entered — refreshing widget", {
        roomId  = context and context.roomId,
        agentId = context and context.agentId
    })
    emitWidgetUpdate()
end)

-- ---------------------------------------------------------------------------
-- onRoomExit — An agent left a room; refresh the widget
-- ---------------------------------------------------------------------------
registerHook("onRoomExit", function(context)
    overlord.log.debug("Room exited — refreshing widget", {
        roomId  = context and context.roomId,
        agentId = context and context.agentId
    })
    emitWidgetUpdate()
end)

-- ---------------------------------------------------------------------------
-- onPhaseAdvance — A project phase changed; refresh the widget
-- ---------------------------------------------------------------------------
registerHook("onPhaseAdvance", function(context)
    overlord.log.debug("Phase advanced — refreshing widget", {
        phase = context and context.phase
    })
    emitWidgetUpdate()
end)
