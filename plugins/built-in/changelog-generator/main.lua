-- ============================================================================
-- Changelog Generator Plugin for Overlord v2
-- ============================================================================
--
-- Builds a structured CHANGELOG automatically by observing what happens
-- during a project session. Hooks into tool executions and phase advances
-- to create timestamped, categorized entries.
--
-- Entries are stored chronologically in plugin-scoped storage and emitted
-- as "changelog:entry" events so dashboards or export plugins can consume
-- them. When a phase advances, a section header is created to group entries
-- by development phase.
--
-- Categories are inferred from tool names and room types:
--   - "Added"    : write_file in code-lab
--   - "Fixed"    : tools in testing-lab or war-room
--   - "Changed"  : refactor-related tools, phase advances
--   - "Removed"  : delete operations
--   - "Security" : tools in review rooms with security context
--   - "Docs"     : documentation-related tools
-- ============================================================================

-- ─── Configuration Defaults ─────────────────────────────────────────────────

local DEFAULT_MAX_ENTRIES = 1000   -- Maximum stored entries before pruning
local DEFAULT_AUTO_CATEGORIZE = true  -- Automatically infer categories
local DEFAULT_INCLUDE_TOOL_DETAIL = true -- Include tool names in entries

-- ─── Category Constants ─────────────────────────────────────────────────────
-- Follow the "Keep a Changelog" convention: https://keepachangelog.com

local CATEGORIES = {
    ADDED = "Added",
    FIXED = "Fixed",
    CHANGED = "Changed",
    REMOVED = "Removed",
    SECURITY = "Security",
    DOCS = "Documentation",
    PHASE = "Phase",       -- Special category for phase advance markers
    OTHER = "Other",
}

-- ─── Tool-to-Category Mapping ───────────────────────────────────────────────
-- Maps tool name patterns to changelog categories. Checked in order;
-- first match wins.

local TOOL_CATEGORY_RULES = {
    { pattern = "write_file",    category = CATEGORIES.ADDED },
    { pattern = "create",        category = CATEGORIES.ADDED },
    { pattern = "delete",        category = CATEGORIES.REMOVED },
    { pattern = "remove",        category = CATEGORIES.REMOVED },
    { pattern = "fix",           category = CATEGORIES.FIXED },
    { pattern = "patch",         category = CATEGORIES.FIXED },
    { pattern = "test",          category = CATEGORIES.FIXED },
    { pattern = "refactor",      category = CATEGORIES.CHANGED },
    { pattern = "rename",        category = CATEGORIES.CHANGED },
    { pattern = "move",          category = CATEGORIES.CHANGED },
    { pattern = "update",        category = CATEGORIES.CHANGED },
    { pattern = "doc",           category = CATEGORIES.DOCS },
    { pattern = "readme",        category = CATEGORIES.DOCS },
    { pattern = "security",      category = CATEGORIES.SECURITY },
    { pattern = "audit",         category = CATEGORIES.SECURITY },
}

-- ─── Room-to-Category Overrides ─────────────────────────────────────────────
-- If the tool runs in one of these room types, override the tool-based guess.

local ROOM_CATEGORY_OVERRIDES = {
    ["testing-lab"] = CATEGORIES.FIXED,
    ["war-room"] = CATEGORIES.FIXED,
    ["review"] = CATEGORIES.CHANGED,
}

-- ─── Helper: Load Config ────────────────────────────────────────────────────

local function load_config()
    local max_entries = overlord.storage.get("config:max_entries")
    local auto_cat = overlord.storage.get("config:auto_categorize")
    local tool_detail = overlord.storage.get("config:include_tool_detail")

    return {
        max_entries = max_entries or DEFAULT_MAX_ENTRIES,
        auto_categorize = (auto_cat ~= nil) and auto_cat or DEFAULT_AUTO_CATEGORIZE,
        include_tool_detail = (tool_detail ~= nil) and tool_detail or DEFAULT_INCLUDE_TOOL_DETAIL,
    }
