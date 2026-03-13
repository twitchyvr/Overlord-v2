-- ============================================================================
-- Code Complexity Alert Plugin for Overlord v2
-- ============================================================================
--
-- Monitors code complexity by analyzing tool execution output in code-lab
-- rooms. Uses heuristic indicators to estimate complexity when formal
-- cyclomatic complexity tools aren't available.
--
-- Heuristics tracked:
--   - Line count per file/function (excessive length)
--   - Nesting depth (deeply nested conditionals/loops)
--   - Function/method count per file (god-object detection)
--   - Long parameter lists
--   - Deeply chained expressions
--
-- When complexity exceeds configurable thresholds, the plugin emits
-- "complexity:alert" events and stores per-file metrics for trend tracking.
--
-- LIMITATION: Full AST-based complexity analysis would require fs:read to
-- scan source files directly. This version works with tool output (file
-- reads, write results) that flows through the code-lab room. The heuristic
-- approach catches most common complexity issues without needing a parser.
-- ============================================================================

-- ─── Configurable Thresholds (Defaults) ─────────────────────────────────────
-- Users can override any threshold by writing to the corresponding storage key.

local DEFAULT_THRESHOLDS = {
    max_file_lines = 300,         -- Files longer than this trigger an alert
    max_function_lines = 50,      -- Functions longer than this trigger an alert
    max_nesting_depth = 4,        -- Deeper nesting triggers an alert
    max_params = 5,               -- Functions with more params trigger an alert
    max_functions_per_file = 20,  -- Too many functions suggests god-object
    max_line_length = 120,        -- Lines wider than this suggest complexity
    max_chaining_depth = 5,       -- Deeply chained method calls
}

local DEFAULT_ROOM_FILTER = "code-lab"
local DEFAULT_MAX_METRICS = 500     -- Maximum tracked file metrics
local DEFAULT_ALERT_COOLDOWN = 30   -- Seconds between repeated alerts for same file

-- ─── Complexity Levels ──────────────────────────────────────────────────────

local COMPLEXITY_LEVELS = {
    LOW = "low",           -- Within all thresholds
    MODERATE = "moderate",  -- One or two thresholds exceeded slightly
    HIGH = "high",          -- Multiple thresholds exceeded
    CRITICAL = "critical",  -- Severely over thresholds
}

-- ─── Helper: Load Config ────────────────────────────────────────────────────

local function load_config()
    local thresholds = overlord.storage.get("config:thresholds") or DEFAULT_THRESHOLDS
    local room_filter = overlord.storage.get("config:room_filter") or DEFAULT_ROOM_FILTER
    local max_metrics = overlord.storage.get("config:max_metrics") or DEFAULT_MAX_METRICS
    local cooldown = overlord.storage.get("config:alert_cooldown") or DEFAULT_ALERT_COOLDOWN

    -- Merge user thresholds with defaults (user values override, defaults fill gaps)
    local merged = {}
    for k, v in pairs(DEFAULT_THRESHOLDS) do
        merged[k] = v
    end
    if type(thresholds) == "table" then
        for k, v in pairs(thresholds) do
            if type(v) == "number" then
                merged[k] = v
            end
        end
    end

    return {
        thresholds = merged,
        room_filter = room_filter,
        max_metrics = max_metrics,
        alert_cooldown = cooldown,
    }
end

-- ─── Helper: Load File Metrics ──────────────────────────────────────────────

local function load_metrics()
    local metrics = overlord.storage.get("file_metrics")
    if metrics == nil then
        return {}
    end
    return metrics
end

local function save_metrics(metrics)
    overlord.storage.set("file_metrics", metrics)
end

-- ─── Helper: Load Alert Timestamps ──────────────────────────────────────────
-- Tracks when we last alerted for a specific file to prevent spam.

local function load_alert_times()
    local times = overlord.storage.get("alert_times")
    if times == nil then
        return {}
    end
    return times
end

local function save_alert_times(times)
    overlord.storage.set("alert_times", times)
end

-- ─── Helper: Metric ID Generator ────────────────────────────────────────────

local metric_counter = 0

local function next_metric_id()
    metric_counter = metric_counter + 1
    return "cx-" .. os.clock() .. "-" .. metric_counter
end

-- ─── Heuristic Analyzers ────────────────────────────────────────────────────
-- Each analyzer examines text content and returns metric values.

