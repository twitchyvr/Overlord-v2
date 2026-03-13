-- ============================================================================
-- Scope Creep Detector — Overlord Built-In Plugin
-- ============================================================================
-- Monitors the total number of rooms (which represent tasks/work items) over
-- time and compares the current count against a stored baseline. When the
-- count exceeds the baseline by a configurable threshold, a scope:alert
-- event is fired to warn the team that the project is growing beyond plan.
--
-- The baseline is captured the first time the plugin runs (or manually set
-- by writing to "scope:baseline" in storage). Every subsequent check
-- compares the live room count against that baseline.
--
-- Events emitted:
--   scope:alert      — room count has grown beyond the threshold
--   scope:check      — summary event after every check (even if no alert)
--   scope:baseline   — emitted when a new baseline is established
--
-- Storage keys used:
--   scope:baseline   — the original planned room count and date
--   scope:history    — array of snapshots tracking count over time
--   scope:config     — user configuration overrides
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Default configuration
-- ---------------------------------------------------------------------------
local DEFAULT_CONFIG = {
    -- Percentage growth that triggers an alert. 20 means "alert when rooms
    -- exceed the baseline by more than 20%."
    alert_threshold_pct = 20,

    -- Absolute growth that triggers an alert. If the baseline is very small
    -- (e.g. 3 rooms), percentage-based alerts fire too easily. This sets a
    -- minimum absolute count above baseline before alerting.
    alert_threshold_abs = 3,

    -- Automatically capture baseline on first load if none exists
    auto_baseline = true,

    -- Maximum history snapshots to keep
    max_history = 100,

    -- Check scope on room enter/exit events
    check_on_room_change = true,
}

-- ---------------------------------------------------------------------------
-- Helper: load config with defaults
-- ---------------------------------------------------------------------------
local function load_config()
    local ok, stored = pcall(overlord.storage.get, "scope:config")
    if ok and type(stored) == "table" then
        local merged = {}
        for k, v in pairs(DEFAULT_CONFIG) do merged[k] = v end
        for k, v in pairs(stored) do merged[k] = v end
        return merged
    end
    return DEFAULT_CONFIG
end

-- ---------------------------------------------------------------------------
-- Helper: count rooms by type
-- Returns total count and a type-breakdown table
-- ---------------------------------------------------------------------------
local function count_rooms()
    local ok, rooms = pcall(overlord.rooms.list)
    if not ok or type(rooms) ~= "table" then
        overlord.log.warn("Could not fetch rooms", { error = tostring(rooms) })
        return 0, {}
    end

    local total = #rooms
    local by_type = {}

    for _, room in ipairs(rooms) do
        local rtype = room.type or "unknown"
        by_type[rtype] = (by_type[rtype] or 0) + 1
    end

    return total, by_type
end

-- ---------------------------------------------------------------------------
-- Helper: load or establish the baseline
-- ---------------------------------------------------------------------------
local function get_or_create_baseline()
    local config = load_config()

    -- Try to load existing baseline
    local ok, baseline = pcall(overlord.storage.get, "scope:baseline")
    if ok and type(baseline) == "table" and baseline.count then
        return baseline
    end

    -- No baseline exists yet
    if not config.auto_baseline then
        overlord.log.info("No baseline set and auto_baseline is off. Skipping.")
        return nil
    end

    -- Capture current state as the baseline
    local total, by_type = count_rooms()

    local new_baseline = {
        count      = total,
        by_type    = by_type,
        created_at = os.date("%Y-%m-%d %H:%M:%S"),
    }

    local save_ok, save_err = pcall(overlord.storage.set, "scope:baseline", new_baseline)
    if not save_ok then
        overlord.log.error("Failed to save baseline", { error = tostring(save_err) })
    end

    -- Emit baseline event
    local emit_ok, emit_err = pcall(overlord.bus.emit, "scope:baseline", {
        count      = new_baseline.count,
        created_at = new_baseline.created_at,
    })
    if not emit_ok then
        overlord.log.error("Failed to emit scope:baseline", { error = tostring(emit_err) })
    end

    overlord.log.info("Scope baseline established", {
        count = new_baseline.count,
    })

    return new_baseline
end

-- ---------------------------------------------------------------------------
-- Helper: append to scope history
-- ---------------------------------------------------------------------------
local function record_history(snapshot)
    local config = load_config()

    local history = {}
    local ok, data = pcall(overlord.storage.get, "scope:history")
    if ok and type(data) == "table" then
        history = data
    end

    table.insert(history, snapshot)

    -- Trim to max
    while #history > config.max_history do
        table.remove(history, 1)
    end

    local save_ok, save_err = pcall(overlord.storage.set, "scope:history", history)
    if not save_ok then
        overlord.log.error("Failed to save scope history", { error = tostring(save_err) })
    end
end

