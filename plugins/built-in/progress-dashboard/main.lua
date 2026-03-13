-- ============================================================================
-- Progress Dashboard — Overlord Built-In Plugin
-- ============================================================================
-- Calculates project completion percentage by mapping rooms to workflow
-- phases, counting how many rooms exist in each phase, and determining
-- which phases are complete, in-progress, or not yet started.
--
-- Overlord's built-in room types map to these workflow phases:
--   Phase 1: Strategy     (strategist rooms)
--   Phase 2: Discovery    (discovery rooms)
--   Phase 3: Architecture (architecture rooms)
--   Phase 4: Execution    (code-lab rooms)
--   Phase 5: Testing      (testing-lab rooms)
--   Phase 6: Review       (review rooms)
--   Phase 7: Deployment   (deploy rooms)
--
-- Events emitted:
--   progress:updated     — fired whenever progress is recalculated
--
-- Storage keys used:
--   progress:snapshot     — latest progress calculation
--   progress:history      — array of past snapshots for trend tracking
--   progress:config       — user configuration overrides
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Phase definitions: each phase has a name, the room types that belong to
-- it, a weight (how much it contributes to overall progress), and an order.
-- ---------------------------------------------------------------------------
local DEFAULT_PHASES = {
    { order = 1, name = "Strategy",     types = { "strategist" },    weight = 10 },
    { order = 2, name = "Discovery",    types = { "discovery" },     weight = 15 },
    { order = 3, name = "Architecture", types = { "architecture" },  weight = 15 },
    { order = 4, name = "Execution",    types = { "code-lab" },      weight = 25 },
    { order = 5, name = "Testing",      types = { "testing-lab" },   weight = 15 },
    { order = 6, name = "Review",       types = { "review" },        weight = 10 },
    { order = 7, name = "Deployment",   types = { "deploy" },        weight = 10 },
}

-- ---------------------------------------------------------------------------
-- Default configuration
-- ---------------------------------------------------------------------------
local DEFAULT_CONFIG = {
    -- Automatically recalculate on every phase advance
    recalc_on_phase_advance = true,

    -- Automatically recalculate when rooms are entered/exited
    recalc_on_room_change = true,

    -- Maximum history snapshots to keep (older ones are discarded)
    max_history = 50,
}

-- ---------------------------------------------------------------------------
-- Helper: load user config from storage, merged with defaults
-- ---------------------------------------------------------------------------
local function load_config()
    local ok, stored = pcall(overlord.storage.get, "progress:config")
    if ok and type(stored) == "table" then
        local merged = {}
        for k, v in pairs(DEFAULT_CONFIG) do merged[k] = v end
        for k, v in pairs(stored) do merged[k] = v end
        return merged
    end
    return DEFAULT_CONFIG
end

-- ---------------------------------------------------------------------------
-- Helper: build a set from a list for fast lookups
-- ---------------------------------------------------------------------------
local function set_from_list(list)
    local s = {}
    for _, v in ipairs(list) do s[v] = true end
    return s
end

-- ---------------------------------------------------------------------------
-- Core: calculate progress across all phases
--
-- A phase is considered:
--   "complete"     — at least one room of that type exists AND has no
--                    active agents (work is finished)
--   "in-progress"  — at least one room of that type exists AND has active
--                    agents still working
--   "not-started"  — no rooms of that type exist yet
--
-- Overall progress = sum of (phase_weight * phase_completion_pct) / total_weight
-- ---------------------------------------------------------------------------
local function calculate_progress()
    -- Fetch rooms and agents
    local rooms_ok, rooms = pcall(overlord.rooms.list)
    if not rooms_ok or type(rooms) ~= "table" then
        overlord.log.warn("Could not fetch rooms", { error = tostring(rooms) })
        rooms = {}
    end

    local agents_ok, agents = pcall(overlord.agents.list, {})
    if not agents_ok or type(agents) ~= "table" then
        overlord.log.warn("Could not fetch agents", { error = tostring(agents) })
        agents = {}
    end

    -- Count rooms by type
    local room_counts = {}    -- type -> total count
    local room_ids_by_type = {} -- type -> {id1, id2, ...}
    for _, room in ipairs(rooms) do
        local rtype = room.type or "unknown"
        room_counts[rtype] = (room_counts[rtype] or 0) + 1
        if not room_ids_by_type[rtype] then room_ids_by_type[rtype] = {} end
        table.insert(room_ids_by_type[rtype], room.id)
    end

    -- Count active agents (agents with status that suggests work in progress)
    local active_statuses = set_from_list({ "active", "working", "busy", "running" })
    local active_agent_count = 0
    for _, agent in ipairs(agents) do
        local status = (agent.status or ""):lower()
        if active_statuses[status] then
            active_agent_count = active_agent_count + 1
        end
    end

    -- Calculate per-phase status and completion
    local total_weight = 0
    local weighted_progress = 0
    local phase_results = {}

    for _, phase in ipairs(DEFAULT_PHASES) do
        total_weight = total_weight + phase.weight

        -- Count rooms belonging to this phase
        local phase_room_count = 0
        for _, rtype in ipairs(phase.types) do
            phase_room_count = phase_room_count + (room_counts[rtype] or 0)
        end

        -- Determine phase status
        local status = "not-started"
        local pct = 0

        if phase_room_count > 0 then
            -- At least one room exists for this phase. Consider it in-progress
            -- unless the project has moved past this phase (later phases have rooms).
            status = "in-progress"
            pct = 50  -- base: having rooms means at least halfway

            -- Check if any later phase has rooms (implies this phase finished)
            local later_phases_active = false
            for _, other in ipairs(DEFAULT_PHASES) do
                if other.order > phase.order then
                    for _, rtype in ipairs(other.types) do
                        if (room_counts[rtype] or 0) > 0 then
                            later_phases_active = true
                            break
                        end
                    end
                end
                if later_phases_active then break end
            end

            if later_phases_active then
                status = "complete"
                pct = 100
            end
        end

        weighted_progress = weighted_progress + (phase.weight * pct / 100)

        table.insert(phase_results, {
            order      = phase.order,
            name       = phase.name,
            status     = status,
            room_count = phase_room_count,
            weight     = phase.weight,
            pct        = pct,
        })
    end

    -- Overall percentage
    local overall_pct = 0
    if total_weight > 0 then
        overall_pct = math.floor((weighted_progress / total_weight) * 100 + 0.5)
    end

    -- Clamp to 0-100
    if overall_pct < 0 then overall_pct = 0 end
    if overall_pct > 100 then overall_pct = 100 end

    return {
        overall_pct      = overall_pct,
        total_rooms      = #rooms,
        total_agents     = #agents,
        active_agents    = active_agent_count,
        phases           = phase_results,
        timestamp        = os.date("%Y-%m-%d %H:%M:%S"),
    }
