-- =============================================================================
-- Phase Gate Reporter Plugin
-- =============================================================================
-- Every time a phase advances in Overlord, this plugin captures a detailed
-- report of the transition: which phase it came from, which phase it moved to,
-- what evidence was presented, which agents participated, and the timestamp.
--
-- Reports are stored in plugin storage as a searchable history, and each new
-- report is also emitted as a "phasegate:report" event so other plugins or
-- the UI can display or forward it.
--
-- This creates an audit trail that answers the question: "Why did we move
-- from Architecture to Coding, and who approved it?"
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Configuration defaults
-- ---------------------------------------------------------------------------
--   reporter_enabled   (boolean)  Master on/off switch. Default: true
--   max_stored_reports (number)   Maximum number of reports to keep in
--                                 storage. Oldest are pruned first.
--                                 Default: 100
--   include_agent_list (boolean)  Whether to list all active agents in the
--                                 room at the time of transition.
--                                 Default: true
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
-- Report storage
-- ---------------------------------------------------------------------------
-- Reports are stored as an ordered array in storage under the key
-- "phase_gate_reports". Each entry is a table with the full report details.
-- ---------------------------------------------------------------------------

--- Load all stored reports.
-- @return table  Array of report tables, ordered oldest-first.
local function loadReports()
    local raw = overlord.storage.get("phase_gate_reports")
    if raw == nil then
        return {}
    end
    return raw
end

--- Save the reports array back to storage.
-- @param reports  table  The reports array to persist.
local function saveReports(reports)
    overlord.storage.set("phase_gate_reports", reports)
end

--- Add a new report to storage, pruning if the maximum is exceeded.
-- @param report  table  The report to store.
local function storeReport(report)
    local reports = loadReports()
    local maxReports = getConfig("max_stored_reports", 100)

    -- Append the new report.
    table.insert(reports, report)

    -- Prune oldest reports if we have exceeded the maximum.
    while #reports > maxReports do
        table.remove(reports, 1)
    end

    saveReports(reports)

    overlord.log.debug("Report stored. Total reports: " .. #reports, {
        reportId = report.id,
    })
end

-- ---------------------------------------------------------------------------
-- Report generation helpers
-- ---------------------------------------------------------------------------

