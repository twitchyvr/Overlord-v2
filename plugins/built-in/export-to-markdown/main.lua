-- =============================================================================
-- Export to Markdown Plugin for Overlord v2
-- =============================================================================
-- Generates comprehensive markdown documents from the current Overlord project
-- state. On phase advances (and on demand), the plugin snapshots rooms, agents,
-- tool execution history, and RAID-related data, then formats everything into
-- a clean, readable markdown document. The markdown is stored and emitted via
-- the export:ready event so it can be saved to disk, sent to a wiki, or
-- displayed in the UI.
--
-- Use cases:
--   - Automatic project status reports at each phase gate
--   - Shareable snapshots for stakeholders who do not use Overlord directly
--   - Audit trail in a human-readable, version-control-friendly format
--
-- Configuration (via storage):
--   "export-to-markdown:config" = {
--     enabled        = true,
--     exportOnPhase  = true,          -- Auto-export on phase advance
--     exportOnExit   = false,         -- Auto-export on room exit
--     includeAgents  = true,          -- Include agent roster
--     includeRooms   = true,          -- Include room listing
--     includeRaid    = true,          -- Include RAID data (if available)
--     includeTools   = true,          -- Include tool execution summary
--     projectName    = "Overlord Project",  -- Header for the document
--     maxExports     = 50,            -- Max stored exports
--   }
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Default configuration
-- ---------------------------------------------------------------------------
local DEFAULT_CONFIG = {
  enabled        = true,
  exportOnPhase  = true,
  exportOnExit   = false,
  includeAgents  = true,
  includeRooms   = true,
  includeRaid    = true,
  includeTools   = true,
  projectName    = "Overlord Project",
  maxExports     = 50,
}

-- ---------------------------------------------------------------------------
-- Helper: load configuration
-- ---------------------------------------------------------------------------
local function loadConfig()
  local ok, stored = pcall(overlord.storage.get, "export-to-markdown:config")
  if ok and stored then
    local cfg = {}
    for k, v in pairs(DEFAULT_CONFIG) do cfg[k] = v end
    for k, v in pairs(stored) do cfg[k] = v end
    return cfg
  end
  return DEFAULT_CONFIG
end

-- ---------------------------------------------------------------------------
-- Storage helpers: tool execution log (collected by this plugin)
-- ---------------------------------------------------------------------------
-- We maintain a running log of tool executions to include in exports.
-- Structure: array of { toolName, agentId, roomId, status, timestamp }

local function loadToolLog()
  local ok, log = pcall(overlord.storage.get, "export-to-markdown:tool-log")
  if ok and log then return log end
  return {}
end

local function saveToolLog(log)
  -- Keep the most recent 500 entries
  while #log > 500 do
    table.remove(log, 1)
  end
  pcall(overlord.storage.set, "export-to-markdown:tool-log", log)
end

-- ---------------------------------------------------------------------------
-- Storage helpers: exit document log
-- ---------------------------------------------------------------------------
-- Track exit documents produced by rooms for inclusion in exports.

local function loadExitDocs()
  local ok, docs = pcall(overlord.storage.get, "export-to-markdown:exit-docs")
  if ok and docs then return docs end
  return {}
end

local function saveExitDocs(docs)
  while #docs > 200 do
    table.remove(docs, 1)
  end
  pcall(overlord.storage.set, "export-to-markdown:exit-docs", docs)
end

-- ---------------------------------------------------------------------------
-- Storage helpers: export history
-- ---------------------------------------------------------------------------
local function loadExportHistory()
  local ok, history = pcall(overlord.storage.get, "export-to-markdown:history")
  if ok and history then return history end
  return {}
end

local function saveExportHistory(history, maxExports)
  maxExports = maxExports or 50
  while #history > maxExports do
    table.remove(history, 1)
  end
  pcall(overlord.storage.set, "export-to-markdown:history", history)
end

