-- ============================================================================
-- Deadline Tracker — Overlord Built-In Plugin
-- ============================================================================
-- Tracks milestones and deadlines stored in plugin storage. On load and on
-- every phase advance, it checks all deadlines and fires warning or missed
-- events so the team stays aware of upcoming and overdue dates.
--
-- Deadlines are stored as an array at the "deadlines:list" storage key.
-- Each deadline is a table with:
--   { id, title, due_date (YYYY-MM-DD), phase (optional), status }
--
-- Events emitted:
--   deadline:warning  — a deadline is within the warning window
--   deadline:missed   — a deadline has passed without being marked complete
--   deadline:check    — summary event after a full check cycle
--
-- Storage keys used:
--   deadlines:list    — array of deadline objects
--   deadlines:config  — user configuration overrides
--   deadlines:last_check — timestamp and results of the most recent check
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Default configuration
-- ---------------------------------------------------------------------------
local DEFAULT_CONFIG = {
    -- Number of days before a deadline to start firing warnings
    warning_days = 3,

    -- Check deadlines automatically on plugin load
    check_on_load = true,

    -- Check deadlines on every phase advance
    check_on_phase_advance = true,

    -- Example deadlines to seed if none exist (helps new users understand
    -- the format). Set seed_examples = false to disable.
    seed_examples = true,
}

-- ---------------------------------------------------------------------------
-- Example deadlines seeded for new installations
-- ---------------------------------------------------------------------------
local EXAMPLE_DEADLINES = {
    {
        id       = "example-strategy",
        title    = "Strategy phase complete",
        due_date = "2026-03-20",
        phase    = "Strategy",
        status   = "pending",
    },
    {
        id       = "example-architecture",
        title    = "Architecture review sign-off",
        due_date = "2026-03-27",
        phase    = "Architecture",
        status   = "pending",
    },
    {
        id       = "example-mvp",
        title    = "MVP feature-complete",
        due_date = "2026-04-15",
        phase    = "Execution",
        status   = "pending",
    },
}

-- ---------------------------------------------------------------------------
-- Helper: load config with defaults
-- ---------------------------------------------------------------------------
local function load_config()
    local ok, stored = pcall(overlord.storage.get, "deadlines:config")
    if ok and type(stored) == "table" then
        local merged = {}
        for k, v in pairs(DEFAULT_CONFIG) do merged[k] = v end
        for k, v in pairs(stored) do merged[k] = v end
        return merged
    end
    return DEFAULT_CONFIG
end

-- ---------------------------------------------------------------------------
-- Helper: load the deadlines list from storage
-- ---------------------------------------------------------------------------
local function load_deadlines()
    local ok, data = pcall(overlord.storage.get, "deadlines:list")
    if ok and type(data) == "table" then
        return data
    end
    return nil  -- nil means "not yet initialized"
end

-- ---------------------------------------------------------------------------
-- Helper: save the deadlines list to storage
-- ---------------------------------------------------------------------------
local function save_deadlines(deadlines)
    local ok, err = pcall(overlord.storage.set, "deadlines:list", deadlines)
    if not ok then
        overlord.log.error("Failed to save deadlines", { error = tostring(err) })
    end
end

-- ---------------------------------------------------------------------------
-- Helper: parse a YYYY-MM-DD date string into a comparable timestamp
-- Returns the os.time() value for midnight on that date, or nil on failure.
-- ---------------------------------------------------------------------------
local function parse_date(date_str)
    if type(date_str) ~= "string" then return nil end

    local year, month, day = date_str:match("^(%d%d%d%d)-(%d%d)-(%d%d)$")
    if not year then return nil end

    local ok, result = pcall(os.time, {
        year  = tonumber(year),
        month = tonumber(month),
        day   = tonumber(day),
        hour  = 0,
        min   = 0,
        sec   = 0,
    })

    if ok then return result end
    return nil
end

-- ---------------------------------------------------------------------------
-- Helper: get today's date as a timestamp (midnight)
-- ---------------------------------------------------------------------------
local function today_timestamp()
    local d = os.date("*t")
    return os.time({ year = d.year, month = d.month, day = d.day,
                     hour = 0, min = 0, sec = 0 })
end

-- ---------------------------------------------------------------------------
-- Helper: number of days between two timestamps
-- ---------------------------------------------------------------------------
local function days_between(ts1, ts2)
    local diff = ts2 - ts1
    return math.floor(diff / 86400)  -- 86400 seconds in a day
end