-- Count total lines in text
local function count_lines(text)
    local count = 0
    for _ in text:gmatch("\n") do
        count = count + 1
    end
    -- Account for last line without newline
    if text ~= "" and text:sub(-1) ~= "\n" then
        count = count + 1
    end
    return count
end

-- Estimate maximum nesting depth by counting leading whitespace changes.
-- This is a heuristic: indentation depth correlates with nesting depth
-- in most well-formatted code.
local function estimate_nesting_depth(text)
    local max_depth = 0
    local indent_size = 2  -- Assume 2-space or 4-space indent; we measure in units

    for line in text:gmatch("([^\n]*)\n?") do
        -- Count leading spaces
        local spaces = 0
        for i = 1, #line do
            if line:sub(i, i) == " " then
                spaces = spaces + 1
            elseif line:sub(i, i) == "\t" then
                spaces = spaces + 4  -- Treat tab as 4 spaces
            else
                break
            end
        end

        -- Skip empty or whitespace-only lines
        if line:match("%S") then
            local depth = math.floor(spaces / indent_size)
            if depth > max_depth then
                max_depth = depth
            end
        end
    end

    return max_depth
end

-- Count function/method definitions (heuristic: looks for common patterns)
local function count_functions(text)
    local count = 0
    local lower = text:lower()

    -- JavaScript/TypeScript patterns
    for _ in text:gmatch("function%s+%w+") do count = count + 1 end
    for _ in text:gmatch("=>") do count = count + 1 end
    for _ in text:gmatch("%w+%s*%(.-%)%s*{") do count = count + 1 end

    -- Python patterns
    for _ in text:gmatch("\ndef%s+%w+") do count = count + 1 end

    -- Rust patterns
    for _ in text:gmatch("\nfn%s+%w+") do count = count + 1 end

    -- Lua patterns
    for _ in text:gmatch("\nlocal%s+function") do count = count + 1 end

    return count
end

-- Find the maximum parameter count in function signatures
local function max_param_count(text)
    local max_params = 0

    -- Match function-like signatures: name(param1, param2, ...)
    for params in text:gmatch("%w+%s*%(([^)]*)%)") do
        -- Count commas + 1 = number of parameters (if non-empty)
        if params:match("%S") then
            local count = 1
            for _ in params:gmatch(",") do
                count = count + 1
            end
            if count > max_params then
                max_params = count
            end
        end
    end

    return max_params
end

-- Find the longest line in the text
local function max_line_length(text)
    local max_len = 0
    for line in text:gmatch("([^\n]*)\n?") do
        if #line > max_len then
            max_len = #line
        end
    end
    return max_len
end