-- ---------------------------------------------------------------------------
-- Helper: format a unix timestamp as a readable date string
-- ---------------------------------------------------------------------------
local function formatTime(ts)
  if not ts then return "N/A" end
  local ok, result = pcall(os.date, "%Y-%m-%d %H:%M:%S", ts)
  if ok then return result end
  return tostring(ts)
end

-- ---------------------------------------------------------------------------
-- Markdown generation: rooms section
-- ---------------------------------------------------------------------------
local function generateRoomsSection()
  local lines = {}
  table.insert(lines, "## Rooms")
  table.insert(lines, "")

  local ok, rooms = pcall(overlord.rooms.list)
  if not ok or not rooms or #rooms == 0 then
    table.insert(lines, "_No rooms found._")
    table.insert(lines, "")
    return table.concat(lines, "\n")
  end

  table.insert(lines, "| Room | Type | ID |")
  table.insert(lines, "|------|------|----|")
  for _, room in ipairs(rooms) do
    table.insert(lines, string.format(
      "| %s | %s | `%s` |",
      room.name or "Unnamed", room.type or "unknown", room.id or ""
    ))
  end
  table.insert(lines, "")

  return table.concat(lines, "\n")
end

-- ---------------------------------------------------------------------------
-- Markdown generation: agents section
-- ---------------------------------------------------------------------------
local function generateAgentsSection()
  local lines = {}
  table.insert(lines, "## Agents")
  table.insert(lines, "")

  local ok, agents = pcall(overlord.agents.list, {})
  if not ok or not agents or #agents == 0 then
    table.insert(lines, "_No agents found._")
    table.insert(lines, "")
    return table.concat(lines, "\n")
  end

  table.insert(lines, "| Agent | Role | Status | ID |")
  table.insert(lines, "|-------|------|--------|----|")
  for _, agent in ipairs(agents) do
    table.insert(lines, string.format(
      "| %s | %s | %s | `%s` |",
      agent.name or "Unnamed",
      agent.role or "unassigned",
      agent.status or "unknown",
      agent.id or ""
    ))
  end
  table.insert(lines, "")

  return table.concat(lines, "\n")
end

