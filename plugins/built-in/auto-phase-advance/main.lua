-- =============================================================================
-- Auto Phase Advance Plugin
-- =============================================================================
-- Monitors tool executions within rooms and checks whether the current room's
-- exit criteria have been satisfied. When all criteria are met, this plugin
-- emits a "phase:advance-request" event so the system (or another plugin) can
-- promote the workflow to the next phase automatically.
--
-- This is useful for hands-free workflows where you want phases to move forward
-- the moment all required deliverables are in place, without waiting for a
-- human to click "advance."
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Configuration defaults
-- ---------------------------------------------------------------------------
-- You can override these by writing to plugin storage before the plugin loads,
-- or at runtime via the Overlord storage API.
--
--   auto_advance_enabled  (boolean)  Master on/off switch. Default: true
--   cooldown_seconds      (number)   Minimum seconds between advance requests
--                                    for the same room, preventing rapid-fire
--                                    events. Default: 10
-- ---------------------------------------------------------------------------

--- Read a config value from storage, returning `default` when the key is nil.
-- @param key      string   The storage key to look up.
-- @param default  any      Value returned when the key does not exist.
-- @return any
local function getConfig(key, default)
    local value = overlord.storage.get(key)
    if value == nil then
        return default
    end
    return value
end

-- ---------------------------------------------------------------------------
-- Internal state
-- ---------------------------------------------------------------------------
-- Track which rooms have already been marked "completed" so we do not spam
-- repeated advance requests for the same room.
-- We persist this in storage so it survives plugin reloads.
-- ---------------------------------------------------------------------------

--- Load the set of rooms that have already been advanced.
-- @return table  A set (room_id -> true) of completed rooms.
local function loadCompletedRooms()
    local raw = overlord.storage.get("completed_rooms")
    if raw == nil then
        return {}
    end
    return raw
end

--- Persist the completed-rooms set to storage.
-- @param completed  table  The set to save.
local function saveCompletedRooms(completed)
    overlord.storage.set("completed_rooms", completed)
end

--- Load the timestamp of the last advance request per room.
-- @return table  A map of room_id -> epoch timestamp.
local function loadLastAdvanceTimes()
    local raw = overlord.storage.get("last_advance_times")
    if raw == nil then
        return {}
    end
    return raw
end

--- Save the last-advance-times map.
-- @param times  table  The map to save.
local function saveLastAdvanceTimes(times)
    overlord.storage.set("last_advance_times", times)
end

-- ---------------------------------------------------------------------------
-- Exit-criteria checking
-- ---------------------------------------------------------------------------
-- Each room type in Overlord has different exit criteria. This function
-- inspects the room object and determines whether the criteria are met.
--
-- Room objects returned by overlord.rooms.get() contain:
--   id, name, type, phase, exitCriteria (table of {criterion, met} pairs)
--
-- We consider a room "complete" when every item in exitCriteria has met=true.
-- ---------------------------------------------------------------------------

--- Check whether all exit criteria for a room are satisfied.
-- @param room  table  The room object from overlord.rooms.get().
-- @return boolean      True if every criterion is met (or if there are none).
-- @return string|nil   A human-readable reason if not all criteria are met.
local function allExitCriteriaMet(room)
    -- Guard: if the room has no exit criteria, treat it as satisfied.
    if room.exitCriteria == nil or #room.exitCriteria == 0 then
        overlord.log.debug("Room has no exit criteria; treating as met.", {
            roomId = room.id,
        })
        return true, nil
    end

    -- Walk through each criterion and check its "met" flag.
    local unmet = {}
    for _, criterion in ipairs(room.exitCriteria) do
        if not criterion.met then
            table.insert(unmet, criterion.criterion or "unnamed criterion")
        end
    end

    if #unmet == 0 then
        return true, nil
    end

    local reason = "Unmet criteria: " .. table.concat(unmet, ", ")
    return false, reason
end

-- ---------------------------------------------------------------------------
-- Cooldown guard
-- ---------------------------------------------------------------------------

--- Check whether enough time has passed since the last advance request for
--- this room.
-- @param roomId           string  The room's unique identifier.
-- @param cooldownSeconds  number  Required seconds between requests.
-- @return boolean                 True if the cooldown has elapsed.
local function cooldownElapsed(roomId, cooldownSeconds)
    local times = loadLastAdvanceTimes()
    local last = times[roomId]
    if last == nil then
        return true
    end
    local now = os.time()
    return (now - last) >= cooldownSeconds
