-- ============================================================================
-- Dependency Watcher Plugin for Overlord v2
-- ============================================================================
--
-- Monitors project dependencies by analyzing tool execution output for
-- dependency-related issues: outdated packages, security vulnerabilities,
-- missing dependencies, and version conflicts.
--
-- This plugin works by hooking into tool executions and scanning results
-- for patterns that indicate dependency problems. It tracks issues in
-- storage and emits alerts so other plugins or dashboards can react.
--
-- LIMITATION: Full remote vulnerability checking requires the net:http
-- permission, which is not yet implemented in the plugin sandbox. This
-- version analyzes tool output locally (e.g., npm audit results, pip
-- check output, cargo check warnings). Once net:http is available, a
-- future version can query registries directly (npm, PyPI, crates.io).
--
-- LIMITATION: Proactive file scanning (reading package.json, Cargo.toml,
-- etc.) requires fs:read, also not yet available. Currently this plugin
-- only processes data that flows through tool executions.
-- ============================================================================

-- ─── Configuration Defaults ─────────────────────────────────────────────────

local DEFAULT_MAX_ISSUES = 200       -- Maximum tracked issues
local DEFAULT_SEVERITY_THRESHOLD = "low"  -- Minimum severity to track
local DEFAULT_ALERT_ON_CRITICAL = true    -- Emit alerts for critical issues

-- ─── Severity Levels ────────────────────────────────────────────────────────
-- Ordered from lowest to highest. Used for threshold filtering.

local SEVERITY_ORDER = {
    info = 1,
    low = 2,
    moderate = 3,
    high = 4,
    critical = 5,
}

-- ─── Dependency Issue Types ─────────────────────────────────────────────────

local ISSUE_TYPES = {
    OUTDATED = "outdated",           -- Package has newer version available
    VULNERABILITY = "vulnerability", -- Known security vulnerability
    MISSING = "missing",             -- Required dependency not installed
    CONFLICT = "conflict",           -- Version conflict between packages
    DEPRECATED = "deprecated",       -- Package is deprecated
    LICENSE = "license",             -- License compatibility issue
}

-- ─── Detection Patterns ─────────────────────────────────────────────────────
-- Each pattern matches against tool output text. When matched, it creates
-- a dependency issue with the specified type and default severity.

local DETECTION_PATTERNS = {
    -- npm / yarn patterns
    { pattern = "npm warn deprecated",     type = ISSUE_TYPES.DEPRECATED,     severity = "moderate" },
    { pattern = "found %d+ vulnerabilit",  type = ISSUE_TYPES.VULNERABILITY,  severity = "high" },
    { pattern = "high severity",           type = ISSUE_TYPES.VULNERABILITY,  severity = "high" },
    { pattern = "critical severity",       type = ISSUE_TYPES.VULNERABILITY,  severity = "critical" },
    { pattern = "moderate severity",       type = ISSUE_TYPES.VULNERABILITY,  severity = "moderate" },
    { pattern = "low severity",            type = ISSUE_TYPES.VULNERABILITY,  severity = "low" },
    { pattern = "missing peer dependency", type = ISSUE_TYPES.MISSING,        severity = "moderate" },
    { pattern = "ERESOLVE",                type = ISSUE_TYPES.CONFLICT,       severity = "high" },
    { pattern = "peer dep missing",        type = ISSUE_TYPES.MISSING,        severity = "moderate" },
    { pattern = "npm warn",                type = ISSUE_TYPES.OUTDATED,       severity = "low" },

    -- pip / python patterns
    { pattern = "no matching distribution", type = ISSUE_TYPES.MISSING,       severity = "high" },
    { pattern = "incompatible versions",    type = ISSUE_TYPES.CONFLICT,      severity = "high" },
    { pattern = "package is deprecated",    type = ISSUE_TYPES.DEPRECATED,    severity = "moderate" },

    -- cargo / rust patterns
    { pattern = "warning: unused dependency", type = ISSUE_TYPES.OUTDATED,    severity = "low" },
    { pattern = "failed to select a version", type = ISSUE_TYPES.CONFLICT,    severity = "high" },

    -- Generic patterns
    { pattern = "outdated",                type = ISSUE_TYPES.OUTDATED,       severity = "low" },
    { pattern = "deprecated",              type = ISSUE_TYPES.DEPRECATED,     severity = "moderate" },
    { pattern = "vulnerability",           type = ISSUE_TYPES.VULNERABILITY,  severity = "high" },
    { pattern = "security advisory",       type = ISSUE_TYPES.VULNERABILITY,  severity = "high" },
}

-- ─── Tool Name Patterns That Signal Dependency Operations ───────────────────
-- We focus scanning on tools likely to produce dependency-related output.

local DEPENDENCY_TOOL_PATTERNS = {
    "npm", "yarn", "pnpm", "pip", "cargo", "gem", "composer",
    "install", "audit", "outdated", "update", "upgrade",
    "dependency", "package", "lock",
}

