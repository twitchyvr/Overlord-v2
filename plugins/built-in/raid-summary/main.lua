-- =============================================================================
-- RAID Summary Plugin for Overlord v2
-- =============================================================================
-- Generates periodic summaries of the RAID log (Risks, Assumptions, Issues,
-- Dependencies) with trend analysis. Tracks RAID-related tool executions,
-- stores counts by type, and emits raid:summary events with trend direction
-- (growing / stable / declining) per category.
--
-- The RAID log is central to Overlord's governance model. This plugin turns
-- raw log entries into actionable intelligence: "Are risks increasing? Are
-- issues being resolved? Are we accumulating dependencies?"
--
-- Configuration (via storage):
--   "raid-summary:config" = {
--     enabled            = true,
--     summaryInterval    = 6,          -- hours between summaries
--     trendWindowPeriods = 3,          -- how many past periods to compare
--     raidToolPatterns   = {...},      -- tool name patterns for RAID entries
--   }
-- =============================================================================

-- ---------------------------------------------------------------------------
-- RAID type constants
-- ---------------------------------------------------------------------------
local RAID_TYPES = { "risk", "assumption", "issue", "dependency" }

-- ---------------------------------------------------------------------------
-- Trend direction constants
-- ---------------------------------------------------------------------------
local TREND = {
  GROWING   = "growing",
  STABLE    = "stable",
  DECLINING = "declining",
}

-- ---------------------------------------------------------------------------
-- Default configuration
-- ---------------------------------------------------------------------------
local DEFAULT_CONFIG = {
  enabled            = true,
  summaryInterval    = 6,
  trendWindowPeriods = 3,
  raidToolPatterns   = { "raid", "risk", "assumption", "issue", "dependency", "log_raid" },
}

-- ---------------------------------------------------------------------------
-- Helper: load configuration from storage with defaults
-- ---------------------------------------------------------------------------
local function loadConfig()
  local ok, stored = pcall(overlord.storage.get, "raid-summary:config")
  if ok and stored then
    local cfg = {}
    for k, v in pairs(DEFAULT_CONFIG) do cfg[k] = v end
    for k, v in pairs(stored) do cfg[k] = v end
    return cfg
  end
  return DEFAULT_CONFIG
end

-- ---------------------------------------------------------------------------
-- Helper: check if a tool name matches RAID-related patterns
-- ---------------------------------------------------------------------------
local function isRaidTool(toolName, patterns)
  if not toolName then return false end
  local lower = string.lower(toolName)
  for _, pattern in ipairs(patterns) do
    if string.find(lower, string.lower(pattern), 1, true) then
      return true
    end
  end
  return false
end

-- ---------------------------------------------------------------------------
-- Helper: classify a RAID entry by type from tool name or data
-- ---------------------------------------------------------------------------
-- Tries to determine which RAID category an entry belongs to by checking
-- the tool name and any type field in the execution data.

local function classifyRaidType(toolName, data)
  -- Check explicit type field first
  if data and data.raidType then
    local lower = string.lower(data.raidType)
    for _, raidType in ipairs(RAID_TYPES) do
      if string.find(lower, raidType, 1, true) then
        return raidType
      end
    end
  end

  -- Fall back to tool name substring matching
  if toolName then
    local lower = string.lower(toolName)
    for _, raidType in ipairs(RAID_TYPES) do
      if string.find(lower, raidType, 1, true) then
        return raidType
      end
    end
  end

  -- Default to "issue" if we cannot classify
  return "issue"
end

-- ---------------------------------------------------------------------------
-- Storage helpers for current-period counts
-- ---------------------------------------------------------------------------
-- Structure: { risk = N, assumption = N, issue = N, dependency = N }

local function loadCurrentCounts()
  local ok, counts = pcall(overlord.storage.get, "raid-summary:current-counts")
  if ok and counts then return counts end
  return { risk = 0, assumption = 0, issue = 0, dependency = 0 }
end

local function saveCurrentCounts(counts)
  pcall(overlord.storage.set, "raid-summary:current-counts", counts)
end

-- ---------------------------------------------------------------------------
-- Storage helpers for period history (used for trend analysis)
-- ---------------------------------------------------------------------------
-- Array of { counts = {...}, timestamp = N }

local function loadPeriodHistory()
  local ok, history = pcall(overlord.storage.get, "raid-summary:period-history")
  if ok and history then return history end
  return {}