-- ---------------------------------------------------------------------------
-- Markdown generation: tool execution summary section
-- ---------------------------------------------------------------------------
local function generateToolsSection()
  local lines = {}
  table.insert(lines, "## Tool Execution Summary")
  table.insert(lines, "")

  local toolLog = loadToolLog()
  if #toolLog == 0 then
    table.insert(lines, "_No tool executions recorded._")
    table.insert(lines, "")
    return table.concat(lines, "\n")
  end

  -- Aggregate by tool name
  local toolCounts = {}
  local toolStatuses = {}
  for _, entry in ipairs(toolLog) do
    local name = entry.toolName or "unknown"
    toolCounts[name] = (toolCounts[name] or 0) + 1
    if entry.status then
      toolStatuses[name] = toolStatuses[name] or {}
      toolStatuses[name][entry.status] = (toolStatuses[name][entry.status] or 0) + 1
    end
  end

  table.insert(lines, string.format("Total executions recorded: **%d**", #toolLog))
  table.insert(lines, "")
  table.insert(lines, "| Tool | Executions | Status Breakdown |")
  table.insert(lines, "|------|------------|------------------|")

  for toolName, count in pairs(toolCounts) do
    local statusParts = {}
    if toolStatuses[toolName] then
      for status, sCount in pairs(toolStatuses[toolName]) do
        table.insert(statusParts, string.format("%s: %d", status, sCount))
      end
    end
    local statusStr = #statusParts > 0 and table.concat(statusParts, ", ") or "N/A"
    table.insert(lines, string.format("| %s | %d | %s |", toolName, count, statusStr))
  end
  table.insert(lines, "")

  return table.concat(lines, "\n")
end

-- ---------------------------------------------------------------------------
-- Markdown generation: RAID section (uses data from raid-summary if available)
-- ---------------------------------------------------------------------------
local function generateRaidSection()
  local lines = {}
  table.insert(lines, "## RAID Log")
  table.insert(lines, "")

  -- Try to read RAID data from the raid-summary plugin's storage
  local ok, raidCounts = pcall(overlord.storage.get, "raid-summary:current-counts")
  if ok and raidCounts then
    table.insert(lines, "| Category | Count |")
    table.insert(lines, "|----------|-------|")

    local categories = { "risk", "assumption", "issue", "dependency" }
    for _, cat in ipairs(categories) do
      local displayName = cat:sub(1, 1):upper() .. cat:sub(2)
      table.insert(lines, string.format(
        "| %s | %d |", displayName, raidCounts[cat] or 0
      ))
    end
    table.insert(lines, "")

    -- Try to include trend info if available
    local okHistory, periodHistory = pcall(overlord.storage.get, "raid-summary:period-history")
    if okHistory and periodHistory and #periodHistory > 0 then
      table.insert(lines, string.format("_Historical periods tracked: %d_", #periodHistory))
      table.insert(lines, "")
    end
  else
    table.insert(lines, "_No RAID data available. Install the raid-summary plugin for RAID tracking._")
    table.insert(lines, "")
  end

  return table.concat(lines, "\n")
end

-- ---------------------------------------------------------------------------
-- Markdown generation: exit documents section
-- ---------------------------------------------------------------------------
local function generateExitDocsSection()
  local lines = {}
  table.insert(lines, "## Exit Documents")
  table.insert(lines, "")

  local exitDocs = loadExitDocs()
  if #exitDocs == 0 then
    table.insert(lines, "_No exit documents recorded._")
    table.insert(lines, "")
    return table.concat(lines, "\n")
  end

  for i, doc in ipairs(exitDocs) do
    table.insert(lines, string.format("### Exit Document %d", i))
    table.insert(lines, "")
    table.insert(lines, string.format("- **Room:** %s", doc.roomId or "unknown"))
    table.insert(lines, string.format("- **Agent:** %s", doc.agentId or "unknown"))
    table.insert(lines, string.format("- **Time:** %s", formatTime(doc.timestamp)))
    if doc.summary then
      table.insert(lines, string.format("- **Summary:** %s", doc.summary))
    end
    table.insert(lines, "")
  end

  return table.concat(lines, "\n")
end

-- ---------------------------------------------------------------------------
-- Core: generate the full markdown document
-- ---------------------------------------------------------------------------
local function generateMarkdown(triggerType, triggerData)
  local config = loadConfig()

  local lines = {}

  -- Header
  table.insert(lines, string.format("# %s -- Status Export", config.projectName))
  table.insert(lines, "")
  table.insert(lines, string.format("_Generated: %s_", formatTime(os.time())))
  table.insert(lines, string.format("_Trigger: %s_", triggerType or "manual"))
  if triggerData and triggerData.phase then
    table.insert(lines, string.format("_Phase: %s_", triggerData.phase))
  end
  table.insert(lines, "")
  table.insert(lines, "---")
  table.insert(lines, "")

  -- Sections based on config
  if config.includeRooms then
    table.insert(lines, generateRoomsSection())
  end

  if config.includeAgents then
    table.insert(lines, generateAgentsSection())
  end

  if config.includeTools then
    table.insert(lines, generateToolsSection())
  end

  if config.includeRaid then
    table.insert(lines, generateRaidSection())
  end

  -- Exit documents are always included (they are a core Overlord concept)
  table.insert(lines, generateExitDocsSection())

  -- Footer
  table.insert(lines, "---")
  table.insert(lines, "")
  table.insert(lines, string.format(
    "_Exported by the Export to Markdown plugin v1.0.0 at %s_",
    formatTime(os.time())
  ))

  return table.concat(lines, "\n")
end

-- ---------------------------------------------------------------------------
-- Core: generate, store, and emit the export
-- ---------------------------------------------------------------------------
local function performExport(triggerType, triggerData)
  local config = loadConfig()

  local markdown = generateMarkdown(triggerType, triggerData)

  -- Emit the export:ready event
  local payload = {
    markdown  = markdown,
    trigger   = triggerType,
    timestamp = os.time(),
    phase     = triggerData and triggerData.phase,
  }

  local ok, err = pcall(overlord.bus.emit, "export:ready", payload)
  if ok then
    overlord.log.info("Markdown export generated and emitted", {
      trigger = triggerType,
      length  = #markdown,
    })
  else
    overlord.log.error("Failed to emit export:ready event", { error = err })
  end

  -- Store the export in history
  local history = loadExportHistory()
  table.insert(history, {
    markdown  = markdown,
    trigger   = triggerType,
    timestamp = os.time(),
  })
  saveExportHistory(history, config.maxExports)
end

-- ---------------------------------------------------------------------------
-- Hook: onLoad
-- ---------------------------------------------------------------------------
registerHook("onLoad", function()
  local config = loadConfig()

  if not config.enabled then
    overlord.log.info("Export to Markdown plugin is disabled via config")
    return
  end

  overlord.log.info("Export to Markdown plugin loaded", {
    projectName   = config.projectName,
    exportOnPhase = config.exportOnPhase,
    exportOnExit  = config.exportOnExit,
  })
end)

-- ---------------------------------------------------------------------------
-- Hook: onUnload -- generate a final export
-- ---------------------------------------------------------------------------
registerHook("onUnload", function()
  local config = loadConfig()
  if not config.enabled then return end

  overlord.log.info("Export to Markdown plugin unloading -- generating final export")
  local ok, err = pcall(performExport, "unload", {})
  if not ok then
    overlord.log.error("Failed to generate final markdown export", { error = err })
  end
end)

-- ---------------------------------------------------------------------------
-- Hook: onPhaseAdvance -- primary trigger for exports
-- ---------------------------------------------------------------------------
registerHook("onPhaseAdvance", function(data)
  local config = loadConfig()
  if not config.enabled or not config.exportOnPhase then return end

  overlord.log.info("Phase advance detected -- generating markdown export", {
    phase = data and data.phase,
  })

  local ok, err = pcall(performExport, "phase-advance", {
    phase     = data and data.phase,
    fromPhase = data and data.fromPhase,
  })
  if not ok then
    overlord.log.error("Failed to generate markdown export on phase advance", { error = err })
  end
end)

-- ---------------------------------------------------------------------------
-- Hook: onRoomExit -- track exit documents and optionally trigger export
-- ---------------------------------------------------------------------------
registerHook("onRoomExit", function(data)
  local config = loadConfig()
  if not config.enabled then return end

  -- Record the exit document for later inclusion in exports
  if data then
    local exitDocs = loadExitDocs()
    table.insert(exitDocs, {
      roomId    = data.roomId,
      agentId   = data.agentId,
      roomType  = data.roomType,
      summary   = data.exitSummary or data.summary,
      timestamp = os.time(),
    })
    saveExitDocs(exitDocs)
  end

  -- Optionally generate an export on room exit
  if config.exportOnExit then
    local ok, err = pcall(performExport, "room-exit", {
      roomId  = data and data.roomId,
      agentId = data and data.agentId,
    })
    if not ok then
      overlord.log.error("Failed to generate markdown export on room exit", { error = err })
    end
  end
end)

-- ---------------------------------------------------------------------------
-- Hook: onToolExecute -- track tool executions for the tools section
-- ---------------------------------------------------------------------------
registerHook("onToolExecute", function(data)
  local config = loadConfig()
  if not config.enabled or not config.includeTools then return end

  if not data or not data.toolName then return end

  local toolLog = loadToolLog()
  table.insert(toolLog, {
    toolName  = data.toolName,
    agentId   = data.agentId,
    roomId    = data.roomId,
    status    = data.status,
    timestamp = os.time(),
  })
  saveToolLog(toolLog)
end)

-- ---------------------------------------------------------------------------
-- Hook: onRoomEnter -- informational logging
-- ---------------------------------------------------------------------------
registerHook("onRoomEnter", function(data)
  local config = loadConfig()
  if not config.enabled then return end

  overlord.log.debug("Room enter tracked for markdown context", {
    roomId  = data and data.roomId,
    agentId = data and data.agentId,
  })
end)