-- ─── Helper: Load Config ────────────────────────────────────────────────────

local function load_config()
    local max_issues = overlord.storage.get("config:max_issues")
    local threshold = overlord.storage.get("config:severity_threshold")
    local alert_critical = overlord.storage.get("config:alert_on_critical")

    return {
        max_issues = max_issues or DEFAULT_MAX_ISSUES,
        severity_threshold = threshold or DEFAULT_SEVERITY_THRESHOLD,
        alert_on_critical = (alert_critical ~= nil) and alert_critical or DEFAULT_ALERT_ON_CRITICAL,
    }
end

-- ─── Helper: Load Issues ────────────────────────────────────────────────────

local function load_issues()
    local issues = overlord.storage.get("dependency_issues")
    if issues == nil then
        return {}
    end
    return issues
end

-- ─── Helper: Save Issues ────────────────────────────────────────────────────

local function save_issues(issues)
    overlord.storage.set("dependency_issues", issues)
end

-- ─── Helper: Load Summary Counters ──────────────────────────────────────────

local function load_summary()
    local summary = overlord.storage.get("dependency_summary")
    if summary == nil then
        return {
            total = 0,
            by_type = {},
            by_severity = {},
            last_scan_tool = "",
        }
    end
    return summary
end

local function save_summary(summary)
    overlord.storage.set("dependency_summary", summary)
end

-- ─── Helper: Issue ID Generator ─────────────────────────────────────────────

local issue_counter = 0

local function next_issue_id()
    issue_counter = issue_counter + 1
    return "dep-" .. os.clock() .. "-" .. issue_counter
end

-- ─── Helper: Check Severity Threshold ───────────────────────────────────────
-- Returns true if the given severity meets or exceeds the configured threshold.

local function meets_threshold(severity, threshold)
    local sev_level = SEVERITY_ORDER[severity] or 0
    local thr_level = SEVERITY_ORDER[threshold] or 0
    return sev_level >= thr_level
end

-- ─── Helper: Is This a Dependency-Related Tool? ─────────────────────────────
-- Checks if the tool name suggests it might produce dependency information.

local function is_dependency_tool(tool_name)
    if not tool_name or tool_name == "" then
        return false
    end

    local lower = tool_name:lower()
    for _, pat in ipairs(DEPENDENCY_TOOL_PATTERNS) do
        if lower:find(pat, 1, true) then
            return true
        end
    end

    return false
end

-- ─── Helper: Extract Text from Hook Data ────────────────────────────────────
-- Collects all scannable text from the tool execution result.

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
        if type(data.result.stderr) == "string" then
            table.insert(parts, data.result.stderr)
        end
        if type(data.result.message) == "string" then
            table.insert(parts, data.result.message)
        end
    end

    if type(data.output) == "string" then
        table.insert(parts, data.output)
    end
    if type(data.stderr) == "string" then
        table.insert(parts, data.stderr)
    end

    return table.concat(parts, "\n")
end

-- ─── Helper: Scan Text for Dependency Issues ────────────────────────────────
-- Returns a list of detected issues from the text.

local function scan_for_issues(text, config)
    local found = {}

    if type(text) ~= "string" or text == "" then
        return found
    end

    local lower_text = text:lower()

    for _, rule in ipairs(DETECTION_PATTERNS) do
        -- Check if the pattern appears in the text
        if lower_text:find(rule.pattern, 1, true) then
            -- Only track if severity meets threshold
            if meets_threshold(rule.severity, config.severity_threshold) then
                -- Extract the line containing the match for context
                local context_line = ""
                for line in text:gmatch("([^\n]*)\n?") do
                    if line:lower():find(rule.pattern, 1, true) then
                        context_line = line:match("^%s*(.-)%s*$") or ""
                        break
                    end
                end

                table.insert(found, {
                    type = rule.type,
                    severity = rule.severity,
                    context = context_line,
                    pattern_matched = rule.pattern,
                })
            end
        end
    end

    return found
end

-- ─── Helper: Prune Issues ───────────────────────────────────────────────────

local function prune_issues(issues, max_issues)
    if #issues <= max_issues then
        return issues
    end

    -- Sort by severity (keep critical over low) then by recency
    -- Simple approach: keep the most recent up to max
    local pruned = {}
    local start = #issues - max_issues + 1
    for i = start, #issues do
        table.insert(pruned, issues[i])
    end
    return pruned
end

-- ─── Helper: Rebuild Summary from Issues ────────────────────────────────────

local function rebuild_summary(issues, last_tool)
    local by_type = {}
    local by_severity = {}

    for _, issue in ipairs(issues) do
        by_type[issue.type] = (by_type[issue.type] or 0) + 1
        by_severity[issue.severity] = (by_severity[issue.severity] or 0) + 1
    end

    return {
        total = #issues,
        by_type = by_type,
        by_severity = by_severity,
        last_scan_tool = last_tool or "",
    }
