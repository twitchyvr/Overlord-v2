-- =============================================================================
-- Room Timer Plugin
-- =============================================================================
-- Time-boxes room sessions so that work stays focused and on-schedule. When an
-- agent enters a room, a timer starts. On subsequent activity in that room the
-- plugin checks elapsed time and emits warning/expiry events as thresholds are
-- crossed.
--
-- Because Lua plugins in Overlord are event-driven (not continuously running),
-- the timer is implemented by recording the start timestamp and comparing it
-- against the current time every time a relevant hook fires. This means the
-- warning and expiry events are evaluated on room entry, tool execution, and
-- phase advance -- any activity that happens inside the room.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Configuration defaults
-- ---------------------------------------------------------------------------
--   timer_enabled        (boolean)  Master on/off switch. Default: true
--   default_minutes      (number)   Default session length in minutes.
--                                   Default: 30
--   warning_percent      (number)   Percentage of time elapsed at which the
--                                   warning fires (e.g., 80 means warn at
--                                   80% of the limit). Default: 80
--   room_overrides       (table)    Optional per-room-type overrides.
--                                   Example: { ["code-lab"] = 60 }
--                                   Values are in minutes.
-- ---------------------------------------------------------------------------

--- Read a config value from storage with a fallback default.
-- @param key      string  Storage key.
-- @param default  any     Fallback value.
-- @return any
local function getConfig(key, default)
    local value = overlord.storage.get(key)
    if value == nil then
        return default
    end
    return value
end

-- ---------------------------------------------------------------------------
-- Timer state management
-- ---------------------------------------------------------------------------
-- We store a table keyed by room ID:
--   timers[roomId] = {
--       startTime    = <epoch seconds>,
--       limitMinutes = <number>,
--       warningSent  = <boolean>,
--       expirySent   = <boolean>,
--   }
-- ---------------------------------------------------------------------------

--- Load all active timers from storage.
-- @return table  Map of roomId -> timer record.
local function loadTimers()
    local raw = overlord.storage.get("room_timers")
    if raw == nil then
        return {}
    end
    return raw
end

--- Persist the timers table back to storage.
-- @param timers  table  The timers map to save.
local function saveTimers(timers)
    overlord.storage.set("room_timers", timers)
end

--- Determine the time limit (in minutes) for a given room.
-- Checks per-room-type overrides first, then falls back to the default.
-- @param room  table  The room object with at least a `type` field.
-- @return number      The limit in minutes.
local function getLimitForRoom(room)
    local overrides = getConfig("room_overrides", {})
    if room.type and overrides[room.type] then
        return overrides[room.type]
    end
    return getConfig("default_minutes", 30)
end

-- ---------------------------------------------------------------------------
-- Timer evaluation
-- ---------------------------------------------------------------------------