end

-- ─── Helper: Load Entries ───────────────────────────────────────────────────

local function load_entries()
    local entries = overlord.storage.get("changelog_entries")
    if entries == nil then
        return {}
    end
    return entries
end

-- ─── Helper: Save Entries ───────────────────────────────────────────────────

local function save_entries(entries)
    overlord.storage.set("changelog_entries", entries)
end

-- ─── Helper: Load Current Phase ─────────────────────────────────────────────

local function load_current_phase()
    return overlord.storage.get("current_phase") or "Unreleased"
end

local function save_current_phase(phase)
    overlord.storage.set("current_phase", phase)
end

-- ─── Helper: Infer Category from Tool and Room ─────────────────────────────

local function infer_category(tool_name, room_type)
    -- Room overrides take priority
    if room_type and ROOM_CATEGORY_OVERRIDES[room_type] then
        return ROOM_CATEGORY_OVERRIDES[room_type]
    end

    -- Match tool name against patterns
    if tool_name then
        local lower_tool = tool_name:lower()
        for _, rule in ipairs(TOOL_CATEGORY_RULES) do
            if lower_tool:find(rule.pattern, 1, true) then
                return rule.category
            end
        end
    end

    return CATEGORIES.OTHER
end

-- ─── Helper: Prune Entries ──────────────────────────────────────────────────

local function prune_entries(entries, max_entries)
    if #entries <= max_entries then
        return entries
    end

    overlord.log.info("Pruning changelog entries", {
        current = #entries,
        max = max_entries,
    })

    local pruned = {}
    local start = #entries - max_entries + 1
    for i = start, #entries do
        table.insert(pruned, entries[i])
    end
    return pruned
end

-- ─── Helper: Build Entry ID ────────────────────────────────────────────────

local entry_counter = 0

local function next_entry_id()
    entry_counter = entry_counter + 1
    return "cl-" .. os.clock() .. "-" .. entry_counter
end

-- ─── Helper: Format Entry as Markdown ───────────────────────────────────────
-- Produces a single line suitable for a CHANGELOG.md file.

local function format_entry_markdown(entry)
    local prefix = "- "
    if entry.category and entry.category ~= CATEGORIES.OTHER then
        prefix = "- **" .. entry.category .. "**: "
    end
    return prefix .. entry.description
end

-- ─── Helper: Build Description from Tool Execution ─────────────────────────

local function build_tool_description(data, config)
    local tool = data.toolName or data.tool_name or "unknown tool"
    local room = data.roomId or data.room_id or ""
    local agent = data.agentId or data.agent_id or ""

    -- Try to extract a meaningful summary from the tool result
    local summary = ""
    if type(data.result) == "table" then
        -- Many tools return a "message" or "path" in their result
        if type(data.result.message) == "string" then
            summary = data.result.message
        elseif type(data.result.path) == "string" then
            summary = "File: " .. data.result.path
        elseif type(data.result.file) == "string" then
            summary = "File: " .. data.result.file
        end
    elseif type(data.result) == "string" and #data.result < 200 then
        summary = data.result
    end

    -- Build the description
    local desc = ""
    if summary ~= "" then
        desc = summary
    elseif config.include_tool_detail then
        desc = "Executed " .. tool
        if agent ~= "" then
            desc = desc .. " (agent: " .. agent .. ")"
        end
    else
        desc = "Tool execution in " .. (room ~= "" and room or "unknown room")
    end

    return desc
end

-- ─── Hook: onLoad ───────────────────────────────────────────────────────────
-- Initialize and report current state.

registerHook("onLoad", function(data)
    local config = load_config()
    local entries = load_entries()
    local phase = load_current_phase()

    overlord.log.info("Changelog Generator loaded", {
        total_entries = #entries,
        current_phase = phase,
        auto_categorize = config.auto_categorize,
    })

    -- Emit current state for dashboards
    overlord.bus.emit("changelog:status", {
        total_entries = #entries,
        current_phase = phase,
    })
end)

