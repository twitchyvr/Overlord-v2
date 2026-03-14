-- ============================================================================
-- TODO Scanner Plugin for Overlord v2
-- ============================================================================
--
-- Hooks into tool executions inside code-lab rooms and scans results for
-- common code annotation patterns: TODO, FIXME, HACK, XXX, and NOTE.
--
-- Each match is stored in plugin-scoped storage and emitted as a
-- "todo:found" event on the event bus for dashboards or other plugins
-- to consume.
--
-- LIMITATION: Full filesystem scanning requires the fs:read permission,
-- which is not yet implemented in Overlord's plugin sandbox. This version
-- works by analyzing tool execution results (e.g., output from read_file,
-- search_files, or write_file tools). Once fs:read is available, a future
-- version can proactively scan project files on room entry.
-- ============================================================================

-- ─── Configuration Defaults ─────────────────────────────────────────────────
-- Users can override these by writing to storage keys before loading.

local DEFAULT_PATTERNS = { "TODO", "FIXME", "HACK", "XXX", "NOTE" }
local DEFAULT_MAX_ITEMS = 500   -- Maximum tracked items before pruning oldest
local DEFAULT_ROOM_FILTER = "code-lab"  -- Only scan in code-lab rooms

-- ─── Helper: Load Config from Storage ───────────────────────────────────────
-- Reads user-customizable settings from storage, falling back to defaults.

local function load_config()
    local patterns = overlord.storage.get("config:patterns")
    local max_items = overlord.storage.get("config:max_items")
    local room_filter = overlord.storage.get("config:room_filter")

    return {
        patterns = patterns or DEFAULT_PATTERNS,
        max_items = max_items or DEFAULT_MAX_ITEMS,
        room_filter = room_filter or DEFAULT_ROOM_FILTER,
    }
end

-- ─── Helper: Load Tracked Items from Storage ────────────────────────────────
-- Returns the current list of tracked TODO items, or an empty table.

local function load_items()
    local items = overlord.storage.get("todo_items")
    if items == nil then
        return {}
    end
    return items
end

-- ─── Helper: Save Tracked Items to Storage ──────────────────────────────────

local function save_items(items)
    overlord.storage.set("todo_items", items)
end

-- ─── Helper: Generate a Simple Unique ID ────────────────────────────────────
-- Combines timestamp with a counter for uniqueness within a session.

local id_counter = 0

local function generate_id()
    id_counter = id_counter + 1
    return "todo-" .. os.clock() .. "-" .. id_counter
end

-- ─── Helper: Scan Text for Patterns ─────────────────────────────────────────
-- Searches a block of text for configured annotation patterns.
-- Returns a table of matches, each with: pattern, line, text (trimmed context).

local function scan_text(text, config)
    local matches = {}

    if type(text) ~= "string" or text == "" then
        return matches
    end

    -- Process line by line for accurate line number tracking
    local line_num = 0
    for line in text:gmatch("([^\n]*)\n?") do
        line_num = line_num + 1

        for _, pattern in ipairs(config.patterns) do
            -- Case-insensitive search: look for the pattern followed by
            -- a colon or whitespace, which is the standard annotation format
            -- e.g., "TODO: fix this" or "FIXME refactor later"
            local lower_line = line:lower()
            local lower_pattern = pattern:lower()

            if lower_line:find(lower_pattern, 1, true) then
                -- Extract the relevant portion of the line (trim whitespace)
                local trimmed = line:match("^%s*(.-)%s*$")
                if trimmed and trimmed ~= "" then
                    table.insert(matches, {
                        pattern = pattern,
                        line = line_num,
                        text = trimmed,
                    })
                end
            end
        end
    end

    return matches
end

-- ─── Helper: Prune Items if Over Limit ──────────────────────────────────────
-- Removes the oldest items when the list exceeds max_items.

local function prune_items(items, max_items)
    if #items <= max_items then
        return items
    end

    overlord.log.info("Pruning TODO list", {
        current_count = #items,
        max_items = max_items,
    })

    -- Keep only the most recent items
    local pruned = {}
    local start = #items - max_items + 1
    for i = start, #items do
        table.insert(pruned, items[i])
    end

    return pruned
end

-- ─── Hook: onLoad ───────────────────────────────────────────────────────────
-- Runs when the plugin is first loaded. Logs status and initializes storage
-- if this is the first run.