--- Generate a unique report ID based on timestamp and a short random suffix.
-- @return string  A report ID like "pgr-1710345600-a3f1"
local function generateReportId()
    -- Use timestamp plus a simple pseudo-random suffix for uniqueness.
    local timestamp = os.time()
    local charset = "abcdef0123456789"
    local suffix = ""
    for _ = 1, 4 do
        local idx = math.random(1, #charset)
        suffix = suffix .. string.sub(charset, idx, idx)
    end
    return "pgr-" .. timestamp .. "-" .. suffix
end

--- Collect the list of agents currently active in a room.
-- @param roomId  string  The room to query.
-- @return table          Array of {id, name, role} tables.
local function collectRoomAgents(roomId)
    local agents = {}

    local ok, agentList = pcall(overlord.agents.list, { roomId = roomId })
    if not ok or agentList == nil then
        overlord.log.debug("Could not list agents for room.", {
            roomId = roomId,
        })
        return agents
    end

    for _, agent in ipairs(agentList) do
        table.insert(agents, {
            id = agent.id,
            name = agent.name or "unnamed",
            role = agent.role or "unknown",
        })
    end

    return agents
end

--- Format a timestamp into a human-readable date/time string.
-- @param epoch  number  Unix epoch timestamp.
-- @return string        Formatted string like "2026-03-13 14:30:00"
local function formatTimestamp(epoch)
    return os.date("%Y-%m-%d %H:%M:%S", epoch)
end

--- Build a formatted text summary of a phase gate report.
-- This is the human-readable version emitted in the event payload and
-- available for display in the UI.
-- @param report  table  The report data.
-- @return string        Multi-line formatted summary.
local function formatReportText(report)
    local lines = {}

    table.insert(lines, "=== Phase Gate Report: " .. report.id .. " ===")
    table.insert(lines, "")
    table.insert(lines, "Timestamp:  " .. formatTimestamp(report.timestamp))
    table.insert(lines, "Room:       " .. report.roomName .. " (" .. report.roomType .. ")")
    table.insert(lines, "Transition: " .. report.fromPhase .. " --> " .. report.toPhase)
    table.insert(lines, "Verdict:    " .. report.verdict)
    table.insert(lines, "")

    -- Evidence section
    if report.evidence and #report.evidence > 0 then
        table.insert(lines, "Evidence Presented:")
        for i, item in ipairs(report.evidence) do
            table.insert(lines, "  " .. i .. ". " .. tostring(item))
        end
    else
        table.insert(lines, "Evidence Presented: (none recorded)")
    end
    table.insert(lines, "")

    -- Participants section
    if report.participants and #report.participants > 0 then
        table.insert(lines, "Participants:")
        for _, agent in ipairs(report.participants) do
            table.insert(lines, "  - " .. agent.name .. " (" .. agent.role .. ")")
        end
    else
        table.insert(lines, "Participants: (none recorded)")
    end
    table.insert(lines, "")

    -- Notes section
    if report.notes and #report.notes > 0 then
        table.insert(lines, "Notes: " .. report.notes)
    end

    table.insert(lines, "=== End Report ===")

    return table.concat(lines, "\n")
end

-- ---------------------------------------------------------------------------
-- Core logic: generate a report on phase advance
-- ---------------------------------------------------------------------------

--- Build and store a phase gate report from the onPhaseAdvance hook data.
-- @param data  table  The hook payload from onPhaseAdvance.
local function generateReport(data)
    local enabled = getConfig("reporter_enabled", true)
    if not enabled then
        overlord.log.debug("Phase gate reporter is disabled.")
        return
    end

    local roomId = data.roomId
    local roomName = roomId or "unknown"
    local roomType = "unknown"

    -- Enrich with room details.
    if roomId then
        local ok, room = pcall(overlord.rooms.get, roomId)
        if ok and room then
            roomName = room.name or roomName
            roomType = room.type or roomType
        end
    end

    -- Collect participants if configured.
    local participants = {}
    if getConfig("include_agent_list", true) and roomId then
        participants = collectRoomAgents(roomId)
    end

    -- Build the report.
    local reportId = generateReportId()
    local now = os.time()

    local report = {
        id = reportId,
        timestamp = now,
        formattedTime = formatTimestamp(now),
        roomId = roomId or "unknown",
        roomName = roomName,
        roomType = roomType,
        fromPhase = data.fromPhase or data.from or "unknown",
        toPhase = data.toPhase or data.to or "unknown",
        verdict = data.verdict or "GO",
        evidence = data.evidence or {},
        participants = participants,
        notes = data.notes or "",
        triggeredBy = data.triggeredBy or "system",
    }

    -- Generate the human-readable text version.
    report.formattedText = formatReportText(report)

    -- Store the report.
    storeReport(report)

    -- Log the transition.
    overlord.log.info("Phase gate report generated.", {
        reportId = reportId,
        roomName = roomName,
        fromPhase = report.fromPhase,
        toPhase = report.toPhase,
        verdict = report.verdict,
        participantCount = #participants,
    })

    -- Emit the report as an event.
    overlord.bus.emit("phasegate:report", {
        reportId = reportId,
        roomId = report.roomId,
        roomName = report.roomName,
        roomType = report.roomType,
        fromPhase = report.fromPhase,
        toPhase = report.toPhase,
        verdict = report.verdict,
        evidence = report.evidence,
        participants = participants,
        formattedText = report.formattedText,
        triggeredBy = overlord.manifest.id,
        timestamp = now,
    })

    -- Update running statistics.
    local stats = overlord.storage.get("reporter_stats") or {
        totalReports = 0,
        goCount = 0,
        noGoCount = 0,
    }
    stats.totalReports = stats.totalReports + 1
    if string.upper(report.verdict) == "GO" then
        stats.goCount = stats.goCount + 1
    else
        stats.noGoCount = stats.noGoCount + 1
    end
    stats.lastReportId = reportId
    stats.lastReportTime = now
    overlord.storage.set("reporter_stats", stats)
end

-- ---------------------------------------------------------------------------
-- Lifecycle hooks
-- ---------------------------------------------------------------------------

registerHook("onLoad", function()
    -- Seed the random number generator for report ID generation.
    math.randomseed(os.time())

    local stats = overlord.storage.get("reporter_stats") or {
        totalReports = 0,
        goCount = 0,
        noGoCount = 0,
    }

    overlord.log.info("Phase Gate Reporter plugin loaded.", {
        version = overlord.manifest.version,
        enabled = getConfig("reporter_enabled", true),
        maxStoredReports = getConfig("max_stored_reports", 100),
        existingReports = stats.totalReports,
    })

    -- Initialize stats if they do not exist.
    if overlord.storage.get("reporter_stats") == nil then
        overlord.storage.set("reporter_stats", {
            totalReports = 0,
            goCount = 0,
            noGoCount = 0,
        })
    end
end)

registerHook("onUnload", function()
    local stats = overlord.storage.get("reporter_stats") or {}
    overlord.log.info("Phase Gate Reporter plugin unloaded.", {
        totalReportsGenerated = stats.totalReports or 0,
        goDecisions = stats.goCount or 0,
        noGoDecisions = stats.noGoCount or 0,
    })
end)

-- onPhaseAdvance: This is the primary hook. Every time a phase transition
-- occurs, we capture a full report.
registerHook("onPhaseAdvance", function(data)
    local ok, err = pcall(generateReport, data)
    if not ok then
        overlord.log.error("Error generating phase gate report.", {
            error = tostring(err),
            roomId = data.roomId,
        })
    end
end)

-- onRoomExit: As a supplementary data point, log when agents exit rooms.
-- This helps correlate who was present during a phase and when they left.
registerHook("onRoomExit", function(data)
    if data.roomId == nil or data.agentId == nil then
        return
    end

    overlord.log.debug("Agent exited room (tracked for phase gate context).", {
        roomId = data.roomId,
        agentId = data.agentId,
    })
end)
