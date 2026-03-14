-- ============================================================================
-- Time Estimator — Overlord Built-In Plugin
-- ============================================================================
-- Estimates how much time remains in the project by tracking task completion
-- velocity. Every time work is completed (a room exit occurs), the plugin
-- records a data point. Over time, it builds a picture of how fast the team
-- works and uses that velocity to project when remaining work will finish.
--
-- Velocity is expressed as "room exits per day" — each room exit represents
-- a completed unit of work.
--
-- Events emitted:
--   estimate:updated   — fired when a new estimate is calculated
--
-- Storage keys used:
--   estimate:completions — array of completion timestamps
--   estimate:snapshot    — latest estimate calculation
--   estimate:config      — user configuration overrides
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Default configuration
-- ---------------------------------------------------------------------------
local DEFAULT_CONFIG = {
    -- Number of recent completions to use when calculating velocity.
    -- A larger window smooths out spikes; a smaller window reacts faster
    -- to changes in pace.
    velocity_window = 20,

    -- Minimum completions needed before the plugin will produce an estimate.
    -- With fewer data points, the estimate would be unreliable.
    min_data_points = 3,

    -- The total number of rooms expected in the project. If set to 0,
    -- the plugin will use the current room count as the total and estimate
    -- remaining based on how many have been exited.
    total_planned_rooms = 0,

    -- Recalculate estimate on every room exit
    recalc_on_room_exit = true,

    -- Recalculate on phase advance
    recalc_on_phase_advance = true,

    -- Maximum completions to store (older entries are discarded)
    max_completions = 500,
}

-- ---------------------------------------------------------------------------
-- Helper: load config with defaults
-- ---------------------------------------------------------------------------
local function load_config()
    local ok, stored = pcall(overlord.storage.get, "estimate:config")
    if ok and type(stored) == "table" then
        local merged = {}
        for k, v in pairs(DEFAULT_CONFIG) do merged[k] = v end
        for k, v in pairs(stored) do merged[k] = v end
        return merged
    end
    return DEFAULT_CONFIG
end

-- ---------------------------------------------------------------------------
-- Helper: load completion timestamps from storage
-- ---------------------------------------------------------------------------
local function load_completions()
    local ok, data = pcall(overlord.storage.get, "estimate:completions")
    if ok and type(data) == "table" then
        return data
    end
    return {}
end

-- ---------------------------------------------------------------------------
-- Helper: save completion timestamps to storage
-- ---------------------------------------------------------------------------
local function save_completions(completions)
    local config = load_config()

    -- Trim to max
    while #completions > config.max_completions do
        table.remove(completions, 1)
    end

    local ok, err = pcall(overlord.storage.set, "estimate:completions", completions)
    if not ok then
        overlord.log.error("Failed to save completions", { error = tostring(err) })
    end
end

-- ---------------------------------------------------------------------------
-- Record a completion event (a room exit = one unit of work done)
-- ---------------------------------------------------------------------------
local function record_completion(room_id, room_type)
    local completions = load_completions()

    table.insert(completions, {
        timestamp  = os.time(),
        date       = os.date("%Y-%m-%d %H:%M:%S"),
        room_id    = room_id or "unknown",
        room_type  = room_type or "unknown",
    })

    save_completions(completions)

    overlord.log.debug("Completion recorded", {
        total = #completions,
        room  = room_id,
    })
end