-- ---------------------------------------------------------------------------
-- Core: check current scope against baseline
-- ---------------------------------------------------------------------------
local function check_scope(trigger)
    local config = load_config()

    overlord.log.info("Running scope creep check", { trigger = trigger or "manual" })

    -- Get or create the baseline
    local baseline = get_or_create_baseline()
    if not baseline then
        overlord.log.info("No baseline available, skipping scope check")
        return nil
    end

    -- Count current rooms
    local current_count, current_by_type = count_rooms()

    -- Calculate growth
    local growth_abs = current_count - baseline.count
    local growth_pct = 0
    if baseline.count > 0 then
        growth_pct = math.floor((growth_abs / baseline.count) * 100 + 0.5)
    end

    -- Determine per-type changes
    local type_changes = {}
    -- Collect all type keys from both baseline and current
    local all_types = {}
    if baseline.by_type then
        for t, _ in pairs(baseline.by_type) do all_types[t] = true end
    end
    for t, _ in pairs(current_by_type) do all_types[t] = true end

    for rtype, _ in pairs(all_types) do
        local base_count = (baseline.by_type and baseline.by_type[rtype]) or 0
        local curr_count = current_by_type[rtype] or 0
        if curr_count ~= base_count then
            table.insert(type_changes, {
                type   = rtype,
                before = base_count,
                after  = curr_count,
                delta  = curr_count - base_count,
            })
        end
    end

    -- Build the snapshot
    local snapshot = {
        current_count = current_count,
        baseline_count = baseline.count,
        growth_abs    = growth_abs,
        growth_pct    = growth_pct,
        type_changes  = type_changes,
        timestamp     = os.date("%Y-%m-%d %H:%M:%S"),
        trigger       = trigger or "manual",
    }

    -- Record in history
    record_history({
        count     = current_count,
        growth    = growth_abs,
        pct       = growth_pct,
        timestamp = snapshot.timestamp,
    })

    -- Determine if we need to alert
    local should_alert = false
    if growth_abs > config.alert_threshold_abs and growth_pct > config.alert_threshold_pct then
        should_alert = true
    end

    -- Emit the general check event
    local check_ok, check_err = pcall(overlord.bus.emit, "scope:check", {
        current   = current_count,
        baseline  = baseline.count,
        growth    = growth_abs,
        growth_pct = growth_pct,
        alert     = should_alert,
        timestamp = snapshot.timestamp,
    })
    if not check_ok then
        overlord.log.error("Failed to emit scope:check", { error = tostring(check_err) })
    end

    -- If threshold is exceeded, fire the alert
    if should_alert then
        overlord.log.warn("SCOPE CREEP DETECTED", {
            baseline   = baseline.count,
            current    = current_count,
            growth     = growth_abs,
            growth_pct = growth_pct .. "%",
            threshold  = config.alert_threshold_pct .. "%",
        })

        local alert_ok, alert_err = pcall(overlord.bus.emit, "scope:alert", {
            baseline     = baseline.count,
            current      = current_count,
            growth       = growth_abs,
            growth_pct   = growth_pct,
            type_changes = type_changes,
            message      = "Project scope has grown by " .. growth_pct .. "% (" ..
                           growth_abs .. " rooms above baseline of " .. baseline.count .. ")",
            timestamp    = snapshot.timestamp,
        })
        if not alert_ok then
            overlord.log.error("Failed to emit scope:alert", { error = tostring(alert_err) })
        end
    else
        overlord.log.info("Scope check passed", {
            baseline = baseline.count,
            current  = current_count,
            growth   = growth_abs,
            pct      = growth_pct .. "%",
        })
    end

    return snapshot
end

-- ============================================================================
-- Lifecycle Hooks
-- ============================================================================

-- onLoad: establish baseline and run initial check
registerHook("onLoad", function()
    overlord.log.info("Scope Creep Detector plugin loaded", {
        plugin  = overlord.manifest.name,
        version = overlord.manifest.version,
    })

    check_scope("plugin_load")
end)

-- onUnload: clean shutdown
registerHook("onUnload", function()
    overlord.log.info("Scope Creep Detector plugin unloaded")
end)

-- onRoomEnter: a new room appearing could mean scope is growing
registerHook("onRoomEnter", function(data)
    local config = load_config()
    if config.check_on_room_change then
        overlord.log.debug("Room entered, checking scope", { room = data.roomId })
        check_scope("room_enter")
    end
end)

-- onRoomExit: room exits don't usually mean scope is growing, but the
-- count check is cheap and keeps history accurate
registerHook("onRoomExit", function(data)
    local config = load_config()
    if config.check_on_room_change then
        overlord.log.debug("Room exited, checking scope", { room = data.roomId })
        check_scope("room_exit")
    end
end)

-- onPhaseAdvance: phase transitions are natural checkpoints
registerHook("onPhaseAdvance", function(data)
    overlord.log.info("Phase advanced, running scope check", {
        phase = data.phase or "unknown",
    })
    check_scope("phase_advance")
end)