-- ─── Hook: onToolExecute ────────────────────────────────────────────────────
-- Create a changelog entry for each tool execution.
-- Filters out low-signal tools (reads, listings) to keep the log meaningful.

registerHook("onToolExecute", function(data)
    local config = load_config()
    local tool = data.toolName or data.tool_name or ""
    local room_type = data.roomType or data.room_type or ""

    -- Skip read-only tools that don't represent meaningful changes.
    -- We only want to log actions that modify state or indicate progress.
    local lower_tool = tool:lower()
    local skip_patterns = { "read_file", "list_", "search_", "get_" }
    for _, skip in ipairs(skip_patterns) do
        if lower_tool:find(skip, 1, true) then
            overlord.log.debug("Skipping read-only tool for changelog", { tool = tool })
            return
        end
    end

    -- Determine category
    local category = CATEGORIES.OTHER
    if config.auto_categorize then
        category = infer_category(tool, room_type)
    end

    -- Build the entry
    local description = build_tool_description(data, config)
    local phase = load_current_phase()

    local entry = {
        id = next_entry_id(),
        phase = phase,
        category = category,
        description = description,
        tool = tool,
        room_type = room_type,
        agent_id = data.agentId or data.agent_id or "",
        room_id = data.roomId or data.room_id or "",
        timestamp = os.clock(),
    }

    -- Persist
    local entries = load_entries()
    table.insert(entries, entry)
    entries = prune_entries(entries, config.max_entries)
    save_entries(entries)

    -- Format and emit
    local markdown = format_entry_markdown(entry)

    overlord.bus.emit("changelog:entry", {
        id = entry.id,
        phase = entry.phase,
        category = entry.category,
        description = entry.description,
        markdown = markdown,
        tool = entry.tool,
    })

    overlord.log.debug("Changelog entry created", {
        category = category,
        tool = tool,
        description = description,
    })
end)

-- ─── Hook: onPhaseAdvance ───────────────────────────────────────────────────
-- When a phase gate advances, create a section header entry and update
-- the current phase tracker.

registerHook("onPhaseAdvance", function(data)
    local old_phase = load_current_phase()
    local new_phase = data.phase or data.phaseName or data.phase_name or "Unknown Phase"
    local verdict = data.verdict or "GO"

    -- Update the current phase
    save_current_phase(new_phase)

    -- Create a phase marker entry
    local entry = {
        id = next_entry_id(),
        phase = new_phase,
        category = CATEGORIES.PHASE,
        description = "Phase advanced: " .. old_phase .. " -> " .. new_phase
            .. " (verdict: " .. tostring(verdict) .. ")",
        tool = "",
        room_type = data.roomType or data.room_type or "",
        agent_id = data.agentId or data.agent_id or "",
        room_id = data.roomId or data.room_id or "",
        timestamp = os.clock(),
    }

    local entries = load_entries()
    table.insert(entries, entry)
    save_entries(entries)

    -- Emit the phase change event
    overlord.bus.emit("changelog:phase", {
        old_phase = old_phase,
        new_phase = new_phase,
        verdict = verdict,
        total_entries = #entries,
    })

    -- Also emit as a regular entry for consumers that want a flat stream
    overlord.bus.emit("changelog:entry", {
        id = entry.id,
        phase = entry.phase,
        category = entry.category,
        description = entry.description,
        markdown = "## " .. new_phase,
    })

    overlord.log.info("Phase advanced in changelog", {
        old_phase = old_phase,
        new_phase = new_phase,
        verdict = verdict,
    })
end)

-- ─── Hook: onUnload ─────────────────────────────────────────────────────────
-- Log final state. Entries persist in storage for the next session.

registerHook("onUnload", function(data)
    local entries = load_entries()
    local phase = load_current_phase()

    overlord.log.info("Changelog Generator unloading", {
        total_entries = #entries,
        current_phase = phase,
    })
end)