-- Estimate method chaining depth (e.g., a.b().c().d().e())
local function estimate_chaining(text)
    local max_chain = 0
    for line in text:gmatch("([^\n]*)\n?") do
        local chain = 0
        -- Count dots followed by method calls: .name(
        for _ in line:gmatch("%.%w+%(") do
            chain = chain + 1
        end
        if chain > max_chain then
            max_chain = chain
        end
    end
    return max_chain
end

-- ─── Core: Analyze Text and Produce Metrics ─────────────────────────────────
-- Runs all heuristic analyzers on a block of text and returns a metrics table.

local function analyze_complexity(text, thresholds)
    local line_count = count_lines(text)
    local nesting = estimate_nesting_depth(text)
    local func_count = count_functions(text)
    local params = max_param_count(text)
    local longest_line = max_line_length(text)
    local chaining = estimate_chaining(text)

    -- Count how many thresholds are exceeded
    local violations = {}
    local violation_count = 0

    if line_count > thresholds.max_file_lines then
        table.insert(violations, {
            metric = "file_lines",
            value = line_count,
            threshold = thresholds.max_file_lines,
        })
        violation_count = violation_count + 1
    end

    if nesting > thresholds.max_nesting_depth then
        table.insert(violations, {
            metric = "nesting_depth",
            value = nesting,
            threshold = thresholds.max_nesting_depth,
        })
        violation_count = violation_count + 1
    end

    if func_count > thresholds.max_functions_per_file then
        table.insert(violations, {
            metric = "functions_per_file",
            value = func_count,
            threshold = thresholds.max_functions_per_file,
        })
        violation_count = violation_count + 1
    end

    if params > thresholds.max_params then
        table.insert(violations, {
            metric = "max_params",
            value = params,
            threshold = thresholds.max_params,
        })
        violation_count = violation_count + 1
    end

    if longest_line > thresholds.max_line_length then
        table.insert(violations, {
            metric = "line_length",
            value = longest_line,
            threshold = thresholds.max_line_length,
        })
        violation_count = violation_count + 1
    end

    if chaining > thresholds.max_chaining_depth then
        table.insert(violations, {
            metric = "chaining_depth",
            value = chaining,
            threshold = thresholds.max_chaining_depth,
        })
        violation_count = violation_count + 1
    end

    -- Determine overall complexity level based on violation count
    local level = COMPLEXITY_LEVELS.LOW
    if violation_count >= 4 then
        level = COMPLEXITY_LEVELS.CRITICAL
    elseif violation_count >= 2 then
        level = COMPLEXITY_LEVELS.HIGH
    elseif violation_count >= 1 then
        level = COMPLEXITY_LEVELS.MODERATE
    end

    return {
        line_count = line_count,
        nesting_depth = nesting,
        function_count = func_count,
        max_params = params,
        longest_line = longest_line,
        chaining_depth = chaining,
        violations = violations,
        violation_count = violation_count,
        level = level,
    }
end

-- ─── Helper: Extract File Identifier from Hook Data ─────────────────────────
-- Tries to determine which file was involved in the tool execution.

local function extract_file_id(data)
    -- Check common fields for file paths
    if type(data.result) == "table" then
        if type(data.result.path) == "string" then return data.result.path end
        if type(data.result.file) == "string" then return data.result.file end
        if type(data.result.filePath) == "string" then return data.result.filePath end
    end

    -- Fall back to params if available
    if type(data.params) == "table" then
        if type(data.params.path) == "string" then return data.params.path end
        if type(data.params.file) == "string" then return data.params.file end
    end

    -- Last resort: use tool name + room as identifier
    local tool = data.toolName or data.tool_name or "unknown"
    local room = data.roomId or data.room_id or "unknown"
    return tool .. "@" .. room
end

-- ─── Helper: Extract Scannable Text from Hook Data ──────────────────────────

local function extract_text(data)
    local parts = {}

    if type(data.result) == "string" then
        table.insert(parts, data.result)
    elseif type(data.result) == "table" then
        if type(data.result.content) == "string" then
            table.insert(parts, data.result.content)
        end
        if type(data.result.output) == "string" then
            table.insert(parts, data.result.output)
        end
        if type(data.result.data) == "string" then
            table.insert(parts, data.result.data)
        end
    end

    if type(data.output) == "string" then
        table.insert(parts, data.output)
    end

    return table.concat(parts, "\n")
end

-- ─── Helper: Prune Metrics ──────────────────────────────────────────────────

local function prune_metrics(metrics, max_count)
    if #metrics <= max_count then
        return metrics
    end

    local pruned = {}
    local start = #metrics - max_count + 1
    for i = start, #metrics do
        table.insert(pruned, metrics[i])
    end
    return pruned
end

-- ─── Helper: Check Alert Cooldown ───────────────────────────────────────────
-- Returns true if enough time has passed since the last alert for this file.

local function can_alert(file_id, cooldown)
    local times = load_alert_times()
    local last_alert = times[file_id]

    if last_alert == nil then
        return true
    end

    return (os.clock() - last_alert) >= cooldown
end

local function record_alert_time(file_id)
    local times = load_alert_times()
    times[file_id] = os.clock()
    save_alert_times(times)
end

-- ─── Hook: onLoad ───────────────────────────────────────────────────────────

registerHook("onLoad", function(data)
    local config = load_config()
    local metrics = load_metrics()

    overlord.log.info("Code Complexity Alert loaded", {
        tracked_files = #metrics,
        thresholds = config.thresholds,
        room_filter = config.room_filter,
    })

    -- Count files at each complexity level
    local level_counts = {
        low = 0,
        moderate = 0,
        high = 0,
        critical = 0,
    }

    for _, m in ipairs(metrics) do
        local lvl = m.level or "low"
        level_counts[lvl] = (level_counts[lvl] or 0) + 1
    end

    overlord.bus.emit("complexity:status", {
        tracked_files = #metrics,
        by_level = level_counts,
    })
end)

-- ─── Hook: onToolExecute ────────────────────────────────────────────────────
-- Analyze tool output for code complexity indicators.

registerHook("onToolExecute", function(data)
    local config = load_config()

    -- Only analyze in the configured room type (default: code-lab)
    local room_type = data.roomType or data.room_type or ""
    if type(room_type) == "string" and room_type ~= "" then
        if room_type ~= config.room_filter then
            return
        end
    end

    -- Extract text content from tool result
    local text = extract_text(data)
    if text == "" or #text < 20 then
        -- Too little text to analyze meaningfully
        return
    end

    -- Run the complexity analysis
    local analysis = analyze_complexity(text, config.thresholds)

    -- Only store metrics and alert if at least moderate complexity
    if analysis.level == COMPLEXITY_LEVELS.LOW then
        return
    end

    -- Identify the file
    local file_id = extract_file_id(data)
    local tool_name = data.toolName or data.tool_name or "unknown"

    -- Build the metric record
    local record = {
        id = next_metric_id(),
        file = file_id,
        tool = tool_name,
        level = analysis.level,
        line_count = analysis.line_count,
        nesting_depth = analysis.nesting_depth,
        function_count = analysis.function_count,
        max_params = analysis.max_params,
        longest_line = analysis.longest_line,
        chaining_depth = analysis.chaining_depth,
        violation_count = analysis.violation_count,
        violations = analysis.violations,
        agent_id = data.agentId or data.agent_id or "",
        analyzed_at = os.clock(),
    }

    -- Persist
    local metrics = load_metrics()
    table.insert(metrics, record)
    metrics = prune_metrics(metrics, config.max_metrics)
    save_metrics(metrics)

    -- Emit the metric event (always, for trend tracking)
    overlord.bus.emit("complexity:metric", {
        id = record.id,
        file = file_id,
        level = record.level,
        violation_count = record.violation_count,
        line_count = record.line_count,
        nesting_depth = record.nesting_depth,
    })

    overlord.log.debug("Complexity analysis complete", {
        file = file_id,
        level = record.level,
        violations = record.violation_count,
    })

    -- Emit an alert for high or critical complexity (with cooldown)
    if analysis.level == COMPLEXITY_LEVELS.HIGH or analysis.level == COMPLEXITY_LEVELS.CRITICAL then
        if can_alert(file_id, config.alert_cooldown) then
            record_alert_time(file_id)

            -- Build a human-readable summary of what's wrong
            local issues = {}
            for _, v in ipairs(analysis.violations) do
                table.insert(issues, v.metric .. ": " .. v.value .. " (limit: " .. v.threshold .. ")")
            end
            local issue_summary = table.concat(issues, "; ")

            overlord.log.warn("High complexity detected", {
                file = file_id,
                level = analysis.level,
                issues = issue_summary,
            })

            overlord.bus.emit("complexity:alert", {
                file = file_id,
                level = analysis.level,
                violation_count = analysis.violation_count,
                issues = issue_summary,
                violations = analysis.violations,
                tool = tool_name,
            })
        end
    end
end)

-- ─── Hook: onRoomEnter ──────────────────────────────────────────────────────
-- When entering a code-lab, emit a complexity summary so the agent/UI
-- knows which files need attention.

registerHook("onRoomEnter", function(data)
    local config = load_config()
    local room_type = data.roomType or data.room_type or ""

    if room_type ~= config.room_filter then
        return
    end

    local metrics = load_metrics()
    if #metrics == 0 then
        return
    end

    -- Find files with high/critical complexity
    local hot_files = {}
    local seen = {}
    -- Walk backward to find the latest metric per file
    for i = #metrics, 1, -1 do
        local m = metrics[i]
        if not seen[m.file] then
            seen[m.file] = true
            if m.level == COMPLEXITY_LEVELS.HIGH or m.level == COMPLEXITY_LEVELS.CRITICAL then
                table.insert(hot_files, {
                    file = m.file,
                    level = m.level,
                    violation_count = m.violation_count,
                })
            end
        end
    end

    if #hot_files > 0 then
        overlord.log.info("Complex files in scope", {
            hot_file_count = #hot_files,
            agent_id = data.agentId or data.agent_id or "unknown",
        })

        overlord.bus.emit("complexity:summary", {
            hot_files = hot_files,
            total_tracked = #metrics,
            trigger = "room_enter",
        })
    end
end)

-- ─── Hook: onUnload ─────────────────────────────────────────────────────────

registerHook("onUnload", function(data)
    local metrics = load_metrics()
    overlord.log.info("Code Complexity Alert unloading", {
        tracked_metrics = #metrics,
    })
end)