-- ---------------------------------------------------------------------------
-- Calculate velocity: completions per day over the recent window
--
-- Takes the most recent N completions (where N = velocity_window),
-- calculates the time span between the oldest and newest, and divides
-- to get a rate.
-- ---------------------------------------------------------------------------
local function calculate_velocity()
    local config = load_config()
    local completions = load_completions()

    -- Not enough data
    if #completions < config.min_data_points then
        return nil, "Not enough data points (" .. #completions ..
                    " of " .. config.min_data_points .. " needed)"
    end

    -- Take the most recent window of completions
    local window_size = math.min(config.velocity_window, #completions)
    local window_start = #completions - window_size + 1

    local oldest_ts = completions[window_start].timestamp
    local newest_ts = completions[#completions].timestamp

    -- Time span in days
    local span_seconds = newest_ts - oldest_ts
    local span_days = span_seconds / 86400  -- 86400 seconds per day

    -- Avoid division by zero: if all completions happened in the same second,
    -- we cannot compute a meaningful velocity
    if span_days < 0.01 then
        -- All completions happened almost simultaneously. Use 1 day as minimum.
        span_days = 1
    end

    -- Velocity = completions in the window / days in the window
    -- We subtract 1 because we need intervals, not points
    -- (e.g., 5 completions over 4 intervals)
    local velocity = (window_size - 1) / span_days

    return velocity, nil
end

-- ---------------------------------------------------------------------------
-- Core: estimate remaining time
-- ---------------------------------------------------------------------------
local function estimate_remaining(trigger)
    local config = load_config()

    overlord.log.info("Calculating time estimate", { trigger = trigger or "manual" })

    -- Calculate velocity
    local velocity, vel_err = calculate_velocity()

    if not velocity then
        overlord.log.info("Cannot estimate yet", { reason = vel_err })

        -- Still emit an event so listeners know there is no estimate
        local emit_ok, emit_err = pcall(overlord.bus.emit, "estimate:updated", {
            status    = "insufficient_data",
            reason    = vel_err,
            timestamp = os.date("%Y-%m-%d %H:%M:%S"),
        })
        if not emit_ok then
            overlord.log.error("Failed to emit estimate:updated", {
                error = tostring(emit_err),
            })
        end

        return nil
    end

    -- Determine total planned work and completed work
    local completions = load_completions()
    local completed_count = #completions

    local total_planned = config.total_planned_rooms
    if total_planned <= 0 then
        -- Use current room count as an approximation of total work
        local rooms_ok, rooms = pcall(overlord.rooms.list)
        if rooms_ok and type(rooms) == "table" then
            total_planned = #rooms
        else
            total_planned = completed_count  -- fallback: assume we are done
        end
    end

    -- Remaining work
    local remaining = total_planned - completed_count
    if remaining < 0 then remaining = 0 end

    -- Estimated days remaining
    local days_remaining = 0
    if velocity > 0 and remaining > 0 then
        days_remaining = remaining / velocity
    end

    -- Round to one decimal place
    days_remaining = math.floor(days_remaining * 10 + 0.5) / 10
    local velocity_rounded = math.floor(velocity * 100 + 0.5) / 100

    -- Estimated completion date
    local est_completion_ts = os.time() + (days_remaining * 86400)
    local est_completion_date = os.date("%Y-%m-%d", est_completion_ts)

    -- Build the snapshot
    local snapshot = {
        velocity           = velocity_rounded,
        velocity_unit      = "completions/day",
        completed          = completed_count,
        total_planned      = total_planned,
        remaining          = remaining,
        days_remaining     = days_remaining,
        est_completion     = est_completion_date,
        timestamp          = os.date("%Y-%m-%d %H:%M:%S"),
        trigger            = trigger or "manual",
    }

    -- Save the snapshot
    local save_ok, save_err = pcall(overlord.storage.set, "estimate:snapshot", snapshot)
    if not save_ok then
        overlord.log.error("Failed to save estimate snapshot", {
            error = tostring(save_err),
        })
    end

    -- Emit the estimate event
    local emit_ok, emit_err = pcall(overlord.bus.emit, "estimate:updated", {
        status             = "calculated",
        velocity           = velocity_rounded,
        completed          = completed_count,
        total_planned      = total_planned,
        remaining          = remaining,
        days_remaining     = days_remaining,
        est_completion     = est_completion_date,
        timestamp          = snapshot.timestamp,
    })
    if not emit_ok then
        overlord.log.error("Failed to emit estimate:updated", {
            error = tostring(emit_err),
        })
    end

    -- Log the result
    overlord.log.info("Time estimate calculated", {
        velocity       = velocity_rounded .. " completions/day",
        completed      = completed_count,
        remaining      = remaining,
        days_remaining = days_remaining,
        est_completion = est_completion_date,
    })

    return snapshot
end

-- ============================================================================
-- Lifecycle Hooks
-- ============================================================================

-- onLoad: run an initial estimate if enough data exists
registerHook("onLoad", function()
    overlord.log.info("Time Estimator plugin loaded", {
        plugin  = overlord.manifest.name,
        version = overlord.manifest.version,
    })

    estimate_remaining("plugin_load")
end)

-- onUnload: clean shutdown
registerHook("onUnload", function()
    overlord.log.info("Time Estimator plugin unloaded")
end)

-- onRoomExit: a completed unit of work. Record it and recalculate.
registerHook("onRoomExit", function(data)
    -- Record the completion
    record_completion(data.roomId, data.roomType)

    -- Recalculate if configured
    local config = load_config()
    if config.recalc_on_room_exit then
        estimate_remaining("room_exit")
    end
end)

-- onPhaseAdvance: phase transitions are significant progress markers
registerHook("onPhaseAdvance", function(data)
    local config = load_config()
    if config.recalc_on_phase_advance then
        overlord.log.info("Phase advanced, recalculating estimate", {
            phase = data.phase or "unknown",
        })
        estimate_remaining("phase_advance")
    end
end)

-- onToolExecute: we do not record tool executions as completions, but we
-- log them at debug level so they appear in traces for diagnostics
registerHook("onToolExecute", function(data)
    overlord.log.debug("Tool executed (not counted as completion)", {
        tool = data.toolName or "unknown",
    })
end)