end

-- ─── Hook: onLoad ───────────────────────────────────────────────────────────

registerHook("onLoad", function(data)
    local config = load_config()
    local issues = load_issues()
    local summary = load_summary()

    overlord.log.info("Dependency Watcher loaded", {
        tracked_issues = #issues,
        severity_threshold = config.severity_threshold,
        alert_on_critical = config.alert_on_critical,
    })

    -- Emit current state
    overlord.bus.emit("dependency:status", {
        total_issues = summary.total,
        by_type = summary.by_type,
        by_severity = summary.by_severity,
    })

    -- If there are critical issues from a previous session, re-alert
    if summary.by_severity and summary.by_severity.critical then
        local crit_count = summary.by_severity.critical
        if crit_count > 0 and config.alert_on_critical then
            overlord.log.warn("Critical dependency issues from previous session", {
                critical_count = crit_count,
            })
            overlord.bus.emit("dependency:alert", {
                severity = "critical",
                message = crit_count .. " critical dependency issue(s) still unresolved",
                count = crit_count,
            })
        end
    end
end)

-- ─── Hook: onToolExecute ────────────────────────────────────────────────────
-- Scan tool results for dependency-related issues.

registerHook("onToolExecute", function(data)
    local config = load_config()
    local tool_name = data.toolName or data.tool_name or ""

    -- We scan ALL tool output, but do a deeper scan for dependency tools.
    -- For non-dependency tools, we only look if the output is large enough
    -- to plausibly contain dependency information.
    local text = extract_text(data)
    if text == "" then
        return
    end

    local is_dep_tool = is_dependency_tool(tool_name)

    -- For non-dependency tools, only scan if text is substantial and
    -- contains at least one dependency-related keyword
    if not is_dep_tool then
        local lower = text:lower()
        local has_dep_keyword = lower:find("depend", 1, true)
            or lower:find("vulnerab", 1, true)
            or lower:find("deprecated", 1, true)
            or lower:find("outdated", 1, true)
            or lower:find("security", 1, true)
        if not has_dep_keyword then
            return
        end
    end

    -- Scan for issues
    local found = scan_for_issues(text, config)
    if #found == 0 then
        return
    end

    -- Load existing issues and add new ones
    local issues = load_issues()
    local new_count = 0
    local has_critical = false

    for _, detection in ipairs(found) do
        local issue = {
            id = next_issue_id(),
            type = detection.type,
            severity = detection.severity,
            context = detection.context,
            source_tool = tool_name,
            room_id = data.roomId or data.room_id or "",
            detected_at = os.clock(),
            resolved = false,
        }

        table.insert(issues, issue)
        new_count = new_count + 1

        if detection.severity == "critical" then
            has_critical = true
        end

        -- Emit individual issue event
        overlord.bus.emit("dependency:issue", {
            id = issue.id,
            type = issue.type,
            severity = issue.severity,
            context = issue.context,
            source_tool = tool_name,
        })
    end

    -- Prune if needed
    issues = prune_issues(issues, config.max_issues)
    save_issues(issues)

    -- Rebuild and save summary
    local summary = rebuild_summary(issues, tool_name)
    save_summary(summary)

    overlord.log.info("Dependency issues detected", {
        new_issues = new_count,
        total_issues = #issues,
        source_tool = tool_name,
    })

    -- Emit summary update
    overlord.bus.emit("dependency:status", {
        total_issues = summary.total,
        by_type = summary.by_type,
        by_severity = summary.by_severity,
        new_issues = new_count,
    })

    -- Critical alert if configured
    if has_critical and config.alert_on_critical then
        overlord.log.warn("CRITICAL dependency issue detected!", {
            source_tool = tool_name,
        })
        overlord.bus.emit("dependency:alert", {
            severity = "critical",
            message = "Critical dependency issue detected in " .. tool_name .. " output",
            source_tool = tool_name,
        })
    end
end)

-- ─── Hook: onPhaseAdvance ───────────────────────────────────────────────────
-- When entering a new phase, emit the current dependency health summary
-- so the team is aware of outstanding issues before proceeding.

registerHook("onPhaseAdvance", function(data)
    local issues = load_issues()
    local summary = load_summary()
    local phase = data.phase or data.phaseName or data.phase_name or "unknown"

    if summary.total > 0 then
        overlord.log.info("Dependency status at phase advance", {
            phase = phase,
            total_issues = summary.total,
            by_severity = summary.by_severity,
        })

        overlord.bus.emit("dependency:phase-report", {
            phase = phase,
            total_issues = summary.total,
            by_type = summary.by_type,
            by_severity = summary.by_severity,
        })
    end
end)

-- ─── Hook: onUnload ─────────────────────────────────────────────────────────

registerHook("onUnload", function(data)
    local summary = load_summary()
    overlord.log.info("Dependency Watcher unloading", {
        total_issues = summary.total,
    })
end)