registerHook("onLoad", function(data)
    local config = load_config()
    local items = load_items()

    overlord.log.info("TODO Scanner loaded", {
        tracked_items = #items,
        patterns = config.patterns,
        room_filter = config.room_filter,
        max_items = config.max_items,
    })

    -- Emit a summary event so dashboards can display current state
    overlord.bus.emit("todo:summary", {
        total_items = #items,
        patterns = config.patterns,
    })
end)

-- ─── Hook: onToolExecute ────────────────────────────────────────────────────
-- Fires after every tool execution. We check if the tool ran in a code-lab
-- room and scan its result output for annotation patterns.

registerHook("onToolExecute", function(data)
    local config = load_config()

    -- Only scan in the configured room type (default: code-lab)
    -- The hook data includes roomType when available
    local room_type = data.roomType or data.room_type or ""
    if type(room_type) == "string" and room_type ~= "" then
        if room_type ~= config.room_filter then
            return  -- Not a code-lab room, skip scanning
        end
    end

    -- Extract text content from the tool execution result.
    -- Tool results come in various shapes. We look for common fields
    -- that might contain source code or file content.
    local text_to_scan = ""
    local source_info = {
        tool = data.toolName or data.tool_name or "unknown",
        room_id = data.roomId or data.room_id or "unknown",
        agent_id = data.agentId or data.agent_id or "unknown",
    }

    -- Check common result fields for scannable content
    if type(data.result) == "string" then
        text_to_scan = data.result
    elseif type(data.result) == "table" then
        -- Tools like read_file return content in a "content" field
        if type(data.result.content) == "string" then
            text_to_scan = data.result.content
        end
        -- Tools like search_files return output in an "output" field
        if type(data.result.output) == "string" then
            text_to_scan = text_to_scan .. "\n" .. data.result.output
        end
        -- Some tools put results in a "data" field
        if type(data.result.data) == "string" then
            text_to_scan = text_to_scan .. "\n" .. data.result.data
        end
    end

    -- Also check top-level "output" field (some hooks pass it directly)
    if type(data.output) == "string" then
        text_to_scan = text_to_scan .. "\n" .. data.output
    end

    if text_to_scan == "" then
        return  -- No text content to scan
    end

    -- Scan for patterns
    local matches = scan_text(text_to_scan, config)
    if #matches == 0 then
        return  -- No annotations found
    end

    -- Load existing items, add new ones, prune, and save
    local items = load_items()
    local new_count = 0

    for _, match in ipairs(matches) do
        local item = {
            id = generate_id(),
            pattern = match.pattern,
            line = match.line,
            text = match.text,
            source = source_info,
            found_at = os.clock(),
        }

        table.insert(items, item)
        new_count = new_count + 1

        -- Emit an event for each found item
        overlord.bus.emit("todo:found", {
            id = item.id,
            pattern = item.pattern,
            line = item.line,
            text = item.text,
            tool = source_info.tool,
            room_id = source_info.room_id,
        })
    end

    -- Prune if we exceeded the maximum
    items = prune_items(items, config.max_items)

    -- Persist updated list
    save_items(items)

    overlord.log.info("TODO items found in tool output", {
        new_items = new_count,
        total_items = #items,
        tool = source_info.tool,
    })

    -- Emit an updated summary
    overlord.bus.emit("todo:summary", {
        total_items = #items,
        new_items = new_count,
        patterns = config.patterns,
    })
end)

-- ─── Hook: onRoomEnter ──────────────────────────────────────────────────────
-- When an agent enters a code-lab room, emit the current TODO summary
-- so the agent (or UI) is aware of outstanding annotations.

registerHook("onRoomEnter", function(data)
    local config = load_config()

    local room_type = data.roomType or data.room_type or ""
    if room_type ~= config.room_filter then
        return
    end

    local items = load_items()
    if #items > 0 then
        overlord.log.info("Agent entered code-lab with outstanding TODOs", {
            total_items = #items,
            agent_id = data.agentId or data.agent_id or "unknown",
        })

        overlord.bus.emit("todo:summary", {
            total_items = #items,
            patterns = config.patterns,
            trigger = "room_enter",
        })
    end
end)

-- ─── Hook: onUnload ─────────────────────────────────────────────────────────
-- Cleanup when the plugin is disabled. Items remain in storage for next load.

registerHook("onUnload", function(data)
    local items = load_items()
    overlord.log.info("TODO Scanner unloading", {
        tracked_items = #items,
    })
end)
