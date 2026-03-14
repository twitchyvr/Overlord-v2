-- ============================================================================
-- Daily Standup — Overlord Built-In Plugin
-- ============================================================================
-- Generates a formatted daily standup report by aggregating activity data
-- from rooms and agents. Tracks what was completed, what is planned next,
-- and any blockers that need attention.
--
-- Events emitted:
--   standup:generated  — fired when a new standup report is created
--
-- Storage keys used:
--   standup:completed:<date>   — array of completed items for a given day
--   standup:planned:<date>     — array of planned items for a given day
--   standup:blockers:<date>    — array of blocker items for a given day
--   standup:last_report        — the most recently generated report
--   standup:config             — user configuration (auto_generate, etc.)
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Default configuration values
-- Tip: change these by writing to the "standup:config" storage key.
-- ---------------------------------------------------------------------------
local DEFAULT_CONFIG = {
    -- When true, a standup report is generated automatically on plugin load
    auto_generate = true,

    -- Maximum number of items to show in each section of the report
    max_items_per_section = 20,

    -- Room types that count as "execution" work (completed items come from here)
    execution_room_types = {
        ["code-lab"] = true,
        ["testing-lab"] = true,
        ["deploy"] = true,
    },

    -- Room types that count as "planning" work (planned items come from here)
    planning_room_types = {
        ["strategist"] = true,
        ["discovery"] = true,
        ["architecture"] = true,
    },
}

-- ---------------------------------------------------------------------------
-- Helper: load configuration from storage, falling back to defaults
-- ---------------------------------------------------------------------------
local function load_config()
    local ok, stored = pcall(overlord.storage.get, "standup:config")
    if ok and stored then
        -- Merge stored config over defaults so new keys always have a value
        local merged = {}
        for k, v in pairs(DEFAULT_CONFIG) do merged[k] = v end
        for k, v in pairs(stored) do merged[k] = v end
        return merged
    end
    return DEFAULT_CONFIG
end

-- ---------------------------------------------------------------------------
-- Helper: get today's date as a simple string key (YYYY-MM-DD)
-- ---------------------------------------------------------------------------
local function today_key()
    return os.date("%Y-%m-%d")
end

-- ---------------------------------------------------------------------------
-- Helper: safely read a storage array, returning an empty table on failure
-- ---------------------------------------------------------------------------
local function read_list(key)
    local ok, data = pcall(overlord.storage.get, key)
    if ok and type(data) == "table" then
        return data
    end
    return {}
end

-- ---------------------------------------------------------------------------
-- Helper: append an item to a storage-backed list
-- ---------------------------------------------------------------------------
local function append_to_list(key, item)
    local list = read_list(key)
    table.insert(list, item)
    local ok, write_err = pcall(overlord.storage.set, key, list)
    if not ok then
        overlord.log.error("Failed to write to storage", { key = key, error = tostring(write_err) })
    end
end

-- ---------------------------------------------------------------------------
-- Collect activity data from rooms and agents to build the three sections:
--   1. Completed  — what was done (execution rooms with active/idle agents)
--   2. Planned    — what is coming next (planning rooms with active agents)
--   3. Blockers   — anything that looks stuck (agents with "blocked" status)
-- ---------------------------------------------------------------------------
local function collect_activity()
    local config = load_config()
    local date = today_key()

    -- Start with anything already recorded in storage for today
    local completed = read_list("standup:completed:" .. date)
    local planned   = read_list("standup:planned:" .. date)
    local blockers  = read_list("standup:blockers:" .. date)

    -- Fetch all rooms and agents currently known to Overlord
    local rooms_ok, rooms = pcall(overlord.rooms.list)
    if not rooms_ok or type(rooms) ~= "table" then
        overlord.log.warn("Could not fetch rooms list", { error = tostring(rooms) })
        rooms = {}
    end

    local agents_ok, agents = pcall(overlord.agents.list, {})
    if not agents_ok or type(agents) ~= "table" then
        overlord.log.warn("Could not fetch agents list", { error = tostring(agents) })
        agents = {}
    end

    -- Build a quick lookup: agentId -> agent record
    local agent_map = {}
    for _, agent in ipairs(agents) do
        if agent.id then
            agent_map[agent.id] = agent
        end
    end

    -- Walk through rooms and classify activity
    for _, room in ipairs(rooms) do
        local rtype = room.type or "unknown"

        if config.execution_room_types[rtype] then
            -- Execution rooms contribute to "completed"
            table.insert(completed, {
                room_id   = room.id,
                room_name = room.name or room.id,
                room_type = rtype,
                category  = "execution",
            })
        end

        if config.planning_room_types[rtype] then
            -- Planning rooms contribute to "planned"
            table.insert(planned, {
                room_id   = room.id,
                room_name = room.name or room.id,
                room_type = rtype,
                category  = "planning",
            })
        end
    end

    -- Detect blockers: any agent whose status contains "blocked"
    for _, agent in ipairs(agents) do
        local status = (agent.status or ""):lower()
        if status:find("block") then
            table.insert(blockers, {
                agent_id   = agent.id,
                agent_name = agent.name or agent.id,
                agent_role = agent.role or "unknown",
                status     = agent.status,
            })
        end
    end

    -- Trim each section to the configured maximum
    local function trim(list, max)
        if #list > max then
            local trimmed = {}
            for i = 1, max do trimmed[i] = list[i] end
            return trimmed
        end
        return list
    end

    completed = trim(completed, config.max_items_per_section)
    planned   = trim(planned, config.max_items_per_section)
    blockers  = trim(blockers, config.max_items_per_section)

    return completed, planned, blockers