end

local function savePeriodHistory(history)
  -- Keep at most 50 past periods
  while #history > 50 do
    table.remove(history, 1)
  end
  pcall(overlord.storage.set, "raid-summary:period-history", history)
end

-- ---------------------------------------------------------------------------
-- Storage helpers for generated summaries
-- ---------------------------------------------------------------------------
local function loadSummaryHistory()
  local ok, history = pcall(overlord.storage.get, "raid-summary:summary-history")
  if ok and history then return history end
  return {}
end

local function saveSummaryHistory(history)
  while #history > 30 do
    table.remove(history, 1)
  end
  pcall(overlord.storage.set, "raid-summary:summary-history", history)
end

-- ---------------------------------------------------------------------------
-- Core: compute trend direction for a RAID type
-- ---------------------------------------------------------------------------
-- Compares the current count to the average of the last N periods.
-- If current > average * 1.2 => growing
-- If current < average * 0.8 => declining
-- Otherwise => stable

local function computeTrend(raidType, currentCounts, periodHistory, windowPeriods)
  local current = currentCounts[raidType] or 0

  -- Gather the most recent N periods
  local startIdx = math.max(1, #periodHistory - windowPeriods + 1)
  local sum = 0
  local count = 0
  for i = startIdx, #periodHistory do
    local period = periodHistory[i]
    if period and period.counts then
      sum = sum + (period.counts[raidType] or 0)
      count = count + 1
    end
  end

  -- Not enough history to determine a trend
  if count == 0 then
    return TREND.STABLE
  end

  local average = sum / count

  -- Avoid division-by-zero edge case: if average is 0, any current > 0 is growing
  if average == 0 then
    if current > 0 then return TREND.GROWING end
    return TREND.STABLE
  end

  if current > average * 1.2 then
    return TREND.GROWING
  elseif current < average * 0.8 then
    return TREND.DECLINING
  else
    return TREND.STABLE
  end
end

-- ---------------------------------------------------------------------------
-- Core: generate the summary
-- ---------------------------------------------------------------------------
local function generateSummary()
  local config        = loadConfig()
  local currentCounts = loadCurrentCounts()
  local periodHistory = loadPeriodHistory()

  -- Compute trends for each RAID type
  local trends = {}
  for _, raidType in ipairs(RAID_TYPES) do
    trends[raidType] = computeTrend(
      raidType, currentCounts, periodHistory, config.trendWindowPeriods
    )
  end

  -- Build a human-readable summary
  local lines = {}
  table.insert(lines, "=== RAID Log Summary ===")
  table.insert(lines, "")

  local totalEntries = 0
  for _, raidType in ipairs(RAID_TYPES) do
    local count = currentCounts[raidType] or 0
    totalEntries = totalEntries + count
    local arrow = ""
    if trends[raidType] == TREND.GROWING then arrow = " [UP]"
    elseif trends[raidType] == TREND.DECLINING then arrow = " [DOWN]"
    else arrow = " [STEADY]"
    end
    -- Capitalize the type name for display
    local displayName = raidType:sub(1, 1):upper() .. raidType:sub(2)
    table.insert(lines, string.format(
      "  %-14s  count: %3d   trend: %s%s",
      displayName, count, trends[raidType], arrow
    ))
  end

  table.insert(lines, "")
  table.insert(lines, string.format("Total RAID entries this period: %d", totalEntries))
  table.insert(lines, string.format("Historical periods tracked: %d", #periodHistory))
  table.insert(lines, "")

  -- Highlight any growing categories as areas of concern
  local concerns = {}
  for _, raidType in ipairs(RAID_TYPES) do
    if trends[raidType] == TREND.GROWING then
      table.insert(concerns, raidType)
    end
  end
  if #concerns > 0 then
    table.insert(lines, "Areas of concern (growing trends):")
    for _, c in ipairs(concerns) do
      table.insert(lines, "  - " .. c:sub(1, 1):upper() .. c:sub(2))
    end
  else
    table.insert(lines, "No growing trends detected -- looking stable.")
  end

  table.insert(lines, "")
  table.insert(lines, "=== End RAID Summary ===")

  local summaryText = table.concat(lines, "\n")

  -- Build the event payload
  local payload = {
    summary   = summaryText,
    counts    = currentCounts,
    trends    = trends,
    concerns  = concerns,
    timestamp = os.time(),
  }

  -- Emit the summary event
  local ok, err = pcall(overlord.bus.emit, "raid:summary", payload)
  if ok then
    overlord.log.info("RAID summary generated and emitted", {
      total    = totalEntries,
      concerns = #concerns,
    })
  else
    overlord.log.error("Failed to emit raid:summary event", { error = err })
  end

  -- Archive this period's counts for future trend calculations
  table.insert(periodHistory, {
    counts    = currentCounts,
    timestamp = os.time(),
  })
  savePeriodHistory(periodHistory)

  -- Archive the summary itself
  local summaryHistory = loadSummaryHistory()
  table.insert(summaryHistory, payload)
  saveSummaryHistory(summaryHistory)

  -- Reset current counts for the next period
  saveCurrentCounts({ risk = 0, assumption = 0, issue = 0, dependency = 0 })
end

-- ---------------------------------------------------------------------------
-- Hook: onLoad — initialize storage and log startup
-- ---------------------------------------------------------------------------
registerHook("onLoad", function()
  local config = loadConfig()

  if not config.enabled then
    overlord.log.info("RAID Summary plugin is disabled via config")
    return
  end

  -- Ensure storage keys exist
  local ok1, _ = pcall(overlord.storage.get, "raid-summary:current-counts")
  if not ok1 then
    saveCurrentCounts({ risk = 0, assumption = 0, issue = 0, dependency = 0 })
  end

  overlord.log.info("RAID Summary plugin loaded", {
    interval     = config.summaryInterval,
    trendWindow  = config.trendWindowPeriods,
  })
end)

-- ---------------------------------------------------------------------------
-- Hook: onUnload — generate a final summary before shutting down
-- ---------------------------------------------------------------------------
registerHook("onUnload", function()
  overlord.log.info("RAID Summary plugin unloading -- generating final summary")
  local ok, err = pcall(generateSummary)
  if not ok then
    overlord.log.error("Failed to generate final RAID summary", { error = err })
  end
end)

-- ---------------------------------------------------------------------------
-- Hook: onToolExecute — track RAID-related tool executions
-- ---------------------------------------------------------------------------
registerHook("onToolExecute", function(data)
  local config = loadConfig()
  if not config.enabled then return end

  local toolName = data and data.toolName
  if not toolName then return end

  -- Only track tools that match RAID patterns
  if not isRaidTool(toolName, config.raidToolPatterns) then
    return
  end

  local raidType = classifyRaidType(toolName, data)

  overlord.log.debug("RAID tool execution tracked", {
    tool     = toolName,
    raidType = raidType,
    agent    = data and data.agentId,
  })

  local counts = loadCurrentCounts()
  counts[raidType] = (counts[raidType] or 0) + 1
  saveCurrentCounts(counts)
end)

-- ---------------------------------------------------------------------------
-- Hook: onPhaseAdvance — a natural checkpoint to generate a summary
-- ---------------------------------------------------------------------------
-- Phase advances are significant project milestones, making them a natural
-- point to take stock of the RAID log.

registerHook("onPhaseAdvance", function(data)
  local config = loadConfig()
  if not config.enabled then return end

  overlord.log.info("Phase advance detected -- generating RAID summary", {
    phase = data and data.phase,
  })

  local ok, err = pcall(generateSummary)
  if not ok then
    overlord.log.error("Failed to generate RAID summary on phase advance", { error = err })
  end
end)

-- ---------------------------------------------------------------------------
-- Hook: onRoomEnter — check if the summary interval has elapsed
-- ---------------------------------------------------------------------------
-- We piggyback on room-enter events to check whether enough time has passed
-- since the last summary. This avoids the need for a background timer.

registerHook("onRoomEnter", function(data)
  local config = loadConfig()
  if not config.enabled then return end

  local ok, lastTime = pcall(overlord.storage.get, "raid-summary:last-summary-time")
  local last = (ok and lastTime) or 0
  local now = os.time()
  local intervalSeconds = (config.summaryInterval or 6) * 3600

  if (now - last) >= intervalSeconds then
    overlord.log.info("RAID summary interval elapsed -- generating summary")
    local okGen, errGen = pcall(generateSummary)
    if okGen then
      pcall(overlord.storage.set, "raid-summary:last-summary-time", now)
    else
      overlord.log.error("Failed to generate scheduled RAID summary", { error = errGen })
    end
  end
end)