end

--- Record that an advance request was just made for a room.
-- @param roomId  string  The room's unique identifier.
local function recordAdvanceTime(roomId)
    local times = loadLastAdvanceTimes()
    times[roomId] = os.time()
    saveLastAdvanceTimes(times)
end

-- ---------------------------------------------------------------------------
-- Core logic: evaluate a room after a tool execution
-- ---------------------------------------------------------------------------

--- Evaluate whether the room that just had a tool executed should advance.
-- Called from the onToolExecute hook.
-- @param data  table  The hook payload (contains roomId, toolName, result, etc.)
local function evaluateRoomAfterToolExec(data)
    -- Read configuration
    local enabled = getConfig("auto_advance_enabled", true)
    if not enabled then
        overlord.log.debug("Auto-phase-advance is disabled via config.")
        return
    end

    local cooldownSec = getConfig("cooldown_seconds", 10)

    -- Determine which room the tool was executed in.
    local roomId = data.roomId
    if roomId == nil then
        overlord.log.warn("onToolExecute payload missing roomId; skipping.", data)
        return
    end

    -- Skip rooms that have already been advanced by this plugin.
    local completed = loadCompletedRooms()
    if completed[roomId] then
        overlord.log.debug("Room already marked completed; skipping.", {
            roomId = roomId,
        })
        return
    end

    -- Fetch the full room object so we can inspect exit criteria.
    local ok, room = pcall(overlord.rooms.get, roomId)
    if not ok or room == nil then
        overlord.log.error("Failed to fetch room for exit-criteria check.", {
            roomId = roomId,
            error = tostring(room),
        })
        return
    end

    -- Check exit criteria.
    local met, reason = allExitCriteriaMet(room)
    if not met then
        overlord.log.debug("Exit criteria not yet met.", {
            roomId = roomId,
            reason = reason,
        })
        return
    end

    -- Respect cooldown to avoid duplicate rapid-fire events.
    if not cooldownElapsed(roomId, cooldownSec) then
        overlord.log.debug("Cooldown active; suppressing duplicate advance request.", {
            roomId = roomId,
        })
        return
    end

    -- All criteria met -- emit the advance request.
    overlord.log.info("All exit criteria met. Emitting phase:advance-request.", {
        roomId = roomId,
        roomName = room.name,
        roomType = room.type,
    })

    overlord.bus.emit("phase:advance-request", {
        roomId = roomId,
        roomName = room.name,
        roomType = room.type,
        triggeredBy = overlord.manifest.id,
        timestamp = os.time(),
    })

    -- Mark the room as completed and record the advance time.
    completed[roomId] = true
    saveCompletedRooms(completed)
    recordAdvanceTime(roomId)
end

-- ---------------------------------------------------------------------------
-- Lifecycle hooks
-- ---------------------------------------------------------------------------

-- onLoad: runs once when the plugin is first activated.
registerHook("onLoad", function()
    overlord.log.info("Auto Phase Advance plugin loaded.", {
        version = overlord.manifest.version,
        enabled = getConfig("auto_advance_enabled", true),
        cooldown = getConfig("cooldown_seconds", 10),
    })
end)

-- onUnload: runs when the plugin is deactivated or the system shuts down.
registerHook("onUnload", function()
    overlord.log.info("Auto Phase Advance plugin unloaded.")
end)

-- onToolExecute: fires after every tool execution inside a room.
-- This is the primary trigger -- we check exit criteria each time a tool
-- finishes, because tool completions are the actions most likely to satisfy
-- outstanding criteria.
registerHook("onToolExecute", function(data)
    local ok, err = pcall(evaluateRoomAfterToolExec, data)
    if not ok then
        overlord.log.error("Error in auto-phase-advance onToolExecute handler.", {
            error = tostring(err),
        })
    end
end)

-- onRoomEnter: when an agent enters a room, reset that room's "completed"
-- flag so it can be re-evaluated. This handles the case where a room is
-- re-entered after being previously advanced.
registerHook("onRoomEnter", function(data)
    if data.roomId == nil then
        return
    end

    local completed = loadCompletedRooms()
    if completed[data.roomId] then
        overlord.log.info("Room re-entered; clearing completed flag.", {
            roomId = data.roomId,
        })
        completed[data.roomId] = nil
        saveCompletedRooms(completed)
    end
end)