end

-- ---------------------------------------------------------------------------
-- Save the snapshot and append to history
-- ---------------------------------------------------------------------------
local function save_snapshot(snapshot)
    -- Save current snapshot
    local ok, save_err = pcall(overlord.storage.set, "progress:snapshot", snapshot)
    if not ok then
        overlord.log.error("Failed to save progress snapshot", { error = tostring(save_err) })
    end

    -- Append to history
    local config = load_config()
    local history = {}
    local hist_ok, hist_data = pcall(overlord.storage.get, "progress:history")
    if hist_ok and type(hist_data) == "table" then
        history = hist_data
    end

    table.insert(history, {
        overall_pct = snapshot.overall_pct,
        timestamp   = snapshot.timestamp,
        total_rooms = snapshot.total_rooms,
    })

    -- Trim history if it exceeds the maximum
    while #history > config.max_history do
        table.remove(history, 1)
    end

    local hist_save_ok, hist_save_err = pcall(overlord.storage.set, "progress:history", history)
    if not hist_save_ok then
        overlord.log.error("Failed to save progress history", { error = tostring(hist_save_err) })
    end
end

-- ---------------------------------------------------------------------------
-- Recalculate progress, save it, emit the event, and log the result
-- ---------------------------------------------------------------------------
local function refresh_progress(trigger)
    overlord.log.info("Recalculating project progress", { trigger = trigger or "manual" })

    local snapshot = calculate_progress()
    save_snapshot(snapshot)

    -- Emit the progress event
    local emit_ok, emit_err = pcall(overlord.bus.emit, "progress:updated", {
        overall_pct   = snapshot.overall_pct,
        total_rooms   = snapshot.total_rooms,
        total_agents  = snapshot.total_agents,
        active_agents = snapshot.active_agents,
        phases        = snapshot.phases,
        timestamp     = snapshot.timestamp,
    })

    if not emit_ok then
        overlord.log.error("Failed to emit progress:updated", { error = tostring(emit_err) })
    end

    -- Log a concise summary
    local phase_summary = {}
    for _, p in ipairs(snapshot.phases) do
        table.insert(phase_summary, p.name .. ":" .. p.status)
    end

    overlord.log.info("Progress calculated", {
        overall   = snapshot.overall_pct .. "%",
        rooms     = snapshot.total_rooms,
        agents    = snapshot.total_agents,
        phases    = table.concat(phase_summary, ", "),
    })

    return snapshot
end

-- ============================================================================
-- Lifecycle Hooks
-- ============================================================================

-- onLoad: calculate initial progress snapshot
registerHook("onLoad", function()
    overlord.log.info("Progress Dashboard plugin loaded", {
        plugin  = overlord.manifest.name,
        version = overlord.manifest.version,
    })

    refresh_progress("plugin_load")
end)

-- onUnload: clean shutdown logging
registerHook("onUnload", function()
    overlord.log.info("Progress Dashboard plugin unloaded")
end)

-- onRoomEnter: a new room might shift phase status
registerHook("onRoomEnter", function(data)
    local config = load_config()
    if config.recalc_on_room_change then
        overlord.log.debug("Room entered, recalculating progress", { room = data.roomId })
        refresh_progress("room_enter")
    end
end)

-- onRoomExit: leaving a room might mark a phase as complete
registerHook("onRoomExit", function(data)
    local config = load_config()
    if config.recalc_on_room_change then
        overlord.log.debug("Room exited, recalculating progress", { room = data.roomId })
        refresh_progress("room_exit")
    end
end)

-- onPhaseAdvance: a phase transition is a clear signal to recalculate
registerHook("onPhaseAdvance", function(data)
    local config = load_config()
    if config.recalc_on_phase_advance then
        overlord.log.info("Phase advanced, recalculating progress", {
            phase = data.phase or "unknown",
        })
        refresh_progress("phase_advance")
    end
end)