-- ---------------------------------------------------------------------------
-- Core: check all deadlines and emit appropriate events
--
-- Returns a summary table: { warnings = {...}, missed = {...}, ok = {...} }
-- ---------------------------------------------------------------------------
local function check_deadlines()
    local config = load_config()
    local deadlines = load_deadlines()

    -- If no deadlines exist and seeding is enabled, create examples
    if deadlines == nil then
        if config.seed_examples then
            overlord.log.info("No deadlines found, seeding examples")
            deadlines = EXAMPLE_DEADLINES
            save_deadlines(deadlines)
        else
            deadlines = {}
        end
    end

    local now = today_timestamp()
    local warnings = {}
    local missed = {}
    local on_track = {}

    for _, deadline in ipairs(deadlines) do
        -- Skip deadlines already marked complete
        if deadline.status == "complete" then
            table.insert(on_track, deadline)
        else
            local due_ts = parse_date(deadline.due_date)

            if not due_ts then
                overlord.log.warn("Invalid date format for deadline", {
                    id       = deadline.id,
                    due_date = deadline.due_date,
                })
            else
                local days_left = days_between(now, due_ts)

                if days_left < 0 then
                    -- Deadline has passed
                    table.insert(missed, {
                        id        = deadline.id,
                        title     = deadline.title,
                        due_date  = deadline.due_date,
                        phase     = deadline.phase,
                        days_late = math.abs(days_left),
                    })

                    -- Emit missed event
                    local emit_ok, emit_err = pcall(overlord.bus.emit, "deadline:missed", {
                        id        = deadline.id,
                        title     = deadline.title,
                        due_date  = deadline.due_date,
                        days_late = math.abs(days_left),
                    })
                    if not emit_ok then
                        overlord.log.error("Failed to emit deadline:missed", {
                            error = tostring(emit_err),
                        })
                    end

                elseif days_left <= config.warning_days then
                    -- Deadline is approaching
                    table.insert(warnings, {
                        id        = deadline.id,
                        title     = deadline.title,
                        due_date  = deadline.due_date,
                        phase     = deadline.phase,
                        days_left = days_left,
                    })

                    -- Emit warning event
                    local emit_ok, emit_err = pcall(overlord.bus.emit, "deadline:warning", {
                        id        = deadline.id,
                        title     = deadline.title,
                        due_date  = deadline.due_date,
                        days_left = days_left,
                    })
                    if not emit_ok then
                        overlord.log.error("Failed to emit deadline:warning", {
                            error = tostring(emit_err),
                        })
                    end

                else
                    -- Deadline is still comfortably in the future
                    table.insert(on_track, {
                        id        = deadline.id,
                        title     = deadline.title,
                        due_date  = deadline.due_date,
                        phase     = deadline.phase,
                        days_left = days_left,
                    })
                end
            end
        end
    end

    -- Build summary
    local summary = {
        total       = #deadlines,
        warnings    = warnings,
        missed      = missed,
        on_track    = on_track,
        checked_at  = os.date("%Y-%m-%d %H:%M:%S"),
    }

    -- Save the check result
    local save_ok, save_err = pcall(overlord.storage.set, "deadlines:last_check", summary)
    if not save_ok then
        overlord.log.error("Failed to save check result", { error = tostring(save_err) })
    end

    -- Emit the summary event
    local emit_ok, emit_err = pcall(overlord.bus.emit, "deadline:check", {
        total         = summary.total,
        warning_count = #warnings,
        missed_count  = #missed,
        ok_count      = #on_track,
        checked_at    = summary.checked_at,
    })
    if not emit_ok then
        overlord.log.error("Failed to emit deadline:check", { error = tostring(emit_err) })
    end

    -- Log the results
    overlord.log.info("Deadline check complete", {
        total    = summary.total,
        warnings = #warnings,
        missed   = #missed,
        ok       = #on_track,
    })

    -- Log individual issues for visibility
    for _, w in ipairs(warnings) do
        overlord.log.warn("Deadline approaching", {
            title     = w.title,
            due_date  = w.due_date,
            days_left = w.days_left,
        })
    end
    for _, m in ipairs(missed) do
        overlord.log.error("Deadline MISSED", {
            title     = m.title,
            due_date  = m.due_date,
            days_late = m.days_late,
        })
    end

    return summary
end

-- ============================================================================
-- Lifecycle Hooks
-- ============================================================================

-- onLoad: check all deadlines immediately if configured to do so
registerHook("onLoad", function()
    overlord.log.info("Deadline Tracker plugin loaded", {
        plugin  = overlord.manifest.name,
        version = overlord.manifest.version,
    })

    local config = load_config()
    if config.check_on_load then
        check_deadlines()
    end
end)

-- onUnload: clean shutdown
registerHook("onUnload", function()
    overlord.log.info("Deadline Tracker plugin unloaded")
end)

-- onPhaseAdvance: phase transitions are natural checkpoints for deadlines
registerHook("onPhaseAdvance", function(data)
    local config = load_config()
    if config.check_on_phase_advance then
        overlord.log.info("Phase advanced, checking deadlines", {
            phase = data.phase or "unknown",
        })
        check_deadlines()
    end
end)

-- onRoomExit: after completing work in a room, check if any associated
-- deadlines should be updated. This is an informational check only; it
-- does not auto-complete deadlines (the user should do that explicitly).
registerHook("onRoomExit", function(data)
    overlord.log.debug("Room exited, running deadline check", {
        room = data.roomId or "unknown",
    })
    check_deadlines()
end)