end

-- ---------------------------------------------------------------------------
-- Build a human-readable standup report from the collected data
-- ---------------------------------------------------------------------------
local function build_report(completed, planned, blockers)
    local lines = {}

    table.insert(lines, "========================================")
    table.insert(lines, "  DAILY STANDUP  --  " .. today_key())
    table.insert(lines, "========================================")
    table.insert(lines, "")

    -- Section 1: What was completed
    table.insert(lines, "COMPLETED (" .. #completed .. " items)")
    table.insert(lines, "----------------------------------------")
    if #completed == 0 then
        table.insert(lines, "  (no completed activity recorded)")
    else
        for i, item in ipairs(completed) do
            local label = item.room_name or item.description or ("Item " .. i)
            local detail = item.room_type or item.category or ""
            table.insert(lines, "  " .. i .. ". " .. label .. "  [" .. detail .. "]")
        end
    end
    table.insert(lines, "")

    -- Section 2: What is planned next
    table.insert(lines, "PLANNED (" .. #planned .. " items)")
    table.insert(lines, "----------------------------------------")
    if #planned == 0 then
        table.insert(lines, "  (no upcoming work recorded)")
    else
        for i, item in ipairs(planned) do
            local label = item.room_name or item.description or ("Item " .. i)
            local detail = item.room_type or item.category or ""
            table.insert(lines, "  " .. i .. ". " .. label .. "  [" .. detail .. "]")
        end
    end
    table.insert(lines, "")

    -- Section 3: Blockers
    table.insert(lines, "BLOCKERS (" .. #blockers .. " items)")
    table.insert(lines, "----------------------------------------")
    if #blockers == 0 then
        table.insert(lines, "  (no blockers -- clear sailing!)")
    else
        for i, item in ipairs(blockers) do
            local label = item.agent_name or item.description or ("Blocker " .. i)
            local detail = item.status or item.agent_role or ""
            table.insert(lines, "  " .. i .. ". " .. label .. "  [" .. detail .. "]")
        end
    end
    table.insert(lines, "")
    table.insert(lines, "========================================")

    return table.concat(lines, "\n")
end

-- ---------------------------------------------------------------------------
-- Generate the standup report, save it, and emit the event
-- ---------------------------------------------------------------------------
local function generate_standup()
    overlord.log.info("Generating daily standup report")

    local completed, planned, blockers = collect_activity()
    local report = build_report(completed, planned, blockers)

    -- Persist the report so other plugins or the UI can retrieve it later
    local save_ok, save_err = pcall(overlord.storage.set, "standup:last_report", {
        date      = today_key(),
        report    = report,
        completed = completed,
        planned   = planned,
        blockers  = blockers,
    })

    if not save_ok then
        overlord.log.error("Failed to save standup report", { error = tostring(save_err) })
    end

    -- Emit the event so dashboards and other listeners can react
    local emit_ok, emit_err = pcall(overlord.bus.emit, "standup:generated", {
        date           = today_key(),
        report         = report,
        completed_count = #completed,
        planned_count   = #planned,
        blocker_count   = #blockers,
    })

    if not emit_ok then
        overlord.log.error("Failed to emit standup:generated event", { error = tostring(emit_err) })
    end

    overlord.log.info("Daily standup complete", {
        completed = #completed,
        planned   = #planned,
        blockers  = #blockers,
    })

    return report
end

-- ============================================================================
-- Lifecycle Hooks
-- ============================================================================

-- onLoad: runs when the plugin is first activated.
-- If auto_generate is enabled, we immediately produce a standup report.
registerHook("onLoad", function()
    overlord.log.info("Daily Standup plugin loaded", {
        plugin  = overlord.manifest.name,
        version = overlord.manifest.version,
    })

    local config = load_config()
    if config.auto_generate then
        generate_standup()
    end
end)

-- onUnload: runs when the plugin is deactivated.
registerHook("onUnload", function()
    overlord.log.info("Daily Standup plugin unloaded")
end)

-- onRoomExit: every time an agent leaves a room we record it as completed
-- work so the next standup report reflects it.
registerHook("onRoomExit", function(data)
    local date = today_key()
    local key  = "standup:completed:" .. date

    append_to_list(key, {
        room_id   = data.roomId or "unknown",
        room_name = data.roomName or data.roomId or "unknown",
        room_type = data.roomType or "unknown",
        agent_id  = data.agentId or "unknown",
        timestamp = os.date("%H:%M:%S"),
    })

    overlord.log.debug("Recorded room exit for standup", {
        room = data.roomId,
        agent = data.agentId,
    })
end)

-- onPhaseAdvance: phase transitions are significant milestones, so we
-- regenerate the standup report to capture the latest state.
registerHook("onPhaseAdvance", function(data)
    overlord.log.info("Phase advanced, refreshing standup data", {
        phase = data.phase or "unknown",
    })
    generate_standup()
end)