--- Evaluate the timer for a specific room and emit events if thresholds are
--- crossed.
-- @param roomId  string  The room being checked.
local function evaluateTimer(roomId)
    local enabled = getConfig("timer_enabled", true)
    if not enabled then
        return
    end

    local timers = loadTimers()
    local timer = timers[roomId]

    -- No timer exists for this room (agent hasn't entered it via our hook).
    if timer == nil then
        overlord.log.debug("No timer found for room; skipping.", {
            roomId = roomId,
        })
        return
    end

    local now = os.time()
    local elapsedSeconds = now - timer.startTime
    local limitSeconds = timer.limitMinutes * 60
    local elapsedPercent = (elapsedSeconds / limitSeconds) * 100
    local warningThreshold = getConfig("warning_percent", 80)

    -- Fetch room details for richer event payloads.
    local ok, room = pcall(overlord.rooms.get, roomId)
    local roomName = (ok and room and room.name) or roomId
    local roomType = (ok and room and room.type) or "unknown"

    -- Calculate remaining time for human-friendly messages.
    local remainingSeconds = limitSeconds - elapsedSeconds
    local remainingMinutes = math.max(0, math.floor(remainingSeconds / 60))

    -- Check: has the timer fully expired?
    if elapsedSeconds >= limitSeconds and not timer.expirySent then
        overlord.log.warn("Room timer expired.", {
            roomId = roomId,
            roomName = roomName,
            limitMinutes = timer.limitMinutes,
            elapsedMinutes = math.floor(elapsedSeconds / 60),
        })

        overlord.bus.emit("room:timer-expired", {
            roomId = roomId,
            roomName = roomName,
            roomType = roomType,
            limitMinutes = timer.limitMinutes,
            elapsedMinutes = math.floor(elapsedSeconds / 60),
            overtimeMinutes = math.floor((elapsedSeconds - limitSeconds) / 60),
            triggeredBy = overlord.manifest.id,
            timestamp = now,
        })

        timer.expirySent = true
        timers[roomId] = timer
        saveTimers(timers)
        return
    end

    -- Check: should we send a warning?
    if elapsedPercent >= warningThreshold and not timer.warningSent then
        overlord.log.info("Room timer warning threshold reached.", {
            roomId = roomId,
            roomName = roomName,
            warningPercent = warningThreshold,
            remainingMinutes = remainingMinutes,
        })

        overlord.bus.emit("room:timer-warning", {
            roomId = roomId,
            roomName = roomName,
            roomType = roomType,
            limitMinutes = timer.limitMinutes,
            elapsedMinutes = math.floor(elapsedSeconds / 60),
            remainingMinutes = remainingMinutes,
            percentElapsed = math.floor(elapsedPercent),
            triggeredBy = overlord.manifest.id,
            timestamp = now,
        })

        timer.warningSent = true
        timers[roomId] = timer
        saveTimers(timers)
    end
end

-- ---------------------------------------------------------------------------
-- Timer lifecycle: start and stop
-- ---------------------------------------------------------------------------

--- Start (or restart) the timer for a room.
-- @param roomId  string  The room to start timing.
-- @param room    table   The room object (used to determine the limit).
local function startTimer(roomId, room)
    local timers = loadTimers()
    local limitMinutes = getLimitForRoom(room)

    timers[roomId] = {
        startTime = os.time(),
        limitMinutes = limitMinutes,
        warningSent = false,
        expirySent = false,
    }
    saveTimers(timers)

    overlord.log.info("Room timer started.", {
        roomId = roomId,
        roomName = room.name or roomId,
        limitMinutes = limitMinutes,
    })
end

--- Stop and remove the timer for a room.
-- @param roomId  string  The room whose timer should be cleared.
local function stopTimer(roomId)
    local timers = loadTimers()
    local timer = timers[roomId]

    if timer then
        local elapsed = os.time() - timer.startTime
        overlord.log.info("Room timer stopped.", {
            roomId = roomId,
            elapsedMinutes = math.floor(elapsed / 60),
            limitMinutes = timer.limitMinutes,
        })
    end

    timers[roomId] = nil
    saveTimers(timers)
end

-- ---------------------------------------------------------------------------
-- Lifecycle hooks
-- ---------------------------------------------------------------------------

registerHook("onLoad", function()
    overlord.log.info("Room Timer plugin loaded.", {
        version = overlord.manifest.version,
        defaultMinutes = getConfig("default_minutes", 30),
        warningPercent = getConfig("warning_percent", 80),
        enabled = getConfig("timer_enabled", true),
    })
end)

registerHook("onUnload", function()
    overlord.log.info("Room Timer plugin unloaded.")
end)

-- onRoomEnter: Start a fresh timer whenever an agent enters a room.
-- If a timer already exists for this room (another agent entered earlier),
-- we leave it running -- the first entry sets the clock.
registerHook("onRoomEnter", function(data)
    if data.roomId == nil then
        return
    end

    local enabled = getConfig("timer_enabled", true)
    if not enabled then
        return
    end

    -- Only start if there is no existing timer for this room.
    local timers = loadTimers()
    if timers[data.roomId] then
        overlord.log.debug("Timer already running for room; not restarting.", {
            roomId = data.roomId,
        })
        -- Still evaluate in case thresholds were crossed while idle.
        local ok, err = pcall(evaluateTimer, data.roomId)
        if not ok then
            overlord.log.error("Error evaluating timer on room enter.", {
                error = tostring(err),
            })
        end
        return
    end

    -- Fetch room details to determine the appropriate time limit.
    local ok, room = pcall(overlord.rooms.get, data.roomId)
    if not ok or room == nil then
        overlord.log.warn("Could not fetch room details; using defaults.", {
            roomId = data.roomId,
        })
        room = { id = data.roomId, name = data.roomId, type = "unknown" }
    end

    startTimer(data.roomId, room)
end)

-- onRoomExit: Stop the timer when the last agent leaves the room.
-- For simplicity, we stop on any exit. If you want to keep the timer running
-- until ALL agents leave, you could count active agents instead.
registerHook("onRoomExit", function(data)
    if data.roomId == nil then
        return
    end
    stopTimer(data.roomId)
end)

-- onToolExecute: Every tool execution is an opportunity to check the clock.
-- This is how warnings and expiry events get surfaced -- they piggyback on
-- real activity rather than requiring a background polling thread.
registerHook("onToolExecute", function(data)
    if data.roomId == nil then
        return
    end

    local ok, err = pcall(evaluateTimer, data.roomId)
    if not ok then
        overlord.log.error("Error evaluating room timer on tool execute.", {
            roomId = data.roomId,
            error = tostring(err),
        })
    end
end)

-- onPhaseAdvance: Also check the timer when a phase advances, since this is
-- a significant event that may happen without a tool execution.
registerHook("onPhaseAdvance", function(data)
    if data.roomId == nil then
        return
    end

    local ok, err = pcall(evaluateTimer, data.roomId)
    if not ok then
        overlord.log.error("Error evaluating room timer on phase advance.", {
            roomId = data.roomId,
            error = tostring(err),
        })
    end
end)
